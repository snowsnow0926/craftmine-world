import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const deps = createRequire(path.join(root, 'vendor/pi-desktop/packages/agent-runtime/package.json'));
const parent = path.join(root, 'test-results/codex-promo/source-only-tools');
await fs.mkdir(parent, {recursive: true});
const output = await fs.mkdtemp(path.join(parent, 'run-'));
await deps('esbuild').build({entryPoints: [path.join(root, 'plugins/craftmine-world/world-tools.cjs')],
  outfile: path.join(output, 'tools.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22',
  alias: {'@babel/parser': deps.resolve('@babel/parser')}, plugins: [{name: 'domain-source', setup(builder) {
    builder.onResolve({filter: /^\.\/domain\.cjs$/}, () => ({path: path.join(root, 'plugins/craftmine-world/domain-adapter.mjs')}));
  }}]});
const {createWorldTools} = require(path.join(output, 'tools.cjs'));
const record = {jobId: 'gjob-' + 'a'.repeat(64), worldId: 'world', status: 'passed', kind: 'check',
  candidateId: 'gcan-' + 'b'.repeat(64), buildId: 'gbd-' + 'c'.repeat(64), sourceRevision: 1, manifestHash: 'd'.repeat(64)};
function fixture({runtimeError, switched = false, applied = false} = {}) {
  let selected = 'world';
  const core = {start: async () => ({}), call: async method => {
    if (method === 'workspace.open') return {worldId: 'world', task: {binding: {taskId: 'task'}}};
    if (method === 'godotBuild.read') return structuredClone(record);
    if (method === 'godotRuntime.describe') {
      if (switched) selected = 'other';
      if (runtimeError) throw Object.assign(Error(runtimeError), {errorCode: runtimeError});
      return applied ? {...record, format: 'craftmine.godot-runtime-descriptor/1', phase: 'formal'} : null;
    }
    throw Error('Unexpected RPC: ' + method);
  }};
  const tools = createWorldTools(core, async () => ({activeWorldId: selected}));
  return () => tools.find(t => t.name === 'godot_build_read').execute({jobId: record.jobId},
    {projectId: 'project', sessionId: 'session', turnId: 'turn', toolCallId: 'call', executionId: 'execution'});
}
test('first source-only check stays readable without claiming application', async () => {
  const result = await fixture({runtimeError: 'GODOT_WORLD_NOT_INITIALIZED'})();
  assert.equal(result.status, 'passed'); assert.equal(result.candidateId, record.candidateId);
  assert.notEqual(result.creationApplication?.status, 'applied');
});
test('runtime integrity failures still fail the read', async () => {
  await assert.rejects(fixture({runtimeError: 'GODOT_ARTIFACT_HASH_MISMATCH'})(), /GODOT_ARTIFACT_HASH_MISMATCH/);
});
test('a changed selected world cannot return an old source-only candidate', async () => {
  await assert.rejects(fixture({runtimeError: 'GODOT_WORLD_NOT_INITIALIZED', switched: true})(), /GODOT_BUILD_READ_WORLD_CHANGED/);
});
test('the exact confirmed formal build still reconciles as applied', async () => {
  const result = await fixture({applied: true})(); assert.equal(result.creationApplication.status, 'applied');
});
