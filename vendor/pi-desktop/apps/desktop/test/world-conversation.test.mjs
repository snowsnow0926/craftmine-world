import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
register(new URL('./helpers/ts-import-hooks.mjs',import.meta.url));
const {readWorldConversation}=await import('../electron/main/world-conversation.ts');
const {craftmineProjectIdentity}=await import('../electron/main/craftmine-tool-context.ts');

function fixture(){
  const state={selected:'world-a',sessions:[{id:'new-b',updatedAt:3},{id:'new-a',updatedAt:2},{id:'old-a',updatedAt:1}],calls:[]};
  const access={selectedWorld:async()=>state.selected,sessions:async()=>state.sessions,pluginEnabled:()=>true,
    domain:async(method,args)=>{state.calls.push({method,args});const id=args.host.sessionId;return {context:{world:{id:id.endsWith('b')?'world-b':'world-a'},binding:{projectId:args.host.projectId,sessionId:id,taskId:'task-'+id}}};}};
  return {state,access};
}
test('restore newest real conversation bound to the selected world, ignoring another world',async()=>{
  const {state,access}=fixture();assert.deepEqual(await readWorldConversation({worldId:'world-a'},access),{worldId:'world-a',sessionId:'new-a',taskId:'task-new-a'});
  assert.deepEqual(state.calls.map(call=>call.args.host.sessionId),['new-b','new-a']);
  assert.ok(state.calls.every(call=>call.method==='workbench.request'&&call.args.channel==='task.current'&&call.args.host.active===false));
});
test('preferred conversation is a hint that must pass the same host binding checks',async()=>{
  const {state,access}=fixture();assert.equal((await readWorldConversation({worldId:'world-a',sessionId:'old-a'},access)).sessionId,'old-a');
  state.calls=[];assert.equal((await readWorldConversation({worldId:'world-a',sessionId:'new-b'},access)).sessionId,'new-a');
  assert.equal((await readWorldConversation({worldId:'world-a',sessionId:'deleted-or-synthetic'},access)).sessionId,'new-a');
});
test('changed project, wrong task/session identity, archived and disabled conversations never restore',async()=>{
  const {state,access}=fixture();state.sessions=[{id:'archived',archived:true},{id:'disabled',projectPath:'disabled'},{id:'moved'},{id:'forged'},{id:'valid'}];
  access.pluginEnabled=path=>path!=='disabled';
  access.domain=async(_method,args)=>{const id=args.host.sessionId;state.calls.push(id);if(id==='moved')throw Error('PROJECT_BINDING_MISMATCH');return {context:{world:{id:'world-a'},binding:{sessionId:id==='forged'?'another':id,projectId:craftmineProjectIdentity({id},id),taskId:'task-'+id}}};};
  assert.equal((await readWorldConversation({worldId:'world-a'},access)).sessionId,'valid');assert.deepEqual(state.calls,['moved','forged','valid']);
});
test('unbound or missing sessions produce an empty result without creating or replaying work',async()=>{
  const {state,access}=fixture();access.domain=async(method,args)=>{state.calls.push(method);return {context:null};};
  assert.deepEqual(await readWorldConversation({worldId:'world-a'},access),{worldId:'world-a',sessionId:null});
  assert.ok(state.calls.every(method=>method==='workbench.request'));
});
test('selection changes during either session listing or task read reject late restoration',async()=>{
  for(const stage of ['sessions','domain']){const {state,access}=fixture();const original=access[stage];access[stage]=async(...args)=>{const value=await original(...args);state.selected='world-b';return value;};await assert.rejects(readWorldConversation({worldId:'world-a'},access),/WORLD_CONVERSATION_CHANGED/);}
});
test('malformed requests and domain failures never fabricate a conversation',async()=>{
  const {access}=fixture();for(const value of [null,[],{}, {worldId:'../a'},{worldId:'world-a',sessionId:''},{worldId:'world-a',force:true}])await assert.rejects(readWorldConversation(value,access),/REQUEST_INVALID/);
  access.domain=async()=>{throw Error('DOMAIN_OFFLINE');};await assert.rejects(readWorldConversation({worldId:'world-a'},access),/DOMAIN_OFFLINE/);
});
