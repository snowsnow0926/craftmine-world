#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {readState,acquireLock} from './lib/codex-world-session.mjs';
import {CodexWorldHost} from './lib/codex-world-host.mjs';
import {startCodexLiveService} from './lib/codex-live-service.mjs';
import {redact} from './lib/codex-app-server.mjs';

export function validateGameplayPlan(plan) {
  if(!plan||typeof plan!=='object'||Array.isArray(plan)||Object.keys(plan).sort().join(',')!=='format,segments'||plan.format!=='craftmine.gameplay-plan/1'||!Array.isArray(plan.segments)||!plan.segments.length)throw Error('GAMEPLAY_PLAN_INVALID');
  // Segment validation happens before input in the helper. There is no added
  // whole-plan duration or model budget; each native wait remains finite.
  return plan;
}
export async function gameplayMain(argv=process.argv.slice(2)) {
  const [mode,...args]=argv;
  const help='Usage: node scripts/codex-gameplay.mjs run --data DIR --plan JSON_FILE [--expect-build BUILD_ID] | cancel --data DIR';
  if(mode==='--help'){console.log(help);return;}
  if(!['run','cancel'].includes(mode))throw Error(help);
  const options={};
  for(let i=0;i<args.length;i+=2){if(!(mode==='run'?['--data','--plan','--expect-build']:['--data']).includes(args[i])||!args[i+1]||options[args[i]])throw Error(help);options[args[i]]=args[i+1];}
  if(!options['--data'])throw Error(help);
  const data=path.resolve(options['--data']),activePath=path.join(data,'gameplay-active.json'),cancelPath=path.join(data,'gameplay-cancel.json');
  if(mode==='cancel'){
    let active;try{active=JSON.parse(await fs.readFile(activePath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
    if(!active){console.log(JSON.stringify({status:'idle'}));return;}
    await fs.writeFile(cancelPath,JSON.stringify({operationId:active.operationId}));console.log(JSON.stringify({status:'cancellation-requested',operationId:active.operationId}));return;
  }
  if(!options['--plan'])throw Error(help);
  const bytes=await fs.readFile(path.resolve(options['--plan'])),plan=validateGameplayPlan(JSON.parse(bytes));
  const state=readState(data),unlock=acquireLock(data),operationId=randomUUID();
  let host,live,identity,poll,stopping=false,retirement;
  const report={format:'craftmine.gameplay-report/1',operationId,status:'running',worldId:state.worldId,
    plan:{path:path.resolve(options['--plan']),sha256:createHash('sha256').update(bytes).digest('hex'),value:plan},segments:[],semanticSuccess:null};
  const cancel=()=>{stopping=true;if(live&&identity)void live.cancelGameplay(identity).catch(()=>{});};
  process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
  try {
    host=new CodexWorldHost({state,data});live=await startCodexLiveService({core:host.core,state,data});await host.start({engines:false});
    if(JSON.stringify(await host.sourceIdentity())!==JSON.stringify(state.sourceIdentity))throw Error('CODEX_SOURCE_IDENTITY_CHANGED');
    const opened=await live.call('open');if(!opened.instance)throw Error('GAMEPLAY_FORMAL_WORLD_REQUIRED');
    const {worldId,buildId,instanceId}=opened.instance;identity={worldId,buildId,instanceId};report.identity=identity;
    if(options['--expect-build']&&options['--expect-build']!==buildId)throw Error('GAMEPLAY_EXPECTED_BUILD_MISMATCH');
    await live.call('validateInputPlan',{segments:plan.segments});
    await fs.writeFile(activePath,JSON.stringify({operationId,pid:process.pid,identity}));
    poll=setInterval(()=>{void fs.readFile(cancelPath,'utf8').then(text=>{if(JSON.parse(text).operationId===operationId&&!stopping)cancel();}).catch(()=>{});},250);
    report.helperDirectory=live.directory;
    const pins=value=>({repoId:value.repoId,headOid:value.headOid,appliedOid:value.appliedOid});
    report.source={before:pins(await host.core.call('content.status',{worldId}))};
    await fs.writeFile(path.join(live.directory,'gameplay-plan.json'),bytes);
    for(const segment of plan.segments){
      if(stopping)break;
      const result=await live.gameplay(identity,segment);report.segments.push(result);
      await fs.writeFile(path.join(live.directory,'gameplay-report.json'),JSON.stringify(redact(report),null,2));
      console.log(JSON.stringify({status:result.status,operationId,segment:report.segments.length,identity,release:result.release?.released,evidence:path.join(live.directory,'gameplay-report.json')}));
      if(result.status!=='completed'){stopping=true;break;}
    }
    report.status=report.segments.some(s=>s.status==='policy-blocked')?'policy-blocked':stopping?'cancelled':'completed';
    report.source.after=pins(await host.core.call('content.status',{worldId}));
    report.source.unchanged=JSON.stringify(report.source.before)===JSON.stringify(report.source.after);
    if(!report.source.unchanged)throw Error('GAMEPLAY_SOURCE_CHANGED');
  }catch(error){report.status='error';report.error=redact(error.message);throw error;}
  finally {
    clearInterval(poll);process.off('SIGINT',cancel);process.off('SIGTERM',cancel);
    try{await host?.stop({beforeCoreStop:async()=>{retirement=await live?.stop();}});report.retirement={status:'closed',save:retirement?.saved??null};}
    catch(error){report.retirement={status:'failed',error:redact(error.message)};await live?.abandon();await host?.core.stop();report.status='error';throw error;}
    finally{
      if(live)await fs.writeFile(path.join(live.directory,'gameplay-report.json'),JSON.stringify(redact(report),null,2));
      await fs.unlink(activePath).catch(error=>{if(error.code!=='ENOENT')throw error;});unlock();
    }
  }
  console.log(JSON.stringify({status:report.status,report:path.join(live.directory,'gameplay-report.json'),semanticSuccess:null}));
  if(report.status!=='completed')process.exitCode=report.status==='cancelled'?130:1;
  return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))gameplayMain().catch(error=>{console.error(JSON.stringify({status:'error',code:redact(error.message)}));process.exitCode=1;});
