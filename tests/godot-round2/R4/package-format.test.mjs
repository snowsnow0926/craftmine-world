import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PACKAGE_FORMAT,RESOURCE_FORMAT,LOCK_FORMAT,PACKAGE_KINDS,canonicalJSON,canonicalValue,contentHash,validatePath,validateEntries,validateKind,legacyKind,validateLock,validateResourceManifest,validatePackageJson} from '../../../plugins/craftmine-world/package-format.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const vectors=JSON.parse(readFileSync(join(here,'vectors','package-format-vectors.json'),'utf8'));
const throwsCode=(run,code)=>assert.throws(run,error=>error instanceof Error&&(error.message===code||error.message.startsWith(code+': ')),`expected ${code}`);

test('format constants',()=>{
  assert.equal(PACKAGE_FORMAT,'craftmine.package/1');
  assert.equal(RESOURCE_FORMAT,'craftmine.resource/1');
  assert.equal(LOCK_FORMAT,'craftmine.assets-lock/1');
  assert.deepEqual(PACKAGE_KINDS,['base','world','module','object','scene','raw','data']);
});

test('canonical vectors',()=>{
  for(const vector of vectors.canonical){
    if(vector.canonical!==undefined){
      assert.equal(canonicalJSON(vector.input),vector.canonical,vector.name);
      assert.equal(canonicalValue(JSON.parse(vector.input)),vector.canonical,vector.name+' (canonicalValue)');
    }else{
      throwsCode(()=>canonicalJSON(vector.input),vector.error);
    }
  }
});

test('path vectors',()=>{
  for(const path of vectors.paths.accept)assert.equal(validatePath(path),path,path);
  for(const vector of vectors.paths.reject)throwsCode(()=>validatePath(vector.path),vector.error);
});

test('kind vectors',()=>{
  for(const kind of vectors.kinds.accept){assert.equal(validateKind(kind),kind);assert.ok(PACKAGE_KINDS.includes(kind));}
  for(const vector of vectors.kinds.reject)throwsCode(()=>validateKind(vector.kind),vector.error);
});

test('legacy vectors',()=>{
  for(const vector of vectors.legacy){
    if(vector.kind!==undefined)assert.deepEqual(legacyKind(vector.source),{kind:vector.kind},vector.name);
    else if(vector.ambiguous!==undefined)assert.deepEqual(legacyKind(vector.source),{ambiguous:vector.ambiguous},vector.name);
    else throwsCode(()=>legacyKind(vector.source),vector.error);
  }
});

test('lock vectors',()=>{
  for(const vector of vectors.lock){
    const lock={direct:vector.direct,closure:vector.closure,graph:vector.graph};
    if(vector.ok)assert.deepEqual(validateLock(lock),{ok:true},vector.name);
    else throwsCode(()=>validateLock(lock),vector.error);
  }
});

const resourceContent=()=>({assetId:'demo.asset',version:1,kind:'raw',files:[{path:'payload/a.txt',bytes:3,sha256:'0'.repeat(64)}],dependencies:[],entry:{},interfaces:{},compatibility:{},state:{},licenses:{}});

test('validateEntries rejects case collisions',()=>{
  throwsCode(()=>validateEntries(['payload/A.txt','payload/a.txt']),'PACKAGE_DUPLICATE_ENTRY');
  assert.deepEqual(validateEntries(['b.txt','a.txt']),['a.txt','b.txt']);
});

test('validateResourceManifest rejects content hash mismatch',()=>{
  const content=resourceContent();
  const manifest={format:RESOURCE_FORMAT,content,contentHash:contentHash(content)};
  assert.deepEqual(validateResourceManifest(manifest),manifest);
  throwsCode(()=>validateResourceManifest({...manifest,contentHash:'f'.repeat(64)}),'RESOURCE_CONTENT_HASH_MISMATCH');
});

test('validatePackageJson rejects an unlisted entry',()=>{
  const content=resourceContent();
  const resourceHash=contentHash(content);
  const resourcePath=`resources/${resourceHash}/payload/a.txt`;
  const manifestPath=`resources/${resourceHash}/manifest.json`;
  const pkg={format:PACKAGE_FORMAT,root:{id:'demo',version:1,sha256:'a'.repeat(64)},
    resources:[{contentHash:resourceHash,manifest:{format:RESOURCE_FORMAT,content,contentHash:resourceHash},files:[{path:resourcePath,bytes:3,sha256:'0'.repeat(64)}]}],
    files:[{path:resourcePath,bytes:3,sha256:'0'.repeat(64)}]};
  const entries=['package.json',manifestPath,resourcePath];
  assert.equal(validatePackageJson(pkg,entries).entryCount,2);
  throwsCode(()=>validatePackageJson({...pkg,files:[]},entries),'PACKAGE_ENTRY_NOT_LISTED');
});
