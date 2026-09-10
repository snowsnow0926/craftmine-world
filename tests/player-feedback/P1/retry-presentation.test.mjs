import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
register(new URL('../../../vendor/pi-desktop/apps/desktop/test/helpers/ts-import-hooks.mjs', import.meta.url));
const {createGodotWorldFactory} = await import('../../../vendor/pi-desktop/apps/desktop/electron/main/godot-world-creation.ts');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; };
const failed = () => ({worldId: 'retry-world', initId: 'init-one', status: 'failed', playable: false,
  reason: 'GODOT_JOB_FAILED'});
const setup = (initialization, read = () => failed()) => createGodotWorldFactory({
  worldsRoot: 'D:/not-accessed', catalogFile: 'D:/not-accessed', basesRoot: 'D:/not-accessed',
  domain: async method => { assert.equal(method, 'godotWorld.initStatus'); return structuredClone(read()); },
  materialize: () => assert.fail('retry must preserve the managed source'), initialization,
});

test('an acknowledged retry displays preparation until Core publishes a new attempt', async () => {
  const gate = deferred(); let current = failed(); const original = structuredClone(current);
  const factory = setup({start: () => gate.promise, running: () => false, error: () => null}, () => current);
  const pending = factory.retry('retry-world');
  const preparing = await factory.status('retry-world');
  assert.equal(preparing.state, 'initializing');
  assert.equal(preparing.creation.stage, 'retry');
  assert.equal(preparing.creation.progress, 0);
  assert.equal(preparing.creation.error, null);
  assert.deepEqual(preparing.creation.actions, ['details']);
  assert.deepEqual(current, original, 'presentation cannot rewrite the durable previous failure');
  assert.equal((await factory.status('other-world')).state, 'failed');
  current = {...current, status: 'building', reason: null};
  const building = await factory.status('retry-world');
  assert.equal(building.creation.stage, 'build');
  assert.equal(building.creation.progress, 75, 'the new Core state supersedes preparation');
  current = {...current, status: 'confirmed', playable: true};
  assert.equal((await factory.status('retry-world')).state, 'ready');
  gate.resolve(); await pending;
});

test('overlapping retry requests wait for one existing attempt and schedule only one recovery', async () => {
  const existing = deferred(), recovery = deferred(); const calls = [];
  const factory = setup({running: () => true, error: () => null, start: (id, options) => {
    calls.push({id, recover: options?.recover === true});
    return options?.recover ? recovery.promise : existing.promise;
  }});
  const a = factory.retry('retry-world'), b = factory.retry('retry-world');
  assert.equal((await factory.status('retry-world')).state, 'initializing');
  assert.equal(calls.length, 1);
  existing.resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [{id: 'retry-world', recover: false}, {id: 'retry-world', recover: true}]);
  recovery.resolve(); await Promise.all([a, b]);
  const terminal = await factory.status('retry-world');
  assert.equal(terminal.state, 'failed', 'finishing the scheduler is not proof of a successful build');
  assert.equal(terminal.creation.error.code, 'GODOT_JOB_FAILED');
  assert.ok(terminal.creation.actions.includes('retry'));
});

test('preparation rejection is actionable and an absent initializer cannot acknowledge a retry', async () => {
  const gate = deferred();
  const current = {...failed(), reason: 'GODOT_INITIAL_LOAD_FAILED', failureStage: 'confirm'};
  const factory = setup({running: () => false, error: () => null, start: () => gate.promise}, () => current);
  const pending = factory.retry('retry-world');
  gate.reject(new Error('GODOT_INITIAL_SOURCE_MISSING')); await pending;
  const terminal = await factory.status('retry-world');
  assert.equal(terminal.state, 'failed');
  assert.match(terminal.creation.error.message, /缺少源码文件/);
  assert.ok(terminal.creation.actions.includes('retry'));
  assert.throws(() => setup(undefined).retry('retry-world'), /GODOT_BASES_UNAVAILABLE/);
  assert.throws(() => factory.retry('../foreign'), /INVALID_WORLD_ID/);
});

test('restart does not turn a previous scheduling acknowledgement into durable retry authority', async () => {
  const gate = deferred(); const original = failed();
  const first = setup({running: () => false, error: () => null, start: () => gate.promise}, () => original);
  const pending = first.retry('retry-world');
  assert.equal((await first.status('retry-world')).creation.stage, 'retry');
  const restarted = setup({running: () => false, error: () => null,
    start: () => assert.fail('a terminal durable failure needs explicit retry')}, () => original);
  assert.equal((await restarted.status('retry-world')).state, 'failed');
  gate.resolve(); await pending;
});
