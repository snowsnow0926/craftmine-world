import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startCodexLiveService} from '../scripts/lib/codex-live-service.mjs';

test('real helper exit preserves pending-operation diagnostics with a stubbed stalled Core', async () => {
  const parent = path.resolve('test-results/codex-promo/live-exit-tests');
  await fs.mkdir(parent, {recursive: true});
  const data = await fs.mkdtemp(path.join(parent, 'fixture-'));
  let sawDomain;
  const started = new Promise(resolve => {sawDomain = resolve;});
  const core = {start: async () => ({}), call: async method => {
    assert.equal(method, 'godotWorld.initStatus');
    sawDomain(); return new Promise(() => {});
  }};
  let live;
  try {
    live = await startCodexLiveService({core, state: {worldId: 'exit-fixture', pluginRoot: path.resolve('plugins/craftmine-world')}, data});
    const pending = live.call('status').then(() => null, error => error);
    await started;
    await live.abandon(); await live.stop();
    assert.match((await pending)?.message ?? '', /LIVE_HOST_EXITED/);
    const evidence = JSON.parse(await fs.readFile(path.join(live.directory, 'unexpected-exit.json'), 'utf8'));
    assert.equal(evidence.worldId, 'exit-fixture');
    assert.ok(evidence.pendingMethods.includes('status'));
    assert.ok((await fs.stat(path.join(live.directory, 'failure.log'))).isFile());
  } finally { await live?.abandon(); await live?.stop(); }
});

test('missing plugin configuration fails before starting a core or helper process', async () => {
  let starts = 0;
  await assert.rejects(startCodexLiveService({core: {start: async () => {starts++;}}, state: {worldId: 'invalid'}, data: path.resolve('test-results/unused-invalid-live')}), /LIVE_PLUGIN_ROOT_REQUIRED/);
  assert.equal(starts, 0);
});
