// Native ordinary controller motion, collision evidence, durable save and cold
// reopen. No player teleport, source edits, OS input or visible window.
import fs from 'node:fs/promises';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {readState,acquireLock} from './lib/codex-world-session.mjs';import {CodexWorldHost} from './lib/codex-world-host.mjs';import {startCodexLiveService} from './lib/codex-live-service.mjs';
const [data,planFile]=process.argv.slice(2);if(![data,planFile].every(value=>value&&path.isAbsolute(value)))throw Error('Usage: courtyard-benchmark-walk.mjs ABS_DATA ABS_PLAN');
const plan=JSON.parse(await fs.readFile(planFile,'utf8'));if(plan.format!=='craftmine.courtyard-waypoints/1'||!Array.isArray(plan.waypoints)||!plan.waypoints.length||plan.waypoints.some(p=>typeof p.name!=='string'||![p.x,p.z].every(n=>Number.isFinite(n)&&Math.abs(n)<=31)))throw Error('COURTYARD_WAYPOINTS_INVALID');
const state=readState(data),unlock=acquireLock(data),file=path.join(data,'benchmark-walk-'+randomUUID()+'.json'),report={format:'craftmine.courtyard-walk/1',worldId:state.worldId,startedAt:new Date().toISOString(),sourceAuthoredByOperator:false,modelCalls:0,teleports:0,osInputEvents:0,plan,waypoints:[],status:'running'};
let host,live;const controller=new AbortController(),abort=()=>controller.abort();process.on('SIGINT',abort);process.on('SIGTERM',abort);
const save=()=>fs.writeFile(file,JSON.stringify(report,null,2));
const body=snapshot=>snapshot?.state?.body??snapshot?.snapshot?.state?.body;
const sourcePins=value=>({headOid:value.headOid,appliedOid:value.appliedOid,repoId:value.repoId});
async function open(){host=new CodexWorldHost({state,data});live=await startCodexLiveService({state,data,core:host.core});host=new CodexWorldHost({state,data,core:host.core,services:live});await host.start({engines:false});const opened=await live.call('open');if(!opened.instance)throw Error('FORMAL_WORLD_REQUIRED');return opened;}
async function close(){await host.stop({beforeCoreStop:()=>live.stop()});host=null;live=null;}
try{
 await save();const opened=await open();report.helperDirectory=live.directory;report.initial=await live.call('snapshot');report.sourceBefore=sourcePins(await host.core.call('content.status',{worldId:state.worldId}));await live.call('resume');
 const identity=Object.fromEntries(['worldId','buildId','instanceId'].map(key=>[key,opened.instance[key]]));report.ordinaryKey=await live.gameplay(identity,{keys:['KeyW'],frames:12,settleFrames:5,capture:false});
 const keyBefore=body(report.ordinaryKey.before.snapshot)?.player?.position,keyAfter=body(report.ordinaryKey.after.snapshot)?.player?.position;
 if(report.ordinaryKey.status!=='completed'||!keyBefore||!keyAfter||Math.hypot(keyAfter[0]-keyBefore[0],keyAfter[2]-keyBefore[2])<0.03)throw Error('ORDINARY_W_KEY_NOT_OBSERVED');
 for(const target of plan.waypoints){
  const entry={...target,steps:[],status:'walking'};report.waypoints.push(entry);let stuck=0;
  for(;;){
   if(controller.signal.aborted)throw Error('OPERATOR_CANCELLED');const snapshot=await live.call('snapshot'),player=body(snapshot)?.player;if(!player?.position)throw Error('PLAYER_SNAPSHOT_REQUIRED');const [x,,z]=player.position,dx=target.x-x,dz=target.z-z,distance=Math.hypot(dx,dz);if(distance<=0.3){entry.status='reached';entry.end=player;break;}
   const yaw=player.yaw,forward=(-dx*Math.sin(yaw)-dz*Math.cos(yaw))/distance,right=(dx*Math.cos(yaw)-dz*Math.sin(yaw))/distance,frames=Math.max(3,Math.min(120,Math.floor(distance/4.5*60*.85)));
   await live.call('walk',{forward,right,frames});const after=body(await live.call('snapshot')).player,remaining=Math.hypot(target.x-after.position[0],target.z-after.position[2]);entry.steps.push({before:player,forward,right,frames,after,remaining});
   stuck=distance-remaining<0.025?stuck+1:0;await save();if(stuck>=3){entry.status='blocked';entry.end=after;throw Error('COURTYARD_ROUTE_BLOCKED:'+target.name);}
  }
  await live.call('pause');entry.capture=await live.capture();await save();await live.call('resume');
 }
 await live.call('pause');report.finalSnapshot=await live.call('snapshot');report.saved=await live.call('save');if(report.saved.status!=='persisted')throw Error('SAVE_NOT_PERSISTED');report.sourceAfter=sourcePins(await host.core.call('content.status',{worldId:state.worldId}));if(JSON.stringify(report.sourceAfter)!==JSON.stringify(report.sourceBefore))throw Error('SOURCE_CHANGED_DURING_WALK');report.diagnostics=await live.call('diagnostics');await close();
 report.coldReopenStartedAt=new Date().toISOString();await open();await live.call('pause');report.reopened=await live.call('snapshot');report.reopenedCapture=await live.capture();report.reopenedSource=sourcePins(await host.core.call('content.status',{worldId:state.worldId}));if(JSON.stringify(report.reopenedSource)!==JSON.stringify(report.sourceAfter))throw Error('SOURCE_CHANGED_ON_REOPEN');
 const previous=body(report.finalSnapshot),restored=body(report.reopened);if(!previous||!restored||Math.hypot(...previous.player.position.map((n,i)=>n-restored.player.position[i]))>0.05||Math.abs(previous.player.yaw-restored.player.yaw)>0.001||Math.abs(previous.player.pitch-restored.player.pitch)>0.001)throw Error('PLAYER_PROGRESS_NOT_RESTORED');
 for(const key of ['inventory','rules','doors','openedChests'])if(JSON.stringify(previous[key])!==JSON.stringify(restored[key]))throw Error('WORLD_PROGRESS_CHANGED_ON_REOPEN:'+key);
 report.status='completed';report.coldReopenEndedAt=new Date().toISOString();
}catch(error){report.status=controller.signal.aborted?'cancelled':'failed';report.error=error.errorCode??error.code??error.message;process.exitCode=1;}
finally{process.off('SIGINT',abort);process.off('SIGTERM',abort);try{if(host)await close();}catch(error){report.retirementError=error.message;report.status='failed';process.exitCode=1;await live?.abandon();await host?.core.stop();}unlock();report.endedAt=new Date().toISOString();report.elapsedMs=Date.parse(report.endedAt)-Date.parse(report.startedAt);await save();console.log(JSON.stringify({status:report.status,worldId:state.worldId,report:file,error:report.error,elapsedMs:report.elapsedMs}));}
