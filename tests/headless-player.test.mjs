import test from 'node:test';import assert from 'node:assert/strict';
import {createHeadlessPlayer,unwrapPlayerDesktopResult} from '../vendor/pi-desktop/apps/desktop/electron/main/craftmine-headless-player.ts';
const config={format:'craftmine.player-config-snapshot/1',credentialsIncluded:false,modelId:'deepseek-v4.1-flash-expires-on-0910',thinkingLevel:'max',thinkingLevels:['medium','high','max','off'],contextWindow:1000000,maxTokens:384000,vendorKey:'deepseek',baseUrl:'https://api.deepseek.com',protocol:'openai_compatible',apiStyle:'chat_completions'};
config.mode='agent';config.permissionMode='inherit';config.modelBinding={id:config.modelId,contextWindow:config.contextWindow,maxTokens:config.maxTokens,thinkingLevels:config.thinkingLevels,defaultThinkingLevel:'max',supportsImages:true,supportsDocuments:true,availableForSubagents:true};
const identity={sessionId:'session-a',worldId:'world-a'};
test('ordinary UI result envelopes are unwrapped before session identity checks',async()=>{
 const session={id:identity.sessionId};
 const player=createHeadlessPlayer({
  invoke:async(channel,...args)=>unwrapPlayerDesktopResult({ok:true,data:channel==='providersCreate'?{provider:{id:'provider-a'}}:{session:channel==='sessionConfigure'?{...session,...args[1]}:session}}),
  panel:async()=>({}),observe:async()=>({worldId:identity.worldId}),active:()=>false,latest:async()=>null,
 });
 const result=await player('playerSetup',{...identity,config,secret:'fixture-key'});
 assert.equal(result.sessionId,identity.sessionId);assert.equal(result.modelId,config.modelId);
 assert.throws(()=>unwrapPlayerDesktopResult({ok:false,error:{code:'REJECTED',message:'Request rejected'}}),error=>error.code==='REJECTED');
 assert.throws(()=>unwrapPlayerDesktopResult({session}),/DESKTOP_RESULT_INVALID/);
});
function fixture(){
  const calls=[];let session={id:'session-a',mode:'agent',permissionMode:'auto',messages:[{id:'old-message'}]},active=false,worldId='world-a',metrics={usage:{totalTokens:123}},captureHook;
  const player=createHeadlessPlayer({invoke:async(channel,...args)=>{calls.push([channel,...args]);if(channel==='sessionGet')return {session};if(channel==='providersCreate')return {provider:{id:'isolated-provider'}};if(channel==='sessionConfigure'){session={...session,...args[1]};return {session};}if(channel==='sessionTurnMetrics')return metrics;if(channel==='agentPrompt'){active=true;return {accepted:true};}if(channel==='agentAbort'){active=false;return {ok:true};}return {};},panel:async(channel)=>{if(channel==='godot.creationTarget'){captureHook?.();return {worldId,captureId:'capture-a'};}return {status:'working'};},observe:async()=>({worldId,buildId:'build-a'}),active:()=>active,latest:async()=>({jobId:'job-a'})});
  return {player,calls,setWorld:value=>worldId=value,setMessages:value=>session.messages=value,setMetrics:value=>metrics=value,setActive:value=>active=value,onCapture:fn=>captureHook=fn};
}
test('ordinary setup preserves history while applying the complete selected model and permission',async()=>{
  const f=fixture(),result=await f.player('playerSetup',{...identity,config,secret:'fixture-key'});
  const create=f.calls.find(call=>call[0]==='providersCreate')[1];assert.equal(create.baseUrl,config.baseUrl);assert.deepEqual(create.models,[config.modelBinding]);
  assert.deepEqual(f.calls.find(call=>call[0]==='sessionConfigure').slice(1),['session-a',{mode:'agent',permissionMode:'inherit',providerId:'isolated-provider',modelId:config.modelId,thinkingLevel:'max'}]);
  assert.equal(result.permissionMode,'inherit');assert.equal(JSON.stringify(result).includes('fixture-key'),false);
  const state=await f.player('playerStatus',identity);assert.equal(state.record.session.messages[0].id,'old-message');assert.equal(state.metrics.usage.totalTokens,123);
});
test('prompt uses the normal renderer API and real capture; status and abort share its session',async()=>{
  const f=fixture();await f.player('playerSetup',{...identity,config,secret:'fixture-key'});
  const input={...identity,text:'继续按完整城市目标创造。',messageId:'new-message'};
  await f.player('playerPrompt',input);
  assert.deepEqual(f.calls.find(call=>call[0]==='agentPrompt')[1],{sessionId:'session-a',viewingSessionId:'session-a',messageId:'new-message',content:input.text,requestContext:{creationTarget:{captureId:'capture-a'}}});
  assert.equal((await f.player('playerStatus',identity)).active,true);assert.deepEqual(f.calls.filter(call=>call[0]==='sessionTurnMetrics').at(-1)[1],{sessionId:'session-a',messageId:'new-message'});await f.player('playerAbort',identity);
  await assert.rejects(f.player('playerPrompt',input),/ALREADY_SENT/);
});
test('wrong endpoints and missing source configuration cannot receive the secret',async()=>{
  for(const changed of [{baseUrl:'https://other.example'},{maxTokens:undefined},{thinkingLevels:[]},{credentialsIncluded:true}]){const f=fixture();await assert.rejects(f.player('playerSetup',{...identity,config:{...config,...changed},secret:'fixture-key'}));assert.equal(f.calls.some(call=>call[0]==='providersCreate'),false);}
});
test('identity changes, arbitrary methods and extra fields are rejected',async()=>{
  const f=fixture();await f.player('playerSetup',{...identity,config,secret:'fixture-key'});
  await assert.rejects(f.player('playerPrompt',{...identity,worldId:'other',text:'x',messageId:'a'}));
  await assert.rejects(f.player('execute',{...identity,script:'x'}));await assert.rejects(f.player('playerStatus',{...identity,budget:40}));
  f.setWorld('other');await assert.rejects(f.player('playerPrompt',{...identity,text:'x',messageId:'b'}),/WORLD_CHANGED/);
  await f.player('playerAbort',identity); // Cancellation remains possible after world navigation.
});

