import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {newConversationUiScript,prepareOperatorNewConversation,recheckOperatorNewConversation,confirmNewConversationBinding} from './helpers/operator-new-conversation.mjs';
import {assertOperatorProvider} from './helpers/operator-provider-config.mjs';

function page(options={}) {
  let called=0;
  const button={disabled:!!options.disabled,getAttribute:()=> 'New task',getClientRects:()=>options.hidden?[]:[{}],closest:()=>options.inert?{}:null,
    ...(options.noHandler?{}:{__reactProps$fixture:{onClick:()=>{called++;}}})};
  const context={__craftmineHeadless:options.owned!==false,getComputedStyle:()=>({visibility:'visible'}),document:{querySelector:selector=>selector==='[data-world-session]'?{dataset:{worldSession:options.sessionId??'old'}}:{innerText:options.draft??''},querySelectorAll:()=>options.duplicate?[button,button]:[button]}};
  return {context,get called(){return called;}};
}
test('owned ordinary New Task callback runs once without any session IPC or prompt dispatch',()=>{
  const f=page();const result=vm.runInNewContext(newConversationUiScript('old',true),f.context);
  assert.equal(result.dispatched,true);assert.equal(f.called,1);
});
test('wrong owner/session, hidden/inert/disabled/ambiguous button, missing callback and nonempty draft refuse before dispatch',()=>{
  for(const options of [{owned:false},{sessionId:'other'},{hidden:true},{inert:true},{disabled:true},{duplicate:true},{noHandler:true},{draft:'keep this'}]){
    const f=page(options);assert.throws(()=>vm.runInNewContext(newConversationUiScript('old',true),f.context));assert.equal(f.called,0);
  }
});

function fixture(options={}) {
  const report={worldId:'world',sessionId:'old',turns:[{turnId:'previous'}]};
  const sessions={old:{id:'old',projectPath:null,messages:[{id:'u1',role:'user',content:'Keep my tree'},{id:'a1',role:'assistant',content:'Tree created'}]},fresh:{id:'fresh',projectPath:null,messages:[]}};
  let selected='old',called=0,configError=options.configError??null;
  const snapshots=[];
  const access={report,persist:async()=>snapshots.push(structuredClone(report)),
    readUi:async()=>({sessionId:selected,composerText:'',ready:true}),
    submit:async()=>{called++;selected='fresh';if(options.submissionLost)throw Error('PAGE_CONNECTION_CLOSED');return {dispatched:true};},
    until:async(read,accept)=>{const state=await read();assert(accept(state));return state;},
    readSession:async id=>{const value=structuredClone(sessions[id]);if(selected==='fresh'&&id==='old'&&options.historyChanged)value.messages[0].content='changed';if(id==='fresh'&&options.nonempty)value.messages=[{id:'other'}];return value;},
    readState:async()=>({runtime:{worldId:'world',buildId:selected==='fresh'&&options.buildChanged?'other':'build',instanceId:'instance'},saved:{id:'world',title:'Tree world',contentHash:(selected==='fresh'&&options.savedChanged?'b':'a').repeat(64),revision:selected==='fresh'?2:1}}),
    assertIdle:async()=>{if(options.active)throw Error('NEW_CONVERSATION_REQUIRES_IDLE_AGENT');},
    assertModel:async id=>{if(id==='fresh'&&configError)throw Error(configError);return {model:'deepseek-flash',contextWindow:1000000,maxTokens:384000,thinkingLevel:'max',permissionMode:'auto'};},
  };
  return {report,access,sessions,snapshots,get called(){return called;},correctModel(){configError=null;}};
}
test('same-world new chat retains old message IDs/hash and source/save identity, remains unsent and unbound',async()=>{
  const f=fixture();const result=await prepareOperatorNewConversation({},f.access);
  assert.equal(f.called,1);assert.equal(f.report.sessionId,'fresh');assert.equal(result.sent,false);assert.equal(result.status,'ready-unsent');assert.equal(result.bindingStatus,'not-established');
  assert.deepEqual(result.before.oldMessages,result.after.oldMessages);assert.equal(f.report.turns[0].sessionId,'old');assert.equal(f.report.turns[0].worldId,'world');
  assert.equal(result.before.saved.contentHash,result.after.saved.contentHash);
});
test('active model or command overrides refuse without a UI mutation',async()=>{
  const active=fixture({active:true});await assert.rejects(prepareOperatorNewConversation({},active.access),/IDLE/);assert.equal(active.called,0);
  const f=fixture();for(const input of [{model:'other'},{worldId:'other'},{send:true},[],null])await assert.rejects(prepareOperatorNewConversation(input,f.access));assert.equal(f.called,0);
});
test('changed history (even same IDs), saved content, runtime build or a nonempty reused session cannot claim preservation',async()=>{
  for(const options of [{historyChanged:true},{savedChanged:true},{buildChanged:true},{nonempty:true}]){
    const f=fixture(options);await assert.rejects(prepareOperatorNewConversation({},f.access));assert.equal(f.report.sessionId,'fresh');assert.equal(f.report.pendingConversation.status,'failed-unsent');assert.equal(f.report.pendingConversation.sent,false);
  }
});
test('configuration failure retains actual selected new session and can be read-only rechecked after ordinary correction',async()=>{
  const f=fixture({configError:'SESSION_THINKING_CHANGED'});await assert.rejects(prepareOperatorNewConversation({},f.access),/THINKING/);
  assert.equal(f.report.sessionId,'fresh');assert.equal(f.report.pendingConversation.newSessionId,'fresh');assert.equal(f.report.pendingConversation.status,'failed-unsent');
  await assert.rejects(recheckOperatorNewConversation(f.access),/THINKING/);assert.equal(f.called,1);
  f.correctModel();await recheckOperatorNewConversation(f.access);assert.equal(f.called,1);assert.equal(f.report.pendingConversation.status,'ready-unsent');assert.match(f.report.pendingConversation.error,/THINKING/);assert.equal(f.report.pendingConversation.bindingStatus,'not-established');
});
test('lost selection acknowledgement preserves actual new selected identity without dispatching again',async()=>{
  const f=fixture({submissionLost:true});await assert.rejects(prepareOperatorNewConversation({},f.access),/PAGE_CONNECTION_CLOSED/);
  assert.equal(f.report.sessionId,'fresh');assert.equal(f.report.pendingConversation.status,'failed-unsent');assert.equal(f.called,1);
  await recheckOperatorNewConversation(f.access);assert.equal(f.called,1);
});

