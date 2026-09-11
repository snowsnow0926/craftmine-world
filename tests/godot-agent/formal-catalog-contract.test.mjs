import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {seedCatalogArchives,assertCatalogSourceBinding} from './formal-catalog-contract.mjs';
const {CoreClient}=createRequire(import.meta.url)('../../plugins/craftmine-world/core-client.cjs');
const root=path.resolve(import.meta.dirname,'../..'),binary=process.env.CRAFTMINE_CORE_BIN;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

test('real catalog fixture survives source download removal and a core restart',{skip:binary?false:'CRAFTMINE_CORE_BIN required'},async()=>{
 const out=fs.mkdtempSync(path.join(root,'test-results/catalog-seed-')),profile=path.join(out,'profile');fs.mkdirSync(profile);
 const result=await seedCatalogArchives({root,out,profile,binary});assert.equal(result.records.length,2);
 const core=new CoreClient(binary,path.join(profile,'plugins/data/craftmine.world'));
 try{
  await core.start();
  for(const record of result.records){
   assert.equal(fs.existsSync(path.join(out,'catalog-input',record.kind+'.zip')),false);
   const read=await core.call('asset.read',{assetId:record.ref.assetId,version:record.ref.version});assert.deepEqual(read,record.savedVersion);
   const file=read.version_.files[0],body=await core.call('asset.bodyPath',{assetId:record.ref.assetId,version:record.ref.version,path:file.path});
   assert.equal(hash(fs.readFileSync(body.blobPath)),record.zipSha256);
   assert.notEqual(record.ref.contentHash,record.zipSha256);
   assert.ok(record.innerResources.length>0);for(const resource of record.innerResources){assert.notEqual(resource.contentHash,record.ref.contentHash);assert.notEqual(resource.contentHash,record.zipSha256);}
  }
 }finally{await core.stop();}
});

test('catalog evidence cannot replace outer identity with ZIP or inner resource identity',()=>{
 const expected={ref:{assetId:'catalog-id',version:1,contentHash:'a'.repeat(64)},zipSha256:'b'.repeat(64)};
 const receipt={catalogRef:expected.ref,archiveSha256:expected.zipSha256,applied:false};assertCatalogSourceBinding(expected,receipt);
 for(const mutate of [v=>v.catalogRef.contentHash='b'.repeat(64),v=>v.catalogRef.assetId='inner-id',v=>v.archiveSha256='a'.repeat(64),v=>v.applied=true,v=>v.archiveBase64='hidden',v=>v.context={}]){
  const changed=structuredClone(receipt);mutate(changed);assert.throws(()=>assertCatalogSourceBinding(expected,changed));
 }
});
