import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {seedBuiltinSourceLibrary}=require('../plugins/craftmine-world/builtin-source-library.cjs');
const root=path.resolve('test-results');fs.mkdirSync(root,{recursive:true});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(){
  const directory=fs.mkdtempSync(path.join(root,'builtin-library-')),data=Buffer.from('fixed product package');
  const entry={assetId:'cw.nature.oak',version:1,kind:'object',file:'oak.zip',bytes:data.length,sha256:hash(data),label:'橡树',tags:['builtin','树'],source:{origin:'https://kenney.nl/assets/nature-kit',author:'Kenney',license:'CC0-1.0',licenseStatus:'verified'}};
  const write=entries=>fs.writeFileSync(path.join(directory,'catalog.json'),JSON.stringify({format:'craftmine.builtin-source-library/1',entries}));
  fs.writeFileSync(path.join(directory,entry.file),data);write([entry]);
  const records=new Map(),calls=[];
  const call=async(method,args)=>{calls.push({method,args});const key=args.assetId+'@'+args.version;
    if(method==='asset.read'){if(!records.has(key))throw Object.assign(Error('ASSET_NOT_FOUND'),{errorCode:'ASSET_NOT_FOUND'});return records.get(key);}
    assert.equal(method,'asset.import');records.set(key,{version_:{assetId:args.assetId,version:args.version,kind:args.kind,mediaKind:args.mediaKind,files:[{path:args.path,bytes:entry.bytes,sha256:entry.sha256,mediaType:args.mediaType}]}});return {status:'completed'};};
  return {directory,entry,write,records,calls,call};
}
test('seeds fixed packages through existing asset import and never writes a world',async()=>{
  const f=fixture(),result=await seedBuiltinSourceLibrary(f);
  assert.deepEqual(result.imported,[f.entry.assetId]);assert.deepEqual(result.conflicts,[]);
  const request=f.calls.find(x=>x.method==='asset.import').args;
  assert.equal(request.sourceRoot,fs.realpathSync(f.directory));assert.equal(request.sourcePath,path.join(fs.realpathSync(f.directory),'oak.zip'));
  assert.deepEqual(request.source,f.entry.source);assert.equal(request.mediaType,'application/x-godot-package');
  assert.ok(f.calls.every(x=>['asset.read','asset.import'].includes(x.method)));
});
test('restarting skips identical versions without duplicate import or metadata overwrite',async()=>{
  const f=fixture();await seedBuiltinSourceLibrary(f);f.calls.length=0;
  const result=await seedBuiltinSourceLibrary(f);assert.deepEqual(result.existing,[f.entry.assetId]);assert.equal(f.calls.length,1);
});
test('same identity with different existing bytes is preserved and reported',async()=>{
  const f=fixture();await seedBuiltinSourceLibrary(f);f.records.get(f.entry.assetId+'@1').version_.files[0].sha256='f'.repeat(64);f.calls.length=0;
  const before=structuredClone([...f.records]);const result=await seedBuiltinSourceLibrary(f);
  assert.equal(result.conflicts[0].reason,'BUILTIN_VERSION_CONFLICT');assert.deepEqual([...f.records],before);assert.equal(f.calls.length,1);
});
test('corrupt shipped bytes are rejected before any catalog mutation',async()=>{
  const f=fixture();fs.writeFileSync(path.join(f.directory,'oak.zip'),Buffer.alloc(f.entry.bytes));
  await assert.rejects(seedBuiltinSourceLibrary(f),/BUILTIN_PACKAGE_HASH_MISMATCH/);assert.deepEqual(f.calls,[]);
});
test('duplicate entries and traversal paths fail before touching the catalog',async()=>{
  for(const entries of [f=>[f.entry,f.entry],f=>[{...f.entry,file:'../oak.zip'}]]){
    const f=fixture();f.write(entries(f));await assert.rejects(seedBuiltinSourceLibrary(f),/BUILTIN_ENTRY/);assert.deepEqual(f.calls,[]);
  }
});
test('a catalog outage is never treated as a missing asset',async()=>{
  const f=fixture();f.call=async()=>{throw Error('DATABASE_UNAVAILABLE');};await assert.rejects(seedBuiltinSourceLibrary(f),/DATABASE_UNAVAILABLE/);
});
test('an import without the corresponding immutable version cannot claim success',async()=>{
  const f=fixture(),normal=f.call;f.call=async(method,args)=>method==='asset.import'?{status:'completed'}:normal(method,args);
  await assert.rejects(seedBuiltinSourceLibrary(f),/ASSET_NOT_FOUND/);
});
