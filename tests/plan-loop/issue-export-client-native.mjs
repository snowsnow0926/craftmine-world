import {assertCleanHeadlessShutdown} from '../player-product/shutdown-exit-audit.mjs';
// Actual compiled client and private profile; only finite page-script RPCs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {stopDefaultClient,finalizeDefaultClient} from '../player-product/default-client-audit.mjs';
import {assertIssueExport,issueExportError} from '../player-product/issue-export-client-contract.mjs';
import {loadPackageAsar} from '../../desktop/package-asar.mjs';
import {parameterClientArguments,inspectParameterPackage,isolatedParameterEnvironment} from './parameter-client-package.mjs';
const options=parameterClientArguments(process.argv.slice(2));
const {root,runtime,deps,packaged}=options,app=path.join(root,'vendor/pi-desktop/apps/desktop');
const sha=b=>createHash('sha256').update(b).digest('hex');
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),'','Source must be committed and clean');
if(packaged)assert.equal(commit,options.expectedCommit,'Harness source must match the explicitly frozen package commit');
assert.equal(sha(fs.readFileSync(import.meta.filename)),sha(fs.readFileSync(path.join(root,'tests/plan-loop/issue-export-client-native.mjs'))),'Executed harness must match the selected source checkout');
// --deps-app supplies only the ASAR inspection library in packaged mode. Never
// resolve Electron or read development compiled/runtime bytes in this branch.
const asar=packaged?loadPackageAsar(deps):null;
const packageInfo=packaged?await inspectParameterPackage({...options,asar}):null;
const electron=packaged?null:createRequire(path.join(deps,'package.json'))('electron');
const main=packageInfo?packageInfo.main:fs.readFileSync(path.join(app,'out/main/index.js'),'utf8');
for(const marker of ['configureHeadlessAcceptance()','focusable: !headlessAcceptance','offscreen: !!headlessAcceptance','issue.export'])assert.ok(main.includes(marker),'Missing isolation/product marker '+marker);
assert.ok((packageInfo?packageInfo.preload:fs.readFileSync(path.join(app,'out/preload/craftmine-headless.cjs'),'utf8')).includes('requestPointerLock'));
const parent=path.join(root,'test-results');fs.mkdirSync(parent,{recursive:true});const out=fs.mkdtempSync(path.join(parent,'desktop-native-issue-export-')),profile=path.join(out,'profile'),legacy=path.join(out,'legacy'),token=randomUUID();fs.mkdirSync(profile);fs.mkdirSync(legacy);fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource:legacy}));
const report={format:'craftmine.issue-export-client/1',passed:false,root,runtime,out,commit,mode:packaged?'packaged':'development',mainSha256:sha(main),pluginSha256:packageInfo?packageInfo.identity.pluginSha256:sha(fs.readFileSync(path.join(app,'resources/plugins/craftmine.world/views/view.js'))),steps:[],launches:[],limits:[packaged?'Packaged EXE and only bundled core/host/runtime; independently supplied source commit and build-manifest hash verified. ASAR parser is explicit test tooling. Installer execution, full release seal, clean OS, signing and live-model acceptance are separate.':'Development client and authored runtime from this checkout, using locally rebuilt core/host binaries identified by SHA256; not a Windows release acceptance','No model prompt, credentials, OS input, Pointer Lock, visible windows, desktop captures or external transmission; exports only selected test record through Main with fixed headless file authorization','Snapshot comparison retains every field including stable savedAt metadata','Main channel and fixed test save authorization; no real OS dialog, no claim of cross-process export receipt recovery']};
if(packageInfo)Object.assign(report,packageInfo.identity);
else{
 assert.equal(runtime,root,'Runtime source must come from this source checkout');
 const resources=JSON.parse(fs.readFileSync(path.join(runtime,'desktop/build/runtime-resources/runtime-resources.json'),'utf8'));
 assert.equal(resources.sourceCommit,report.commit);report.runtimeSourceCommit=resources.sourceCommit;report.runtimeFilesDigest=resources.filesDigest;
}
report.harnessSha256=sha(fs.readFileSync(import.meta.filename));
const core=packageInfo?packageInfo.core:path.join(runtime,'vendor/pi-desktop/target/release/craftmine-core.exe'),host=packageInfo?packageInfo.host:path.join(runtime,'vendor/pi-desktop/target/release/pi-desktop-host-core.exe');report.coreSha256=sha(fs.readFileSync(core));report.hostSha256=sha(fs.readFileSync(host));
let child,ended=true,ready=false,exit,launch;const pending=new Map();
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

