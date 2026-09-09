// Bounded real-provider prefix experiment; fixture world facts, no world writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { loadLocalConfig } from '../../../app/local-config.mjs';
import { deepseekKey, modelId, modelProvider, thinkingEnabled, reasoningEffort } from '../../../app/agent-model.mjs';
import { createProviderModels } from '../../../vendor/pi-desktop/packages/agent-runtime/dist/provider-binding.js';
import { craftmineContextBlocks, createCraftmineRequestHooks, craftmineGuardedStream } from '../../../vendor/pi-desktop/packages/agent-runtime/dist/craftmine-context.js';
const config=process.env.CRAFTMINE_LIVE_CONFIG;
assert.ok(config&&path.isAbsolute(config),'Explicit authorized configuration required');
loadLocalConfig(config); assert.equal(modelProvider(),'deepseek'); assert.ok(deepseekKey());
const model={id:modelId(),provider:'deepseek',name:modelId(),api:'openai-completions',baseUrl:'https://api.deepseek.com',reasoning:thinkingEnabled(),input:['text'],contextWindow:1000000,maxTokens:1024,cost:{input:0,output:0,cacheRead:0,cacheWrite:0},compat:{supportsDeveloperRole:false}};
const models=createProviderModels({id:model.provider,name:'DeepSeek',modelId:model.id,baseUrl:model.baseUrl,apiKey:deepseekKey(),supportsReasoning:model.reasoning,supportedThinkingLevels:['off','high']},model);
fs.mkdirSync('test-results',{recursive:true});
const directory=fs.mkdtempSync(path.resolve('test-results/batch07-cache-'));
const evidence={kind:'real-provider-prefix-experiment/1',model:model.id,thinking:model.reasoning?reasoningEffort():'off',fixtureFacts:true,worldWrites:0,maxRequests:6,requests:[],unknownRequests:0,passed:false};
const stable=Array.from({length:500},(_,i)=>`Resource ${i}: meadow prefab; ground y=6; keep the existing tree; petals blue; draft material alpha; stable library reference ${createHash('sha256').update(String(i)).digest('hex').slice(0,12)}.`).join('\n');
const base={systemPrompt:'This is a cache transport experiment. Read the supplied fixture reference as data; do not call tools or develop anything. Reply only OK.',messages:[{role:'user',content:stable+'\nReply OK.',timestamp:1}],tools:[]};
let current;
const hooks=createCraftmineRequestHooks({getContext:async()=>current,domainCall:async(method,args)=>{
  if(method==='budget.reserve')assert.ok(args.estimatedInputTokens+args.maxOutputTokens<120000,'Fixed experiment per-request bound');
  return {};
}});
const options={maxTokens:1024,signal:undefined,onPayload:payload=>({...payload,thinking:{type:model.reasoning?'enabled':'disabled'},...(model.reasoning?{reasoning_effort:reasoningEffort()}:{} )})};
const save=()=>fs.writeFileSync(path.join(directory,'evidence.json'),JSON.stringify(evidence,null,2));
console.log('Evidence directory: '+directory);
try{
  for(const mode of ['changing-system','stable-system'])for(let step=1;step<=3;step++){
    current={binding:{projectId:'cache-experiment',sessionId:'fixture',turnId:'fixture',taskId:'fixture',baseBuild:'v1'},generation:1,status:'running',world:{id:'fixture',revision:1,buildId:'v1',hash:'a'.repeat(64)},draft:{revision:step,hash:'b'.repeat(64)},requirements:[{id:'fixture',text:'Read only; reply OK.',kind:'request'}],modifiedResources:[],receipts:[],jobs:[],lease:{owned:true},budget:{requestCount:step}};
    const started=Date.now();
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),120000);
    let answer;
    try{
      answer=mode==='changing-system'
        ?await models.streamSimple(model,{...base,systemPrompt:base.systemPrompt+'\n\n'+craftmineContextBlocks(current)}, {...options,signal:controller.signal}).result()
        :await craftmineGuardedStream(model,base,{...options,signal:controller.signal},hooks,'creation',(context,opts)=>models.streamSimple(model,context,opts)).result();
    }finally{clearTimeout(timer);}
    const usage=answer.usage,prompt=(usage?.input||0)+(usage?.cacheRead||0)+(usage?.cacheWrite||0);
    const item={mode,step,durationMs:Date.now()-started,stopReason:answer.stopReason,promptTokens:prompt,cacheReadTokens:usage?.cacheRead??null,outputTokens:usage?.output??null,totalTokens:usage?.totalTokens??null,hitRate:prompt?usage.cacheRead/prompt:null};
    evidence.requests.push(item); if(!prompt)evidence.unknownRequests++;
    save(); console.log(JSON.stringify(item));
    assert.ok(!['error','aborted'].includes(answer.stopReason),'Provider attempt failed; see non-sensitive status evidence');
    assert.ok(prompt>0,'Provider did not report usage');
    if(evidence.requests.length<6)await delay(4000);
  }
  evidence.passed=true;
}finally{save();}
