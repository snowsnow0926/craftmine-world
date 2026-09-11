// One predeclared development round. No model request occurs in --plan or --freeze.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {randomUUID} from 'node:crypto';import {setTimeout as delay} from 'node:timers/promises';
import {loadLocalConfig} from '../app/local-config.mjs';import {createCompleteOutput} from './godot-final/complete-contract.mjs';
import {resolveCreationNativeLaunch} from './helpers/creation-native-launch.mjs';import {creationNativeSession} from './helpers/creation-native-session.mjs';
import {classifyModelCase,countModelRepairs,summarizeModelCases,successfulOutcomes} from './helpers/creation-model-evaluation.mjs';
import {CONTINUITY_EVALUATION_SUITE as suite,CONTINUITY_EVALUATION_CASES as cases,CONTINUITY_EVALUATION_LIMITS as limits,continuityHash as hash,claimContinuityAttempt,claimContinuityCase,inspectContinuityOutcome} from './helpers/creation-continuity-evaluation.mjs';
const root=path.resolve(process.env.CRAFTMINE_SOURCE_ROOT??process.cwd()),args=process.argv.slice(2),value=name=>{const at=args.indexOf(name);assert.ok(at>=0&&args[at+1]&&!args[at+1].startsWith('--'),'Value required: '+name);return args[at+1];};
const spec={format:suite,evidenceUse:'development_cases',cases,limits};
if(args.includes('--plan')){console.log(JSON.stringify({...spec,modelRequests:0},null,2));process.exit(0);}
function buildIdentity(client){
 const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim();
 if(client.identity)return {sourceCommit,package:client.identity};
 const env=client.environment({out:root,profile:root,token:'identity-only'}),desktop=path.join(root,'vendor/pi-desktop/apps/desktop'),bases=env.CRAFTMINE_GODOT_BASES;
 const paths=[path.join(desktop,'out/main/index.js'),path.join(desktop,'out/preload/craftmine-headless.cjs'),env.CRAFTMINE_CORE_BIN,env.PI_DESKTOP_HOST_BIN,path.join(bases,'bases/creation-sandbox/manifest.json'),path.join(desktop,'resources/plugins/craftmine.world/guidance/catalog.json'),path.join(root,'desktop/build/runtime-resources/godot/toolchain.lock.json')];
 return {sourceCommit,files:paths.map(file=>{const bytes=fs.readFileSync(file);return {path:file,bytes:bytes.length,sha256:hash(bytes)};})};
}
if(args.includes('--freeze')){
 const client=resolveCreationNativeLaunch({root,requiredGuards:['prepare-continuity','craftmine-creation-evaluation','EVALUATION_REQUEST_LIMIT']}),out=createCompleteOutput(root,path.resolve(value('--freeze'))),runId=randomUUID(),model=process.env.CRAFTMINE_EVAL_MODEL??'deepseek-flash',thinking=process.env.CRAFTMINE_EVAL_THINKING??'high';
 assert.match(model,/^deepseek-[a-z0-9.-]+$/);assert.equal(thinking,'high');
 const manifest={...spec,runId,createdAt:new Date().toISOString(),model,thinking,root,packagedRoot:client.packaged,identity:buildIdentity(client)};
 for(const entry of cases){const directory=path.join(out,entry.id);fs.mkdirSync(directory);fs.mkdirSync(path.join(directory,'profile'));fs.mkdirSync(path.join(directory,'legacy'));}
 const file=path.join(out,'suite-manifest.json');fs.writeFileSync(file,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({manifest:file,manifestHash:hash(fs.readFileSync(file)),modelRequests:0}));process.exit(0);
}
assert.ok(args.includes('--run'),'Use --plan, --freeze <test-results parent>, or --run --manifest <file>');
assert.equal(process.env.CRAFTMINE_CREATION_CONTINUITY_EVAL,'1','Explicit continuity model round authorization required');
const manifestPath=path.resolve(value('--manifest')),out=path.dirname(manifestPath),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
assert.equal(manifest.format,suite);assert.equal(manifest.evidenceUse,'development_cases');assert.deepEqual(manifest.cases,cases);assert.deepEqual(manifest.limits,limits);assert.equal(path.resolve(manifest.root),root);
const clientIdentity=resolveCreationNativeLaunch({root,packagedRoot:manifest.packagedRoot,requiredGuards:['prepare-continuity','craftmine-creation-evaluation','EVALUATION_REQUEST_LIMIT']});
const verifyFrozen=()=>{clientIdentity.assertUnchanged();assert.deepEqual(buildIdentity(clientIdentity),manifest.identity,'Frozen build identity changed');};verifyFrozen();
const configPath=process.env.CRAFTMINE_LIVE_CONFIG;assert.ok(configPath&&path.isAbsolute(configPath));const config={};loadLocalConfig(configPath,config);const secret=config.CRAFTMINE_DEEPSEEK_API_KEY??config.DEEPSEEK_API_KEY??config.CRAFTMINE_EVAL_KEY;assert.ok(secret,'Explicit authorized DeepSeek configuration required');
const attempt=claimContinuityAttempt(manifestPath),report={format:suite,evidenceUse:'development_cases',manifestPath,manifestHash:attempt.manifestHash,startedAt:new Date().toISOString(),limits,cases:cases.map(entry=>({...entry,submitted:false,modelRequests:0,repairAttempts:0,checks:[],outcome:'not_run',launches:[]}))};
const sanitize=value=>typeof value==='string'?value.split(secret).join('[REDACTED]'):Array.isArray(value)?value.map(sanitize):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,/^(?:secretValue|apiKey|authorization|CRAFTMINE_EVAL_KEY)$/i.test(key)?'[REDACTED]':sanitize(item)])):value;
const save=()=>{report.summary=summarizeModelCases(report.cases);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(sanitize(report),null,2)+'\n');};
const evidence=(caseId,name,data)=>{const file=path.join(out,caseId,name+'.json'),text=JSON.stringify(sanitize(data),null,2)+'\n';fs.writeFileSync(file,text);return {file,bytes:Buffer.byteLength(text),sha256:hash(text)};};
const messages=snapshot=>snapshot?.record?.session?.messages??snapshot?.record?.messages??[];
save();
for(const result of report.cases){
 const entry=cases.find(item=>item.id===result.id),profile=path.join(out,entry.id,'profile'),token=randomUUID();claimContinuityCase(out,attempt,entry.id);
 assert.deepEqual(fs.readdirSync(profile),[],'Each case must start in its original empty profile');
 fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource:path.join(out,entry.id,'legacy')}));
 const client=creationNativeSession({root,out,profile,token,secret,launches:result.launches,logPrefix:entry.id,packagedRoot:manifest.packagedRoot,continuity:{caseId:entry.id,manifestPath},model:manifest.model,thinking:manifest.thinking});
 let baseline,before,beforeProgress,prompted,finalSnapshot,after,afterProgress,reopened,restored;
 result.startedAt=new Date().toISOString();save();
 try{
  verifyFrozen();await client.boot();result.context=client.context();
  const prepared=await client.evaluate('prepare-continuity',entry.id);assert.equal(prepared.budget.reserved,0);result.preparation=evidence(entry.id,'input-preparation',prepared);
  before=await client.native('godotObserve');beforeProgress=await client.native('godotSnapshot');baseline=await client.evaluate('snapshot');assert.equal(baseline.budget.limit,10);assert.equal(baseline.budget.reserved,0);
  result.input=evidence(entry.id,'frozen-input',{entry,prepared,before,beforeProgress,baseline});
  const began=Date.now();prompted=await client.evaluate('prompt',entry.id);result.prompt=evidence(entry.id,'actual-prompt',prompted);assert.equal(prompted.content,entry.request);assert.equal(prompted.result?.ok,true,JSON.stringify(prompted.result));result.submitted=true;
  const beforeIds=new Set(messages(baseline).map(item=>item.id));let sawTurn=false,lastProgress='',lastAnnouncement=0;
  while(Date.now()-began<limits.maxCaseMs){
   finalSnapshot=await client.evaluate('snapshot');const fresh=messages(finalSnapshot).filter(item=>!beforeIds.has(item.id)),metrics=finalSnapshot.metrics?.turnId!==baseline.metrics?.turnId?finalSnapshot.metrics:null;
   sawTurn ||= finalSnapshot.active||fresh.some(item=>item.role==='user'&&item.content===entry.request);
   result.modelRequests=metrics?.calls?.observed??0;result.usage=metrics?.usage??null;result.budget=finalSnapshot.budget;result.repairAttempts=countModelRepairs(fresh);
   const progress={active:finalSnapshot.active,jobId:finalSnapshot.job?.jobId,status:finalSnapshot.job?.status,stage:finalSnapshot.job?.stage,application:finalSnapshot.application,requests:result.modelRequests,reserved:result.budget.reserved};
   if(JSON.stringify(progress)!==lastProgress){(result.progress??=[]).push({elapsedMs:Date.now()-began,...progress});lastProgress=JSON.stringify(progress);save();}
   if(Date.now()-lastAnnouncement>20000){console.log(entry.id+': '+JSON.stringify(progress));lastAnnouncement=Date.now();}
   if(result.repairAttempts>limits.maxRepairs){await client.evaluate('abort');throw Error('CONTINUITY_REPAIR_LIMIT');}
   if(sawTurn&&!finalSnapshot.active)break;await delay(1500);
  }
  if(!sawTurn||finalSnapshot?.active){await client.evaluate('abort');throw Error('CONTINUITY_CASE_TIMEOUT');}
  result.elapsedMs=Date.now()-began;result.transcript=evidence(entry.id,'model-session',finalSnapshot);
  result.turnMessages=messages(finalSnapshot).filter(item=>!beforeIds.has(item.id));const failure=result.turnMessages.find(item=>item.role==='assistant'&&item.status==='error');if(failure)result.error=failure.error?.code??failure.error?.message??'MODEL_TURN_FAILED';
  after=await client.native('godotObserve');await client.save();afterProgress=await client.native('godotSnapshot');
  await client.stop();verifyFrozen();await client.boot();reopened=await client.native('godotObserve');restored=await client.native('godotSnapshot');
  result.checks=inspectContinuityOutcome({entry,before,after,target:prompted.target,beforeProgress,afterProgress,job:finalSnapshot.job,reopened,restoredProgress:restored});
  result.runtime=evidence(entry.id,'runtime-result',{before,after,target:prompted.target,beforeProgress,afterProgress,job:finalSnapshot.job,reopened,restored});
 }catch(error){result.error=String(error?.message??error);if(finalSnapshot)result.transcript??=evidence(entry.id,'model-session-failed',finalSnapshot);result.partial=evidence(entry.id,'partial-result',{before,beforeProgress,prompted,after,afterProgress,reopened,restored});}
 finally{
  try{if(!client.isEnded()){
   let state=await client.evaluate('snapshot');if(state.active){await client.evaluate('abort');await client.until(()=>client.evaluate('snapshot'),snapshot=>!snapshot.active,'abort settled');state=await client.evaluate('snapshot');}
   result.budget=state.budget;
   if(baseline&&state.metrics?.turnId!==baseline.metrics?.turnId){result.modelRequests=state.metrics?.calls?.observed??result.modelRequests;result.usage=state.metrics?.usage??result.usage;}
   result.finalSession=evidence(entry.id,'session-after-settlement',state);
  }}catch(error){result.shutdownError=String(error);result.error??=result.shutdownError;}
  finally{try{await client.stop();verifyFrozen();}catch(error){result.shutdownError=String(error);result.error??=result.shutdownError;}}
  const budgetFile=path.join(profile,'creation-evaluation-budget.json');if(fs.existsSync(budgetFile)){const budget=JSON.parse(fs.readFileSync(budgetFile,'utf8'));result.reservedRequests=budget.requests.length;assert.equal(budget.limit,10);assert.ok(result.reservedRequests<=10);}
  result.outcome=classifyModelCase(result);result.finishedAt=new Date().toISOString();save();console.log(entry.id+': '+result.outcome);
 }
}
report.finishedAt=new Date().toISOString();report.reservedRequests=report.cases.reduce((sum,item)=>sum+(item.reservedRequests??0),0);assert.ok(report.reservedRequests<=40);save();console.log('Continuity evidence: '+out);if(report.cases.some(item=>!successfulOutcomes.has(item.outcome)))process.exitCode=1;
