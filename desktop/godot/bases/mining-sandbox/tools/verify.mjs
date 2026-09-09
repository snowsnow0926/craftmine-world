#!/usr/bin/env node
// Base-local smoke suite for the mining-sandbox base.
//
// This is the quick "does the base still work after my edit" tool that ships with
// the base. It is deliberately independent of
// tests/godot-remaining/G/a16-acceptance.mjs (the frozen A16 matrix): it scans for
// its targets through the probe instead of re-implementing the generator, and it
// covers a short behaviour list rather than the full acceptance table.
//
// It runs headless only: no OS input, no window, no pointer lock. Every world and
// every progress directory is private and temporary.
//
// Usage:
//   node tools/verify.mjs [--keep] [--evidence <dir>]
//   CRAFTMINE_GODOT_BIN overrides the pinned Godot console editor build.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = resolve(HERE, '..');
const REPO = resolve(BASE, '..', '..', '..', '..');
const MANIFEST = JSON.parse(readFileSync(join(BASE, 'manifest.json'), 'utf8'));
const PARAMS = JSON.parse(readFileSync(join(BASE, 'params', 'mining_sandbox_params.json'), 'utf8'));

const KEEP = process.argv.includes('--keep');
const evidenceIndex = process.argv.indexOf('--evidence');

const GODOT = process.env.CRAFTMINE_GODOT_BIN
  || join(REPO, 'desktop', 'build', 'godot', '4.7.2-stable', 'editor', 'Godot_v4.7.2-stable_win64_console.exe');

const ROOT = mkdtempSync(join(tmpdir(), 'ms-verify-'));
// Raw logs live beside the temporary worlds unless --evidence points at a
// permanent directory, so a smoke run never pollutes the base tree.
const EVIDENCE = evidenceIndex >= 0 ? resolve(process.argv[evidenceIndex + 1]) : join(ROOT, 'evidence');
const checks = [];
let runs = 0;

function log(name, text) {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(join(EVIDENCE, name), text);
}

