// Actual native PI Agent authorship; strictly isolated, offscreen, no input simulation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as delay} from 'node:timers/promises';
import {loadLocalConfig} from '../../../app/local-config.mjs';
import {deepseekKey,modelId,modelProvider,thinkingEnabled,reasoningEffort} from '../../../app/agent-model.mjs';

const repo=path.resolve('.'),desktop=path.join(repo,'vendor/pi-desktop/apps/desktop');
const require=createRequire(path.join(desktop,'package.json')),electron=require('electron');
const main=path.join(desktop,'out/main/index.js'),source=fs.readFileSync(main,'utf8');
for(const guard of ['configureHeadlessAcceptance()','focusable: !headlessAcceptance','offscreen: !!headlessAcceptance','installNativeAgentAcceptance'])assert.ok(source.includes(guard),'Refuse unsafe or unprepared native build: '+guard);
assert.ok(fs.statSync(path.join(desktop,'out/preload/craftmine-headless.cjs')).size>0);
const config=process.env.CRAFTMINE_LIVE_CONFIG;
assert.ok(config&&path.isAbsolute(config),'Explicit authorized model configuration required');
loadLocalConfig(config);
assert.ok(modelProvider()==='deepseek'&&deepseekKey(),'Configured DeepSeek required; no fallback');
const compactions=Number(process.env.CRAFTMINE_F_COMPACTIONS||0);
assert.ok([0,3].includes(compactions),'Only fixed baseline or three-compaction scenario allowed');
const workbench=process.env.CRAFTMINE_F_WORKBENCH==='1',recovery=process.env.CRAFTMINE_F_RECOVERY==='1';
assert.ok(!(workbench&&recovery)&&(!(workbench||recovery)||compactions===0),'Choose one fixed acceptance scenario');
const core=path.resolve(process.env.CRAFTMINE_CORE_BIN||'test-results/dispatch-f/bin/craftmine-core.exe');
const host=path.resolve(process.env.PI_DESKTOP_HOST_BIN||'test-results/dispatch-f/bin/pi-desktop-host-core.exe');
for(const binary of [electron,core,host])assert.ok(fs.existsSync(binary),'Missing binary: '+binary);
fs.mkdirSync('test-results',{recursive:true});
const directory=fs.mkdtempSync(path.resolve('test-results/desktop-native-f-'));
const profile=path.join(directory,'profile'),legacySource=path.join(directory,'legacy'),token=randomUUID();
fs.mkdirSync(profile);fs.mkdirSync(legacySource);
fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource}));
const checks=[],evidence={model:{id:modelId(),thinking:thinkingEnabled()?reasoningEffort():'off',authorship:'actual-native-PI-Agent'},scenario:{compactions,workbench,recovery,timeoutMs:1200000,maxRequests:80}};
const check=(name,value)=>{checks.push({name,passed:!!value});assert.ok(value,name);console.log('PASS '+name);};
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const startedAt=Date.now();
function ledger(){
  const file=path.join(profile,'plugins/data/craftmine.world/tasks.sqlite');
  if(!fs.existsSync(file))return null;
  const db=new DatabaseSync(file,{readOnly:true});
  try{return Object.fromEntries(['craftmine_tasks','craftmine_task_runtime','craftmine_budget_requests','craftmine_budget_events','craftmine_task_requirements','craftmine_workspaces','craftmine_worlds','craftmine_applications','craftmine_verifications','craftmine_reviews','craftmine_receipts','craftmine_library','craftmine_memories'].map(table=>[table,db.prepare(`SELECT * FROM ${table}`).all()]));}finally{db.close();}
}
function launch(label,overrides={}){
  const env={...process.env,CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_ROOT:directory,CRAFTMINE_DATA_DIR:profile,CRAFTMINE_HEADLESS_TOKEN:token,CRAFTMINE_CORE_BIN:core,PI_DESKTOP_HOST_BIN:host,
    CRAFTMINE_F_AGENT:'1',CRAFTMINE_F_MODEL:modelId(),CRAFTMINE_F_KEY:deepseekKey(),CRAFTMINE_F_THINKING:thinkingEnabled()?reasoningEffort():'off',CRAFTMINE_F_COMPACTIONS:String(compactions),...overrides};
  delete env.ELECTRON_RUN_AS_NODE;
  for(const name of Object.keys(env))if(/^PI_DESKTOP_(CAPTURE|BOOT_PROBE|SUPERVISION_PROBE|PLAN_UI_PROBE)/.test(name))delete env[name];
  const child=spawn(electron,[desktop],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env});
  const log=fs.createWriteStream(path.join(directory,label+'.log'));child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
  let ready=false,ended=false,audit,exitResult;const pending=new Map();
  const exit=new Promise(resolve=>{const end=value=>{if(ended)return;ended=true;exitResult=value;log.end();for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('Native exited '+JSON.stringify(value)));}pending.clear();resolve(value);};child.once('exit',(code,signal)=>end({code,signal}));child.once('error',error=>end({error:String(error)}));});
  child.on('message',message=>{if(message?.type==='craftmine-headless-ready'){ready=true;return;}if(message?.type==='craftmine-headless-exit'){audit=message;return;}const item=pending.get(message?.id);if(!item)return;pending.delete(message.id);clearTimeout(item.timer);message.error?item.reject(Error(message.error)):item.resolve(message.result);});
  const rpc=(method,type='craftmine-headless',timeout=15000,payload={})=>new Promise((resolve,reject)=>{if(ended||!child.connected)return reject(Error('Native unavailable '+JSON.stringify(exitResult)));const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('RPC timeout '+method));},timeout);pending.set(id,{resolve,reject,timer});child.send({type,id,method,...payload});});
  return {rpc,exit,get ended(){return ended;},get audit(){return audit;},get ready(){return ready;},crash:async()=>{child.kill();return exit;},stop:async()=>{if(ended)return;try{await rpc('abort','craftmine-acceptance-f',3000);}catch{}try{await rpc('quit','craftmine-headless',3000);}catch{}await Promise.race([exit,delay(7000)]);if(!ended){child.kill();await exit;}}};
}
async function until(run,predicate,label,timeout=60000){const deadline=Date.now()+timeout;let value,last;do{try{value=await run();if(predicate(value))return value;}catch(error){last=String(error);}await delay(250);}while(Date.now()<deadline);throw Error(label+': '+JSON.stringify(value)+' '+(last||''));}
let client;
async function complete(label='session'){
  let final,lastCount=-1;
  while(Date.now()-startedAt<evidence.scenario.timeoutMs){
    final=await client.rpc('snapshot','craftmine-acceptance-f');
    fs.writeFileSync(path.join(directory,label+'-latest.json'),JSON.stringify(final,null,2));
    const count=ledger()?.craftmine_budget_requests?.length||0;
    if(count!==lastCount){console.log(JSON.stringify({phase:label,requests:count,messages:final.record?.session?.messages?.length,compactions:final.record?.session?.compactions?.length||0,active:final.active,elapsedMs:Date.now()-startedAt}));lastCount=count;}
    if(count>evidence.scenario.maxRequests)throw Error('Acceptance request cap exceeded');
    if(!final.active)return final;
    await delay(1000);
  }
  throw Error('Actual native Agent exceeded acceptance deadline');
}
try{
  console.log('Evidence directory: '+directory);
  client=launch('native-agent');await until(async()=>client.ready,x=>x,'Controller not ready');
  const initial=await until(()=>client.rpc('worldState'),x=>x.loaded&&!x.disabled,'World not ready');
  evidence.initialStatus=await client.rpc('status');
  check('Native isolation active',evidence.initialStatus.violations.length===0&&evidence.initialStatus.windows.every(w=>w.offscreen&&!w.visible&&!w.focused&&!w.focusable));
  check('Blank world before real Agent authorship',JSON.parse(ledger().craftmine_worlds.find(row=>row.id===initial.id).document).build.scene.objects.length===0);
  evidence.identity=await client.rpc('initialize','craftmine-acceptance-f');
  evidence.prompt=await client.rpc('prompt','craftmine-acceptance-f',60000);
  check('Production renderer prompt accepted',evidence.prompt?.ok!==false);
  if(recovery){
    evidence.interruptedSession=await until(()=>client.rpc('snapshot','craftmine-acceptance-f'),value=>value.active&&value.record.session.messages.some(m=>m.toolName==='plugin_craftmine_world_workspace_patch'&&m.toolStatus==='success'),'No active authored patch to interrupt',90000);
    evidence.interruptedLedger=ledger();
    evidence.forcedExit=await client.crash();
    await delay(2000);
    client=launch('recovery',{CRAFTMINE_F_REOPEN_SESSION:evidence.identity.sessionId});
    await until(async()=>client.ready,x=>x,'Recovery controller not ready');
    await until(()=>client.rpc('worldState'),x=>x.loaded&&!x.disabled,'Recovery world not ready');
    evidence.reopened=await client.rpc('initialize','craftmine-acceptance-f');
    evidence.beforeResume=await client.rpc('context','craftmine-acceptance-f');
    evidence.resume=await client.rpc('resume','craftmine-acceptance-f',60000);
  }
  const final=await complete();
  evidence.finalSession=final;evidence.beforeApplyLedger=ledger();
  check('Actual native Agent finished before deadline',final&&!final.active);
  const session=final.record.session;
  check('Real PI transcript records authored tool calls',session.messages.some(m=>JSON.stringify(m).includes('workspace_patch')));
  check('Actual PI compaction checkpoints meet scenario',(session.compactions?.length||0)>=compactions);
  evidence.applied=await client.rpc('apply','craftmine-acceptance-f',210000);
  check('Actual panel applied reviewed candidate',evidence.applied.applied);
  const state=await client.rpc('worldState');evidence.appliedWorld=state;
  const appliedDocument=JSON.parse(ledger().craftmine_worlds.find(row=>row.id===state.id).document);evidence.appliedDocument=appliedDocument;
  const tree=appliedDocument.build.scene.objects.find(item=>item.id==='native-oak');
  check('Real applied tree retains requested identity and position',tree?.name==='记忆松树'&&tree.position.x===10&&tree.position.y===6&&tree.position.z===4&&tree.parts.length>=2);
  evidence.guards=await client.rpc('guards');evidence.finalStatus=await client.rpc('status');
  check('Zero input and focus across desktop and world frames',evidence.finalStatus.violations.length===0&&evidence.guards.every(frame=>frame.guard?.pointerLock===0&&frame.guard?.focus===0));
  evidence.image=await client.rpc('captureWorld','craftmine-headless',10000,{name:'f-agent-applied'});
  if(workbench){
    evidence.capture=await client.rpc('capture','craftmine-acceptance-f');
    check('Player captured a fixed applied tree version',evidence.capture.ref?.version===1&&/^[a-f0-9]{64}$/.test(evidence.capture.ref.hash));
    evidence.captureReplay=await client.rpc('capture','craftmine-acceptance-f');
    check('Repeated capture returns the same fixed library version',JSON.stringify(evidence.captureReplay.ref)===JSON.stringify(evidence.capture.ref));
  }
  if(recovery){
    const before=evidence.interruptedLedger.craftmine_budget_requests,after=ledger().craftmine_budget_requests;
    check('Explicit recovered task retained cumulative budget owner',before.length>0&&after.length>before.length&&new Set(after.map(r=>r.owner)).size===1&&after[0].owner===before[0].owner);
    check('Recovery uses a new task generation',ledger().craftmine_task_runtime.some(r=>r.generation>evidence.interruptedLedger.craftmine_task_runtime[0].generation));
  }
  if(process.env.CRAFTMINE_F_MEMORY==='1'){
    evidence.memory=await client.rpc('memory','craftmine-acceptance-f');
    check('Player rule has real validated memory provenance',evidence.memory.search.items.some(item=>item.status==='validated'&&item.claim==='这个世界复用树时保留原树。'));
    const count=ledger().craftmine_tasks.length;
    evidence.memoryReplay=await client.rpc('memory','craftmine-acceptance-f');
    check('Repeated player memory does not create another task',ledger().craftmine_tasks.length===count);
  }
  if(process.env.CRAFTMINE_F_BACKUP==='1'){
    evidence.backup=await client.rpc('backup','craftmine-acceptance-f',30000);
    check('Actual desktop export and file inspection completed',evidence.backup.exported.status==='completed'&&evidence.backup.inspected.status==='ready'&&evidence.backup.inspected.credentialsIncluded===false);
    const file=path.join(directory,'portable-backup.json'),bytes=fs.readFileSync(file);
    fs.writeFileSync(file,Buffer.concat([bytes,Buffer.from('\n')]));
    await assert.rejects(client.rpc('restoreBackup','craftmine-acceptance-f',30000),/BACKUP_FILE_CHANGED/);
    check('Changed selected backup is rejected before restore',true);
    fs.writeFileSync(file,bytes);
    evidence.backupReinspect=await client.rpc('backup','craftmine-acceptance-f',30000);
    evidence.backupRestore=await client.rpc('restoreBackup','craftmine-acceptance-f',30000);
    check('Actual unchanged backup restores through trusted file grant',evidence.backupRestore.status==='completed'&&evidence.backupRestore.modelReplay===false);
  }
  await client.stop();evidence.firstExit=client.audit;
  client=launch('restart',workbench?{CRAFTMINE_F_REUSE_REF:JSON.stringify(evidence.capture.ref)}:{});await until(async()=>client.ready,x=>x,'Restart controller not ready');
  const restored=await until(()=>client.rpc('worldState'),x=>x.loaded&&!x.disabled,'Restored world not ready');evidence.restored=restored;
  check('Complete native restart retains authored tree',restored.id===state.id&&JSON.stringify(JSON.parse(ledger().craftmine_worlds.find(row=>row.id===restored.id).document).build.scene.objects)===JSON.stringify(appliedDocument.build.scene.objects));
  if(workbench){
    evidence.reuseIdentity=await client.rpc('initialize','craftmine-acceptance-f');
    check('Reuse starts a different actual host session',evidence.reuseIdentity.sessionId!==evidence.identity.sessionId);
    await client.rpc('prompt','craftmine-acceptance-f',60000);
    evidence.reuseSession=await complete('reuse');
    check('Real Agent used the exact immutable library reference',evidence.reuseSession.record.session.messages.some(m=>m.toolName==='plugin_craftmine_world_library_install'&&m.toolStatus==='success'&&m.toolArgs.ref.hash===evidence.capture.ref.hash&&m.toolArgs.ref.version===1));
    try{evidence.reuseApplication=await client.rpc('apply','craftmine-acceptance-f',210000);}catch(error){
      evidence.reuseFirstApplyError=String(error);
      if(process.env.CRAFTMINE_F_RETRY_REVIEW!=='1')throw error;
      evidence.reuseReviewRetry=await client.rpc('retryReview','craftmine-acceptance-f');
      evidence.reuseApplication=await client.rpc('apply','craftmine-acceptance-f',210000);
    }
    const world=JSON.parse(ledger().craftmine_worlds.find(row=>row.id===state.id).document);evidence.reusedWorld=world;
    check('Reused exact old tree is applied beside the unchanged original',world.build.scene.objects.length===2&&world.build.scene.objects.some(o=>o.id==='native-oak'&&o.position.x===10)&&world.build.scene.objects.some(o=>o.source?.id===evidence.capture.ref.id&&o.source.version===1&&o.position.x===20));
  }
}catch(error){evidence.failure=String(error?.stack||error);console.error(evidence.failure);process.exitCode=1;}
finally{
  if(client&&!client.ended)for(const method of ['status','guards'])try{evidence[method+'AtExit']=await client.rpc(method);}catch{}
  if(client)await client.stop();
  try{evidence.finalLedger=ledger();}catch(error){evidence.ledgerReadError=String(error);}
  evidence.exitAudit=client?.audit;
  fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify({format:'craftmine.f-native-agent/1',passed:!evidence.failure&&checks.every(c=>c.passed),elapsedMs:Date.now()-startedAt,checks,evidence,binaries:{electron:sha(electron),core:sha(core),host:sha(host),main:sha(main)},limits:['No visible-window or clean-Windows installation validation','No library reuse claim from tree persistence alone','No measured performance threshold during concurrent builds']},null,2));
  console.log('Native Agent report: '+path.join(directory,'report.json'));
}
