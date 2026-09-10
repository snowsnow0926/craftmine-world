// Actual compiled client and private profile; only finite page-script RPCs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {assertCleanHeadlessShutdown} from '../player-product/shutdown-exit-audit.mjs';
import {isolatedParameterEnvironment} from './parameter-client-package.mjs';
const arg=name=>{const i=process.argv.indexOf(name);assert.ok(i>=0,`Missing ${name}`);return path.resolve(process.argv[i+1]);};
const root=arg('--source-root'),runtime=arg('--runtime-source'),deps=arg('--deps-app'),app=path.join(root,'vendor/pi-desktop/apps/desktop');
const require=createRequire(path.join(deps,'package.json')),electron=require('electron'),sha=b=>createHash('sha256').update(b).digest('hex');
const main=fs.readFileSync(path.join(app,'out/main/index.js'),'utf8');
for(const marker of ['configureHeadlessAcceptance()','focusable: !headlessAcceptance','offscreen: !!headlessAcceptance','issue.followup'])assert.ok(main.includes(marker),'Missing isolation/product marker '+marker);
assert.ok(fs.readFileSync(path.join(app,'out/preload/craftmine-headless.cjs'),'utf8').includes('requestPointerLock'));
const parent=process.argv.includes('--output-root')?arg('--output-root'):path.join(root,'test-results');fs.mkdirSync(parent,{recursive:true});const out=fs.mkdtempSync(path.join(parent,'desktop-native-issues-')),profile=path.join(out,'profile'),legacy=path.join(out,'legacy'),token=randomUUID();fs.mkdirSync(profile);fs.mkdirSync(legacy);fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource:legacy}));
const report={format:'craftmine.local-issue-client/2',passed:false,root,runtime,out,commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),mainSha256:sha(main),pluginSha256:sha(fs.readFileSync(path.join(app,'resources/plugins/craftmine.world/views/view.js'))),steps:[],launches:[],limits:['Development client with byte-verified frozen baseline Godot/core/host; not a new Windows release acceptance','No model prompt, credentials, OS input, Pointer Lock, visible windows, screenshots or external report export','Full native persistent snapshot is compared, including savedAt; context fields change only through actual check/application/restart']};
const core=process.argv.includes('--core-bin')?arg('--core-bin'):path.join(runtime,'vendor/pi-desktop/target/release/craftmine-core.exe'),host=process.argv.includes('--host-bin')?arg('--host-bin'):path.join(runtime,'vendor/pi-desktop/target/release/pi-desktop-host-core.exe');report.coreSha256=sha(fs.readFileSync(core));report.hostSha256=sha(fs.readFileSync(host));
assert.equal(report.coreSha256,'285578bc384302eaccf2017225d446732ead3daf24c80a52e5150018604060bb');assert.equal(report.hostSha256,'04080dcc21e4909699977055724116fc92a8e6bc19fcdc0ea42e91a2a3b3224b');
let child,ended=true,ready=false,exit,launch;const pending=new Map();
const persist=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
function start(){ended=false;ready=false;launch={at:new Date().toISOString()};report.launches.push(launch);
 const env=isolatedParameterEnvironment(process.env,{out,profile,token,core,host,bases:path.join(runtime,'desktop/godot')});
 child=spawn(electron,[app],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
 for(const stream of ['stdout','stderr'])child[stream].on('data',bytes=>fs.appendFileSync(path.join(out,`client-${report.launches.length}-${stream}.log`),bytes));
 child.on('message',message=>{if(message?.type==='craftmine-headless-ready')ready=true;if(message?.type==='craftmine-headless-exit')launch.audit=message;if(message?.type!=='craftmine-headless')return;const p=pending.get(message.id);if(!p)return;pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(Error(message.error)):p.resolve(message.result);});
 exit=new Promise(resolve=>{const finish=(code,signal,error)=>{if(ended)return;ended=true;launch.exit={code,signal,error:error?String(error):null};for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Client exited'));}pending.clear();persist();resolve();};child.once('error',e=>finish(null,null,e));child.once('exit',(code,signal)=>finish(code,signal));});
}
function rpc(method,payload={},timeout=30000){return new Promise((resolve,reject)=>{if(ended||!child.connected)return reject(Error('Client exited'));const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('Timed out '+method));},timeout);pending.set(id,{resolve,reject,timer});child.send({type:'craftmine-headless',id,method,...payload});});}
const nav=(channel,payload={})=>rpc('worldNavigation',{channel,payload},180000),panel=(worldId,channel,payload={})=>rpc('worldPanel',{channel,payload:{worldId,...payload}},60000);
async function until(fn,accept,label,timeout=120000){const end=Date.now()+timeout;let last;while(Date.now()<end){if(ended)throw Error('Client exited during '+label);try{last=await fn();if(accept(last))return last;}catch(e){last=String(e);}await delay(400);}throw Error(label+': '+JSON.stringify(last));}
async function step(name,fn){try{const value=await fn();report.steps.push({name,passed:true,value});persist();console.log('PASS '+name);return value;}catch(e){report.steps.push({name,passed:false,error:String(e)});persist();throw e;}}
async function stop(){if(ended)return;try{await rpc('quit',{},10000);}catch{}await Promise.race([exit,delay(20000)]);if(!ended){launch.forcedStop=true;child.kill();}await exit;}
function snapshot(value){return structuredClone(value?.state??value?.result?.state??value);}
async function loaded(worldId){await until(()=>rpc('godotObserve'),x=>x?.worldId===worldId&&x.instanceId,'formal world',180000);await until(()=>rpc('worldNavigationReady'),x=>x.ready&&x.worldId===worldId,'world navigation');}
async function auditStop(){const audit=await rpc('status');assert.equal(audit.violations.length,0);assert.deepEqual(audit.shutdownFailures,[]);assert.ok(audit.windows.every(w=>!w.visible&&!w.focused&&!w.focusable&&w.offscreen));await stop();assertCleanHeadlessShutdown(launch);return launch;}
try{
 start();await until(()=>ready,Boolean,'headless controller');await until(()=>nav('world.createOptions'),x=>x.bases?.some(b=>b.id==='first-person'),'base catalog');
 const world=await step('create actual first-person world',()=>nav('world.create',{baseId:'first-person',starterId:'training-range',title:'Local issue notebook acceptance',operationId:randomUUID()}));report.worldId=world.id;
 await step('actual broker build and formal application',async()=>{await until(async()=>{const r=await nav('world.list');return r.worlds.find(x=>x.id===world.id);},x=>x?.state==='ready','world initialization',900000);await loaded(world.id);return rpc('godotObserve');});
 await step('real gameplay and durable frozen checkpoint before recording',async()=>{await rpc('godotPlay',{},60000);return panel(world.id,'godot.runtimeSave',{freeze:true});});const before=snapshot(await rpc('godotSnapshot'));report.before=before;
 const input={operationId:randomUUID(),description:'  测试原话：开门后提示还在\n<script>this is literal</script>  '};
 const created=await step('product panel records original wording and trusted formal identity',async()=>{const observed=await rpc('godotObserve');const r=await panel(world.id,'issue.create',input);assert.equal(r.status,'completed');assert.equal(r.issue.description,input.description);for(const key of ['worldId','buildId','instanceId'])assert.equal(r.issue.context[key],observed[key]);assert.match(r.issue.context.artifactManifestHash,/^[a-f0-9]{64}$/);assert.deepEqual(r.issue.attachments,[]);assert.equal(r.issue.reproduction,'not-attempted');return r;});
 await step('same operation returns one record and preserves every gameplay field',async()=>{const replay=await panel(world.id,'issue.create',input);assert.equal(replay.replayed,true);assert.deepEqual(replay.issue,created.issue);assert.equal((await panel(world.id,'issue.list')).total,1);assert.deepEqual(snapshot(await rpc('godotSnapshot')),before);return replay;});
 const issueArgs={issueId:created.issue.id};
 async function append(kind,text,operationId=randomUUID()) {const observed=await rpc('godotObserve'),prepared=await panel(world.id,'issue.followupPrepare',issueArgs);for(const key of ['worldId','buildId','instanceId'])assert.equal(prepared.context[key],observed[key]);const request={...issueArgs,operationId,revision:prepared.revision,contextHash:prepared.contextHash,kind,text};const result=await panel(world.id,'issue.followup',request);assert.equal(result.status,'completed');assert.deepEqual(result.issue,created.issue);const entry=result.followups.at(-1);assert.deepEqual(entry.context,prepared.context);assert.equal(entry.text,text);assert.deepEqual(snapshot(await rpc('godotSnapshot')),before);return{request,result};}
 const note=await step('append original-build player note with actual formal identity',()=>append('note','  Supplement before modification 🌍\n<script>literal</script>  '));
 const temp=await panel(world.id,'issue.create',{operationId:randomUUID(),description:'Temporary preview deletion case'});
 const descriptor=await panel(world.id,'targetFeedback.describe'),target=descriptor.targets.find(x=>x.targetId==='target_a');assert.ok(target);
 const intent=await panel(world.id,'workbench.prepare',{channel:'targetFeedback.submit',payload:{targetId:target.targetId,sourceBinding:target.sourceBinding,values:{hitFlashMilliseconds:500}}});
 await step('submit actual parameter draft and check',()=>panel(world.id,'workbench.execute',{operationId:intent.operationId}));
 const checked=await step('actual Godot check yields exact candidate',()=>until(()=>panel(world.id,'targetFeedback.status',{operationId:intent.operationId}),x=>x?.status==='passed','parameter check',900000));const candidateId=checked.job.candidateId;assert.ok(candidateId);
 await step('preview rejects supplements while retaining read and delete behavior',async()=>{
  const prepared=await panel(world.id,'issue.followupPrepare',issueArgs);await panel(world.id,'godot.candidatePreview',{candidateId});
  await assert.rejects(panel(world.id,'issue.followupPrepare',issueArgs),/ISSUE_CONTEXT_NOT_READY/);
  await assert.rejects(panel(world.id,'issue.followup',{...issueArgs,operationId:randomUUID(),revision:prepared.revision,contextHash:prepared.contextHash,kind:'still-present',text:''}),/ISSUE_CONTEXT_NOT_READY/);
  const read=await panel(world.id,'issue.read',issueArgs);assert.deepEqual(read.issue,created.issue);assert.equal(read.followups.length,1);
  assert.equal((await panel(world.id,'issue.delete',{issueId:temp.issue.id,operationId:randomUUID()})).deleted,true);
  await panel(world.id,'godot.candidateClose');assert.deepEqual(snapshot(await rpc('godotSnapshot')),before);return{refused:true,read,temporaryDeleted:true};
 });
 await step('apply actual checked parameter build without changing any saved field',async()=>{await panel(world.id,'godot.candidatePreview',{candidateId});const result=await panel(world.id,'godot.candidateApply',{candidateId});assert.equal(result.status,'applied');assert.deepEqual(snapshot(await rpc('godotSnapshot')),before);const observed=await rpc('godotObserve');assert.equal(observed.buildId,checked.job.buildId);assert.notEqual(observed.buildId,created.issue.context.buildId);return observed;});
 for(const kind of ['still-present','player-resolved','reopened'])await step('record player state '+kind+' on actual new formal build',()=>append(kind,''));
 const retained=await panel(world.id,'issue.read',issueArgs);assert.equal(retained.followups.length,4);report.retained=retained;
 await step('original note replay remains exact after build and revision changes',async()=>{const replay=await panel(world.id,'issue.followup',note.request);assert.equal(replay.replayed,true);assert.equal(replay.followups.length,4);assert.deepEqual(replay.issue,created.issue);return replay;});
 await step('first orderly shutdown',auditStop);
 start();await until(()=>ready,Boolean,'second controller');await loaded(world.id);
 await step('new client process reads immutable original and all distinct-context followups',async()=>{const r=await panel(world.id,'issue.read',issueArgs);assert.deepEqual(r,retained);assert.deepEqual(snapshot(await rpc('godotSnapshot')),before);const actual=await rpc('godotObserve');assert.equal(actual.buildId,checked.job.buildId);assert.notEqual(actual.instanceId,retained.followups.at(-1).context.instanceId);return r;});
 const removed=await step('delete only this local report',()=>panel(world.id,'issue.delete',{issueId:created.issue.id,operationId:randomUUID()}));assert.equal(removed.deleted,true);
 await step('old create receipt cannot resurrect a deleted report',async()=>{const r=await panel(world.id,'issue.create',input);assert.equal(r.deleted,true);assert.equal(r.issue,null);assert.equal((await panel(world.id,'issue.list')).total,0);assert.deepEqual(snapshot(await rpc('godotSnapshot')),before);return r;});
 await step('old supplement receipt cannot resurrect deleted text',async()=>{const r=await panel(world.id,'issue.followup',note.request);assert.equal(r.deleted,true);assert.equal(r.issue,null);return r;});
 await step('second orderly shutdown',auditStop);
 start();await until(()=>ready,Boolean,'third controller');await loaded(world.id);
 await step('deletion remains durable after another client restart',async()=>{assert.equal((await panel(world.id,'issue.list')).total,0);assert.deepEqual(snapshot(await rpc('godotSnapshot')),before);return {total:0};});
 await step('third orderly shutdown',auditStop);report.passed=true;
}catch(e){report.error=String(e.stack??e);process.exitCode=1;}finally{await stop();report.finishedAt=new Date().toISOString();persist();console.log(JSON.stringify({out,passed:report.passed,steps:report.steps.map(({name,passed})=>({name,passed})),error:report.error}));}
