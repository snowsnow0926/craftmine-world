// Three consecutive compactions, a model switch and an interrupted turn
// (task S6, acceptance item 4/5).
//
// The real agent-runtime request hook is bundled and driven directly: only the
// provider SDK is stubbed. Each request rebuilds the durable Godot facts from
// the host snapshot, so the model can continue editing after any number of
// compactions without remembering anything, and the per-task ledger keeps its
// accumulated cost. No engine, no browser, no input simulation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const dependencies=createRequire(path.join(root,'vendor/pi-desktop/packages/agent-runtime/package.json'));
const {build}=dependencies('esbuild');
const out=await mkdtemp(path.join(process.env.PI_SCRATCH_DIR||tmpdir(),'godot-round3-S6-context-'));
await writeFile(path.join(out,'pi-ai-stub.js'),
  'exports.createAssistantMessageEventStream=()=>({push(){},end(){},[Symbol.asyncIterator](){return {next:async()=>({done:true})}}});\n','utf8');
await build({entryPoints:[path.join(root,'vendor/pi-desktop/packages/agent-runtime/src/craftmine-context.ts')],
  outfile:path.join(out,'context.cjs'),bundle:true,platform:'node',format:'cjs',target:'node22',
  alias:{'@earendil-works/pi-ai':path.join(out,'pi-ai-stub.js')}});
const {createCraftmineRequestHooks,CRAFTMINE_PROMPT_VERSION}=
  createRequire(import.meta.url)(path.join(out,'context.cjs'));

const HASH='a'.repeat(64);
const PROJECT_HASH='c'.repeat(64);

// The host rebuilds this from the journal on every request; a compaction drops
// conversation history but never changes these durable values.
function snapshot(){
  return {binding:{projectId:'project',sessionId:'session',turnId:'turn',taskId:'task-1',baseBuild:'gbd-0'},
    generation:4,status:'active',
    world:{id:'alpha',revision:9,buildId:'gbd-7',hash:HASH},
    draft:{revision:12,hash:'b'.repeat(64)},
    requirements:[{id:'req-1',kind:'request',text:'给主角换一把带十字准星的武器'}],
    modifiedResources:['script:weapon.gd'],
    receipts:[{worldId:'alpha',revision:11,manifestHash:PROJECT_HASH}],
    jobs:[{id:'verify-1',status:'passed'}],
    lease:{owned:true},
    budget:{requestCount:4,compactionCount:3,chargedTokens:1500},
    godot:{projectRevision:11,projectManifestHash:PROJECT_HASH,baseId:'first-person',
      engineVersion:'4.7.2-stable',buildStatus:'applied',executorGate:{build:true,check:true}},
    // Durable progress is a save, not the player's current equipment.
    durableProgress:{equipment:{active:'sword'}}};
}

function harness(){
  const calls=[];
  const hooks=createCraftmineRequestHooks({
    getContext:async()=>snapshot(),
    domainCall:async(method,params)=>{calls.push({method,params});
      if(method==='budget.reserve')return {requestId:params.requestId,budget:{}};
      return {ok:true};},
    limits:{maxRequests:50,maxTokens:10000,maxCompactions:6},
  });
  const model=id=>({id,api:'openai',provider:'local',contextWindow:200000,maxTokens:8192});
  const request=async(requestId,modelId='model-a')=>hooks.beforeRequest({requestId,purpose:'creation',
    model:model(modelId),context:{systemPrompt:'base',messages:[{role:'user',content:'继续'}]},maxOutputTokens:2048});
  const textOf=reservation=>{
    const last=reservation.context.messages.at(-1);
    const blocks=typeof last.content==='string'?[{text:last.content}]:last.content;
    return blocks.map(block=>block.text||'').join('\n');
  };
  return {hooks,calls,request,textOf};
}

