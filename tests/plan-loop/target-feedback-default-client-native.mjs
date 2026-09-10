import {assertOfficialTargetDefault,stopDefaultClient,finalizeDefaultClient} from '../player-product/default-client-audit.mjs';
import {assertCleanHeadlessShutdown} from '../player-product/shutdown-exit-audit.mjs';
// Actual compiled client and private profile; only finite page-script RPCs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {assertTargetFeedbackObservation,candidateFromTargetFeedbackStatus} from '../player-product/target-feedback-observation.mjs';
import {loadPackageAsar} from '../../desktop/package-asar.mjs';
import {parameterClientArguments,inspectParameterPackage,isolatedParameterEnvironment} from './parameter-client-package.mjs';
const options=parameterClientArguments(process.argv.slice(2));
const {root,runtime,deps,packaged}=options,app=path.join(root,'vendor/pi-desktop/apps/desktop');
const sha=b=>createHash('sha256').update(b).digest('hex');
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),'','Source must be committed and clean');
if(packaged)assert.equal(commit,options.expectedCommit,'Harness source must match the explicitly frozen package commit');
// --deps-app supplies only the ASAR inspection library in packaged mode. Never
// resolve Electron or read development compiled/runtime bytes in this branch.
const asar=packaged?loadPackageAsar(deps):null;
const packageInfo=packaged?await inspectParameterPackage({...options,asar}):null;
const electron=packaged?null:createRequire(path.join(deps,'package.json'))('electron');
const main=packageInfo?packageInfo.main:fs.readFileSync(path.join(app,'out/main/index.js'),'utf8');
for(const marker of ['configureHeadlessAcceptance()','focusable: !headlessAcceptance','offscreen: !!headlessAcceptance','targetFeedback.describe','targetFeedbackView','targetFeedbackProbeScript'])assert.ok(main.includes(marker),'Missing isolation/product marker '+marker);
assert.ok((packageInfo?packageInfo.preload:fs.readFileSync(path.join(app,'out/preload/craftmine-headless.cjs'),'utf8')).includes('requestPointerLock'));
const parent=path.join(root,'test-results');fs.mkdirSync(parent,{recursive:true});const out=fs.mkdtempSync(path.join(parent,'desktop-native-defaults-')),profile=path.join(out,'profile'),legacy=path.join(out,'legacy'),token=randomUUID();fs.mkdirSync(profile);fs.mkdirSync(legacy);fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource:legacy}));
const report={format:'craftmine.target-feedback-default-client/1',passed:false,root,runtime,out,commit,mode:packaged?'packaged':'development',mainSha256:sha(main),pluginSha256:packageInfo?packageInfo.identity.pluginSha256:sha(fs.readFileSync(path.join(app,'resources/plugins/craftmine.world/views/view.js'))),steps:[],launches:[],limits:[packaged?'Packaged EXE and only bundled core/host/runtime; independently supplied source commit and build-manifest hash verified. ASAR parser is explicit test tooling. Installer execution, full release seal, clean OS, signing and live-model acceptance are separate.':'Development client and authored runtime from this checkout, using locally rebuilt core/host binaries identified by SHA256; not a Windows release acceptance','No model prompt, credentials, OS input, Pointer Lock, visible windows, desktop captures or external report export; fixed gameplay captures only the isolated game view','Snapshot comparison retains every field including stable savedAt metadata']};
if(packageInfo)Object.assign(report,packageInfo.identity);
else{
 assert.equal(runtime,root,'Runtime source must come from this source checkout');
 const resources=JSON.parse(fs.readFileSync(path.join(runtime,'desktop/build/runtime-resources/runtime-resources.json'),'utf8'));
 assert.equal(resources.sourceCommit,report.commit);report.runtimeSourceCommit=resources.sourceCommit;report.runtimeFilesDigest=resources.filesDigest;
}
const core=packageInfo?packageInfo.core:path.join(runtime,'vendor/pi-desktop/target/release/craftmine-core.exe'),host=packageInfo?packageInfo.host:path.join(runtime,'vendor/pi-desktop/target/release/pi-desktop-host-core.exe');report.coreSha256=sha(fs.readFileSync(core));report.hostSha256=sha(fs.readFileSync(host));
let child,ended=true,ready=false,exit,launch,formalBuildId;const pending=new Map();
const persist=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
async function start(){
 if(packageInfo){const current=await inspectParameterPackage({...options,asar});assert.deepEqual(current.identity,packageInfo.identity,'Package bytes changed between launches');}
 ended=false;ready=false;launch={at:new Date().toISOString()};report.launches.push(launch);
 const env=isolatedParameterEnvironment(process.env,{out,profile,token,core,host,bases:packageInfo?packageInfo.bases:path.join(runtime,'desktop/godot')});
 child=spawn(packageInfo?packageInfo.executable:electron,packageInfo?[]:[app],{cwd:packageInfo?packageInfo.cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
 for(const stream of ['stdout','stderr'])child[stream].on('data',bytes=>fs.appendFileSync(path.join(out,`client-${report.launches.length}-${stream}.log`),bytes));
 child.on('message',message=>{if(message?.type==='craftmine-headless-ready')ready=true;if(message?.type==='craftmine-headless-exit')launch.audit=message;if(message?.type!=='craftmine-headless')return;const p=pending.get(message.id);if(!p)return;pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(Error(message.error)):p.resolve(message.result);});
 exit=new Promise(resolve=>{const finish=(code,signal,error)=>{if(ended)return;ended=true;launch.exit={code,signal,error:error?String(error):null};for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Client exited'));}pending.clear();persist();resolve();};child.once('error',e=>finish(null,null,e));child.once('exit',(code,signal)=>finish(code,signal));});
}
function rpc(method,payload={},timeout=30000){return new Promise((resolve,reject)=>{if(ended||!child.connected)return reject(Error('Client exited'));const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('Timed out '+method));},timeout);pending.set(id,{resolve,reject,timer});child.send({type:'craftmine-headless',id,method,...payload});});}
const nav=(channel,payload={})=>rpc('worldNavigation',{channel,payload},180000),panel=(worldId,channel,payload={})=>rpc('worldPanel',{channel,payload:{worldId,...payload}},60000);
async function until(fn,accept,label,timeout=120000){const end=Date.now()+timeout;let last;while(Date.now()<end){if(ended)throw Error('Client exited during '+label);try{last=await fn();}catch(e){last=String(e);}if(accept(last))return last;await delay(400);}throw Error(label+': '+JSON.stringify(last));}
async function step(name,fn){try{const value=await fn();report.steps.push({name,passed:true,value});persist();console.log('PASS '+name);return value;}catch(e){report.steps.push({name,passed:false,error:String(e)});persist();throw e;}}
async function stop(){return stopDefaultClient({ended:()=>ended,quit:()=>rpc('quit',{},10000),exit,kill:()=>child.kill(),launch});}
function snapshot(value){const result=value?.state;assert.equal(result?.format,'craftmine.godot-progress/1');assert.equal(result.worldId,report.worldId);assert.equal(result.baseId,'first-person');assert.equal(result.baseVersion,'0.1.0');assert.equal(result.body?.format,'craftmine.godot-base-state/1');assert.equal(result.body.worldId,report.worldId);assert.ok(result.body.player&&result.body.equipment&&result.body.inventory&&result.body.quests);assert.ok(result.body.targets?.length>=3);assert.equal(typeof result.body.savedAt,'string');return structuredClone(result);}
async function loaded(worldId){await until(()=>rpc('godotObserve'),x=>x?.worldId===worldId&&x.instanceId,'formal world',180000);await until(()=>rpc('worldNavigationReady'),x=>x.ready&&x.worldId===worldId,'world navigation');}
async function auditStop(){const audit=await rpc('status');assert.equal(audit.violations.length,0);assert.deepEqual(audit.shutdownFailures,[]);assert.ok(audit.windows.every(w=>!w.visible&&!w.focused&&!w.focusable&&w.offscreen));await stop();assertCleanHeadlessShutdown(launch);return launch;}
const defaultsView=(action,args={})=>rpc('targetFeedbackView',{payload:{action,worldId:report.worldId,...args}});
async function readOnlyState(){
 const history=await nav('godot.historyLoad',{worldId:report.worldId});
 assert.match(history.headOid,/^[a-f0-9]{40,64}$/);assert.match(history.appliedOid,/^[a-f0-9]{40,64}$/);const hash=(await panel(report.worldId,'backup.status')).currentHash;assert.match(hash,/^[a-f0-9]{64}$/);
 return {progress:snapshot(await rpc('godotSnapshot')),domainHash:hash,
   source:{headOid:history.headOid,appliedOid:history.appliedOid,branchId:history.branchId},operations:await panel(report.worldId,'workbench.operations')};
}
const feedback=async(worldId,value)=>{
 const observed=await rpc('godotObserve');assertTargetFeedbackObservation(observed,{worldId,buildId:formalBuildId,targetId:'target_a',hitFlashMilliseconds:value});return observed;
};
try{
 await start();await until(()=>ready,Boolean,'headless controller');await until(()=>nav('world.createOptions'),x=>x.bases?.some(b=>b.id==='first-person'),'base catalog');
 const world=await step('create actual first-person parameter world',()=>nav('world.create',{baseId:'first-person',starterId:'training-range',title:'Training target parameter acceptance',operationId:randomUUID()}));report.worldId=world.id;
 await step('real broker check and baseline runtime parameter',async()=>{await until(async()=>{const r=await nav('world.list');return r.worlds.find(x=>x.id===world.id);},x=>{assert.ok(!['failed','cancelled','interrupted'].includes(x?.state),JSON.stringify(x));return x?.state==='ready';},'world initialization',900000);await loaded(world.id);formalBuildId=(await rpc('godotObserve')).buildId;report.baselineBuildId=formalBuildId;return feedback(world.id,120);});
 await step('real library guide is optional, keeps game chrome fixed and uses existing navigation',async()=>{const r=await rpc('worldCreationGuide',{},120000);assert.equal(r.worldId,world.id);assert.equal(r.steps,6);for(const key of ['collapsed','expanded','insideWorkbench','headerUnchanged','checksVisible','clearedAfterNavigation','reopenedCollapsed','clearedAfterWorld'])assert.equal(r[key],true,key);return r;});
 await step('actual gameplay and checkpoint before editing source defaults',async()=>{const old=snapshot(await rpc('godotSnapshot')),played=await rpc('godotPlay',{},60000);assert.equal(played.format,'craftmine.godot-gameplay-evidence/1');assert.equal(played.actions.length,8);assert.notDeepEqual(snapshot(await rpc('godotSnapshot')).body.player,old.body.player);report.gameplay={before:played.before,actions:played.actions,captures:played.captures.map(c=>({afterAction:c.afterAction,width:c.image.width,height:c.image.height,pngSha256:sha(Buffer.from(c.image.pngBase64,'base64'))}))};const saved=await panel(world.id,'godot.runtimeSave',{freeze:true});assert.equal(saved.worldId,world.id);return saved;});const before=snapshot(await rpc('godotSnapshot'));report.before=before;
 const description=await step('finite panel reads actual formal target configuration',()=>panel(world.id,'targetFeedback.describe'));const target=description.targets.find(x=>x.targetId==='target_a');assert.ok(target);assert.equal(target.values.hitFlashMilliseconds,120);
 const payload={targetId:target.targetId,sourceBinding:target.sourceBinding,values:{hitFlashMilliseconds:500}};
 await step('zero milliseconds is refused before preparing an operation',async()=>{const records=await panel(world.id,'workbench.operations');await assert.rejects(panel(world.id,'workbench.prepare',{channel:'targetFeedback.submit',payload:{...payload,values:{hitFlashMilliseconds:0}}}),/TARGET_FEEDBACK_INVALID_VALUE/);assert.deepEqual(await panel(world.id,'workbench.operations'),records);return{rejected:true};});
 const intent=await step('persist original adjustment intent in existing workbench journal',()=>panel(world.id,'workbench.prepare',{channel:'targetFeedback.submit',payload}));report.operationId=intent.operationId;
 const queued=await step('one product submission creates one source draft and real check',()=>panel(world.id,'workbench.execute',{operationId:intent.operationId}));assert.equal(queued.applied,false);assert.equal(queued.draftRetained,true);assert.ok(queued.job?.jobId);
 await step('repeat panel request replays the original check receipt',async()=>{const r=await panel(world.id,'workbench.execute',{operationId:intent.operationId});assert.deepEqual(r,queued);assert.deepEqual(snapshot(await rpc('godotSnapshot')),before);return r;});
 const checked=await step('actual parameter check passes and returns its exact candidate',()=>until(()=>panel(world.id,'targetFeedback.status',{operationId:intent.operationId}),x=>{assert.ok(!['failed','cancelled','interrupted','source-saved-check-blocked'].includes(x?.status),JSON.stringify(x));return x?.status==='passed';},'parameter check',900000));assert.equal(checked.job.status,'passed');assert.ok(checked.job.candidateId);const candidateId=checked.job.candidateId;report.candidateId=candidateId;
 await step('candidate identity and required runtime values bind the same world, build and check job',async()=>{
  const r=await panel(world.id,'godot.candidateRead',{candidateId}),identity=candidateFromTargetFeedbackStatus(checked,r),evidence=r.check.requirementsEvidence;
  assert.equal(evidence?.format,'craftmine.godot-check-requirements-evidence/1');assert.equal(evidence.requirementsHash,sha('craftmine.godot-check-requirements/1\ntarget_a\n500\n'));
  assert.equal(evidence.jobId,checked.job.jobId);assert.equal(evidence.worldId,world.id);assert.equal(evidence.buildId,checked.job.buildId);assert.ok(evidence.instanceId);
  assert.deepEqual(evidence.observations,[{phase:'loaded',targetId:'target_a',hitFlashMilliseconds:500},{phase:'running',targetId:'target_a',hitFlashMilliseconds:500}]);
  const required=r.check.assertions.filter(x=>x.id==='runtime.target-feedback');assert.equal(required.length,1);assert.equal(required[0].passed,true);return{...identity,requirementsEvidence:evidence,assertion:required[0]};
 });
 await step('candidate preview and close retain original formal defaults and gameplay',async()=>{const preview=await panel(world.id,'godot.candidatePreview',{candidateId});assert.deepEqual(preview,{status:'preview',worldId:world.id,candidateId,buildId:checked.job.buildId});const closed=await panel(world.id,'godot.candidateClose');assert.deepEqual(closed,{status:'aborted',worldId:world.id});assert.equal((await panel(world.id,'godot.candidateState',{candidateId})).status,'closed');assert.deepEqual(snapshot(await rpc('godotSnapshot')),before);return feedback(world.id,120);});
 await step('first shutdown keeps checked draft without adopting it',auditStop);
 await start();await until(()=>ready,Boolean,'second controller');await loaded(world.id);
 await step('restart restores pending original operation and original formal runtime',async()=>{const records=await panel(world.id,'workbench.operations'),record=records.items.find(x=>x.operationId===intent.operationId);assert.ok(record);assert.equal(record.channel,'targetFeedback.submit');assert.deepEqual(record.payload,payload);assert.equal(record.state,'completed');assert.deepEqual(await panel(world.id,'workbench.execute',{operationId:intent.operationId}),queued);assert.equal((await panel(world.id,'targetFeedback.status',{operationId:intent.operationId})).job.candidateId,candidateId);assert.deepEqual(snapshot(await rpc('godotSnapshot')),before);return feedback(world.id,120);});
 await step('adopt exact checked parameter candidate',async()=>{const preview=await panel(world.id,'godot.candidatePreview',{candidateId});assert.deepEqual(preview,{status:'preview',worldId:world.id,candidateId,buildId:checked.job.buildId});const adopted=await panel(world.id,'godot.candidateApply',{candidateId});assert.equal(adopted.status,'applied');assert.equal(adopted.worldId,world.id);assert.equal(adopted.candidateId,candidateId);assert.equal(adopted.record.id,world.id);assert.equal(adopted.record.world.build.id,checked.job.buildId);formalBuildId=checked.job.buildId;assert.deepEqual(snapshot(await rpc('godotSnapshot')),before);return{status:adopted.status,observation:await feedback(world.id,500)};});
 await step('formal source agrees with live runtime and preserves other target defaults',async()=>{const r=await panel(world.id,'targetFeedback.describe');assert.equal(r.targets.find(x=>x.targetId==='target_a').values.hitFlashMilliseconds,500);for(const other of r.targets.filter(x=>x.targetId!=='target_a'))assert.equal(other.values.hitFlashMilliseconds,120);return r;});
 await step('stale source binding becomes a visible rejection without a write',async()=>{const r=await panel(world.id,'targetFeedback.submit',{operationId:randomUUID(),...payload,values:{hitFlashMilliseconds:750}});assert.equal(r.status,'rejected');assert.equal(r.reason,'TARGET_FEEDBACK_STALE_BINDING');assert.deepEqual(snapshot(await rpc('godotSnapshot')),before);return r;});
 await step('second shutdown persists adopted parameter',auditStop);
 await start();await until(()=>ready,Boolean,'third controller');await loaded(world.id);
 await step('second restart retains 500 milliseconds and every old gameplay field',async()=>{assert.deepEqual(snapshot(await rpc('godotSnapshot')),before);const r=await panel(world.id,'targetFeedback.describe');assert.equal(r.targets.find(x=>x.targetId==='target_a').values.hitFlashMilliseconds,500);return feedback(world.id,500);});
 const describedDefault=await panel(world.id,'targetFeedback.describe'),defaultTarget=describedDefault.targets.find(t=>t.targetId==='target_a');
 const defaultValue=assertOfficialTargetDefault(defaultTarget);report.default=defaultTarget.defaults;
 await step('real default button only fills the observed target and leaves complete domain unchanged',async()=>{
  await panel(world.id,'godot.runtimeSave',{freeze:true});await defaultsView('open');const opened=await until(()=>defaultsView('read'),r=>r.open&&r.targets.includes('target_a')&&!r.defaultDisabled,'default DOM');assert.ok(opened.defaultSource);
  await defaultsView('select',{targetId:'target_a'});assert.equal((await defaultsView('read')).value,'500');
  const original=await readOnlyState();report.beforeDefaultFill=original;
  await defaultsView('useDefault');const filled=await until(()=>defaultsView('read'),r=>r.value===String(defaultValue),'default fill');assert.match(filled.notice,/尚未提交/);assert.match(filled.notice,/不会恢复动态继承/);assert.deepEqual(await readOnlyState(),original);return filled;
 });
 const defaultIntent=await step('real DOM submit creates exactly one original durable default operation',async()=>{
  const original=(await panel(world.id,'workbench.operations')).items;await defaultsView('submit');
  const result=await until(()=>panel(world.id,'workbench.operations'),r=>r.items?.some(i=>!original.some(o=>o.operationId===i.operationId)),'default operation');
  const added=result.items.filter(i=>!original.some(o=>o.operationId===i.operationId));assert.equal(added.length,1);assert.equal(added[0].channel,'targetFeedback.submit');assert.deepEqual(added[0].payload,{targetId:'target_a',sourceBinding:defaultTarget.sourceBinding,values:{hitFlashMilliseconds:defaultValue}});return added[0];
 });
 const defaultCheck=await step('default uses actual bound engine check and exact candidate',async()=>{
  const checked=await until(()=>panel(world.id,'targetFeedback.status',{operationId:defaultIntent.operationId}),r=>{assert.ok(!['failed','cancelled','interrupted','source-saved-check-blocked','rejected'].includes(r?.status),JSON.stringify(r));return r?.status==='passed';},'default check',900000);
  const candidate=await panel(world.id,'godot.candidateRead',{candidateId:checked.job.candidateId});candidateFromTargetFeedbackStatus(checked,candidate);
  const proof=candidate.check.requirementsEvidence;assert.equal(proof?.format,'craftmine.godot-check-requirements-evidence/1');assert.equal(proof.requirementsHash,sha('craftmine.godot-check-requirements/1\ntarget_a\n'+defaultValue+'\n'));assert.equal(proof.worldId,world.id);assert.equal(proof.jobId,checked.job.jobId);assert.equal(proof.buildId,checked.job.buildId);assert.ok(proof.instanceId);assert.deepEqual(proof.observations,[{phase:'loaded',targetId:'target_a',hitFlashMilliseconds:defaultValue},{phase:'running',targetId:'target_a',hitFlashMilliseconds:defaultValue}]);
  const required=candidate.check.assertions.filter(a=>a.id==='runtime.target-feedback');assert.equal(required.length,1);assert.equal(required[0].passed,true);return checked;
 });
 await step('default preview and cancellation retain current500 and full progress',async()=>{
  const candidateId=defaultCheck.job.candidateId;assert.deepEqual(await panel(world.id,'godot.candidatePreview',{candidateId}),{status:'preview',worldId:world.id,candidateId,buildId:defaultCheck.job.buildId});assert.deepEqual(await panel(world.id,'godot.candidateClose'),{status:'aborted',worldId:world.id});assert.equal((await panel(world.id,'godot.candidateState',{candidateId})).status,'closed');assert.deepEqual(snapshot(await rpc('godotSnapshot')),report.beforeDefaultFill.progress);return feedback(world.id,500);
 });
 const latest=await step('actual newer gameplay after checking is saved before adopting default',async()=>{
  await defaultsView('close');const advanced=await rpc('godotAdvance',{},60000);assert.equal(advanced.format,'craftmine.godot-gameplay-evidence/1');assert.equal(advanced.actions.length,3);await panel(world.id,'godot.runtimeSave',{freeze:true});const current=snapshot(await rpc('godotSnapshot'));assert.notDeepEqual(current,report.beforeDefaultFill.progress);return current;
 });report.latest=latest;
 await step('default adoption preserves latest complete progress and all other target values',async()=>{
  const candidateId=defaultCheck.job.candidateId;assert.deepEqual(await panel(world.id,'godot.candidatePreview',{candidateId}),{status:'preview',worldId:world.id,candidateId,buildId:defaultCheck.job.buildId});const result=await panel(world.id,'godot.candidateApply',{candidateId});assert.equal(result.status,'applied');assert.equal(result.worldId,world.id);assert.equal(result.candidateId,candidateId);assert.equal(result.record.world.build.id,defaultCheck.job.buildId);formalBuildId=defaultCheck.job.buildId;
  assert.deepEqual(snapshot(await rpc('godotSnapshot')),latest);await feedback(world.id,defaultValue);const current=await panel(world.id,'targetFeedback.describe');assert.equal(current.targets.find(t=>t.targetId==='target_a').values.hitFlashMilliseconds,defaultValue);for(const prior of describedDefault.targets.filter(t=>t.targetId!=='target_a'))assert.deepEqual(current.targets.find(t=>t.targetId===prior.targetId).values,prior.values);return result.status;
 });
 await step('third orderly shutdown after default adoption',auditStop);
 await start();await until(()=>ready,Boolean,'fourth controller');await loaded(world.id);
 await step('default value and latest full progress survive process restart',async()=>{assert.deepEqual(snapshot(await rpc('godotSnapshot')),latest);const current=await panel(world.id,'targetFeedback.describe');assert.equal(current.targets.find(t=>t.targetId==='target_a').values.hitFlashMilliseconds,defaultValue);return feedback(world.id,defaultValue);});
 await step('fourth orderly shutdown',auditStop);report.passed=true;
}catch(e){report.error=String(e.stack??e);process.exitCode=1;}finally{if(!await finalizeDefaultClient(report,async()=>{await stop();if(launch)assertCleanHeadlessShutdown(launch);},persist))process.exitCode=1;console.log(JSON.stringify({out,passed:report.passed,steps:report.steps.map(({name,passed})=>({name,passed})),error:report.error,shutdownError:report.shutdownError}));}
