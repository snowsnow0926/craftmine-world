// Actual product model/runtime evaluation. No mock answers, source edits, or OS input.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {createRequire} from 'node:module';
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {loadLocalConfig} from '../app/local-config.mjs';
import {createCompleteOutput,completeEnvironment} from './godot-final/complete-contract.mjs';
import {assertCleanHeadlessShutdown} from './player-product/shutdown-exit-audit.mjs';
import {CREATION_MODEL_SUITE,CREATION_MODEL_CASES,MODEL_LIMITS,classifyModelCase,summarizeModelCases,completeCreationProgress,inspectCreationOutcome,countModelRepairs,successfulOutcomes} from './helpers/creation-model-evaluation.mjs';

const requested=(process.env.CRAFTMINE_EVAL_CASES??(process.env.CRAFTMINE_EVAL_SUITE==='full'?'CA01,CA02,CA03,CA04,CA06,CA07,HOLDOUT01,CA05':'CA01,CA02,CA03,CA04')).split(',');
assert.ok(requested.length<=MODEL_LIMITS.maxCases&&new Set(requested).size===requested.length&&requested.every(id=>CREATION_MODEL_CASES.some(item=>item.id===id)),'Invalid fixed evaluation cases');
const cases=requested.map(id=>CREATION_MODEL_CASES.find(item=>item.id===id));
if(process.argv.includes('--plan')){console.log(JSON.stringify({suite:CREATION_MODEL_SUITE,cases,limits:MODEL_LIMITS,liveModelRequests:0},null,2));process.exit(0);}
assert.equal(process.env.CRAFTMINE_CREATION_EVAL,'1','Explicit CRAFTMINE_CREATION_EVAL=1 is required');
const sourceRoot=path.resolve(process.env.CRAFTMINE_SOURCE_ROOT??process.cwd()),desktop=path.join(sourceRoot,'vendor/pi-desktop/apps/desktop');
const require=createRequire(path.join(desktop,'package.json'));
const configPath=process.env.CRAFTMINE_LIVE_CONFIG;
assert.ok(configPath&&path.isAbsolute(configPath)&&fs.existsSync(configPath),'Explicit authorized CRAFTMINE_LIVE_CONFIG required');
// Credentials are taken only from this explicit file; inherited provider settings are not changed.
const config={};try{loadLocalConfig(configPath,config);}catch{throw Error('EXPLICIT_LIVE_CONFIG_INVALID');}
const secret=config.CRAFTMINE_DEEPSEEK_API_KEY??config.DEEPSEEK_API_KEY??config.CRAFTMINE_EVAL_KEY;
assert.ok(secret&&(!config.CRAFTMINE_MODEL_PROVIDER||config.CRAFTMINE_MODEL_PROVIDER==='deepseek'),'Explicit DeepSeek credentials required; no provider fallback');
const model=process.env.CRAFTMINE_EVAL_MODEL??'deepseek-flash';assert.match(model,/^deepseek-[a-z0-9.-]+$/);
const compiled=fs.readFileSync(path.join(desktop,'out/main/index.js'),'utf8');
for(const guard of ['configureHeadlessAcceptance()','focusable: !headlessAcceptance','offscreen: !!headlessAcceptance','Headless window was not created offscreen','craftmine-creation-evaluation','EVALUATION_REQUEST_LIMIT'])assert.ok(compiled.includes(guard),'EVALUATION_BUILD_REQUIRED: '+guard);
assert.ok(fs.readFileSync(path.join(desktop,'out/preload/craftmine-headless.cjs'),'utf8').includes('requestPointerLock'));
const out=createCompleteOutput(sourceRoot,process.env.CRAFTMINE_TEST_OUTPUT_ROOT),profile=path.join(out,'profile'),token=randomUUID(),legacySource=path.join(out,'legacy');
fs.mkdirSync(profile);fs.mkdirSync(legacySource);fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource}));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={format:CREATION_MODEL_SUITE,startedAt:new Date().toISOString(),sourceRoot,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:sourceRoot,encoding:'utf8',windowsHide:true}).trim(),compiledMainSha256:hash(compiled),model,provider:'deepseek',out,limits:MODEL_LIMITS,launches:[],cases:cases.map(item=>({...item,outcome:'not_run',submitted:false,modelRequests:0,humanIntervention:false,checks:[]})),limitsOfEvidence:['Unscripted real model requests in the production runtime; runner only prepares navigation and observes','No live microphone, subjective playtest, purchase, or personal installation access','New suite inputs are distinct from historical Alpha CA identifiers']};
const sanitize=value=>{if(typeof value==='string')return value.split(secret).join('[REDACTED]');if(Array.isArray(value))return value.map(sanitize);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,/^(?:secretValue|apiKey|authorization|CRAFTMINE_EVAL_KEY)$/i.test(key)?'[REDACTED]':sanitize(item)]));return value;};
const save=()=>{report.summary=summarizeModelCases(report.cases);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(sanitize(report),null,2));};
let child,ended=true,ready=false,exit=Promise.resolve(),launch,sessionId='',worldId='';
const pending=new Map(),logs=new Map();
function start(){
  assert.ok(ended);ended=false;ready=false;launch={number:report.launches.length+1,startedAt:new Date().toISOString()};report.launches.push(launch);
  const env=completeEnvironment(process.env,{out,profile,token,core:process.env.CRAFTMINE_EVAL_CORE??path.join(sourceRoot,'vendor/pi-desktop/target/release/craftmine-core.exe'),host:process.env.CRAFTMINE_EVAL_HOST??path.join(sourceRoot,'vendor/pi-desktop/target/release/pi-desktop-host-core.exe'),bases:process.env.CRAFTMINE_EVAL_BASES??path.join(sourceRoot,'desktop/godot')});
  Object.assign(env,{CRAFTMINE_CREATION_EVAL:'1',CRAFTMINE_EVAL_MODEL:model,CRAFTMINE_EVAL_KEY:secret,CRAFTMINE_EVAL_THINKING:process.env.CRAFTMINE_EVAL_THINKING??'high',...(sessionId?{CRAFTMINE_EVAL_SESSION:sessionId}:{})});
  child=spawn(require('electron'),[desktop],{cwd:sourceRoot,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});launch.pid=child.pid;const current=launch;
  for(const stream of ['stdout','stderr'])child[stream].on('data',bytes=>{const name=`${current.number}-${stream}.log`;let text=(logs.get(name)??'')+bytes.toString('utf8');if(text.length>8*1024*1024)text=text.slice(-8*1024*1024);logs.set(name,text);});
  child.on('message',message=>{if(message?.type==='craftmine-headless-ready')ready=true;if(message?.type==='craftmine-headless-exit')current.audit=message;
    if(!['craftmine-headless','craftmine-creation-evaluation'].includes(message?.type))return;const call=pending.get(message.id);if(!call)return;clearTimeout(call.timer);pending.delete(message.id);message.error?call.reject(Error(message.error)):call.resolve(message.result);});
  exit=new Promise(resolve=>{const finish=(code,signal,error)=>{if(ended)return;ended=true;current.exit={code,signal,...(error?{error:String(error)}:{})};for(const call of pending.values()){clearTimeout(call.timer);call.reject(Error('Electron exited'));}pending.clear();save();resolve();};child.once('exit',(code,signal)=>finish(code,signal));child.once('error',error=>finish(null,null,error));});
}
const rpc=(type,method,payload={},timeout=30000)=>new Promise((resolve,reject)=>{if(ended||!child.connected)return reject(Error('Electron exited'));const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('Timed out: '+method));},timeout);pending.set(id,{resolve,reject,timer});child.send({type,id,method,...payload});});
const native=(method,payload={},timeout)=>rpc('craftmine-headless',method,payload,timeout);
const evaluate=(method,caseId)=>rpc('craftmine-creation-evaluation',method,caseId?{caseId}:{},60000);
const nav=(channel,payload={})=>native('worldNavigation',{channel,payload},180000);
const until=async(read,accept,label,timeout=90000)=>{const deadline=Date.now()+timeout;let value;while(Date.now()<deadline){if(ended)throw Error('Electron exited');try{value=await read();if(accept(value))return value;}catch(error){if(!/WORLD_BUSY|GODOT_CANDIDATE_ACTIVE/.test(String(error.message)))throw error;}await delay(500);}throw Error(label+' timed out');};
async function isolation(){const state=await native('status');assert.deepEqual(state.violations,[]);assert.ok(state.windows.length&&state.windows.every(window=>!window.visible&&!window.focused&&!window.focusable&&window.offscreen));return state;}
async function started(){await until(async()=>ready,Boolean,'Headless controller');await until(()=>native('status'),state=>state.windows.length>0,'Main window');await isolation();await until(()=>nav('world.createOptions'),value=>value.bases?.some(base=>base.id==='creation-sandbox'),'Creation catalog');}
async function settled(id){await until(async()=>{const result=await nav('world.list'),entry=result.worlds?.find(item=>item.id===id);if(entry?.state==='failed')throw Error('WORLD_INITIALIZATION_FAILED: '+JSON.stringify(entry.creation));return entry;},entry=>entry?.state==='ready','World initialization',900000);await until(()=>native('godotObserve'),value=>value.worldId===id&&value.instanceId,'Real formal runtime');await until(()=>native('worldNavigationReady'),value=>value.ready&&value.worldId===id,'World controls');}
async function stop(){if(!launch)return;if(!ended){try{await native('quit',{},5000);}catch{}await Promise.race([exit,delay(15000)]);if(!ended){launch.forcedStop=true;child.kill();await Promise.race([exit,delay(5000).then(()=>{throw Error('FORCED_STOP_TIMEOUT');})]);}}assertCleanHeadlessShutdown(launch);for(const [name,text]of logs)fs.writeFileSync(path.join(out,name),sanitize(text));logs.clear();}
async function restart(){await stop();start();await started();try{await nav('world.open',{id:worldId});}catch(error){if(!String(error.message).includes('WORLD_BUSY'))throw error;}await settled(worldId);const initialized=await evaluate('initialize');assert.equal(initialized.sessionId,sessionId);assert.equal(initialized.reopened,true);}
const messages=snapshot=>snapshot.record?.session?.messages??snapshot.record?.messages??[];
const evidence=(name,value)=>{const file=`${name}.json`,text=JSON.stringify(sanitize(value),null,2);fs.writeFileSync(path.join(out,file),text);return{file,sha256:hash(text)};};
async function runCase(result){
  const begin=Date.now();result.startedAt=new Date().toISOString();let before,after,prepared,progressBefore,progressAfter,reopened,restored,baseline,finalSnapshot,originalWorld,originalSnapshot,originalObservation;
  try{
    if(result.id==='CA07'){
      originalWorld=worldId;await native('worldPanel',{channel:'godot.runtimeSave',payload:{worldId,freeze:true}});originalSnapshot=completeCreationProgress(await native('godotSnapshot'));originalObservation=await native('godotObserve');
      const copied=await nav('world.copy',{worldId,operationId:randomUUID(),title:'真实模型评测独立副本'});assert.equal(copied.status,'ready');assert.notEqual(copied.targetWorldId,originalWorld);worldId=copied.targetWorldId;await settled(worldId);await evaluate('enable-auto-apply');
    }
    if(result.id==='CA06')await restart();
    await evaluate(result.aim);prepared=await evaluate('capture');before=await native('godotObserve');progressBefore=await native('godotSnapshot');baseline=await evaluate('snapshot');
    if(baseline.budget?.remaining<1)throw Error('EVALUATION_REQUEST_LIMIT');
    const ids=new Set(messages(baseline).map(item=>item.id));
    const prompted=await evaluate('prompt',result.id);assert.equal(prompted.content,result.request);prepared=prompted.target;result.promptResult=prompted.result;assert.equal(prompted.result?.ok,true,JSON.stringify(prompted.result));result.submitted=true;
    let sawTurn=false,lastFingerprint='',lastStatusAt=0;
    while(Date.now()-begin<MODEL_LIMITS.maxCaseMs){
      finalSnapshot=await evaluate('snapshot');const recent=messages(finalSnapshot).filter(item=>!ids.has(item.id));result.repairAttempts=countModelRepairs(recent);
      sawTurn ||= finalSnapshot.active||recent.some(item=>item.role==='user'&&item.content===result.request)||!!(finalSnapshot.metrics?.turnId&&finalSnapshot.metrics.turnId!==baseline.metrics?.turnId);
      const freshMetrics=finalSnapshot.metrics?.turnId!==baseline.metrics?.turnId?finalSnapshot.metrics:null;
      result.modelRequests=freshMetrics?.calls?.observed??0;result.usage=freshMetrics?.usage??null;result.metrics=freshMetrics;result.budget=finalSnapshot.budget;
      const phase={active:finalSnapshot.active,jobId:finalSnapshot.job?.jobId,status:finalSnapshot.job?.status,stage:finalSnapshot.job?.stage,requests:result.modelRequests,reserved:result.budget?.reserved};
      const fingerprint=JSON.stringify(phase);if(fingerprint!==lastFingerprint){(result.progress??=[]).push({elapsedMs:Date.now()-begin,...phase});lastFingerprint=fingerprint;save();}
      if(Date.now()-lastStatusAt>20000){console.log(`${result.id}: ${phase.stage??phase.status??'model'}; observed requests=${result.modelRequests}`);lastStatusAt=Date.now();}
      if(result.repairAttempts>MODEL_LIMITS.maxRepairs){await evaluate('abort');throw Error('EVALUATION_REPAIR_LIMIT');}
      if(sawTurn&&!finalSnapshot.active)break;
      await delay(2000);
    }
    if(!sawTurn||finalSnapshot?.active){await evaluate('abort');await until(()=>evaluate('snapshot'),snapshot=>!snapshot.active,'Abort settles');throw Error('EVALUATION_CASE_TIMEOUT');}
    result.transcript=evidence(`${result.id}-session`,finalSnapshot);result.turnMessages=messages(finalSnapshot).filter(item=>!ids.has(item.id));
    after=await native('godotObserve');await native('worldPanel',{channel:'godot.runtimeSave',payload:{worldId,freeze:true}});progressAfter=await native('godotSnapshot');
    // Runtime effects are inspected before this runner can count a model answer as success.
    if(result.id==='CA05'){
      const behavior={ordinaryScript:false};result.behavior=behavior;
      await evaluate('resume-play');
      await evaluate('aim-tree');behavior.before=await native('godotObserve');behavior.woodBefore=behavior.before.payload?.inventory?.wood??0;
      behavior.chop=await evaluate('chop-tree');behavior.after=await native('godotObserve');behavior.woodAfter=behavior.after.payload?.inventory?.wood??0;
      const treeId=prepared.target?.entityId;behavior.treeAbsent=!behavior.after.payload?.creation?.obstacles?.some(item=>item.entityId===treeId);
      const firstRules=Object.keys(completeCreationProgress(progressBefore).body.rules),newRules=Object.keys(completeCreationProgress(await native('godotSnapshot')).body.rules).filter(id=>!firstRules.includes(id));
      behavior.ordinaryScript=newRules.length>0&&result.turnMessages.some(item=>/godot_project_patch/.test(item.toolName??''));
      await native('worldPanel',{channel:'godot.runtimeSave',payload:{worldId,freeze:true}});const partial=completeCreationProgress(await native('godotSnapshot'));await restart();
      const resumed=completeCreationProgress(await native('godotSnapshot'));behavior.partialRestored=isDeepStrictEqual(partial,resumed);behavior.woodRestored=resumed.body.inventory.wood??0;
      await evaluate('resume-play');await evaluate('wait-regrowth');const regrown=await native('godotObserve');behavior.treeReturned=regrown.payload?.creation?.obstacles?.some(item=>item.entityId===treeId)===true;
      await native('worldPanel',{channel:'godot.runtimeSave',payload:{worldId,freeze:true}});after=await native('godotObserve');progressAfter=await native('godotSnapshot');
    }
    await restart();reopened=await native('godotObserve');restored=await native('godotSnapshot');
    if(originalWorld){await nav('world.open',{id:originalWorld});await settled(originalWorld);const source=await native('godotObserve'),saved=completeCreationProgress(await native('godotSnapshot'));result.copySourceUnchanged=source.buildId===originalObservation.buildId&&isDeepStrictEqual(source.payload.creation.entities,originalObservation.payload.creation.entities)&&isDeepStrictEqual(saved,originalSnapshot);await nav('world.open',{id:worldId});await settled(worldId);}
    result.checks=inspectCreationOutcome({caseId:result.id,before,after,target:prepared,beforeProgress:progressBefore,afterProgress:progressAfter,job:finalSnapshot.job,reopened,restoredProgress:restored,copySourceUnchanged:result.copySourceUnchanged,behavior:result.behavior});
    result.observations=evidence(`${result.id}-runtime`,{before,after,target:prepared,progressBefore,progressAfter,job:finalSnapshot.job,reopened,restored,behavior:result.behavior});
    const turnFailure=result.turnMessages.find(item=>item.role==='assistant'&&item.status==='error');if(turnFailure)result.error=turnFailure.error?.code??turnFailure.error?.message??'MODEL_TURN_FAILED';
  }catch(error){result.error=String(error?.message??error);if(finalSnapshot)result.transcript??=evidence(`${result.id}-session`,finalSnapshot);if(before)result.partialEvidence=evidence(`${result.id}-partial`,{before,after,prepared,progressBefore,progressAfter,reopened,restored});}
  finally{result.elapsedMs=Date.now()-begin;result.finishedAt=new Date().toISOString();result.outcome=classifyModelCase(result);save();console.log(`${result.id}: ${result.outcome} (${result.elapsedMs} ms)`);}
}
try{
  start();await started();const created=await nav('world.create',{baseId:'creation-sandbox',starterId:'blank',title:'真实模型评测空白世界',operationId:randomUUID()});worldId=created.id;report.worldId=worldId;await settled(worldId);
  const initialized=await evaluate('initialize');sessionId=initialized.sessionId;report.sessionId=sessionId;await evaluate('enable-auto-apply');report.initial=evidence('initial-world',await evaluate('snapshot'));save();
  for(const result of report.cases){await runCase(result);if(!successfulOutcomes.has(result.outcome)){for(const remaining of report.cases.filter(item=>!item.startedAt))remaining.skipReason='Earlier dependent case did not pass; no seeded answers or source fixes';break;}}
  report.isolation=await isolation();
}catch(error){report.environmentError=String(error?.message??error);for(const result of report.cases.filter(item=>!item.startedAt)){result.error=report.environmentError;result.outcome='environment_blocked';}}
finally{try{if(!ended&&sessionId){const current=await evaluate('snapshot');if(current.active)await evaluate('abort');}await stop();}catch(error){report.shutdownError=String(error?.message??error);}report.finishedAt=new Date().toISOString();save();console.log('Evidence: '+out);if(report.shutdownError||report.environmentError||report.cases.some(item=>!successfulOutcomes.has(item.outcome)))process.exitCode=1;}
