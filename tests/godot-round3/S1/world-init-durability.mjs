// S1 round-three: world initialization is one durable operation with a stable id.
//
// This spawns the built craftmine-core over its real stdio protocol in an
// isolated data directory. No window, no input, no audio.
//
// The audit found the host factory returning right after `initialize`, deleting
// the materialized directory on any error, and never routing
// `godotWorld.initialize`/`initStatus`. This test proves the core half the host
// and the client must consume: the same request replays instead of creating a
// second world, the phase is derived from durable facts, and a restart keeps the
// registered world and its initialization record.
//
// Usage: node tests/godot-round3/S1/world-init-durability.mjs
// Exit:  0 all checks passed, 1 a check failed, 3 the binary is missing.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const binary =
  process.env.CRAFTMINE_CORE_BIN ??
  path.join(root, 'vendor', 'pi-desktop', 'target', 'debug', process.platform === 'win32' ? 'craftmine-core.exe' : 'craftmine-core');

if (!fs.existsSync(binary)) {
  console.error(`CORE_BINARY_MISSING: ${binary}\nBuild it with: cargo build --manifest-path vendor/pi-desktop/Cargo.toml -p craftmine-core`);
  process.exit(3);
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 's1-world-init-'));

const results = [];
let failed = 0;
function check(name, condition, detail = '') {
  results.push({ name, passed: Boolean(condition), detail });
  if (!condition) failed += 1;
}

function startCore() {
  const child = spawn(binary, ['--data-dir', dataDir], { stdio: ['pipe', 'pipe', 'pipe'] });
  const state = { child, buffer: '', nextId: 1, pending: new Map(), stderr: '' };
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', text => { state.stderr += text; });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', text => {
    state.buffer += text;
    let index = state.buffer.indexOf('\n');
    while (index >= 0) {
      const line = state.buffer.slice(0, index);
      state.buffer = state.buffer.slice(index + 1);
      index = state.buffer.indexOf('\n');
      if (!line.trim()) continue;
      let response;
      try {
        response = JSON.parse(line);
      } catch (error) {
        for (const job of state.pending.values()) job.reject(new Error(`INVALID_RESPONSE: ${line.slice(0, 200)}`));
        state.pending.clear();
        continue;
      }
      const job = state.pending.get(response.id);
      if (!job) continue;
      state.pending.delete(response.id);
      if (response.error) job.reject(Object.assign(new Error(response.error.message ?? response.error.code ?? 'CORE_ERROR'), response.error));
      else job.resolve(response.result);
    }
  });
  state.call = (method, params = {}) => {
    const id = state.nextId++;
    return new Promise((resolve, reject) => {
      state.pending.set(id, { resolve, reject });
      state.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, error => { if (error) reject(error); });
    });
  };
  state.stop = async () => {
    state.child.stdin.end();
    await new Promise(resolve => state.child.once('close', resolve));
  };
  return state;
}

const progress = worldId => ({
  format: 'craftmine.godot-progress/1', worldId, baseId: 'first-person', baseVersion: '0.1.0',
  stateVersion: 1, body: { worldId, player: { position: [0, 0, 0] }, inventory: {} },
});

let core = startCore();
try {
  const first = await core.call('godotWorld.initialize', {
    worldId: 'world-init', title: 'Init World', baseId: 'first-person', baseBuild: 'base-2026.09',
    snapshot: progress('world-init'),
  });
  check('initialize registers a pending world', first.replayed === false && first.init.status === 'pending', JSON.stringify(first.init?.status));
  const initId = first.init.initId;

  // A lost response is answered by the same operation, not by a second world.
  const replay = await core.call('godotWorld.initialize', {
    worldId: 'world-init', title: 'Init World', baseId: 'first-person', baseBuild: 'base-2026.09',
    snapshot: progress('world-init'),
  });
  check('the identical request replays the same operation', replay.replayed === true && replay.init.initId === initId, `${replay.replayed}/${replay.init?.initId}`);

  const status = await core.call('godotWorld.initStatus', { worldId: 'world-init' });
  check('initStatus derives a non-playable pending phase', status.playable === false && status.status === 'pending', `${status.status}/${status.playable}`);

  // A different request for the same world is a real conflict, not a new world.
  let conflict = 'OK';
  try {
    await core.call('godotWorld.initialize', {
      worldId: 'world-init', title: 'Other World', baseId: 'first-person', baseBuild: 'base-other',
      snapshot: progress('world-init'),
    });
  } catch (error) {
    conflict = error.code ?? 'NO_CODE';
  }
  check('a different initialization is refused', conflict === 'WORLD_EXISTS', conflict);

  const worlds = await core.call('world.list', {});
  check('exactly one world was registered', worlds.filter(world => world.id === 'world-init').length === 1, JSON.stringify(worlds.map(world => world.id)));

  await core.stop();

  // Restart: the durable record survives and the phase is re-derived.
  core = startCore();
  const afterRestart = await core.call('godotWorld.initStatus', { worldId: 'world-init' });
  check('the initialization record survives a restart', afterRestart.initId === initId && afterRestart.status === 'pending' && afterRestart.playable === false, JSON.stringify(afterRestart));
  const stillRegistered = await core.call('world.read', { id: 'world-init' });
  check('the registered world survives a restart', stillRegistered.id === 'world-init', String(stillRegistered.id));
} catch (error) {
  check('harness completed', false, String(error?.message ?? error));
} finally {
  await core.stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

for (const result of results) {
  console.log(`[${result.passed ? 'pass' : 'fail'}] ${result.name}${result.detail ? ` -> ${result.detail}` : ''}`);
}
if (core.stderr.trim()) console.log(`[core stderr] ${core.stderr.trim()}`);
console.log(`\nSUMMARY: ${results.length - failed} passed, ${failed} failed, ${results.length} checks`);
process.exit(failed === 0 ? 0 : 1);
