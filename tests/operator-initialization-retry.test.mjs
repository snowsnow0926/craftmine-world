import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {validateOperatorRetryProfile,assertRetainedInitializationRecovery,initializationRetryUiScript,initializationRecoveryMode} from './helpers/operator-initialization-retry.mjs';

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
test('automatic startup completion or preparation never manufactures a retry click',()=>{
  for(const state of ['ready','initializing'])assert.equal(initializationRecoveryMode({state},{ready:true}),'automatic-startup-recovery');
  for(const state of ['failed','cancelled','interrupted']){assert.equal(initializationRecoveryMode({state},{ready:true}),'ordinary-react-retry');assert.equal(initializationRecoveryMode({state},{ready:false}),null);}
  assert.equal(initializationRecoveryMode(undefined,{ready:true}),null);
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
