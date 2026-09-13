// Ordinary player confirmation/check/preview/adoption on a model-authored draft.
// No authored source or player position is edited by this operator.
import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {randomUUID} from 'node:crypto';
import {CodexWorldHost} from './lib/codex-world-host.mjs';import {startCodexLiveService} from './lib/codex-live-service.mjs';import {readState,acquireLock} from './lib/codex-world-session.mjs';import {checkCurrentSource} from './codex-live-world.mjs';
export async function settle(data){
 if(!path.isAbsolute(data))throw Error('ABSOLUTE_DATA_REQUIRED');const state=readState(data),unlock=acquireLock(data),id=randomUUID(),file=path.join(data,'benchmark-operator-'+id+'.json');
 const report={format:'craftmine.courtyard-benchmark-operator/1',worldId:state.worldId,startedAt:new Date().toISOString(),modelCalls:0,sourceAuthoredByOperator:false,actions:[],status:'running'};
 let host,live;const controller=new AbortController(),abort=()=>controller.abort();process.on('SIGINT',abort);process.on('SIGTERM',abort);
 const save=()=>fs.writeFile(file,JSON.stringify(report,null,2));
 const action=async(name,run)=>{if(controller.signal.aborted)throw Error('OPERATOR_CANCELLED');const entry={name,startedAt:new Date().toISOString()};report.actions.push(entry);await save();try{entry.result=await run();entry.status='completed';return entry.result;}catch(error){entry.status='failed';entry.error=error.errorCode??error.code??error.message;throw error;}finally{entry.endedAt=new Date().toISOString();entry.elapsedMs=Date.parse(entry.endedAt)-Date.parse(entry.startedAt);await save();}};
 try{
  await save();host=new CodexWorldHost({state,data});live=await startCodexLiveService({state,data,core:host.core});host=new CodexWorldHost({state,data,core:host.core,services:live});await host.start();report.helperDirectory=live.directory;
  const proposals=await action('read-frozen-proposals',()=>host.sourceLibrary.proposals({worldId:state.worldId}));
  for(const proposal of proposals.items.filter(item=>item.requiresPlayerAction)){
   report.actions.push({name:'confirm-model-proposal',at:new Date().toISOString(),proposal});await save();
   const installed=await action('install-proposed-source',()=>host.sourceLibrary.installProposal({worldId:state.worldId,proposalId:proposal.proposalId}));
   await action('wait-installed-source-check',async()=>{for(;;){if(controller.signal.aborted)throw Error('OPERATOR_CANCELLED');const job=await host.core.call('godotBuild.read',{worldId:state.worldId,jobId:installed.job.jobId},15000);if(['passed','failed','cancelled','interrupted','blocked'].includes(job.status)){if(job.status!=='passed')throw Object.assign(Error('NATIVE_CHECK_NOT_PASSED:'+job.status),{details:job});return job;}await new Promise(resolve=>setTimeout(resolve,500));}});
  }
  const {context}=await host.core.call('godotProject.sourceContext',{worldId:state.worldId}),index=await host.core.call('godotProject.index',{worldId:state.worldId,context,offset:0,limit:1});
  const candidates=await host.core.call('godotCandidate.list',{worldId:state.worldId,offset:0,limit:32});
  let candidate=candidates.items.find(item=>item.status==='ready'&&item.sourceRevision===index.revision&&item.manifestHash===index.manifestHash);
  if(!candidate){const checked=await action('check-current-source',()=>checkCurrentSource(host,state,{signal:controller.signal}));candidate=await host.core.call('godotCandidate.read',{worldId:state.worldId,candidateId:checked.candidateId});}
  report.candidate=candidate;
  await action('preview-candidate',()=>live.call('preview',{candidateId:candidate.candidateId}));
  await action('capture-preview',()=>live.capture({candidateId:candidate.candidateId}));
  const applied=await action('adopt-candidate',()=>live.call('apply',{candidateId:candidate.candidateId}));if(applied.status!=='applied')throw Error('FORMAL_ADOPTION_NOT_CONFIRMED');report.firstFormalPlayableAt=new Date().toISOString();
  await action('pause-formal-world',()=>live.call('pause'));await action('save-formal-world',async()=>{const result=await live.call('save');if(result.status!=='persisted')throw Error('FORMAL_SAVE_NOT_PERSISTED');return result;});
  await action('capture-formal-world',()=>live.capture());report.formal=await action('read-formal-state',()=>live.call('status'));report.snapshot=await live.call('snapshot');report.status='completed';
 }catch(error){report.status=controller.signal.aborted?'cancelled':'failed';report.error=error.errorCode??error.code??error.message;if(error.details)report.failureDetails=error.details;process.exitCode=1;}
 finally{
  process.off('SIGINT',abort);process.off('SIGTERM',abort);
  try{await host?.stop({beforeCoreStop:async()=>{report.retirement=await live?.stop();}});}catch(error){report.retirementError=error.message;report.status='failed';process.exitCode=1;await live?.abandon();await host?.core.stop();}finally{unlock();report.endedAt=new Date().toISOString();report.elapsedMs=Date.parse(report.endedAt)-Date.parse(report.startedAt);await save();}
 }
 console.log(JSON.stringify({status:report.status,worldId:state.worldId,elapsedMs:report.elapsedMs,report:file,error:report.error}));return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){if(process.argv.length!==3)throw Error('Usage: courtyard-benchmark-operator.mjs ABS_DATA');await settle(process.argv[2]);}
