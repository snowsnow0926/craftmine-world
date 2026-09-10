// Child-process probe for P3: an AudioWorklet module load that really fails must
// keep reaching the page's unhandled-rejection channel, with or without the
// bridge's quit barrier, and a quit that is already waiting must still be
// released by the failure.
//
// It runs in its own process because an unhandled rejection is exactly what is
// being measured, and the test runner reports any in-process one as a failure.
import fs from 'node:fs';
import vm from 'node:vm';

const [mode, bridgePath] = process.argv.slice(2);
const runtimeProtocol = 'craftmine.godot-runtime/2';
const reports = [];
process.on('unhandledRejection', reason => reports.push(String(reason && reason.message ? reason.message : reason)));

const sent = [];
const listeners = [];
const status = {textContent: '', hidden: true};
const loads = [];
const sandbox = {TextEncoder, console, JSON, Object, Array, Map, Set, Promise, Error, TypeError, Symbol, Math, Number, String, Boolean};
sandbox.document = {getElementById: () => status};
sandbox.AudioWorklet = function AudioWorklet() {};
sandbox.AudioWorklet.prototype.addModule = function addModule() {
  const load = {};
  load.promise = new Promise((resolve, reject) => { load.settle = resolve; load.fail = reject; });
  loads.push(load);
  return load.promise;
};
vm.createContext(sandbox);
vm.runInContext('globalThis.window = globalThis;', sandbox);
if (mode !== 'unwrapped') {
  sandbox.craftmineRuntime = {
    scope: {protocol: runtimeProtocol, worldId: 'world-p3', buildId: 'gbd-p3', instanceId: 'instance-p3'},
    post: message => sent.push(message),
    on: handler => listeners.push(handler),
  };
  vm.runInContext(fs.readFileSync(bridgePath, 'utf8'), sandbox, {filename: bridgePath});
}

const events = [];
const engine = {quitCalls: 0, async startGame() {}, requestQuit() { engine.quitCalls += 1; events.push('QUIT'); }};
let exitRequested = false;
if (mode !== 'unwrapped') {
  sandbox.CraftmineGame.register(() => {});
  await sandbox.CraftmineGame.start(engine);
  await new Promise(resolve => setImmediate(resolve));
}

// The engine's two real shapes:
//   * `GodotAudioWorklet.create` chains the worklet node construction on the
//     promise the load returned, and stores that chain.
//   * `GodotAudio.audioPositionWorkletPromise` stores the load promise itself.
const worklet = new sandbox.AudioWorklet();
const createPath = worklet.addModule('index.audio.worklet.js').then(() => events.push('NODE_READY'));
const positionPath = worklet.addModule('index.audio.position.worklet.js');

// The quit arrives while both loads are still in flight, exactly like a check
// that fails right after the engine answered ready.
if (mode !== 'unwrapped') {
  for (const listener of listeners) {
    exitRequested = true;
    listener({protocol: runtimeProtocol, worldId: 'world-p3', buildId: 'gbd-p3', instanceId: 'instance-p3', id: 1, op: 'exit', args: {}});
  }
}
await new Promise(resolve => setImmediate(resolve));
const quitBeforeFailure = engine.quitCalls;
loads[0].fail(new TypeError('module load failed'));
loads[1].fail(new TypeError('position module load failed'));
await new Promise(resolve => setImmediate(resolve));
await new Promise(resolve => setImmediate(resolve));
await new Promise(resolve => setImmediate(resolve));
await new Promise(resolve => setImmediate(resolve));

process.stdout.write(JSON.stringify({
  mode, reports, quitBeforeFailure, quitAfterFailure: engine.quitCalls, events, exitRequested,
  runtimeErrors: sent.filter(message => message.type === 'runtime-error').map(message => message.error),
}) + '\n');
process.exit(0);
