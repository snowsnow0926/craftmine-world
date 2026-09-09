// Trusted main-process live sampler (task S6).
//
// The real TypeScript module is bundled with esbuild and exercised directly.
// It must return the host's own instance identity, never redirect the request
// and never accept an envelope that does not match the running instance.
// No Electron process, no engine, no browser, no input simulation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const dependencies=createRequire(path.join(root,'vendor/pi-desktop/packages/agent-runtime/package.json'));
const {build}=dependencies('esbuild');
const out=await mkdtemp(path.join(process.env.PI_SCRATCH_DIR||tmpdir(),'godot-round3-S6-live-sample-'));
await build({entryPoints:[path.join(root,'vendor/pi-desktop/apps/desktop/electron/main/craftmine-live-sample.ts')],
  outfile:path.join(out,'live-sample.cjs'),bundle:true,platform:'node',format:'cjs',target:'node22'});
const {createCraftmineLiveSampler}=createRequire(import.meta.url)(path.join(out,'live-sample.cjs'));

const INSTANCE={worldId:'alpha',buildId:'gbd-7',instanceId:'inst-1',url:'http://127.0.0.1:1/'};
function envelope(patch={}){
  return {format:'craftmine.godot-observation/1',worldId:'alpha',buildId:'gbd-7',instanceId:'inst-1',
    baseId:'first-person',baseVersion:'craftmine.base/3',sampledAt:'2026-09-10T10:00:00Z',protocol:1,
    payload:{base:'first-person',levelTitle:'Ruins',equipment:{active:'pistol'},
      display:{cameraGlobal:{x:1,y:2,z:3}},targets:[{id:'dummy-1'}],interactables:[],quests:[{id:'q-1'}]},...patch};
}
function host({instance=INSTANCE,request=async()=>envelope()}={}){
  const ops=[];
  return {host:()=>({instance,request:async(op,args)=>{ops.push({op,args});return request();}}),ops};
}

test('a running instance produces an envelope bound to the host identity',async()=>{
  const f=host();
  const sample=await createCraftmineLiveSampler(f.host,()=>Date.parse('2026-09-10T10:00:01Z'))({worldId:'alpha',buildId:'gbd-7'});
  assert.deepEqual(f.ops,[{op:'observe-envelope',args:{}}]);
  assert.equal(sample.worldId,'alpha');
  assert.equal(sample.buildId,'gbd-7');
  assert.equal(sample.instanceId,'inst-1');
  assert.equal(sample.baseId,'first-person');
  assert.equal(sample.sampledAt,'2026-09-10T10:00:00Z');
  assert.equal(sample.hostSampledAt,'2026-09-10T10:00:01.000Z');
  assert.equal(sample.payload.equipment.active,'pistol');
});

test('no running instance is unknown, never an empty sample',async()=>{
  const f=host({instance:null});
  assert.equal(await createCraftmineLiveSampler(f.host)({worldId:'alpha'}),null);
  assert.deepEqual(f.ops,[],'a stopped instance must not be queried');
});

test('the caller may narrow the request but never redirect it',async()=>{
  const f=host();
  const sample=createCraftmineLiveSampler(f.host);
  await assert.rejects(sample({worldId:'beta'}),/LIVE_WORLD_MISMATCH/);
  await assert.rejects(sample({buildId:'gbd-9'}),/LIVE_BUILD_MISMATCH/);
  await assert.rejects(sample({instanceId:'inst-2'}),/LIVE_INSTANCE_MISMATCH/);
  assert.deepEqual(f.ops,[],'a refused request must not reach the runtime');
});

test('an envelope from another instance is rejected with its issues',async()=>{
  const f=host({request:async()=>envelope({instanceId:'inst-9'})});
  await assert.rejects(createCraftmineLiveSampler(f.host)({}),/LIVE_OBSERVATION_INVALID: .*identity-mismatch@instanceId/);
  const g=host({request:async()=>envelope({format:'craftmine.other/1'})});
  await assert.rejects(createCraftmineLiveSampler(g.host)({}),/LIVE_OBSERVATION_INVALID/);
});

test('a runtime that cannot answer propagates the real reason',async()=>{
  const f=host({request:async()=>{throw new Error('WORLD_BUSY');}});
  await assert.rejects(createCraftmineLiveSampler(f.host)({}),/WORLD_BUSY/);
  const empty=host({request:async()=>null});
  assert.equal(await createCraftmineLiveSampler(empty.host)({}),null);
});
