'use strict';
const {performance}=require('node:perf_hooks');
const TERMINAL=new Set(['passed','failed','cancelled','interrupted','blocked']);
const ACTIVE=new Set(['queued','claimed','running']);
const IDENTITY=['jobId','worldId','taskId','buildId','kind','baseId','sourceRevision','manifestHash','checkRequirementsHash'];
const error=code=>Object.assign(Error(code),{errorCode:code});

// One outstanding, read-only RPC. The guard is checked while a slow core read
// is pending; a cancelled turn never receives its late reply.
function guardedRead(core,params,timeoutMs,assertActive){
 assertActive();
 return new Promise((resolve,reject)=>{
  let settled=false;
  const finish=(failure,value)=>{if(settled)return;settled=true;clearTimeout(deadline);clearInterval(guard);failure?reject(failure):resolve(value);};
  const deadline=setTimeout(()=>finish(error('GODOT_BUILD_READ_TIMEOUT')),timeoutMs);
  const guard=setInterval(()=>{try{assertActive();}catch(failure){finish(failure);}},Math.min(100,timeoutMs));
  Promise.resolve().then(()=>core.call('godotBuild.read',structuredClone(params),timeoutMs)).then(value=>{try{assertActive();finish(null,value);}catch(failure){finish(failure);}},failure=>finish(failure));
 });
}

async function readGodotBuildWithWait({core,params,waitMs=0,assertActive=()=>{},assertSelected=async()=>{},readCompletion,now=()=>performance.now(),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),readTimeoutMs=5000}){
 if(!Number.isInteger(waitMs)||waitMs<0||waitMs>30000||!Number.isInteger(readTimeoutMs)||readTimeoutMs<1||readTimeoutMs>5000)throw error('GODOT_BUILD_READ_WAIT_INVALID');
 const bound=structuredClone(params);
 if(!bound||Object.keys(bound).sort().join(',')!=='context,jobId,worldId'||!bound.context||Object.keys(bound.context).sort().join(',')!=='projectId,sessionId,turnId'||![bound.worldId,bound.jobId,...Object.values(bound.context)].every(value=>typeof value==='string'&&value.length>0))throw error('GODOT_BUILD_READ_BINDING_INVALID');
 const started=now();let previous,identity,lastReadAt=started;
 const result=reason=>({...previous,waitedMs:Math.max(0,Math.round(now()-started)),lastReadAgeMs:Math.max(0,Math.round(now()-lastReadAt)),waitReason:reason});
 for(;;){
  assertActive();await assertSelected();assertActive();
  const remaining=waitMs-(now()-started);
  if(previous&&remaining<=0)return result(['pending','applying'].includes(previous.creationApplication?.status)?'application-pending':'deadline');
  const timeout=Math.max(1,Math.min(readTimeoutMs,waitMs>0?Math.ceil(remaining):readTimeoutMs));
  let current;
  try{current=await guardedRead(core,bound,timeout,assertActive);}catch(failure){
   assertActive();await assertSelected();assertActive();
   if(previous&&(failure?.errorCode==='GODOT_BUILD_READ_TIMEOUT'||/Rust request timed out/.test(failure?.message??'')))return result('read-timeout');
   throw failure;
  }
  assertActive();await assertSelected();assertActive();
  if(!current||current.jobId!==bound.jobId||current.worldId!==bound.worldId||(!TERMINAL.has(current.status)&&!ACTIVE.has(current.status)))throw error('GODOT_BUILD_READ_IDENTITY_CHANGED');
  const currentIdentity=JSON.stringify(IDENTITY.map(key=>current[key]??null));
  if(identity!==undefined&&identity!==currentIdentity)throw error('GODOT_BUILD_READ_IDENTITY_CHANGED');
  identity=currentIdentity;previous=structuredClone(current);lastReadAt=now();
  let applicationPending=false;
  if(current.status==='passed'&&current.kind==='check'&&current.baseId==='creation-sandbox'&&typeof readCompletion==='function'){
   const application=readCompletion(structuredClone(bound));
   assertActive();
   if(application!==null&&application!==undefined){
    if(application.jobId!==current.jobId||application.worldId!==current.worldId||application.buildId!==current.buildId||!['pending','applying','deferred','repairing','applied','manual','failed','cancelled','interrupted'].includes(application.status)||(application.candidateId!==null&&application.candidateId!==current.candidateId)||(application.status==='applied'&&application.candidateId!==current.candidateId))throw error('GODOT_BUILD_APPLICATION_IDENTITY_CHANGED');
    previous.creationApplication=structuredClone(application);
    applicationPending=['pending','applying'].includes(application.status);
   }else previous.creationApplication={status:'unknown',reason:'CREATION_APPLICATION_RECEIPT_UNAVAILABLE'};
  }
  if(TERMINAL.has(current.status)&&!applicationPending)return result('terminal');
  if(applicationPending&&now()-started>=waitMs)return result('application-pending');
  if(now()-started>=waitMs)return result('deadline');
  await pause(Math.min(500,waitMs-(now()-started)));assertActive();
 }
}
module.exports={readGodotBuildWithWait};
