// Two explicitly distinct modes: real detached native failure, then full
// offscreen client recovery. All fixture/profile writes belong to this D run.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {parameterClientArguments,inspectParameterPackage,isolatedParameterEnvironment} from '../../plan-loop/parameter-client-package.mjs';
import {loadPackageAsar} from '../../../desktop/package-asar.mjs';
import {assertCleanHeadlessShutdown} from '../../player-product/shutdown-exit-audit.mjs';
import {stopDefaultClient} from '../../player-product/default-client-audit.mjs';
import {godotPersistentProgress} from '../../../vendor/pi-desktop/apps/desktop/electron/main/craftmine-godot-bases-acceptance.ts';
import {OLD_BRIDGE,NEW_BRIDGE,sha,inventory,assertNativeFailure,assertRepair} from './legacy-retry-contract.mjs';
import {waitForInitialRuntime} from './legacy-runtime-ready.mjs';

const options=parameterClientArguments(process.argv.slice(2));
const {root,deps,runtime,packaged}=options;
assert.equal(path.parse(root).root.toUpperCase(),'D:\\','All new test output must be on D');
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),'','Require a frozen clean candidate');
if(packaged)assert.equal(commit,options.expectedCommit);
const asar=packaged?loadPackageAsar(deps):null;
const info=packaged?await inspectParameterPackage({...options,asar}):null;
const require=createRequire(path.join(deps,'package.json')),electron=require('electron');
const {build}=createRequire(path.resolve(deps,'../../packages/agent-runtime/package.json'))('esbuild');
const appDir=path.join(root,'vendor/pi-desktop/apps/desktop');
const resources=packaged?path.join(packaged,'resources'):path.join(root,'desktop/build/runtime-resources');
const core=info?.core??path.join(root,'vendor/pi-desktop/target/release/craftmine-core.exe');
const hostBinary=info?.host??path.join(root,'vendor/pi-desktop/target/release/pi-desktop-host-core.exe');
const bases=info?.bases??runtime,toolchainRoot=path.join(resources,'godot');
const plugin=packaged?path.join(resources,'plugins/craftmine.world'):path.join(appDir,'resources/plugins/craftmine.world');
const main=info?.main??fs.readFileSync(path.join(appDir,'out/main/index.js'));
for(const marker of ['configureHeadlessAcceptance()','focusable: !headlessAcceptance','offscreen: !!headlessAcceptance'])assert.ok(main.includes(Buffer.from(marker)),marker);
for(const marker of [OLD_BRIDGE,NEW_BRIDGE,'initialLoadRepair'])assert.ok(main.includes(Buffer.from(marker)),'Legacy repair missing from compiled client: '+marker);
assert.ok((info?.preload??fs.readFileSync(path.join(appDir,'out/preload/craftmine-headless.cjs'))).includes(Buffer.from('requestPointerLock')));
const identities={commit,mode:packaged?'packaged':'development',package:info?.identity??null,
 mainSha256:sha(main),coreSha256:sha(fs.readFileSync(core)),hostSha256:sha(fs.readFileSync(hostBinary)),
 executorSha256:sha(fs.readFileSync(path.join(plugin,'godot-executor.cjs'))),fixtureElectronSha256:sha(fs.readFileSync(electron))};
