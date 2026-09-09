// Native lifecycle acceptance with fixed authorship and real model review.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as delay} from 'node:timers/promises';
import {loadLocalConfig} from '../../../../app/local-config.mjs';
import {deepseekKey,modelId,modelProvider,thinkingEnabled,reasoningEffort} from '../../../../app/agent-model.mjs';

const repo=path.resolve('.'),desktop=path.join(repo,'vendor/pi-desktop/apps/desktop');
const require=createRequire(path.join(desktop,'package.json'));
const packaged=process.env.CRAFTMINE_PACKAGED_ROOT?fs.realpathSync(path.resolve(process.env.CRAFTMINE_PACKAGED_ROOT)):null;
const resources=packaged?path.join(packaged,'resources'):null;
const electron=packaged?path.join(packaged,'Craftmine World.exe'):require('electron');
const readAppFile=relative=>{
  if(!packaged)return fs.readFileSync(path.join(desktop,relative));
  const builderRequire=createRequire(require.resolve('electron-builder'));
  const libRequire=createRequire(builderRequire.resolve('app-builder-lib'));
  return libRequire('@electron/asar').extractFile(path.join(resources,'app.asar'),path.normalize(relative));
};
const mainBytes=readAppFile('out/main/index.js'),source=mainBytes.toString();
for(const guard of ['configureHeadlessAcceptance()','focusable: !headlessAcceptance','offscreen: !!headlessAcceptance','installBatch07NativeAcceptance'])assert.ok(source.includes(guard),'Refuse unsafe or unprepared native build: '+guard);
assert.ok(readAppFile('out/preload/craftmine-headless.cjs').length>0);
const domain=fs.readFileSync(packaged?path.join(resources,'plugins/craftmine.world/domain.cjs'):path.join(desktop,'resources/plugins/craftmine.world/domain.cjs'),'utf8');
assert.ok(!domain.includes('node:child_process'),'Refuse a compiler that can launch Electron as Node');
let packageManifest=null;
if(packaged){
  packageManifest=JSON.parse(fs.readFileSync(path.join(resources,'source/build-manifest.json'),'utf8'));
  assert.equal(packageManifest.format,'craftmine.build/1');
  for(const [relative,index] of [['bin/pi-desktop-host-core.exe',0],['bin/craftmine-core.exe',1],['agent-runtime/sidecar.js',2],['plugins/craftmine.world/manifest.json',3],['source/CraftmineWorld-source.zip',4]]){
    const actual=createHash('sha256').update(fs.readFileSync(path.join(resources,relative))).digest('hex');
    assert.equal(actual,packageManifest.artifacts[index].sha256,'Refuse package/source manifest mismatch: '+relative);
  }
}
import {ProjectStore} from '../../../../app/store.mjs';
import {trainingScene,drainExtension} from '../../../../examples/dispatch-d/content.mjs';
import {execFileSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
const gameOnly=process.env.CRAFTMINE_BATCH07_GAME_ONLY==='1';
const stateOnly=process.env.CRAFTMINE_BATCH07_STATE_ONLY==='1';
const budgetOnly=process.env.CRAFTMINE_BATCH07_BUDGET_ONLY==='1';
const config=process.env.CRAFTMINE_LIVE_CONFIG;
assert.ok(config&&path.isAbsolute(config),'Explicit authorized config required');loadLocalConfig(config);
assert.equal(modelProvider(),'deepseek');assert.ok(deepseekKey());
const core=packaged?path.join(resources,'bin/craftmine-core.exe'):path.resolve('desktop/build/batch07-bin/craftmine-core.exe');
const host=packaged?path.join(resources,'bin/pi-desktop-host-core.exe'):path.resolve('desktop/build/batch07-bin/pi-desktop-host-core.exe');
for(const file of [electron,core,host])assert.ok(fs.existsSync(file),'Missing binary: '+file);
fs.mkdirSync('test-results',{recursive:true});
const resume=process.env.CRAFTMINE_BATCH07_RETRY_PROFILE?fs.realpathSync(process.env.CRAFTMINE_BATCH07_RETRY_PROFILE):null;
if(resume)assert.ok(resume.startsWith(path.resolve('test-results')+path.sep+'desktop-native-batch07-'),'Only this worktree owned profile may be retried');
const directory=resume||fs.mkdtempSync(path.resolve('test-results/desktop-native-batch07-')),profile=path.join(directory,'profile'),legacySource=path.join(directory,'legacy');
const previous=resume?JSON.parse(fs.readFileSync(path.join(directory,'report.json'))):null;
const continueInstall=!!(previous?.capture?.ref&&previous?.newWorld&&!previous?.install);
if(resume)assert.ok((budgetOnly&&previous.identity?.sessionId&&(previous.finalLedger||previous.failureLedger)?.craftmine_budget_requests.length>0)||(previous.success===false&&previous.identity?.sessionId&&(!previous.retryOf||continueInstall||(stateOnly&&previous.install&&previous.afterRestart))),'Only one explicit review retry, captured installation or verified state continuation allowed');
assert.ok(!stateOnly||resume,'State-only requires retained owned evidence');
assert.ok(!budgetOnly||resume,'Budget-only requires retained owned evidence');
const budgetSource=budgetOnly?JSON.parse(fs.readFileSync(path.join(directory,'failed-review-report.json'))).identity:null;
const token=resume?JSON.parse(fs.readFileSync(path.join(profile,'headless-profile.json'))).token:randomUUID();
if(!resume){fs.mkdirSync(profile);fs.mkdirSync(legacySource);
fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource}));
const legacy=new ProjectStore(path.join(legacySource,'.craftmine'));
legacy.change(data=>{data.extensions=[drainExtension()];});
const fixture=legacy.build(trainingScene());legacy.change(data=>{data.current=fixture.id;data.history.push({id:fixture.id,summary:'Fixed D gameplay fixture',time:Date.now()});});
}
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const evidence={started:new Date().toISOString(),source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),packageManifest,draftAuthorship:gameOnly?'fixed D fixture import; gameplay-only; no author/review/library claim':'fixed D fixture imported normally; actual native patch changes target name',model:{id:modelId(),thinking:thinkingEnabled()?reasoningEffort():'off'},binaryHashes:{core:sha(core),host:sha(host),main:createHash('sha256').update(mainBytes).digest('hex')},limits:{requests:12,timeoutMs:900000},checks:[],steps:[]};
if(previous){fs.writeFileSync(path.join(directory,'prior-attempt-'+Date.now()+'.json'),JSON.stringify(previous,null,2));evidence.retryOf={started:previous.started,error:previous.error,beforeBudget:previous.failureLedger?.craftmine_budget_requests};}
const check=(name,value)=>{evidence.checks.push({name,passed:!!value});assert.ok(value,name);console.log('PASS '+name);};
const save=()=>fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(evidence,null,2));
function ledger(){const db=new DatabaseSync(path.join(profile,'plugins/data/craftmine.world/tasks.sqlite'),{readOnly:true});try{return Object.fromEntries(['craftmine_worlds','craftmine_applications','craftmine_verifications','craftmine_reviews','craftmine_library','craftmine_budget_requests','craftmine_task_runtime','craftmine_memories'].map(table=>[table,db.prepare(`SELECT * FROM ${table}`).all()]));}finally{db.close();}}
function launch(label){
  const env={...process.env,CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_ROOT:directory,CRAFTMINE_DATA_DIR:profile,CRAFTMINE_HEADLESS_TOKEN:token,CRAFTMINE_CORE_BIN:core,PI_DESKTOP_HOST_BIN:host,CRAFTMINE_BATCH07_NATIVE:'1',CRAFTMINE_F_MODEL:modelId(),CRAFTMINE_F_KEY:deepseekKey(),CRAFTMINE_F_THINKING:thinkingEnabled()?reasoningEffort():'off'};
  if(previous)env.CRAFTMINE_BATCH07_SESSION=evidence.identity?.sessionId||previous.identity.sessionId;
  if(budgetOnly)env.CRAFTMINE_BATCH07_SESSION=budgetSource.sessionId;
  if(continueInstall)env.CRAFTMINE_BATCH07_CAPTURE_REF=JSON.stringify(previous.capture.ref);
  delete env.ELECTRON_RUN_AS_NODE;for(const key of Object.keys(env))if(/^PI_DESKTOP_(CAPTURE|BOOT_PROBE|SUPERVISION_PROBE|PLAN_UI_PROBE)/.test(key))delete env[key];
  const child=spawn(electron,packaged?[]:[desktop],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env});
  const log=fs.createWriteStream(path.join(directory,label+'.log'));child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});let ready=false,ended=false,audit;const pending=new Map();
  const exit=new Promise(resolve=>{child.once('exit',(code,signal)=>{ended=true;log.end();for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Native exited'));}pending.clear();resolve({code,signal});});child.once('error',error=>{ended=true;resolve({error:String(error)});});});
  child.on('message',message=>{if(message.type==='craftmine-headless-ready'){ready=true;return;}if(message.type==='craftmine-headless-exit'){audit=message;return;}const p=pending.get(message.id);if(!p)return;pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(Error(message.error)):p.resolve(message.result);});
  const rpc=(method,type='craftmine-acceptance-batch07',timeout=15000,payload={})=>new Promise((resolve,reject)=>{if(ended||!child.connected)return reject(Error('Native unavailable'));const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('RPC timeout '+method));},timeout);pending.set(id,{resolve,reject,timer});child.send({type,id,method,...payload});});
  return {rpc,get ready(){return ready;},get audit(){return audit;},stop:async()=>{if(ended)return;try{await rpc('quit','craftmine-headless',3000);}catch{}await Promise.race([exit,delay(7000)]);if(!ended){child.kill();await exit;}}};
}
async function until(fn,predicate,label,timeout=60000){const end=Date.now()+timeout;let value;while(Date.now()<end){try{value=await fn();}catch(error){value={unavailable:String(error)};}if(predicate(value))return value;await delay(200);}throw Error(label+': '+JSON.stringify(value));}
let client;const start=Date.now();
async function ready(){await until(async()=>client.ready,x=>x,'Controller not ready');await until(()=>client.rpc('worldState','craftmine-headless'),x=>x.loaded&&!x.disabled,'World not loaded');}
async function reviewedApply(label){
  await until(()=>client.rpc('jobs'),value=>{evidence[label+'Jobs']=value;save();const list=value.verifications;const job=(Array.isArray(list)?list:list.items).find(j=>j.current);if(job&&['failed','interrupted','cancelled'].includes(job.status))throw Error('Verification failed: '+JSON.stringify(job));return job?.status==='passed';},'Verification not complete',180000);
  evidence[label+'Applied']=await client.rpc('applyWarnings','craftmine-acceptance-batch07',270000);
  check(label+' actual model review and player application',!!evidence[label+'Applied'].verificationId);save();
}
async function step(name){const result=await client.rpc('game:'+name);evidence.steps.push({name,result});save();return result.after??result;}
let targetId='training-target';
const target=value=>value.objects.find(o=>o.id===targetId);
const health=value=>target(value)?.health;
try{
  console.log('Evidence directory: '+directory);client=launch(resume?'retry-review':'author');await ready();
  evidence.isolation=await client.rpc('status','craftmine-headless');check('Isolated offscreen unfocusable windows',evidence.isolation.violations.length===0&&evidence.isolation.windows.every(w=>w.offscreen&&!w.visible&&!w.focusable&&!w.focused));
  if(budgetOnly){
    evidence.identity=await client.rpc('initialize');evidence.sourceWorld=await client.rpc('sourceWorld');
    evidence.budget=await client.rpc('budget','craftmine-acceptance-batch07',30000);
    const before=evidence.budget.before.context.budget,after=evidence.budget.after.context.budget;
    check('Actual budget form preserves nonzero provider usage and owner while removing cumulative cap',before.requestCount>0&&(before.actualTokens+before.reservedTokens)>0&&after.actualTokens===before.actualTokens&&after.requestCount===before.requestCount&&after.reservedTokens===before.reservedTokens&&after.ownerTaskId===before.ownerTaskId&&after.limits.maxTokens===null);
    evidence.finalLedger=ledger();check('Budget-only UI continuation makes zero additional model requests',evidence.finalLedger.craftmine_budget_requests.length===(previous.finalLedger||previous.failureLedger).craftmine_budget_requests.length);
  }else{
  if(!resume){evidence.import=await client.rpc('importLegacy','craftmine-headless',100000);await ready();}
  evidence.gameOnly=gameOnly;
  evidence.stateOnly=stateOnly;
  if(!stateOnly){
  if(!gameOnly){
  if(continueInstall){evidence.identity=await client.rpc('initializeDestination');evidence.author=previous.author;evidence.capture=previous.capture;evidence.newWorld=previous.newWorld;}
  else {
  evidence.identity=await client.rpc('initialize');
  if(resume){evidence.author=previous.author;if(process.env.CRAFTMINE_BATCH07_ACK_EXISTING!=='1')evidence.retry=await client.rpc('retryReview');}
  else {evidence.author=await client.rpc('author','craftmine-acceptance-batch07',30000);await client.rpc('finish');}save();
  await reviewedApply('fixture');await client.rpc('finish');
  evidence.capture=await client.rpc('capture');check('Actual Rust capture uses applied creation provenance',evidence.capture.ref?.version===1&&evidence.capture.ref.hash.length===64);
  evidence.newWorld=await client.rpc('newWorld');}
  evidence.install=await client.rpc('install','craftmine-acceptance-batch07',30000);save();
  check('Exact captured package installs all objects and fixed extension',evidence.install.ref.hash===evidence.capture.ref.hash&&Object.keys(evidence.install.idMap.objects).length===4&&evidence.install.dependencies.extensions[0].id==='training-drain');
  await reviewedApply('installed');targetId=evidence.install.idMap.objects['training-target'];
  evidence.budget=await client.rpc('budget','craftmine-acceptance-batch07',30000);
  const originalBudget=evidence.budget.before.context.budget,afterBudget=evidence.budget.after.context.budget;
  check('Actual workbench changes finite token allowance to unlimited without clearing owner or usage',originalBudget.requestCount>0&&afterBudget.ownerTaskId===originalBudget.ownerTaskId&&afterBudget.actualTokens===originalBudget.actualTokens&&afterBudget.reservedTokens===originalBudget.reservedTokens&&afterBudget.requestCount===originalBudget.requestCount&&afterBudget.limits.maxTokens===null);
  }
  let value=await step('observe');check('Native instance starts once with full target health',health(value)===60&&value.inventory['training-token']===1);
  value=await step('fall');check('Actual physics fall reduces player health',value.playerHealth===50);
  value=await step('drain');check('Real extension drains target and heals player',health(value)===50&&value.playerHealth===60);
  value=await step('ranged-far');check('Actual long range miss consumes ammunition without damage',health(value)===50&&Object.values(value.gameplay.systems).some(s=>s.ammo===2));
  value=await step('ranged-miss');check('Actual ray miss leaves target unchanged',health(value)===50&&Object.values(value.gameplay.systems).some(s=>s.ammo===1));
  value=await step('ranged-hit');check('Actual shooting hit damages target',health(value)===30&&Object.values(value.gameplay.systems).some(s=>s.ammo===0));
  value=await step('attack-now');check('Cooldown or empty ammunition rejects repeated shot',health(value)===30);
  await step('equip-melee');value=await step('melee-far');check('Actual melee out of range rejects damage',health(value)===30);
  value=await step('melee-hit');check('Actual melee in range damages target',health(value)===5);
  value=await step('attack-now');check('Actual melee cooldown rejects repeated damage',health(value)===5);
  value=await step('drain');check('Extension kills and heals only actual damage',health(value)===0&&value.playerHealth===65&&!target(value).mesh);
  value=await step('tick');check('Next actual gameplay tick grants exactly one kill reward',value.inventory['training-token']===2);
  await step('equip-ranged');await step('reload');evidence.beforeRestart=await client.rpc('snapshot');evidence.save=await client.rpc('save');evidence.beforeLedger=ledger();save();
  check('Formal Rust progress includes initialized lifecycle and exact extension state',Object.values(evidence.beforeRestart.snapshot.snapshot.behaviors.modules).some(m=>m.initialized&&m.extensions?.['training-drain']?.state.calls===2));
  evidence.guards=await client.rpc('guards','craftmine-headless');await client.stop();evidence.exitAudit=client.audit;
  client=launch('restart');await ready();evidence.afterRestart=await client.rpc('snapshot');
  check('Full Electron restart preserves gameplay and behavior snapshot',isDeepStrictEqual(evidence.afterRestart.snapshot.snapshot.gameplay,evidence.beforeRestart.snapshot.snapshot.gameplay)&&isDeepStrictEqual(evidence.afterRestart.snapshot.snapshot.behaviors,evidence.beforeRestart.snapshot.snapshot.behaviors));
  value=await step('attack-now');check('Reload survives full restart and cannot fire early',health(value)===0&&value.inventory['training-token']===2);
  value=await step('reload-complete');check('Reload completes after remaining simulated time',Object.values(value.gameplay.systems).some(s=>s.ammo===3&&s.reloadRemaining===0));
  value=await step('drain');check('Restored Worker extension state does not repeat reward',health(value)===0&&value.playerHealth===65&&value.inventory['training-token']===2);
  const afterExtension=await client.rpc('snapshot');check('Restored extension continues exact persisted call count',Object.values(afterExtension.snapshot.snapshot.behaviors.modules).some(m=>m.extensions?.['training-drain']?.state.calls===3));
  await step('fall');value=await step('fall');check('Actual repeated falls can kill player',value.playerHealth===0);
  value=await step('attack-now');check('Dead player cannot consume full magazine',Object.values(value.gameplay.systems).some(s=>s.ammo===3));
  await client.rpc('save');
  }else{evidence.identity=previous.identity;evidence.priorChain={install:previous.install,applied:previous.installedApplied,beforeRestart:previous.beforeRestart,afterRestart:previous.afterRestart,checks:previous.checks};evidence.guards=await client.rpc('guards','craftmine-headless');}
  evidence.memorySession=await client.rpc('initialize');
  evidence.memory=await client.rpc('memory');
  evidence.backup=await client.rpc('backup','craftmine-acceptance-batch07',60000);save();
  check('Real native file backup is inspected through opaque grant',!!evidence.backup.inspected.grantId);
  evidence.restored=await client.rpc('restoreBackup','craftmine-acceptance-batch07',60000);save();
  await client.stop();client=launch('restored-backup');await ready();
  evidence.restoredSnapshot=await client.rpc('snapshot');
  evidence.finalLedger=ledger();evidence.finalStatus=await client.rpc('status','craftmine-headless');
  check('Explicit rule memory survives real backup restore',evidence.finalLedger.craftmine_memories.some(row=>JSON.stringify(row).includes('这个训练世界复用组合玩法时保留扩展的固定版本')));
  if(stateOnly)check('State-only continuation makes zero additional model requests',evidence.finalLedger.craftmine_budget_requests.length===previous.failureLedger.craftmine_budget_requests.length);
  check('No focus, pointer lock or physical input across all game frames',evidence.finalStatus.violations.length===0&&evidence.guards.every(f=>f.guard?.pointerLock===0&&f.guard?.focus===0));
  check(gameOnly?'Game-only scenario makes zero model requests':'Real reviews stay inside bounded model allowance',evidence.finalLedger.craftmine_budget_requests.length<=(gameOnly?0:evidence.limits.requests)&&Date.now()-start<evidence.limits.timeoutMs);
  }
  evidence.success=true;
}catch(error){evidence.success=false;evidence.error=error.stack;try{evidence.failureLedger=ledger();}catch{}process.exitCode=1;console.error(error.stack);}
finally{await client?.stop();evidence.lastExitAudit=client?.audit;evidence.elapsedMs=Date.now()-start;save();console.log('Evidence: '+directory);}
