// Real runtime host, no Electron, no Godot engine, no input.
// Covers the startup-abort seam the candidate host depends on.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWorldRuntime, RUNTIME_PROTOCOL} from '../../../desktop/godot/web/runtime.mjs';

async function runtime(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'godot-runtime-abort-'));
  await writeFile(join(root, 'index.html'), '<!doctype html><title>runtime</title>');
  return createWorldRuntime({worldId: 'alpha', buildId: 'build-alpha', root, timeoutMs: 60000, ...options});
}

test('abortStartup rejects a pending startup with the exact reason and cannot be repeated', async () => {
  const host = await runtime();
  try {
    const waiting = host.waitReady().then(() => ({ready: true}), (error) => ({ready: false, error: error.message}));
    assert.equal(host.abortStartup('World renderer stopped: crashed (1)'), true);
    const settled = await waiting;
    assert.equal(settled.ready, false);
    assert.equal(settled.error, 'World renderer stopped: crashed (1)');
    assert.equal(host.abortStartup('second attempt'), false);
    assert.equal(host.state, 'error');
  } finally { await host.dispose({graceful: false}); }
});

test('abortStartup cannot overwrite a runtime that already reported ready', async () => {
  const host = await runtime();
  try {
    host.receive({protocol: RUNTIME_PROTOCOL, worldId: host.worldId, buildId: host.buildId, instanceId: host.instanceId, type: 'ready', ops: ['snapshot']});
    const ready = await host.waitReady();
    assert.deepEqual(ready.ops, ['snapshot']);
    assert.equal(host.abortStartup('late renderer crash'), false);
    assert.equal(host.state, 'ready');
  } finally { await host.dispose({graceful: false}); }
});

test('abortStartup bounds an oversized reason and uses a default for an empty one', async () => {
  const first = await runtime();
  try {
    const waiting = first.waitReady().then(() => null, (error) => error.message);
    assert.equal(first.abortStartup('x'.repeat(2000)), true);
    assert.equal((await waiting).length, 500);
  } finally { await first.dispose({graceful: false}); }
  const second = await runtime();
  try {
    const waiting = second.waitReady().then(() => null, (error) => error.message);
    assert.equal(second.abortStartup(''), true);
    assert.equal(await waiting, 'Godot runtime failed to start');
  } finally { await second.dispose({graceful: false}); }
});
