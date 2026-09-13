#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {CodexWorldHost} from './lib/codex-world-host.mjs';
import {startCodexLiveService} from './lib/codex-live-service.mjs';
import {readState,acquireLock} from './lib/codex-world-session.mjs';
import {redact} from './lib/codex-app-server.mjs';

export async function checkCurrentSource(host,state,{signal}={}) {
  const context={projectId:state.projectId,sessionId:state.sessionId,turnId:randomUUID()};
  const call=(name,args={})=>host.tools.find(t=>t.name===name).execute(args,{...context,toolCallId:randomUUID(),executionId:'codex-live-operator'});
  let status='error';
  let ending;
  const abort=()=>{status='aborted';ending??=host.end(context,'aborted');void ending.catch(()=>{});};
  signal?.addEventListener('abort',abort,{once:true});
  try {
    if(signal?.aborted){abort();throw Error('OPERATOR_CANCELLED');}
    await host.begin(context,'Operator requested the ordinary native check of the current source.');
    const source=await call('godot_project_index');
    const job=await call('godot_build_start',{revision:source.revision,manifestHash:source.manifestHash,mode:'check'});
    for(;;) {
      if(signal?.aborted){status='aborted';throw Error('OPERATOR_CANCELLED');}
      const result=await call('godot_build_read',{jobId:job.jobId});
      if(signal?.aborted)throw Error('OPERATOR_CANCELLED');
      if(['passed','failed','cancelled','blocked','interrupted'].includes(result.status)) {
        if(result.status!=='passed'||!result.candidateId)throw Error('NATIVE_CHECK_NOT_PASSED:'+result.status);
        status='completed';return result;
      }
    }
  }finally{signal?.removeEventListener('abort',abort);if(ending)await ending;else await host.end(context,status);}
}

export async function liveMain(argv=process.argv.slice(2)) {
  const [action,...args]=argv;
  const help='Usage: node scripts/codex-live-world.mjs initialize|check|preview|apply|retry-first-load|capture|save|reopen|status --data DIR [--candidate ID]';
  if(action==='--help'){console.log(help);return;}
  if(!['initialize','check','preview','apply','retry-first-load','capture','save','reopen','status'].includes(action))throw Error(help);
  const options={};
  for(let i=0;i<args.length;i+=2){if(!['--data','--candidate'].includes(args[i])||!args[i+1]||options[args[i]])throw Error(help);options[args[i]]=args[i+1];}
  if(!options['--data']||(['preview','apply','retry-first-load'].includes(action)!==Boolean(options['--candidate'])))throw Error(help);
  const data=path.resolve(options['--data']),state=readState(data),unlock=acquireLock(data);
  let host,live,report,retirement;
  const controller=new AbortController();const abort=()=>{controller.abort();void live?.call('cancelFirstLoad').catch(()=>{});};
  process.on('SIGINT',abort);process.on('SIGTERM',abort);
  try {
    host=new CodexWorldHost({data,state});
    live=await startCodexLiveService({data,state,core:host.core});
    host=new CodexWorldHost({data,state,core:host.core,services:live});
    await host.start({engines:['initialize','check'].includes(action)});
    if(JSON.stringify(await host.sourceIdentity())!==JSON.stringify(state.sourceIdentity))throw Error('CODEX_SOURCE_IDENTITY_CHANGED');
    let result;
    const initialization=action==='initialize'?await host.core.call('godotWorld.initStatus',{worldId:state.worldId}):null;
    if(initialization?.playable===true) {
      result={initialization:'already-applied',runtime:await live.call('open'),capture:await live.capture()};
    } else if(action==='initialize'||action==='check') {
      const checked=await checkCurrentSource(host,state,{signal:controller.signal});
      if(controller.signal.aborted)throw Error('OPERATOR_CANCELLED');
      result={check:checked};
      if(action==='initialize'){result.application=await live.call('apply',{candidateId:checked.candidateId});result.capture=await live.capture();}
    } else if(action==='status')result=await live.call('status');
    else {
      await live.call('open');
      if(controller.signal.aborted)throw Error('OPERATOR_CANCELLED');
      if(action==='apply'||action==='preview') {
        result=await live.call(action,{candidateId:options['--candidate']});
        result={...result,capture:await live.capture(action==='preview'?{candidateId:options['--candidate']}:{})};
      } else if(action==='retry-first-load')result=await live.call('retryFirstLoad',{candidateId:options['--candidate']});
      else if(action==='capture')result=await live.capture();
      else if(action==='save'){await live.call('pause');result=await live.call('save');if(result.status!=='persisted')throw Error(result.error);}
      else result=await live.call('status');
    }
    report=redact({format:'craftmine.codex-live-operation/1',action,worldId:state.worldId,sourceIdentity:state.sourceIdentity,result,
      gameplayAssessment:'not-performed-by-live-host',operatorInterrupted:controller.signal.aborted,helperDirectory:live.directory});
    await fs.writeFile(path.join(live.directory,'operation.json'),JSON.stringify(report,null,2));
  } finally {
    process.off('SIGINT',abort);process.off('SIGTERM',abort);
    try{await host?.stop({beforeCoreStop:async()=>{retirement=await live?.stop();}});}
    catch(error){await live?.abandon();await host?.core.stop();throw error;}
    finally{unlock();}
  }
  report.retirement={status:'closed',saveStatus:retirement?.saved?.status??'not-needed',receipt:retirement?.saved?.receipt??null};
  await fs.writeFile(path.join(report.helperDirectory,'operation.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))liveMain().catch(error=>{console.error(JSON.stringify({status:'error',code:redact(error.message)}));process.exitCode=1;});
