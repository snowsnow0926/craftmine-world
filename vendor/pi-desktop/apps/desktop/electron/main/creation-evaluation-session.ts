import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
export function assertEvaluationSession(session:any,provider:any,modelId:string,thinkingLevel:string){
 if(!session||!/^[a-f0-9-]{36}$/.test(session.id)||session.mode!=='agent'||session.modelId!==modelId||session.thinkingLevel!==thinkingLevel||!session.providerId)throw Error('EVALUATION_SESSION_CONFIGURATION_MISMATCH');
 if(provider?.id!==session.providerId||provider.vendorKey!=='deepseek'||typeof provider.baseUrl!=='string'||provider.baseUrl.replace(/\/$/,'')!=='https://api.deepseek.com')throw Error('EVALUATION_SESSION_PROVIDER_MISMATCH');
 return {sessionId:session.id,providerId:session.providerId,modelId,thinkingLevel};
}
/** Diagnostic identity registration in the already validated private test profile.
 * Existing sessions are checked against their actual provider configuration;
 * mutable display titles are never authority. No credentials are written here. */
export function recordEvaluationSession(directory:string,identity:ReturnType<typeof assertEvaluationSession>){
 if(!path.isAbsolute(directory))throw Error('EVALUATION_SESSION_DIRECTORY_INVALID');
 const file=path.join(directory,'creation-evaluation-sessions.json');
 const record=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{format:'craftmine.creation-evaluation-sessions/1',sessions:{}};
 if(record.format!=='craftmine.creation-evaluation-sessions/1'||!record.sessions||Array.isArray(record.sessions))throw Error('EVALUATION_SESSION_REGISTRY_INVALID');
 const old=record.sessions[identity.sessionId];
 if(old&&JSON.stringify(old)!==JSON.stringify(identity))throw Error('EVALUATION_SESSION_CONFIGURATION_CHANGED');
 record.sessions[identity.sessionId]=identity;
 const temporary=file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(temporary,JSON.stringify(record)+'\n',{flag:'wx'});fs.renameSync(temporary,file);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
