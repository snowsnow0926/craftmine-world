// P3: the runtime page must not let the engine quit while Godot's own audio
// worklet preparation is still in flight.
//
// Godot 4.7.2's Web audio driver chains the worklet node construction on the
// promise `AudioWorklet.addModule()` returns, and its teardown nulls the
// AudioContext before that continuation runs. The page bridge therefore has to
// order the quit behind the engine's continuation instead of racing it.
//
// This runs the real `desktop/godot/web/bridge.js` in a sandbox with the engine's
// own call shape, and it pins the ordering that the fix depends on:
//
//   * the pre-fix construction (handing the engine a promise derived from a
//     handler that opens the barrier) orders QUIT before NODE_WITH_NULL_CONTEXT.
//     That is the fixed-order counterexample the barrier must not regress into.
//   * the shipped bridge orders NODE_READY before QUIT even when the quit was
//     already waiting for the module load.
//
// Pure logic: no browser, no engine, no window, no input.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const worktree = path.resolve(here, '..', '..', '..');
// The counterexample run points this at a pre-fix copy of the bridge, so the same
// file proves both that the ordering test fails on the old construction and that
// it passes on the shipped one.
const bridgePath = process.env.CRAFTMINE_P3_BRIDGE ?? path.join(worktree, 'desktop', 'godot', 'web', 'bridge.js');
const bridge = fs.readFileSync(bridgePath, 'utf8');
const runtimeProtocol = 'craftmine.godot-runtime/2';

/** A page whose only audio worklet support is one engine-owned pretend driver. */
function makePage({audioWorklet = true} = {}) {
  const sent = [];
  const listeners = [];
  const status = {textContent: '', hidden: true};
  const loads = [];
  const sandbox = {TextEncoder, console, JSON, Object, Array, Map, Set, Promise, Error, TypeError, Symbol, Math, Number, String, Boolean};
  sandbox.document = {getElementById: () => status};
  if (audioWorklet) {
    sandbox.AudioWorklet = function AudioWorklet() {};
    sandbox.AudioWorklet.prototype.addModule = function addModule(url) {
      const load = {};
      load.url = url;
      load.promise = new Promise((resolve, reject) => { load.settle = resolve; load.fail = reject; });
      loads.push(load);
      return load.promise;
    };
  }
  vm.createContext(sandbox);
  vm.runInContext('globalThis.window = globalThis;', sandbox);
  sandbox.craftmineRuntime = {
    scope: {protocol: runtimeProtocol, worldId: 'world-p3', buildId: 'gbd-p3', instanceId: 'instance-p3'},
    post: message => sent.push(message),
    on: handler => listeners.push(handler),
  };
  vm.runInContext(bridge, sandbox, {filename: bridgePath});
  return {sandbox, sent, listeners, status, loads, page: sandbox};
}

const tick = () => new Promise(resolve => setImmediate(resolve));

/** Drives one page through `register`/`start` exactly as the export shell does. */
async function startEngine(page, {requestQuit} = {}) {
  const events = [];
  const engine = {
    quitCalls: 0,
    async startGame() { events.push('started'); },
    requestQuit() {
      engine.quitCalls += 1;
      if (requestQuit) requestQuit(engine, events);
      events.push('QUIT');
    },
  };
  page.page.CraftmineGame.register(() => { /* the host drives everything through ops */ });
  await page.page.CraftmineGame.start(engine);
  await tick();
  const session = {page, engine, events, quitCalls: () => engine.quitCalls};
  session.ready = page.sent.filter(message => message.type === 'ready').length;
  session.requestExit = (id = 1) => {
    for (const listener of page.listeners) {
      listener({protocol: runtimeProtocol, worldId: 'world-p3', buildId: 'gbd-p3', instanceId: 'instance-p3', id, op: 'exit', args: {}});
    }
  };
  session.audioWorklet = page.sandbox.AudioWorklet ? new page.sandbox.AudioWorklet() : null;
  return session;
}

test('the pre-fix construction orders the quit before the engine node continuation', async () => {
  // The counterexample: a barrier that is opened from inside the handler whose
  // return value becomes the promise the engine chained on. The engine's
  // continuation is queued only after that handler returned, i.e. after the
  // quit microtask.
  const events = [];
  let context = {};
  let settleLoad;
  const loading = new Promise(resolve => { settleLoad = resolve; });
  const barrier = new Promise(resolve => {
    void loading.then(value => { resolve(); return value; }).then(() => {
      events.push(context === null ? 'NODE_WITH_NULL_CONTEXT' : 'NODE_READY');
    });
  });
  void barrier.then(() => { context = null; events.push('QUIT'); });
  settleLoad();
  await tick();
  assert.deepEqual(events, ['QUIT', 'NODE_WITH_NULL_CONTEXT']);
});

