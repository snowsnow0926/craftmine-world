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
export function inspectBuiltinDemoResume(prior,plan){
 assert.equal(prior.format,'craftmine.builtin-prefab-demo/1');assert.equal(prior.role,'developer-arranged-prefab-demo');assert.equal(prior.modelCalls,0);assert.equal(prior.creationEvaluation,false);assert.equal(typeof prior.worldId,'string');assert.deepEqual(prior.plan,plan);
 assert.ok(prior.launches.length>0);for(const launch of prior.launches)for(const field of ['violations','pageErrors','shutdownFailures'])assert.deepEqual(launch.audit?.[field],[],'Prior run must have exited cleanly');
 const complete=[];let failed=null;
 for(const record of prior.installations){
  if(record.applied?.status==='applied'){
   assert.equal(failed,null,'Only a completed prefix may be resumed');assert.equal(record.finished?.status,'passed');assert.equal(record.installed?.applied,false);assert.equal(record.index,complete.length);assert.equal(record.assetId,plan[record.index].assetId);assert.equal(record.applied.worldId,prior.worldId);complete.push(record);
  }else{assert.equal(failed,null);assert.equal(record.index,complete.length);assert.equal(record.installed,undefined,'An uncertain source write requires separate reconciliation');assert.match(prior.error,/PACKAGE_POSITION_REQUIRES_3D_NODE/);failed=record;}
 }
 assert.ok(complete.length>0&&failed,'This continuation is limited to the recorded pre-write placement failure');assert.ok(prior.initialSource?.items&&complete.at(-1).installed?.source);
 return {completed:complete,failed,source:complete.at(-1).installed.source,buildId:complete.at(-1).checked.candidate.buildId};
}
