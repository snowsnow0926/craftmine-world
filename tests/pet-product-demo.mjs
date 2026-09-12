// Final immutable Windows product acceptance, deliberately zero model calls.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {randomUUID,createHash} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';import {setTimeout as delay} from 'node:timers/promises';
import {creationPackagedRoot,resolveCreationNativeLaunch} from './helpers/creation-native-launch.mjs';
import {createCompleteOutput} from './godot-final/complete-contract.mjs';import {adoptionEnvironment} from './helpers/promo-adoption-contract.mjs';
import {readBuiltinDemoPackages,readBuiltinDemoCatalog} from './helpers/builtin-demo-contract.mjs';
import {completeCreationProgress} from './helpers/creation-model-evaluation.mjs';
import {PET_PRODUCT_PLAN,validatePetProductCall,assertPetProgress,assertPetSaveReceipt} from './helpers/pet-product-contract.mjs';

const root=process.cwd(),packagedRoot=creationPackagedRoot();
const catalogAt=process.argv.indexOf('--catalog-root'),catalogRoot=catalogAt<0?null:process.argv[catalogAt+1];
if(!process.argv.includes('--run')){
 const items=packagedRoot?readBuiltinDemoPackages(packagedRoot,PET_PRODUCT_PLAN):catalogRoot?readBuiltinDemoCatalog(catalogRoot,PET_PRODUCT_PLAN):[];
 console.log(JSON.stringify({mode:'prepare-only',modelCalls:0,newIsolatedProfile:true,packagedRoot,needsFrozenProduct:!packagedRoot,plan:PET_PRODUCT_PLAN,archives:items.map(item=>({assetId:item.request.assetId,sha256:item.archiveSha256,rootContentHash:item.entry.rootContentHash})),capture:'godotCaptureBoundView only; exact current world/build/instance; no attach/resize',flow:'ordinary create/import/check/current preview/apply/walk/aim/one E/save/quit/cold reopen'}));process.exit(0);
}
assert.ok(packagedRoot,'Explicit frozen Windows product required');
const client=resolveCreationNativeLaunch({root,packagedRoot,requiredGuards:['godotCaptureBoundView','godotCaptureBoundState','godotExplore','PLAY_ACTION_AUTHORIZATION_FAILED']});
const [asset]=readBuiltinDemoPackages(packagedRoot,PET_PRODUCT_PLAN);
const out=createCompleteOutput(root),profile=path.join(out,'profile'),legacySource=path.join(out,'legacy'),token=randomUUID();fs.mkdirSync(profile);fs.mkdirSync(legacySource);
const marker=JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource});fs.writeFileSync(path.join(profile,'headless-profile.json'),marker);fs.writeFileSync(path.join(out,'component.zip'),asset.bytes);
const report={format:'craftmine.pet-product-demo/1',label:'开发者验收最终预制宠物成品，非模型生成',profile,packageIdentity:client.identity,plan:PET_PRODUCT_PLAN,archiveSha256:asset.archiveSha256,modelCalls:0,creationEvaluation:false,sourceEditsByHarness:0,startedAt:new Date().toISOString(),calls:[],launches:[],captures:[],ok:false};
const file=path.join(out,'report.json'),save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2));save();
const binding={worldId:null,operationId:randomUUID(),jobId:null,candidateId:null,activePreview:false,formalIdentity:null,captureIdentity:null};
let child,ready=false,ended=true,exited,launch;const pending=new Map();
function boot(){
 client.assertUnchanged();ready=false;ended=false;binding.activePreview=false;launch={number:report.launches.length+1};report.launches.push(launch);const current=launch;
 const env=adoptionEnvironment(client,{out,profile,token});assert.ok(!Object.keys(env).some(key=>/API_KEY|DEEPSEEK|EVAL|LIVE_CONFIG/.test(key)));
 child=spawn(client.executable,client.args,{cwd:client.cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
 for(const stream of ['stdout','stderr'])child[stream].on('data',bytes=>fs.appendFileSync(path.join(out,`${current.number}-${stream}.log`),bytes));
 child.on('message',message=>{if(message.type==='craftmine-headless-ready')ready=true;if(message.type==='craftmine-headless-exit')current.audit=message;const call=pending.get(message.id);if(call){clearTimeout(call.timer);pending.delete(message.id);message.error?call.reject(Error(message.error)):call.resolve(message.result);}});
 exited=new Promise(resolve=>{const finish=(code,signal,error)=>{ended=true;current.exit={code,signal,...(error?{error:String(error)}:{})};for(const call of pending.values()){clearTimeout(call.timer);call.reject(Error('PET_PRODUCT_EXITED'));}pending.clear();resolve();};child.once('exit',(code,signal)=>finish(code,signal));child.once('error',error=>finish(null,null,error));});
}
function rpc(method,fields={}){
 validatePetProductCall(method,fields,binding);report.calls.push(method+(['worldPanel','worldNavigation'].includes(method)?':'+fields.channel:''));
 return new Promise((resolve,reject)=>{assert.equal(ended,false);const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('PET_PRODUCT_RPC_TIMEOUT: '+method));},120000);pending.set(id,{resolve,reject,timer});child.send({type:'craftmine-headless',id,method,...fields});});
}
const nav=(channel,payload={})=>rpc('worldNavigation',{channel,payload});
const panel=(channel,payload={})=>rpc('worldPanel',{channel,payload:{worldId:binding.worldId,...payload}});
const pkg=(method,params={})=>panel('package.request',{method,params:{worldId:binding.worldId,...params}});
const snapshot=async()=>completeCreationProgress(await rpc('godotSnapshot'));
async function until(read,accept,label,timeout=120000){const end=Date.now()+timeout;while(Date.now()<end){if(ended)throw Error('PET_PRODUCT_EXITED');try{const value=await read();if(accept(value))return value;}catch(error){if(!/not ready|WORLD_BUSY|No world runtime is running|World view is not ready/i.test(error.message))throw error;}await delay(500);}throw Error('PET_PRODUCT_WAIT: '+label);}
async function entry(){await until(async()=>ready,Boolean,'controller');const status=await until(()=>rpc('status'),s=>s.windows?.length,'isolated window');assert.deepEqual(status.violations,[]);assert.deepEqual(status.pageErrors,[]);assert.ok(status.windows.every(w=>!w.visible&&!w.focused&&!w.focusable&&w.offscreen));await until(()=>rpc('primaryMode'),s=>s.entry,'normal mode entry');}
async function play(){await until(()=>rpc('primaryMode'),s=>s.playWorldId===binding.worldId,'ordinary play world');await rpc('primaryMode',{payload:{action:'play'}});await until(()=>rpc('primaryMode'),s=>s.play,'play layout');}
async function readyWorld(){const state=await until(()=>rpc('godotCaptureBoundState'),s=>s.formal?.worldId===binding.worldId&&['ready','paused','saved'].includes(s.state?.state),'host state ready');binding.formalIdentity=state.formal;return state;}
async function capture(label,candidate=false){
 const before=await rpc('godotCaptureBoundState');binding.captureIdentity=candidate?{...before.candidate,candidateId:binding.candidateId}:before.formal;
 assert.equal(binding.captureIdentity.worldId,binding.worldId);assert.equal(binding.captureIdentity.buildId,candidate?report.candidate.buildId:binding.formalIdentity.buildId);
 const image=await rpc('godotCaptureBoundView',{payload:binding.captureIdentity}),after=await rpc('godotCaptureBoundState');assert.deepEqual(after,before);
 const bytes=Buffer.from(image.pngBase64,'base64');assert.equal(createHash('sha256').update(bytes).digest('hex'),image.sha256);for(const field of ['worldId','buildId','instanceId'])assert.equal(image[field],binding.captureIdentity[field]);assert.equal(image.candidateId,binding.captureIdentity.candidateId??null);
 const imageFile=path.join(out,label+'.png');fs.writeFileSync(imageFile,bytes,{flag:'wx'});const{pngBase64,...metadata}=image;const receipt={file:imageFile,...metadata,hostStateAndBoundsUnchanged:true};report.captures.push(receipt);save();return receipt;
}
async function explore(steps){const receipt=await rpc('godotExplore',{payload:{...binding.formalIdentity,steps:steps.map(step=>({...step,capture:false}))}});assert.deepEqual(receipt.captures,[]);return receipt;}
function stored(){const db=new DatabaseSync(path.join(profile,'plugins/data/craftmine.world/tasks.sqlite'),{readOnly:true});try{const row=db.prepare('SELECT revision,document FROM craftmine_worlds WHERE id=?').get(binding.worldId);assert.ok(row);return{revision:row.revision,document:JSON.parse(row.document)};}finally{db.close();}}
async function stop(){if(!ended){await rpc('quit');await Promise.race([exited,delay(15000)]);if(!ended){child.kill();throw Error('PET_PRODUCT_SHUTDOWN_TIMEOUT');}}assert.equal(launch.exit.code,0);for(const field of ['violations','pageErrors','shutdownFailures'])assert.deepEqual(launch.audit?.[field],[]);client.assertUnchanged();assert.equal(fs.readFileSync(path.join(profile,'headless-profile.json'),'utf8'),marker);save();}

