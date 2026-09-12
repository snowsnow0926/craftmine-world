import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {createHash} from 'node:crypto';
import {createCreationGroundMaintenance,creationGroundCheckFailure,interruptsCreationGroundMaintenance} from '../electron/main/creation-ground-maintenance.ts';
import {CREATION_GROUND_OLD_PINS,CREATION_GROUND_CURRENT_PINS} from '../electron/main/creation-ground-upgrade.ts';
const resourcesRoot=path.resolve(import.meta.dirname,'../../../../../desktop/godot');
const pin=(path,text)=>({path,sha256:createHash('sha256').update(text).digest('hex'),bytes:Buffer.byteLength(text)});
function fixture(settings={}){
 const calls=[],oldOid='a'.repeat(40),mainOid='d'.repeat(40),branchOid='b'.repeat(40),newOid='c'.repeat(40),worldId='retained-world';
 let files=[{path:'scripts/creation_world.gd',sha256:CREATION_GROUND_OLD_PINS[0],bytes:26575},pin('world/creation.json','precious authored entities'),pin('scripts/custom.gd','precious custom rules')];
 let branch=null,oid=branchOid,applied=false,patches=0,applies=0;
 const formal={worldId,baseId:'creation-sandbox',buildId:'old-build',contentOid:oldOid,files:structuredClone(files)};
 const instance={worldId,buildId:'old-build',instanceId:'live-instance'};
 const index=()=>({worldId,branchId:branch,revision:patches?3:2,manifestHash:patches?'2'.repeat(64):'1'.repeat(64),files:structuredClone(files),nextOffset:null,content:{repoId:'repo',branchId:branch,contentOid:oid}});
 const candidate=()=>({candidateId:'candidate',status:'ready',manifestHash:index().manifestHash,content:{repoId:'repo',branchId:branch,contentOid:oid}});
 const domain=async(method,args)=>{calls.push({method,args});switch(method){
  case 'content.status':return {backend:'git',repoId:'repo',headOid:mainOid,appliedOid:applied?newOid:oldOid};
  case 'godotRuntime.describe':return {baseId:'creation-sandbox'};
  case 'godotRuntime.exportSource':return applied?{...formal,buildId:'new-build',contentOid:newOid,files:structuredClone(files)}:structuredClone(formal);
  case 'content.branch.create':if(branch)throw Error('already exists');branch=args.branchId;assert.equal(args.fromRev,oldOid);return {branchId:branch};
  case 'content.branch.list':return {branches:[{name:'refs/heads/'+branch,oid}]};
  case 'turn.begin':case 'workspace.endTurn':return {};
  case 'godotProject.index':assert.equal(args.branchId,branch);assert.notEqual(args.branchId,'main');return index();
  case 'godotProject.patch':assert.equal(args.operation.branchId,branch);assert.notEqual(args.operation.branchId,'main');assert.equal(args.operation.expectedHeadOid,branchOid);assert.equal(args.operations.length,1);files=files.map(f=>f.path===args.operations[0].path?pin(f.path,args.operations[0].text):f);oid=newOid;patches++;if(settings.lostPatchReply)throw Error('reply lost');return index();
  case 'godotCandidate.list':return {items:[]};
  case 'godotBuild.start':assert.equal(args.branchId,branch);return {jobId:'checked-job'};
  case 'godotBuild.read':settings.onBuildRead?.();return settings.holdBuild?{status:'running'}:settings.buildFails?{status:'failed',errorCode:'PARSE_FAILED'}:{status:'passed',candidateId:'candidate'};
  case 'godotBuild.cancel':return {status:'cancelled'};
  case 'godotCandidate.read':return {candidate:settings.wrongCandidate?{...candidate(),content:{...candidate().content,branchId:'main'}}:candidate()};
  default:throw Error('unexpected '+method);
 }};
 const service=createCreationGroundMaintenance({domain,selection:async()=>worldId,instance:()=>instance,resourcesRoot,pause:async()=>{},shouldYield:()=>settings.playerWork===true,applyVerified:async(world,id,expected,authorize)=>{
  assert.deepEqual(expected,{buildId:'old-build',instanceId:'live-instance'});
  if(settings.branchChanges)files.push(pin('unreviewed.txt','changed after check'));
  await authorize();applies++;applied=true;instance.buildId='new-build';return {status:'applied'};
 }});
 return {service,worldId,calls,get patches(){return patches;},get applies(){return applies;},get files(){return files;}};
}
test('formal maintenance applies from separate branch even with newer main draft; preserves authored files',async()=>{const f=fixture();const result=await f.service.start(f.worldId);assert.equal(result.status,'applied');assert.equal(f.patches,1);assert.equal(f.applies,1);assert.equal(f.files[0].sha256,CREATION_GROUND_CURRENT_PINS[0]);assert.deepEqual(f.files.slice(1),[pin('world/creation.json','precious authored entities'),pin('scripts/custom.gd','precious custom rules')]);assert.equal(f.calls.at(-1).method,'workspace.endTurn');assert.equal(f.calls.at(-1).args.status,'completed');});
test('lost patch reply recovers only after complete expected manifest is present',async()=>{const f=fixture({lostPatchReply:true});assert.equal((await f.service.start(f.worldId)).status,'applied');assert.equal(f.patches,1);});
test('passed candidate from a different branch cannot apply',async()=>{const f=fixture({wrongCandidate:true});await assert.rejects(f.service.start(f.worldId),/CANDIDATE_MISMATCH/);assert.equal(f.applies,0);assert.equal(f.calls.at(-1).args.status,'error');});
test('changed maintenance content between check and apply is rejected',async()=>{const f=fixture({branchChanges:true});await assert.rejects(f.service.start(f.worldId),/SOURCE_CHANGED/);assert.equal(f.applies,0);});
test('failed check keeps old formal and main; retry reuses branch without re-patching',async()=>{const options={buildFails:true},f=fixture(options);await assert.rejects(f.service.start(f.worldId),/PARSE_FAILED/);assert.equal(f.applies,0);options.buildFails=false;assert.equal((await f.service.start(f.worldId)).status,'applied');assert.equal(f.patches,1);});
test('concurrent starts coalesce; applied current content makes later starts a no-op',async()=>{const f=fixture(),first=f.service.start(f.worldId);assert.equal(f.service.start(f.worldId),first);await first;assert.deepEqual(await f.service.start(f.worldId),{worldId:f.worldId,status:'skipped',reason:'already-current'});assert.equal(f.applies,1);});
test('shutdown cancellation terminates the owned build and closes its turn',async()=>{const options={holdBuild:true},f=fixture(options);let stopped;options.onBuildRead=()=>{stopped=f.service.stopAll();};await assert.rejects(f.service.start(f.worldId),/CANCELLED/);await stopped;assert.equal(f.applies,0);assert.equal(f.service.busy,false);const cancel=f.calls.find(c=>c.method==='godotBuild.cancel');assert.equal(cancel.args.jobId,'checked-job');assert.ok(cancel.args.context.turnId);assert.equal(f.calls.at(-1).method,'workspace.endTurn');assert.equal(f.calls.at(-1).args.status,'aborted');});
test('failed checks retain precise errors and available failed-assertion detail',()=>{assert.equal(creationGroundCheckFailure({reason:'GODOT_CHECK_FOCUS_LEAK'}),'GODOT_CHECK_FOCUS_LEAK');assert.equal(creationGroundCheckFailure({output:{check:{error:'GODOT_CHECK_FOCUS_LEAK'}}}),'GODOT_CHECK_FOCUS_LEAK');assert.match(creationGroundCheckFailure({output:{check:{assertions:[{id:'runtime.frame',passed:false,detail:'frames=0'}]}}}),/runtime.frame: frames=0/);});
test('only exactly owned completion bypasses ordinary creation dispatch; ownership survives finish',async()=>{const f=fixture();await f.service.start(f.worldId);const context=f.calls.find(c=>c.method==='godotBuild.start').args.context;assert.equal(f.service.ownsCompletion({jobId:'checked-job',context}),true);assert.equal(f.service.ownsCompletion({jobId:'other-job',context}),false);for(const key of ['projectId','sessionId','turnId'])assert.equal(f.service.ownsCompletion({jobId:'checked-job',context:{...context,[key]:'forged'}}),false);assert.equal(f.service.ownsCompletion({jobId:'checked-job',context:{...context,extra:true}}),false);});
test('ordinary player work preempts background check through normal cancellation',async()=>{const options={holdBuild:true},f=fixture(options);options.onBuildRead=()=>{options.playerWork=true;};await assert.rejects(f.service.start(f.worldId),/PLAYER_WORK_STARTED/);assert.equal(f.applies,0);assert.ok(f.calls.some(c=>c.method==='godotBuild.cancel'));assert.equal(f.calls.at(-1).args.status,'aborted');});
test('mount reconciliation and same-world reopening do not interrupt maintenance',()=>{for(const channel of ['godot.candidateClose','godot.candidateState','godot.candidateList','godot.candidateRead','world.open','world.switch'])assert.equal(interruptsCreationGroundMaintenance(channel,{id:'a',worldId:'a'},'a'),false,channel);for(const channel of ['world.create','world.copy','godot.exportWindows','godot.candidatePreview','godot.candidateApply'])assert.equal(interruptsCreationGroundMaintenance(channel,{},'a'),true,channel);assert.equal(interruptsCreationGroundMaintenance('world.open',{id:'b'},'a'),true);});