test('only first accepted prompt with matching canonical task/world/project/session/turn confirms binding',async()=>{
  const f=fixture();const evidence=await prepareOperatorNewConversation({},f.access);
  const projectId='pi-'+createHash('sha256').update(JSON.stringify(['session','fresh'])).digest('hex');
  const input={session:f.sessions.fresh,turnId:'turn',conversation:{worldId:'world',sessionId:'fresh',taskId:'task'},task:{context:{world:{id:'world'},binding:{projectId,sessionId:'fresh',taskId:'task',turnId:'turn'}}}};
  assert.throws(()=>confirmNewConversationBinding(evidence,input),/ACCEPTED_PROMPT/);
  evidence.sent=true;evidence.firstMessageId='first';evidence.firstTurnId='turn';
  assert.equal(confirmNewConversationBinding(evidence,input).bindingStatus,'confirmed-after-first-prompt');
  assert.equal(confirmNewConversationBinding({...evidence,status:'accepted-binding-unconfirmed'},input).bindingStatus,'confirmed-after-first-prompt');
  for(const field of ['projectId','sessionId','taskId','turnId']){const changed=structuredClone(input);changed.task.context.binding[field]='other';assert.throws(()=>confirmNewConversationBinding(evidence,changed));}
  const noTask=structuredClone(input);delete noTask.conversation.taskId;assert.throws(()=>confirmNewConversationBinding(evidence,noTask),/DURABLE_TASK/);
  const world=structuredClone(input);world.task.context.world.id='other';assert.throws(()=>confirmNewConversationBinding(evidence,world),/TASK_WORLD/);
  assert.throws(()=>confirmNewConversationBinding({...evidence,status:'failed-unsent'},input),/NOT_READY/);
});

test('real provider validator rejects model/context/output/thinking/permission changes for a new session',()=>{
  const config={model:'deepseek-flash',baseUrl:'https://api.deepseek.com/',contextWindow:1000000,maxTokens:384000,thinkingLevel:'max'};
  const base={config,providerId:'provider',provider:{id:'provider',baseUrl:config.baseUrl,models:[{id:config.model,contextWindow:1000000,maxTokens:384000,defaultThinkingLevel:'max',thinkingLevels:['max'],supportsImages:true,supportsDocuments:true}]},settings:{worldAgentBackend:'pi',defaultProviderId:'provider',defaultModelId:config.model,defaultPermissionMode:'auto'},session:{id:'fresh',thinkingLevel:'max',permissionMode:'auto'}};
  assert.equal(assertOperatorProvider(base).effectivePermissionMode,'auto');
  for(const [field,value] of [['contextWindow',500000],['maxTokens',32000],['defaultThinkingLevel','off']]){const changed=structuredClone(base);changed.provider.models[0][field]=value;assert.throws(()=>assertOperatorProvider(changed));}
  for(const [field,value] of [['modelId','other'],['providerId','other'],['thinkingLevel','off'],['permissionMode','ask'],['worldAgentBackend','codex-cli']]){const changed=structuredClone(base);changed.session[field]=value;assert.throws(()=>assertOperatorProvider(changed));}
});
