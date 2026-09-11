// Derive a compact report from preserved runs; never contact a model or rewrite evidence.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2);
if(args.length<2||args[0]!=='--out')throw Error('Usage: node scripts/report-creation-model-comparison.mjs --out <report.json> <run-directory> ...');
const [output,...directories]=args.slice(1);
if(!directories.length)throw Error('RUN_DIRECTORIES_REQUIRED');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function findTiming(value,depth=0){
 if(depth>8)return null;
 if(typeof value==='string'){try{return findTiming(JSON.parse(value),depth+1);}catch{return null;}}
 if(!value||typeof value!=='object')return null;
 if(value.format==='craftmine.creation-timing/1')return value;
 for(const item of Object.values(value)){const found=findTiming(item,depth+1);if(found)return found;}
 return null;
}
const duration=(a,b)=>{const value=Date.parse(b)-Date.parse(a);return Number.isFinite(value)&&value>=0?value:null;};
const rounds=directories.map(directory=>{
 const input=path.resolve(directory),reportPath=fs.statSync(input).isFile()?input:path.join(input,'report.json');
 const root=path.dirname(reportPath),raw=fs.readFileSync(reportPath),report=JSON.parse(raw);
 if(report.format!=='craftmine.creation-next-model/1')throw Error('MODEL_SUITE_MISMATCH:'+root);
 let ledger=null;const ledgerPath=path.join(root,'profile/plugins/data/craftmine.world/godot/executor-ledger.json');
 if(fs.existsSync(ledgerPath))ledger=JSON.parse(fs.readFileSync(ledgerPath,'utf8'));
 return {directory:root,reportPath,scope:report.scope??'live-model',parentReportSha256:report.parentReportSha256??null,budgetBefore:report.budgetBefore??null,budgetAfter:report.budgetAfter??null,reportSha256:sha(raw),sourceCommit:report.sourceCommit,compiledMainSha256:report.compiledMainSha256,model:report.model,provider:report.provider,limits:report.limits,summary:report.summary,
  cases:report.cases.map(item=>({id:item.id,request:item.request,evidenceUse:item.evidenceUse??'development_case',outcome:item.outcome,modelRequests:item.modelRequests,repairAttempts:item.repairAttempts??0,elapsedMs:item.elapsedMs??null,error:item.error??null,
   tools:(item.turnMessages??[]).filter(m=>m.role==='tool').map(m=>({name:m.toolName,elapsedMs:m.toolDurationMs??null,status:m.toolStatus??null,...(findTiming(m.toolResult??m.content)?{sourceTiming:findTiming(m.toolResult??m.content)}:{})}))})),
  jobs:Object.values(ledger?.jobs??{}).filter(job=>Date.parse(job.startedAt)>=Date.parse(report.startedAt)&&Date.parse(job.startedAt)<=Date.parse(report.finishedAt)).map(job=>({jobId:job.jobId,state:job.state,outcome:job.outcome,checkElapsedMs:duration(job.startedAt,job.finishedAt),brokerAttempts:job.attempts.map(attempt=>({operation:attempt.operation,outcome:attempt.outcome,elapsedMs:duration(attempt.startedAt,attempt.finishedAt)})),phaseTiming:job.phaseTiming??null,creationPackProof:job.creationPackProof??null})),
 };
});
const result={format:'craftmine.creation-model-comparison/1',generatedAt:new Date().toISOString(),rounds,totalObservedRequests:rounds.reduce((sum,round)=>sum+(round.summary?.requestCount??0),0),cost:null,notes:[
 '原始轮次预算分别记录；带parentReportSha256的续测沿用其原轮次预算，不视为新额度。保留原始失败分类，补验旧模型产物不计新增模型样本。',
 '原HOLDOUT01表达已用于开发，属于已知表达变体，不能作为未见需求的泛化证据。',
 '源码、检查器和runner在修复后变化；阶段计时是实际测量，不据此宣称同条件整体提速。',
 'timing.stages.passed仅表示调用正常返回；是否检查或采用成功以真实job/outcome为准。',
 '费用未由账单确认，保留null。物理麦克风、真人和干净Windows不属于本报告。',
]};
fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({output:path.resolve(output),rounds:rounds.length,totalObservedRequests:result.totalObservedRequests}));
