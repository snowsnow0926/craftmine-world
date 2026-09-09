#!/usr/bin/env node
// Side-view base acceptance harness.
//
// Runs the real Godot 4.7.2 project in isolated headless processes. The harness
// presses buttons through the scripted input source and reads the runtime probe;
// it never writes a player coordinate, ability, checkpoint or reward. Passing
// therefore means real physics and real state carried the player.
//
// Usage:
//   node tools/verify.mjs [--keep] [--json <report>]
// Env:
//   CRAFTMINE_GODOT_BIN             engine binary (defaults to the pinned 4.7.2 build)
//   CRAFTMINE_SIDEVIEW_TEST_ROOT    isolated run root (defaults to a temp dir)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { computeGateReport, loadJson, defaultPaths } from './gate-metrics.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const baseDir = path.resolve(here, '..');
const projectDir = baseDir;
const plansDir = path.join(baseDir, 'tools', 'plans');

const ENGINE_CANDIDATES = [
  path.resolve(baseDir, '..', '..', '..', 'build', 'godot', '4.7.2-stable', 'editor', 'Godot_v4.7.2-stable_win64_console.exe'),
  path.resolve(baseDir, '..', '..', '..', 'build', 'godot', '4.7.2-stable', 'editor', 'Godot_v4.7.2-stable_win64.exe'),
];

const ENGINE_VERSION = '4.7.2-stable';

const checks = [];
const runs = {};

function check(id, passed, detail) {
  checks.push({ id, passed: Boolean(passed), detail: detail === undefined ? '' : String(detail) });
}

