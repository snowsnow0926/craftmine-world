// Execute the actual legacy game message handler in a VM. The runtime/DOM are
// inert fixtures; no browser, dispatched input event, or pointer lock is used.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const source = (await readFile(new URL('../app/game.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '');

function fixture() {
  const listeners = new Map(), elements = new Map(), replies = [], instances = [];
  let runtimeOptions;
  const parent = { postMessage(message, origin) { replies.push({ message, origin }); } };
  const element = id => {
    if (!elements.has(id)) elements.set(id, { hidden: false, dataset: {}, textContent: '', parentElement: {} });
    return elements.get(id);
  };
  class Runtime {
    constructor() {
      this.active = true;
      this.activity = [];
      this.inputPauses = 0;
      this.software = true;
      this.p = { x: 3, y: 4, z: 5 };
      this.play = { definitions: [], state: { targets: {}, archivedTargets: {} } };
      this.behaviors = { data: { value: { format: 'fixture', archive: [], inventory: {} } }, flush: async () => {} };
      instances.push(this);
    }
    async generateBuild(build) { this.build = build; }
    pauseInput() { this.inputPauses++; }
    setActive(active) { this.active = active; this.activity.push(active); }
    render() {}
  }
  vm.runInNewContext(source, {
    URL, parent,
    location: { href: 'https://fixture.invalid/game.html#current-nonce', hash: '#current-nonce' },
    document: { getElementById: element, querySelector: () => null, body: { dataset: {} } },
    window: { addEventListener(name, handler) { listeners.set(name, handler); } },
    addEventListener() {},
    makeWorldRuntime(options) { runtimeOptions = options; return Runtime; },
    createExtensionTable: async () => ({}), disposeExtensionTable() {},
    installNativeGameAcceptance() {}, observePreview() {}, stepPreview() {},
    ResizeObserver: class { observe() {} disconnect() {} },
    performance: { now: () => 0 }, setTimeout: () => 0, clearTimeout() {},
  }, { filename: 'app/game.js' });
  const receive = listeners.get('message');
  assert.equal(typeof receive, 'function', 'real game handler was registered');
  const deliver = (message, overrides = {}) => receive({
    source: parent, origin: 'https://fixture.invalid',
    data: { channel: 'craftmine-host/1', nonce: 'current-nonce', ...message },
    ...overrides,
  });
  return {
    deliver, replies, instances,
    get engine() { return instances[0]; },
    frozen: () => runtimeOptions.isFrozen(),
    load: options => deliver({ type: 'load', build: { id: 'build-a', hash: 'hash-a', scene: { format: 'craftmine.scene/1' } }, ...options }),
  };
}

test('load honors an existing immersion hold before announcing readiness', async () => {
  const game = fixture();
  await game.load({ immersionPaused: true });
  assert.equal(game.engine.active, false);
  assert.equal(game.frozen(), true);
  assert.ok(game.engine.inputPauses > 0);
  assert.equal(game.replies.at(-1).message.type, 'loaded');
  await game.deliver({ type: 'immersion', paused: false });
  assert.equal(game.engine.active, true);
  assert.equal(game.frozen(), false);
});

test('immersion messages suspend and restore the same existing runtime', async () => {
  const game = fixture();
  await game.load({});
  const engine = game.engine, initialPauses = engine.inputPauses;
  await game.deliver({ type: 'immersion', paused: true });
  assert.equal(engine.active, false);
  assert.equal(game.frozen(), true);
  assert.equal(engine.inputPauses, initialPauses + 1);
  await game.deliver({ type: 'immersion', paused: false });
  assert.equal(engine.active, true);
  assert.equal(game.frozen(), false);
  assert.equal(game.engine, engine);
  assert.equal(game.instances.length, 1);
});

test('save snapshot freeze survives removal of the immersion hold', async () => {
  const game = fixture();
  await game.load({});
  // app/client.js requests saves through the snapshot wire command with freeze.
  await game.deliver({ type: 'snapshot', freeze: true, requestId: 'save-a' });
  assert.equal(game.replies.at(-1).message.requestId, 'save-a');
  assert.equal(game.replies.at(-1).message.type, 'snapshot');
  await game.deliver({ type: 'immersion', paused: true });
  await game.deliver({ type: 'immersion', paused: false });
  assert.equal(game.engine.active, false);
  assert.equal(game.frozen(), true);
  await game.deliver({ type: 'resume' });
  assert.equal(game.engine.active, true);
  assert.equal(game.frozen(), false);
});

test('manual resume cannot release a still-active immersion hold', async () => {
  const game = fixture();
  await game.load({ paused: true, immersionPaused: true });
  await game.deliver({ type: 'resume' });
  assert.equal(game.engine.active, false);
  assert.equal(game.frozen(), true);
  await game.deliver({ type: 'immersion', paused: false });
  assert.equal(game.engine.active, true);
  assert.equal(game.frozen(), false);
});

test('stale or foreign messages cannot release or acquire a hold', async () => {
  const game = fixture();
  await game.load({ immersionPaused: true });
  const activityCount = game.engine.activity.length;
  for (const message of [{ nonce: 'stale-nonce' }, { channel: 'other-channel' }]) {
    await game.deliver({ type: 'immersion', paused: false, ...message });
  }
  await game.deliver({ type: 'immersion', paused: false }, { origin: 'https://other.invalid' });
  await game.deliver({ type: 'immersion', paused: false }, { source: {} });
  assert.equal(game.engine.activity.length, activityCount);
  assert.equal(game.engine.active, false);
  assert.equal(game.frozen(), true);
  await game.deliver({ type: 'immersion', paused: false });
  await game.deliver({ type: 'immersion', paused: true, nonce: 'stale-nonce' });
  assert.equal(game.engine.active, true);
  assert.equal(game.frozen(), false);
});
