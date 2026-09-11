// Exercise the ordinary observer-upgrade button APIs in a retained isolated profile.
// Never creates a provider, invokes a model, edits source files or rewrites old reports.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {randomUUID,createHash} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';import {setTimeout as delay} from 'node:timers/promises';
import {inspectAdoptionSource,adoptionEnvironment} from './helpers/promo-adoption-contract.mjs';
import {creationPackagedRoot,resolveCreationNativeLaunch} from './helpers/creation-native-launch.mjs';
import {fileProof,assertProofs} from './helpers/promo-checkpoint-contract.mjs';
import {checkpointSanitizer} from './helpers/promo-checkpoint-live-contract.mjs';

const sourceFile=process.argv[2];assert.ok(sourceFile&&path.isAbsolute(sourceFile),'Pass an absolute stopped player report with an adopted checked build');
const source=inspectAdoptionSource(sourceFile),{original,out,profile,marker,selection}=source;
const sessionId=original.sessionId??original.session?.sessionId,worldId=selection.worldId;assert.ok(sessionId&&worldId);
const packagedRoot=creationPackagedRoot();assert.ok(packagedRoot,'Explicit frozen --packaged-root required');
const plan={sourceFile,profile,sessionId,worldId,expectedOldBuild:selection.buildId,oldPackage:original.packageIdentity.packaged,newPackage:packagedRoot,modelRequests:0,creationEvaluation:false,operation:'ordinary observer compatibility update'};
if(!process.argv.includes('--live')){console.log(JSON.stringify({mode:'prepare-only',...plan},null,2));process.exit(0);}
const client=resolveCreationNativeLaunch({root:process.cwd(),packagedRoot,requiredGuards:['HEADLESS_OBSERVER_NORMAL_SESSION_REQUIRED','playerObserverHint','playerObserverUpgrade','playerObserverStatus']});
assert.notEqual(client.identity.inventorySha256,original.packageIdentity.inventorySha256,'Observer upgrade must use an explicitly changed package');
const existingReports=fs.readdirSync(out).filter(name=>name.endsWith('.json')).map(name=>fileProof(path.join(out,name)));
const ledger=path.join(profile,'creation-evaluation-budget.json');const proofs=[...source.proofs,...existingReports,...(fs.existsSync(ledger)?[fileProof(ledger)]:[])];
const audit=path.join(out,'observer-upgrade-'+randomUUID());fs.mkdirSync(audit);const reportFile=path.join(audit,'report.json');
const sanitize=checkpointSanitizer([marker.token]),report={format:'craftmine.observer-upgrade-acceptance/1',...plan,newPackageIdentity:client.identity,changedPackage:true,startedAt:new Date().toISOString(),checks:[],launches:[],modelRequestsAdded:null,sourceEditsByHarness:0,sourceProofs:proofs};
const save=()=>fs.writeFileSync(reportFile,JSON.stringify(sanitize(report),null,2));save();console.log('Report: '+reportFile);
const callCount=()=>{const db=new DatabaseSync(path.join(profile,'pi.sqlite'),{readOnly:true});try{return db.prepare('SELECT count(*) AS calls FROM task_metric_calls').get().calls;}finally{db.close();}};
const sourceFiles=build=>{
 const builds=path.join(profile,'plugins/data/craftmine.world/godot-builds');const matches=fs.readdirSync(builds).map(world=>path.join(builds,world,build,'source')).filter(fs.existsSync);assert.equal(matches.length,1,'A unique actual build source is required');const directory=matches[0],files={};
 const visit=(relative='')=>{for(const entry of fs.readdirSync(path.join(directory,relative),{withFileTypes:true})){if(entry.name==='.godot')continue;const rel=path.join(relative,entry.name),file=path.join(directory,rel),stat=fs.lstatSync(file);assert.equal(stat.isSymbolicLink(),false);if(stat.isDirectory())visit(rel);else files[rel.replaceAll('\\','/')]=createHash('sha256').update(fs.readFileSync(file)).digest('hex');}};visit();return {directory,files};
};
const ordinaryFiles=value=>Object.fromEntries(Object.entries(value.files).filter(([name])=>!['craftmine_shared/base_adapter.gd','craftmine_shared/runtime_bridge.gd','craftmine_shared/state_guard.gd','craftmine_shared/headless_play_action.gd','craftmine_shared/scene_mesh_picker.gd'].includes(name)));
const snapshotBody=value=>{assert.ok(value?.result?.state?.body,'Actual validated runtime snapshot required');return value.result.state.body;};
let child,ended=true,ready=false,exitReport,exited;const pending=new Map();let cancelled=false;for(const event of ['SIGINT','SIGTERM'])process.on(event,()=>{cancelled=true;});
function validate(method,fields){
 const observer=['playerObserverHint','playerObserverUpgrade','playerObserverStatus'].includes(method);
 assert.ok(observer||['status','primaryMode','godotObserve','godotSnapshot','godotCaptureView','worldPanel','quit'].includes(method),'Observer acceptance method denied');
 if(observer){assert.deepEqual(Object.keys(fields),['payload']);assert.equal(fields.payload.sessionId,sessionId);assert.equal(fields.payload.worldId,worldId);}
 else if(method==='worldPanel')assert.deepEqual(fields,{channel:'godot.runtimeSave',payload:{worldId,freeze:true}});
 else if(method==='primaryMode')assert.ok(!Object.keys(fields).length||JSON.stringify(fields)==='{"payload":{"action":"create"}}');else assert.deepEqual(fields,{});
}
function rpc(method,fields={}){validate(method,fields);if(ended)return Promise.reject(Error('UPGRADE_CLIENT_EXITED'));return new Promise((resolve,reject)=>{const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('UPGRADE_RPC_TIMEOUT: '+method));},120000);pending.set(id,{resolve,reject,timer});child.send({type:'craftmine-headless',id,method,...fields});});}
async function until(read,accept){while(!cancelled){if(ended)throw Error('UPGRADE_CLIENT_EXITED');try{const value=await read();if(accept(value))return value;}catch(error){if(!/not ready|WORLD_BUSY|No world runtime is running|World view is not ready/i.test(error.message))throw error;}await delay(400);}throw Error('UPGRADE_CANCELLED');}
async function start(){
 assertProofs(proofs);client.assertUnchanged();ended=false;ready=false;exitReport=null;const launch={stdoutBytes:0,stderrBytes:0};report.launches.push(launch);
 const env=adoptionEnvironment(client,{out,profile,token:marker.token});assert.equal(env.CRAFTMINE_CREATION_EVAL,undefined);
 child=spawn(client.executable,client.args,{cwd:client.cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
 for(const name of ['stdout','stderr'])child[name].on('data',bytes=>{launch[name+'Bytes']+=bytes.length;});
 exited=new Promise(resolve=>{child.once('error',error=>{ended=true;launch.errorCode=error.code;resolve();});child.once('exit',(code,signal)=>{ended=true;launch.exit={code,signal};resolve();});});
 child.on('message',message=>{if(message.type==='craftmine-headless-ready')ready=true;if(message.type==='craftmine-headless-exit')exitReport=message;const call=pending.get(message.id);if(call){clearTimeout(call.timer);pending.delete(message.id);message.error?call.reject(Error(message.error)):call.resolve(message.result);}});
 await until(async()=>ready,Boolean);const state=await until(()=>rpc('status'),value=>value.windows?.length);assert.deepEqual(state.violations,[]);assert.ok(state.windows.every(w=>!w.visible&&!w.focused&&!w.focusable&&w.offscreen));
 await until(()=>rpc('primaryMode'),value=>value.entry);await rpc('primaryMode',{payload:{action:'create'}});await until(()=>rpc('godotObserve'),value=>{assert.equal(value.worldId,worldId);return value.instanceId;});
}
async function stop(){if(!child)return;if(!ended){try{await rpc('quit');}catch{}await Promise.race([exited,delay(15000)]);if(!ended){report.forcedStop=true;child.kill();await Promise.race([exited,delay(5000)]);}}
 report.launches.at(-1).audit=exitReport;assert.ok(!report.forcedStop);for(const name of ['violations','pageErrors','shutdownFailures'])assert.deepEqual(exitReport?.[name],[]);assertProofs(proofs);client.assertUnchanged();}
async function capture(name,build){const frame=await rpc('godotCaptureView');assert.equal(frame.viewportObservation.worldId,worldId);assert.equal(frame.viewportObservation.buildId,build);assert.equal(frame.width,1280);assert.equal(frame.height,720);fs.writeFileSync(path.join(audit,name+'.png'),Buffer.from(frame.pngBase64,'base64'),{flag:'wx'});return {file:name+'.png',width:frame.width,height:frame.height,buildId:build};}
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);save();console.log('PASS '+name);};
try{
 report.modelCallsBefore=callCount();report.oldSource=sourceFiles(selection.buildId);await start();report.before=await rpc('godotObserve');check('original adopted world is retained',report.before.buildId===selection.buildId);report.beforeProgress=snapshotBody(await rpc('godotSnapshot'));report.beforeCapture=await capture('before',selection.buildId);
 const identity={sessionId,worldId};report.hint=await rpc('playerObserverHint',{payload:identity});check('old observer offers only an uneditable upgrade handle',!!report.hint.upgradeId&&report.hint.captureId===null&&report.hint.target===null&&report.hint.reason==='SCENE_OBJECT_OBSERVER_UPGRADE_REQUIRED');
 report.operationId=randomUUID();save();report.accepted=await rpc('playerObserverUpgrade',{payload:{...identity,upgradeId:report.hint.upgradeId,operationId:report.operationId}});save();
 report.status=await until(()=>rpc('playerObserverStatus',{payload:{...identity,operationId:report.operationId}}),value=>{report.latestStatus=value;save();return ['applied','failed','interrupted'].includes(value.phase)&&!value.active;});check('normal check and adoption complete the maintenance operation',report.status.phase==='applied');
 report.after=await rpc('godotObserve');check('adoption creates a new build in the same world',report.after.worldId===worldId&&report.after.buildId!==report.before.buildId);report.afterProgress=snapshotBody(await rpc('godotSnapshot'));assert.deepEqual(report.afterProgress,report.beforeProgress);check('current player progress survives adoption',true);
 report.newSource=sourceFiles(report.after.buildId);assert.deepEqual(ordinaryFiles(report.newSource),ordinaryFiles(report.oldSource));check('ordinary authored source files remain byte-identical',true);
 report.refreshed=await rpc('playerObserverHint',{payload:identity});check('current observer permits a fresh ordinary capture',!!report.refreshed.captureId&&!report.refreshed.upgradeId&&report.refreshed.reason!=='SCENE_OBJECT_OBSERVER_UPGRADE_REQUIRED');report.afterCapture=await capture('after',report.after.buildId);
 report.saved=await rpc('worldPanel',{channel:'godot.runtimeSave',payload:{worldId,freeze:true}});await stop();
 await start();report.reopened=await rpc('godotObserve');check('cold reopen retains upgraded build with a fresh instance',report.reopened.worldId===worldId&&report.reopened.buildId===report.after.buildId&&report.reopened.instanceId!==report.after.instanceId);report.reopenedProgress=snapshotBody(await rpc('godotSnapshot'));assert.deepEqual(report.reopenedProgress,report.beforeProgress);report.reopenedHint=await rpc('playerObserverHint',{payload:identity});check('cold reopen supports current target capture',!!report.reopenedHint.captureId&&!report.reopenedHint.upgradeId);report.reopenedCapture=await capture('reopened',report.reopened.buildId);await stop();
 report.modelCallsAfter=callCount();assert.equal(report.modelCallsAfter,report.modelCallsBefore);report.modelRequestsAdded=0;check('no model calls and all old reports and budget ledger are unchanged',true);report.ok=true;
}catch(error){report.ok=false;report.error=String(error.stack??error);process.exitCode=1;console.error(error.message);}
finally{if(!ended)try{await stop();}catch(error){report.ok=false;report.shutdownError=String(error.message);process.exitCode=1;}for(const p of pending.values())clearTimeout(p.timer);try{assertProofs(proofs);client.assertUnchanged();report.modelCallsAfter=callCount();assert.equal(report.modelCallsAfter,report.modelCallsBefore);report.modelRequestsAdded=0;}catch(error){report.ok=false;report.integrityError=String(error.message);process.exitCode=1;}report.endedAt=new Date().toISOString();save();console.log('Report: '+reportFile);}
