// Host bridge for live observation (task S6).
//
// The real PluginRuntime is imported through the desktop TypeScript hook, so
// this proves the new plugin API is gated, forwards only the narrowed identity
// and returns exactly what the trusted sampler produced. No Electron window, no
// engine, no browser, no input simulation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

const desktop=path.resolve('vendor/pi-desktop/apps/desktop');
register(pathToFileURL(path.join(desktop,'test/helpers/ts-import-hooks.mjs')));
const {PluginRuntime}=await import(pathToFileURL(path.join(desktop,'electron/main/plugin-runtime.ts')));

const craftmine={manifest:{id:'craftmine.world'},permissions:new Set()};
const thirdParty={manifest:{id:'third.party'},permissions:new Set()};

test('a third-party plugin cannot reach the live sampler',async()=>{
  const runtime=new PluginRuntime({craftmineLiveSample:async()=>({stub:true})});
  await assert.rejects(runtime.dispatchHostCall(thirdParty,'craftmine.godotLiveState',[{}]),/Live Godot observation unavailable/);
});

test('an unwired host reports the gap instead of an empty sample',async()=>{
  const runtime=new PluginRuntime({});
  await assert.rejects(runtime.dispatchHostCall(craftmine,'craftmine.godotLiveState',[{}]),/Live Godot observation unavailable/);
});

test('the sampler receives the narrowed identity and its envelope is returned unchanged',async()=>{
  const seen=[];
  const envelope={format:'craftmine.godot-observation/1',worldId:'alpha',buildId:'gbd-7',instanceId:'inst-1',
    baseId:'first-person',baseVersion:'craftmine.base/3',sampledAt:'2026-09-10T10:00:00Z',payload:{}};
  const runtime=new PluginRuntime({craftmineLiveSample:async input=>{seen.push(input);return envelope;}});
  const result=await runtime.dispatchHostCall(craftmine,'craftmine.godotLiveState',
    [{worldId:'alpha',buildId:null,instanceId:'inst-1',extra:'ignored'}]);
  assert.deepEqual(seen,[{worldId:'alpha',buildId:null,instanceId:'inst-1'}]);
  assert.equal(result,envelope);
});

test('a stopped instance returns null, which the tool reports as not running',async()=>{
  const runtime=new PluginRuntime({craftmineLiveSample:async()=>null});
  assert.equal(await runtime.dispatchHostCall(craftmine,'craftmine.godotLiveState',[{}]),null);
});