test('three consecutive compactions keep re-deriving the same durable Godot facts',async()=>{
  const h=harness();
  const seen=[];
  for(let i=1;i<=3;i+=1){
    const reservation=await h.request(`request-${i}`);
    await h.hooks.onBoundary({kind:'compaction',eventId:`compaction-${i}`});
    await h.hooks.afterRequest({reservation,status:'known',
      usage:{inputTokens:100,outputTokens:50,totalTokens:150}});
    seen.push(h.textOf(reservation));
  }
  for(const [index,text] of seen.entries()){
    assert.match(text,/Craftmine host snapshot/);
    assert.match(text,/godot: /);
    assert.match(text,/appliedBuild=gbd-7/);
    assert.match(text,/projectRevision=11/);
    assert.match(text,new RegExp(`projectHash=${PROJECT_HASH.slice(0,8)}`));
    assert.match(text,/executorBuild=true executorCheck=true/);
    // The original player request survives every compaction.
    assert.match(text,/给主角换一把带十字准星的武器/);
    // Live equipment is never presented as a durable fact.
    assert.ok(!/pistol|sword/.test(text),`compaction ${index+1} must not carry equipment`);
    assert.match(text,new RegExp(CRAFTMINE_PROMPT_VERSION));
  }
  const boundaries=h.calls.filter(call=>call.method==='budget.boundary');
  assert.equal(boundaries.length,3);
  assert.deepEqual(boundaries.map(call=>call.params.kind),['compaction','compaction','compaction']);
  assert.equal(h.calls.filter(call=>call.method==='budget.reserve').length,3);
  assert.equal(h.calls.filter(call=>call.method==='budget.settle').length,3);
});

test('a model switch rebuilds the same facts without any conversation memory',async()=>{
  const h=harness();
  const first=await h.request('request-1','model-a');
  await h.hooks.afterRequest({reservation:first,status:'known',usage:{inputTokens:10,outputTokens:5,totalTokens:15}});
  const switched=await h.request('request-2','model-b');
  await h.hooks.afterRequest({reservation:switched,status:'known',usage:{inputTokens:10,outputTokens:5,totalTokens:15}});
  for(const text of [h.textOf(first),h.textOf(switched)]){
    assert.match(text,/appliedBuild=gbd-7/);
    assert.match(text,/projectHash=/);
    assert.match(text,/worldRevision=9/);
    assert.match(text,/draftRevision=12/);
  }
  assert.equal(h.calls.filter(call=>call.method==='budget.reserve').length,2);
});

test('an interrupted request settles as unknown and never resets the ledger',async()=>{
  const h=harness();
  const reservation=await h.request('request-1');
  await h.hooks.afterRequest({reservation,status:'unknown',errorCode:'REQUEST_INTERRUPTED'});
  const settle=h.calls.find(call=>call.method==='budget.settle');
  assert.equal(settle.params.status,'unknown');
  assert.equal(settle.params.requestId,'request-1');
  assert.equal(settle.params.binding.taskId,'task-1');
  // The next request still reserves against the same task row.
  const next=await h.request('request-2');
  assert.equal(next.binding.taskId,'task-1');
});

test('a snapshot with no Godot identity adds no fact block and stays bounded',async()=>{
  const calls=[];
  const hooks=createCraftmineRequestHooks({
    getContext:async()=>({...snapshot(),godot:null,receipts:[],world:{id:'alpha',revision:1,buildId:'gbd-0',hash:HASH}}),
    domainCall:async(method,params)=>{calls.push({method,params});return {ok:true};},
  });
  const reservation=await hooks.beforeRequest({requestId:'request-1',purpose:'creation',
    model:{id:'model-a',api:'openai',provider:'local',contextWindow:200000,maxTokens:8192},
    context:{systemPrompt:'base',messages:[{role:'user',content:'继续'}]},maxOutputTokens:1024});
  const last=reservation.context.messages.at(-1);
  const text=(typeof last.content==='string'?last.content:last.content.map(block=>block.text||'').join('\n'));
  assert.ok(!/godot: /.test(text),'a legacy world must not produce a Godot fact block');
  assert.ok(Buffer.byteLength(text,'utf8')<48000);
  assert.equal(calls.filter(call=>call.method==='budget.reserve').length,1);
});
