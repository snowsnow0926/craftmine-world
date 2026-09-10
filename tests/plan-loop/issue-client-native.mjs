// Actual compiled client and private profile; only finite page-script RPCs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
const arg=name=>{const i=process.argv.indexOf(name);assert.ok(i>=0,`Missing ${name}`);return path.resolve(process.argv[i+1]);};
const root=arg('--source-root'),runtime=arg('--runtime-source'),deps=arg('--deps-app'),app=path.join(root,'vendor/pi-desktop/apps/desktop');
const require=createRequire(path.join(deps,'package.json')),electron=require('electron'),sha=b=>createHash('sha256').update(b).digest('hex');
const main=fs.readFileSync(path.join(app,'out/main/index.js'),'utf8');
for(const marker of ['configureHeadlessAcceptance()','focusable: !headlessAcceptance','offscreen: !!headlessAcceptance','issue.create'])assert.ok(main.includes(marker),'Missing isolation/product marker '+marker);
assert.ok(fs.readFileSync(path.join(app,'out/preload/craftmine-headless.cjs'),'utf8').includes('requestPointerLock'));
const parent=path.join(root,'test-results');fs.mkdirSync(parent,{recursive:true});const out=fs.mkdtempSync(path.join(parent,'desktop-native-issues-')),profile=path.join(out,'profile'),legacy=path.join(out,'legacy'),token=randomUUID();fs.mkdirSync(profile);fs.mkdirSync(legacy);fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource:legacy}));
const report={format:'craftmine.local-issue-client/1',passed:false,root,runtime,out,commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),mainSha256:sha(main),pluginSha256:sha(fs.readFileSync(path.join(app,'resources/plugins/craftmine.world/views/view.js'))),steps:[],launches:[],limits:['Development client with unchanged baseline runtime and core binaries, not a Windows release acceptance','No model prompt, credentials, OS input, Pointer Lock, visible windows, screenshots or external report export','Snapshot comparison omits only savedAt timestamp fields, retaining all gameplay fields']};
const core=path.join(runtime,'vendor/pi-desktop/target/release/craftmine-core.exe'),host=path.join(runtime,'vendor/pi-desktop/target/release/pi-desktop-host-core.exe');report.coreSha256=sha(fs.readFileSync(core));report.hostSha256=sha(fs.readFileSync(host));
let child,ended=true,ready=false,exit,launch;const pending=new Map();
const persist=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
function start(){ended=false;ready=false;launch={at:new Date().toISOString()};report.launches.push(launch);
 const env={...process.env,CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_ROOT:out,CRAFTMINE_DATA_DIR:profile,CRAFTMINE_HEADLESS_TOKEN:token,CRAFTMINE_CORE_BIN:core,PI_DESKTOP_HOST_BIN:host,CRAFTMINE_GODOT_BASES:path.join(runtime,'desktop/godot')};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
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
function snapshot(value){const result=structuredClone(value?.state??value?.result?.state??value);delete result.savedAt;if(result.body)delete result.body.savedAt;return result;}
async function loaded(worldId){await until(()=>rpc('godotObserve'),x=>x?.worldId===worldId&&x.instanceId,'formal world',180000);await until(()=>rpc('worldNavigationReady'),x=>x.ready&&x.worldId===worldId,'world navigation');}
async function auditStop(){const audit=await rpc('status');assert.equal(audit.violations.length,0);assert.ok(audit.windows.every(w=>!w.visible&&!w.focused&&!w.focusable&&w.offscreen));await stop();assert.equal(launch.exit.code,0);assert.ok(!launch.forcedStop);assert.deepEqual(launch.audit?.violations,[]);assert.deepEqual(launch.audit?.pageErrors,[]);return launch;}
try{
 start();await until(()=>ready,Boolean,'headless controller');await until(()=>nav('world.createOptions'),x=>x.bases?.some(b=>b.id==='first-person'),'base catalog');
 const world=await step('create actual first-person world',()=>nav('world.create',{baseId:'first-person',starterId:'training-range',title:'Local issue notebook acceptance',operationId:randomUUID()}));report.worldId=world.id;
 await step('actual broker build and formal application',async()=>{await until(async()=>{const r=await nav('world.list');return r.worlds.find(x=>x.id===world.id);},x=>x?.state==='ready','world initialization',900000);await loaded(world.id);return rpc('godotObserve');});
 await step('real gameplay before recording',()=>rpc('godotPlay',{},60000));const before=snapshot(await rpc('godotSnapshot'));report.before=before;
 const input={operationId:randomUUID(),description:'  测试原话：开门后提示还在\n<script>this is literal</script>  '};
 const created=await step('product panel records original wording and trusted formal identity',async()=>{const observed=await rpc('godotObserve');const r=await panel(world.id,'issue.create',input);assert.equal(r.status,'completed');assert.equal(r.issue.description,input.description);for(const key of ['worldId','buildId','instanceId'])assert.equal(r.issue.context[key],observed[key]);assert.match(r.issue.context.artifactManifestHash,/^[a-f0-9]{64}$/);assert.deepEqual(r.issue.attachments,[]);assert.equal(r.issue.reproduction,'not-attempted');return r;});
 await step('same operation returns one record and preserves every gameplay field',async()=>{const replay=await panel(world.id,'issue.create',input);assert.equal(replay.replayed,true);assert.deepEqual(replay.issue,created.issue);assert.equal((await panel(world.id,'issue.list')).total,1);assert.deepEqual(snapshot(await rpc('godotSnapshot')),before);return replay;});
 await step('first orderly shutdown',auditStop);
 start();await until(()=>ready,Boolean,'second controller');await loaded(world.id);
 await step('new client process reads immutable record and complete saved gameplay',async()=>{const r=await panel(world.id,'issue.read',{issueId:created.issue.id});assert.deepEqual(r.issue,created.issue);assert.deepEqual(snapshot(await rpc('godotSnapshot')),before);return r;});
 const removed=await step('delete only this local report',()=>panel(world.id,'issue.delete',{issueId:created.issue.id,operationId:randomUUID()}));assert.equal(removed.deleted,true);
 await step('old create receipt cannot resurrect a deleted report',async()=>{const r=await panel(world.id,'issue.create',input);assert.equal(r.deleted,true);assert.equal(r.issue,null);assert.equal((await panel(world.id,'issue.list')).total,0);assert.deepEqual(snapshot(await rpc('godotSnapshot')),before);return r;});
 await step('second orderly shutdown',auditStop);
 start();await until(()=>ready,Boolean,'third controller');await loaded(world.id);
 await step('deletion remains durable after another client restart',async()=>{assert.equal((await panel(world.id,'issue.list')).total,0);assert.deepEqual(snapshot(await rpc('godotSnapshot')),before);return {total:0};});
 await step('third orderly shutdown',auditStop);report.passed=true;
}catch(e){report.error=String(e.stack??e);process.exitCode=1;}finally{await stop();report.finishedAt=new Date().toISOString();persist();console.log(JSON.stringify({out,passed:report.passed,steps:report.steps.map(({name,passed})=>({name,passed})),error:report.error}));}