test('a quit already waiting for the module load still runs after the engine continuation', async () => {
  // The engine's teardown nulls the AudioContext, and its worklet continuation
  // builds the node from it afterwards.
  const context = {alive: true};
  const page = makePage();
  const session = await startEngine(page, {requestQuit: () => { context.alive = false; }});
  assert.equal(session.ready, 1);
  const driver = session.audioWorklet.addModule('index.audio.worklet.js').then(() => {
    session.events.push(context.alive ? 'NODE_READY' : 'NODE_WITH_NULL_CONTEXT');
  });
  assert.equal(page.loads.length, 1);
  assert.equal(session.quitCalls(), 0);

  // The quit arrives first and has to wait: nothing else keeps the module open.
  session.requestExit();
  await tick();
  assert.equal(session.quitCalls(), 0, 'the quit must wait for the engine audio preparation');
  assert.equal(session.page.sent.some(message => message.type === 'response'), false);

  page.loads[0].settle();
  await Promise.all([driver, tick(), tick()]);
  assert.deepEqual(session.events.filter(entry => entry !== 'started'), ['NODE_READY', 'QUIT']);
  assert.equal(session.quitCalls(), 1);
});

test('a quit that arrives after the engine audio preparation is not delayed further', async () => {
  const page = makePage();
  const session = await startEngine(page);
  session.audioWorklet.addModule('index.audio.worklet.js');
  page.loads[0].settle();
  await tick();
  session.requestExit();
  await tick();
  assert.equal(session.quitCalls(), 1);
  assert.deepEqual(session.events.filter(entry => entry !== 'started'), ['QUIT']);
});

test('several engine module loads all settle before the quit is requested', async () => {
  const page = makePage();
  const session = await startEngine(page);
  session.audioWorklet.addModule('index.audio.worklet.js');
  session.audioWorklet.addModule('index.audio.position.worklet.js');
  session.requestExit();
  await tick();
  assert.equal(session.quitCalls(), 0);
  page.loads[0].settle();
  await tick();
  assert.equal(session.quitCalls(), 0, 'the second module load still holds the quit');
  page.loads[1].settle();
  await tick();
  assert.equal(session.quitCalls(), 1);
});

/** Runs the failure probe in its own process, where the rejection is the datum. */
function probe(mode) {
  const result = spawnSync(process.execPath, [path.join(here, 'fixtures', 'audio-module-failure-probe.mjs'), mode, bridgePath], {encoding: 'utf8'});
  assert.equal(result.status, 0, `probe exited ${result.status}: ${result.stderr}`);
  const line = String(result.stdout).trim().split(/\r?\n/).filter(Boolean).pop();
  return JSON.parse(line);
}

test('a real module-load failure stays an unhandled page error and still releases the quit', () => {
  const preFix = probe('unwrapped');
  const shipped = probe('wrapped');
  // Visibility floor: without any barrier, the engine's own two shapes surface
  // both failures on the page's unhandled-rejection channel.
  assert.deepEqual([...preFix.reports].sort(), ['module load failed', 'position module load failed']);
  for (const message of preFix.reports) {
    assert.ok(shipped.reports.includes(message), `the barrier silenced ${JSON.stringify(message)}: ${JSON.stringify(shipped.reports)}`);
  }
  // The wrapper cannot know whether a caller will consume the rejection, so every
  // failed load is re-raised: the report count can grow, never shrink.
  assert.ok(shipped.reports.length >= preFix.reports.length, JSON.stringify(shipped.reports));
  assert.deepEqual(shipped.events, ['QUIT'], 'no worklet node may be built for a failed module load');
  assert.equal(shipped.quitBeforeFailure, 0, 'the quit must wait while the modules are still loading');
  assert.equal(shipped.quitAfterFailure, 1, 'a failed load must not wedge the quit');
  assert.equal(shipped.exitRequested, true);
  assert.deepEqual(shipped.runtimeErrors, []);
});

test('a genuinely failing quit request is reported instead of swallowed', async () => {
  const page = makePage();
  const failure = new Error('GodotRuntime is not available');
  const session = await startEngine(page, {
    requestQuit() { throw failure; },
  });
  session.requestExit();
  await tick();
  const reported = page.sent.filter(message => message.type === 'runtime-error');
  assert.equal(reported.length, 1, `expected one runtime-error, got ${JSON.stringify(page.sent)}`);
  assert.match(String(reported[0].error), /quit request failed/);
  assert.match(String(reported[0].error), /GodotRuntime is not available/);
});

test('a page without AudioWorklet support quits as before', async () => {
  const page = makePage({audioWorklet: false});
  const session = await startEngine(page);
  session.requestExit();
  await tick();
  assert.equal(session.quitCalls(), 1);
});

test('a module load that never settles holds the quit, so the host bound decides', async () => {
  const page = makePage();
  const session = await startEngine(page);
  session.audioWorklet.addModule('index.audio.worklet.js');
  session.requestExit();
  await tick();
  await tick();
  assert.equal(session.quitCalls(), 0);
  assert.deepEqual(session.events.filter(entry => entry !== 'started'), []);
});
