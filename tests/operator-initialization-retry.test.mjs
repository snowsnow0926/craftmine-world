import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {validateOperatorRetryProfile,assertRetainedInitializationRecovery,initializationRetryUiScript,initializationRecoveryMode,waitForRetryStartup,retryStartupStatusReady,initializationEntryUiScript,prepareAndEnterRetainedWorld} from './helpers/operator-initialization-retry.mjs';

test('controller ready with zero windows waits for a real hidden window and available host/plugin',async()=>{
  const safe={visible:false,focused:false,focusable:false,offscreen:true};
  const samples=[{violations:[],windows:[],runtime:{hostAvailable:false,plugins:[]}},
    {violations:[],windows:[safe],runtime:{hostAvailable:false,plugins:[]}},
    {violations:[],windows:[safe],runtime:{hostAvailable:true,plugins:[]}},
    {violations:[],windows:[safe],runtime:{hostAvailable:true,plugins:['craftmine.world']}}];
  let reads=0;const result=await waitForRetryStartup({readStatus:async()=>samples[reads++],until:async(read,accept)=>{for(;;){assert(reads<samples.length);const value=await read();if(accept(value))return value;}}});
  assert.equal(reads,4);assert.deepEqual(result,samples[3]);
});
test('unsafe windows or violations reject even while the backend is still starting',()=>{
  const base={violations:[],windows:[{visible:false,focused:false,focusable:false,offscreen:true}],runtime:{hostAvailable:false,plugins:[]}};
  for(const [field,value] of [['visible',true],['focused',true],['focusable',true],['offscreen',false]]){const status=structuredClone(base);status.windows[0][field]=value;assert.throws(()=>retryStartupStatusReady(status),/UNSAFE/);}
  assert.throws(()=>retryStartupStatusReady({...base,windows:[],violations:['focus']}),/VIOLATIONS/);
});

