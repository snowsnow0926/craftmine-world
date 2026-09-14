// Read-only validation of the actual play-144..169 run, never input dispatch.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const out=path.resolve(process.argv[2]??'');
assert(path.basename(out).startsWith('desktop-native-product-'),'ACTUAL_OPERATOR_EVIDENCE_REQUIRED');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),rows=[],results=new Map();
const petId='ins-41d4d88059c4ba486b108f6e-e0',planeId='ins-1f469382cd78cdfa61ee927d-e0';
const expectedBuild='gbd-5eca401ecb43674379b3ba8eba42d16a1dbb8300fd93b5b9ab2631bfe2fd2a76';
const allowed=new Set(['status','snapshot','resume','explore','input-segment','save','capture','reopen']);
for(let n=144;n<=169;n++){
 const id='play-'+n,file=path.join(out,'responses',id+'.json'),bytes=fs.readFileSync(file),r=JSON.parse(bytes),q=JSON.parse(fs.readFileSync(path.join(out,'inbox',id+'.json')));
 assert.equal(r.id,id);assert.equal(r.status,'completed');assert.equal(r.command,q.command);assert(allowed.has(q.command));results.set(n,r.result);
 const row={id,command:q.command,file,sha256:sha(bytes),startedAt:r.startedAt,finishedAt:r.finishedAt};
 if(q.command==='input-segment'){
  const v=r.result;assert.equal(v.status,'completed');assert.equal(v.identity.buildId,expectedBuild);assert.equal(v.release.released,true);
  const released=v.release.receipt??v.delivery;assert.deepEqual(released.held,{keys:[],buttons:[]});assert.deepEqual(released.guard,{pointerLock:0,focus:0});assert.equal(v.operatorCheckpoint.continuousHumanPlay,false);assert(v.operatorCheckpoint.receipt.snapshotHash);
  for(const phase of ['before','during','after']){
   const observed=v[phase].observation;assert.equal(observed.payload.player.onFloor,true);assert.equal(observed.payload.controllerEvidence.body.layer,8);assert.equal(observed.payload.controllerEvidence.body.mask,3);assert.equal(observed.payload.progressCollisionGuard.status,'passed');
  }
  row.segment=q.args.segment;row.body=v.operatorCheckpoint.snapshot.state.body;row.frames=[];
  for(const phase of ['before','during','after']){const frame=v[phase].frame;assert.equal(sha(fs.readFileSync(frame.file)),frame.sha256);row.frames.push({phase,file:frame.file,sha256:frame.sha256});}
 }
 if(q.command==='capture'){assert.equal(sha(fs.readFileSync(r.result.file)),r.result.sha256);row.frame=r.result;}
 rows.push(row);
}
const body=n=>results.get(n).operatorCheckpoint?.snapshot.state.body??results.get(n).state.body;
const initial=body(145),pet=n=>body(n).components[petId],position=n=>body(n).player.position;
assert.equal(results.get(144).status.status.isRunning,false);assert.equal(results.get(169).status.status.isRunning,false);
for(const row of rows.filter(row=>row.body)){
 for(const key of ['inventory','openedChests','doors','rules','sourceTimeOfDay','timeOfDay'])assert.deepEqual(row.body[key],initial[key],row.id+':preserve-'+key);
 assert.deepEqual(row.body.components[planeId],initial.components[planeId],row.id+':complete-aircraft-retention');
 assert.equal(row.body.player.onFloor,true);assert(Math.abs(row.body.player.position[1]-initial.player.position[1])<.01);
 assert.deepEqual(row.body.components[petId].sourceSettings,initial.components[petId].sourceSettings);
}
assert.equal(initial.components[planeId].hasFlown,true);assert.equal(initial.components[planeId].landings,1);assert(Math.abs(initial.components[planeId].flightSeconds-4.6)<1e-9);
assert.equal(pet(145).settings.following,false);assert.deepEqual(pet(148),pet(145));assert.deepEqual(pet(149),pet(145));
const start=position(145),end=position(148),center=pet(145).position,v=[end[0]-start[0],end[2]-start[2]],offset=[center[0]-start[0],center[2]-start[2]];
const fraction=(v[0]*offset[0]+v[1]*offset[1])/(v[0]**2+v[1]**2),lineDistance=Math.abs(v[0]*offset[1]-v[1]*offset[0])/Math.hypot(...v);
const startDistance=Math.hypot(...offset),endDistance=Math.hypot(end[0]-center[0],end[2]-center[2]);
assert(fraction>0&&fraction<1&&lineDistance<.15&&startDistance>.75&&endDistance>.75,'ACTUAL_STRAIGHT_PET_CROSSING');
assert.equal(pet(152).interactionCount,pet(145).interactionCount+1);assert.equal(pet(152).settings.following,false);
assert.equal(pet(153).settings.following,true);assert.equal(pet(157).settings.following,true);
const distance=n=>Math.hypot(position(n)[0]-pet(n).position[0],position(n)[2]-pet(n).position[2]);
assert(pet(156).position[0]<pet(153).position[0]-2,'PET_ACTUALLY_MOVED_WITH_PLAYER');assert(distance(156)>4&&Math.abs(distance(157)-1.5)<.02,'FOLLOW_CONVERGED');
assert.equal(pet(158).settings.following,false);assert.deepEqual(pet(159),pet(158));assert.deepEqual(pet(160),pet(158));assert(position(160)[0]<position(158)[0]-5,'PLAYER_WALKED_AWAY_WHILE_PET_WAITED');
const cold=results.get(166);assert.equal(cold.before.buildId,expectedBuild);assert.equal(cold.after.buildId,expectedBuild);assert.notEqual(cold.before.instanceId,cold.after.instanceId);
assert.deepEqual(cold.savedSnapshot.state,cold.snapshot.state);assert.deepEqual(body(164),body(167));assert.deepEqual(body(167),cold.snapshot.state.body);
assert.deepEqual(body(167).inventory,initial.inventory);assert.deepEqual(body(167).components[planeId],initial.components[planeId]);
const observation=results.get(169).observation;assert.equal(observation.payload.city.districts,6);assert.equal(observation.payload.city.authoredBuildings,22);assert.equal(observation.payload.flightPreparation.collected,3);assert.equal(observation.payload.flightPreparation.audit.accessClearance.passed,true);
const operatorFile=path.join(out,'continuation-c599760d-d6b6-44e9-9abb-c5e25ea3ee40.json'),operator=JSON.parse(fs.readFileSync(operatorFile));
const builds=path.join(out,'profile/plugins/data/craftmine.world/godot-builds/fccc2e12f0d7bbf5000400f028f4fa12e95ebe0b5d277fac5f6a60001f5181c1');
const prior=JSON.parse(fs.readFileSync(path.join(builds,'gbd-8c52f3d3c74b77d80bb42250d8226e42df9e77d293101c977e0280e58681d98c/manifest.json'))),current=JSON.parse(fs.readFileSync(path.join(builds,expectedBuild,'manifest.json')));
assert.equal(current.sourceRevision,14);const priorFiles=new Map(prior.files.filter(f=>f.kind==='source').map(f=>[f.path,f.sha256]));
const changed=current.files.filter(f=>f.kind==='source'&&priorFiles.get(f.path)!==f.sha256);assert.deepEqual(changed.map(f=>f.path).sort(),['scripts/city_pet.gd','world/pet_contact_check_recovery.md','world/pet_contact_fix.md']);
for(const f of current.files.filter(f=>f.kind==='source'))assert.equal(sha(fs.readFileSync(path.join(builds,expectedBuild,'source',f.path))),f.sha256);
const sourceEvidence={sourceRevision:14,changedSourceFiles:changed,unchangedPlayerCityPlaneAndOriginalPetPackage:true,petScriptSha256:changed.find(f=>f.path==='scripts/city_pet.gd').sha256};
const oldLaunch=operator.launches.find(launch=>launch.audit);assert.equal(oldLaunch.exit.code,0);assert.deepEqual(oldLaunch.audit.violations,[]);assert.deepEqual(oldLaunch.audit.pageErrors,[]);assert.deepEqual(oldLaunch.audit.shutdownFailures,[]);
console.log(JSON.stringify({format:'craftmine.actual-pet-contact-evidence/1',verified:true,continuousHumanPlay:false,scope:'Actual packaged 76e8c0a9 normal-adopted rev14; original operator play-144..169',operatorFile,packageIdentity:operator.packageIdentity,binaries:operator.binaries,sourceEvidence,finalIdentity:results.get(168).identity,crossing:{start,end,center,fraction,lineDistance,startDistance,endDistance},following:{walkingDistance:distance(156),convergedDistance:distance(157)},cold:{before: cold.before.instanceId,after:cold.after.instanceId,buildId:expectedBuild,completeProgressEqual:true,normalExit:oldLaunch.exit,audit:oldLaunch.audit},finalProgress:results.get(167).state,finalCapture:results.get(168),limits:['分段真实虚拟输入与普通冻结存档，不代表连续帧时长或性能结论。','此轮没有主动撞墙/撞机或重新飞行；保留原几何/控制器源码及实际layer/mask和地面观察证据。','截取的是异步观测/原生帧和最终冻结快照，不把多个采样当成同一物理瞬间。','冷开后客户端留在冻结世界交还总控；后续退出/包最终封装验收由总控记录。'],raw:rows},null,2));
