// S3: share-package hardening on top of the CP1 ZIP layer.
//
// The round-three dispatch requires the real package to refuse a same-version
// conflict and to keep credentials and private play progress out of a share
// package (creation-package plan sections 6.3 and 8). Both were missing: the
// importer let a later resource win and the exporter copied any payload path.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  assertShareablePath,
  packStaticPackage,
  uniqueAssetVersions,
  unpackStaticPackage,
} from '../../../plugins/craftmine-world/package-zip.mjs';
import {contentHash} from '../../../plugins/craftmine-world/package-format.mjs';

const sha=(bytes)=>createHash('sha256').update(bytes).digest('hex');
const throwsCode=(run,code)=>assert.throws(run,error=>error instanceof Error&&(error.message===code||error.message.startsWith(code+': ')),`expected ${code}`);

function resource({assetId,version,kind,payloads,dependencies=[]}){
  const files=payloads.map(({path,bytes})=>({path,bytes:bytes.length,sha256:sha(bytes)}));
  const content={assetId,version,kind,files,dependencies,entry:{},interfaces:{},compatibility:{},state:{},licenses:{}};
  return {
    manifest:{format:'craftmine.resource/1',content,contentHash:contentHash(content)},
    files:Object.fromEntries(payloads.map(entry=>[entry.path,entry.bytes])),
  };
}

const chest=()=>resource({assetId:'chest',version:1,kind:'object',
  payloads:[{path:'scenes/chest.tscn',bytes:Buffer.from('[gd_scene format=3]\n')}]});

test('a share package round-trips with the new checks in place',()=>{
  const bytes=packStaticPackage({root:{id:'chest',version:1},resources:[chest()]});
  const unpacked=unpackStaticPackage(bytes);
  assert.equal(unpacked.resources.length,1);
  assert.equal(unpacked.resources[0].manifest.content.assetId,'chest');
});

test('credentials and private progress are refused at export',()=>{
  for(const path of ['config/.env','auth/credentials.json','keys/signing.pem','state/progress.json',
    'state/chunks/0.json','saves/slot1.json','.git/config','id_ed25519']){
    throwsCode(()=>assertShareablePath(path),'PACKAGE_PRIVATE_FILE_REFUSED');
  }
  const leaky=resource({assetId:'chest',version:1,kind:'object',
    payloads:[{path:'state/progress.json',bytes:Buffer.from('{"visited":3}\n')}]});
  throwsCode(()=>packStaticPackage({root:{id:'chest',version:1},resources:[leaky]}),'PACKAGE_PRIVATE_FILE_REFUSED');
});

test('a same-version conflict is refused instead of letting a later entry win',()=>{
  const first=chest();
  const second=resource({assetId:'chest',version:1,kind:'object',
    payloads:[{path:'scenes/chest.tscn',bytes:Buffer.from('[gd_scene format=3]\n# changed\n')}]});
  assert.notEqual(first.manifest.contentHash,second.manifest.contentHash);
  throwsCode(()=>packStaticPackage({root:{id:'chest',version:1},resources:[first,second]}),'PACKAGE_VERSION_CONFLICT');
  throwsCode(()=>uniqueAssetVersions([
    {assetId:'chest',version:1,contentHash:first.manifest.contentHash},
    {assetId:'chest',version:1,contentHash:second.manifest.contentHash},
  ],(entry)=>entry),'PACKAGE_VERSION_CONFLICT');
});

test('an identical duplicate collapses to one resource',()=>{
  const one=chest();
  const bytes=packStaticPackage({root:{id:'chest',version:1},resources:[one,chest()]});
  const unpacked=unpackStaticPackage(bytes);
  assert.equal(unpacked.resources.length,1);
});

test('a payload path is validated even when it is listed in the manifest',()=>{
  const nested=resource({assetId:'chest',version:1,kind:'object',
    payloads:[{path:'data/.git/config',bytes:Buffer.from('[core]\n')}]});
  throwsCode(()=>packStaticPackage({root:{id:'chest',version:1},resources:[nested]}),'PACKAGE_PRIVATE_FILE_REFUSED');
});