function ui(options={}){
  let count=0;const button={disabled:!!options.disabled,getClientRects:()=>options.hidden?[]:[{}],closest:()=>options.inert?{}:null,...(options.missingHandler?{}:{__reactProps$fixture:{onClick:()=>{count++;}}})};
  const row={dataset:{worldRecovery:options.otherWorld?'other':'world-fixture'},textContent:'Initialization cancelled',querySelectorAll:()=>options.duplicateButtons?[button,button]:[button],querySelector:()=>({textContent:'Initialization cancelled'})};
  return {get count(){return count;},context:{__craftmineHeadless:!options.unowned,getComputedStyle:()=>({visibility:'visible'}),document:{querySelectorAll:()=>options.duplicateRows?[row,row]:[row]}}};
}
test('owned visible retry uses exactly the installed React callback with no event simulation',()=>{
  const f=ui();const read=vm.runInNewContext(initializationRetryUiScript('world-fixture'),f.context);assert.equal(read.ready,true);assert.equal(f.count,0);
  assert.equal(vm.runInNewContext(initializationRetryUiScript('world-fixture',true),f.context).submitted,true);assert.equal(f.count,1);
});
test('unknown world, duplicate/hidden/inert/disabled controls and wrong owner cannot dispatch retry',()=>{
  for(const options of [{otherWorld:true},{duplicateRows:true},{duplicateButtons:true},{hidden:true},{inert:true},{disabled:true},{missingHandler:true},{unowned:true}]){const f=ui(options);assert.throws(()=>vm.runInNewContext(initializationRetryUiScript('world-fixture',true),f.context));assert.equal(f.count,0);}
});
test('only ready means recovered at startup; initializing requires an explicit preparation action, never a retry click',()=>{
  assert.equal(initializationRecoveryMode({state:'ready'},{ready:true}),'already-ready-at-startup');
  assert.equal(initializationRecoveryMode({state:'initializing'},{ready:false}),'ordinary-continue-preparation');
  for(const state of ['failed','cancelled','interrupted']){assert.equal(initializationRecoveryMode({state},{ready:true}),'ordinary-react-retry');assert.equal(initializationRecoveryMode({state},{ready:false}),null);}
  assert.equal(initializationRecoveryMode(undefined,{ready:true}),null);
});
test('readiness polling is reached only after the actual preparation callback; mutations are each invoked once',async()=>{
  const calls=[];let preparationStarted=false;
  const result=await prepareAndEnterRetainedWorld({mode:'ordinary-continue-preparation',continuePreparation:async()=>{calls.push('continue-handler');preparationStarted=true;},retry:async()=>{throw Error('no retry for initializing');},waitReady:async()=>{assert(preparationStarted,'a list read cannot start initialization');calls.push('confirm-ready');},enter:async()=>{calls.push('open-handler');return {worldId:'world-fixture'};}});
  assert.equal(result.worldId,'world-fixture');assert.deepEqual(calls,['continue-handler','confirm-ready','open-handler']);
  calls.length=0;await prepareAndEnterRetainedWorld({mode:'ordinary-react-retry',continuePreparation:async()=>{throw Error('no continue for terminal');},retry:async()=>calls.push('retry-handler'),waitReady:async()=>calls.push('confirm-ready'),enter:async()=>calls.push('open-handler')});assert.deepEqual(calls,['retry-handler','confirm-ready','open-handler']);
});
test('existing continue and open callbacks are identity-bound; absent or disabled preparation is not fabricated',()=>{
  const calls=[],form={dataset:{worldOpen:'world-fixture'},getClientRects:()=>[{}],closest:()=>null,querySelector:()=>null,__reactProps$f:{onSubmit:event=>{event.preventDefault();calls.push('open');}}};
  const button={dataset:{worldContinue:'world-fixture'},getClientRects:()=>[{}],closest:()=>null,disabled:false,__reactProps$b:{onClick:()=>calls.push('continue')}};
  const context={__craftmineHeadless:true,getComputedStyle:()=>({visibility:'visible'}),document:{querySelector:()=>({}),querySelectorAll:selector=>selector==='[data-world-open]'?[form]:[button]}};
  assert.equal(vm.runInNewContext(initializationEntryUiScript('world-fixture','continue'),context).submitted,'continue');
  assert.equal(vm.runInNewContext(initializationEntryUiScript('world-fixture','open'),context).submitted,'open');assert.deepEqual(calls,['continue','open']);
  button.disabled=true;assert.throws(()=>vm.runInNewContext(initializationEntryUiScript('world-fixture','continue'),context),/UNAVAILABLE/);
  assert.throws(()=>vm.runInNewContext(initializationEntryUiScript('other-world','open'),context),/UNAVAILABLE/);assert.deepEqual(calls,['continue','open']);
  context.document.querySelector=()=>null;context.document.querySelectorAll=()=>[];
  const state=vm.runInNewContext(initializationEntryUiScript('world-fixture'),context);assert.equal(state.entryOpen,false);assert.equal(state.openCount,0);
});
function profile(options={}){
  const parent=path.resolve('test-results');fs.mkdirSync(parent,{recursive:true});const top=fs.mkdtempSync(path.join(parent,'retry-profile-contract-')),owner=path.join(top,'test-results','desktop-native-product-fixture'),directory=path.join(owner,'profile'),worldId='world-fixture';
  fs.mkdirSync(path.join(directory,'godot-worlds',worldId),{recursive:true});fs.mkdirSync(path.join(owner,'legacy'));
  fs.writeFileSync(path.join(directory,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token:'fixture',legacySource:options.foreignLegacy?top:path.join(owner,'legacy')}));
  fs.writeFileSync(path.join(directory,'godot-worlds',worldId,'.creation-owner.json'),JSON.stringify({worldId:options.foreignWorld?'other':worldId,baseId:'creation-sandbox',templateId:'blank'}));
  const report={format:'craftmine.product-agent-operator/1',out:owner,error:'Retained initialization timeout',normalShutdown:!options.running,finalIntegrity:{status:'passed'},turns:options.modelTurns?[{turnId:'model'}]:[]};
  const file=path.join(owner,'report.json');fs.writeFileSync(file,JSON.stringify(report));
  if(options.activeContinuation)fs.writeFileSync(path.join(owner,'continuation-new.json'),JSON.stringify({...report,normalShutdown:undefined}));
  return {file,worldId,owner};
}
test('stopped zero-model operator profile is accepted without editing its report or world ownership',()=>{
  const f=profile(),before=fs.readFileSync(f.file);const result=validateOperatorRetryProfile(f.file,f.worldId);assert.equal(result.owner,f.owner);assert.match(result.originalReportSha256,/^[a-f0-9]{64}$/);assert.deepEqual(fs.readFileSync(f.file),before);
});
test('active controller, prior model turns, other world or foreign legacy root rejects before launch',()=>{
  for(const options of [{running:true},{modelTurns:true},{foreignWorld:true},{foreignLegacy:true},{activeContinuation:true}]){const f=profile(options);assert.throws(()=>validateOperatorRetryProfile(f.file,f.worldId));}
});
function receipts(){
  const before={source:{revision:2,manifestHash:'a'.repeat(64),files:[{path:'stock.gd',sha256:'b'.repeat(64)}]},managed:{manifestSha256:'c'.repeat(64),files:[]},chat:{messageIds:[],turnIds:[]},init:{id:'init',world_id:'world-fixture',status:'drafting'},jobs:[],candidates:[],applications:[]};
  const job={id:'check-new',world_id:'world-fixture',kind:'check',status:'passed',build_id:'build',manifest_hash:before.source.manifestHash,source_revision:2,output_hash:'d'.repeat(64)};
  const after={...structuredClone(before),init:{...before.init,status:'confirmed',application_id:'apply'},jobs:[job],candidates:[{id:'candidate',world_id:'world-fixture',status:'applied',build_id:'build',manifest_hash:job.manifest_hash,source_revision:2,check_job_id:job.id,check_output_hash:job.output_hash}],applications:[{id:'apply',world_id:'world-fixture',candidate_id:'candidate',build_id:'build',status:'applied',output_hash:'e'.repeat(64)}]};
  return {before,after};
}
test('only new actual check and its applied candidate/application validate recovery with preserved source and chat',()=>{
  const f=receipts();assert.equal(assertRetainedInitializationRecovery(f.before,f.after,'world-fixture').job.id,'check-new');
});
test('ready prose, stale job, wrong output/candidate/application, changed source or new model turn cannot masquerade as recovery',()=>{
  const mutations=[f=>{f.after.init.status='drafting';},f=>{f.before.jobs=[f.after.jobs[0]];},f=>{f.after.jobs[0].status='queued';},f=>{f.after.jobs[0].output_hash=null;},f=>{f.after.candidates[0].check_output_hash='f'.repeat(64);},f=>{f.after.applications[0].candidate_id='other';},f=>{f.after.applications[0].status='prepared';},f=>{f.after.source.revision++;},f=>{f.after.managed.manifestSha256='f'.repeat(64);},f=>{f.after.chat.turnIds=['unexpected'];}];
  for(const change of mutations){const f=receipts();change(f);assert.throws(()=>assertRetainedInitializationRecovery(f.before,f.after,'world-fixture'));}
});
