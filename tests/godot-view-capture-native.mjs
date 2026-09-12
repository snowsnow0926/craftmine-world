// Zero-model product acceptance: normal play UI and real captureView only.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {randomUUID,createHash} from 'node:crypto';import {setTimeout as delay} from 'node:timers/promises';
import {creationPackagedRoot,resolveCreationNativeLaunch} from './helpers/creation-native-launch.mjs';import {createCompleteOutput} from './godot-final/complete-contract.mjs';import {adoptionEnvironment} from './helpers/promo-adoption-contract.mjs';import {readBuiltinDemoPackages} from './helpers/builtin-demo-contract.mjs';
import {DatabaseSync} from 'node:sqlite';import {completeCreationProgress} from './helpers/creation-model-evaluation.mjs';
import {readCheckpointJson,fileProof,assertProofs} from './helpers/promo-checkpoint-contract.mjs';import {readHeadlessProfile} from '../vendor/pi-desktop/apps/desktop/electron/main/craftmine-headless-profile.ts';
const packagedRoot=creationPackagedRoot(),component={assetId:'cw.environment.natural-daylight',version:1};
const continuationArgument=process.argv.indexOf('--continue-report'),continuationFile=continuationArgument<0?null:process.argv[continuationArgument+1],continuation=continuationFile?readCheckpointJson(continuationFile):null;
if(continuation){assert.ok(path.isAbsolute(continuationFile));assert.equal(continuation.format,'craftmine.bound-view-capture-acceptance/1');assert.equal(continuation.ok,false);assert.equal(continuation.stateIntegrityVerified,true);assert.equal(continuation.modelCalls,0);assert.equal(continuation.preview?.status,'preview');assert.equal(continuation.checked?.status,'passed');assert.equal(continuation.exit?.code,0);}
if(!process.argv.includes('--run')){console.log(JSON.stringify({mode:'prepare-only',modelCalls:0,newProfile:!continuation,existingProfilesAccepted:!!continuation,continuedFrom:continuationFile,captureMethod:'GodotWorldViewHost.captureView',forbidden:'headlessCapture; synthetic attach/resize; OS input/focus',packagedRoot,component,needsFrozenProduct:!packagedRoot}));process.exit(0);}
assert.ok(packagedRoot,'Explicit new frozen product required');const client=resolveCreationNativeLaunch({root:process.cwd(),packagedRoot,requiredGuards:['HEADLESS_BOUND_CAPTURE_DENIED','godotCaptureBoundState','godotCaptureBoundView']}),[asset]=readBuiltinDemoPackages(packagedRoot,[component]);
const profileRoot=continuation?path.dirname(continuationFile):createCompleteOutput(process.cwd()),out=continuation?path.join(profileRoot,'preview-progress-'+randomUUID()):profileRoot,profile=path.join(profileRoot,'profile'),legacySource=path.join(profileRoot,'legacy');
let token,marker;const sourceProofs=[];
if(continuation){assert.equal(client.identity.inventorySha256,continuation.packageIdentity.inventorySha256);fs.mkdirSync(out);marker=fs.readFileSync(path.join(profile,'headless-profile.json'),'utf8');token=JSON.parse(marker).token;readHeadlessProfile({CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_ROOT:profileRoot,CRAFTMINE_DATA_DIR:profile,CRAFTMINE_HEADLESS_TOKEN:token});sourceProofs.push(fileProof(continuationFile));}
else{token=randomUUID();fs.mkdirSync(profile);fs.mkdirSync(legacySource);marker=JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource});fs.writeFileSync(path.join(profile,'headless-profile.json'),marker);fs.writeFileSync(path.join(out,'component.zip'),asset.bytes);}
const record={format:'craftmine.bound-view-capture-acceptance/1',packageIdentity:client.identity,profile,modelCalls:0,creationEvaluation:false,sourceEditsByHarness:0,component,calls:[],checks:[],captures:[],ok:false};
if(continuation)record.continuedFrom=continuationFile;
const reportFile=path.join(out,'report.json'),save=()=>fs.writeFileSync(reportFile,JSON.stringify(record,null,2));save();
const env=adoptionEnvironment(client,{out:profileRoot,profile,token});assert.equal(env.CRAFTMINE_CREATION_EVAL,undefined);assert.ok(!Object.keys(env).some(k=>/API_KEY|DEEPSEEK|EVAL_|LIVE_CONFIG/.test(k)));
let ready=false,ended=false,exitReport;const pending=new Map();
const child=spawn(client.executable,client.args,{cwd:client.cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});for(const stream of ['stdout','stderr'])child[stream].on('data',bytes=>fs.appendFileSync(path.join(out,stream+'.log'),bytes));
const exit=new Promise(resolve=>{child.once('exit',(code,signal)=>{ended=true;record.exit={code,signal};resolve();});child.once('error',error=>{ended=true;record.launchError=error.code;resolve();});});
child.on('message',message=>{if(message.type==='craftmine-headless-ready')ready=true;if(message.type==='craftmine-headless-exit')exitReport=message;const call=pending.get(message.id);if(call){clearTimeout(call.timer);pending.delete(message.id);message.error?call.reject(Error(message.error)):call.resolve(message.result);}});
function rpc(method,fields={}){
 assert.ok(['status','primaryMode','worldNavigation','worldPanel','godotObserve','godotSnapshot','godotExplore','godotCaptureBoundState','godotCaptureBoundView','quit'].includes(method),'CAPTURE_ACCEPTANCE_METHOD_DENIED');
 if(method==='godotExplore')assert.ok(fields.payload.steps.every(step=>step.capture===false&&['walk','look','wait'].includes(step.op)),'Only bounded input without old captures is allowed');
 if(method==='worldNavigation')assert.ok(['world.createOptions','world.create','world.list'].includes(fields.channel));
 if(method==='worldPanel'){assert.ok(['package.request','godot.runtimeSave','godot.runtimeResume','godot.candidateList','godot.candidateRead','godot.candidatePreview','godot.candidateClose'].includes(fields.channel));if(fields.channel==='package.request')assert.ok(['importSource','sourceJob'].includes(fields.payload.method));}
 if(method==='primaryMode')assert.ok(fields.payload===undefined||fields.payload.action==='play');
 const key=method+(['worldPanel','worldNavigation'].includes(method)?':'+fields.channel:'');record.calls.push(key);
 return new Promise((resolve,reject)=>{assert.equal(ended,false);const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('CAPTURE_ACCEPTANCE_RPC_TIMEOUT: '+method));},120000);pending.set(id,{resolve,reject,timer});child.send({type:'craftmine-headless',id,method,...fields});});
}
async function until(read,accept,label,timeout=120000){const end=Date.now()+timeout;while(Date.now()<end){if(ended)throw Error('CAPTURE_CLIENT_EXITED');try{const value=await read();if(accept(value))return value;}catch(error){if(!/not ready|WORLD_BUSY|No world runtime is running|World view is not ready/.test(error.message))throw error;}await delay(500);}throw Error('CAPTURE_ACCEPTANCE_WAIT: '+label);}
const nav=(channel,payload={})=>rpc('worldNavigation',{channel,payload});
const panel=(channel,payload)=>rpc('worldPanel',{channel,payload});
const pkg=(worldId,method,args={})=>panel('package.request',{worldId,method,params:{worldId,...args}});
const state=()=>rpc('godotCaptureBoundState');const check=name=>{record.checks.push(name);console.log('PASS '+name);save();};
function storedProgress(worldId,candidateId){
 const db=new DatabaseSync(path.join(profile,'plugins/data/craftmine.world/tasks.sqlite'),{readOnly:true});
 try{
  const world=db.prepare('SELECT id,revision,document FROM craftmine_worlds WHERE id=?').get(worldId);assert.ok(world);const document=JSON.parse(world.document);
  const application=candidateId?db.prepare('SELECT id,world_id,candidate_id,build_id,status,input,previous_world FROM craftmine_godot_applications WHERE world_id=? AND candidate_id=? ORDER BY created_at DESC LIMIT 1').get(worldId,candidateId):null;
  return{world:{id:world.id,revision:world.revision,buildId:document.build.id,snapshot:document.snapshot},application:application?{id:application.id,worldId:application.world_id,candidateId:application.candidate_id,buildId:application.build_id,status:application.status,input:JSON.parse(application.input),previousWorld:JSON.parse(application.previous_world)}:null};
 }finally{db.close();}
}
async function capture(label,identity){
 const before=await state(),frame=await rpc('godotCaptureBoundView',{payload:identity}),after=await state();assert.deepEqual(after,before,'Capture must not change host identity/state or any attached view/window bounds');
 for(const key of ['worldId','buildId','instanceId'])assert.equal(frame[key],identity[key]);assert.equal(frame.candidateId,identity.candidateId??null);assert.equal(frame.scope,identity.candidateId?'candidate':'formal');assert.equal(frame.format,'craftmine.godot-view-capture/1');
 const png=Buffer.from(frame.pngBase64,'base64');assert.ok(png.length<=4*1024*1024);assert.equal(createHash('sha256').update(png).digest('hex'),frame.sha256);assert.equal(png.readUInt32BE(16),frame.width);assert.equal(png.readUInt32BE(20),frame.height);assert.ok(frame.width<=1920&&frame.height<=1080);
 fs.writeFileSync(path.join(out,label+'.png'),png);delete frame.pngBase64;record.captures.push({label,before,after,...frame});check(label+' capture uses unchanged attached own view');return frame;
}
async function refused(label,identity){const before=await state();let failure;try{await rpc('godotCaptureBoundView',{payload:identity});}catch(error){failure=error.message;}assert.match(failure??'',/GODOT_VIEW_CAPTURE_/);assert.deepEqual(await state(),before);record[label]={refused:true,error:failure};check(label+' rejects without mutation');}
async function createWorld(title){const value=await nav('world.create',{baseId:'creation-sandbox',starterId:'blank',title,operationId:randomUUID()});assert.equal(typeof value.id,'string');record.createdWorlds??=[];record.createdWorlds.push(value.id);save();await until(()=>nav('world.list'),r=>r.worlds?.some(w=>w.id===value.id&&w.state==='ready'),'new world',900000);await until(()=>rpc('godotObserve'),r=>r.worldId===value.id&&r.instanceId,'formal runtime');return value.id;}
try{
 await until(async()=>ready,Boolean,'controller');record.isolation=await until(()=>rpc('status'),s=>s.windows?.length,'window');assert.deepEqual(record.isolation.violations,[]);assert.ok(record.isolation.windows.every(w=>!w.visible&&!w.focused&&!w.focusable&&w.offscreen));
 await until(()=>rpc('primaryMode'),s=>s.entry,'mode entry');await until(()=>nav('world.createOptions'),s=>s.bases?.some(b=>b.id==='creation-sandbox'),'base catalog');
 const worldId=continuation?continuation.worldId:await createWorld('只读截图验收 · 独立世界');record.worldId=worldId;
 // A brand-new profile has no playable world: the normal play button first
 // opens world selection. Create a ready world before entering its play UI.
 await until(()=>rpc('primaryMode'),s=>s.playWorldId===worldId,'play world ready');await rpc('primaryMode',{payload:{action:'play'}});await until(()=>rpc('primaryMode'),s=>s.play,'ordinary play layout');save();
 await until(()=>rpc('godotObserve'),r=>r.worldId===worldId&&r.instanceId&&(!continuation||r.buildId===continuation.formalIdentity.buildId),'exact formal instance restored');
 await until(()=>state(),s=>s.formal?.worldId===worldId&&['ready','paused','saved'].includes(s.state?.state),'formal host ready');
 record.frozen=await until(()=>panel('godot.runtimeSave',{worldId,freeze:true}),r=>r?.worldId===worldId,'formal freeze');
 const formalState=await state(),formal=formalState.formal;assert.equal(formal.worldId,worldId);assert.ok(['paused','saved'].includes(formalState.state?.state),'Formal paused host state required');record.formalIdentity=formal;
 await capture('formal',formal);await refused('wrong-formal-identity',{...formal,instanceId:'wrong-instance'});
 record.installed=continuation?continuation.installed:await pkg(worldId,'importSource',{operationId:randomUUID()});assert.equal(record.installed.status,'check-queued');record.checked=await until(()=>pkg(worldId,'sourceJob',{jobId:record.installed.job.id}),j=>['passed','failed','cancelled','interrupted','blocked'].includes(j.status),'component check');assert.equal(record.checked.status,'passed');
 const listed=await panel('godot.candidateList',{worldId,offset:0,limit:32}),matches=listed.items.filter(c=>c.checkJobId===record.installed.job.id);assert.equal(matches.length,1);const candidate=matches[0];record.candidate=await panel('godot.candidateRead',{worldId,candidateId:candidate.candidateId});assert.equal(record.candidate.checkStatus,'passed');
 record.beforeMovement=storedProgress(worldId);record.resumed=await panel('godot.runtimeResume',{worldId});
 record.movement=await rpc('godotExplore',{payload:{...formal,steps:[{op:'look',args:{yaw:0.6,pitch:-0.2},capture:false},{op:'walk',args:{forward:1,right:0,frames:36},capture:false},{op:'wait',args:{frames:120},capture:false}]}});
 record.settledSnapshot=completeCreationProgress(await rpc('godotSnapshot'));record.settledWait=await rpc('godotExplore',{payload:{...formal,steps:[{op:'wait',args:{frames:12},capture:false}]}});
 assert.deepEqual(record.movement.captures,[]);record.latestObservation=await rpc('godotObserve');record.latestSnapshot=completeCreationProgress(await rpc('godotSnapshot'));
 assert.equal(record.latestObservation.instanceId,formal.instanceId);assert.deepEqual(record.latestSnapshot,record.settledSnapshot,'Real input has settled before adjacent-tick comparison');assert.deepEqual(record.latestSnapshot.body.player,record.latestObservation.payload.player);assert.notDeepEqual(record.latestSnapshot.body.player.position,record.beforeMovement.world.snapshot.body.player.position);
 record.beforePreviewStored=storedProgress(worldId);assert.deepEqual(record.beforePreviewStored.world.snapshot.body.player,record.beforeMovement.world.snapshot.body.player,'Movement was not manually or automatically saved before preview');check('actual movement differs from saved progress before preview');
 record.preview=await panel('godot.candidatePreview',{worldId,candidateId:candidate.candidateId});assert.equal(record.preview.status,'preview');const candidateState=await state();assert.equal(candidateState.candidate.worldId,worldId);assert.equal(candidateState.candidate.buildId,candidate.buildId);const identity={...candidateState.candidate,candidateId:candidate.candidateId};record.candidateIdentity=identity;
 record.previewStored=storedProgress(worldId,candidate.candidateId);const prepared=record.previewStored.application;assert.ok(prepared);assert.equal(prepared.status,'prepared');assert.equal(prepared.input.worldId,worldId);assert.deepEqual(prepared.input.snapshot.body.player,record.latestSnapshot.body.player);assert.deepEqual(prepared.previousWorld.snapshot,record.latestSnapshot);assert.deepEqual(prepared.input.previousSnapshot??prepared.input.snapshot,record.latestSnapshot);assert.deepEqual(record.previewStored.world.snapshot,record.latestSnapshot);assert.equal(record.previewStored.world.buildId,formal.buildId);check('normal preview checkpoint and confirmed candidate use latest unsaved progress');
 await capture('candidate',identity);await refused('formal-during-preview',formal);await refused('wrong-candidate-id',{...identity,candidateId:'wrong-candidate'});
 record.closed=await panel('godot.candidateClose',{worldId});await refused('closed-candidate',identity);
 if(!continuation){record.secondWorldId=await createWorld('只读截图验收 · 切换目标');assert.notEqual(record.secondWorldId,worldId);await refused('switched-formal',formal);}
 record.ok=true;record.pauseScope='Formal freeze and host state compared; candidate preview identity/layout compared. No claim that formal state measures candidate engine pause.';
}catch(error){record.error=String(error.stack??error);process.exitCode=1;}
finally{
 if(!ended){try{await rpc('quit');}catch{}await Promise.race([exit,delay(15000)]);if(!ended){record.forcedStop=true;child.kill();record.ok=false;process.exitCode=1;}}
 for(const call of pending.values())clearTimeout(call.timer);record.exitReport=exitReport;
 try{assert.equal(record.forcedStop,undefined);for(const key of ['violations','pageErrors','shutdownFailures'])assert.deepEqual(exitReport?.[key],[]);assert.equal(fs.readFileSync(path.join(profile,'headless-profile.json'),'utf8'),marker);assertProofs(sourceProofs);client.assertUnchanged();record.stateIntegrityVerified=true;}catch(error){record.stateIntegrityVerified=false;record.integrityError=String(error);record.ok=false;process.exitCode=1;}
 record.endedAt=new Date().toISOString();save();console.log('Report: '+reportFile);
}
