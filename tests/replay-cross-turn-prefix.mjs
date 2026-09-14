// Offline only: the archived transcript is processed in memory, never printed.
// No original final request body was recorded. This compares the SAME rebuilt
// request under old/new measurement scopes, not the original provider payload.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {DesktopAgentRuntime} from '../vendor/pi-desktop/packages/agent-runtime/dist/runtime.js';
import {CRAFTMINE_SYSTEM_PROMPT,craftmineCoreToolNames,createCraftmineRequestHooks,craftmineMeasurementScope} from '../vendor/pi-desktop/packages/agent-runtime/dist/craftmine-context.js';
import {DeepSeekPromptPrefix} from '../vendor/pi-desktop/packages/agent-runtime/dist/craftmine-prompt-prefix.js';
import {buildProviderModel,createProviderModels} from '../vendor/pi-desktop/packages/agent-runtime/dist/provider-binding.js';
import {usageToPi} from '../vendor/pi-desktop/packages/agent-runtime/dist/agent-messages.js';

const input=path.resolve(process.argv[2]??''),output=path.resolve(process.argv[3]??'test-results/cross-turn-replay.json');
assert(fs.existsSync(path.join(input,'session.json')),'ARCHIVED_SESSION_REQUIRED');
const session=JSON.parse(fs.readFileSync(path.join(input,'session.json'))).session;
const firstTurn='5fcf0acb-ec34-49c4-9eab-a62832c5a2bd',nextTurn='f963fb21-dbd3-417c-972c-f6689269930b';
const finalId='8cb231b1-0836-484d-918b-0752161003bb',finalIndex=session.messages.findIndex(row=>row.id===finalId);
assert(finalIndex>0&&session.messages[finalIndex+1]?.role==='user','ARCHIVED_TURN_BOUNDARY_REQUIRED');
const measured=usageToPi(session.messages[finalIndex].usage);assert.equal(measured.input+measured.cacheRead+measured.cacheWrite,299425);
const profile=path.join(input,'profile'),db=new DatabaseSync(path.join(profile,'plugins/data/craftmine.world/tasks.sqlite'),{readOnly:true});
let tasks;try{tasks=[firstTurn,nextTurn].map(turn=>{
  const rows=db.prepare("SELECT t.binding,r.generation FROM craftmine_tasks t JOIN craftmine_task_runtime r ON r.task_id=t.id WHERE json_extract(t.binding,'$.turnId')=?").all(turn);
  assert.equal(rows.length,1,'EXACT_HISTORICAL_TASK_REQUIRED');return {...rows[0],binding:JSON.parse(rows[0].binding)};
});}finally{db.close();}
const captures=fs.readdirSync(path.join(profile,'creation-context/turns')).filter(name=>name.endsWith('.json')).map(name=>JSON.parse(fs.readFileSync(path.join(profile,'creation-context/turns',name))));
const snapshots=tasks.map(task=>{
  const matches=captures.filter(row=>row.context?.turnId===task.binding.turnId);assert.equal(matches.length,1);
  const capture=matches[0].capture;assert.equal(capture.autoApply,true);assert.equal(capture.authorization,'full-auto');
  // These non-authority fields are explicitly reconstructed placeholders; the
  // historical per-request machineFacts body was not retained in the logs.
  return {binding:task.binding,generation:task.generation,status:'running',lease:{owned:true},
    world:{id:capture.worldId,runtimeKind:'godot',baseId:'creation-sandbox',revision:1,buildId:task.binding.baseBuild,hash:'0'.repeat(64)},
    creationTarget:{format:capture.format,worldId:capture.worldId,authorization:capture.authorization,autoApply:capture.autoApply},
    draft:{revision:1,hash:'0'.repeat(64)},requirements:[],modifiedResources:[],receipts:[],jobs:[],budget:{}};
});
const provider={id:session.providerId,name:'Offline replay',baseUrl:'https://api.deepseek.com',modelId:'deepseek-flash',apiKey:'fake-offline-key',
  supportsReasoning:true,supportedThinkingLevels:['max'],modelConfig:{source:'generic',name:'Flash',baseUrl:'https://api.deepseek.com',input:['text','image'],reasoning:true,
    contextWindow:1000000,maxTokens:384000,supportedThinkingLevels:['max'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}};
const model=buildProviderModel(provider),models=createProviderModels(provider,model);
const runtime=new DesktopAgentRuntime({craftmineWorld:true,sessionId:session.id,turnId:firstTurn,mode:'agent',thinkingLevel:'max',provider,
  commandShell:{id:'bash',label:'Bash',dialect:'posix',available:true,isDefault:true},history:[],
  host:{call:async()=>({}),onNotification:()=>()=>{}},onEvent:()=>{}});
const manifest=JSON.parse(fs.readFileSync(new URL('../plugins/craftmine-world/manifest.json',import.meta.url))),core=craftmineCoreToolNames('godot');
const tools=manifest.contributes.agentTools.filter(t=>core.has('plugin_craftmine_world_'+t.name)).map(t=>({name:'plugin_craftmine_world_'+t.name,description:t.description,parameters:t.schema}));
const nativeHistory=end=>runtime.historyToEntries(session.messages.slice(0,end)).map(entry=>entry.message);
const contexts=[nativeHistory(finalIndex),nativeHistory(finalIndex+2)].map(messages=>({systemPrompt:CRAFTMINE_SYSTEM_PROMPT,tools,messages}));
const prepared=[];let fakeFetches=0;
for(let i=0;i<2;i++){
  const hooks=createCraftmineRequestHooks({getContext:async()=>snapshots[i],domainCall:async()=>{throw Error('OFFLINE_REPLAY_MUST_NOT_RESERVE_OR_WRITE');}});
  const request=await hooks.prepareRequest({requestId:'offline-'+i,purpose:'creation',model,context:contexts[i],maxOutputTokens:384000});
  let body;
  const result=await models.streamSimple(model,request.context,{reasoning:'max',maxTokens:384000,maxRetries:0,fetch:async(_url,init)=>{
    fakeFetches++;body=JSON.parse(init.body);
    return new Response('data: {"id":"offline","object":"chat.completion.chunk","model":"deepseek-flash","choices":[{"index":0,"delta":{"content":"Offline"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  }}).result();assert.equal(result.stopReason,'stop','OFFLINE_ADAPTER_FAILED');prepared.push({request,body});
}
const legacy=snapshot=>({binding:snapshot.binding,generation:snapshot.generation});
const old=new DeepSeekPromptPrefix(),next=new DeepSeekPromptPrefix();
assert(old.remember(model,prepared[0].request.context,384000,legacy(snapshots[0]),prepared[0].body,measured,'offline-fixed-transport'));
assert(next.remember(model,prepared[0].request.context,384000,craftmineMeasurementScope(snapshots[0]),prepared[0].body,measured,'offline-fixed-transport'));
const oldBound=old.estimateWire(model,prepared[1].request.context,384000,legacy(snapshots[1]),prepared[1].body,'offline-fixed-transport');
const newBound=next.estimateWire(model,prepared[1].request.context,384000,craftmineMeasurementScope(snapshots[1]),prepared[1].body,'offline-fixed-transport');
assert.equal(oldBound,undefined);assert(Number.isFinite(newBound));assert(newBound<prepared[1].request.estimate.input);
const report={format:'craftmine.cross-turn-prefix-offline-replay/1',source:input,originalWireAvailable:false,networkRequests:0,fakeAdapterFetches:fakeFetches,
  notes:['Same rebuilt request compared under two scopes; not an original provider request or acceptance claim.','Transcript body and thinking processed only in memory; output contains hashes/counts, never content.','Historical per-request host data was not retained; minimal placeholder metadata is explicitly used in both comparisons.','Uses the current Craftmine system prompt and core manifest schemas; the original complete base prompt/tool catalog was not recorded.','The existing 48000-byte host-data protection is unchanged; no new task limit is introduced.'],
  previousActualPromptTokens:299425,originalTriggerEstimate:557257,historyMessages:contexts.map(context=>context.messages.length),
  replayPayloadSha256:createHash('sha256').update(JSON.stringify(prepared[1].body)).digest('hex'),
  before:{method:'utf8-half-model-content-json-framing/3',input:prepared[1].request.estimate.input},
  after:{method:'measured-whole-prompt-exact-prefix-plus-utf8-half-tail/1',input:newBound},contextWindow:1000000,maxOutputTokens:384000,compactionThreshold:521859,
  changedTaskFields:Object.keys(tasks[0].binding).filter(key=>tasks[0].binding[key]!==tasks[1].binding[key])};
await runtime.dispose();fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
