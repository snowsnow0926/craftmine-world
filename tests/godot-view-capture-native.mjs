// Zero-model product acceptance: normal play UI and real captureView only.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {randomUUID,createHash} from 'node:crypto';import {setTimeout as delay} from 'node:timers/promises';
import {creationPackagedRoot,resolveCreationNativeLaunch} from './helpers/creation-native-launch.mjs';import {createCompleteOutput} from './godot-final/complete-contract.mjs';import {adoptionEnvironment} from './helpers/promo-adoption-contract.mjs';import {readBuiltinDemoPackages} from './helpers/builtin-demo-contract.mjs';
const packagedRoot=creationPackagedRoot(),component={assetId:'cw.environment.natural-daylight',version:1};
if(!process.argv.includes('--run')){console.log(JSON.stringify({mode:'prepare-only',modelCalls:0,newProfile:true,existingProfilesAccepted:false,captureMethod:'GodotWorldViewHost.captureView',forbidden:'headlessCapture; synthetic attach/resize; OS input/focus',packagedRoot,component,needsFrozenProduct:!packagedRoot}));process.exit(0);}
assert.ok(packagedRoot,'Explicit new frozen product required');const client=resolveCreationNativeLaunch({root:process.cwd(),packagedRoot,requiredGuards:['HEADLESS_BOUND_CAPTURE_DENIED','godotCaptureBoundState','godotCaptureBoundView']}),[asset]=readBuiltinDemoPackages(packagedRoot,[component]);
const out=createCompleteOutput(process.cwd()),profile=path.join(out,'profile'),legacySource=path.join(out,'legacy'),token=randomUUID();fs.mkdirSync(profile);fs.mkdirSync(legacySource);const marker=JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource});fs.writeFileSync(path.join(profile,'headless-profile.json'),marker);fs.writeFileSync(path.join(out,'component.zip'),asset.bytes);
const record={format:'craftmine.bound-view-capture-acceptance/1',packageIdentity:client.identity,profile,modelCalls:0,creationEvaluation:false,sourceEditsByHarness:0,component,calls:[],checks:[],captures:[],ok:false};
const reportFile=path.join(out,'report.json'),save=()=>fs.writeFileSync(reportFile,JSON.stringify(record,null,2));save();
const env=adoptionEnvironment(client,{out,profile,token});assert.equal(env.CRAFTMINE_CREATION_EVAL,undefined);assert.ok(!Object.keys(env).some(k=>/API_KEY|DEEPSEEK|EVAL_|LIVE_CONFIG/.test(k)));
let ready=false,ended=false,exitReport;const pending=new Map();
const child=spawn(client.executable,client.args,{cwd:client.cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});for(const stream of ['stdout','stderr'])child[stream].on('data',bytes=>fs.appendFileSync(path.join(out,stream+'.log'),bytes));
const exit=new Promise(resolve=>{child.once('exit',(code,signal)=>{ended=true;record.exit={code,signal};resolve();});child.once('error',error=>{ended=true;record.launchError=error.code;resolve();});});
child.on('message',message=>{if(message.type==='craftmine-headless-ready')ready=true;if(message.type==='craftmine-headless-exit')exitReport=message;const call=pending.get(message.id);if(call){clearTimeout(call.timer);pending.delete(message.id);message.error?call.reject(Error(message.error)):call.resolve(message.result);}});
function rpc(method,fields={}){
 assert.ok(['status','primaryMode','worldNavigation','worldPanel','godotObserve','godotCaptureBoundState','godotCaptureBoundView','quit'].includes(method),'CAPTURE_ACCEPTANCE_METHOD_DENIED');
 if(method==='worldNavigation')assert.ok(['world.createOptions','world.create','world.list'].includes(fields.channel));
 if(method==='worldPanel'){assert.ok(['package.request','godot.runtimeSave','godot.candidateList','godot.candidateRead','godot.candidatePreview','godot.candidateClose'].includes(fields.channel));if(fields.channel==='package.request')assert.ok(['importSource','sourceJob'].includes(fields.payload.method));}
 if(method==='primaryMode')assert.ok(fields.payload===undefined||fields.payload.action==='play');
 const key=method+(['worldPanel','worldNavigation'].includes(method)?':'+fields.channel:'');record.calls.push(key);
 return new Promise((resolve,reject)=>{assert.equal(ended,false);const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('CAPTURE_ACCEPTANCE_RPC_TIMEOUT: '+method));},120000);pending.set(id,{resolve,reject,timer});child.send({type:'craftmine-headless',id,method,...fields});});
}
async function until(read,accept,label,timeout=120000){const end=Date.now()+timeout;while(Date.now()<end){if(ended)throw Error('CAPTURE_CLIENT_EXITED');try{const value=await read();if(accept(value))return value;}catch(error){if(!/not ready|WORLD_BUSY|No world runtime is running|World view is not ready/.test(error.message))throw error;}await delay(500);}throw Error('CAPTURE_ACCEPTANCE_WAIT: '+label);}
const nav=(channel,payload={})=>rpc('worldNavigation',{channel,payload});
const panel=(channel,payload)=>rpc('worldPanel',{channel,payload});
const pkg=(worldId,method,args={})=>panel('package.request',{worldId,method,params:{worldId,...args}});
const state=()=>rpc('godotCaptureBoundState');const check=name=>{record.checks.push(name);console.log('PASS '+name);save();};
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
 const worldId=await createWorld('只读截图验收 · 独立世界');record.worldId=worldId;
 // A brand-new profile has no playable world: the normal play button first
 // opens world selection. Create a ready world before entering its play UI.
 await rpc('primaryMode',{payload:{action:'play'}});await until(()=>rpc('primaryMode'),s=>s.play,'ordinary play layout');save();
 record.frozen=await until(()=>panel('godot.runtimeSave',{worldId,freeze:true}),r=>r?.worldId===worldId,'formal freeze');
 const formalState=await state(),formal=formalState.formal;assert.equal(formal.worldId,worldId);assert.ok(['paused','saved'].includes(formalState.state?.state),'Formal paused host state required');record.formalIdentity=formal;
 await capture('formal',formal);await refused('wrong-formal-identity',{...formal,instanceId:'wrong-instance'});
 record.installed=await pkg(worldId,'importSource',{operationId:randomUUID()});assert.equal(record.installed.status,'check-queued');record.checked=await until(()=>pkg(worldId,'sourceJob',{jobId:record.installed.job.id}),j=>['passed','failed','cancelled','interrupted','blocked'].includes(j.status),'component check');assert.equal(record.checked.status,'passed');
 const listed=await panel('godot.candidateList',{worldId,offset:0,limit:32}),matches=listed.items.filter(c=>c.checkJobId===record.installed.job.id);assert.equal(matches.length,1);const candidate=matches[0];record.candidate=await panel('godot.candidateRead',{worldId,candidateId:candidate.candidateId});assert.equal(record.candidate.checkStatus,'passed');
 record.preview=await panel('godot.candidatePreview',{worldId,candidateId:candidate.candidateId});assert.equal(record.preview.status,'preview');const candidateState=await state();assert.equal(candidateState.candidate.worldId,worldId);assert.equal(candidateState.candidate.buildId,candidate.buildId);const identity={...candidateState.candidate,candidateId:candidate.candidateId};record.candidateIdentity=identity;
 await capture('candidate',identity);await refused('formal-during-preview',formal);await refused('wrong-candidate-id',{...identity,candidateId:'wrong-candidate'});
 record.closed=await panel('godot.candidateClose',{worldId});await refused('closed-candidate',identity);
 record.secondWorldId=await createWorld('只读截图验收 · 切换目标');assert.notEqual(record.secondWorldId,worldId);await refused('switched-formal',formal);
 record.ok=true;record.pauseScope='Formal freeze and host state compared; candidate preview identity/layout compared. No claim that formal state measures candidate engine pause.';
}catch(error){record.error=String(error.stack??error);process.exitCode=1;}
finally{
 if(!ended){try{await rpc('quit');}catch{}await Promise.race([exit,delay(15000)]);if(!ended){record.forcedStop=true;child.kill();record.ok=false;process.exitCode=1;}}
 for(const call of pending.values())clearTimeout(call.timer);record.exitReport=exitReport;
 try{assert.equal(record.forcedStop,undefined);for(const key of ['violations','pageErrors','shutdownFailures'])assert.deepEqual(exitReport?.[key],[]);assert.equal(fs.readFileSync(path.join(profile,'headless-profile.json'),'utf8'),marker);client.assertUnchanged();record.stateIntegrityVerified=true;}catch(error){record.stateIntegrityVerified=false;record.integrityError=String(error);record.ok=false;process.exitCode=1;}
 record.endedAt=new Date().toISOString();save();console.log('Report: '+reportFile);
}
