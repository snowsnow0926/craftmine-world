import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';

export const CONTINUITY_EVALUATION_SUITE='craftmine.creation-continuity-model/1';
export const CONTINUITY_EVALUATION_CASES=Object.freeze([
  {id:'CM01',request:'在这里放一棵蓝色的树',initial:'empty',color:'#0000ff',scale:[1,1,1]},
  {id:'CM02',request:'把这棵树放大到2倍，并改成蓝色',initial:'one-default-tree',color:'#0000ff',scale:[2,2,2]},
  {id:'CM03',request:'把这个对象改成红色，其他东西保持原样',initial:'two-default-trees-recent-copy',color:'#ff0000',scale:[1,1,1]},
  {id:'CM04',request:'这棵树的颜色改成#88bb44，其他东西保持原样',initial:'one-default-tree',color:'#88bb44',scale:[1,1,1]},
]);
export const CONTINUITY_EVALUATION_LIMITS=Object.freeze({perCaseRequests:10,totalRequests:40,maxCaseMs:600000,maxRepairs:2});
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const read=(file:string)=>{if(fs.statSync(file).size>2*1024*1024)throw Error('CONTINUITY_MANIFEST_TOO_LARGE');return fs.readFileSync(file,'utf8');};

/** A fixed suite may only use its predeclared private profile and one root attempt. */
export function continuityEvaluationConfiguration(env:NodeJS.ProcessEnv){
  if(env.CRAFTMINE_EVAL_SUITE===undefined||env.CRAFTMINE_EVAL_SUITE==='full')return null;
  if(env.CRAFTMINE_EVAL_SUITE!==CONTINUITY_EVALUATION_SUITE)throw Error('CONTINUITY_SUITE_DENIED');
  const entry=CONTINUITY_EVALUATION_CASES.find(item=>item.id===env.CRAFTMINE_EVAL_CASE);
  const manifestPath=env.CRAFTMINE_EVAL_MANIFEST,profile=env.CRAFTMINE_DATA_DIR;
  if(!entry||!manifestPath||!path.isAbsolute(manifestPath)||!profile||!path.isAbsolute(profile))throw Error('CONTINUITY_CASE_DENIED');
  const text=read(manifestPath),manifest=JSON.parse(text),directory=path.dirname(manifestPath),manifestHash=hash(text);
  if(manifest.format!==CONTINUITY_EVALUATION_SUITE||manifest.evidenceUse!=='development_cases'||JSON.stringify(manifest.cases)!==JSON.stringify(CONTINUITY_EVALUATION_CASES)||JSON.stringify(manifest.limits)!==JSON.stringify(CONTINUITY_EVALUATION_LIMITS)||typeof manifest.runId!=='string'||!/^[a-f0-9-]{36}$/.test(manifest.runId))throw Error('CONTINUITY_MANIFEST_INVALID');
  const expected=path.join(directory,entry.id,'profile');
  if(path.resolve(profile)!==expected||fs.realpathSync(profile)!==fs.realpathSync(expected)||fs.lstatSync(profile).isSymbolicLink())throw Error('CONTINUITY_PROFILE_CHANGED');
  const attempt=JSON.parse(read(path.join(directory,'attempt.json')));
  if(attempt.manifestHash!==manifestHash||attempt.runId!==manifest.runId||attempt.format!=='craftmine.continuity-attempt/1')throw Error('CONTINUITY_ATTEMPT_INVALID');
  const claim=JSON.parse(read(path.join(directory,entry.id,'case-attempt.json')));
  if(claim.runId!==manifest.runId||claim.caseId!==entry.id||claim.manifestHash!==manifestHash)throw Error('CONTINUITY_CASE_ATTEMPT_INVALID');
  if(manifest.model!==env.CRAFTMINE_EVAL_MODEL||manifest.thinking!==env.CRAFTMINE_EVAL_THINKING)throw Error('CONTINUITY_MODEL_CHANGED');
  return {entry,limit:10 as const,manifestHash,profile,runId:manifest.runId};
}
export function claimContinuityAction(configuration:NonNullable<ReturnType<typeof continuityEvaluationConfiguration>>,action:'prepare'|'prompt',identity?:{sessionId:string;messageId:string}){
  const file=path.join(configuration.profile,`continuity-${action}.json`);
  try{fs.writeFileSync(file,JSON.stringify({runId:configuration.runId,caseId:configuration.entry.id,manifestHash:configuration.manifestHash,action,at:new Date().toISOString(),...identity})+'\n',{flag:'wx'});}
  catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw Error('CONTINUITY_ACTION_ALREADY_ATTEMPTED');throw error;}
}
// Same repair definition as the historical runner: a failed tool/build followed
// by another source mutation or build counts once; polling is never a repair.
export function continuityRepairState(messages:any[]){
  const body=(value:any,depth=0):any=>{if(depth>4)return value;if(typeof value==='string'){try{return body(JSON.parse(value),depth+1);}catch{return value;}}if(value?.status)return value;if(value?.details)return body(value.details,depth+1);const texts=value?.content?.filter?.((part:any)=>part.type==='text'&&typeof part.text==='string');return texts?.length===1?body(texts[0].text,depth+1):value;};
  let repairs=0,failed=false;const seen=new Set();
  for(const item of messages){
    if(item.role!=='tool'||seen.has(item.toolCallId??item.id))continue;seen.add(item.toolCallId??item.id);
    const value=body(item.toolResult??item.content),isRead=/godot_build_read$/.test(item.toolName??'');
    if(item.toolStatus==='error'||item.toolStatus==='denied'||isRead&&['failed','blocked','interrupted'].includes(value?.status)){failed=true;continue;}
    if(failed&&/creation_operation|godot_project_patch|godot_build_start/.test(item.toolName??'')){repairs++;failed=false;}
  }
  return {repairs,failed};
}
export async function assertContinuityRequest(configuration:NonNullable<ReturnType<typeof continuityEvaluationConfiguration>>,context:{projectId:string;sessionId:string;turnId:string}|undefined,sessionId:string,readSession:()=>Promise<any>){
  const stop=(reason:string):never=>{fs.writeFileSync(path.join(configuration.profile,'continuity-request-stop.json'),JSON.stringify({reason,at:new Date().toISOString(),context})+'\n');throw Error('EVALUATION_REQUEST_LIMIT');};
  try{
    const prompt=JSON.parse(read(path.join(configuration.profile,'continuity-prompt.json')));
    if(!context||context.sessionId!==sessionId||prompt.sessionId!==sessionId||prompt.runId!==configuration.runId||prompt.manifestHash!==configuration.manifestHash||prompt.caseId!==configuration.entry.id||!context.projectId||!context.turnId||typeof prompt.messageId!=='string')return stop('CONTINUITY_REQUEST_CONTEXT_CHANGED');
    if(!Number.isFinite(Date.parse(prompt.at))||Date.now()-Date.parse(prompt.at)>CONTINUITY_EVALUATION_LIMITS.maxCaseMs)return stop('CONTINUITY_CASE_TIMEOUT');
    const actual=await readSession(),messages=actual?.session?.messages;
    if(actual?.session?.id!==sessionId||!Array.isArray(messages))return stop('CONTINUITY_HISTORY_UNAVAILABLE');
    const start=messages.findIndex((item:any)=>item.role==='user'&&item.id===prompt.messageId&&item.content===configuration.entry.request);
    if(start<0||messages.slice(start+1).some((item:any)=>item.role==='user'))return stop('CONTINUITY_PROMPT_CHANGED');
    const binding={...context,messageId:prompt.messageId,manifestHash:configuration.manifestHash},file=path.join(configuration.profile,'continuity-turn.json');
    if(fs.existsSync(file)){if(JSON.stringify(JSON.parse(read(file)))!==JSON.stringify(binding))return stop('CONTINUITY_TURN_CHANGED');}
    else fs.writeFileSync(file,JSON.stringify(binding)+'\n',{flag:'wx'});
    const state=continuityRepairState(messages.slice(start+1));
    if(state.repairs>2||state.repairs===2&&state.failed)return stop('CONTINUITY_REPAIR_LIMIT');
  }catch(error){if((error as Error).message==='EVALUATION_REQUEST_LIMIT')throw error;return stop('CONTINUITY_HISTORY_UNCONFIRMED');}
}
