#!/usr/bin/env node
// Derive editorial metadata from retained project-author events, never verdicts.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const fields=['totalTokens','inputTokens','cachedInputTokens','cacheWriteInputTokens','outputTokens','reasoningOutputTokens'];
const zero=()=>Object.fromEntries(fields.map(key=>[key,0]));
export function usageDelta(before,after){
  if(!before||!after)return null;
  const result={};
  for(const key of fields){
    if(!Number.isSafeInteger(before[key])||!Number.isSafeInteger(after[key])||before[key]<0||after[key]<before[key])return null;
    result[key]=after[key]-before[key];
  }
  return result;
}
export function ledgerFromEvents(events){
  const threads=new Map(),turns=new Map();
  for(const event of events){
    if(event.format!=='craftmine.codex-event/1')continue;
    let thread=threads.get(event.threadId);
    if(event.type==='session'){
      thread={...thread,model:event.model,effort:event.effort};
      if(event.resumed===false)thread.total=zero();
      threads.set(event.threadId,thread);
    }
    if(event.type==='user'){
      if(turns.has(event.hostTurnId))throw Error('DUPLICATE_AUTHOR_TURN');
      turns.set(event.hostTurnId,{hostTurnId:event.hostTurnId,worldId:event.worldId,threadId:event.threadId,
        prompt:event.text,images:event.images??[],model:thread?.model??null,effort:thread?.effort??null,
        submittedAt:event.at,status:'incomplete',elapsedMs:null,baseline:thread?.total??null,cumulative:null,
        checks:[],finalText:null});
    }
    const turn=turns.get(event.hostTurnId);
    if(event.type==='usage'){
      if(!thread){thread={};threads.set(event.threadId,thread);}
      thread.total=event.tokenUsage?.total??null;
      if(turn){turn.cumulative=thread.total;turn.lastRequest=event.tokenUsage?.last??null;}
    }
    if(!turn)continue;
    if(event.type==='message'&&event.phase==='final_answer')turn.finalText=event.text;
    if(event.type==='tool-result'&&event.name==='godot_build_read'&&event.result?.jobId){
      const r=event.result,record={jobId:r.jobId,status:r.status,buildId:r.buildId,candidateId:r.candidateId??null,sourceRevision:r.sourceRevision,manifestHash:r.manifestHash,error:r.output?.check?.error??null};
      const index=turn.checks.findIndex(x=>x.jobId===r.jobId);
      if(index<0)turn.checks.push(record);else turn.checks[index]=record;
    }
    if(event.type==='turn-end'){turn.status=event.status;turn.elapsedMs=event.elapsedMs;turn.finishedAt=event.at;}
  }
  return {format:'craftmine.promo-author-ledger/1',generatedAt:new Date().toISOString(),
    scope:'Author turn metadata only. Checks are not application, gameplay, visual quality or continuous filming proof.',
    timing:'elapsedMs is the project author turn, including its tools; operator application and filming wait are excluded.',
    tokens:'Per-turn deltas of CLI cumulative counters. Cached input is a subset of input; reasoning output is a subset of output. Do not add subsets again. Unknown or reset baselines remain null.',
    cost:null,turns:[...turns.values()].map(({baseline,cumulative,...turn})=>({...turn,usage:usageDelta(baseline,cumulative),usageCumulative:cumulative,usageBaseline:baseline}))};
}
export async function main(args=process.argv.slice(2)){
  const outputIndex=args.indexOf('--output');
  if(outputIndex<0||!args[outputIndex+1])throw Error('Usage: promo-shot-ledger.mjs --output ABS_JSON ABS_EVENTS_JSONL ...');
  const output=path.resolve(args[outputIndex+1]),files=args.filter((_,i)=>i!==outputIndex&&i!==outputIndex+1);
  if(!files.length)throw Error('AUTHOR_EVENTS_REQUIRED');
  const events=[];
  for(const file of files){
    const text=await fs.readFile(path.resolve(file),'utf8');
    const lines=text.split('\n');
    for(let i=0;i<lines.length;i++){if(!lines[i].trim())continue;try{events.push(JSON.parse(lines[i]));}catch(error){if(i===lines.length-1&&!text.endsWith('\n'))continue;throw error;}}
  }
  events.sort((a,b)=>String(a.at).localeCompare(String(b.at)));
  const result={...ledgerFromEvents(events),sources:files.map(file=>path.resolve(file))};
  await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({output,turns:result.turns.length,incomplete:result.turns.filter(t=>t.status==='incomplete').length}));
  return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
