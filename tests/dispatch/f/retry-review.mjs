// One explicit review retry of a failed F profile; never repeats Agent authorship.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as delay} from 'node:timers/promises';
import {loadLocalConfig} from '../../../app/local-config.mjs';
import {deepseekKey,modelId,thinkingEnabled,reasoningEffort} from '../../../app/agent-model.mjs';
const repo=path.resolve('.'),directory=fs.realpathSync(path.resolve(process.argv[2]||''));
assert.equal(path.dirname(directory),fs.realpathSync(path.join(repo,'test-results')));
assert.ok(path.basename(directory).startsWith('desktop-native-f-'));
const original=JSON.parse(fs.readFileSync(path.join(directory,'report.json'),'utf8'));
assert.equal(original.passed,false,'Only a retained failed native profile may be retried');
const reuse=!!original.evidence.reuseIdentity;
const stateOnly=process.env.CRAFTMINE_F_STATE_ONLY==='1';
const identity=original.evidence.reuseIdentity||original.evidence.identity;assert.ok(identity?.sessionId,'Expected a real failed native session');
const profile=path.join(directory,'profile'),marker=JSON.parse(fs.readFileSync(path.join(profile,'headless-profile.json'),'utf8'));
assert.equal(marker.format,'craftmine.headless-profile/1');
const desktop=path.join(repo,'vendor/pi-desktop/apps/desktop'),require=createRequire(path.join(desktop,'package.json'));
const main=path.join(desktop,'out/main/index.js'),source=fs.readFileSync(main,'utf8');
for(const guard of ['configureHeadlessAcceptance()','focusable: !headlessAcceptance','offscreen: !!headlessAcceptance','retryReview'])assert.ok(source.includes(guard));
assert.ok(path.isAbsolute(process.env.CRAFTMINE_LIVE_CONFIG||''));loadLocalConfig(process.env.CRAFTMINE_LIVE_CONFIG);
const core=path.resolve(process.env.CRAFTMINE_CORE_BIN||'test-results/dispatch-f/bin/craftmine-core.exe'),host=path.resolve(process.env.PI_DESKTOP_HOST_BIN||'test-results/dispatch-f/bin/pi-desktop-host-core.exe');
const env={...process.env,CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_ROOT:directory,CRAFTMINE_DATA_DIR:profile,CRAFTMINE_HEADLESS_TOKEN:marker.token,CRAFTMINE_CORE_BIN:core,PI_DESKTOP_HOST_BIN:host,
  CRAFTMINE_F_AGENT:'1',CRAFTMINE_F_MODEL:modelId(),CRAFTMINE_F_KEY:deepseekKey(),CRAFTMINE_F_THINKING:thinkingEnabled()?reasoningEffort():'off',CRAFTMINE_F_REOPEN_SESSION:identity.sessionId};
