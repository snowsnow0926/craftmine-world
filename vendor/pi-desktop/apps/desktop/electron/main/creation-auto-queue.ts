import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {CreationCheckCompletion} from './creation-auto-apply-service.ts';

type Data=Record<string,any>;
export type CreationAutoRecord=CreationCheckCompletion&{worldId:string;status:'queued'|'applying'|'deferred'|'repairing'|'applied'|'manual'|'failed'|'cancelled';candidateId?:string;reason?:string;repairReason?:string;updatedAt:string};
const deferred=new Set(['WORLD_BUSY','GODOT_CANDIDATE_ACTIVE','GODOT_WORLD_CHANGED','CREATION_PLAYER_CONTEXT_CHANGED','CREATION_WORLD_DEFERRED','CREATION_TURN_BUSY','CREATION_RUNTIME_NOT_READY','CREATION_FINALIZING','CREATION_HOST_UNAVAILABLE']);
const identity=(input:CreationCheckCompletion)=>JSON.stringify([input.context.projectId,input.context.sessionId,input.context.turnId,input.jobId]);
/** Host-owned durable intent. A queue record grants no new authority: every
 * attempt rereads the original authorization, check, formal world and source. */
export function createCreationAutoQueue(deps:{directory:string;world(input:CreationCheckCompletion):Promise<string|null>;perform(input:CreationCheckCompletion):Promise<Data>;discover?():Promise<Array<CreationCheckCompletion&{worldId:string}>>;changed?(record:CreationAutoRecord):void}){
  const records=new Map<string,CreationAutoRecord>();let draining:Promise<void>|null=null;let suspended=false;let nextDiscovery=0;
  const name=(key:string)=>path.join(deps.directory,createHash('sha256').update(key).digest('hex')+'.json');
  if(fs.existsSync(deps.directory))for(const entry of fs.readdirSync(deps.directory)){
    if(!/^[a-f0-9]{64}\.json$/.test(entry))continue;
    const file=path.join(deps.directory,entry);if(fs.statSync(file).size>16384)continue;
    try{const record:CreationAutoRecord=JSON.parse(fs.readFileSync(file,'utf8'));if(!valid(record)||typeof record.worldId!=='string')continue;
      if(['queued','applying'].includes(record.status)){record.status='deferred';record.reason='CREATION_RESTART_RECHECK';}records.set(identity(record),record);
    }catch{/* A partial or invalid record never grants permission. */}
  }
  function valid(input:any):input is CreationCheckCompletion{return !!input&&/^gjob-[a-f0-9]{64}$/.test(input.jobId)&&input.context&&Object.keys(input.context).sort().join(',')==='projectId,sessionId,turnId'&&Object.values(input.context).every(x=>typeof x==='string'&&x.length>0&&x.length<=240);}
  function save(record:CreationAutoRecord){const key=identity(record),file=name(key);fs.mkdirSync(deps.directory,{recursive:true});const tmp=file+'.'+randomUUID()+'.tmp';
    const previous=records.get(key);if(previous&&JSON.stringify({...previous,updatedAt:null})===JSON.stringify({...record,updatedAt:null}))return;
    try{fs.writeFileSync(tmp,JSON.stringify(record),{flag:'wx'});fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}records.set(key,record);deps.changed?.(structuredClone(record));}
  async function attempt(record:CreationAutoRecord){
    if(suspended||!['queued','deferred','repairing'].includes(record.status))return;
    if(record.status==='queued')save({...record,status:'applying',updatedAt:new Date().toISOString()});
    let result:Data;
    try{result=await deps.perform({jobId:record.jobId,context:record.context});}
    catch(error){const reason=String((error as Error)?.message??error),code=(error as any)?.errorCode??(error as any)?.code;
      result={status:deferred.has(reason)||code==='HOST_UNAVAILABLE'?'deferred':'failed',reason:code==='HOST_UNAVAILABLE'?'HOST_UNAVAILABLE':reason};}
    const latest=records.get(identity(record));if(latest?.status==='cancelled')return;
    const status=record.status==='repairing'&&result.status==='deferred'?'repairing':['applied','manual','deferred','repairing','failed'].includes(result.status)?result.status:'failed';
    save({...record,status,candidateId:result.candidateId??record.candidateId,reason:result.reason,repairReason:result.repairReason??record.repairReason,updatedAt:new Date().toISOString()});
  }
  const api={
    async completed(input:CreationCheckCompletion):Promise<Data>{
      if(!valid(input)||Object.keys(input).sort().join(',')!=='context,jobId')throw Error('CREATION_COMPLETION_INVALID');
      const key=identity(input);let record=records.get(key);
      if(!record){const worldId=await deps.world(input);if(!worldId)return {status:'manual',reason:'CREATION_AUTO_APPLY_NOT_AUTHORIZED'};
        record={...structuredClone(input),worldId,status:'queued',updatedAt:new Date().toISOString()};save(record);}
      await api.resume();const result=records.get(key)!;return {status:result.status==='queued'||result.status==='applying'?'deferred':result.status,worldId:result.worldId,candidateId:result.candidateId,reason:result.reason};
    },
    resume():Promise<void>{if(suspended)return Promise.resolve();if(draining)return draining;draining=(async()=>{
      if(Date.now()>=nextDiscovery){nextDiscovery=Date.now()+10000;
        for(const found of await deps.discover?.()??[]){if(!valid(found)||records.has(identity(found)))continue;save({...found,status:'queued',updatedAt:new Date().toISOString()});}}
      for(const record of [...records.values()])await attempt(record);
    })().finally(()=>{draining=null;});return draining;},
    async suspend(){suspended=true;await draining;},
    continue(){suspended=false;return api.resume();},
    status(jobId:string,sessionId:string){const record=[...records.values()].find(x=>x.jobId===jobId&&x.context.sessionId===sessionId);return record?structuredClone(record):null;},
    cancel(sessionId:string,turnId:string){for(const record of records.values())if(record.context.sessionId===sessionId&&record.context.turnId===turnId&&!['applied','manual','cancelled'].includes(record.status))save({...record,status:'cancelled',reason:'CREATION_USER_CANCELLED',updatedAt:new Date().toISOString()});},
  };return api;
}
