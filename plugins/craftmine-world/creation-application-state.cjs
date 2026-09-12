'use strict';
const FORMAT='craftmine.creation-application-state/1';
const STATES=new Set(['pending','applying','deferred','repairing','applied','manual','failed','cancelled','interrupted']);
const text=value=>typeof value==='string'&&value.length>0&&value.length<=240&&!/[\x00-\x1f]/.test(value);
const context=value=>value&&Object.keys(value).sort().join(',')==='projectId,sessionId,turnId'&&Object.values(value).every(text);
const sameContext=(a,b)=>context(a)&&context(b)&&['projectId','sessionId','turnId'].every(key=>a[key]===b[key]);

// This ledger is a diagnostic receipt. Loading it never starts an application
// or grants the authority that only the active host turn can provide.
function normalizeCreationApplication(value,{restart=false}={}){
 if(!value||value.format!==FORMAT||!/^gjob-[a-f0-9]{64}$/.test(value.jobId)||!text(value.worldId)||!text(value.buildId)||!context(value.context)||!STATES.has(value.status)||!Number.isFinite(Date.parse(value.updatedAt))||(value.candidateId!==null&&!text(value.candidateId))||(value.reason!==null&&(typeof value.reason!=='string'||value.reason.length>600)))return null;
 const result={format:FORMAT,jobId:value.jobId,worldId:value.worldId,buildId:value.buildId,context:{...value.context},candidateId:value.candidateId,status:value.status,reason:value.reason,updatedAt:value.updatedAt};
 if(restart&&['pending','applying'].includes(result.status))Object.assign(result,{status:'interrupted',reason:'CREATION_APPLICATION_RESTARTED_RECHECK_FORMAL'});
 return result;
}
function creationApplicationRecord(entry,status,reason=null,candidateId=null,now=new Date().toISOString()){
 const value=normalizeCreationApplication({format:FORMAT,jobId:entry.jobId,worldId:entry.claim?.worldId??entry.worldId,buildId:entry.claim?.buildId,context:entry.context,candidateId,status,reason:reason===null?null:String(reason).slice(0,600),updatedAt:now});
 if(!value)throw Error('CREATION_APPLICATION_RECORD_INVALID');return value;
}
function readCreationApplication(value,binding,{live=false,ledgerError=null}={}){
 const record=normalizeCreationApplication(value,{restart:!live});
 if(!record||!binding||record.jobId!==binding.jobId||record.worldId!==binding.worldId||!sameContext(record.context,binding.context))return null;
 const {context:owner,...result}=record;
 if(ledgerError)return {...result,status:'interrupted',reason:'CREATION_APPLICATION_LEDGER_UNCONFIRMED'};
 return result;
}
module.exports={FORMAT,STATES,validCreationApplicationContext:context,normalizeCreationApplication,creationApplicationRecord,readCreationApplication};
