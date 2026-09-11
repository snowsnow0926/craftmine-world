// Real evaluator dispatch with fake IPC/provider adapters: zero model calls.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import vm from 'node:vm';import {register} from 'node:module';
register('./helpers/ts-import-hooks.mjs',import.meta.url);
const {installCreationEvaluation}=await import('../electron/main/craftmine-creation-evaluation.ts');
test('current wish uses the normal captured prompt, serializes all submissions and survives lost receipts',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'wish-host-')),sessionId='12345678-1234-1234-1234-123456789012';
  const env={CRAFTMINE_CREATION_EVAL:'1',CRAFTMINE_DATA_DIR:directory,CRAFTMINE_EVAL_SESSION:sessionId,CRAFTMINE_EVAL_MODEL:'deepseek-flash',CRAFTMINE_EVAL_THINKING:'high',CRAFTMINE_EVAL_KEY:'synthetic-unused',CRAFTMINE_EVAL_SUITE:'full'};
  const saved=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]])),oldSend=process.send,before=process.listeners('message');
  Object.assign(process.env,env);
  t.after(()=>{for(const [k,v]of Object.entries(saved))v===undefined?delete process.env[k]:process.env[k]=v;process.send=oldSend;for(const fn of process.listeners('message'))if(!before.includes(fn))process.removeListener('message',fn);});
  let next=0,hold=null,loseReply=false;const pending=new Map(),calls=[];
  process.send=message=>{const entry=pending.get(message.id);if(entry){pending.delete(message.id);message.error?entry.reject(Error(message.error)):entry.resolve(message.result);}return true;};
  const target={captureId:'captured-by-host',worldId:'real-world'};
  const desktop={channels:{invoke:{agentPrompt:'agentPrompt',notificationSetViewingSession:'view'}},
    pluginPanelInvoke:async(_plugin,channel,payload)=>{assert.equal(channel,'godot.creationTarget');assert.equal(payload.sessionId,sessionId);if(hold)await hold;return target;},
    invoke:async(channel,args)=>{if(channel==='agentPrompt'){calls.push(args);if(loseReply)throw Error('simulated lost receipt');return {turnId:'turn'};}return {};}};
  const window={isDestroyed:()=>false,webContents:{executeJavaScript:source=>vm.runInNewContext(source,{piDesktop:desktop})}};
  installCreationEvaluation({enabled:true,window:()=>window,active:()=>false,observe:async()=>({}),action:async()=>({}),domain:async()=>({}),call:async method=>{
    if(method==='session.get')return {session:{id:sessionId,mode:'agent',providerId:'provider',modelId:'deepseek-flash',thinkingLevel:'high'}};
    if(method==='providers.list')return {providers:[{id:'provider',vendorKey:'deepseek',baseUrl:'https://api.deepseek.com'}]};
    throw Error('Unexpected host call '+method);
  }});
  const rpc=(method,extra={})=>new Promise((resolve,reject)=>{const id=String(++next);pending.set(id,{resolve,reject});process.emit('message',{type:'craftmine-creation-evaluation',id,method,...extra});});
  await rpc('initialize');
  let release;hold=new Promise(resolve=>release=resolve);
  const first=rpc('wish',{wish:{id:'PET01',text:'我希望有条宠物狗。'}});
  await assert.rejects(rpc('wish',{wish:{id:'PET02',text:'白色'}}),/BUSY/);
  await assert.rejects(rpc('prompt',{caseId:'CA01'}),/CASE_DENIED/);
  release();hold=null;const submitted=await first;
  assert.equal(calls.length,1);assert.equal(calls[0].content,'我希望有条宠物狗。');
  assert.equal(calls[0].requestContext.creationTarget.captureId,target.captureId);
  assert.equal(submitted.messageId,calls[0].messageId);
  await assert.rejects(rpc('wish',{wish:{id:'PET01',text:'我希望有条宠物狗。'}}),/ALREADY_CLAIMED/);
  loseReply=true;await assert.rejects(rpc('wish',{wish:{id:'PET03',text:'把它变白'}}),/lost receipt/);
  await assert.rejects(rpc('wish',{wish:{id:'PET03',text:'把它变白'}}),/ALREADY_CLAIMED/);
  const state=await rpc('wish-state');assert.deepEqual(state.wishes.map(e=>e.status),['submitted','uncertain']);assert.equal(calls.length,2);assert.equal(state.budget.reserved,0);
});
