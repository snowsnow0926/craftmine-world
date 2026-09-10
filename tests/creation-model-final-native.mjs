// Recover adopted CA07 without another prompt, then try only untouched HOLDOUT01.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {loadLocalConfig} from '../app/local-config.mjs';
import {creationNativeSession} from './helpers/creation-native-session.mjs';
import {digest,treeFiles,validateInheritedBudget} from './helpers/creation-model-continuation.mjs';
import {CREATION_MODEL_CASES,MODEL_LIMITS,completeCreationProgress,inspectCreationOutcome,classifyModelCase,summarizeModelCases,countModelRepairs} from './helpers/creation-model-evaluation.mjs';

const root=path.resolve(process.env.CRAFTMINE_SOURCE_ROOT??process.cwd());
const rawRecovery=process.env.CRAFTMINE_CONTINUATION_RECOVERY;
assert.ok(rawRecovery&&path.isAbsolute(rawRecovery));
const recoveryFile=path.resolve(rawRecovery);
const out=path.dirname(recoveryFile),profile=path.join(out,'profile');
assert.equal(path.dirname(out),path.join(root,'test-results'));
assert.ok(path.basename(out).startsWith('desktop-native-'));
const read=name=>JSON.parse(fs.readFileSync(path.join(out,name)));
const recovery=read('report.json'),previous=read('continuation-recovered-report.json'),state=read('continuation-state.json');
assert.ok(recovery.recovery.passed&&previous.cases.find(c=>c.id==='CA07').error==='EVALUATION_SESSION_MISSING');
assert.ok(previous.cases.find(c=>c.id==='HOLDOUT01').outcome==='not_run'&&!state.attempted.includes('HOLDOUT01'));
const claim=JSON.parse(fs.readFileSync(path.join(root,'test-results/creation-continuation-claims',recovery.parentReportSha256+'.json')));
assert.equal(claim.profile,profile);assert.equal(claim.recoveryReportSha256,digest(fs.readFileSync(recoveryFile)));
assert.equal(state.sessionId,previous.preDispatchRecovery.newSessionId);
const budgetFile=path.join(profile,'creation-evaluation-budget.json'),budgetBeforeBytes=fs.readFileSync(budgetFile),budgetBefore=JSON.parse(budgetBeforeBytes);
const origin=path.dirname(recovery.parentReport),originalFiles=read('origin-files.json');
const initialBudget=JSON.parse(fs.readFileSync(path.join(origin,'profile/creation-evaluation-budget.json')));
assert.equal(validateInheritedBudget(initialBudget,budgetBefore).reserved,37);
assert.ok(isDeepStrictEqual(treeFiles(origin),originalFiles));
const attemptFile=path.join(out,'final-continuation-attempt.json');
assert.ok(!fs.existsSync(attemptFile),'FINAL_CONTINUATION_ALREADY_ATTEMPTED');
const config={};assert.ok(process.env.CRAFTMINE_LIVE_CONFIG&&path.isAbsolute(process.env.CRAFTMINE_LIVE_CONFIG));
loadLocalConfig(process.env.CRAFTMINE_LIVE_CONFIG,config);
const secret=config.CRAFTMINE_DEEPSEEK_API_KEY??config.DEEPSEEK_API_KEY??config.CRAFTMINE_EVAL_KEY;assert.ok(secret);
const safe=value=>typeof value==='string'?value.split(secret).join('[REDACTED]'):Array.isArray(value)?value.map(safe):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,safe(v)])):value;
const priorArtifact=read('recovered-CA07-continuation-partial.json'),priorSession=read('recovered-CA07-continuation-session.json'),sourceEvidence=read('CA06-continuation-runtime.json');
assert.equal(priorSession.job.status,'passed');assert.equal(priorSession.world.world.build.id,priorArtifact.after.buildId);
const item={...CREATION_MODEL_CASES.find(c=>c.id==='HOLDOUT01'),outcome:'not_run',submitted:false,modelRequests:0,humanIntervention:false,checks:[]};
const report={format:'craftmine.creation-next-model/1',scope:'ca07_artifact_recovery_and_final_untouched_case',out,sourceRoot:root,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim(),compiledMainSha256:digest(fs.readFileSync(path.join(root,'vendor/pi-desktop/apps/desktop/out/main/index.js'))),parentReportSha256:digest(fs.readFileSync(path.join(out,'continuation-recovered-report.json'))),budgetBefore:37,model:'deepseek-flash',provider:'deepseek',thinking:'high',startedAt:new Date().toISOString(),limits:MODEL_LIMITS,launches:[],recovery:{caseId:'CA07',scope:'original_model_artifact_recovery',newModelRequests:0,originalOutcome:'failed',checks:[],passed:false},cases:[item]};
const ledger=()=>validateInheritedBudget(initialBudget,JSON.parse(fs.readFileSync(budgetFile)));
const save=()=>{report.budgetAfter=ledger();report.summary=summarizeModelCases(report.cases);fs.writeFileSync(path.join(out,'final-continuation-report.json'),JSON.stringify(safe(report),null,2));};
const evidence=(name,value)=>{const bytes=JSON.stringify(safe(value),null,2),file='final-'+name+'.json';fs.writeFileSync(path.join(out,file),bytes);return {file,sha256:digest(bytes)};};
const marker=read('profile/headless-profile.json');
const client=creationNativeSession({root,out,profile,token:marker.token,sessionId:state.sessionId,worldId:state.worldId,secret,launches:report.launches,logPrefix:'final'});
const progress=async()=>completeCreationProgress(await client.native('godotSnapshot'));
const settle=id=>client.until(()=>client.native('worldNavigationReady'),s=>s.worldId===id&&s.ready,'navigation');
let baseline,final,before,after,beforeProgress,afterProgress,target,reopened,restored;
fs.writeFileSync(attemptFile,JSON.stringify({format:'craftmine.final-continuation-attempt/1',phase:'zero-request-recovery',pid:process.pid,budgetSha256:digest(budgetBeforeBytes),sessionId:state.sessionId,worldId:state.worldId}),{flag:'wx'});
try{
 await client.boot();const restoredCopy=await client.native('godotObserve'),restoredCopyProgress=await progress(),initial=await client.evaluate('snapshot');
 assert.ok(!initial.active);assert.equal(initial.sessionId,state.sessionId);
 await client.nav('world.open',{id:sourceEvidence.after.worldId});await settle(sourceEvidence.after.worldId);await client.evaluate('pause-play');
 const originalWorld=await client.native('godotObserve'),originalProgress=await progress();
 const sourceUnchanged=originalWorld.buildId===sourceEvidence.after.buildId&&isDeepStrictEqual(originalWorld.payload.creation.entities,sourceEvidence.after.payload.creation.entities)&&isDeepStrictEqual(originalProgress,sourceEvidence.afterProgress);
 report.recovery.checks=inspectCreationOutcome({caseId:'CA07',before:priorArtifact.before,after:priorArtifact.after,target:priorArtifact.target,beforeProgress:priorArtifact.beforeProgress,afterProgress:priorArtifact.afterProgress,job:priorSession.job,reopened:restoredCopy,restoredProgress:restoredCopyProgress,copySourceUnchanged:sourceUnchanged});
 report.recovery.observations=evidence('CA07-recovery',{restoredCopy,restoredCopyProgress,originalWorld,originalProgress,sourceUnchanged});
 assert.ok(report.recovery.checks.every(c=>c.passed),'CA07_ZERO_REQUEST_RECOVERY_FAILED');
 await client.nav('world.open',{id:state.worldId});await settle(state.worldId);await client.evaluate('pause-play');
 assert.ok(fs.readFileSync(budgetFile).equals(budgetBeforeBytes),'CA07_RECOVERY_CHANGED_BUDGET');
 const afterRecovery=await client.evaluate('snapshot');assert.ok(isDeepStrictEqual(initial.metrics,afterRecovery.metrics)||initial.metrics.turnId===afterRecovery.metrics.turnId&&isDeepStrictEqual(initial.metrics.calls,afterRecovery.metrics.calls)&&isDeepStrictEqual(initial.metrics.usage,afterRecovery.metrics.usage));
 report.recovery.passed=true;report.recovery.budgetBytesUnchanged=true;save();console.log('CA07 artifact recovery: passed, zero new calls');
 await client.evaluate('resume-play');await client.evaluate(item.aim);target=await client.evaluate('capture');before=await client.native('godotObserve');beforeProgress=await progress();baseline=await client.evaluate('snapshot');
 const messages=snapshot=>snapshot.record?.session?.messages??[];
 assert.ok(!messages(baseline).some(m=>m.role==='user'&&m.content===item.request));
 const ids=new Set(messages(baseline).map(m=>m.id));item.startedAt=new Date().toISOString();item.beforeTurnId=baseline.metrics?.turnId??null;item.budgetAtStart=ledger();
 state.attempted.push('HOLDOUT01');fs.writeFileSync(path.join(out,'continuation-state.json'),JSON.stringify(state));
 fs.writeFileSync(attemptFile,JSON.stringify({format:'craftmine.final-continuation-attempt/1',phase:'holdout-registered-before-model',pid:process.pid,sessionId:state.sessionId,worldId:state.worldId}));save();
 const started=Date.now(),prompted=await client.evaluate('prompt','HOLDOUT01');item.promptResult=prompted.result;assert.equal(prompted.result?.ok,true);assert.equal(prompted.content,item.request);item.submitted=true;target=prompted.target;save();let sawTurn=false,lastLog=0;
 while(Date.now()-started<MODEL_LIMITS.maxCaseMs){
  final=await client.evaluate('snapshot');const recent=messages(final).filter(m=>!ids.has(m.id));sawTurn||=final.active||!!(final.metrics?.turnId&&final.metrics.turnId!==item.beforeTurnId);
  item.repairAttempts=countModelRepairs(recent);item.metrics=final.metrics?.turnId!==item.beforeTurnId?final.metrics:null;item.modelRequests=item.metrics?.calls?.observed??0;item.usage=item.metrics?.usage??null;save();
  if(Date.now()-lastLog>20000){console.log(`HOLDOUT01: ${final.job?.stage??'model'}, observed ${item.modelRequests}, reserved ${ledger().reserved}/40`);lastLog=Date.now();}
  if(item.repairAttempts>MODEL_LIMITS.maxRepairs){await client.evaluate('abort');throw Error('EVALUATION_REPAIR_LIMIT');}
  if(sawTurn&&!final.active)break;await delay(2000);
 }
 if(!sawTurn||final?.active){await client.evaluate('abort');throw Error('EVALUATION_CASE_TIMEOUT');}
 item.turnMessages=messages(final).filter(m=>!ids.has(m.id));item.transcript=evidence('HOLDOUT01-session',final);
 after=await client.native('godotObserve');await client.save();afterProgress=await progress();await client.stop();await client.boot();reopened=await client.native('godotObserve');restored=await progress();
 item.checks=inspectCreationOutcome({caseId:'HOLDOUT01',before,after,target,beforeProgress,afterProgress,job:final.job,reopened,restoredProgress:restored});
 item.observations=evidence('HOLDOUT01-runtime',{before,after,target,beforeProgress,afterProgress,job:final.job,reopened,restored});
 const failure=item.turnMessages.find(m=>m.role==='assistant'&&m.status==='error');if(failure)item.error=failure.error?.code??failure.error?.message??'MODEL_TURN_FAILED';
}catch(error){
 if(item.startedAt)item.error=String(error.message??error);else report.recovery.error=String(error.message??error);
 if(final)item.transcript??=evidence('HOLDOUT01-session',final);
 item.partialEvidence=evidence('HOLDOUT01-partial',{before,after,target,beforeProgress,afterProgress,reopened,restored});process.exitCode=1;
}finally{
 try{if(!client.isEnded()){const current=await client.evaluate('snapshot');if(current.active)await client.evaluate('abort');}}catch(error){report.shutdownObservationError=String(error);}
 try{await client.stop();}catch(error){report.shutdownError=String(error);process.exitCode=1;}
 item.finishedAt=new Date().toISOString();item.outcome=classifyModelCase(item);report.originalEvidenceUnchanged=isDeepStrictEqual(treeFiles(origin),originalFiles);report.finishedAt=new Date().toISOString();save();
 if(!report.recovery.passed||!report.originalEvidenceUnchanged||!['first_attempt_pass','model_repaired_pass'].includes(item.outcome))process.exitCode=1;
 console.log('Final continuation evidence: '+path.join(out,'final-continuation-report.json'));
}