try{
 boot();await entry();await until(()=>nav('world.createOptions'),r=>r.bases?.some(b=>b.id==='creation-sandbox'),'base catalog');
 report.created=await nav('world.create',{baseId:'creation-sandbox',starterId:'blank',title:'最终成品宠物验收 · 开发者布置',operationId:randomUUID()});binding.worldId=report.worldId=report.created.id;save();
 await until(()=>nav('world.list'),r=>r.worlds?.some(w=>w.id===binding.worldId&&w.state==='ready'),'new world',900000);await until(()=>rpc('godotObserve'),r=>r.worldId===binding.worldId&&r.instanceId,'actual formal instance');await play();await readyWorld();
 report.before=await rpc('godotObserve');report.beforeCapture=await capture('blank-before');report.initialSource=await pkg('sourceList');
 report.installed=await pkg('importSource',{operationId:binding.operationId,position:PET_PRODUCT_PLAN[0].position});assert.equal(report.installed.applied,false);assert.equal(report.installed.archiveSha256,asset.archiveSha256);assert.equal(report.installed.instanceIds.length,1);binding.jobId=report.installed.job.id;report.entityId=report.installed.instanceIds[0];save();
 report.check=await until(()=>pkg('sourceJob',{jobId:binding.jobId}),job=>['passed','failed','cancelled','interrupted','blocked'].includes(job.status),'actual packaged check');assert.equal(report.check.status,'passed');
 const listed=await panel('godot.candidateList',{offset:0,limit:32}),matches=listed.items.filter(candidate=>candidate.checkJobId===binding.jobId);assert.equal(matches.length,1);report.candidate=matches[0];binding.candidateId=report.candidate.candidateId;
 report.checked=await panel('godot.candidateRead',{candidateId:binding.candidateId});assert.equal(report.checked.checkStatus,'passed');assert.equal(report.checked.candidate.sourceRevision,report.installed.source.revision);assert.equal(report.checked.candidate.manifestHash,report.installed.source.manifestHash);assert.ok(report.checked.check.assertions.length&&report.checked.check.assertions.every(a=>a.passed===true));
 report.preview=await panel('godot.candidatePreview',{candidateId:binding.candidateId});assert.equal(report.preview.status,'preview');binding.activePreview=true;report.previewCapture=await capture('pet-preview',true);
 report.applied=await panel('godot.candidateApply',{candidateId:binding.candidateId});assert.equal(report.applied.status,'applied');binding.activePreview=false;
 await until(()=>rpc('godotObserve'),o=>o.worldId===binding.worldId&&o.buildId===report.candidate.buildId,'adopted pet');await readyWorld();report.adoptedIdentity={...binding.formalIdentity};report.source=await pkg('sourceList');report.entityId=report.source.items.find(item=>item.archiveSha256===report.archiveSha256)?.entityId??report.source.items.at(-1)?.entityId;assert.ok(report.entityId,'Authoritative source entity id required');await panel('godot.runtimeResume');
 report.settle=await explore([{op:'wait',args:{frames:120}},{op:'wait',args:{frames:120}}]);report.beforeWalk=await snapshot();const initialPet=assertPetProgress(report.beforeWalk,binding.worldId,report.entityId);assert.equal(initialPet.interactionCount,0);
 report.follow=await explore([{op:'look',args:{yaw:0,pitch:0}},{op:'walk',args:{forward:-1,right:0,frames:30}},{op:'wait',args:{frames:120}},{op:'wait',args:{frames:120}}]);report.afterWalk=await snapshot();const followedPet=assertPetProgress(report.afterWalk,binding.worldId,report.entityId);assert.notDeepEqual(report.afterWalk.body.player.position,report.beforeWalk.body.player.position);assert.notDeepEqual(followedPet.position,initialPet.position);
 const player=report.afterWalk.body.player.position,delta=[followedPet.position[0]-player[0],followedPet.position[1]+0.77/2-player[1]-0.65,followedPet.position[2]-player[2]];
 report.aim={basis:'actual snapshot pet/player positions; packaged dog cylinder height 0.77m and base CameraRig eye offset 0.65m',yaw:Math.atan2(-delta[0],-delta[2]),pitch:Math.atan2(delta[1],Math.hypot(delta[0],delta[2]))};
 report.look=await explore([{op:'look',args:{yaw:report.aim.yaw,pitch:report.aim.pitch}}]);report.interaction=await explore([{op:'play-action',args:{action:'interact',frames:1}}]);report.feedbackCapture=await capture('pet-interaction');report.afterInteraction=await snapshot();const interactedPet=assertPetProgress(report.afterInteraction,binding.worldId,report.entityId);assert.equal(interactedPet.interactionCount,1);save();
 report.saved=await panel('godot.runtimeSave',{freeze:true});assertPetSaveReceipt(report.saved,binding.formalIdentity);report.savedSnapshot=await snapshot();assertPetProgress(report.savedSnapshot,binding.worldId,report.entityId);report.persisted=stored();assert.deepEqual(report.persisted.document.snapshot,report.savedSnapshot);report.savedCapture=await capture('pet-saved');await stop();
 boot();await entry();await until(()=>rpc('godotObserve'),r=>r.worldId===binding.worldId&&r.instanceId,'cold restored world');await readyWorld();report.reopenedIdentity={...binding.formalIdentity};assert.equal(report.reopenedIdentity.buildId,report.adoptedIdentity.buildId);assert.notEqual(report.reopenedIdentity.instanceId,report.adoptedIdentity.instanceId);
 report.reopenedSnapshot=await snapshot();assert.deepEqual(report.reopenedSnapshot,report.savedSnapshot,'Full saved component/player progress must restore exactly before gameplay resumes');report.reopenedSource=await pkg('sourceList');assert.deepEqual(report.reopenedSource,report.source);assertPetProgress(report.reopenedSnapshot,binding.worldId,report.entityId);
 await play();await readyWorld();report.reopenedCapture=await capture('pet-reopened');await stop();report.ok=true;report.stateIntegrityVerified=true;report.modelFreeBasis='new empty isolated profile; model/eval environment stripped; finite allowlisted controller; clean audits';
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{if(!ended)try{await stop();}catch(error){report.shutdownError=String(error);report.ok=false;process.exitCode=1;}report.endedAt=new Date().toISOString();save();console.log('Report: '+file);}