function check(name, ok, detail = {}) {
  checks.push({ name, ok: Boolean(ok), detail });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` :: ${JSON.stringify(detail)}`}\n`);
}

function makeWorld(template, worldId, options = {}) {
  const out = join(ROOT, worldId);
  const create = spawnSync(process.execPath, [
    join(HERE, 'new-world.mjs'), '--template', template, '--world-id', worldId,
    '--name', options.name || worldId, '--out', out,
  ], { encoding: 'utf8' });
  if (create.status !== 0) throw new Error(`new-world failed: ${create.stderr || create.stdout}`);
  if (options.seed !== undefined || options.inventory) {
    const file = join(out, 'world.json');
    const world = JSON.parse(readFileSync(file, 'utf8'));
    if (options.seed !== undefined) world.generation.seed = options.seed;
    if (options.inventory) world.initialProgress.inventory = options.inventory;
    writeFileSync(file, `${JSON.stringify(world, null, 2)}\n`);
  }
  const progressRoot = join(ROOT, `${worldId}-progress`);
  mkdirSync(progressRoot, { recursive: true });
  const imported = spawnSync(GODOT, ['--headless', '--path', out, '--import'], { encoding: 'utf8', timeout: 180000 });
  log(`${worldId}-import.log`, `exit=${imported.status}\n${imported.stdout}\n${imported.stderr}\n`);
  return { dir: out, worldId, progressRoot };
}

function probe(world, commands, options = {}) {
  runs += 1;
  const tag = `${world.worldId}-${String(runs).padStart(2, '0')}`;
  const req = join(ROOT, `${tag}-req.json`);
  const res = join(ROOT, `${tag}-res.json`);
  const request = { format: MANIFEST.protocols.probeFormat, commands };
  if (options.saveOnExit !== undefined) request.saveOnExit = options.saveOnExit;
  writeFileSync(req, `${JSON.stringify(request, null, 2)}\n`);
  const env = { ...process.env, CRAFTMINE_MINING_SANDBOX_PROGRESS_ROOT: options.progressRoot || world.progressRoot };
  const run = spawnSync(GODOT, [
    '--headless', '--path', world.dir, '--', '--probe',
    `--probe-request=${req}`, `--probe-response=${res}`,
  ], { encoding: 'utf8', timeout: 180000, env });
  let response = null;
  if (existsSync(res)) {
    try {
      response = JSON.parse(readFileSync(res, 'utf8'));
    } catch (error) {
      response = { ok: false, error: error.message };
    }
  }
  log(`${tag}.log`, `exit=${run.status}\nrequest=${JSON.stringify(request)}\nresponse=${JSON.stringify(response)}\n${run.stdout}\n${run.stderr}`);
  return { response, exitCode: run.status };
}

const result = (run, index) => (run.response && Array.isArray(run.response.results) ? run.response.results[index]?.result : null);
const snapshot = (world, options) => probe(world, [{ op: 'snapshot' }], options).response?.finalSnapshot;

// Finds a tile through the probe: `material` with two air tiles above it, so a
// 12x26 body can stand there and dig downwards.
function findTile(world, material) {
  const rows = [];
  for (let ty = 3; ty < 24; ty += 1) {
    for (let tx = 2; tx < 24; tx += 1) rows.push({ op: 'tile', args: { tx, ty } });
  }
  const run = probe(world, rows, { saveOnExit: false });
  for (let index = 0; index < rows.length; index += 1) {
    const tile = result(run, index);
    if (tile && tile.material === material) return { tx: tile.tx, ty: tile.ty };
  }
  return null;
}

function feetFor(tx, ty) {
  const size = PARAMS.grid.tileSize;
  return { x: tx * size + size / 2, y: ty * size };
}

function progressPath(world, progressRoot = world.progressRoot) {
  return join(progressRoot, 'worlds', createHash('sha256').update(world.worldId).digest('hex'), 'progress.json');
}

function main() {
  if (!existsSync(GODOT)) throw new Error(`Godot binary not found: ${GODOT} (set CRAFTMINE_GODOT_BIN)`);

  // 1. deterministic generation
  const first = makeWorld('blank', 'verify-gen-a', { seed: 777 });
  const second = makeWorld('blank', 'verify-gen-b', { seed: 777 });
  const third = makeWorld('blank', 'verify-gen-c', { seed: 778 });
  const hashA = result(probe(first, [{ op: 'hash' }]), 0);
  const hashB = result(probe(second, [{ op: 'hash' }]), 0);
  const hashC = result(probe(third, [{ op: 'hash' }]), 0);
  check('generation is reproducible for the same seed', hashA && hashB && hashA.hash === hashB.hash, { hashA, hashB });
  check('a different seed changes the terrain', hashC && hashA && hashC.hash !== hashA.hash, { hashC });

  // 2. dig, place and craft rules
  const mine = makeWorld('mine-camp', 'verify-mine', { inventory: [{ id: 'stone_brick', count: 4 }, { id: 'stone', count: 2 }] });
  const stone = findTile(mine, 'stone');
  check('a stone tile can be found through the probe', stone !== null, { stone });
  const feet = feetFor(stone.tx, stone.ty);
  const digRun = probe(mine, [
    { op: 'set-position', args: { x: feet.x, y: feet.y } },
    { op: 'dig', args: { tx: stone.tx, ty: stone.ty, requestId: 'verify-dig' } },
    { op: 'tile', args: { tx: stone.tx, ty: stone.ty } },
    { op: 'inventory' },
    { op: 'dig', args: { tx: stone.tx, ty: stone.ty, requestId: 'verify-dig' } },
    { op: 'inventory' },
  ], { saveOnExit: false });
  check('a legal dig removes the tile and grants one drop',
    result(digRun, 1)?.ok === true && result(digRun, 2)?.material === 'air' && result(digRun, 3)?.stone === 3,
    { dig: result(digRun, 1), tile: result(digRun, 2), inventory: result(digRun, 3) });
  check('replaying the same request id grants nothing twice',
    result(digRun, 4)?.duplicate === true && result(digRun, 5)?.stone === 3,
    { replay: result(digRun, 4), inventory: result(digRun, 5) });

  const far = probe(mine, [
    { op: 'set-position', args: { x: feet.x, y: 4 } },
    { op: 'dig', args: { tx: stone.tx + 1, ty: stone.ty, requestId: 'verify-far' } },
  ], { saveOnExit: false });
  check('a dig beyond reach is rejected', result(far, 1)?.reason === 'out_of_range', { result: result(far, 1) });

  const placeRun = probe(mine, [
    { op: 'set-position', args: { x: feet.x, y: feet.y } },
    { op: 'place', args: { tx: stone.tx, ty: stone.ty, materialId: 'stone_brick', requestId: 'verify-place' } },
    { op: 'tile', args: { tx: stone.tx, ty: stone.ty } },
    { op: 'inventory' },
    { op: 'place', args: { tx: stone.tx, ty: stone.ty, materialId: 'stone_brick', requestId: 'verify-place-2' } },
  ], { saveOnExit: false });
  check('a legal place sets the tile and consumes one item',
    result(placeRun, 1)?.ok === true && result(placeRun, 2)?.material === 'stone_brick' && result(placeRun, 3)?.stone_brick === 3,
    { place: result(placeRun, 1), tile: result(placeRun, 2), inventory: result(placeRun, 3) });
  check('placing into an occupied tile is rejected', result(placeRun, 4)?.reason === 'cell_occupied', { result: result(placeRun, 4) });

  const craftRun = probe(mine, [
    { op: 'craft', args: { recipeId: 'stone-brick', requestId: 'verify-craft' } },
    { op: 'inventory' },
    { op: 'craft', args: { recipeId: 'iron-pickaxe', requestId: 'verify-craft-2' } },
  ], { saveOnExit: false });
  check('a craft consumes its inputs and grants the output',
    result(craftRun, 0)?.ok === true && result(craftRun, 1)?.stone === 1 && result(craftRun, 1)?.stone_brick === 4,
    { craft: result(craftRun, 0), inventory: result(craftRun, 1) });
  check('a craft without materials is rejected',
    ['insufficient_materials', 'missing_station', 'out_of_range'].includes(result(craftRun, 2)?.reason),
    { result: result(craftRun, 2) });

  // 3. persistence across a restart
  const before = snapshot(mine);
  const saved = probe(mine, [{ op: 'save' }], { saveOnExit: false });
  const after = snapshot(mine);
  check('save then reopen keeps terrain, inventory and position',
    before && after && result(saved, 0)?.ok === true
      && before.terrainHash === after.terrainHash
      && JSON.stringify(before.inventory) === JSON.stringify(after.inventory)
      && JSON.stringify(before.player.tile) === JSON.stringify(after.player.tile),
    { before: before && { hash: before.terrainHash, inventory: before.inventory }, after: after && { hash: after.terrainHash, inventory: after.inventory } });
  const chunkDir = join(dirname(progressPath(mine)), 'chunks');
  const chunkFiles = existsSync(chunkDir) ? readdirSync(chunkDir) : [];
  check('a modified chunk has a file and an unmodified chunk does not',
    chunkFiles.length >= 1 && Object.keys(JSON.parse(readFileSync(progressPath(mine), 'utf8')).chunks).length === chunkFiles.length,
    { chunkFiles });

  // 4. a corrupt save is rejected whole
  const corrupt = makeWorld('mine-camp', 'verify-corrupt');
  const target = findTile(corrupt, 'stone');
  const cFeet = feetFor(target.tx, target.ty);
  probe(corrupt, [
    { op: 'set-position', args: { x: cFeet.x, y: cFeet.y } },
    { op: 'dig', args: { tx: target.tx, ty: target.ty, requestId: 'verify-corrupt-dig' } },
    { op: 'save' },
  ], { saveOnExit: false });
  writeFileSync(progressPath(corrupt), '{ broken');
  const corruptRun = probe(corrupt, [{ op: 'restore' }, { op: 'inventory' }], { saveOnExit: false });
  check('a corrupt progress file is rejected and nothing is applied',
    result(corruptRun, 0)?.ok === false && result(corruptRun, 1)?.stone === 0,
    { restore: result(corruptRun, 0), inventory: result(corruptRun, 1) });

  // 5. the blank start really is blank
  const blank = JSON.parse(readFileSync(join(BASE, 'templates', 'blank', 'world.json.template'), 'utf8')
    .replace(/__[A-Z_]+__/g, 'template-check'));
  check('the blank template ships no items, recipes or entities',
    (blank.initialProgress.inventory || []).length === 0 && (blank.recipes || []).length === 0 && (blank.entities || []).length === 0,
    { inventory: blank.initialProgress.inventory, recipes: blank.recipes.length });
}

let crash = null;
try {
  main();
} catch (error) {
  crash = error;
  checks.push({ name: 'harness', ok: false, detail: { message: error.message } });
  process.stderr.write(`verify: ${error.message}\n${error.stack}\n`);
}

const passed = checks.filter((entry) => entry.ok).length;
const report = {
  format: 'craftmine.mining-sandbox-verify/1',
  baseId: MANIFEST.baseId,
  baseVersion: MANIFEST.baseVersion,
  godot: GODOT,
  runs,
  total: checks.length,
  passed,
  checks,
};
log('report.json', `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`\nverify: ${passed}/${checks.length} checks passed\n`);

if (!KEEP) rmSync(ROOT, { recursive: true, force: true });
else process.stdout.write(`temp worlds kept at ${ROOT}\n`);
if (crash || passed !== checks.length) process.exit(1);
