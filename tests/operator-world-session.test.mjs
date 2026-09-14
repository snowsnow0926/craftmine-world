import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {confirmOperatorWorldSession,operatorWorldSessionExpectation,retainedOperatorTemplateState,worldSessionReadScript} from './helpers/operator-world-session.mjs';

function fixture(states,options={}){
  let index=0,starts=0,timeouts=0,reads=0;
  const current=()=>states[Math.min(index,states.length-1)];
  const access={worldId:'new-world',excludedSessionId:'old-session',
    until:async(read,ready)=>{for(let i=0;i<8;i++){const value=await read();if(ready(value))return value;index++;}throw Error('FIXTURE_NOT_READY');},
    readUi:async()=>{reads++;return {restoring:false,startReady:false,...current().ui};},
    readBinding:async()=>{if(current().error)throw current().error;return {worldId:'new-world',sessionId:null,...current().binding};},
    startCreation:async()=>{starts++;},onReadTimeout:()=>{timeouts++;},...options};
  return {run:()=>confirmOperatorWorldSession(access),counts:()=>({index,starts,timeouts,reads})};
}
test('waits through old DOM selection and missing then exact new-world host binding',async()=>{
  const f=fixture([{ui:{sessionId:'old-session'}},{ui:{sessionId:'old-session'},binding:{sessionId:'new-session'}},{ui:{sessionId:'new-session'},binding:{sessionId:'new-session'}}]);
  assert.equal((await f.run()).sessionId,'new-session');assert.equal(f.counts().index,2);assert.equal(f.counts().starts,0);
});
test('rejects actual host binding to the old template session',async()=>{
  await assert.rejects(fixture([{ui:{sessionId:'old-session'},binding:{sessionId:'old-session'}}]).run(),/TEMPLATE_COPY_REQUIRES_INDEPENDENT_SESSION/);
});
test('rejects wrong host world and genuine cold session change',async()=>{
  await assert.rejects(fixture([{binding:{worldId:'other'}}]).run(),/WORLD_SESSION_BOUND_WORLD_CHANGED/);
  await assert.rejects(fixture([{ui:{sessionId:'new-session'},binding:{sessionId:'new-session'}}],{expectedSessionId:'expected'}).run(),/COLD_REOPEN_SESSION_CHANGED/);
});
test('does not accept selection changed during host lookup',async()=>{
  let uiReads=0;const f=fixture([{binding:{sessionId:'new-session'}}],{readUi:async()=>({sessionId:++uiReads===1?'new-session':'other-session'})});
  await assert.rejects(f.run(),/FIXTURE_NOT_READY/);
});
test('ordinary Start creating dispatched at most once, never while restoring',async()=>{
  const f=fixture([{ui:{startReady:true,restoring:true}},{ui:{startReady:true}},{ui:{startReady:true}},{ui:{sessionId:'new-session'},binding:{sessionId:'new-session'}}]);
  assert.equal((await f.run()).sessionId,'new-session');assert.equal(f.counts().starts,1);
});
test('retries only recognized read timeout and preserves unknown errors',async()=>{
  const f=fixture([{error:Error('Craftmine Rust request timed out')},{ui:{sessionId:'new-session'},binding:{sessionId:'new-session'}}]);
  assert.equal((await f.run()).sessionId,'new-session');assert.equal(f.counts().timeouts,1);
  await assert.rejects(fixture([{error:Error('PERMISSION_DENIED')}]).run(),/PERMISSION_DENIED/);
  await assert.rejects(fixture([{ui:{error:'Actual conversation failure'}}]).run(),/Actual conversation failure/);
});
test('recovers only exact unfinished template copy without accepting stale report session',()=>{
  const original={worldId:'new-world',sessionId:'old-session',lastTemplateCopy:{oldWorldId:'old-world',oldSessionId:'old-session',newWorldId:'new-world'}};
  assert.deepEqual(operatorWorldSessionExpectation(original),{expectedSessionId:undefined,excludedSessionId:'old-session',pendingCopy:true});
  assert.equal(original.sessionId,'old-session');
  assert.equal(operatorWorldSessionExpectation({...original,worldId:'other-world'}).expectedSessionId,'old-session');
  assert.equal(operatorWorldSessionExpectation({...original,sessionId:'confirmed',lastTemplateCopy:{...original.lastTemplateCopy,newSessionId:'confirmed'}}).expectedSessionId,'confirmed');
});