const verify=async()=>{assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),commit);assert.equal(sha(fs.readFileSync(core)),identities.coreSha256);if(info)assert.deepEqual((await inspectParameterPackage({...options,asar})).identity,info.identity);else assert.equal(sha(fs.readFileSync(path.join(appDir,'out/main/index.js'))),identities.mainSha256);};
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const out=fs.mkdtempSync(path.join(root,'test-results/desktop-native-lr-'));
const profile=path.join(out,'profile'),legacy=path.join(out,'legacy'),temp=path.join(out,'temp'),token=randomUUID(),worldId='legacy-'+randomUUID().replaceAll('-','').slice(0,20);
for(const dir of [profile,legacy,temp])fs.mkdirSync(dir);
process.env.TEMP=temp;process.env.TMP=temp;
fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource:legacy}));
const oldBridge=path.join(out,'old-runtime_bridge.gd');
const oldBytes=execFileSync('git',['show','eae279915094f09d987ef0eb747eba20ef92cd0e:desktop/godot/shared/runtime_bridge.gd'],{cwd:root,windowsHide:true});assert.equal(sha(oldBytes),OLD_BRIDGE);fs.writeFileSync(oldBridge,oldBytes);
const config={root,out,profile,worldId,operationId:randomUUID(),core,bases,plugin,oldBridge,materializerUrl:pathToFileURL(path.join(bases,'shared/materialize.mjs')).href,
 toolchain:{broker:path.join(toolchainRoot,'broker/godot-host-broker.exe'),brokerIdentity:path.join(toolchainRoot,'broker/broker-identity.json'),engineRoot:path.join(toolchainRoot,'engine/4.7.2-stable'),toolchainLock:path.join(toolchainRoot,'toolchain.lock.json'),bridgePath:path.join(toolchainRoot,'web/bridge.js')}};
