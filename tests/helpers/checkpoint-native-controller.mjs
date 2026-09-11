import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const NAV=new Set(['world.list','world.switch','godot.historyLoad']);
const PANEL=new Set(['godot.runtimeSave','backup.export','backup.inspect','backup.restore','backup.status']);
export function validateCheckpointCall(method,fields={}){
 assert.ok(['status','primaryMode','worldNavigation','worldPanel','godotObserve','godotSnapshot','worldNavigationReady','quit'].includes(method),'CHECKPOINT_METHOD_DENIED');
 const allowed=['worldNavigation','worldPanel'].includes(method)?['channel','payload']:method==='primaryMode'?['payload']:[];
 assert.ok(fields&&typeof fields==='object'&&!Array.isArray(fields)&&Object.keys(fields).every(key=>allowed.includes(key)),'CHECKPOINT_ENVELOPE_DENIED');
 if(method==='worldNavigation')assert.ok(NAV.has(fields.channel),'CHECKPOINT_NAV_DENIED');
 if(method==='worldPanel')assert.ok(PANEL.has(fields.channel),'CHECKPOINT_PANEL_DENIED');
 if(method==='primaryMode')assert.ok(!fields.payload||fields.payload.action==='create','CHECKPOINT_MODE_DENIED');
}
export function checkpointEnvironment(client,paths){
 const env=client.environment(paths);
 for(const key of Object.keys(env))if(/CRAFTMINE_(CREATION_EVAL|EVAL_|LIVE_)|(?:API_KEY|SECRET|AUTHORIZATION)/i.test(key))delete env[key];
 return env;
}
export function createCheckpointController({client,out,profile,token,record}){
 const pending=new Map();let child,ready=false,ended=true,exited,exitReport;
 const launch={stdoutBytes:0,stderrBytes:0};record.launch=launch;
 const rejectPending=error=>{for(const call of pending.values()){clearTimeout(call.timer);call.reject(error);}pending.clear();};
 function rpc(method,fields={},timeoutMs=120000){
  validateCheckpointCall(method,fields);if(ended)return Promise.reject(Error('CHECKPOINT_CLIENT_EXITED'));
  return new Promise((resolve,reject)=>{const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('CHECKPOINT_TIMEOUT: '+method));},timeoutMs);
   pending.set(id,{resolve,reject,timer});child.send({type:'craftmine-headless',id,method,...fields},error=>{if(error){clearTimeout(timer);pending.delete(id);reject(error);}});});
 }
 async function until(read,accept,label,timeoutMs=120000){
  const end=Date.now()+timeoutMs;while(Date.now()<end){if(ended)throw Error('CHECKPOINT_CLIENT_EXITED: '+label);
   try{const value=await read();if(accept(value))return value;}catch(error){if(!/not ready|WORLD_BUSY|No world runtime is running|World view is not ready/i.test(error.message))throw error;}
   await delay(400);
  }throw Error('CHECKPOINT_TIMEOUT: '+label);
 }
 const assertIsolation=value=>{assert.deepEqual(value.violations,[]);assert.ok(value.windows.length&&value.windows.every(w=>!w.visible&&!w.focused&&!w.focusable&&w.offscreen),'CHECKPOINT_ISOLATION');};
 async function start(){
  client.assertUnchanged();ended=false;
  child=spawn(client.executable,client.args,{cwd:client.cwd,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:checkpointEnvironment(client,{out,profile,token})});
  // Product logs may contain private session data. Retain byte counts, not logs.
  for(const stream of ['stdout','stderr'])child[stream].on('data',bytes=>{launch[stream+'Bytes']+=bytes.length;});
  exited=new Promise(resolve=>{child.once('error',error=>{ended=true;launch.errorCode=error.code??'SPAWN_FAILED';rejectPending(error);resolve();});child.once('exit',(code,signal)=>{ended=true;launch.exit={code,signal};rejectPending(Error('CHECKPOINT_CLIENT_EXITED'));resolve();});});
  child.on('message',message=>{if(message.type==='craftmine-headless-ready')ready=true;if(message.type==='craftmine-headless-exit')exitReport=message;
   const call=pending.get(message.id);if(call){clearTimeout(call.timer);pending.delete(message.id);message.error?call.reject(Error(message.error)):call.resolve(message.result);}});
  await until(async()=>ready,Boolean,'controller');assertIsolation(await until(()=>rpc('status'),value=>value.windows?.length,'window'));
  await until(()=>rpc('primaryMode'),value=>value.entry,'entry');await rpc('primaryMode',{payload:{action:'create'}});
 }
 async function stop(){
  if(!child)return;
  if(!ended){try{await rpc('quit',{},5000);}catch{}await Promise.race([exited,delay(15000)]);
   if(!ended){launch.forcedStop=true;child.kill();await Promise.race([exited,delay(5000)]);}}
  record.audit=exitReport;rejectPending(Error('CHECKPOINT_CLOSED'));
  assert.ok(!launch.forcedStop,'CHECKPOINT_SHUTDOWN_TIMEOUT');assert.deepEqual(exitReport?.violations,[]);assert.deepEqual(exitReport?.pageErrors,[]);assert.deepEqual(exitReport?.shutdownFailures,[]);client.assertUnchanged();
 }
 return {start,stop,rpc,until,nav:(channel,payload={})=>rpc('worldNavigation',{channel,payload}),panel:(channel,payload={})=>rpc('worldPanel',{channel,payload},900000)};
}
