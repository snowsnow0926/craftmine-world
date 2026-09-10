// Pure coordinator fault injection. No claims of Rust, native launch or executor attestation.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {createHash} from 'node:crypto';
const source=stripTypeScriptTypes(fs.readFileSync('vendor/pi-desktop/apps/desktop/electron/main/godot-candidate-coordinator.ts','utf8'),{mode:'transform'});
const {createGodotCandidateCoordinator}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const clone=x=>JSON.parse(JSON.stringify(x)),hash=x=>createHash('sha256').update(x).digest('hex');
function fixture(){
 const events=[],records=new Map();let selected='alpha',fault='',sequence=0;
 const formal={id:'alpha',revision:3,world:{build:{id:'build-old'},snapshot:{format:'craftmine.godot-progress/1',worldId:'alpha',baseId:'first-person',body:{coins:4,quests:{one:1}}}}};
 let latest=clone(formal.world.snapshot),pending=null;
 const host={instance:{worldId:'alpha',buildId:'build-old',instanceId:'original'},candidateInstance:null,
  async holdSelectionSync(){events.push('hold');return()=>events.push('release');},async pause(){events.push('pause');},async resume(){events.push('resume');},
  async stageCandidate(descriptor){events.push('stage');if(fault==='load')throw Error('bad launch');this.candidateInstance={worldId:'alpha',buildId:descriptor.buildId,instanceId:'candidate-'+(++sequence)};pending=clone(descriptor.snapshot);},
  async candidateRequest(op){events.push('candidate:'+op);if(op!=='save')return {};const state=clone(pending);if(fault==='state')state.body.coins++;const snapshotText=JSON.stringify(state);return {status:'confirmed',state,runnerReceipt:{format:'craftmine.godot-runner-receipt/1',...this.candidateInstance,snapshotText,snapshotSha256:hash(snapshotText),bytes:Buffer.byteLength(snapshotText)}};},
  setCandidateVisible(v){events.push('candidate-visible:'+v);},setSurfaceVisible(v){events.push('surface:'+v);},
  async discardCandidate(){events.push('discard');pending=null;this.candidateInstance=null;},
  async checkpoint(){events.push('checkpoint');if(fault==='storage')return {status:'failed',error:'storage failed'};formal.world.snapshot=clone(latest);formal.revision++;return {status:'persisted',receipt:{revision:formal.revision},snapshot:clone(latest)};},
  async promoteCandidate(descriptor){events.push('promote');this.instance=this.candidateInstance;this.candidateInstance=null;pending=null;}
 };
 const adapter={async describe(){events.push('describe-formal');return {phase:'formal',worldId:'alpha',buildId:formal.world.build.id,revision:formal.revision,snapshot:clone(formal.world.snapshot)};},async describeCandidate(worldId,id){events.push('describe-candidate');if(fault==='descriptor')throw Error('artifact missing');const r=records.get(id);return {phase:'candidate',worldId,buildId:r.buildId,applicationId:id,applicationInputHash:r.inputHash,revision:formal.revision,snapshot:clone(formal.world.snapshot)};}};
 const domain=async(method,args)=>{
  events.push(method);
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
   const r=records.get(args.id);r.status='applied';r.output=clone(args.evidence);formal.world.build.id='build-new';formal.revision++;
   if(['commit-lost','commit-unreachable','foreign-receipt'].includes(fault))throw Error('commit response lost');return clone(r);
  }
  if(method==='world.read')return clone(formal);
  throw Error('unknown '+method);
 };
 const coordinator=createGodotCandidateCoordinator({host,adapter,domain,selection:async()=>selected});
 const args={worldId:'alpha',candidateId:'candidate-a'};
 return {coordinator,args,events,host,formal,records,setFault:v=>fault=v,setLatest:v=>latest.body.coins=v,mutatePreview:()=>pending.body.coins=999,setSelection:v=>selected=v};
}
test('preview independently stages without writing formal state and cancel retains original native identity',async()=>{const f=fixture();await f.coordinator.invoke('godot.candidatePreview',f.args);f.mutatePreview();assert.equal(f.formal.world.snapshot.body.coins,4);assert.ok(!f.events.includes('checkpoint'));await f.coordinator.invoke('godot.candidateClose',{worldId:'alpha'});assert.equal(f.host.instance.instanceId,'original');assert.ok(!f.events.includes('promote'));assert.equal(f.coordinator.blocking,false);});
test('apply discards played preview, checkpoints latest formal state and launches fresh exact state before commit',async()=>{const f=fixture();await f.coordinator.invoke('godot.candidatePreview',f.args);f.mutatePreview();f.setLatest(27);const result=await f.coordinator.invoke('godot.candidateApply',f.args);assert.equal(result.status,'applied');assert.equal(result.record.world.snapshot.body.coins,27);assert.equal(f.host.instance.instanceId,'candidate-2');assert.equal(f.events.filter(x=>x==='stage').length,2);assert.ok(f.events.indexOf('godotApplication.commit')<f.events.indexOf('promote'));});
for(const fault of ['descriptor','load','state','prepare'])test('preview '+fault+' failure retains original and releases locks',async()=>{const f=fixture();f.setFault(fault);await assert.rejects(f.coordinator.invoke('godot.candidatePreview',f.args));assert.equal(f.host.instance.instanceId,'original');assert.equal(f.coordinator.blocking,false);assert.ok(!f.events.includes('promote'));});
for(const fault of ['storage','commit-before'])test('apply '+fault+' failure never replaces formal instance',async()=>{const f=fixture();await f.coordinator.invoke('godot.candidatePreview',f.args);f.setFault(fault);await assert.rejects(f.coordinator.invoke('godot.candidateApply',f.args));assert.equal(f.host.instance.instanceId,'original');assert.equal(f.formal.world.build.id,'build-old');assert.equal(f.coordinator.blocking,false);});
test('lost committed reply is recovered by matching original receipt without second commit',async()=>{const f=fixture();await f.coordinator.invoke('godot.candidatePreview',f.args);f.setFault('commit-lost');const result=await f.coordinator.invoke('godot.candidateApply',f.args);assert.equal(result.status,'applied');assert.equal(f.events.filter(x=>x==='godotApplication.commit').length,1);assert.equal(f.events.filter(x=>x==='promote').length,1);});
test('unknown commit keeps both instances paused; later read reconciles exact commit once',async()=>{const f=fixture();await f.coordinator.invoke('godot.candidatePreview',f.args);f.setFault('commit-unreachable');await assert.rejects(f.coordinator.invoke('godot.candidateApply',f.args),/recovery pending/);assert.equal(f.host.instance.instanceId,'original');assert.ok(f.host.candidateInstance);assert.equal(f.coordinator.blocking,true);assert.equal(f.events.at(-1),'surface:false');f.setFault('');const result=await f.coordinator.invoke('godot.candidateState',f.args);assert.equal(result.status,'applied');assert.equal(f.events.filter(x=>x==='godotApplication.commit').length,1);});
test('foreign committed instance proof cannot authorize promotion',async()=>{const f=fixture();await f.coordinator.invoke('godot.candidatePreview',f.args);f.setFault('foreign-receipt');await assert.rejects(f.coordinator.invoke('godot.candidateApply',f.args),/recovery pending/);assert.equal(f.host.instance.instanceId,'original');assert.ok(!f.events.includes('promote'));});
test('page cannot supply token/evidence/snapshot or target another world',async()=>{const f=fixture();for(const extra of ['token','evidence','snapshot'])await assert.rejects(f.coordinator.invoke('godot.candidatePreview',{...f.args,[extra]:'forged'}),/INVALID/);await assert.rejects(f.coordinator.invoke('godot.candidatePreview',{...f.args,worldId:'beta'}),/WORLD_CHANGED/);});
test('lost panel reply recovers the completed exact candidate and never a different candidate',async()=>{const f=fixture();await f.coordinator.invoke('godot.candidatePreview',f.args);await f.coordinator.invoke('godot.candidateApply',f.args);const recovered=await f.coordinator.invoke('godot.candidateState',f.args);assert.equal(recovered.status,'applied');assert.equal((await f.coordinator.invoke('godot.candidateState',{...f.args,candidateId:'other'})).status,'closed');assert.equal((await f.coordinator.invoke('godot.candidateClose',{worldId:'alpha'})).status,'closed');assert.equal(f.events.filter(x=>x==='godotApplication.commit').length,1);});
