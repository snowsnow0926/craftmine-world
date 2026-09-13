import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {buildApprovedPomeranianPackage,APPROVED_POMERANIAN_ID,APPROVED_POMERANIAN_SHA256} from '../desktop/build-approved-pomeranian-package.mjs';
import {unpackStaticPackage} from '../plugins/craftmine-world/package-zip.mjs';
import {loadBuiltinPackages,seedBuiltinSourceLibrary} from '../plugins/craftmine-world/builtin-source-library.cjs';
import {buildBuiltinSourceLibrary} from '../desktop/build-builtin-source-library.mjs';
const repository=path.resolve('.'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');

test('accepted package binds exact visual and behavior while staying under real source and ZIP limits',()=>{
  const built=buildApprovedPomeranianPackage({repository}),resource=unpackStaticPackage(built.bytes).resources[0];
  const {content}=resource.manifest;
  assert.equal(content.assetId,APPROVED_POMERANIAN_ID);assert.equal(content.version,1);
  assert.equal(sha(resource.files.get('model.glb')),APPROVED_POMERANIAN_SHA256);
  assert.equal(resource.files.get('model.glb').length,3753144);
  assert.ok(content.files.reduce((sum,file)=>sum+file.bytes,0)<4*1024*1024);assert.ok(built.bytes.length<5*1024*1024);
  assert.equal(content.entry.waiting.value,false);assert.equal(content.entry.waiting.resumeValue,true);
  assert.deepEqual(content.entry.capabilities,['follow-flat-ground','pet-interaction','wait','persistent-state','independent-instances']);
  assert.equal(content.entry.appearances[0].acceptedDemoAppearance,true);
  assert.equal(content.entry.lineage.model.regeneratedForLibrary,false);
  assert.equal(content.licenses.modelLicenseStatus,'unverified');
  assert.match(resource.files.get('companion.tscn').toString(),/appearance_key = "pomeranian-white"/);
  assert.ok(resource.files.has('companion.gd.uid'));
});

test('fixed model and playable package have distinct catalog classifications and source versions',async()=>{
  const output=fs.mkdtempSync(path.join(repository,'test-results/approved-catalog-'));
  buildBuiltinSourceLibrary({output});const {entries}=loadBuiltinPackages(output);
  const model=entries.find(entry=>entry.assetId==='cw.model.approved-pomeranian');
  const component=entries.find(entry=>entry.assetId===APPROVED_POMERANIAN_ID);
  assert.equal(model.mediaKind,'model');assert.equal(model.kind,'object');assert.equal(model.sha256,APPROVED_POMERANIAN_SHA256);
  assert.equal(component.kind,'module');assert.notEqual(model.sha256,component.sha256);
  const rows=new Map(),calls=[];
  const call=async(method,args)=>{
    calls.push({method,args});const key=args.assetId+'@'+args.version;
    if(method==='asset.read'){if(!rows.has(key))throw Object.assign(Error('missing'),{errorCode:'ASSET_NOT_FOUND'});return rows.get(key);}
    assert.equal(method,'asset.import');const bytes=fs.readFileSync(args.sourcePath);
    rows.set(key,{version_:{assetId:args.assetId,version:args.version,kind:args.kind,mediaKind:args.mediaKind,files:[{path:args.path,sha256:sha(bytes),bytes:bytes.length,mediaType:args.mediaType}]}});
  };
  await seedBuiltinSourceLibrary({directory:output,call});
  const imported=calls.find(call=>call.method==='asset.import'&&call.args.assetId===model.assetId).args;
  assert.equal(imported.mediaType,'model/gltf-binary');assert.equal(imported.source.licenseStatus,'unverified');
  assert.equal((await seedBuiltinSourceLibrary({directory:output,call})).imported.length,0);
});
