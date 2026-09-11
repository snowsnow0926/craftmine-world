// One current wish through the actual product; no generated scene or hidden answer.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';import {setTimeout as delay} from 'node:timers/promises';
import {createPromoWishPlan} from './helpers/promo-wish-plan.mjs';
import {loadLocalConfig} from '../app/local-config.mjs';
import {resolveCreationNativeLaunch} from './helpers/creation-native-launch.mjs';
import {createCompleteOutput} from './godot-final/complete-contract.mjs';
import {promoPilotProgress} from './helpers/promo-pilot-progress.mjs';
const group=process.env.CRAFTMINE_PROMO_GROUP??'pet';
const plan=createPromoWishPlan({suite:'independent',selected:[group],seed:20260912}),wish=plan.stories[0].steps.find(step=>step.kind==='wish');
if(!process.argv.includes('--live')){console.log(JSON.stringify({mode:'prepare-only',wish:{id:wish.id,text:wish.text},modelRequests:0,maxRequests:10,maxMinutes:10}));process.exit(0);}
const root=process.cwd(),configPath=process.env.CRAFTMINE_LIVE_CONFIG;
assert.ok(configPath&&path.isAbsolute(configPath),'An explicit local model configuration is required');
const config={};loadLocalConfig(configPath,config);const secret=config.CRAFTMINE_DEEPSEEK_API_KEY??config.DEEPSEEK_API_KEY??config.CRAFTMINE_EVAL_KEY;
assert.ok(secret&&(!config.CRAFTMINE_MODEL_PROVIDER||config.CRAFTMINE_MODEL_PROVIDER==='deepseek'),'Configured DeepSeek provider required');
const model=process.env.CRAFTMINE_EVAL_MODEL??'deepseek-flash',out=createCompleteOutput(root),profile=path.join(out,'profile'),legacySource=path.join(out,'legacy'),token=randomUUID();
fs.mkdirSync(profile);fs.mkdirSync(legacySource);fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource}));
const client=resolveCreationNativeLaunch({root,requiredGuards:['EVALUATION_WISH_BUSY_OR_FIXED_SUITE','CRAFTMINE_EVAL_REQUEST_LIMIT']});
const sanitize=value=>typeof value==='string'?value.split(secret).join('[REDACTED]'):Array.isArray(value)?value.map(sanitize):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,/secret|apiKey|authorization/i.test(k)?'[REDACTED]':sanitize(v)])):value;
const report={format:'craftmine.promo-pilot/1',startedAt:new Date().toISOString(),group,wish:{id:wish.id,text:wish.text},planSha256:plan.planSha256,model,maxRequests:10,packageIdentity:client.identity,status:'PREPARING',functional:'UNVERIFIED',visual:'UNVERIFIED',continuity:'UNVERIFIED',snapshots:[]};
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(sanitize(report),null,2));save();
const environment={...client.environment({out,profile,token}),CRAFTMINE_CREATION_EVAL:'1',CRAFTMINE_EVAL_MODEL:model,CRAFTMINE_EVAL_THINKING:'high',CRAFTMINE_EVAL_KEY:secret,CRAFTMINE_EVAL_REQUEST_LIMIT:'10'};
const child=spawn(client.executable,client.args,{cwd:client.cwd,env:environment,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
let ended=false,ready=false,exitReport=null;const pending=new Map();
for(const stream of ['stdout','stderr'])child[stream].on('data',data=>fs.appendFileSync(path.join(out,stream+'.log'),sanitize(data.toString())));
const exited=new Promise(resolve=>child.on('exit',(code,signal)=>{ended=true;resolve({code,signal});}));
child.on('message',message=>{if(message.type==='craftmine-headless-ready')ready=true;if(message.type==='craftmine-headless-exit')exitReport=message;const item=pending.get(message.id);if(item){pending.delete(message.id);clearTimeout(item.timer);message.error?item.reject(Error(message.error)):item.resolve(message.result);}});
const rpc=(type,method,fields={},timeout=60000)=>new Promise((resolve,reject)=>{const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('TIMEOUT '+method));},timeout);pending.set(id,{resolve,reject,timer});child.send({type,id,method,...fields});});
const native=(method,fields)=>rpc('craftmine-headless',method,fields),evaluation=(method,fields)=>rpc('craftmine-creation-evaluation',method,fields),nav=(channel,payload={})=>native('worldNavigation',{channel,payload});
async function until(read,accept,label,ms=120000){const deadline=Date.now()+ms;while(Date.now()<deadline){if(ended)throw Error('CLIENT_EXITED '+label);try{const result=await read();if(accept(result))return result;}catch(error){if(!/not ready|UNAVAILABLE|WORLD_BUSY/.test(error.message))throw error;}await delay(500);}throw Error('TIMEOUT '+label);}
try{
  await until(async()=>ready,Boolean,'controller');await until(()=>native('primaryMode'),s=>s.entry,'entry');await native('primaryMode',{payload:{action:'create'}});
  await until(()=>nav('world.createOptions'),r=>r.bases?.some(b=>b.id==='creation-sandbox'),'base catalog');
  const created=await nav('world.create',{baseId:'creation-sandbox',starterId:'blank',title:'宣传愿望独立摸底 '+group,operationId:randomUUID()});report.worldId=created.id;save();
  await until(()=>nav('world.list'),r=>r.worlds?.some(w=>w.id===created.id&&w.state==='ready'),'blank world',900000);
  await until(()=>native('godotObserve'),r=>r.worldId===created.id&&r.instanceId,'actual engine');
  report.session=await evaluation('initialize');await evaluation('resume-play');await evaluation('aim-ground');
  report.before=await evaluation('snapshot');
  report.submission=await evaluation('wish',{wish:report.wish});report.status='SUBMITTED';save();
  const deadline=Date.now()+600000;let lastStatus='';
  while(Date.now()<deadline){
    if(ended)throw Error('CLIENT_EXITED');const state=await evaluation('snapshot');
    report.latest=state;report.budget=state.budget;report.metrics=state.metrics;
    const stage={active:state.active,job:state.job?.status,stage:state.job?.stage,reserved:state.budget?.reserved};
    report.snapshots.push({at:new Date().toISOString(),...stage});save();
    if(JSON.stringify(stage)!==lastStatus){console.log(JSON.stringify(stage));lastStatus=JSON.stringify(stage);}
    const progress=promoPilotProgress(state);
    if(progress.settled){report.status=progress.reason;break;}
    await delay(2000);
  }
  if(report.status==='SUBMITTED'){report.status='TIME_STOP';await evaluation('abort');}
  report.journal=await evaluation('wish-state');report.isolation=await native('status');
  assert.equal(report.isolation.violations.length,0);assert.equal(report.isolation.pageErrors.length,0);
  assert.ok(report.isolation.windows.every(w=>!w.visible&&!w.focused&&!w.focusable&&w.offscreen));
}catch(error){report.status='RUN_FAILED';report.error=String(error.stack??error);process.exitCode=1;console.error(error.message);}
finally{
  if(!ended){try{await evaluation('abort');}catch{}try{await native('quit');}catch{}await Promise.race([exited,delay(15000)]);if(!ended){report.forcedStop=true;child.kill();}}
  for(const item of pending.values())clearTimeout(item.timer);report.exitReport=exitReport;report.endedAt=new Date().toISOString();save();console.log('Report: '+out);
}
