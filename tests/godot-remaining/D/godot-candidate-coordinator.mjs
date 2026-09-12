// Pure coordinator fault injection. No claims of Rust, native launch or executor attestation.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const {createGodotCandidateCoordinator}=await import('../../../vendor/pi-desktop/apps/desktop/electron/main/godot-candidate-coordinator.ts');
const clone=x=>JSON.parse(JSON.stringify(x)),hash=x=>createHash('sha256').update(x).digest('hex');
function fixture({cold=false,formalBuild=!cold,git=false,paused=false}={}){
 const events=[],records=new Map();let selected='alpha',fault='',sequence=0,formalExists=formalBuild;
 const formal={id:'alpha',revision:3,world:{build:{id:'build-old'},snapshot:{format:'craftmine.godot-progress/1',worldId:'alpha',baseId:'first-person',body:{coins:4,quests:{one:1}}}}};
 let latest=clone(formal.world.snapshot),pending=null,frozen=null;
 const host={instance:cold?null:{worldId:'alpha',buildId:'build-old',instanceId:'original'},candidateInstance:null,paused,
  async holdSelectionSync(){events.push('hold');return()=>events.push('release');},async pause(){events.push('pause');this.paused=true;},async resume(){events.push('resume');this.paused=false;frozen=null;},
  async stageCandidate(descriptor,options){events.push(options?.first?'stage:first':'stage');if(fault.startsWith('load'))throw Error('bad launch');this.candidateInstance={worldId:'alpha',buildId:descriptor.buildId,instanceId:'candidate-'+(++sequence)};pending=clone(descriptor.snapshot);},
  async candidateRequest(op){events.push('candidate:'+op);if(op!=='save')return {};const state=clone(pending);if(fault==='state')state.body.coins++;const snapshotText=JSON.stringify(state);return {status:'confirmed',state,runnerReceipt:{format:'craftmine.godot-runner-receipt/1',...this.candidateInstance,snapshotText,snapshotSha256:hash(snapshotText),bytes:Buffer.byteLength(snapshotText)}};},
  setCandidateVisible(v){events.push('candidate-visible:'+v);},setSurfaceVisible(v){events.push('surface:'+v);},
  async discardCandidate(){events.push('discard');pending=null;this.candidateInstance=null;},
  async checkpoint(options={}){events.push('checkpoint');if(options.fresh)frozen=null;if(frozen)return clone(frozen);const prior=this.paused;await this.pause();if(fault==='storage'){if(!prior)await this.resume();return {status:'failed',error:'storage failed'};}formal.world.snapshot=clone(latest);formal.revision++;
   const receipt={worldId:'alpha',buildId:formal.world.build.id,revision:formal.revision};let snapshot=clone(latest);
   if(fault==='checkpoint-world')receipt.worldId='foreign';if(fault==='checkpoint-build')receipt.buildId='foreign';if(fault==='checkpoint-revision')receipt.revision++;
   if(fault==='checkpoint-snapshot')snapshot.body.coins++;if(fault==='checkpoint-instance')this.instance={...this.instance,instanceId:'replaced'};
   frozen={status:'persisted',receipt,snapshot};return clone(frozen);},
  async promoteCandidate(descriptor){events.push('promote');this.instance=this.candidateInstance;this.candidateInstance=null;pending=null;}
 };
 const adapter={async describe(){events.push('describe-formal');if(!formalExists)return null;return {phase:'formal',worldId:'alpha',buildId:formal.world.build.id,revision:formal.revision,snapshot:clone(formal.world.snapshot)};},async describeCandidate(worldId,id){events.push('describe-candidate');if(fault==='descriptor')throw Error('artifact missing');const r=records.get(id);return {phase:'candidate',worldId,buildId:r.buildId,applicationId:id,applicationInputHash:r.inputHash,revision:formal.revision,snapshot:clone(formal.world.snapshot)};}};
 const domain=async(method,args)=>{
  events.push(method);
  if(method==='godotWorld.initStatus')return {worldId:'alpha',initId:'init-alpha',playable:false,status:'checked',...(fault==='durable-failure'?{launchFailure:{applicationId:'old'}}:{})};
  if(method==='godotWorld.initLaunchFailed'){
   if(fault==='load-record-lost')throw Error('persistence unavailable');
   const record=records.get(args.applicationId);assert.equal(record.status,'aborted');assert.equal(record.candidateId,args.candidateId);assert.equal(args.initId,'init-alpha');
   if(fault==='load-record-foreign')return {recorded:true,cleared:false,...args,worldId:'other'};
   return {recorded:true,cleared:false,replayed:false,...args};
  }
  if(method==='godotCandidate.read')return {candidate:git?{content:{repoId:'repo',branchId:'main',contentOid:'new-content'}}:{},job:{check:{}}};
  if(method==='godotApplication.prepare'){
   if(fault==='prepare')throw Object.assign(Error('prepare invalid'),{errorCode:'INVALID'});
   const r={id:args.id,worldId:args.worldId,candidateId:args.candidateId,buildId:'build-new',inputHash:hash(args.id),status:'prepared',input:{revision:args.revision,snapshot:clone(args.snapshot)}};records.set(args.id,r);return clone(r);
  }
  if(method==='godotApplication.read'){
   if(fault==='unreachable'||fault==='commit-unreachable')throw Error('store transport unavailable');
   const r=records.get(args.id);if(!r)throw Object.assign(Error('missing'),{errorCode:'GODOT_APPLICATION_NOT_FOUND'});
   const result=clone(r);if(fault==='foreign-receipt')result.output.launch.instanceId='foreign';return result;
  }
  if(method==='godotApplication.abort'){const r=records.get(args.id);if(r.status==='prepared')r.status='aborted';return clone(r);}
  if(method==='godotApplication.commit'){
   if(fault==='commit-before')throw Error('commit before storage failed');
   const r=records.get(args.id);r.status='applied';r.output=clone(args.evidence);formal.world.build.id='build-new';formal.revision++;formalExists=true;
   if(['commit-lost','commit-unreachable','foreign-receipt'].includes(fault))throw Error('commit response lost');return clone(r);
  }
  if(method==='world.read')return clone(formal);
  if(method==='content.status')return git?{backend:'git',repoId:'repo',headOid:'new-content',appliedOid:'old-content'}:{backend:'legacy'};
  if(method==='content.apply.prepare')return {state:'prepared'};
  if(method==='content.apply.advance')return {state:'advanced'};
  if(method==='content.apply.confirm')return {state:'committed'};
  if(method==='content.operation.read')return {state:'advanced'};
  if(method==='content.apply.rollback')return {state:'aborted'};
  throw Error('unknown '+method);
 };
 const coordinator=createGodotCandidateCoordinator({host,adapter,domain,selection:async()=>selected});
 const args={worldId:'alpha',candidateId:'candidate-a'};
 return {coordinator,args,events,host,formal,records,setFault:v=>fault=v,setLatest:v=>latest.body.coins=v,setLatestBody:v=>latest.body=clone(v),readPreview:()=>clone(pending),mutatePreview:()=>pending.body.coins=999,setSelection:v=>selected=v};
}
test('saved maintenance verifies the unchanged durable snapshot in a fresh candidate without requiring the broken old runtime',async()=>{
 const f=fixture({cold:true,formalBuild:true,git:true}),snapshot=clone(f.formal.world.snapshot);let checks=0;
 f.host.resume=async()=>{throw Error('NO_RUNTIME_TO_RESUME');};
 const result=await f.coordinator.applySavedMaintenance('alpha','candidate-a',{buildId:'build-old',revision:3,snapshot},async()=>{checks++;});
 assert.equal(result.status,'applied');assert.deepEqual(f.formal.world.snapshot,snapshot);assert.ok(checks>=4);assert.ok(f.events.includes('stage:first'));assert.ok(!f.events.includes('checkpoint'));assert.equal(f.coordinator.blocking,false);
});
for(const fault of ['prepare','descriptor','load','state','commit-before'])test('saved maintenance '+fault+' failure rolls back without trying to resume a nonexistent old runtime',async()=>{
 const f=fixture({cold:true,formalBuild:true,git:true}),before=clone(f.formal);f.setFault(fault);f.host.resume=async()=>{throw Error('NO_RUNTIME_TO_RESUME');};
 await assert.rejects(f.coordinator.applySavedMaintenance('alpha','candidate-a',{buildId:'build-old',revision:3,snapshot:before.world.snapshot},async()=>{}),error=>!String(error).includes('NO_RUNTIME_TO_RESUME'));
 assert.deepEqual(f.formal,before);assert.equal(f.coordinator.blocking,false);assert.equal(f.host.instance,null);assert.ok(!f.events.includes('promote'));
});
test('saved maintenance refuses concurrent progress changes and cancellation before commit without restoring stale data',async()=>{
 const f=fixture({cold:true,formalBuild:true,git:true}),snapshot=clone(f.formal.world.snapshot);let checks=0;
 await assert.rejects(f.coordinator.applySavedMaintenance('alpha','candidate-a',{buildId:'build-old',revision:3,snapshot},async()=>{if(++checks===3)throw Error('PLAYER_CANCELLED');}),/PLAYER_CANCELLED/);
 assert.equal(f.formal.world.build.id,'build-old');assert.deepEqual(f.formal.world.snapshot,snapshot);assert.equal(f.coordinator.blocking,false);
 await assert.rejects(f.coordinator.applySavedMaintenance('alpha','candidate-a',{buildId:'build-old',revision:2,snapshot},async()=>{}),/SAVED_PROGRESS_CHANGED/);
 assert.equal(f.events.filter(x=>x==='godotApplication.commit').length,0);
});
test('preview checkpoints current progress without adopting content and cancel retains original native identity',async()=>{const f=fixture({git:true});await f.coordinator.invoke('godot.candidatePreview',f.args);f.mutatePreview();assert.equal(f.formal.world.snapshot.body.coins,4);assert.equal(f.events.filter(x=>x==='checkpoint').length,1);assert.equal(f.formal.world.build.id,'build-old');assert.ok(!f.events.includes('content.apply.prepare'));assert.ok(!f.events.includes('godotApplication.commit'));await f.coordinator.invoke('godot.candidateClose',{worldId:'alpha'});assert.equal(f.host.instance.instanceId,'original');assert.ok(!f.events.includes('promote'));assert.equal(f.coordinator.blocking,false);});
test('unsaved camera position and ordinary progress become the exact prepared preview input',async()=>{
 const f=fixture(),body={coins:23,quests:{one:2},player:{position:[0,0.9,10.83],yaw:0.3,pitch:0.05},inventory:{flowers:5}};
 f.setLatestBody(body);await f.coordinator.invoke('godot.candidatePreview',f.args);
 assert.deepEqual(f.readPreview().body,body);assert.deepEqual([...f.records.values()][0].input.snapshot.body,body);assert.deepEqual(f.formal.world.snapshot.body,body);
 assert.ok(f.events.indexOf('hold')<f.events.indexOf('checkpoint'));assert.ok(f.events.indexOf('checkpoint')<f.events.indexOf('pause'));assert.ok(f.events.indexOf('pause')<f.events.indexOf('godotApplication.prepare'));
 await f.coordinator.invoke('godot.candidateClose',{worldId:'alpha'});assert.deepEqual(f.formal.world.snapshot.body,body);assert.equal(f.formal.world.build.id,'build-old');
});
for(const paused of [false,true])test('preview checkpoint failure preserves prior '+(paused?'paused':'playing')+' intent without coordinator resume',async()=>{
 const f=fixture({paused});f.setFault('storage');await assert.rejects(f.coordinator.invoke('godot.candidatePreview',f.args),/storage failed/);
 assert.equal(f.host.paused,paused);assert.equal(f.events.filter(event=>event==='resume').length,paused?0:1);assert.equal(f.records.size,0);assert.equal(f.coordinator.blocking,false);
});
for(const fault of ['storage','checkpoint-world','checkpoint-build','checkpoint-revision','checkpoint-snapshot','checkpoint-instance'])test('preview '+fault+' refuses before candidate preparation and never restores stale progress',async()=>{
 const f=fixture();f.setLatest(29);f.setFault(fault);await assert.rejects(f.coordinator.invoke('godot.candidatePreview',f.args));
 assert.equal(f.records.size,0);assert.ok(!f.events.includes('stage'));assert.ok(!f.events.includes('godotApplication.prepare'));assert.ok(!f.events.includes('godotApplication.commit'));assert.equal(f.formal.world.build.id,'build-old');assert.equal(f.coordinator.blocking,false);assert.ok(f.events.includes('release'));
 assert.equal(f.formal.world.snapshot.body.coins,fault==='storage'?4:29);
});
test('apply discards played preview, checkpoints latest formal state and launches fresh exact state before commit',async()=>{const f=fixture();await f.coordinator.invoke('godot.candidatePreview',f.args);f.mutatePreview();f.setLatest(27);const result=await f.coordinator.invoke('godot.candidateApply',f.args);assert.equal(result.status,'applied');assert.equal(result.record.world.snapshot.body.coins,27);assert.equal(f.host.instance.instanceId,'candidate-2');assert.equal(f.events.filter(x=>x==='stage').length,2);assert.ok(f.events.indexOf('godotApplication.commit')<f.events.indexOf('promote'));});