const report={format:'craftmine.legacy-retry-client/1',out,worldId,identities,startedAt:new Date().toISOString(),steps:[],launches:[],calls:[],passed:false,
 limits:['Self-authored legacy bridge fixture; no player profile or installed-world migration.', 'Native detached child supplies actual load failure; offscreen full client supplies recovery and rendered gameplay. These are different rendering modes.', 'No input events, model requests, personal settings, generic page scripts or fault injection into product startup.']};
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));save();
const step=async(name,fn)=>{try{const value=await fn();report.steps.push({name,passed:true});save();console.log('PASS '+name);return value;}catch(error){report.steps.push({name,passed:false,error:String(error)});save();throw error;}};
const env=()=>({...isolatedParameterEnvironment(process.env,{out,profile,token,core,host:hostBinary,bases}),TEMP:temp,TMP:temp});
let child,closed=true,ready=false,launch,closePromise;const pending=new Map();
const evidence=value=>{if(Array.isArray(value))return value.map(evidence);if(!value||typeof value!=='object')return value;return Object.fromEntries(Object.entries(value).map(([key,data])=>{if(key!=='pngBase64')return [key,evidence(data)];const bytes=Buffer.from(data,'base64'),file='capture-'+randomUUID()+'.png';fs.writeFileSync(path.join(out,file),bytes);return ['image',{file,sha256:sha(bytes),bytes:bytes.length}];}));};
const rpc=(method,payload={},ms=180000)=>new Promise((resolve,reject)=>{assert.ok(!closed&&child.connected);const id=randomUUID(),record={method,payload,launch:launch.number};report.calls.push(record);const timer=setTimeout(()=>{pending.delete(id);reject(Error('IPC_TIMEOUT:'+method));},ms);pending.set(id,{timer,resolve:v=>{record.result=evidence(v);save();resolve(v);},reject});child.send({type:'craftmine-headless',id,method,...payload});});
const nav=(channel,payload={})=>rpc('worldNavigation',{channel,payload});
const panel=(channel,payload={})=>rpc('worldPanel',{channel,payload:{worldId,...payload}});
const runtimeReady=()=>waitForInitialRuntime({observe:()=>rpc('godotObserve'),worldId});
const until=async(fn,predicate,label,ms=120000)=>{const end=Date.now()+ms;let value;while(Date.now()<end){assert.ok(!closed);value=await fn();if(predicate(value))return value;await delay(250);}throw Error(label+': '+JSON.stringify(value));};
async function start(){await verify();assert.ok(closed);closed=false;ready=false;launch={number:report.launches.length+1};report.launches.push(launch);const thisLaunch=launch;
 child=spawn(info?.executable??electron,info?.arguments??[appDir],{cwd:root,env:env(),windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
 for(const stream of ['stdout','stderr'])child[stream].on('data',b=>fs.appendFileSync(path.join(out,`${thisLaunch.number}-${stream}.log`),b));
 child.on('message',m=>{if(m?.type==='craftmine-headless-ready')ready=true;if(m?.type==='craftmine-headless-exit')thisLaunch.audit=m;if(m?.type!=='craftmine-headless')return;const p=pending.get(m.id);if(!p)return;clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m.result);});
 closePromise=new Promise(resolve=>{child.once('error',error=>{thisLaunch.spawnError=String(error);});child.once('close',(code,signal)=>{closed=true;thisLaunch.exit={code,signal};for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Client closed'));}pending.clear();save();resolve();});});
 await until(()=>ready,Boolean,'headless ready');const status=await until(()=>rpc('status'),s=>s.windows?.length>0,'window');assert.deepEqual(status.violations,[]);assert.ok(status.windows.every(w=>!w.visible&&!w.focused&&!w.focusable&&w.offscreen));await until(()=>nav('world.createOptions'),s=>s.bases?.length>0,'catalog');
}
async function stop(){if(!launch)return;await stopDefaultClient({ended:()=>closed,quit:()=>rpc('quit',{},5000),exit:closePromise,launch,kill:()=>child.kill()});assertCleanHeadlessShutdown(launch);}
async function inspectCore(before){assert.ok(closed,'Never open a second Core beside the client');await verify();const {CoreClient}=createRequire(path.join(plugin,'main.cjs'))('./core-client.cjs'),db=new CoreClient(core,path.join(profile,'plugins/data/craftmine.world'));const oldGit=process.env.CRAFTMINE_BUNDLED_GIT;process.env.CRAFTMINE_BUNDLED_GIT=path.join(resources,'git/bin/git.exe');await db.start();const end=new Promise(resolve=>db.child.once('close',(code,signal)=>resolve({code,signal})));const call=(m,p)=>db.call(m,p,120000);
 async function index(binding={}){let offset=0,page;const files=[];do{page=await call('godotProject.index',{context:before.context,worldId,...binding,offset,limit:32});files.push(...page.files);offset=page.nextOffset??0;}while(offset);return {revision:page.revision,manifestHash:page.manifestHash,files};}
 try{const init=await call('godotWorld.initStatus',{worldId});const application=await call('godotApplication.read',{id:init.applicationId});const candidate=await call('godotCandidate.read',{worldId,candidateId:application.candidateId});return {init,application,project:await index(),oldProject:await index({revision:before.project.revision,manifestHash:before.project.manifestHash}),oldApplication:await call('godotApplication.read',{id:before.application.id}),job:await call('godotBuild.read',{worldId,jobId:candidate.candidate.checkJobId}),formal:await call('godotRuntime.describe',{worldId})};}
 finally{await db.stop();assert.equal((await end).code,0);if(oldGit===undefined)delete process.env.CRAFTMINE_BUNDLED_GIT;else process.env.CRAFTMINE_BUNDLED_GIT=oldGit;}
}
try {
 await step('real native hidden first load fails and Core persists the aborted attempt',async()=>{
  await verify();const fixtureApp=path.join(out,'fixture-app');fs.mkdirSync(path.join(fixtureApp,'main'),{recursive:true});fs.mkdirSync(path.join(fixtureApp,'preload'));
  fs.writeFileSync(path.join(fixtureApp,'package.json'),JSON.stringify({main:'main/index.cjs'}));fs.writeFileSync(path.join(out,'fixture-config.json'),JSON.stringify(config));
  const nativeMode={name:'fixed-native-child-only',setup(b){b.onResolve({filter:/\/craftmine-headless$/},()=>({path:'native-mode',namespace:'legacy-fixture'}));b.onLoad({filter:/.*/,namespace:'legacy-fixture'},()=>({contents:'export const isHeadlessAcceptance=()=>false;',loader:'js'}));}};
  for(const [entry,file]of [['tests/player-feedback/P1/legacy-retry-fixture.mjs','main/index.cjs'],['vendor/pi-desktop/apps/desktop/electron/preload/godot-world.ts','preload/godot-world.cjs'],['vendor/pi-desktop/apps/desktop/electron/preload/godot-check.ts','preload/godot-check.cjs']])await build({entryPoints:[path.join(root,entry)],outfile:path.join(fixtureApp,file),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron'],plugins:[nativeMode],logLevel:'warning'});
  fs.copyFileSync(path.join(root,'tests/godot-world-view/pointer-guard.cjs'),path.join(fixtureApp,'main/pointer-guard.cjs'));
  const fixtureEnv={...env(),CRAFTMINE_LEGACY_FIXTURE:path.join(out,'fixture-config.json'),CRAFTMINE_BUNDLED_GIT:path.join(resources,'git/bin/git.exe')};
  const p=spawn(electron,[fixtureApp,'--user-data-dir='+path.join(out,'fixture-electron-profile')],{cwd:root,env:fixtureEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});
  for(const s of ['stdout','stderr'])p[s].on('data',b=>fs.appendFileSync(path.join(out,'fixture-'+s+'.log'),b));let forced=false;const timer=setTimeout(()=>{forced=true;p.kill();},900000);
  const exit=await new Promise((resolve,reject)=>{p.once('error',reject);p.once('close',(code,signal)=>resolve({code,signal,forced}));});clearTimeout(timer);report.fixtureExit=exit;assert.equal(exit.code,0);assert.equal(forced,false);
  report.before=JSON.parse(fs.readFileSync(path.join(out,'native-failure.json')));assertNativeFailure(report.before);
 });
 await step('full client reads the same durable failure without automatically retrying',async()=>{await start();const list=await nav('world.list'),row=list.worlds.find(w=>w.id===worldId);assert.equal(row.state,'failed');assert.equal(row.creation.stage,'confirm');assert.equal(row.creation.error.code,'GODOT_INITIAL_LOAD_FAILED');await nav('world.open',{id:worldId});await until(()=>rpc('worldNavigationReady'),x=>x.ready&&x.worldId===worldId,'failed world navigation');});
 await step('explicit product retry checks a new candidate and confirms first load',async()=>{await nav('world.creationRetry',{worldId});await until(()=>nav('world.list'),list=>{const row=list.worlds.find(w=>w.id===worldId);assert.notEqual(row?.state,'failed',JSON.stringify(row));return row?.state==='ready';},'repaired world',900000);await runtimeReady();const capture=await rpc('godotCaptureView');assert.deepEqual([capture.width,capture.height],[1280,720]);assert.ok(capture.pixelStats.sampledColors>4);report.capture=evidence(capture);});
 await step('save full native progress and cleanly close',async()=>{await panel('godot.runtimeSave',{freeze:true});report.snapshot=godotPersistentProgress(await rpc('godotSnapshot'));await stop();});
 await step('only the pinned bridge changes; old source and abort evidence survive',async()=>{report.after=await inspectCore(report.before);assertRepair(report.before,report.after);assert.deepEqual(inventory(path.join(profile,'godot-worlds',worldId)),report.before.managedFiles);assert.equal(sha(fs.readFileSync(oldBridge)),OLD_BRIDGE);});
 await step('full client restart opens the repaired build with complete saved progress',async()=>{await start();await runtimeReady();const selection=await nav('world.list');assert.equal(selection.activeWorldId,worldId);assert.equal(selection.worlds.find(w=>w.id===worldId)?.state,'ready');await panel('godot.runtimeSave',{freeze:true});assert.deepEqual(godotPersistentProgress(await rpc('godotSnapshot')),report.snapshot);await stop();});
 report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{try{await stop();}catch(error){report.passed=false;report.shutdownError=String(error);process.exitCode=1;}report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({out,passed:report.passed,error:report.error}));}
