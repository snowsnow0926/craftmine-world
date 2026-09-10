import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
const require = createRequire(path.resolve('vendor/pi-desktop/apps/desktop/package.json'));
const {build} = require('esbuild');
const out = path.resolve('test-results/issue-context'); await fs.mkdir(out, {recursive:true});
await build({entryPoints:['vendor/pi-desktop/apps/desktop/electron/main/craftmine-issue-context.ts'],outfile:path.join(out,'context.mjs'),bundle:true,platform:'node',format:'esm'});
const {createCraftmineIssueContext} = await import(pathToFileURL(path.join(out,'context.mjs')));
function fixture() {
  const f = {world:'alpha',instance:{worldId:'alpha',buildId:'build-a',instanceId:'run-a'},state:'paused',blocked:false,
    descriptor:{phase:'formal',worldId:'alpha',buildId:'build-a',baseId:'first-person',artifactManifestHash:'a'.repeat(64),
      snapshot:{baseId:'first-person',baseVersion:'0.1.0',body:{private:'never copy'}},root:'C:/private'},during:()=>{}};
  f.capture = createCraftmineIssueContext({selection:async()=>f.world,instance:()=>f.instance,state:()=>({...f.instance,state:f.state}),blocked:()=>f.blocked,
    describe:async()=>{f.during();return f.descriptor;}}); return f;
}
test('formal context projects trusted immutable build identity without progress or paths',async()=>{
  const f=fixture(), context=await f.capture();
  assert.deepEqual(context,{phase:'formal',status:'ready',worldId:'alpha',buildId:'build-a',instanceId:'run-a',baseId:'first-person',baseVersion:'0.1.0',runtimeTarget:'godot-web',artifactManifestHash:'a'.repeat(64)});
  assert.equal(JSON.stringify(context).includes('private'),false);
  for(const state of ['ready','paused','saved']){f.state=state;assert.ok(await f.capture());}
});
test('loading, candidates and mismatching metadata cannot masquerade as formal observations',async()=>{
  for(const state of ['loading','failed','closed','saving']){const f=fixture();f.state=state;await assert.rejects(f.capture(),/ISSUE_CONTEXT_NOT_READY/);}
  const f=fixture();f.blocked=true;await assert.rejects(f.capture(),/ISSUE_CONTEXT_NOT_READY/);
  f.blocked=false;f.descriptor.phase='candidate';await assert.rejects(f.capture(),/ISSUE_CONTEXT_UNAVAILABLE/);
  f.descriptor.phase='formal';f.descriptor.snapshot.baseId='another';await assert.rejects(f.capture(),/ISSUE_CONTEXT_UNAVAILABLE/);
});
test('world, instance, readiness or candidate changes during await reject the old identity',async()=>{
  for(const mutate of [f=>{f.world='beta';},f=>{f.instance={...f.instance,instanceId:'run-new'};},f=>{f.blocked=true;},f=>{f.state='loading';}]){
    const f=fixture();f.during=()=>mutate(f);await assert.rejects(f.capture(),/ISSUE_WORLD_CHANGED|ISSUE_CONTEXT_NOT_READY/);
  }
  const f=fixture();f.instance=null;assert.equal(await f.capture(),null);
});
