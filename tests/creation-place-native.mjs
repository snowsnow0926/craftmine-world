// CN2: actual renderer bridge -> host durable edit -> source/check/adopt. No model or physical input.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {randomUUID,createHash} from 'node:crypto';import {setTimeout as delay} from 'node:timers/promises';
import {createCompleteOutput} from './godot-final/complete-contract.mjs';
import {assertCleanHeadlessShutdown} from './player-product/shutdown-exit-audit.mjs';import {completeCreationProgress} from './helpers/creation-model-evaluation.mjs';
import {resolveCreationNativeLaunch} from './helpers/creation-native-launch.mjs';
const root=path.resolve(process.env.CRAFTMINE_SOURCE_ROOT??process.cwd());
const client=resolveCreationNativeLaunch({root,requiredGuards:['craftmine-edit-acceptance']});
const {packaged,main}=client;
const out=createCompleteOutput(root),profile=path.join(out,'profile'),legacySource=path.join(out,'legacy'),token=randomUUID();fs.mkdirSync(profile);fs.mkdirSync(legacySource);fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource}));
const report={scope:'Actual main-frame bridge and native placement/copy/edit/undo/save pipeline; zero model',packaged,packageIdentity:client.identity,compiledSha256:createHash('sha256').update(main).digest('hex'),out,checks:[],launches:[],operations:[]};
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));const check=(name,value)=>{report.checks.push({name,passed:!!value});save();assert.ok(value,name);console.log('PASS '+name);};
let child,ready=false,ended=true,exit=Promise.resolve(),launch,sessionId='',worldId='';const pending=new Map();
function start(){client.assertUnchanged();ended=false;ready=false;launch={number:report.launches.length+1,executable:client.executable,args:client.args,cwd:client.cwd,packageInventorySha256:client.identity?.inventorySha256};report.launches.push(launch);const env=client.environment({out,profile,token});Object.assign(env,{CRAFTMINE_EDIT_ACCEPTANCE:'1',...(sessionId?{CRAFTMINE_EDIT_SESSION:sessionId}:{})});child=spawn(client.executable,client.args,{cwd:client.cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});const current=launch;current.pid=child.pid;for(const stream of ['stdout','stderr'])child[stream].on('data',bytes=>fs.appendFileSync(path.join(out,`${current.number}-${stream}.log`),bytes));child.on('message',m=>{if(m?.type==='craftmine-headless-ready')ready=true;if(m?.type==='craftmine-headless-exit')current.audit=m;const task=pending.get(m?.id);if(!task)return;clearTimeout(task.timer);pending.delete(m.id);m.error?task.reject(Error(m.error)):task.resolve(m.result);});exit=new Promise(resolve=>{const done=(code,signal,error)=>{if(ended)return;ended=true;current.exit={code,signal,...(error?{error:String(error)}:{})};for(const task of pending.values()){clearTimeout(task.timer);task.reject(Error('Client exited'));}pending.clear();resolve();};child.once('exit',(c,s)=>done(c,s));child.once('error',e=>done(null,null,e));});}
const rpc=(type,method,payload={},timeout=30000)=>new Promise((resolve,reject)=>{if(ended)return reject(Error('Client exited'));const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('Timeout '+method));},timeout);pending.set(id,{timer,resolve,reject});child.send({type,id,method,...payload});});
const native=(method,args={},timeout)=>rpc('craftmine-headless',method,args,timeout),edit=(method,payload={},timeout=30000)=>rpc('craftmine-edit-acceptance',method,{payload},timeout),nav=(channel,payload={})=>native('worldNavigation',{channel,payload},180000);
async function until(read,accept,label,timeout=90000){const end=Date.now()+timeout;let result;while(Date.now()<end){if(ended)throw Error('Client exited');try{result=await read();if(accept(result))return result;}catch(error){if(!/WORLD_BUSY|GODOT_CANDIDATE_ACTIVE|No world runtime is running|World view is not ready/.test(String(error.message)))throw error;}await delay(500);}throw Error(label+' timeout: '+JSON.stringify(result));}
async function settle(){await until(async()=>{const value=await nav('world.list'),row=value.worlds?.find(v=>v.id===worldId);if(row?.state==='failed')throw Error(JSON.stringify(row));return row;},r=>r?.state==='ready','World initialization',900000);await until(()=>native('godotObserve'),r=>r.worldId===worldId&&r.instanceId,'World runtime');await until(()=>native('worldNavigationReady'),r=>r.worldId===worldId&&r.ready,'World navigation released');}
async function started(){
 await until(async()=>ready,Boolean,'Headless ready');const isolation=await until(()=>native('status'),s=>s.windows.length,'Window ready');assert.deepEqual(isolation.violations,[]);assert.ok(isolation.windows.every(w=>!w.visible&&!w.focused&&!w.focusable&&w.offscreen));launch.initialIsolation=isolation;await until(()=>nav('world.createOptions'),s=>s.bases?.some(b=>b.id==='creation-sandbox'),'Catalog');
 // Restart already restores the persisted selection. Wait for that real load
 // and its navigation lock instead of sending a second world.open during it.
 if(worldId){const selected=await nav('world.list');assert.equal(selected.activeWorldId,worldId,'Restart must preserve selected world');await settle();}
}
async function stop(){if(!launch)return;if(!ended){try{await native('quit',{},5000);}catch{}await Promise.race([exit,delay(15000)]);if(!ended){launch.forcedStop=true;child.kill();await Promise.race([exit,delay(5000)]);if(!ended)throw Error('CLIENT_STOP_TIMEOUT');}}assertCleanHeadlessShutdown(launch);client.assertUnchanged();}
const observe=()=>native('godotObserve');
const capture=selection=>edit('godot.creationTarget',{sessionId,...(selection!==undefined?{selection}:{})});
async function perform(target,action,extra={}){
 const request={sessionId,captureId:target.captureId,operationId:randomUUID(),action,...extra};
 const initial=await edit('godot.creationEdit',request);report.operations.push({request,initial});save();
 const replay=await edit('godot.creationEdit',request);assert.equal(replay.operationId,initial.operationId);
 const status=await until(()=>edit('godot.creationEditStatus',{sessionId,worldId,operationId:request.operationId}),v=>['applied','failed','interrupted'].includes(v.phase),'Direct operation',650000);
 report.operations.at(-1).status=status;save();assert.equal(status.phase,'applied',JSON.stringify(status));await until(()=>edit('snapshot'),s=>!s.active,'Turn closeout');
 return status;
}
try{
 start();await started();worldId=(await nav('world.create',{baseId:'creation-sandbox',starterId:'blank',title:'常用造物无模型验收',operationId:randomUUID()})).id;await settle();sessionId=(await edit('initialize')).sessionId;
 const progressBefore=completeCreationProgress(await native('godotSnapshot'));
 for(const kind of ['tree','rock','chest','door','marker']){
  await edit('aim-ground');const target=await capture(null);assert.equal(target.target.surface,'ground');const placed=await perform(target,'place',{kind}),observation=await observe(),id=placed.receipt.createdIds[0],entity=observation.payload.creation.entities.find(e=>e.id===id);
  check(kind+' uses real default size/color and captured ground',entity?.kind===kind&&entity.scale.every(n=>n===1)&&entity.color.toLowerCase()==='#84a866'&&entity.position.every((n,i)=>Math.abs(n-target.target.position[i])<=.005));
  const fresh=await capture();check(kind+' adopted ID appears in recent results',fresh.recent?.some(e=>e.entityId===id&&e.available===true&&e.operationId===placed.operationId));
  await perform(fresh,'undo',{undoOperationId:placed.operationId});check(kind+' placement undo removes geometry',(await observe()).payload.creation.entities.length===0);
 }
 await edit('aim-ground');const placed=await perform(await capture(null),'place',{kind:'tree'}),originalId=placed.receipt.createdIds[0];
 const selected=await capture({worldId,entityId:originalId});check('recent result selects exact formal object',selected.source==='recent'&&selected.target.entityId===originalId);
 const rejectedRequest={sessionId,captureId:selected.captureId,operationId:randomUUID(),action:'place',kind:'rock'};
 await edit('godot.creationEdit',rejectedRequest);const denied=await until(()=>edit('godot.creationEditStatus',{sessionId,worldId,operationId:rejectedRequest.operationId}),v=>v.phase==='failed','Recent placement rejection');assert.match(denied.error,/GROUND_REQUIRED/);await until(()=>edit('snapshot'),s=>!s.active,'Rejected turn closeout');check('recent object cannot become a placement point',(await observe()).payload.creation.entities.length===1);
 const duplicated=await perform(await capture({worldId,entityId:originalId}),'duplicate',{count:2,offset:[3,0,0]}),copyId=duplicated.receipt.createdIds[0],copiesBefore=(await observe()).payload.creation.entities;
 check('two copies have distinct real IDs',duplicated.receipt.createdIds.length===2&&copiesBefore.length===3&&new Set(copiesBefore.map(e=>e.id)).size===3);
 const modified=await perform(await capture({worldId,entityId:copyId}),'modify',{changes:{color:'#1266cc'}}),copiesAfter=(await observe()).payload.creation.entities;
 check('only explicitly selected copy changes color',copiesAfter.every(e=>e.id===copyId?e.color.toLowerCase()==='#1266cc':JSON.stringify(e)===JSON.stringify(copiesBefore.find(old=>old.id===e.id))));
 await perform(await capture(),'undo',{undoOperationId:modified.operationId});check('undo preserves original and both copies',JSON.stringify((await observe()).payload.creation.entities)===JSON.stringify(copiesBefore));
 await native('worldPanel',{channel:'godot.runtimeSave',payload:{worldId,freeze:true}},180000);const saved=completeCreationProgress(await native('godotSnapshot')),formal=await observe();
 check('placement copy and undo preserve player inventory and reward ledgers',JSON.stringify(saved.body.player.position)===JSON.stringify(progressBefore.body.player.position)&&JSON.stringify(saved.body.inventory)===JSON.stringify(progressBefore.body.inventory)&&JSON.stringify(saved.body.openedChests)===JSON.stringify(progressBefore.body.openedChests));
 check('all direct operations used zero model requests',(await edit('snapshot')).metrics.calls.observed===0);await stop();
 start();await started();assert.equal((await edit('initialize')).sessionId,sessionId);check('same entities persist through cold reopen',JSON.stringify((await observe()).payload.creation.entities)===JSON.stringify(formal.payload.creation.entities));check('full progress persists through cold reopen',JSON.stringify(completeCreationProgress(await native('godotSnapshot')))===JSON.stringify(saved));
 const remembered=await capture();check('explicit selection survives reopen',remembered.source==='recent'&&remembered.target.entityId===copyId);
 const isolated=await native('status');check('actual windows remain hidden unfocused and offscreen',isolated.violations.length===0&&isolated.windows.every(w=>!w.visible&&!w.focused&&!w.focusable&&w.offscreen));
}catch(error){report.error=String(error.stack??error);process.exitCode=1;console.error(report.error);}finally{try{await stop();}catch(error){report.shutdownError=String(error);process.exitCode=1;}save();console.log('Evidence: '+out);}