// Relevant retained fields from actual NUWiAc continuation-b542fc58. No source
// snapshot, transcript, provider configuration or credential belongs here.
function interruptedCopy(){
  const sourceRef={assetId:'player.world.049f1cb914454f1296bfd534371a0d5d',version:1,contentHash:'c6afda3d03dc9f2b0ac84c6d59baff5e392a59f5dbfc2b18022c696e4777c952'};
  const archiveSha256='ae9424ff822f8bb028bbdf91888568ea71d965367306a6946096c14d9562481e';
  return {worldId:'world-a256ef707e46',sessionId:'caea7779-96d0-45a7-81a7-8439f4e0c90e',sourceTemplate:'library',turns:[],
    commands:[{id:'097-create-repaired-template-copy',status:'failed',error:'TEMPLATE_COPY_REQUIRES_INDEPENDENT_SESSION'}],
    worldCreation:{mode:'ordinary-world-template-create',sourceRef,archiveSha256,sourceWorldId:'world-2cf1e2b6b77e'},
    lastTemplateCopy:{sourceRef,archiveSha256,title:'Retained copy',oldWorldId:'world-2cf1e2b6b77e',oldSessionId:'caea7779-96d0-45a7-81a7-8439f4e0c90e',newWorldId:'world-a256ef707e46'},worldTransitions:[]};
}
test('actual report constructor retains b542 copy identity through waitWorld bootstrap',async()=>{
  const previous=interruptedCopy(),before=JSON.stringify(previous),driver=fs.readFileSync(new URL('./product-agent-operator-native.mjs',import.meta.url),'utf8');
  const constructor=driver.slice(driver.indexOf('const report={'),driver.indexOf('\nconst reportFile='));
  const waitWorld=driver.slice(driver.indexOf('async function waitWorld(){'),driver.indexOf('\nasync function setup'));
  const worldId=previous.worldId,newSession='8575e46b-0857-42e5-958a-4ebebb736b80';let reads=0,starts=0,saved=0;
  const context=vm.createContext({previous,previousFile:'continuation-b542.json',randomUUID:()=> 'test',out:'test',applicationRoot:'test',resources:'test',codex:null,providerConfig:null,sourceTemplate:'library',
    retainedOperatorTemplateState,operatorWorldSessionExpectation,confirmOperatorWorldSession,worldSessionReadScript,
    until:async(read,ready)=>{for(let i=0;i<8;i++){const value=await read();if(ready(value))return value;}throw Error('BOOTSTRAP_NOT_READY');},
    readOperatorInitializingRuntime:async()=>({worldId,instanceId:'native-existing'}),
    rpc:async()=>({worldId,ready:true}),workbench:async()=>{},recordInitializationReadTimeout:()=>{},
    evaluate:async()=>({sessionId:++reads===1?previous.sessionId:newSession,restoring:false}),
    nav:async(method,args)=>{assert.equal(method,'world.conversation');assert.equal(args.worldId,worldId);assert.equal(args.sessionId,undefined);assert.equal(args.action,undefined);return {worldId,sessionId:newSession};},
    submit:async()=>{starts++;},invoke:async(method)=>{assert.equal(method,'notificationSetViewingSession');},save:()=>{saved++;}});
  vm.runInContext(constructor+'\n'+waitWorld,context);await vm.runInContext('waitWorld()',context);
  const report=vm.runInContext('report',context);assert.equal(report.sessionId,newSession);assert.equal(report.lastTemplateCopy.newSessionId,newSession);
  assert.equal(report.commands[0].status,'failed');assert.equal(JSON.stringify(previous),before);assert.notEqual(report.lastTemplateCopy,previous.lastTemplateCopy);assert.notEqual(report.worldTransitions,previous.worldTransitions);
  assert.equal(starts,0);assert.equal(saved,1);
});
test('retained recovery rejects mismatched ref, archive or source world',()=>{
  for(const mutate of [p=>p.worldCreation.sourceWorldId='other',p=>p.worldCreation.sourceRef={...p.worldCreation.sourceRef,version:2},p=>p.worldCreation.archiveSha256='b'.repeat(64)]){
    const previous=interruptedCopy();mutate(previous);assert.throws(()=>retainedOperatorTemplateState(previous),/TEMPLATE_COPY_RECOVERY/);
  }
});
