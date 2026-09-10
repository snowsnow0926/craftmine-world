import fs from 'node:fs';import path from 'node:path';import {createHash}from'node:crypto';import {isDeepStrictEqual}from'node:util';
export const digest=value=>createHash('sha256').update(value).digest('hex');
export function stoppedOriginal(report,budget){
 if(report?.format!=='craftmine.creation-next-model/1'||report.model!=='deepseek-flash'||report.provider!=='deepseek'||!report.sessionId||!report.worldId)throw Error('CONTINUATION_ORIGIN_INVALID');
 if(!report.launches?.length||report.launches.some(launch=>launch.exit?.code!==0||launch.forcedStop))throw Error('CONTINUATION_ORIGIN_NOT_CLOSED');
 const failed=report.cases?.find(item=>item.id==='CA05');
 if(failed?.outcome!=='failed'||failed.error!=='WORLD_BUSY'||!(failed.modelRequests>0))throw Error('CONTINUATION_EXPECTED_CA05_ARTIFACT_REQUIRED');
 if(budget?.format!=='craftmine.creation-evaluation-budget/1'||budget.limit!==40||!Array.isArray(budget.requests)||budget.requests.length!==25||new Set(budget.requests).size!==25)throw Error('CONTINUATION_EXPECTED_25_REQUEST_BUDGET');
 return failed;
}
export function allowedContinuationCase(report,caseId,attempted){
 if(!['CA06','CA07','HOLDOUT01'].includes(caseId)||attempted.includes(caseId))return false;
 const original=report.cases?.find(item=>item.id===caseId);return original?.outcome==='not_run'&&!original.submitted&&!original.startedAt&&(original.modelRequests??0)===0;
}
export function treeFiles(root){
 const result=[];function visit(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isSymbolicLink())throw Error('CONTINUATION_COPY_LINK_DENIED');if(entry.isDirectory())visit(file);else if(entry.isFile())result.push({path:path.relative(root,file).replaceAll('\\','/'),bytes:fs.statSync(file).size,sha256:digest(fs.readFileSync(file))});else throw Error('CONTINUATION_FILE_KIND_DENIED');}}visit(root);return result.sort((a,b)=>a.path.localeCompare(b.path));
}
export function validateInheritedBudget(before,after){
 if(after?.format!==before.format||after.limit!==40||!Array.isArray(after.requests)||after.requests.length<before.requests.length||after.requests.length>40||new Set(after.requests).size!==after.requests.length||before.requests.some((id,index)=>after.requests[index]!==id))throw Error('CONTINUATION_BUDGET_IDENTITY_CHANGED');
 return {limit:40,inherited:before.requests.length,reserved:after.requests.length,newReserved:after.requests.length-before.requests.length,remaining:40-after.requests.length};
}
export function assertRejectedBeforeModel({attempt,turn,messages,calls,gaps,interruptions,budget}){
 if(attempt?.id!=='CA07'||attempt.submitted!==false||attempt.modelRequests!==0||attempt.promptResult?.ok!==false||attempt.promptResult.error?.code!=='CREATION_TARGET_STALE'||!attempt.finishedAt||attempt.budgetAtStart?.reserved!==31)throw Error('CONTINUATION_NOT_PROVEN_PRE_DISPATCH');
 if(turn?.status!=='error'||turn.error_code!=='CREATION_TARGET_STALE'||turn.input_tokens!==0||turn.output_tokens!==0||turn.usage_json!==null||!turn.ended_at||turn.started_at<Date.parse(attempt.startedAt)||turn.ended_at>Date.parse(attempt.finishedAt)||calls!==0||gaps!==0||interruptions!==0)throw Error('CONTINUATION_MODEL_DISPATCH_UNCERTAIN');
 if(messages.length!==1||messages[0].role!=='user'||messages[0].text!==attempt.request||messages[0].is_error!==0)throw Error('CONTINUATION_TRANSCRIPT_UNCERTAIN');
 if(budget?.limit!==40||budget.requests?.length!==31||new Set(budget.requests).size!==31)throw Error('CONTINUATION_EXPECTED_31_REQUEST_BUDGET');
 return {reason:'rejected-before-model',turnId:turn.id,modelRequests:0,reserved:31};
}
// Reopening can legitimately consume physics ticks before the pause request.
// Only the already-authored countdown may advance; every other saved field must match.
export function compareHarvestRestore(saved,restored,ruleId,physicsTick){
 const previous=saved?.body?.rules?.[ruleId],current=restored?.body?.rules?.[ruleId];
 if(!previous||!current)return {equal:false,reason:'RULE_STATE_MISSING'};
 const decrease=previous.remainingFrames-current.remainingFrames;
 if(!Number.isInteger(decrease)||decrease<0||!Number.isInteger(current.remainingFrames)||current.remainingFrames<0||!Number.isInteger(physicsTick)||physicsTick<0||decrease>physicsTick+1||current.chopped!==(current.remainingFrames>0))return {equal:false,reason:'COUNTDOWN_NOT_CONTINUOUS',decrease,physicsTick};
 const expected=structuredClone(saved);expected.body.rules[ruleId].remainingFrames=current.remainingFrames;expected.body.rules[ruleId].chopped=current.chopped;
 return {equal:isDeepStrictEqual(expected,restored),exact:isDeepStrictEqual(saved,restored),decrease,physicsTick,scope:'Only actual elapsed physics countdown advances; all other progress is exact'};
}