test('automatic adoption checkpoints latest progress and never shows a preview',async()=>{
 const f=fixture();f.setLatest(39);let authorizations=0;
 const result=await f.coordinator.autoApplyVerified('alpha','candidate-a',{buildId:'build-old',instanceId:'original'},async()=>{authorizations++;});
 assert.equal(result.status,'applied');assert.equal(f.formal.world.snapshot.body.coins,39);
 assert.ok(authorizations>=5);assert.equal(f.events.filter(x=>x==='stage').length,1);
 assert.ok(!f.events.includes('candidate-visible:true'));assert.ok(f.events.indexOf('checkpoint')<f.events.indexOf('godotApplication.prepare'));
});
for(const fault of ['storage','load','state','commit-before'])test('automatic '+fault+' failure preserves formal build and latest progress',async()=>{
 const f=fixture();f.setLatest(41);f.setFault(fault);
 await assert.rejects(f.coordinator.autoApplyVerified('alpha','candidate-a',{buildId:'build-old',instanceId:'original'},async()=>{}));
 assert.equal(f.formal.world.build.id,'build-old');assert.equal(f.host.instance.instanceId,'original');assert.equal(f.coordinator.blocking,false);
 if(fault!=='storage')assert.equal(f.formal.world.snapshot.body.coins,41);
 assert.ok(!f.events.includes('promote'));
});
test('revoking consent after candidate launch aborts without replacing formal play',async()=>{
 const f=fixture();f.setLatest(42);
 await assert.rejects(f.coordinator.autoApplyVerified('alpha','candidate-a',{buildId:'build-old',instanceId:'original'},async()=>{if(f.events.includes('candidate:save'))throw Error('CONSENT_REVOKED');}),/CONSENT_REVOKED/);
 assert.equal(f.formal.world.build.id,'build-old');assert.equal(f.formal.world.snapshot.body.coins,42);assert.ok(!f.events.includes('godotApplication.commit'));assert.equal(f.coordinator.blocking,false);
});
test('automatic adoption rejects a foreign instance before touching runtime pause state',async()=>{
 const f=fixture();await assert.rejects(f.coordinator.autoApplyVerified('alpha','candidate-a',{buildId:'build-old',instanceId:'foreign'},async()=>{}),/TARGET_STALE/);
 assert.deepEqual(f.events,[]);assert.equal(f.coordinator.blocking,false);
});
test('cancellation after content advance rolls its pointer back before replacing the world',async()=>{
 const f=fixture({git:true});f.setLatest(43);
 await assert.rejects(f.coordinator.autoApplyVerified('alpha','candidate-a',{buildId:'build-old',instanceId:'original'},async()=>{if(f.events.includes('content.apply.advance'))throw Error('TURN_CANCELLED');}),/TURN_CANCELLED/);
 assert.ok(f.events.includes('content.apply.rollback'));assert.ok(!f.events.includes('godotApplication.commit'));
 assert.equal(f.formal.world.build.id,'build-old');assert.equal(f.formal.world.snapshot.body.coins,43);assert.equal(f.coordinator.blocking,false);
});
for(const fault of ['descriptor','load','state','prepare'])test('preview '+fault+' failure retains original and releases locks',async()=>{const f=fixture();f.setFault(fault);await assert.rejects(f.coordinator.invoke('godot.candidatePreview',f.args));assert.equal(f.host.instance.instanceId,'original');assert.equal(f.coordinator.blocking,false);assert.ok(!f.events.includes('promote'));});
for(const fault of ['storage','commit-before'])test('apply '+fault+' failure never replaces formal instance',async()=>{const f=fixture();await f.coordinator.invoke('godot.candidatePreview',f.args);f.setFault(fault);await assert.rejects(f.coordinator.invoke('godot.candidateApply',f.args));assert.equal(f.host.instance.instanceId,'original');assert.equal(f.formal.world.build.id,'build-old');assert.equal(f.coordinator.blocking,false);});
test('lost committed reply is recovered by matching original receipt without second commit',async()=>{const f=fixture();await f.coordinator.invoke('godot.candidatePreview',f.args);f.setFault('commit-lost');const result=await f.coordinator.invoke('godot.candidateApply',f.args);assert.equal(result.status,'applied');assert.equal(f.events.filter(x=>x==='godotApplication.commit').length,1);assert.equal(f.events.filter(x=>x==='promote').length,1);});
test('unknown commit keeps both instances paused; later read reconciles exact commit once',async()=>{const f=fixture();await f.coordinator.invoke('godot.candidatePreview',f.args);f.setFault('commit-unreachable');await assert.rejects(f.coordinator.invoke('godot.candidateApply',f.args),/recovery pending/);assert.equal(f.host.instance.instanceId,'original');assert.ok(f.host.candidateInstance);assert.equal(f.coordinator.blocking,true);assert.equal(f.events.at(-1),'surface:false');f.setFault('');const result=await f.coordinator.invoke('godot.candidateState',f.args);assert.equal(result.status,'applied');assert.equal(f.events.filter(x=>x==='godotApplication.commit').length,1);});
test('foreign committed instance proof cannot authorize promotion',async()=>{const f=fixture();await f.coordinator.invoke('godot.candidatePreview',f.args);f.setFault('foreign-receipt');await assert.rejects(f.coordinator.invoke('godot.candidateApply',f.args),/recovery pending/);assert.equal(f.host.instance.instanceId,'original');assert.ok(!f.events.includes('promote'));});
test('page cannot supply token/evidence/snapshot or target another world',async()=>{const f=fixture();for(const extra of ['token','evidence','snapshot'])await assert.rejects(f.coordinator.invoke('godot.candidatePreview',{...f.args,[extra]:'forged'}),/INVALID/);await assert.rejects(f.coordinator.invoke('godot.candidatePreview',{...f.args,worldId:'beta'}),/WORLD_CHANGED/);});
test('two overlapping page invokes cannot both enter the coordinator',async()=>{const f=fixture();const first=f.coordinator.invoke('godot.candidatePreview',f.args);const second=f.coordinator.invoke('godot.candidatePreview',f.args);await first;await assert.rejects(second,/WORLD_BUSY/);assert.equal(f.events.filter(x=>x==='stage').length,1);assert.equal((await f.coordinator.invoke('godot.candidateState',f.args)).status,'preview');await f.coordinator.invoke('godot.candidateClose',{worldId:'alpha'});assert.equal(f.coordinator.blocking,false);});
test('a completed candidate superseded by a later build reports closed instead of a mismatch',async()=>{const f=fixture();await f.coordinator.invoke('godot.candidatePreview',f.args);await f.coordinator.invoke('godot.candidateApply',f.args);f.formal.world.build.id='build-newer';f.formal.revision++;const result=await f.coordinator.invoke('godot.candidateState',f.args);assert.equal(result.status,'closed');});
test('lost panel reply recovers the completed exact candidate and never a different candidate',async()=>{const f=fixture();await f.coordinator.invoke('godot.candidatePreview',f.args);await f.coordinator.invoke('godot.candidateApply',f.args);const recovered=await f.coordinator.invoke('godot.candidateState',f.args);assert.equal(recovered.status,'applied');assert.equal((await f.coordinator.invoke('godot.candidateState',{...f.args,candidateId:'other'})).status,'closed');assert.equal((await f.coordinator.invoke('godot.candidateClose',{worldId:'alpha'})).status,'closed');assert.equal(f.events.filter(x=>x==='godotApplication.commit').length,1);});
test('first load confirms a world with no formal runtime and never requires a preview',async()=>{const f=fixture({cold:true});assert.equal(f.host.instance,null);const result=await f.coordinator.firstLoad(f.args.worldId,f.args.candidateId);assert.equal(result.status,'applied');assert.equal(f.host.instance.instanceId,'candidate-1');assert.ok(f.events.includes('stage:first'));assert.ok(!f.events.includes('checkpoint'));assert.ok(f.events.includes('release'),'selection hold must be released');assert.equal(f.coordinator.blocking,false);});
test('first load refuses a live instance for the same world and releases locks',async()=>{const f=fixture();await assert.rejects(f.coordinator.firstLoad(f.args.worldId,f.args.candidateId),/ALREADY_RUNNING/);assert.equal(f.coordinator.blocking,false);assert.equal(f.host.instance.instanceId,'original');});
test('first load refuses a world that already has a formal build but no live instance',async()=>{const f=fixture({cold:true,formalBuild:true});await assert.rejects(f.coordinator.firstLoad(f.args.worldId,f.args.candidateId),/FORMAL_WORLD_EXISTS/);assert.equal(f.coordinator.blocking,false);});

