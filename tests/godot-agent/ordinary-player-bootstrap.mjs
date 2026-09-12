// Create an isolated ordinary world/session for promo-real-player.mjs. This
// process has no provider secret, evaluator setup or model-prompt operation.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {creationPackagedRoot,resolveCreationNativeLaunch} from '../helpers/creation-native-launch.mjs';
import {adoptionEnvironment} from '../helpers/promo-adoption-contract.mjs';

const args=process.argv.slice(2);
assert.ok(args.length===2&&args[0]==='--packaged-root'&&path.isAbsolute(args[1]??''),'Usage: --packaged-root <absolute frozen package>');
const root=path.resolve(import.meta.dirname,'../..'),packagedRoot=creationPackagedRoot(args);
const client=resolveCreationNativeLaunch({root,packagedRoot,requiredGuards:['playerCreateSession','HEADLESS_PLAYER_NORMAL_SESSION_REQUIRED']});
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const out=fs.mkdtempSync(path.join(root,'test-results/desktop-native-ordinary-'));
const profile=path.join(out,'profile'),legacySource=path.join(out,'legacy'),token=randomUUID();
fs.mkdirSync(profile);fs.mkdirSync(legacySource);
fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource}));
const report={format:'craftmine.ordinary-player-bootstrap/1',status:'preparing',out,startedAt:new Date().toISOString(),packageIdentity:client.identity,modelRequestsStarted:0,controllerCalls:[]};
const reportFile=path.join(out,'bootstrap.json'),save=()=>fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');
const env=adoptionEnvironment(client,{out,profile,token});
assert.ok(!Object.keys(env).some(key=>/CREATION_EVAL|EVAL_|LIVE_|API_KEY|SECRET|AUTHORIZATION/i.test(key)));
const pending=new Map();let child,ready=false,ended=false,exitReport,exitPromise,stopped=false;
function rpc(method,fields={}){
 assert.ok(['status','primaryMode','worldNavigationReady','worldNavigation','godotObserve','playerCreateSession','quit'].includes(method));
 if(method==='worldNavigation')assert.ok(['world.createOptions','world.create'].includes(fields.channel));
 if(stopped&&method!=='quit')throw Error('BOOTSTRAP_CANCELLED');
 report.controllerCalls.push(method==='worldNavigation'?method+':'+fields.channel:method);save();
 return new Promise((resolve,reject)=>{const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('BOOTSTRAP_RPC_TIMEOUT:'+method));},120000);
  pending.set(id,{resolve,reject,timer});child.send({type:'craftmine-headless',id,method,...fields},error=>{if(error){pending.delete(id);clearTimeout(timer);reject(error);}});});
}
async function until(read,accept,label){
 const deadline=Date.now()+120000;
 while(Date.now()<deadline){if(ended||stopped)throw Error('BOOTSTRAP_STOPPED:'+label);try{const result=await read();if(accept(result))return result;}catch(error){if(!/not ready|WORLD_BUSY|No world runtime is running/i.test(error.message))throw error;}await delay(400);}
 throw Error('BOOTSTRAP_STARTUP_TIMEOUT:'+label);
}
const stop=()=>{stopped=true;};process.once('SIGINT',stop);process.once('SIGTERM',stop);
const cancelWatch=setInterval(()=>{if(fs.existsSync(path.join(out,'cancel.request')))stop();},500);
try{
 save();console.log('Ordinary bootstrap: '+reportFile);
 child=spawn(client.executable,client.args,{cwd:client.cwd,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env});
 report.logBytes={stdout:0,stderr:0};for(const name of ['stdout','stderr'])child[name].on('data',bytes=>report.logBytes[name]+=bytes.length);
 exitPromise=new Promise(resolve=>{child.once('error',error=>{report.launchError=error.code;ended=true;resolve();});child.once('exit',(code,signal)=>{report.exit={code,signal};ended=true;for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('BOOTSTRAP_CLIENT_EXITED'));}pending.clear();resolve();});});
 child.on('message',message=>{if(message.type==='craftmine-headless-ready')ready=true;if(message.type==='craftmine-headless-exit')exitReport=message;const p=pending.get(message.id);if(p){clearTimeout(p.timer);pending.delete(message.id);message.error?p.reject(Error(message.error)):p.resolve(message.result);}});
 await until(async()=>ready,Boolean,'controller');
 report.initialStatus=await until(()=>rpc('status'),s=>s.windows?.length,'window');
 assert.ok(report.initialStatus.windows.every(w=>!w.visible&&!w.focused&&!w.focusable&&w.offscreen));
 await until(()=>rpc('primaryMode'),s=>s.entry,'entry');await rpc('primaryMode',{payload:{action:'create'}});
 await until(()=>rpc('worldNavigationReady'),s=>s.ready,'navigation');
 await until(()=>rpc('worldNavigation',{channel:'world.createOptions',payload:{}}),s=>s.bases?.some(b=>b.id==='creation-sandbox'&&b.delivered),'base catalog');
 report.worldCreationOperationId=randomUUID();save();
 const created=await rpc('worldNavigation',{channel:'world.create',payload:{baseId:'creation-sandbox',starterId:'blank',title:'普通玩家创作验收',operationId:report.worldCreationOperationId}});
 report.worldId=created.id;save();
 report.observation=await until(()=>rpc('godotObserve'),s=>s.worldId===created.id&&s.baseId==='creation-sandbox','new world runtime');
 report.session=await rpc('playerCreateSession',{payload:{worldId:created.id,title:'普通玩家创作验收'}});
 report.sessionId=report.session.sessionId;report.status='created';save();
}catch(error){report.status=stopped?'cancelled':'failed';report.error=String(error.message);process.exitCode=1;}
finally{
 clearInterval(cancelWatch);
 if(child&&!ended){try{await rpc('quit');}catch{}await Promise.race([exitPromise,delay(15000)]);if(!ended){report.forcedStop=true;child.kill();}}
 report.exitReport=exitReport;for(const p of pending.values())clearTimeout(p.timer);
 try{client.assertUnchanged();assert.ok(!report.forcedStop);for(const field of ['violations','pageErrors','shutdownFailures'])assert.deepEqual(exitReport?.[field],[]);report.stateIntegrityVerified=true;}catch(error){report.stateIntegrityVerified=false;report.integrityError=error.message;process.exitCode=1;}
 report.endedAt=new Date().toISOString();save();console.log('Report: '+reportFile);
}