delete env.ELECTRON_RUN_AS_NODE;
for(const name of Object.keys(env))if(/^PI_DESKTOP_(CAPTURE|BOOT_PROBE|SUPERVISION_PROBE|PLAN_UI_PROBE)/.test(name))delete env[name];
const child=spawn(require('electron'),[desktop],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env});
const log=fs.createWriteStream(path.join(directory,'explicit-review-retry.log'));child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
let ready=false,ended=false,audit;const pending=new Map();
const exit=new Promise(resolve=>{child.once('exit',(code,signal)=>{ended=true;log.end();for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Native exited'));}pending.clear();resolve({code,signal});});child.once('error',error=>{ended=true;resolve({error:String(error)});});});
child.on('message',message=>{if(message?.type==='craftmine-headless-ready'){ready=true;return;}if(message?.type==='craftmine-headless-exit'){audit=message;return;}const p=pending.get(message?.id);if(!p)return;pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(Error(message.error)):p.resolve(message.result);});
const rpc=(method,type='craftmine-acceptance-f',timeout=15000)=>new Promise((resolve,reject)=>{if(ended)return reject(Error('Native exited'));const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('RPC timeout '+method));},timeout);pending.set(id,{resolve,reject,timer});child.send({type,id,method});});
const read=()=>{const db=new DatabaseSync(path.join(profile,'plugins/data/craftmine.world/tasks.sqlite'),{readOnly:true});try{return Object.fromEntries(['craftmine_budget_requests','craftmine_reviews','craftmine_worlds','craftmine_library','craftmine_applications'].map(t=>[t,db.prepare(`SELECT * FROM ${t}`).all()]));}finally{db.close();}};
const evidence={before:read(),originalReportHash:createHash('sha256').update(fs.readFileSync(path.join(directory,'report.json'))).digest('hex')},started=Date.now();
try{
  const deadline=Date.now()+60000;while(!ready&&Date.now()<deadline&&!ended)await delay(200);assert.ok(ready);
  let loaded=false;
  while(Date.now()<deadline&&!ended){try{const world=await rpc('worldState','craftmine-headless');if(world.loaded&&!world.disabled){loaded=true;break;}}catch{}await delay(200);}
  assert.ok(loaded,'The actual world view must finish startup before session setup');
  await rpc('initialize');evidence.status=await rpc('status','craftmine-headless');
  assert.ok(evidence.status.windows.every(w=>w.offscreen&&!w.visible&&!w.focused&&!w.focusable));
  if(!stateOnly){
    evidence.retry=await rpc('retryReview');
    evidence.application=await rpc('apply','craftmine-acceptance-f',210000);
  }
  evidence.after=read();
  const world=JSON.parse(evidence.after.craftmine_worlds.find(w=>w.id===identity.worldId).document);
  const reference=original.evidence.capture?.ref;
  assert.equal(world.build.scene.objects.length,reuse?2:1);
  assert.ok(world.build.scene.objects.some(o=>o.id==='native-oak'&&o.position.x===10));
  if(reuse)assert.ok(world.build.scene.objects.some(o=>o.source?.id===reference.id&&o.source.version===reference.version&&o.position.x===20));
  const previous=new Set(evidence.before.craftmine_budget_requests.map(r=>r.request_id));
  const added=evidence.after.craftmine_budget_requests.filter(r=>!previous.has(r.request_id));
  assert.ok(stateOnly?added.length===0:added.length>=1&&added.length<=2&&added.every(r=>r.purpose==='review'),'Only the explicit bounded real review may request the provider');
  evidence.newRequests=added;
  if(original.evidence.scenario.recovery){
    const before=original.evidence.interruptedLedger.craftmine_budget_requests,after=evidence.after.craftmine_budget_requests;
    assert.ok(after.length>before.length&&new Set(after.map(r=>r.owner)).size===1&&after[0].owner===before[0].owner);
    assert.ok(original.evidence.resume.generation>original.evidence.beforeResume.context.generation);
    assert.ok(after.some(r=>r.status==='unknown'&&r.estimate>0));
    evidence.recoveryBudgetPreserved=true;
  }
  if(process.env.CRAFTMINE_F_MEMORY==='1'){
    evidence.memory=await rpc('memory');
    assert.ok(evidence.memory.search.items.some(item=>item.status==='validated'&&item.claim==='这个世界复用树时保留原树。'));
    evidence.memoryReplay=await rpc('memory');
    assert.deepEqual(evidence.memoryReplay.proposed,evidence.memory.proposed);
  }
  if(process.env.CRAFTMINE_F_BACKUP==='1'){
    evidence.backup=await rpc('backup','craftmine-acceptance-f',30000);
    assert.equal(evidence.backup.exported.status,'completed');assert.equal(evidence.backup.inspected.status,'ready');assert.equal(evidence.backup.inspected.credentialsIncluded,false);
    const file=path.join(directory,'portable-backup.json'),bytes=fs.readFileSync(file);
    fs.writeFileSync(file,Buffer.concat([bytes,Buffer.from('\n')]));
    await assert.rejects(rpc('restoreBackup','craftmine-acceptance-f',30000),/BACKUP_FILE_CHANGED/);
    evidence.changedBackupRejected=true;
    fs.writeFileSync(file,bytes);
    evidence.backupReinspect=await rpc('backup','craftmine-acceptance-f',30000);
    evidence.backupRestore=await rpc('restoreBackup','craftmine-acceptance-f',30000);
    assert.equal(evidence.backupRestore.status,'completed');assert.equal(evidence.backupRestore.modelReplay,false);
  }
  evidence.passed=true;
}catch(error){evidence.failure=String(error?.stack||error);process.exitCode=1;}
finally{
  if(!ended){try{evidence.guards=await rpc('guards','craftmine-headless');await rpc('quit','craftmine-headless',3000);}catch{}await Promise.race([exit,delay(7000)]);if(!ended){child.kill();await exit;}}
  evidence.audit=audit;
  if(!audit||audit.violations.length||audit.pageErrors.length){evidence.passed=false;process.exitCode=1;}
  const output=path.join(directory,stateOnly?'post-application-state.json':'explicit-review-retry.json');
  fs.writeFileSync(output,JSON.stringify({format:'craftmine.f-review-retry/1',stateOnly,elapsedMs:Date.now()-started,evidence},null,2));
  console.log(JSON.stringify({passed:evidence.passed===true,failure:evidence.failure,report:output}));
}
