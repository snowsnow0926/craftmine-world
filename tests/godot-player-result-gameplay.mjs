// Inspect a completed ordinary player run through protected runtime actions.
// The model's files remain untouched; controller actions never use OS input.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {playwright} from '../app/browser-tools.mjs';
import {enterRetainedPlayerWorld} from './helpers/player-world-entry.mjs';
import {readHeadlessProfile} from '../vendor/pi-desktop/apps/desktop/electron/main/craftmine-headless-profile.ts';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {resolveCreationNativeLaunch} from './helpers/creation-native-launch.mjs';
import {adoptionEnvironment,modelFreeExecutionEvidence} from './helpers/promo-adoption-contract.mjs';
const sourceFile=path.resolve(process.argv[2]),sourceBytes=fs.readFileSync(sourceFile),record=JSON.parse(sourceBytes);
assert.equal(record.status,'PASSED_PRODUCT_FLOW');
let source=record;
if(record.format==='craftmine.fb02-ordinary-player-continuation/1'){
  const originalBytes=fs.readFileSync(record.continuedFrom),original=JSON.parse(originalBytes);
  assert.equal(createHash('sha256').update(originalBytes).digest('hex'),record.originalReport.sha256);
  assert.equal(original.latest.application.phase,'applied');assert.equal(original.latest.metrics.status,'completed');assert.equal(record.modelCallsAdded,0);
  source={...original,...record,directory:path.dirname(record.profile),after:original.after};
}else assert.ok(['craftmine.fb02-ordinary-player/1','craftmine.fb03-ordinary-player/1','craftmine.godot-player-natural-followup/1'].includes(record.format));
const root=path.resolve(import.meta.dirname,".."),out=path.dirname(path.resolve(source.profile)),profile=path.resolve(source.profile);
assert.ok(path.isAbsolute(source.profile));assert.equal(path.resolve(source.profile),profile);
const marker=JSON.parse(fs.readFileSync(path.join(profile,'headless-profile.json')));
readHeadlessProfile({CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_ROOT:out,CRAFTMINE_DATA_DIR:profile,CRAFTMINE_HEADLESS_TOKEN:marker.token});
const client=resolveCreationNativeLaunch({root,packagedRoot:process.env.FINAL_PLAYER_APP??(source.development?null:source.package),requiredGuards:['godotExplore']});
const actualMainSha256=createHash('sha256').update(client.main).digest('hex');if(!process.env.FINAL_PLAYER_APP)assert.equal(actualMainSha256,source.mainBundleSha256);
const queue=path.join(profile,'creation-auto-queue');
for(const name of fs.existsSync(queue)?fs.readdirSync(queue):[]){if(/^[a-f0-9]{64}\.json$/.test(name))assert.ok(!['queued','applying','deferred','repairing'].includes(JSON.parse(fs.readFileSync(path.join(queue,name))).status),'Finish pending automatic work before model-free exploration');}
const steps=process.argv[3]?JSON.parse(fs.readFileSync(path.resolve(process.argv[3]))):[{op:'wait',args:{frames:30},capture:true}];
assert.ok(Array.isArray(steps));
const directory=path.join(source.directory,'gameplay-'+randomUUID());fs.mkdirSync(directory);
const report={format:'craftmine.godot-player-gameplay/1',sourceFile,product:process.env.FINAL_PLAYER_APP??source.package,mainBundleSha256:actualMainSha256,originalMainSha256:source.mainBundleSha256,directory,steps,sourceEdits:0,semanticAcceptance:'REQUIRES_REVIEW_OF_OBSERVATIONS_AND_PIXELS',calls:[]};
let ready=false,ended=false,browser,cdp='';const pending=new Map();
const child=spawn(client.executable,[...client.args,'--remote-debugging-port=0'],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:adoptionEnvironment(client,{out,profile,token:marker.token})});
for(const stream of ['stdout','stderr'])child[stream].on('data',bytes=>{cdp+=bytes.toString();fs.appendFileSync(path.join(directory,stream+'.log'),bytes);});
const exit=new Promise(resolve=>child.on('exit',(code,signal)=>{ended=true;report.exit={code,signal};resolve();}));
child.on('message',message=>{if(message.type==='craftmine-headless-ready')ready=true;if(message.type==='craftmine-headless-exit')report.audit=message;const call=pending.get(message.id);if(call){clearTimeout(call.timer);pending.delete(message.id);message.error?call.reject(Error(message.error)):call.resolve(message.result);}});
const rpc=(method,fields={})=>{
  const key=method==='worldPanel'?method+':'+fields.channel:method;
  assert.ok(['status','primaryMode','godotObserve','godotSnapshot','godotExplore','godotCaptureBoundState','godotCaptureBoundView','quit','worldPanel:godot.runtimeResume','worldPanel:godot.runtimeSave'].includes(key));
  if(method==='godotExplore'||method==='worldPanel')assert.equal(fields.payload.worldId,source.worldId);
  report.calls.push(key);return new Promise((resolve,reject)=>{if(ended)return reject(Error('APP_EXITED'));const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('RPC_TIMEOUT:'+method));},120000);pending.set(id,{resolve,reject,timer});child.send({type:'craftmine-headless',id,method,...fields});});
};
const until=async(read,accept)=>{for(let count=0;count<240;count++){if(ended)throw Error('APP_EXITED');try{const value=await read();if(accept(value))return value;}catch(error){if(!/not ready|WORLD_BUSY|No world runtime is running/.test(error.message))throw error;}await delay(500);}throw Error('RUNTIME_NOT_READY');};
const stop=async()=>{if(!ended){await rpc('quit');await Promise.race([exit,delay(20000,undefined,{ref:false})]);if(!ended){child.kill();await exit;throw Error('SHUTDOWN_TIMEOUT');}}assert.equal(report.exit.code,0);for(const key of ['violations','pageErrors','shutdownFailures'])assert.deepEqual(report.audit?.[key],[]);};
try{
  await until(async()=>ready,Boolean);const initial=await until(()=>rpc('primaryMode'),state=>state.width>0);
  const endpoint=await until(async()=>cdp.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1],Boolean);browser=await (await playwright()).chromium.connectOverCDP(endpoint,{noDefaults:true});const page=await until(async()=>browser.contexts()[0].pages().find(page=>page.url().startsWith('file:')),Boolean);report.entry=await enterRetainedPlayerWorld(page,source.worldId,until);
  if((await rpc('primaryMode')).play)await rpc('primaryMode',{payload:{action:'closed'}});
  report.before=await until(()=>rpc('godotObserve'),value=>value.worldId===source.worldId&&value.instanceId);
  assert.equal(report.before.buildId,source.after.formal.world.build.id);report.beforeSnapshot=await rpc('godotSnapshot');
  report.manualResumeCalls=0;
  const identity=Object.fromEntries(['worldId','buildId','instanceId'].map(key=>[key,report.before[key]]));
  report.exploration={actions:[],captures:[]};assert.ok(steps.length>0&&steps.length<=16);
  for(const [index,step] of steps.entries()){
    const result=await rpc('godotExplore',{payload:{...identity,steps:[{...step,capture:false}]}});
    report.exploration.actions.push(...result.actions);report.exploration.after=result.after;
    if(step.capture){
      const before=await rpc('godotCaptureBoundState'),image=await rpc('godotCaptureBoundView',{payload:identity});
      assert.deepEqual(await rpc('godotCaptureBoundState'),before,'read-only capture preserves native world and window state');
      for(const key of ['worldId','buildId','instanceId'])assert.equal(image[key],identity[key]);
      const bytes=Buffer.from(image.pngBase64,'base64');assert.equal(createHash('sha256').update(bytes).digest('hex'),image.sha256);
      const file=path.join(directory,'view-'+(index+1)+'.png');fs.writeFileSync(file,bytes);
      delete image.pngBase64;report.exploration.captures.push({afterAction:index,image:{...image,file}});
    }
  }
  report.snapshot=await rpc('godotSnapshot');
  assert.deepEqual(report.snapshot.state.body.inventory,report.beforeSnapshot.state.body.inventory,'Repeated E does not replenish inventory');
  await rpc('primaryMode',{payload:{action:'compact'}});await delay(500);
  report.pausedBefore=await rpc('godotSnapshot');
  try{report.pausedInteraction=await rpc('godotExplore',{payload:{...identity,steps:[{op:'play-action',args:{action:'interact',frames:1},capture:false}]}});}catch(error){report.pausedInteraction={rejected:String(error)};}
  report.pausedAfter=await rpc('godotSnapshot');
  assert.deepEqual(report.pausedAfter,report.pausedBefore,'Dialogue does not advance saved gameplay state');
  assert.match(report.pausedInteraction.rejected??'',/PAUSED|paused|not.*play|INPUT/i,'Protected gameplay rejects dialogue input');
  await rpc('primaryMode',{payload:{action:'closed'}});
  if(browser){await browser.close();browser=null;}
report.saved=await rpc('worldPanel',{channel:'godot.runtimeSave',payload:{worldId:source.worldId,freeze:true}});
  await stop();client.assertUnchanged();assert.ok(fs.readFileSync(sourceFile).equals(sourceBytes));
  report.noModelExecution=modelFreeExecutionEvidence(report.audit,report.calls);report.passed=true;
}catch(error){report.passed=false;report.error=String(error.stack??error);process.exitCode=1;}
finally{if(browser)await browser.close().catch(()=>{});if(!ended)try{await stop();}catch(error){report.shutdownError=String(error);report.passed=false;process.exitCode=1;}for(const call of pending.values())clearTimeout(call.timer);fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(path.join(directory,'report.json'));}

