import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {unpackStaticPackage} from '../../plugins/craftmine-world/package-zip.mjs';
const {CoreClient}=createRequire(import.meta.url)('../../plugins/craftmine-world/core-client.cjs');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const pins={building:'351f4774db7a9c9fb8154bd79b96609267b15f7b3de05f52341b3629278766d5',road:'3144cb5dedd450677282045f9aae9d78dbea84989fe940e55888b4b722537314'};

// Explicit fixture setup before any desktop process exists. No source/world writes.
export async function seedCatalogArchives({root,out,profile,binary,assertActive=()=>{}}){
 const inputs=path.join(out,'catalog-input');fs.mkdirSync(inputs);
 const data=path.join(profile,'plugins/data/craftmine.world');fs.mkdirSync(data,{recursive:true});
 const core=new CoreClient(binary,data),records=[];
 try{
  await core.start();
  for(const kind of ['building','road']){
   assertActive();const bytes=fs.readFileSync(path.join(root,'docs/evidence/gu6-kenney-modules-20260912',kind+'.zip'));
   assert.equal(hash(bytes),pins[kind]);const decoded=unpackStaticPackage(bytes);
   const originalPath=path.join(inputs,kind+'.zip');fs.writeFileSync(originalPath,bytes);
   const result=await core.call('asset.import',{operationId:'catalog-fixture-'+kind,sourceRoot:inputs,sourcePath:originalPath,assetId:'gu6-catalog-'+kind,version:1,kind:'object',mediaKind:'package',path:kind+'.zip',mediaType:'application/zip',displayName:'Kenney '+kind,source:{origin:'https://github.com/KenneyNL/Starter-Kit-City-Builder',author:'Kenney; Craftmine trial adapter',license:'Source declarations and original license bytes inside audited ZIP',licenseStatus:'unverified'},tags:['Kenney','source-package',kind]});
   const read=await core.call('asset.read',{assetId:result.assetId,version:result.version});
   assert.equal(read.version_.contentHash,result.contentHash);assert.equal(read.version_.files.length,1);assert.equal(read.version_.files[0].sha256,pins[kind]);
   // Only delete the freshly written test input, never the checked-in archive.
   assert.equal(path.dirname(path.resolve(originalPath)),path.resolve(inputs));fs.unlinkSync(originalPath);assert.equal(fs.existsSync(originalPath),false);
   records.push({kind,ref:{assetId:result.assetId,version:result.version,contentHash:result.contentHash},zipSha256:pins[kind],innerResources:decoded.resources.map(r=>({assetId:r.manifest.content.assetId,version:r.manifest.content.version,contentHash:r.contentHash})),sourceDownloadRemoved:true,setupImport:result,savedVersion:read});
  }
 }finally{await core.stop();}
 return {format:'craftmine.catalog-source-fixture/1',scope:'Explicit real core catalog import while desktop is stopped; not UI or model import',coreSha256:hash(fs.readFileSync(binary)),records};
}

export function assertCatalogSourceBinding(expected,receipt){
 assert.deepEqual(receipt.catalogRef,expected.ref,'outer catalog identity must be returned unchanged');
 assert.equal(receipt.archiveSha256,expected.zipSha256,'ZIP identity is distinct from catalog identity');
 assert.equal(receipt.applied,false,'source import is not formal adoption');
 for(const field of ['blobPath','archiveBase64','context','host','sourceProvenance','hostProvenance'])assert.equal(Object.hasOwn(receipt,field),false,'private field leaked: '+field);
}