function resolveEngine() {
  const fromEnv = process.env.CRAFTMINE_GODOT_BIN;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  for (const candidate of ENGINE_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return '';
}

function makeRunRoot() {
  if (process.env.CRAFTMINE_SIDEVIEW_TEST_ROOT) return process.env.CRAFTMINE_SIDEVIEW_TEST_ROOT;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(os.tmpdir(), 'craftmine-side-view-acceptance', stamp);
}

function runGodot({ label, world, saveDir, planFile, reset, projectOverride }) {
  const engine = resolveEngine();
  const project = projectOverride || projectDir;
  const outFile = path.join(runRoot, 'runs', `${label}.json`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const plan = loadJson(planFile);
  const cap = (plan.durationTicks || 0) + (plan.settleTicks || 0) + 600;
  const env = { ...process.env };
  env.CRAFTMINE_SIDEVIEW_WORLD = world;
  env.CRAFTMINE_SIDEVIEW_SAVE_DIR = saveDir;
  env.CRAFTMINE_SIDEVIEW_INPUT_PLAN = planFile;
  env.CRAFTMINE_SIDEVIEW_PROBE_OUT = outFile;
  if (reset) env.CRAFTMINE_SIDEVIEW_RESET = '1';
  else delete env.CRAFTMINE_SIDEVIEW_RESET;
  const started = Date.now();
  const result = spawnSync(engine, ['--headless', '--path', project, '--fixed-fps', '60', '--quit-after', String(cap)], {
    env,
    encoding: 'utf8',
    timeout: 600000,
    windowsHide: true,
  });
  const record = {
    label,
    world,
    project,
    plan: plan.name,
    saveDir,
    outFile,
    exitCode: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    durationMs: Date.now() - started,
    run: null,
  };
  if (fs.existsSync(outFile)) {
    record.run = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  }
  runs[label] = record;
  return record;
}

// Godot resolves global `class_name` declarations from `.godot/global_script_class_cache.cfg`,
// which an editor import pass generates. A fresh checkout therefore needs one
// import before the first headless run. This is idempotent and cached.
function ensureImport(project) {
  const engine = resolveEngine();
  const result = spawnSync(engine, ['--headless', '--path', project, '--import'], {
    encoding: 'utf8',
    timeout: 600000,
    windowsHide: true,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const scriptErrors = output.split(/\r?\n/).filter((line) => line.includes('SCRIPT ERROR'));
  return { ok: result.status === 0 && scriptErrors.length === 0, scriptErrors, output };
}

function events(run, name) {
  if (!run || !Array.isArray(run.events)) return [];
  return run.events.filter((event) => event.name === name);
}

function firstEvent(run, name) {
  const list = events(run, name);
  return list.length ? list[0] : null;
}

function samples(run) {
  return (run && run.samples) || [];
}

function sampleAtTick(run, tick) {
  const list = samples(run);
  for (const sample of list) if (sample[0] === tick) return sample;
  return null;
}

// A room transition or a respawn legitimately relocates the player. Everything
// else must be continuous motion: that is what rules out a teleport-based pass.
function allowedDiscontinuityTicks(run) {
  const allowed = new Set();
  for (const name of ['room_entered', 'player_respawned']) {
    for (const event of events(run, name)) {
      for (let d = -2; d <= 2; d += 1) allowed.add(event.tick + d);
    }
  }
  return allowed;
}

function maxStep(run) {
  const list = samples(run);
  const allowed = allowedDiscontinuityTicks(run);
  let dx = 0;
  let dy = 0;
  for (let i = 1; i < list.length; i += 1) {
    const prev = list[i - 1];
    const cur = list[i];
    if (prev[1] !== cur[1]) continue;
    if (allowed.has(cur[0])) continue;
    // Normalise by the tick gap so a skipped sample is not mistaken for a jump.
    const gap = Math.max(1, cur[0] - prev[0]);
    dx = Math.max(dx, Math.abs(cur[2] - prev[2]) / gap);
    dy = Math.max(dy, Math.abs(cur[3] - prev[3]) / gap);
  }
  return { dx, dy };
}

function highestPoint(run, roomId) {
  let best = Infinity;
  for (const sample of samples(run)) {
    if (roomId && sample[1] !== roomId) continue;
    best = Math.min(best, sample[3]);
  }
  return best;
}

function copySave(fromLabel, toLabel) {
  const from = path.join(runRoot, 'saves', fromLabel);
  const to = path.join(runRoot, 'saves', toLabel);
  fs.rmSync(to, { recursive: true, force: true });
  if (fs.existsSync(from)) fs.cpSync(from, to, { recursive: true });
  return to;
}

function saveDirFor(label) {
  return path.join(runRoot, 'saves', label);
}

// --- source guards --------------------------------------------------------

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function scanPlayerPositionWrites() {
  const file = path.join(baseDir, 'scripts', 'player', 'side_view_player.gd');
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  let currentFunc = '';
  const writes = [];
  lines.forEach((line, index) => {
    const funcMatch = line.match(/^\s*func\s+([A-Za-z0-9_]+)/);
    if (funcMatch) currentFunc = funcMatch[1];
    if (/^\s*position\s*=/.test(line)) writes.push({ func: currentFunc, line: index + 1, text: line.trim() });
  });
  return writes;
}

function scanForbiddenVerifierWrites() {
  const file = path.join(baseDir, 'scripts', 'probe', 'headless_verifier.gd');
  const text = fs.readFileSync(file, 'utf8');
  const forbidden = ['grant_ability', 'collect_reward', 'activate_checkpoint', 'add_counter', 'place_at', 'position =', 'global_position ='];
  return forbidden.filter((needle) => text.includes(needle));
}

function scanPlaceAtCallSites() {
  const hits = [];
  for (const file of walk(path.join(baseDir, 'scripts'))) {
    if (!file.endsWith('.gd')) continue;
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (/\bplace_at\s*\(/.test(line) && !/^\s*func\s+place_at/.test(line)) {
        hits.push({ file: path.relative(baseDir, file).replace(/\\/g, '/'), line: index + 1 });
      }
    });
  }
  return hits;
}

// --- scenarios ------------------------------------------------------------

function assertRunHealthy(label, record) {
  check(`${label}.exit0`, record.exitCode === 0, `exit=${record.exitCode}`);
  check(`${label}.traceWritten`, Boolean(record.run), record.outFile);
  if (!record.run) return;
  const step = maxStep(record.run);
  check(`${label}.noTeleportX`, step.dx <= 5, `max dx/tick=${step.dx.toFixed(3)}`);
  check(`${label}.noTeleportY`, step.dy <= 32, `max dy/tick=${step.dy.toFixed(3)}`);
}

function main() {
  const engine = resolveEngine();
  if (!engine) {
    console.error('Cannot find a Godot engine. Set CRAFTMINE_GODOT_BIN or install the pinned build under desktop/build/godot/4.7.2-stable/editor/.');
    process.exit(2);
  }
  const engineVersion = spawnSync(engine, ['--headless', '--version'], { encoding: 'utf8' }).stdout.trim();
  check('engine.version', engineVersion.includes('4.7.2'), engineVersion);

  // A fresh checkout has no import cache, so run one before any scenario.
  const importReport = ensureImport(projectDir);
  check('project.importClean', importReport.ok, importReport.scriptErrors.join(' | '));

  // H. Arithmetic gate: independent of any play run.
  const metrics = computeGateReport(loadJson(defaultPaths().params), loadJson(defaultPaths().world));
  check('gate.singleJumpBlocked', metrics.singleJumpBlocked, `margin=${metrics.singleJumpMargin}`);
  check('gate.doubleJumpPasses', metrics.doubleJumpPasses, `margin=${metrics.doubleJumpMargin}`);

  // Source guards: the player cannot be teleported by a test hook.
  const writes = scanPlayerPositionWrites();
  check('guard.playerPositionWritesOnlyInPlaceAt', writes.length > 0 && writes.every((w) => w.func === 'place_at'), JSON.stringify(writes));
  const forbidden = scanForbiddenVerifierWrites();
  check('guard.verifierCannotWriteState', forbidden.length === 0, forbidden.join(','));
  const placeAtSites = scanPlaceAtCallSites();
  check(
    'guard.placeAtCallSites',
    placeAtSites.every((hit) => hit.file === 'scripts/player/side_view_player.gd' || hit.file === 'scripts/world/room_manager.gd'),
    JSON.stringify(placeAtSites),
  );

  // A. Reach the ruins room by playing.
  const a = runGodot({
    label: 'A_reach_ruins',
    world: 'ruins',
    saveDir: saveDirFor('A_reach_ruins'),
    planFile: path.join(plansDir, 'travel_to_ruins.json'),
    reset: true,
  });
  assertRunHealthy('A', a);
  if (a.run) {
    const final = a.run.final;
    check('A.roomIsRuins', final.player.room === 'ruins', final.player.room);
    check('A.checkpointActive', final.checkpoints.active === 'cp_ruins', final.checkpoints.active);
    check('A.cacheRewardCollected', final.rewards.reward_ruins_cache === true, JSON.stringify(final.rewards));
    check('A.coinsFromCache', final.counters.coins === 5, JSON.stringify(final.counters));
    check('A.noAbilityYet', final.abilities.double_jump !== true, JSON.stringify(final.abilities));
    check('A.doorUsed', Boolean(firstEvent(a.run, 'door_used')), 'door_used event');
  }

  // B. Locked gate: same real save, no ability, must not reach the vault.
  const b = runGodot({
    label: 'B_gate_locked',
    world: 'ruins',
    saveDir: copySave('A_reach_ruins', 'B_gate_locked'),
    planFile: path.join(plansDir, 'attempt_vault_locked.json'),
    reset: false,
  });
  assertRunHealthy('B', b);
  if (b.run) {
    check('B.neverEnteredVault', events(b.run, 'room_entered').every((e) => e.data.roomId !== 'vault'), 'room_entered vault');
    check('B.noVaultDoor', events(b.run, 'door_used').every((e) => e.data.targetRoom !== 'vault'), 'door_used vault');
    check('B.noAbility', b.run.final.abilities.double_jump !== true, JSON.stringify(b.run.final.abilities));
    const highest = highestPoint(b.run, 'ruins');
    check('B.neverAboveLedgeTop', highest >= 250, `highest feet y=${highest.toFixed(2)} (ledge top 250)`);
  }

  // C. Earn the ability by landing on the low platform.
  const c = runGodot({
    label: 'C_get_ability',
    world: 'ruins',
    saveDir: copySave('A_reach_ruins', 'C_get_ability'),
    planFile: path.join(plansDir, 'get_ability.json'),
    reset: false,
  });
  assertRunHealthy('C', c);
  if (c.run) {
    const gained = firstEvent(c.run, 'ability_gained');
    check('C.abilityGained', Boolean(gained), 'ability_gained event');
    check('C.abilityFromPickup', Boolean(gained) && gained.data.source === 'pickup', gained ? JSON.stringify(gained.data) : '');
    check('C.abilityPersisted', c.run.final.abilities.double_jump === true, JSON.stringify(c.run.final.abilities));
    const saveFile = path.join(saveDirFor('C_get_ability'), 'ruins', 'state.json');
    const onDisk = fs.existsSync(saveFile) ? JSON.parse(fs.readFileSync(saveFile, 'utf8')) : null;
    check('C.saveFileHasAbility', Boolean(onDisk) && onDisk.abilities.double_jump === true, onDisk ? JSON.stringify(onDisk.abilities) : 'no save file');
    if (gained) {
      const sample = sampleAtTick(c.run, gained.tick);
      check('C.gainedOnPlatform', Boolean(sample) && sample[3] < 380, sample ? `y=${sample[3].toFixed(1)}` : 'no sample');
    }
  }

  // D. Fresh process: the ability must have survived the restart and open the gate.
  const d = runGodot({
    label: 'D_enter_vault',
    world: 'ruins',
    saveDir: copySave('C_get_ability', 'D_enter_vault'),
    planFile: path.join(plansDir, 'enter_vault.json'),
    reset: false,
  });
  assertRunHealthy('D', d);
  if (d.run) {
    check('D.bootLoadedSave', d.run.boot.loaded === true, JSON.stringify(d.run.boot));
    const firstSample = samples(d.run)[0];
    check('D.abilitySurvivedRestart', Boolean(firstSample) && firstSample[8] === true, firstSample ? `doubleJumpUnlocked=${firstSample[8]}` : 'no sample');
    check('D.enteredVault', events(d.run, 'room_entered').some((e) => e.data.roomId === 'vault'), 'room_entered vault');
    check('D.usedDoubleJump', events(d.run, 'player_jump').some((e) => e.data.kind === 'double'), 'double jump event');
    const highest = highestPoint(d.run, 'ruins');
    check('D.roseAboveLedge', highest < 250, `highest feet y=${highest.toFixed(2)} (ledge top 250)`);
    const abilityTick = firstEvent(c.run, 'ability_gained')?.tick ?? -1;
    const vaultTick = firstEvent(d.run, 'room_entered') ? Math.min(...events(d.run, 'room_entered').filter((e) => e.data.roomId === 'vault').map((e) => e.tick)) : -1;
    check('D.vaultOnlyAfterUnlock', vaultTick >= 0 && abilityTick >= 0, `ability tick=${abilityTick} (previous process), vault tick=${vaultTick} (this process)`);
  }

  // E. Return trip: no duplicate rewards, no lost state.
  const e = runGodot({
    label: 'E_revisit',
    world: 'ruins',
    saveDir: copySave('D_enter_vault', 'E_revisit'),
    planFile: path.join(plansDir, 'revisit_rooms.json'),
    reset: false,
  });
  assertRunHealthy('E', e);
  if (e.run && d.run) {
    const before = d.run.final;
    const after = e.run.final;
    check('E.abilityKept', after.abilities.double_jump === true, JSON.stringify(after.abilities));
    check('E.coinsUnchanged', after.counters.coins === before.counters.coins, `${before.counters.coins} -> ${after.counters.coins}`);
    check('E.noDuplicateRewards', events(e.run, 'reward_collected').length === 0, `${events(e.run, 'reward_collected').length} reward events on the return trip`);
    check('E.revisitedRooms', (after.rooms.entrance?.entries ?? 0) >= 2 && (after.rooms.ruins?.entries ?? 0) >= 2, JSON.stringify(after.rooms));
    check('E.checkpointKept', after.checkpoints.active !== '', after.checkpoints.active);
  }

  // F. Hazard death respawns at the real checkpoint and keeps progress.
  const f = runGodot({
    label: 'F_hazard_respawn',
    world: 'ruins',
    saveDir: saveDirFor('F_hazard_respawn'),
    planFile: path.join(plansDir, 'walk_into_spikes.json'),
    reset: true,
  });
  assertRunHealthy('F', f);
  if (f.run) {
    const died = firstEvent(f.run, 'player_died');
    check('F.diedOnHazard', Boolean(died) && String(died.data.cause).startsWith('hazard:'), died ? JSON.stringify(died.data) : 'no death');
    const respawned = firstEvent(f.run, 'player_respawned');
    check('F.respawnedAtCheckpoint', Boolean(respawned) && respawned.data.checkpointId === 'cp_entrance', respawned ? JSON.stringify(respawned.data) : 'no respawn');
    check('F.checkpointSaved', f.run.final.checkpoints.active === 'cp_entrance', f.run.final.checkpoints.active);
    check('F.deathCounted', (f.run.final.counters.deaths ?? 0) >= 1, JSON.stringify(f.run.final.counters));
  }

  // G. Blank start: base controls and attack work, no ability is granted.
  const g = runGodot({
    label: 'G_blank_basic',
    world: 'blank',
    saveDir: saveDirFor('G_blank_basic'),
    planFile: path.join(plansDir, 'blank_basic.json'),
    reset: true,
  });
  assertRunHealthy('G', g);
  if (g.run) {
    check('G.jumped', events(g.run, 'player_jump').some((e) => e.data.kind === 'ground'), 'ground jump');
    check('G.attackedDummy', events(g.run, 'target_hit').some((e) => e.data.targetId === 'dummy_start'), 'target_hit dummy_start');
    check('G.defeatedDummy', events(g.run, 'target_defeated').some((e) => e.data.targetId === 'dummy_start'), 'target_defeated dummy_start');
    check('G.rewardOnce', g.run.final.counters.coins === 1, JSON.stringify(g.run.final.counters));
    check('G.noAbilityInBlank', Object.keys(g.run.final.abilities).length === 0, JSON.stringify(g.run.final.abilities));
  }

  // H. Materialized world: the source shape the host materializes for a build.
  const materializedDir = path.join(runRoot, 'materialized-ruins');
  const materialize = spawnSync(process.execPath, [
    path.join(baseDir, 'tools', 'new-world.mjs'),
    '--world', 'ruins',
    '--out', materializedDir,
    '--force',
  ], { encoding: 'utf8', windowsHide: true });
  check('H.materializeExits0', materialize.status === 0, (materialize.stderr || '').trim().slice(0, 200));
  check('H.materializeReceipt', fs.existsSync(path.join(materializedDir, 'MATERIALIZED.json')), 'MATERIALIZED.json');
  check('H.materializeDefaultPointer', fs.existsSync(path.join(materializedDir, 'worlds', 'default.json')), 'worlds/default.json');
  const materializedImport = ensureImport(materializedDir);
  check('H.materializedImportClean', materializedImport.ok, materializedImport.scriptErrors.join(' | '));
  const h = runGodot({
    label: 'H_materialized',
    world: 'ruins',
    saveDir: saveDirFor('H_materialized'),
    planFile: path.join(plansDir, 'travel_to_ruins.json'),
    reset: true,
    projectOverride: materializedDir,
  });
  assertRunHealthy('H', h);
  if (h.run) {
    check('H.materializedReachesRuins', events(h.run, 'room_entered').some((e) => e.data.roomId === 'ruins'), 'room_entered ruins');
    check('H.materializedEntryScene', h.run.final.baseId === 'side-view', h.run.final.baseId);
  }

  // --- report ------------------------------------------------------------
  const failed = checks.filter((entry) => !entry.passed);
  const report = {
    format: 'craftmine.godot-sideview-acceptance/1',
    baseId: 'side-view',
    engine,
    engineVersion,
    runRoot,
    startedAt,
    finishedAt: new Date().toISOString(),
    metrics,
    checks,
    failed: failed.length,
    passed: checks.length - failed.length,
    runs: Object.fromEntries(Object.entries(runs).map(([key, value]) => [key, {
      plan: value.plan,
      world: value.world,
      exitCode: value.exitCode,
      trace: path.relative(runRoot, value.outFile).replace(/\\/g, '/'),
      final: value.run ? value.run.final : null,
    }])),
  };
  const jsonTarget = jsonOut || path.join(runRoot, 'verify-report.json');
  fs.mkdirSync(path.dirname(jsonTarget), { recursive: true });
  fs.writeFileSync(jsonTarget, `${JSON.stringify(report, null, 2)}\n`);

  for (const entry of checks) {
    console.log(`${entry.passed ? 'PASS' : 'FAIL'}  ${entry.id}${entry.detail ? `  (${entry.detail})` : ''}`);
  }
  console.log(`\n${report.passed}/${checks.length} checks passed`);
  console.log(`report: ${jsonTarget}`);
  console.log(`run root: ${runRoot}`);
  if (failed.length) {
    console.error(`SIDE_VIEW_ACCEPTANCE_FAILED (${failed.length})`);
    process.exit(1);
  }
  console.log('SIDE_VIEW_ACCEPTANCE_OK');
}

const runRoot = makeRunRoot();
const startedAt = new Date().toISOString();
const jsonOut = (() => {
  const index = process.argv.indexOf('--json');
  return index >= 0 ? path.resolve(process.argv[index + 1]) : '';
})();

fs.mkdirSync(path.join(runRoot, 'runs'), { recursive: true });
fs.mkdirSync(path.join(runRoot, 'saves'), { recursive: true });

main();