const failed={id:'failed-user',role:'user',content:'看看现在的城门效果。',status:'complete'},failedMetrics={sessionId:'session-a',turnId:'failed-turn',status:'error',endedAtMs:12345,calls:{pending:0}},retry={...identity,text:failed.content,messageId:'retry-user',failedMessageId:failed.id};
async function retryFixture(){const f=fixture();await f.player('playerSetup',{...identity,config,secret:'fixture-key'});f.setMessages([{id:'previous',role:'assistant',content:'原会话'},failed]);f.setMetrics(failedMetrics);return f;}
test('failed tail retry delegates exact normal truncate boundary and fresh capture without direct history mutation',async()=>{
 const f=await retryFixture(),result=await f.player('playerRetryFailedPrompt',retry);assert.equal(result.retryOf,'failed-user');assert.equal(result.failedTurnId,'failed-turn');
 assert.deepEqual(f.calls.find(c=>c[0]==='agentPrompt')[1],{sessionId:'session-a',viewingSessionId:'session-a',messageId:'retry-user',content:failed.content,truncateFromMessageId:'failed-user',requestContext:{creationTarget:{captureId:'capture-a'}}});
 assert.ok(f.calls.filter(c=>c[0]==='sessionTurnMetrics').every(c=>c[1].messageId==='failed-user'));assert.equal(f.calls.some(c=>/truncate|saveRevision|appendMessage/.test(c[0])),false,'Only ordinary agentPrompt owns revision archival/truncation');
 await f.player('playerAbort',identity);await assert.rejects(f.player('playerRetryFailedPrompt',retry),/ALREADY_SENT/);
});
test('wrong ID, non-tail, changed text, nonfailed turn and foreign session cannot reach truncation',async()=>{
 const variants=[f=>({...retry,failedMessageId:'previous'}),f=>({...retry,text:'different'}),f=>({...retry,messageId:'failed-user'}),f=>({...retry,sessionId:'other'}),f=>{f.setMessages([failed,{id:'later',role:'assistant',content:'completed'}]);return retry;},f=>{f.setMetrics({...failedMetrics,status:'completed'});return retry;},f=>{f.setMetrics({...failedMetrics,sessionId:'other'});return retry;},f=>{f.setMetrics({...failedMetrics,calls:{pending:1}});return retry;},f=>{f.setActive(true);return retry;},f=>{f.setMessages([{...failed,attachments:[{id:'document'}]}]);return retry;}];
 for(const variant of variants){const f=await retryFixture();await assert.rejects(f.player('playerRetryFailedPrompt',variant(f)));assert.equal(f.calls.some(c=>c[0]==='agentPrompt'),false);}
});
test('concurrent transcript, world or failure state change during fresh capture rejects retry before ordinary prompt',async()=>{
 for(const mutate of [f=>f.setMessages([failed,{id:'new-user',role:'user',content:'new',status:'complete'}]),f=>f.setWorld('other-world'),f=>f.setMetrics({...failedMetrics,status:'completed'}),f=>f.setMetrics({...failedMetrics,turnId:'different-failed-turn'})]){const f=await retryFixture();f.onCapture(()=>mutate(f));await assert.rejects(f.player('playerRetryFailedPrompt',retry));assert.equal(f.calls.some(c=>c[0]==='agentPrompt'),false);}
});
