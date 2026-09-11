// Developer-arranged prefab demonstration, not model-created artwork.
// Runs only the immutable product, in a new isolated profile, without model configuration.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {randomUUID,createHash} from 'node:crypto';import {setTimeout as delay} from 'node:timers/promises';
import {creationPackagedRoot,resolveCreationNativeLaunch} from './helpers/creation-native-launch.mjs';
import {createCompleteOutput} from './godot-final/complete-contract.mjs';
import {adoptionEnvironment} from './helpers/promo-adoption-contract.mjs';
import {BUILTIN_DEMO_PLAN,readBuiltinDemoPackages,readBuiltinDemoCatalog,validateBuiltinDemoCall} from './helpers/builtin-demo-contract.mjs';
const root=process.cwd(),packagedRoot=creationPackagedRoot();
const planAt=process.argv.indexOf('--plan'),plan=planAt>=0?JSON.parse(fs.readFileSync(process.argv[planAt+1],'utf8')):BUILTIN_DEMO_PLAN;
if(!process.argv.includes('--run')){
 const catalogAt=process.argv.indexOf('--catalog-root'),catalog=catalogAt>=0?process.argv[catalogAt+1]:null;
 const packages=(packagedRoot?readBuiltinDemoPackages(packagedRoot,plan):catalog?readBuiltinDemoCatalog(catalog,plan):null)?.map(p=>({request:p.request,archiveSha256:p.archiveSha256,rootContentHash:p.entry.rootContentHash}))??null;
 console.log(JSON.stringify({mode:'prepare-only',role:'developer-arranged-prefab-demo',modelCalls:0,plan,packagedRoot,packages,needsFrozenPackage:!packagedRoot}));process.exit(0);
}
assert.ok(packagedRoot,'Explicit frozen --packaged-root required');
const client=resolveCreationNativeLaunch({root,packagedRoot,requiredGuards:['godotExplore','installSourceProposal','INVALID_PLACEMENT']}),packages=readBuiltinDemoPackages(packagedRoot,plan);
const out=createCompleteOutput(root),profile=path.join(out,'profile'),legacySource=path.join(out,'legacy'),token=randomUUID();fs.mkdirSync(profile);fs.mkdirSync(legacySource);
const marker=JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource});fs.writeFileSync(path.join(profile,'headless-profile.json'),marker);
const report={format:'craftmine.builtin-prefab-demo/1',role:'developer-arranged-prefab-demo',label:'开发者布置预制组件演示，非模型生成',packageIdentity:client.identity,startedAt:new Date().toISOString(),modelCalls:0,creationEvaluation:false,sourceEditsByHarness:0,plan,installations:[],launches:[],calls:[],visual:'UNVERIFIED',ok:false};
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));save();
let worldId,child,ready=false,ended=true,exit,launch;const pending=new Map();
function start(){
 client.assertUnchanged();ready=false;ended=false;launch={number:report.launches.length+1,stdoutBytes:0,stderrBytes:0};report.launches.push(launch);
 const env=adoptionEnvironment(client,{out,profile,token});assert.equal(env.CRAFTMINE_CREATION_EVAL,undefined);assert.ok(!Object.keys(env).some(k=>/API_KEY|DEEPSEEK|EVAL_|LIVE_CONFIG/.test(k)));
 child=spawn(client.executable,client.args,{cwd:client.cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});const current=launch;
 for(const stream of ['stdout','stderr'])child[stream].on('data',bytes=>{current[stream+'Bytes']+=bytes.length;fs.appendFileSync(path.join(out,current.number+'-'+stream+'.log'),bytes);});
 child.on('message',message=>{if(message.type==='craftmine-headless-ready')ready=true;if(message.type==='craftmine-headless-exit')current.audit=message;const call=pending.get(message.id);if(call){clearTimeout(call.timer);pending.delete(message.id);message.error?call.reject(Error(message.error)):call.resolve(message.result);}});
 exit=new Promise(resolve=>{const finish=(code,signal,error)=>{ended=true;current.exit={code,signal,...(error?{error:String(error)}:{})};for(const call of pending.values()){clearTimeout(call.timer);call.reject(Error('DEMO_CLIENT_EXITED'));}pending.clear();resolve();};child.once('exit',(c,s)=>finish(c,s));child.once('error',error=>finish(null,null,error));});
}
function rpc(method,fields={}){
 validateBuiltinDemoCall(method,fields,worldId);report.calls.push(method==='worldPanel'||method==='worldNavigation'?method+':'+fields.channel+(fields.channel==='package.request'?':'+fields.payload.method:''):method);
 return new Promise((resolve,reject)=>{assert.equal(ended,false);const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('DEMO_RPC_TIMEOUT: '+method));},120000);pending.set(id,{resolve,reject,timer});child.send({type:'craftmine-headless',id,method,...fields});});
}
const panel=(channel,payload={})=>rpc('worldPanel',{channel,payload:{worldId,...payload}});
const pkg=(method,params={})=>panel('package.request',{method,params:{worldId,...params}});
const nav=(channel,payload={})=>rpc('worldNavigation',{channel,payload});
async function until(read,accept,label,ms=120000){const end=Date.now()+ms;while(Date.now()<end){if(ended)throw Error('DEMO_CLIENT_EXITED');try{const value=await read();if(accept(value))return value;}catch(error){if(!/not ready|WORLD_BUSY|No world runtime is running|World view is not ready/i.test(error.message))throw error;}await delay(500);}throw Error('DEMO_WAIT_TIMEOUT: '+label);}
async function entry(){await until(async()=>ready,Boolean,'controller');const status=await until(()=>rpc('status'),s=>s.windows?.length,'isolation');assert.deepEqual(status.violations,[]);assert.deepEqual(status.pageErrors,[]);assert.ok(status.windows.every(w=>!w.visible&&!w.focused&&!w.focusable&&w.offscreen));await until(()=>rpc('primaryMode'),s=>s.entry,'mode entry');await rpc('primaryMode',{payload:{action:'create'}});}
async function stop(){if(!ended){await rpc('quit');await Promise.race([exit,delay(15000)]);if(!ended){child.kill();throw Error('DEMO_SHUTDOWN_TIMEOUT');}}for(const field of ['violations','pageErrors','shutdownFailures'])assert.deepEqual(launch.audit?.[field],[]);client.assertUnchanged();assert.equal(fs.readFileSync(path.join(profile,'headless-profile.json'),'utf8'),marker);}
async function capture(name){const result=await rpc('godotCaptureView');assert.ok(result.width===1280&&result.height===720&&result.pngBase64.startsWith('iVBOR'));const bytes=Buffer.from(result.pngBase64,'base64');fs.writeFileSync(path.join(out,name),bytes);return {file:name,width:result.width,height:result.height,sha256:createHash('sha256').update(bytes).digest('hex')};}
async function overview(){const current=await rpc('godotObserve');return rpc('godotExplore',{payload:{worldId,buildId:current.buildId,instanceId:current.instanceId,steps:[{op:'look',args:{yaw:0,pitch:0.03}},{op:'walk',args:{forward:-1,right:0,frames:40}},{op:'wait',args:{frames:30}}]}});}
try{
 start();await entry();await until(()=>nav('world.createOptions'),r=>r.bases?.some(b=>b.id==='creation-sandbox'),'base catalog');
 const created=await nav('world.create',{baseId:'creation-sandbox',starterId:'blank',title:'预制组件演示 · 开发者布置',operationId:randomUUID()});worldId=created.id;assert.equal(typeof worldId,'string');report.worldId=worldId;save();
 await until(()=>nav('world.list'),r=>r.worlds?.some(w=>w.id===worldId&&w.state==='ready'),'new sandbox',900000);
 report.before=await until(()=>rpc('godotObserve'),r=>r.worldId===worldId&&r.instanceId,'new world runtime');await panel('godot.runtimeResume');report.beforeCapture=await capture('before.png');report.initialSource=await pkg('sourceList');
 for(const [index,item]of packages.entries()){
  client.assertUnchanged();assert.deepEqual(fs.readFileSync(item.source),item.bytes);fs.writeFileSync(path.join(out,'component.zip'),item.bytes);
  const operationId=randomUUID(),record={index,assetId:item.request.assetId,archiveSha256:item.archiveSha256,position:item.request.position??null,operationId};report.installations.push(record);save();
  record.installed=await pkg('importSource',{operationId,...(item.request.position?{position:item.request.position}:{})});assert.equal(record.installed.applied,false);assert.equal(record.installed.archiveSha256,item.archiveSha256);assert.equal(record.installed.instanceIds.length,1);save();
  record.finished=await until(()=>pkg('sourceJob',{jobId:record.installed.job.id}),r=>['passed','failed','cancelled','interrupted','blocked'].includes(r.status),'component check');assert.equal(record.finished.status,'passed');
  const candidates=await panel('godot.candidateList',{offset:0,limit:32}),matches=candidates.items.filter(c=>c.checkJobId===record.installed.job.id);assert.equal(matches.length,1,'Candidate must belong to this real check');const candidate=matches[0];
  record.checked=await panel('godot.candidateRead',{candidateId:candidate.candidateId});assert.equal(record.checked.checkStatus,'passed');assert.equal(record.checked.candidate.worldId,worldId);assert.equal(record.checked.candidate.sourceRevision,record.installed.source.revision);assert.equal(record.checked.candidate.manifestHash,record.installed.source.manifestHash);assert.ok(record.checked.check.assertions.length>0&&record.checked.check.assertions.every(a=>a.passed===true));
  record.preview=await panel('godot.candidatePreview',{candidateId:candidate.candidateId});assert.equal(record.preview.status,'preview');record.applied=await panel('godot.candidateApply',{candidateId:candidate.candidateId});assert.equal(record.applied.status,'applied');
  await until(()=>rpc('godotObserve'),r=>r.worldId===worldId&&r.buildId===candidate.buildId,'applied component');save();
 }
 const ids=report.installations.flatMap(r=>r.installed.instanceIds);assert.equal(new Set(ids).size,ids.length,'Each installation owns a distinct instance');
 report.arrangedSource=await pkg('sourceList');const oldIds=new Set(report.initialSource.items.map(i=>i.entityId)),newIds=report.arrangedSource.items.map(i=>i.entityId).filter(id=>!oldIds.has(id));assert.equal(new Set(newIds).size,packages.length,'Independent identities exist in real project source');
 await panel('godot.runtimeResume');report.overview=await overview();report.after=await rpc('godotObserve');report.afterCapture=await capture('after.png');report.saved=await panel('godot.runtimeSave',{freeze:true});await stop();save();
 start();await entry();report.reopened=await until(()=>rpc('godotObserve'),r=>r.worldId===worldId&&r.instanceId,'cold reopen');assert.equal(report.reopened.buildId,report.after.buildId);assert.notEqual(report.reopened.instanceId,report.after.instanceId);
 report.reopenedSource=await pkg('sourceList');assert.deepEqual(report.reopenedSource.items.map(i=>i.entityId).sort(),report.arrangedSource.items.map(i=>i.entityId).sort());await panel('godot.runtimeResume');report.reopenedCapture=await capture('reopened.png');await stop();
 report.ok=true;report.stateIntegrityVerified=true;report.modelFreeBasis='new empty profile; model/eval environment stripped; only listed creation/install/check/adoption/gameplay calls; clean audits';
}catch(error){report.error=String(error.stack??error);process.exitCode=1;console.error(error.message);}
finally{if(!ended)try{await stop();}catch(error){report.shutdownError=String(error);report.ok=false;process.exitCode=1;}report.endedAt=new Date().toISOString();save();console.log('Report: '+path.join(out,'report.json'));}