for(const fault of ['load','state'])test('first-load '+fault+' persists a finite identity-bound failure only after abort',async()=>{
 const f=fixture({cold:true});f.setFault(fault);await assert.rejects(f.coordinator.firstLoad(f.args.worldId,f.args.candidateId));
 assert.equal(f.coordinator.blocking,false);assert.equal(f.host.instance,null);
 assert.ok(f.events.indexOf('godotApplication.abort')<f.events.indexOf('godotWorld.initLaunchFailed'));
 assert.equal(f.events.filter(x=>x==='godotWorld.initLaunchFailed').length,1);
});
test('first-load preparation failure has no fabricated durable application failure',async()=>{
 const f=fixture({cold:true});f.setFault('prepare');await assert.rejects(f.coordinator.firstLoad(f.args.worldId,f.args.candidateId));
 assert.ok(!f.events.includes('godotWorld.initLaunchFailed'));
});
test('lost successful first-load commit reply is reconciled without recording failure',async()=>{
 const f=fixture({cold:true});f.setFault('commit-lost');assert.equal((await f.coordinator.firstLoad(f.args.worldId,f.args.candidateId)).status,'applied');
 assert.ok(!f.events.includes('godotWorld.initLaunchFailed'));
});
test('direct first-load entry refuses an uncleared durable failure',async()=>{
 const f=fixture({cold:true});f.setFault('durable-failure');await assert.rejects(f.coordinator.firstLoad(f.args.worldId,f.args.candidateId),/RETRY_REQUIRED/);
 assert.ok(!f.events.includes('godotApplication.prepare'));assert.ok(!f.events.includes('hold'));
});
for(const fault of ['load-record-lost','load-record-foreign'])test('failure persistence '+fault+' is explicitly unconfirmed',async()=>{
 const f=fixture({cold:true});f.setFault(fault);await assert.rejects(f.coordinator.firstLoad(f.args.worldId,f.args.candidateId),/FAILURE_RECORD_UNCONFIRMED/);
 assert.equal(f.host.instance,null);assert.ok(!f.events.includes('godotApplication.commit'));
});
