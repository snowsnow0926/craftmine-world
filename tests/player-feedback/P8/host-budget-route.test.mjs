import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire, register} from 'node:module';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
register(new URL('../../../vendor/pi-desktop/apps/desktop/test/helpers/ts-import-hooks.mjs', import.meta.url));
const {pluginProcessEnv} = await import('../../../vendor/pi-desktop/apps/desktop/electron/main/plugin-runtime.ts');
const {CraftmineTurnGateway} = await import('../../../vendor/pi-desktop/apps/desktop/electron/main/craftmine-turn-gateway.ts');
const {DesktopAgentRuntime} = await import('../../../vendor/pi-desktop/packages/agent-runtime/dist/index.js');
const root=fileURLToPath(new URL('../../../',import.meta.url)),require=createRequire(import.meta.url);
const {CoreClient}=require(root+'/desktop/build/craftmine.world/core-client.cjs');
const {createHostRequests}=require(root+'/desktop/build/craftmine.world/host-requests.cjs');
const {emptyWorld}=require(root+'/desktop/build/craftmine.world/domain.cjs');
const authorized={CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_P8_NATIVE:'1',CRAFTMINE_P8_AUTHORIZATION_PHASE:'parallel-20260910'};
const model={id:'fixture',api:'openai-completions',provider:'fixture',contextWindow:256000,maxTokens:4000,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}};

for (const [name,budgetEnv] of [['ordinary',{}],['dated acceptance',authorized]]) test(`actual runtime, gateway, private plugin router and Rust admit request 81 for ${name}`,async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'p8-budget-route-'));
  const core=new CoreClient(process.env.CRAFTMINE_CORE_BIN||root+'/desktop/build/rust-target/debug/craftmine-core.exe',directory);
  t.after(()=>core.stop());await core.start();
  await core.call('world.create',{id:'fixture',title:'Budget route',world:emptyWorld('Budget route')});
  const ctx={projectId:'p',sessionId:'s',turnId:'t'};
  const env=pluginProcessEnv('craftmine.world',budgetEnv),previous=process.env.CRAFTMINE_P8_UNLIMITED_REQUESTS;
  let domain;
  try {process.env.CRAFTMINE_P8_UNLIMITED_REQUESTS=env.CRAFTMINE_P8_UNLIMITED_REQUESTS;domain=createHostRequests(core,{getSettings:async()=>({activeWorldId:'fixture'})});}
  finally {if(previous===undefined)delete process.env.CRAFTMINE_P8_UNLIMITED_REQUESTS;else process.env.CRAFTMINE_P8_UNLIMITED_REQUESTS=previous;}
  await domain('turn.begin',{context:ctx,selectedWorld:'fixture',request:{id:'request',text:'Exercise the real private reservation route'}});
  const gateway=new CraftmineTurnGateway(()=>ctx.turnId,()=>new Set(),(method,params,binding)=>{
    const {sessionId,turnId,...input}=params;
    return domain(method==='craftmine.context'?'task.context':method.replace(/^craftmine\./,''),{...input,context:{projectId:binding.projectId,sessionId:binding.sessionId,turnId:binding.turnId}});
  });
  gateway.bind({...ctx,selectedWorld:'fixture'});
  const runtime=new DesktopAgentRuntime({craftmineWorld:true,craftmineBudgetEnv:budgetEnv,history:[],sessionId:'s',turnId:'t',mode:'agent',thinkingLevel:'off',
    commandShell:{id:'bash',label:'Bash',dialect:'posix',available:true,isDefault:true},
    provider:{id:'fixture',name:'Fixture',modelId:'fixture',baseUrl:'http://127.0.0.1:1',apiKey:'',authKind:'none',supportsReasoning:false,supportedThinkingLevels:['off'],modelConfig:{source:'generic',name:'Fixture',baseUrl:'http://127.0.0.1:1',input:['text'],reasoning:false,cost:model.cost,contextWindow:256000,maxTokens:4000}},
    pluginTools:[],host:{call:(method,input)=>gateway.invoke(method,input),onNotification:()=>()=>{}},onEvent:()=>{}});
  t.after(()=>runtime.dispose());
  for(let i=0;i<81;i++){
    const reservation=await runtime.craftmineHooks.beforeRequest({requestId:'r'+i,purpose:'creation',model,context:{systemPrompt:'fixture',messages:[{role:'user',content:'fixture',timestamp:1}],tools:[]},maxOutputTokens:4000});
    await runtime.craftmineHooks.afterRequest({reservation,status:'known',usage:{inputTokens:10,outputTokens:5,totalTokens:15}});
  }
  const current=await domain('task.context',{context:ctx});
  assert.equal(current.budget.requestCount,81);assert.equal(current.budget.limits.maxRequests,null);assert.equal(current.budget.limits.maxTokens,null);
  assert.equal(current.budget.limits.maxCompactions,null);assert.equal(current.budget.limits.deadlineAt,null);
  for(let i=0;i<9;i++) await domain('budget.boundary',{context:ctx,binding:current.binding,generation:current.generation,eventId:'c'+i,kind:'compaction'});
  assert.equal((await domain('task.context',{context:ctx})).budget.compactionCount,9);
  await assert.rejects(domain('budget.reserve',{context:ctx,binding:current.binding,generation:current.generation,requestId:'forged',purpose:'creation',estimatedInputTokens:10,maxOutputTokens:10,limits:{maxRequests:9999,maxTokens:null,maxCompactions:8}}),/CRAFTMINE_HOST_LIMITS_REQUIRED/);
  assert.equal((await domain('task.context',{context:ctx})).budget.requestCount,81);
});
