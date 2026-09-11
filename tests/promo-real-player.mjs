// One explicit ordinary player message in an existing isolated world/session.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';import {setTimeout as delay} from 'node:timers/promises';
import {loadLocalConfig} from '../app/local-config.mjs';
import {resolveCreationNativeLaunch,creationPackagedRoot} from './helpers/creation-native-launch.mjs';
import {adoptionEnvironment} from './helpers/promo-adoption-contract.mjs';
import {fileProof,assertProofs,readCheckpointJson} from './helpers/promo-checkpoint-contract.mjs';
import {checkpointSanitizer} from './helpers/promo-checkpoint-live-contract.mjs';
import {readHeadlessProfile} from '../vendor/pi-desktop/apps/desktop/electron/main/craftmine-headless-profile.ts';
import {createFileClarificationExchange} from './helpers/promo-file-clarification.mjs';

const [sourceFile,configFile,textFile]=process.argv.slice(2);
assert.ok([sourceFile,configFile,textFile].every(value=>value&&path.isAbsolute(value)),'Usage: <absolute previous report> <absolute player config snapshot> <absolute player text file> --packaged-root <product> [--live]');
const source=readCheckpointJson(sourceFile),config=readCheckpointJson(configFile),text=fs.readFileSync(textFile,'utf8').trim();
assert.ok(text&&config.format==='craftmine.player-config-snapshot/1'&&config.credentialsIncluded===false,'Player text and non-secret config required');
const out=path.dirname(sourceFile),profile=path.join(out,'profile'),markerFile=path.join(profile,'headless-profile.json'),marker=readCheckpointJson(markerFile);
readHeadlessProfile({CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_ROOT:out,CRAFTMINE_DATA_DIR:profile,CRAFTMINE_HEADLESS_TOKEN:marker.token});
const sessionId=source.sessionId??source.session?.sessionId??source.latest?.record?.session?.id,worldId=source.worldId;
assert.ok(typeof sessionId==='string'&&typeof worldId==='string','Existing world and session required');
const packagedRoot=creationPackagedRoot();assert.ok(packagedRoot,'Explicit frozen package required');
if(!process.argv.includes('--live')){console.log(JSON.stringify({mode:'prepare-only',sourceFile,sessionId,worldId,modelId:config.modelId,thinkingLevel:config.thinkingLevel,contextWindow:config.contextWindow,maxTokens:config.maxTokens,text,packagedRoot,modelRequests:0,creationEvaluation:false}));process.exit(0);}
const secretsFile=process.env.CRAFTMINE_LIVE_CONFIG;assert.ok(secretsFile&&path.isAbsolute(secretsFile),'Explicit local secrets configuration required');
const secrets={};loadLocalConfig(secretsFile,secrets);const secret=secrets.CRAFTMINE_DEEPSEEK_API_KEY??secrets.DEEPSEEK_API_KEY??secrets.CRAFTMINE_EVAL_KEY;
assert.ok(secret&&config.baseUrl==='https://api.deepseek.com'&&config.vendorKey==='deepseek','Only the selected DeepSeek endpoint receives this key');
const client=resolveCreationNativeLaunch({root:process.cwd(),packagedRoot,requiredGuards:['HEADLESS_PLAYER_NORMAL_SESSION_REQUIRED','playerSetup','playerPrompt','headlessAskPending','headlessAskResolve','headlessPermissionPending','headlessPermissionResolve']});
const proofs=[sourceFile,markerFile,configFile,textFile].map(fileProof),sanitize=checkpointSanitizer([secret,marker.token]),runId=randomUUID();
const output=path.join(out,'player-'+runId+'.json'),controller=new AbortController(),signal=controller.signal;
for(const event of ['SIGINT','SIGTERM'])process.on(event,()=>controller.abort());
const exchange=createFileClarificationExchange({directory:path.join(out,'player-questions-'+runId),signal});
const permissionDirectory=path.join(out,'player-permissions-'+runId);fs.mkdirSync(permissionDirectory);
const report={format:'craftmine.promo-player/1',sourceReport:sourceFile,worldId,sessionId,packageIdentity:client.identity,playerConfig:config,text,messageId:randomUUID(),startedAt:new Date().toISOString(),status:'PREPARING',clarifications:[],permissions:[],permissionDirectory,questionDirectory:exchange.directory,creationEvaluation:false,sourceEditsByHarness:0};
fs.writeFileSync(output,JSON.stringify(report,null,2),{flag:'wx'});const save=()=>fs.writeFileSync(output,JSON.stringify(sanitize(report),null,2));
const env=adoptionEnvironment(client,{out,profile,token:marker.token});assert.equal(env.CRAFTMINE_CREATION_EVAL,undefined);
let ready=false,ended=false,exitReport,submitted=false,seenActive=false;const pending=new Map();
const child=spawn(client.executable,client.args,{cwd:client.cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
report.logs={stdoutBytes:0,stderrBytes:0};for(const stream of ['stdout','stderr'])child[stream].on('data',bytes=>{report.logs[stream+'Bytes']+=bytes.length;});
const exited=new Promise(resolve=>{child.on('exit',(code,exitSignal)=>{ended=true;report.exit={code,signal:exitSignal};resolve();});child.on('error',error=>{ended=true;report.launchError=error.code;resolve();});});
child.on('message',message=>{if(message.type==='craftmine-headless-ready')ready=true;if(message.type==='craftmine-headless-exit')exitReport=message;const call=pending.get(message.id);if(call){clearTimeout(call.timer);pending.delete(message.id);message.error?call.reject(Error(message.error)):call.resolve(message.result);}});
function rpc(method,fields={}){if(ended)return Promise.reject(Error('PLAYER_CLIENT_EXITED'));return new Promise((resolve,reject)=>{const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('PLAYER_RPC_TIMEOUT: '+method));},120000);pending.set(id,{resolve,reject,timer});child.send({type:'craftmine-headless',id,method,...fields});});}
const payload={sessionId,worldId};
signal.addEventListener('abort',()=>{if(!ended)void rpc('playerAbort',{payload}).catch(()=>{});},{once:true});
async function until(read,accept){while(!signal.aborted){if(ended)throw Error('PLAYER_CLIENT_EXITED');try{const value=await read();if(accept(value))return value;}catch(error){if(!/not ready|WORLD_BUSY|No world runtime is running|World view is not ready/i.test(error.message))throw error;}await delay(400);}throw Error('PLAYER_CANCELLED');}
try{
  await until(async()=>ready,Boolean);const isolation=await until(()=>rpc('status'),value=>value.windows?.length);
  assert.deepEqual(isolation.violations,[]);assert.ok(isolation.windows.every(w=>!w.visible&&!w.focused&&!w.focusable&&w.offscreen));
  await until(()=>rpc('primaryMode'),value=>value.entry);await rpc('primaryMode',{payload:{action:'create'}});
  await until(()=>rpc('godotObserve'),value=>{assert.equal(value.worldId,worldId,'Existing selected world changed');return value.instanceId;});
  report.setup=await rpc('playerSetup',{payload:{...payload,config,secret}});
  report.before=await rpc('playerStatus',{payload});assert.equal(report.before.active,false);assert.equal(report.before.record.session.id,sessionId);
  await rpc('worldPanel',{channel:'godot.runtimeResume',payload:{worldId}});
  report.submittedAt=new Date().toISOString();report.status='SUBMITTING';save();submitted=true;
  report.submission=await rpc('playerPrompt',{payload:{...payload,text,messageId:report.messageId}});report.status='RUNNING';save();
  while(!signal.aborted){
    const state=await rpc('playerStatus',{payload});report.latest=state;assert.equal(state.sessionId,sessionId);assert.equal(state.observation.worldId,worldId);
    seenActive ||= state.active;save();
    const newTurn=seenActive||state.metrics?.messageId===report.messageId||state.record?.session?.messages?.some(m=>m.id===report.messageId);
    if(newTurn&&!state.active&&!['queued','running','recovering'].includes(state.job?.status)&&state.application?.status!=='applying'&&state.application?.phase!=='applying'){report.status=state.metrics?.status==='error'?'MODEL_ERROR':'SETTLED_UNVERIFIED';break;}
    const permission=await rpc('headlessPermissionPending',{payload:{sessionId}});
    if(permission){
      assert.equal(permission.sessionId,sessionId);assert.ok(typeof permission.requestId==='string');
      const ticketId=randomUUID(),requestFile=path.join(permissionDirectory,ticketId+'.request.json'),responseFile=path.join(permissionDirectory,ticketId+'.response.json');
      fs.writeFileSync(requestFile,JSON.stringify(sanitize({format:'craftmine.player-permission-request/1',permission,responseFile}),null,2),{flag:'wx'});
      report.pendingPermission={requestFile,responseFile};save();console.log('Player permission: '+requestFile);
      while(!fs.existsSync(responseFile)&&!signal.aborted){
        await delay(500);
        const current=await rpc('headlessPermissionPending',{payload:{sessionId}});
        assert.equal(current?.requestId,permission.requestId,'Product permission expired or changed while awaiting review');
      }
      assert.ok(!signal.aborted,'PLAYER_CANCELLED');const response=readCheckpointJson(responseFile);
      assert.equal(Object.keys(response).sort().join(','),'decision,requestId,sessionId');assert.equal(response.sessionId,sessionId);assert.equal(response.requestId,permission.requestId);assert.ok(['allow-once','deny'].includes(response.decision));
      const receipt=await rpc('headlessPermissionResolve',{payload:response});
      assert.equal(receipt.status,'resolved');assert.equal(receipt.sessionId,sessionId);assert.equal(receipt.requestId,permission.requestId);assert.equal(receipt.toolCallId,permission.toolCallId);assert.equal(receipt.decision,response.decision);
      report.permissions.push({permission,decision:response.decision,requestFile,responseFile,receipt});delete report.pendingPermission;save();
    }
    const ask=await rpc('headlessAskPending',{payload:{sessionId}});
    if(ask){
      const ticket=exchange.publish(ask,sessionId);console.log('Player clarification: '+ticket.requestFile);report.pendingQuestion=ticket;save();
      const selected=await exchange.waitForResponse(ticket);
      const receipt=await rpc('headlessAskResolve',{payload:{sessionId,requestId:ask.requestId,choices:selected.choices}});
      assert.equal(receipt.status,'resolved');assert.deepEqual(receipt.answers,selected.answers);report.clarifications.push({...selected,receipt});delete report.pendingQuestion;save();
    }
    await delay(1000);
  }
  if(signal.aborted)report.status='CANCELLED';
}catch(error){report.status=signal.aborted?'CANCELLED':'RUN_FAILED';report.error=String(error.stack??error);process.exitCode=1;}
finally{
  if(!ended){
    if(submitted){try{await rpc('playerAbort',{payload});report.latest=await rpc('playerStatus',{payload});assert.equal(report.latest.active,false);}catch(error){report.closeoutError=String(error.message);}}
    try{const frame=await rpc('godotCaptureView');const imageFile='player-'+runId+'-formal-world.png';fs.writeFileSync(path.join(out,imageFile),Buffer.from(frame.pngBase64,'base64'),{flag:'wx'});report.formalCapture={file:imageFile,width:frame.width,height:frame.height};}catch(error){report.captureError=String(error.message);}
    try{await rpc('quit');}catch{}await Promise.race([exited,delay(15000)]);if(!ended){report.forcedStop=true;child.kill();}
  }
  report.exitReport=exitReport;for(const call of pending.values())clearTimeout(call.timer);
  try{assertProofs(proofs);client.assertUnchanged();assert.ok(!report.forcedStop&&!report.closeoutError);for(const key of ['violations','pageErrors','shutdownFailures'])assert.deepEqual(exitReport?.[key],[]);report.stateIntegrityVerified=true;}catch(error){report.stateIntegrityVerified=false;report.integrityError=String(error.message);process.exitCode=1;}
  report.endedAt=new Date().toISOString();save();console.log('Report: '+output);
}