const selectedFile=path.join(out,'selected-issue.json'),ledgerFile=path.join(profile,'craftmine-local-issues/issues.json');
function bytes(file){const stat=fs.lstatSync(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink());assert.equal(stat.nlink,1);return fs.readFileSync(file);}
try{
 await start();await until(()=>ready,Boolean,'headless controller');await until(()=>nav('world.createOptions'),x=>x.bases?.some(b=>b.id==='first-person'),'base catalog');
 const world=await step('create one authored first-person test world',()=>nav('world.create',{baseId:'first-person',starterId:'training-range',title:'Selected issue JSON acceptance',operationId:randomUUID()}));report.worldId=world.id;
 await step('one real broker build/check and formal application',async()=>{await until(async()=>{const r=await nav('world.list');return r.worlds.find(x=>x.id===world.id);},x=>{assert.ok(!['failed','cancelled','interrupted'].includes(x?.state),JSON.stringify(x));return x?.state==='ready';},'world initialization',900000);await loaded(world.id);const observed=await rpc('godotObserve');report.formalBuildId=observed.buildId;return observed;});
 await step('actual gameplay and explicit checkpoint before local reporting',async()=>{const old=snapshot(await rpc('godotSnapshot')),played=await rpc('godotPlay',{},60000);assert.equal(played.format,'craftmine.godot-gameplay-evidence/1');assert.equal(played.actions.length,8);assert.notDeepEqual(snapshot(await rpc('godotSnapshot')).body.player,old.body.player);const saved=await panel(world.id,'godot.runtimeSave',{freeze:true});assert.equal(saved.worldId,world.id);return saved;});
 const progress=snapshot(await rpc('godotSnapshot'));report.progress=progress;
 const description='  玩家原话：命中后颜色保留\n<script>literal text</script> 😃  ';
 const created=await step('real product issue create captures exact wording and formal identity',async()=>{const observed=await rpc('godotObserve'),r=await panel(world.id,'issue.create',{operationId:randomUUID(),description});assert.equal(r.status,'completed');assert.equal(r.issue.description,description);for(const key of ['worldId','buildId','instanceId'])assert.equal(r.issue.context[key],observed[key]);assert.equal(r.issue.context.baseId,'first-person');assert.equal(r.issue.context.baseVersion,'0.1.0');assert.match(r.issue.context.artifactManifestHash,/^[a-f0-9]{64}$/);assert.deepEqual(r.issue.attachments,[]);assert.equal(r.issue.client.version,packageInfo?packageInfo.identity.appVersion:JSON.parse(fs.readFileSync(path.join(app,'package.json'),'utf8')).version);if(r.issue.client.commit!==undefined)assert.equal(r.issue.client.commit,commit);return r;});
 await step('append original supplemental wording and explicit player retest status',async()=>{for(const [kind,text]of [['note','  补充原话\n不是自动诊断  '],['still-present','  玩家复测：仍能看到  ']]){const p=await panel(world.id,'issue.followupPrepare',{issueId:created.issue.id});const r=await panel(world.id,'issue.followup',{issueId:created.issue.id,revision:p.revision,contextHash:p.contextHash,operationId:randomUUID(),kind,text});assert.equal(r.status,'completed');}return panel(world.id,'issue.read',{issueId:created.issue.id});});
 const details=await panel(world.id,'issue.read',{issueId:created.issue.id});assert.deepEqual(details.issue,created.issue);assert.equal(details.revision,2);assert.equal(details.playerStatus,'still-present');assert.deepEqual(details.followups.map(f=>[f.kind,f.text]),[['note','  补充原话\n不是自动诊断  '],['still-present','  玩家复测：仍能看到  ']]);
 const ledger=bytes(ledgerFile);report.issue=details;report.ledgerSha256=sha(ledger);
 const input={issueId:created.issue.id,revision:details.revision,operationId:randomUUID()};
 const unchanged=async()=>{assert.deepEqual(await panel(world.id,'issue.read',{issueId:created.issue.id}),details);assert.deepEqual(bytes(ledgerFile),ledger);assert.deepEqual(snapshot(await rpc('godotSnapshot')),progress);assert.equal((await rpc('godotObserve')).buildId,report.formalBuildId);};
 assert.equal(fs.existsSync(selectedFile),false);
 const receipt=await step('actual Main export writes only selected record under fixed headless authorization',async()=>{const r=await panel(world.id,'issue.export',input);assertIssueExport(bytes(selectedFile),r,details,input);await unchanged();return r;});const exported=bytes(selectedFile);report.exportSha256=sha(exported);
 await step('same operation replays exact receipt and exact bytes without ledger or progress writes',async()=>{assert.deepEqual(await panel(world.id,'issue.export',input),receipt);assert.deepEqual(bytes(selectedFile),exported);await unchanged();return{replayed:true};});
 await step('wrong revision, unknown fields and unsupported channel reject without overwriting',async()=>{for(const [channel,payload,code]of [['issue.export',{...input,revision:1,operationId:randomUUID()},'ISSUE_REVISION_CHANGED'],['issue.export',{...input,operationId:randomUUID(),path:'forbidden-renderer-path'},'ISSUE_INVALID_INPUT'],['issue.exportAll',{},'Unsupported product panel acceptance channel']]){await assert.rejects(panel(world.id,channel,payload),e=>issueExportError(e,code));assert.deepEqual(bytes(selectedFile),exported);await unchanged();}return{rejected:3};});
 await step('first strict clean shutdown',auditStop);
 await start();await until(()=>ready,Boolean,'second controller');await loaded(world.id);
 await step('restart preserves original ledger, selected export and every saved gameplay field',async()=>{await unchanged();assert.deepEqual(bytes(selectedFile),exported);assertIssueExport(bytes(selectedFile),receipt,await panel(world.id,'issue.read',{issueId:created.issue.id}),input);return{ledgerSha256:sha(bytes(ledgerFile)),exportSha256:sha(bytes(selectedFile)),crossProcessReceiptReplayTested:false};});
 await step('second strict clean shutdown',auditStop);assert.equal(report.launches.length,2);report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}finally{if(!await finalizeDefaultClient(report,async()=>{await stop();if(launch)assertCleanHeadlessShutdown(launch);},persist))process.exitCode=1;console.log(JSON.stringify({out,passed:report.passed,steps:report.steps.map(({name,passed})=>({name,passed})),error:report.error,shutdownError:report.shutdownError}));}
