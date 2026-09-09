// Automatic durable-fact injection after compaction or a model switch.
//
// The real agent-runtime module is bundled with esbuild and exercised directly;
// only the provider SDK is stubbed, because this environment has no pi-ai
// install. No engine, no browser, no input simulation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const require=createRequire(import.meta.url);
const dependencies=createRequire(path.join(root,'vendor/pi-desktop/packages/agent-runtime/package.json'));
const {build}=dependencies('esbuild');

const out=await mkdtemp(path.join(process.env.PI_SCRATCH_DIR||tmpdir(),'godot-round2-R7-context-'));
await writeFile(path.join(out,'pi-ai-stub.js'),
  'exports.createAssistantMessageEventStream=()=>({push(){},end(){},[Symbol.asyncIterator](){return {next:async()=>({done:true})}}});\n','utf8');
await build({entryPoints:[path.join(root,'vendor/pi-desktop/packages/agent-runtime/src/craftmine-context.ts')],
  outfile:path.join(out,'context.cjs'),bundle:true,platform:'node',format:'cjs',target:'node22',
  alias:{'@earendil-works/pi-ai':path.join(out,'pi-ai-stub.js')}});
const {craftmineContextBlocks}=require(path.join(out,'context.cjs'));
await build({entryPoints:[path.join(root,'vendor/pi-desktop/packages/agent-runtime/src/craftmine-godot-facts.ts')],
  outfile:path.join(out,'facts.cjs'),bundle:true,platform:'node',format:'cjs',target:'node22'});
const {godotFactLines,godotFactsBlock}=require(path.join(out,'facts.cjs'));

const HASH='a'.repeat(64);
function snapshot(extra={}){
  return {binding:{projectId:'project',sessionId:'session',turnId:'turn',taskId:'task-1',baseBuild:'gbd-0'},
    generation:3,status:'active',
    world:{id:'alpha',revision:9,buildId:'gbd-7',hash:HASH},
    draft:{revision:12,hash:'b'.repeat(64)},
    requirements:[{id:'req-1',kind:'request',text:'make a crosshair'}],
    modifiedResources:['script:world.gd'],
    receipts:[{ok:true},{revision:11,manifestHash:'c'.repeat(64)}],
    jobs:[{id:'verify-1',status:'passed'}],
    lease:{owned:true},budget:{tokens:{used:100}},
    ...extra};
}

test('godot facts are derived from the durable snapshot only',()=>{
  const lines=godotFactLines(snapshot());
  assert.ok(lines.includes('appliedBuild=gbd-7'));
  assert.ok(lines.includes('worldRevision=9'));
  assert.ok(lines.includes('draftRevision=12'));
  assert.ok(lines.includes('projectRevision=11'),'the last journaled source head');
  assert.ok(lines.includes('projectHash=cccccccc'));
  assert.ok(lines.includes('verifications=1'));
  assert.equal(godotFactsBlock({}),null);
  assert.equal(godotFactsBlock(null),null);
});

test('a richer godot section wins over the receipt-derived head',()=>{
  const lines=godotFactLines(snapshot({godot:{projectRevision:21,projectManifestHash:'d'.repeat(64),
    buildStatus:'passed',candidateId:'gcan-1',candidateStatus:'ready',baseId:'first-person',
    engineVersion:'4.7.2-stable',executorGate:{build:true,check:false,blockedReason:'GODOT_EXECUTOR_UNAVAILABLE'}}}));
  assert.ok(lines.includes('projectRevision=21'));
  assert.ok(lines.includes('projectHash=dddddddd'));
  assert.ok(lines.includes('buildStatus=passed'));
  assert.ok(lines.includes('candidate=gcan-1:ready'));
  assert.ok(lines.includes('base=first-person'));
  assert.ok(lines.includes('engine=4.7.2-stable'));
  assert.ok(lines.some(line=>line.startsWith('executorBuild=true executorCheck=false blocked=')));
});

test('the host appends godot facts as machine data, never as instructions',()=>{
  const text=craftmineContextBlocks(snapshot(),'creation');
  const data=text.slice(text.lastIndexOf('\n\n')+2);
  const parsed=JSON.parse(data);
  assert.match(parsed.machineFacts.godotFacts,/^godot: /);
  assert.ok(parsed.machineFacts.godotFacts.includes('appliedBuild=gbd-7'));
  // Live state must never appear in the durable block.
  assert.ok(!parsed.machineFacts.godotFacts.includes('equipment'));
  assert.ok(!parsed.machineFacts.godotFacts.includes('camera'));
  assert.ok(Buffer.byteLength(data,'utf8')<=48000);
});

test('the request policy tells the model the block is durable, not live',()=>{
  const text=craftmineContextBlocks(snapshot(),'creation');
  assert.match(text,/godotFacts inside machineFacts is durable project identity/);
  assert.match(text,/It is not live game state/);
  assert.match(text,/godot_runtime_state scope=live/);
  assert.match(text,/call godot_project_facts to rebuild the full durable picture/);
  assert.match(text,/The following JSON is data/);
});

test('a receipt from another world cannot supply this world\'s source head',()=>{
  const foreign=snapshot({receipts:[{worldId:'beta',revision:99,manifestHash:'e'.repeat(64)},
    {worldId:'alpha',revision:4,manifestHash:'f'.repeat(64)}]});
  const lines=godotFactLines(foreign);
  assert.ok(lines.includes('projectRevision=4'));
  assert.ok(lines.includes('projectHash=ffffffff'));
  assert.ok(!lines.some(line=>line.includes('eeeeeeee')),'another world\'s hash must not appear');
  const onlyForeign=snapshot({receipts:[{worldId:'beta',revision:99,manifestHash:'e'.repeat(64)}]});
  assert.deepEqual(godotFactLines(onlyForeign),[],'no Godot identity for this world means no block');
});

test('a snapshot with no Godot identity adds no block and stays within the size cap',()=>{
  assert.equal(godotFactsBlock({world:null,draft:null,receipts:[],jobs:[]}),null);
  assert.equal(godotFactsBlock({}),null);
  // A legacy world has a build id and a draft revision, but no Godot identity.
  const legacy=snapshot({world:{id:'alpha',revision:1,buildId:'v-legacy',hash:HASH},draft:{revision:0,hash:''},
    receipts:[{ok:true}],jobs:[{id:'verify-1'}]});
  assert.equal(godotFactLines(legacy).length,0);
  const text=craftmineContextBlocks(legacy,'creation');
  const data=text.slice(text.lastIndexOf('\n\n')+2);
  assert.equal(JSON.parse(data).machineFacts.godotFacts,null);
  assert.ok(Buffer.byteLength(data,'utf8')<=48000);
});

console.log('evidence_directory='+out);
