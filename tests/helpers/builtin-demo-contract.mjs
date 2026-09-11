import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {unpackStaticPackage} from '../../plugins/craftmine-world/package-zip.mjs';
export const BUILTIN_DEMO_PLAN=Object.freeze([
 {assetId:'cw.environment.natural-daylight',version:1},
 {assetId:'cw.nature.tree-oak',version:1,position:{x:-4,y:0,z:0}},
 {assetId:'cw.nature.tree-oak',version:1,position:{x:4.5,y:0,z:-1}},
 {assetId:'cw.castle.wall-doorway',version:1,position:{x:0,y:0,z:-4}},
 {assetId:'cw.castle.wall',version:1,position:{x:2.25,y:0,z:-4}},
]);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function readBuiltinDemoPackages(packagedRoot,plan=BUILTIN_DEMO_PLAN){
 return readBuiltinDemoCatalog(path.join(packagedRoot,'resources/plugins/craftmine.world/builtin-source-library'),plan);
}
export function readBuiltinDemoCatalog(directory,plan=BUILTIN_DEMO_PLAN){
 const file=path.join(directory,'catalog.json');
 const catalog=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(catalog.format,'craftmine.builtin-source-library/1');assert.ok(Array.isArray(catalog.entries)&&catalog.entries.length<=64);
 assert.ok(Array.isArray(plan)&&plan.length>=1&&plan.length<=8);
 return plan.map(request=>{
  assert.ok(Object.keys(request).every(k=>['assetId','version','position'].includes(k)));assert.equal(typeof request.assetId,'string');assert.equal(request.version,1);
  if(request.position){assert.deepEqual(Object.keys(request.position).sort(),['x','y','z']);assert.ok(Object.values(request.position).every(n=>Number.isFinite(n)&&Math.abs(n)<=80));}
  const entries=catalog.entries.filter(e=>e.assetId===request.assetId&&e.version===request.version);assert.equal(entries.length,1,'Exact shipped component required: '+request.assetId);const entry=entries[0];
  assert.match(entry.file,/^[a-z0-9._-]+\.zip$/);const source=path.join(directory,entry.file);assert.ok(fs.lstatSync(source).isFile()&&!fs.lstatSync(source).isSymbolicLink());const bytes=fs.readFileSync(source);assert.equal(bytes.length,entry.bytes);assert.equal(sha(bytes),entry.sha256);
  const archive=unpackStaticPackage(bytes,{maxEntryBytes:4*1024*1024,maxTotalBytes:6*1024*1024,maxCompressedBytes:6*1024*1024,maxEntries:1024});
  assert.equal(archive.packageJson.root.id,request.assetId);assert.equal(archive.packageJson.root.version,request.version);assert.equal(archive.packageJson.root.sha256,entry.rootContentHash);
  return {request,entry,source,bytes,archiveSha256:archive.archiveSha256};
 });
}
export function validateBuiltinDemoCall(method,fields,worldId){
 const none=['status','primaryMode','godotObserve','godotCaptureView','quit'];if(none.includes(method)){assert.ok(Object.keys(fields).every(k=>k==='payload'&&method==='primaryMode'));if(fields.payload)assert.deepEqual(fields.payload,{action:'create'});return;}
 if(method==='worldNavigation'){assert.ok(['world.createOptions','world.create','world.list'].includes(fields.channel));if(fields.channel==='world.create'){assert.equal(fields.payload.baseId,'creation-sandbox');assert.equal(fields.payload.starterId,'blank');}return;}
 if(method==='godotExplore'){assert.equal(fields.payload.worldId,worldId);assert.ok(fields.payload.steps.every(s=>['look','walk','wait'].includes(s.op)));return;}
 assert.equal(method,'worldPanel');assert.equal(fields.payload.worldId,worldId);
 if(fields.channel==='package.request'){assert.ok(['importSource','sourceJob','sourceList'].includes(fields.payload.method));assert.equal(fields.payload.params.worldId,worldId);return;}
 assert.ok(['godot.candidateList','godot.candidateRead','godot.candidatePreview','godot.candidateApply','godot.runtimeSave','godot.runtimeResume'].includes(fields.channel));
}
