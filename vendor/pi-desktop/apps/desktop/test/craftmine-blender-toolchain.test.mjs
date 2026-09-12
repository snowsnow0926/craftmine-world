import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import path from 'node:path';

register(new URL('./helpers/ts-import-hooks.mjs', import.meta.url));
const {PluginRuntime} = await import('../electron/main/plugin-runtime.ts');
const root = path.resolve('test-results/blender-private-toolchain');
const paths = {
  broker: path.join(root, 'broker/blender-host-broker.exe'),
  brokerIdentity: path.join(root, 'broker/broker-identity.json'),
  runtimeRoot: root,
  toolchainLock: path.join(root, 'toolchain.lock.json'),
};
const world = {manifest: {id: 'craftmine.world'}, path: root};

test('Blender configuration is a private, argument-free host capability', async () => {
  const runtime = new PluginRuntime({craftmineBlenderToolchain: {...paths, secret: 'not-returned'}});
  const first = await runtime.dispatchHostCall(world, 'craftmine.getBlenderToolchain', []);
  assert.deepEqual(first, paths);
  first.broker = 'changed-by-caller';
  assert.deepEqual(await runtime.dispatchHostCall(world, 'craftmine.getBlenderToolchain', []), paths);
  await assert.rejects(runtime.dispatchHostCall({manifest: {id: 'another.plugin'}}, 'craftmine.getBlenderToolchain', []), /Private toolchain/);
  await assert.rejects(runtime.dispatchHostCall(world, 'craftmine.getBlenderToolchain', [{runtimeRoot: root}]), /Private toolchain/);
});

test('missing and invalid host configuration cannot select an executable', async () => {
  const runtime = new PluginRuntime({});
  assert.equal(await runtime.dispatchHostCall(world, 'craftmine.getBlenderToolchain', []), null);
  for (const key of Object.keys(paths)) {
    runtime.setServices({craftmineBlenderToolchain: {...paths, [key]: 'relative/path'}});
    await assert.rejects(runtime.dispatchHostCall(world, 'craftmine.getBlenderToolchain', []), /host-owned absolute paths/);
  }
});

test('renderer and generic world request routes do not expose Blender configuration', async () => {
  const runtime = new PluginRuntime({craftmineBlenderToolchain: paths});
  const sent = [];
  const loaded = {...world, pending: new Map(), nextCallId: 1, child: {postMessage(message) {
    sent.push(message);
    queueMicrotask(() => runtime.handleChildMessage(loaded, {t: 'res', id: message.id, ok: true, value: {unhandled: true}}));
  }}};
  runtime.loaded.set('craftmine.world', loaded);
  assert.deepEqual(await runtime.invokePanelBridge('craftmine.world', 'craftmine.getBlenderToolchain', {}), {unhandled: true});
  assert.equal(sent[0].method, 'panel.invoke');
  await assert.rejects(runtime.requestCraftmineHost('craftmine.getBlenderToolchain', {}), /Unsupported/);
});
