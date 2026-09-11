import fs from'node:fs';import path from'node:path';import assert from'node:assert/strict';import{spawn}from'node:child_process';import{randomUUID}from'node:crypto';import{setTimeout as delay}from'node:timers/promises';
import{assertCleanHeadlessShutdown}from'../player-product/shutdown-exit-audit.mjs';
import{resolveCreationNativeLaunch}from'./creation-native-launch.mjs';
export function creationNativeSession({root,out,profile,token,sessionId,worldId,secret,launches,logPrefix='native',packagedRoot,continuity,model='deepseek-flash',thinking='high'}){
 let child,ended=true,ready=false,exit=Promise.resolve(),launch,currentWorld=worldId,currentSession=sessionId;const pending=new Map(),logs=new Map();
 const client=resolveCreationNativeLaunch({root,packagedRoot,requiredGuards:['craftmine-creation-evaluation','EVALUATION_REQUEST_LIMIT']});
 const safe=text=>secret?text.split(secret).join('[REDACTED]'):text;
 const rpc=(type,method,payload={},timeout=60000)=>new Promise((resolve,reject)=>{if(ended)return reject(Error('EVALUATION_CLIENT_STOPPED'));const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('EVALUATION_TIMEOUT '+method));},timeout);pending.set(id,{resolve,reject,timer});child.send({type,id,method,...payload});});
 const native=(method,payload={},timeout)=>rpc('craftmine-headless',method,payload,timeout),evaluate=(method,caseId)=>rpc('craftmine-creation-evaluation',method,caseId?{caseId}:{},method==='prepare-continuity'?1500000:method==='copy-world'?900000:60000),nav=(channel,payload={})=>native('worldNavigation',{channel,payload},180000);
 async function until(read,accept,label,timeout=120000){const end=Date.now()+timeout;let value;while(Date.now()<end){if(ended)throw Error('EVALUATION_CLIENT_STOPPED');try{value=await read();if(accept(value))return value;}catch(error){if(!/WORLD_BUSY|GODOT_CANDIDATE_ACTIVE|No world runtime is running|World view is not ready/.test(String(error.message)))throw error;}await delay(100);}throw Error('EVALUATION_TIMEOUT '+label);}
 async function boot(){
  assert.ok(ended);client.assertUnchanged();ended=false;ready=false;launch={number:launches.length+1};launches.push(launch);const current=launch;
  current.client={executable:client.executable,args:client.args,cwd:client.cwd,identity:client.identity};
  const env=client.environment({out,profile,token});Object.assign(env,{CRAFTMINE_CREATION_EVAL:'1',CRAFTMINE_EVAL_MODEL:model,CRAFTMINE_EVAL_THINKING:thinking,CRAFTMINE_EVAL_KEY:secret,...(currentSession?{CRAFTMINE_EVAL_SESSION:currentSession}:{}),...(continuity?{CRAFTMINE_EVAL_SUITE:'craftmine.creation-continuity-model/1',CRAFTMINE_EVAL_CASE:continuity.caseId,CRAFTMINE_EVAL_MANIFEST:continuity.manifestPath}:{})});
  child=spawn(client.executable,client.args,{cwd:client.cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});current.pid=child.pid;
  for(const stream of ['stdout','stderr'])child[stream].on('data',bytes=>{const name=`${logPrefix}-${current.number}-${stream}.log`;logs.set(name,(logs.get(name)??'')+bytes.toString('utf8'));});
  child.on('message',message=>{if(message?.type==='craftmine-headless-ready')ready=true;if(message?.type==='craftmine-headless-exit')current.audit=message;const call=pending.get(message?.id);if(!call)return;clearTimeout(call.timer);pending.delete(message.id);message.error?call.reject(Error(message.error)):call.resolve(message.result);});
  exit=new Promise(resolve=>{const finish=(code,signal,error)=>{if(ended)return;ended=true;current.exit={code,signal,...(error?{error:String(error)}:{})};for(const call of pending.values()){clearTimeout(call.timer);call.reject(Error('EVALUATION_CLIENT_STOPPED'));}pending.clear();resolve();};child.once('exit',(c,s)=>finish(c,s));child.once('error',e=>finish(null,null,e));});
  await until(async()=>ready,Boolean,'controller');const initialIsolation=await until(()=>native('status'),s=>s.windows.length>0,'window');assert.deepEqual(initialIsolation.violations,[]);assert.ok(initialIsolation.windows.every(w=>!w.visible&&!w.focused&&!w.focusable&&w.offscreen));current.initialIsolation=initialIsolation;
  if(continuity&&!currentWorld){
    await until(()=>nav('world.createOptions'),value=>value.bases?.some(base=>base.id==='creation-sandbox'),'creation catalog');
    currentWorld=(await nav('world.create',{baseId:'creation-sandbox',starterId:'blank',title:'连续造物开发样本 '+continuity.caseId,operationId:randomUUID()})).id;
    await until(async()=>{const worlds=await nav('world.list'),item=worlds.worlds?.find(world=>world.id===currentWorld);if(item?.state==='failed')throw Error('CONTINUITY_WORLD_CREATION_FAILED');return item;},item=>item?.state==='ready','new world',900000);
    await until(()=>native('godotObserve'),value=>value.worldId===currentWorld&&value.instanceId,'new runtime');
    await until(()=>native('worldNavigationReady'),value=>value.worldId===currentWorld&&value.ready,'new world navigation');
  }
  const initialized=await evaluate('initialize');if(currentSession){assert.equal(initialized.sessionId,currentSession);assert.equal(initialized.reopened,true);}else{assert.ok(continuity&&initialized.sessionId);currentSession=initialized.sessionId;}
  await until(async()=>{const observation=await native('godotObserve');if(observation.worldId!==currentWorld)return null;await evaluate('pause-play');return native('godotObserve');},o=>o?.worldId===currentWorld&&o.instanceId,'restored world');
  await until(()=>native('worldNavigationReady'),s=>s.worldId===currentWorld&&s.ready,'navigation released');await evaluate('pause-play');
  const isolation=await native('status');assert.deepEqual(isolation.violations,[]);assert.ok(isolation.windows.length&&isolation.windows.every(w=>!w.visible&&!w.focused&&!w.focusable&&w.offscreen));return isolation;
 }
 async function stop(){if(!launch)return;if(!ended){try{await native('quit',{},5000);}catch{}await Promise.race([exit,delay(15000)]);if(!ended){launch.forcedStop=true;child.kill();await Promise.race([exit,delay(5000)]);}}for(const[name,text]of logs)fs.writeFileSync(path.join(out,name),safe(text));logs.clear();assertCleanHeadlessShutdown(launch);client.assertUnchanged();}
 return {boot,stop,native,evaluate,nav,until,clientIdentity:client.identity,context:()=>({worldId:currentWorld,sessionId:currentSession}),setWorld:id=>{currentWorld=id;},setSession:id=>{assert.match(id,/^[a-f0-9-]{36}$/);currentSession=id;},save:()=>native('worldPanel',{channel:'godot.runtimeSave',payload:{worldId:currentWorld,freeze:true}},60000),isEnded:()=>ended};
}
