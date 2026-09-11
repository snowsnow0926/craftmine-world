import test from 'node:test';import assert from 'node:assert/strict';
import {createHeadlessPlayer} from '../vendor/pi-desktop/apps/desktop/electron/main/craftmine-headless-player.ts';
const config={format:'craftmine.player-config-snapshot/1',credentialsIncluded:false,modelId:'deepseek-v4.1-flash-expires-on-0910',thinkingLevel:'max',thinkingLevels:['medium','high','max','off'],contextWindow:1000000,maxTokens:384000,vendorKey:'deepseek',baseUrl:'https://api.deepseek.com',protocol:'openai_compatible',apiStyle:'chat_completions'};
const identity={sessionId:'session-a',worldId:'world-a'};
function fixture(){
  const calls=[];let session={id:'session-a',mode:'agent',permissionMode:'auto',messages:[{id:'old-message'}]},active=false,worldId='world-a';
  const player=createHeadlessPlayer({invoke:async(channel,...args)=>{calls.push([channel,...args]);if(channel==='sessionGet')return {session};if(channel==='providersCreate')return {provider:{id:'isolated-provider'}};if(channel==='sessionConfigure'){session={...session,...args[1]};return {session};}if(channel==='sessionTurnMetrics')return {usage:{totalTokens:123}};if(channel==='agentPrompt'){active=true;return {accepted:true};}if(channel==='agentAbort'){active=false;return {ok:true};}return {};},panel:async(channel)=>channel==='godot.creationTarget'?{worldId,captureId:'capture-a'}:{status:'working'},observe:async()=>({worldId,buildId:'build-a'}),active:()=>active,latest:async()=>({jobId:'job-a'})});
  return {player,calls,setWorld:value=>worldId=value};
}
test('ordinary setup preserves history and permission while applying the supplied selected model',async()=>{
  const f=fixture(),result=await f.player('playerSetup',{...identity,config,secret:'fixture-key'});
  const create=f.calls.find(call=>call[0]==='providersCreate')[1];assert.equal(create.baseUrl,config.baseUrl);assert.deepEqual(create.models,[{id:config.modelId,contextWindow:1000000,maxTokens:384000,thinkingLevels:config.thinkingLevels}]);
  assert.deepEqual(f.calls.find(call=>call[0]==='sessionConfigure').slice(1),['session-a',{mode:'agent',providerId:'isolated-provider',modelId:config.modelId,thinkingLevel:'max'}]);
  assert.equal(result.permissionMode,'auto');assert.equal(JSON.stringify(result).includes('fixture-key'),false);
  const state=await f.player('playerStatus',identity);assert.equal(state.record.session.messages[0].id,'old-message');assert.equal(state.metrics.usage.totalTokens,123);
});
test('prompt uses the normal renderer API and real capture; status and abort share its session',async()=>{
  const f=fixture();await f.player('playerSetup',{...identity,config,secret:'fixture-key'});
  const input={...identity,text:'继续按完整城市目标创造。',messageId:'new-message'};
  await f.player('playerPrompt',input);
  assert.deepEqual(f.calls.find(call=>call[0]==='agentPrompt')[1],{sessionId:'session-a',viewingSessionId:'session-a',messageId:'new-message',content:input.text,requestContext:{creationTarget:{captureId:'capture-a'}}});
  assert.equal((await f.player('playerStatus',identity)).active,true);await f.player('playerAbort',identity);
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
