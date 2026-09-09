#!/usr/bin/env node
// Independent A16 acceptance matrix for the mining-sandbox base.
//
// This harness is written against docs/SPEC.md, not against the implementation:
// it re-derives the deterministic terrain in JavaScript and cross-checks it with
// the engine, and it drives the base only through the documented probe interface.
// Every world is created in a private temporary directory with a private progress
// root; the harness never sends OS input, never creates a window and never
// requests pointer lock.
//
// Usage:
//   node tests/godot-remaining/G/a16-acceptance.mjs [--evidence <dir>] [--keep]
//
// Environment:
//   CRAFTMINE_GODOT_BIN   override the Godot 4.7.2-stable console editor build

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const BASE = join(REPO, 'desktop', 'godot', 'bases', 'mining-sandbox');
const PARAMS = JSON.parse(readFileSync(join(BASE, 'params', 'mining_sandbox_params.json'), 'utf8'));
const MANIFEST = JSON.parse(readFileSync(join(BASE, 'manifest.json'), 'utf8'));

const args = process.argv.slice(2);
const KEEP = args.includes('--keep');
const evidenceIndex = args.indexOf('--evidence');
const EVIDENCE = evidenceIndex >= 0
  ? resolve(args[evidenceIndex + 1])
  : join(REPO, 'docs', 'dispatch-reports', 'godot-remaining', 'G', 'evidence', 'a16');

const GODOT = process.env.CRAFTMINE_GODOT_BIN
  || join(REPO, 'desktop', 'build', 'godot', '4.7.2-stable', 'editor', 'Godot_v4.7.2-stable_win64_console.exe');

const ROOT = mkdtempSync(join(tmpdir(), 'a16-mining-'));
const results = [];
let runCounter = 0;

// ---------------------------------------------------------------- reference terrain

// Independent JavaScript re-implementation of SPEC section 2. If the engine and
// this function disagree, the generation is not the frozen contract.
function hash3(x, y, salt) {
  let h = BigInt(x) * 73856093n + BigInt(y) * 19349663n + BigInt(salt) * 83492791n;
  h = (h ^ (h >> 13n)) * 1274126177n;
  h = h ^ (h >> 16n);
  return Number(h & 0x7FFFFFFFn);
}

function referenceTerrain(generation) {
  const [width, height] = generation.mapSize;
  const { baseRow, amplitude } = generation.surface;
  const seed = generation.seed;
  const cells = new Array(width * height).fill('air');
  const surfaceRow = (tx) => baseRow + (hash3(tx, 0, seed) % (2 * amplitude + 1)) - amplitude;
  const index = (tx, ty) => ty * width + tx;

  for (let tx = 0; tx < width; tx += 1) {
    const top = surfaceRow(tx);
    for (let ty = 0; ty < height; ty += 1) {
      let material = 'air';
      if (ty >= top) {
        if (ty === top) material = generation.soilTopMaterial;
        else if (ty <= top + generation.soilDepth) material = generation.soilMaterial;
        else material = ty >= generation.deepRockRow ? generation.deepRockMaterial : generation.rockMaterial;
      }
      if (ty >= height - generation.bedrockRows) material = 'bedrock';
      cells[index(tx, ty)] = material;
    }
  }

  const get = (tx, ty) => (tx < 0 || ty < 0 || tx >= width || ty >= height ? null : cells[index(tx, ty)]);
  const set = (tx, ty, material) => { cells[index(tx, ty)] = material; };

  const growVein = (startX, startY, material, size, salt, allowed) => {
    let cx = startX;
    let cy = startY;
    for (let step = 0; step < size; step += 1) {
      const current = get(cx, cy);
      if (current !== null && allowed.includes(current)) set(cx, cy, material);
      const direction = hash3(cx, cy, salt) % 4;
      if (direction === 0) cx += 1;
      else if (direction === 1) cx -= 1;
      else if (direction === 2) cy += 1;
      else cy -= 1;
      if (cx < 0 || cy < 0 || cx >= width || cy >= height) return;
    }
  };

  (generation.ores || []).forEach((ore, oreIndex) => {
    const salt = seed ^ ((oreIndex + 1) * 7919);
    const veinSalt = seed ^ ((oreIndex + 1) * 104729);
    for (let ty = ore.minRow; ty <= Math.min(ore.maxRow, height - 1); ty += 1) {
      for (let tx = 0; tx < width; tx += 1) {
        if (ty >= height - generation.bedrockRows) continue;
        const current = get(tx, ty);
        if (!ore.hostMaterials.includes(current)) continue;
        if (hash3(tx, ty, salt) % 1000 < ore.chancePerMille) {
          growVein(tx, ty, ore.material, ore.veinSize, veinSalt, ore.hostMaterials);
        }
      }
    }
  });

  const caves = generation.caves || { chancePerMille: 0 };
  if (caves.chancePerMille > 0) {
    const salt = seed ^ 0x5EED;
    const veinSalt = seed ^ 0xCA7E;
    for (let ty = caves.minRow; ty <= Math.min(caves.maxRow, height - 1); ty += 1) {
      for (let tx = 0; tx < width; tx += 1) {
        if (ty >= height - generation.bedrockRows) continue;
        const current = get(tx, ty);
        if (current === 'air' || current === 'bedrock') continue;
        if (hash3(tx, ty, salt) % 1000 < caves.chancePerMille) {
          let cx = tx;
          let cy = ty;
          for (let step = 0; step < caves.veinSize; step += 1) {
            if (cy <= surfaceRow(cx) || cy >= height - generation.bedrockRows) break;
            if (get(cx, cy) !== 'bedrock' && get(cx, cy) !== null) set(cx, cy, 'air');
            const direction = hash3(cx, cy, veinSalt) % 4;
            if (direction === 0) cx += 1;
            else if (direction === 1) cx -= 1;
            else if (direction === 2) cy += 1;
            else cy -= 1;
            if (cx < 0 || cy < 0 || cx >= width || cy >= height) break;
          }
        }
      }
    }
  }

  const entries = [];
  for (let ty = 0; ty < height; ty += 1) {
    for (let tx = 0; tx < width; tx += 1) entries.push(`${tx},${ty},${get(tx, ty)}`);
  }
  const terrainHash = createHash('sha256').update(entries.join('\n')).digest('hex');
  return { width, height, get, surfaceRow, terrainHash, material: (tx, ty) => get(tx, ty) };
}

// ---------------------------------------------------------------------- helpers

function log(name, payload) {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(join(EVIDENCE, name), typeof payload === 'string' ? payload : `${JSON.stringify(payload, null, 2)}\n`);
}

function check(id, description, condition, detail = {}) {
  const entry = { id, description, ok: Boolean(condition), detail };
  results.push(entry);
  process.stdout.write(`${entry.ok ? 'PASS' : 'FAIL'} ${id} ${description}${entry.ok ? '' : ` :: ${JSON.stringify(detail)}`}\n`);
  return entry.ok;
}

function makeWorld(template, worldId, options = {}) {
  const out = join(ROOT, worldId);
  const create = spawnSync(process.execPath, [
    join(BASE, 'tools', 'new-world.mjs'),
    '--template', template,
    '--world-id', worldId,
    '--name', options.name || worldId,
    '--out', out,
  ], { encoding: 'utf8' });
  if (create.status !== 0) throw new Error(`new-world failed: ${create.stderr || create.stdout}`);
  const worldPath = join(out, 'world.json');
  const world = JSON.parse(readFileSync(worldPath, 'utf8'));
  if (options.seed !== undefined) world.generation.seed = options.seed;
  if (options.inventory) world.initialProgress.inventory = options.inventory;
  if (options.mutate) options.mutate(world);
  writeFileSync(worldPath, `${JSON.stringify(world, null, 2)}\n`);
  const progressRoot = join(ROOT, `${worldId}-progress`);
  mkdirSync(progressRoot, { recursive: true });
  const imported = spawnSync(GODOT, ['--headless', '--path', out, '--import'], { encoding: 'utf8', timeout: 180000 });
  log(`${worldId}-import.log`, `exit=${imported.status}\n--- stdout ---\n${imported.stdout}\n--- stderr ---\n${imported.stderr}\n`);
  return { dir: out, world, progressRoot, worldId };
}

function runProbe(world, commands, options = {}) {
  runCounter += 1;
  const tag = `${world.worldId}-${String(runCounter).padStart(3, '0')}`;
  const reqPath = join(ROOT, `${tag}-req.json`);
  const resPath = join(ROOT, `${tag}-res.json`);
  const request = {
    format: MANIFEST.protocols.probeFormat,
    commands,
  };
  if (options.saveOnExit !== undefined) request.saveOnExit = options.saveOnExit;
  writeFileSync(reqPath, `${JSON.stringify(request, null, 2)}\n`);
  const env = { ...process.env, CRAFTMINE_MINING_SANDBOX_PROGRESS_ROOT: options.progressRoot || world.progressRoot };
  const run = spawnSync(GODOT, [
    '--headless', '--path', world.dir,
    '--', '--probe', `--probe-request=${reqPath}`, `--probe-response=${resPath}`,
  ], { encoding: 'utf8', timeout: 180000, env });
  let response = null;
  if (existsSync(resPath)) {
    try {
      response = JSON.parse(readFileSync(resPath, 'utf8'));
    } catch (error) {
      response = { ok: false, error: `response not JSON: ${error.message}` };
    }
  }
  log(`${tag}.log`, [
    `exit=${run.status}`,
    `request=${JSON.stringify(request)}`,
    `response=${JSON.stringify(response)}`,
    `--- stdout ---`, run.stdout || '',
    `--- stderr ---`, run.stderr || '',
  ].join('\n'));
  return { exitCode: run.status, response, stdout: run.stdout || '', stderr: run.stderr || '' };
}

function resultOf(probe, index) {
  const results = probe.response && probe.response.results;
  if (!Array.isArray(results) || !results[index]) return null;
  return results[index].result;
}

function single(world, command, options) {
  const probe = runProbe(world, [command], options);
  return { probe, result: resultOf(probe, 0), snapshot: probe.response && probe.response.finalSnapshot };
}

function snapshotOf(world, options) {
  const probe = runProbe(world, [{ op: 'snapshot' }], options);
  return probe.response && probe.response.finalSnapshot;
}

function playerFeetForTile(tx, ty) {
  const tile = PARAMS.grid.tileSize;
  return { x: tx * tile + tile / 2, y: ty * tile };
}

function distanceToTile(tx, ty, feet) {
  const tile = PARAMS.grid.tileSize;
  const centerX = tx * tile + tile / 2;
  const centerY = ty * tile + tile / 2;
  const playerCenterY = feet.y - PARAMS.body.height / 2;
  return Math.hypot(centerX - feet.x, centerY - playerCenterY);
}

function findTile(terrain, predicate, fromRow = 2) {
  for (let ty = fromRow; ty < terrain.height; ty += 1) {
    for (let tx = 2; tx < terrain.width - 2; tx += 1) {
      if (predicate(terrain, tx, ty)) return { tx, ty };
    }
  }
  return null;
}

// A tile the player can stand above and reach: the tile itself is `material` and
// the two tiles above it are air, so a 12x26 body fits while digging downwards.
function findDiggable(terrain, material) {
  return findTile(terrain, (t, tx, ty) => t.get(tx, ty) === material
    && t.get(tx, ty - 1) === 'air'
    && t.get(tx, ty - 2) === 'air');
}

function chunkIdOf(tx, ty) {
  const [cw, ch] = PARAMS.grid.chunkTiles;
  return `${Math.floor(tx / cw)}_${Math.floor(ty / ch)}`;
}

function readProgress(world, progressRoot = world.progressRoot) {
  const path = join(progressRoot, 'worlds', createHash('sha256').update(world.worldId).digest('hex'), 'progress.json');
  if (!existsSync(path)) return null;
  return { path, text: readFileSync(path, 'utf8'), data: JSON.parse(readFileSync(path, 'utf8')) };
}

function chunksDir(world, progressRoot = world.progressRoot) {
  return join(progressRoot, 'worlds', createHash('sha256').update(world.worldId).digest('hex'), 'chunks');
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

// ------------------------------------------------------------------- the matrix

function run() {
  if (!existsSync(GODOT)) {
    throw new Error(`Godot binary not found: ${GODOT} (set CRAFTMINE_GODOT_BIN)`);
  }
  log('environment.json', {
    godot: GODOT,
    base: BASE,
    params: PARAMS.format,
    evidence: EVIDENCE,
    startedAt: new Date().toISOString(),
  });

  // ---- G01/G02/G03/G04: deterministic finite generation and chunk identity
  const determinismA = makeWorld('blank', 'a16-gen-a', { seed: 424242 });
  const determinismB = makeWorld('blank', 'a16-gen-b', { seed: 424242 });
  const otherSeed = makeWorld('blank', 'a16-gen-c', { seed: 999999 });
  const terrainA = referenceTerrain(determinismA.world.generation);
  const terrainC = referenceTerrain(otherSeed.world.generation);
  const hashA = single(determinismA, { op: 'hash' }).result;
  const hashB = single(determinismB, { op: 'hash' }).result;
  const hashC = single(otherSeed, { op: 'hash' }).result;
  check('G01', 'same generation block produces the same terrain hash', hashA && hashB && hashA.hash === hashB.hash && hashA.hash === terrainA.terrainHash,
    { hashA: hashA && hashA.hash, hashB: hashB && hashB.hash, reference: terrainA.terrainHash });
  check('G02', 'a different seed produces a different terrain hash', hashC && hashC.hash !== hashA.hash && hashC.hash === terrainC.terrainHash,
    { hashC: hashC && hashC.hash, reference: terrainC.terrainHash });

  const sampleTiles = [];
  for (let ty = 0; ty < terrainA.height; ty += 3) {
    for (let tx = 0; tx < terrainA.width; tx += 5) sampleTiles.push([tx, ty]);
  }
  const sampleProbe = runProbe(determinismA, sampleTiles.map(([tx, ty]) => ({ op: 'tile', args: { tx, ty } })));
  const mismatches = sampleTiles.filter(([tx, ty], index) => {
    const result = resultOf(sampleProbe, index);
    return !result || result.material !== terrainA.get(tx, ty);
  });
  check('G01b', 'the engine agrees with the independent JS terrain reference on a sampled grid', mismatches.length === 0,
    { sampled: sampleTiles.length, mismatches: mismatches.slice(0, 8) });

  const edgeProbe = runProbe(determinismA, [
    { op: 'tile', args: { tx: 0, ty: 0 } },
    { op: 'tile', args: { tx: 47, ty: 23 } },
    { op: 'tile', args: { tx: 16, ty: 16 } },
  ]);
  const edgeResults = [resultOf(edgeProbe, 0), resultOf(edgeProbe, 1), resultOf(edgeProbe, 2)];
  check('G03', 'tile-to-chunk mapping matches <tx/16>_<ty/16> including the partial boundary chunk',
    edgeResults.every((entry) => entry && entry.chunk)
      && edgeResults[0].chunk === '0_0'
      && edgeResults[1].chunk === '2_1'
      && edgeResults[2].chunk === '1_1',
    { chunks: edgeResults.map((entry) => entry && entry.chunk) });

  const outside = runProbe(determinismA, [
    { op: 'dig', args: { tx: -1, ty: 4, requestId: 'g04-a' } },
    { op: 'dig', args: { tx: 48, ty: 4, requestId: 'g04-b' } },
    { op: 'dig', args: { tx: 4, ty: 24, requestId: 'g04-c' } },
    { op: 'hash' },
  ]);
  const outsideResults = [resultOf(outside, 0), resultOf(outside, 1), resultOf(outside, 2)];
  check('G04', 'tiles outside mapSize are rejected with out_of_bounds and mutate nothing',
    outsideResults.every((entry) => entry && entry.ok === false && entry.reason === 'out_of_bounds')
      && resultOf(outside, 3).hash === terrainA.terrainHash,
    { results: outsideResults, hashUnchanged: resultOf(outside, 3).hash === terrainA.terrainHash });

  // ---- G05/G06/G07/G08/G09/G10/G11: dig rules
  const mine = makeWorld('mine-camp', 'a16-dig');
  const terrain = referenceTerrain(mine.world.generation);
  const mineHash = single(mine, { op: 'hash' }).result;
  check('G01c', 'the engine matches the JS reference on a world with ore veins and caves',
    mineHash && mineHash.hash === terrain.terrainHash,
    { engine: mineHash && mineHash.hash, reference: terrain.terrainHash });
  const stone = findDiggable(terrain, 'stone');
  const coal = findDiggable(terrain, 'coal_ore');
  const deep = findDiggable(terrain, 'deepstone');
  const bedrock = findTile(terrain, (t, tx, ty) => t.get(tx, ty) === 'bedrock' && t.get(tx, ty - 1) === 'air');
  const feet = playerFeetForTile(stone.tx, stone.ty);
  const digFlow = runProbe(mine, [
    { op: 'set-position', args: { x: feet.x, y: feet.y, facing: 'right' } },
    { op: 'inventory' },
    { op: 'dig', args: { tx: stone.tx, ty: stone.ty, requestId: 'g05-dig' } },
    { op: 'tile', args: { tx: stone.tx, ty: stone.ty } },
    { op: 'inventory' },
    { op: 'chunk', args: { cx: Math.floor(stone.tx / 16), cy: Math.floor(stone.ty / 16) } },
  ], { saveOnExit: false });
  const digResult = resultOf(digFlow, 2);
  const beforeStone = resultOf(digFlow, 1);
  const afterStone = resultOf(digFlow, 4);
  check('G05', 'a legal dig removes the tile, bumps the chunk revision and grants exactly one drop',
    digResult && digResult.ok === true
      && resultOf(digFlow, 3).material === 'air'
      && afterStone.stone === beforeStone.stone + 1
      && resultOf(digFlow, 5).revision >= 1,
    { digResult, tile: resultOf(digFlow, 3), before: beforeStone, after: afterStone, chunk: resultOf(digFlow, 5) });

  const farFeet = playerFeetForTile(stone.tx, stone.ty);
  farFeet.y = 4;
  const far = runProbe(mine, [
    { op: 'set-position', args: { x: farFeet.x, y: farFeet.y } },
    { op: 'dig', args: { tx: stone.tx + 1, ty: stone.ty, requestId: 'g06-dig' } },
    { op: 'inventory' },
    { op: 'hash' },
  ], { saveOnExit: false });
  check('G06', 'a dig beyond reachTiles is rejected with out_of_range and changes nothing',
    resultOf(far, 1) && resultOf(far, 1).reason === 'out_of_range'
      && resultOf(far, 2).stone === afterStone.stone
      && resultOf(far, 3).hash === digFlow.response.finalSnapshot.terrainHash,
    { result: resultOf(far, 1), inventory: resultOf(far, 2), hash: resultOf(far, 3).hash });

  const airTile = { tx: stone.tx, ty: 2 };
  const airDig = runProbe(mine, [
    { op: 'set-position', args: { x: playerFeetForTile(airTile.tx, airTile.ty).x, y: playerFeetForTile(airTile.tx, airTile.ty).y } },
    { op: 'dig', args: { tx: airTile.tx, ty: airTile.ty, requestId: 'g07-dig' } },
  ], { saveOnExit: false });
  check('G07', 'digging air is rejected with not_solid',
    resultOf(airDig, 1) && resultOf(airDig, 1).reason === 'not_solid', { result: resultOf(airDig, 1) });

  const bedrockFeet = playerFeetForTile(bedrock.tx, bedrock.ty);
  const bedrockDig = runProbe(mine, [
    { op: 'set-position', args: { x: bedrockFeet.x, y: bedrockFeet.y } },
    { op: 'dig', args: { tx: bedrock.tx, ty: bedrock.ty, requestId: 'g08-dig' } },
  ], { saveOnExit: false });
  check('G08', 'digging bedrock is rejected with unbreakable',
    resultOf(bedrockDig, 1) && resultOf(bedrockDig, 1).reason === 'unbreakable', { result: resultOf(bedrockDig, 1) });

  const coalFeet = playerFeetForTile(coal.tx, coal.ty);
  const tierDig = runProbe(mine, [
    { op: 'set-position', args: { x: coalFeet.x, y: coalFeet.y } },
    { op: 'dig', args: { tx: coal.tx, ty: coal.ty, requestId: 'g09-dig' } },
  ], { saveOnExit: false });
  check('G09', 'digging a material above the equipped tool tier is rejected with tool_tier_too_low',
    resultOf(tierDig, 1) && resultOf(tierDig, 1).reason === 'tool_tier_too_low', { result: resultOf(tierDig, 1) });

  const duplicate = runProbe(mine, [
    { op: 'set-position', args: { x: feet.x, y: feet.y } },
    { op: 'dig', args: { tx: stone.tx, ty: stone.ty + 0, requestId: 'g05-dig' } },
    { op: 'inventory' },
  ], { saveOnExit: false });
  check('G10', 'replaying a dig request id returns duplicate and grants no second item',
    resultOf(duplicate, 1) && resultOf(duplicate, 1).ok === true && resultOf(duplicate, 1).duplicate === true
      && resultOf(duplicate, 2).stone === afterStone.stone,
    { result: resultOf(duplicate, 1), inventory: resultOf(duplicate, 2) });

  const cancelWorld = makeWorld('mine-camp', 'a16-cancel');
  const cancelTerrain = referenceTerrain(cancelWorld.world.generation);
  const cancelTarget = findDiggable(cancelTerrain, 'stone');
  const cancelFeet = playerFeetForTile(cancelTarget.tx, cancelTarget.ty);
  const cancelled = runProbe(cancelWorld, [
    { op: 'set-position', args: { x: cancelFeet.x, y: cancelFeet.y } },
    { op: 'cancel', args: { requestId: 'g11-dig' } },
    { op: 'dig', args: { tx: cancelTarget.tx, ty: cancelTarget.ty, requestId: 'g11-dig' } },
    { op: 'tile', args: { tx: cancelTarget.tx, ty: cancelTarget.ty } },
    { op: 'inventory' },
  ], { saveOnExit: false });
  check('G11', 'a cancelled request id is rejected with cancelled_request and applies nothing',
    resultOf(cancelled, 2) && resultOf(cancelled, 2).reason === 'cancelled_request'
      && resultOf(cancelled, 3).material === 'stone'
      && resultOf(cancelled, 4).stone === 0,
    { result: resultOf(cancelled, 2), tile: resultOf(cancelled, 3), inventory: resultOf(cancelled, 4) });

  // ---- G12..G17: place rules (fixture world with materials in initial progress)
  const place = makeWorld('mine-camp', 'a16-place', {
    inventory: [{ id: 'stone_brick', count: 20 }, { id: 'dirt', count: 20 }],
  });
  const placeTerrain = referenceTerrain(place.world.generation);
  const placeTarget = findTile(placeTerrain, (t, tx, ty) => t.get(tx, ty) === 'air'
    && t.get(tx, ty - 1) === 'air'
    && t.get(tx, ty + 1) !== 'air'
    && t.get(tx, ty + 1) !== null);
  const placeFeet = playerFeetForTile(placeTarget.tx, placeTarget.ty - 2);
  const placeFlow = runProbe(place, [
    { op: 'set-position', args: { x: placeFeet.x, y: placeFeet.y } },
    { op: 'place', args: { tx: placeTarget.tx, ty: placeTarget.ty, materialId: 'stone_brick', requestId: 'g12-place' } },
    { op: 'tile', args: { tx: placeTarget.tx, ty: placeTarget.ty } },
    { op: 'inventory' },
  ], { saveOnExit: false });
  check('G12', 'a legal place consumes exactly one item and sets the tile',
    resultOf(placeFlow, 1) && resultOf(placeFlow, 1).ok === true
      && resultOf(placeFlow, 2).material === 'stone_brick'
      && resultOf(placeFlow, 3).stone_brick === 19,
    { result: resultOf(placeFlow, 1), tile: resultOf(placeFlow, 2), inventory: resultOf(placeFlow, 3) });

  const nextAir = findTile(placeTerrain, (t, tx, ty) => t.get(tx, ty) === 'air'
    && t.get(tx, ty + 1) !== 'air'
    && Math.abs(tx - placeTarget.tx) + Math.abs(ty - placeTarget.ty) > 4);
  const nextFeet = playerFeetForTile(nextAir.tx, nextAir.ty - 2);
  const noMaterial = runProbe(place, [
    { op: 'set-position', args: { x: nextFeet.x, y: nextFeet.y } },
    { op: 'place', args: { tx: nextAir.tx, ty: nextAir.ty, materialId: 'iron_ingot', requestId: 'g13-place' } },
    { op: 'tile', args: { tx: nextAir.tx, ty: nextAir.ty } },
  ], { saveOnExit: false });
  check('G13', 'placing without the material is rejected with insufficient_materials and changes nothing',
    resultOf(noMaterial, 1) && ['insufficient_materials', 'material_not_placeable'].includes(resultOf(noMaterial, 1).reason)
      && resultOf(noMaterial, 2).material === 'air',
    { result: resultOf(noMaterial, 1), tile: resultOf(noMaterial, 2) });

  const occupiedFeet = playerFeetForTile(placeTarget.tx, placeTarget.ty - 2);
  const occupied = runProbe(place, [
    { op: 'set-position', args: { x: occupiedFeet.x, y: occupiedFeet.y } },
    { op: 'place', args: { tx: placeTarget.tx, ty: placeTarget.ty, materialId: 'stone_brick', requestId: 'g14-place' } },
    { op: 'inventory' },
  ], { saveOnExit: false });
  check('G14', 'placing into a non-air tile is rejected with cell_occupied and consumes nothing',
    resultOf(occupied, 1) && resultOf(occupied, 1).reason === 'cell_occupied'
      && resultOf(occupied, 2).stone_brick === 19,
    { result: resultOf(occupied, 1), inventory: resultOf(occupied, 2) });

  const outOfReach = runProbe(place, [
    { op: 'set-position', args: { x: nextFeet.x, y: 4 } },
    { op: 'place', args: { tx: nextAir.tx, ty: nextAir.ty, materialId: 'stone_brick', requestId: 'g15-place' } },
    { op: 'inventory' },
  ], { saveOnExit: false });
  check('G15', 'placing beyond reachTiles is rejected with out_of_range and consumes nothing',
    resultOf(outOfReach, 1) && resultOf(outOfReach, 1).reason === 'out_of_range'
      && resultOf(outOfReach, 2).stone_brick === 19,
    { result: resultOf(outOfReach, 1), inventory: resultOf(outOfReach, 2) });

  const bodyFeet = playerFeetForTile(nextAir.tx, nextAir.ty);
  const bury = runProbe(place, [
    { op: 'set-position', args: { x: bodyFeet.x, y: bodyFeet.y } },
    { op: 'place', args: { tx: nextAir.tx, ty: nextAir.ty - 1, materialId: 'stone_brick', requestId: 'g16-place' } },
    { op: 'tile', args: { tx: nextAir.tx, ty: nextAir.ty - 1 } },
    { op: 'snapshot' },
  ], { saveOnExit: false });
  check('G16', 'placing into the player body is rejected with would_bury_player',
    resultOf(bury, 1) && resultOf(bury, 1).reason === 'would_bury_player'
      && resultOf(bury, 2).material === 'air'
      && resultOf(bury, 3).physical.solidTilesInPlayerRect === 0,
    { result: resultOf(bury, 1), tile: resultOf(bury, 2), physical: resultOf(bury, 3).physical });

  const floating = findTile(placeTerrain, (t, tx, ty) => t.get(tx, ty) === 'air'
    && t.get(tx + 1, ty) === 'air' && t.get(tx - 1, ty) === 'air'
    && t.get(tx, ty + 1) === 'air' && t.get(tx, ty - 1) === 'air' && ty > 2 && ty < 6);
  const floatingFeet = playerFeetForTile(floating.tx, floating.ty + 2);
  const notAdjacent = runProbe(place, [
    { op: 'set-position', args: { x: floatingFeet.x, y: floatingFeet.y } },
    { op: 'place', args: { tx: floating.tx, ty: floating.ty, materialId: 'stone_brick', requestId: 'g17-place' } },
    { op: 'tile', args: { tx: floating.tx, ty: floating.ty } },
  ], { saveOnExit: false });
  check('G17', 'placing without a non-air neighbour is rejected with not_adjacent',
    resultOf(notAdjacent, 1) && resultOf(notAdjacent, 1).reason === 'not_adjacent'
      && resultOf(notAdjacent, 2).material === 'air',
    { result: resultOf(notAdjacent, 1), tile: resultOf(notAdjacent, 2) });

  // ---- G18/G19/G20: crafting
  const craft = makeWorld('mine-camp', 'a16-craft', {
    inventory: [{ id: 'stone', count: 4 }, { id: 'wood', count: 4 }, { id: 'iron_ore', count: 3 }, { id: 'coal', count: 1 }],
  });
  const craftFlow = runProbe(craft, [
    { op: 'craft', args: { recipeId: 'stone-pickaxe', requestId: 'g18-craft' } },
    { op: 'inventory' },
  ], { saveOnExit: false });
  check('G18', 'a legal craft consumes every input and grants the output once',
    resultOf(craftFlow, 0) && resultOf(craftFlow, 0).ok === true
      && resultOf(craftFlow, 1).stone === 1
      && resultOf(craftFlow, 1).wood === 2
      && resultOf(craftFlow, 1).stone_pickaxe === 1,
    { result: resultOf(craftFlow, 0), inventory: resultOf(craftFlow, 1) });

  const insufficient = runProbe(craft, [
    { op: 'craft', args: { recipeId: 'iron-pickaxe', requestId: 'g19-craft' } },
    { op: 'inventory' },
  ], { saveOnExit: false });
  check('G19', 'a craft with missing inputs is rejected with insufficient_materials and consumes nothing',
    resultOf(insufficient, 0) && ['insufficient_materials', 'missing_station', 'out_of_range'].includes(resultOf(insufficient, 0).reason)
      && resultOf(insufficient, 1).stone === 1,
    { result: resultOf(insufficient, 0), inventory: resultOf(insufficient, 1) });

  const station = craft.world.entities.find((entity) => entity.id === 'camp-forge');
  const stationFeet = playerFeetForTile(station.tile[0], station.tile[1] + 1);
  const stationCraft = runProbe(craft, [
    { op: 'set-position', args: { x: stationFeet.x, y: stationFeet.y } },
    { op: 'craft', args: { recipeId: 'iron-ingot', requestId: 'g20-craft' } },
    { op: 'inventory' },
    { op: 'craft', args: { recipeId: 'iron-ingot', requestId: 'g20-craft' } },
    { op: 'inventory' },
  ], { saveOnExit: false });
  check('G20', 'replaying a craft request id consumes nothing a second time',
    resultOf(stationCraft, 1) && resultOf(stationCraft, 1).ok === true
      && resultOf(stationCraft, 2).iron_ingot === 1
      && resultOf(stationCraft, 3) && resultOf(stationCraft, 3).duplicate === true
      && resultOf(stationCraft, 4).iron_ore === 0
      && resultOf(stationCraft, 4).iron_ingot === 1,
    { first: resultOf(stationCraft, 1), afterFirst: resultOf(stationCraft, 2), replay: resultOf(stationCraft, 3), afterReplay: resultOf(stationCraft, 4) });

  // ---- G21..G24: persistence across a real restart
  const persist = makeWorld('mine-camp', 'a16-persist', {
    inventory: [{ id: 'wood', count: 6 }, { id: 'stone_brick', count: 4 }],
  });
  const persistTerrain = referenceTerrain(persist.world.generation);
  const firstTarget = findDiggable(persistTerrain, 'stone');
  const secondTarget = findDiggable(persistTerrain, 'dirt');
  const thirdTarget = findTile(persistTerrain, (t, tx, ty) => t.get(tx, ty) === 'stone'
    && chunkIdOf(tx, ty) !== chunkIdOf(firstTarget.tx, firstTarget.ty)
    && t.get(tx, ty - 1) === 'air' && t.get(tx, ty - 2) === 'air');
  const firstFeet = playerFeetForTile(firstTarget.tx, firstTarget.ty);
  const session = runProbe(persist, [
    { op: 'set-position', args: { x: firstFeet.x, y: firstFeet.y, facing: 'left' } },
    { op: 'dig', args: { tx: firstTarget.tx, ty: firstTarget.ty, requestId: 'g21-dig-1' } },
    { op: 'set-position', args: { x: playerFeetForTile(secondTarget.tx, secondTarget.ty).x, y: playerFeetForTile(secondTarget.tx, secondTarget.ty).y } },
    { op: 'dig', args: { tx: secondTarget.tx, ty: secondTarget.ty, requestId: 'g21-dig-2' } },
    { op: 'set-position', args: { x: playerFeetForTile(thirdTarget.tx, thirdTarget.ty).x, y: playerFeetForTile(thirdTarget.tx, thirdTarget.ty).y } },
    { op: 'dig', args: { tx: thirdTarget.tx, ty: thirdTarget.ty, requestId: 'g21-dig-3' } },
    { op: 'craft', args: { recipeId: 'stone-brick', requestId: 'g21-craft' } },
    { op: 'set-position', args: { x: playerFeetForTile(firstTarget.tx, firstTarget.ty - 2).x, y: playerFeetForTile(firstTarget.tx, firstTarget.ty - 2).y } },
    { op: 'place', args: { tx: firstTarget.tx, ty: firstTarget.ty, materialId: 'stone_brick', requestId: 'g21-place' } },
    { op: 'snapshot' },
    { op: 'save' },
  ], { saveOnExit: false });
  const before = resultOf(session, 9);
  const saved = resultOf(session, 10);
  const after = snapshotOf(persist);
  check('G21', 'dig + craft + place, save, restart: terrain hash, inventory, tools and player tile are identical',
    before && after && saved && saved.ok === true
      && before.terrainHash === after.terrainHash
      && JSON.stringify(before.inventory) === JSON.stringify(after.inventory)
      && JSON.stringify(before.tools) === JSON.stringify(after.tools)
      && JSON.stringify(before.player.tile) === JSON.stringify(after.player.tile),
    { saved, before: { hash: before.terrainHash, inventory: before.inventory, player: before.player.tile }, after: { hash: after.terrainHash, inventory: after.inventory, player: after.player.tile } });

  const progressFile = readProgress(persist);
  const chunkFiles = existsSync(chunksDir(persist)) ? readdirSync(chunksDir(persist)) : [];
  const expectedChunks = [chunkIdOf(firstTarget.tx, firstTarget.ty), chunkIdOf(secondTarget.tx, secondTarget.ty), chunkIdOf(thirdTarget.tx, thirdTarget.ty)];
  const uniqueExpected = [...new Set(expectedChunks)];
  const indexEntry = (id) => (progressFile && progressFile.data.chunks && progressFile.data.chunks[id]) || {};
  // A chunk that was never edited must have no file at all, must report
  // edited:false, and its tiles must still equal the generated terrain.
  const untouched = (() => {
    for (let cy = 0; cy < Math.ceil(persistTerrain.height / 16); cy += 1) {
      for (let cx = 0; cx < Math.ceil(persistTerrain.width / 16); cx += 1) {
        const id = `${cx}_${cy}`;
        if (uniqueExpected.includes(id)) continue;
        const tx = cx * 16 + 1;
        const ty = cy * 16 + 1;
        if (persistTerrain.get(tx, ty) !== 'air') return { id, tx, ty };
      }
    }
    return null;
  })();
  const untouchedTile = untouched ? single(persist, { op: 'tile', args: { tx: untouched.tx, ty: untouched.ty } }).result : null;
  const untouchedChunk = untouched
    ? single(persist, { op: 'chunk', args: { cx: Number(untouched.id.split('_')[0]), cy: Number(untouched.id.split('_')[1]) } }).result
    : null;
  check('G22', 'an unmodified chunk has no file, reports edited:false and regenerates after restart',
    progressFile !== null
      && uniqueExpected.every((id) => {
        const entry = indexEntry(id);
        return Boolean(entry.file) && chunkFiles.includes(entry.file) && Number(entry.cells) >= 1;
      })
      && chunkFiles.length === uniqueExpected.length
      && untouched !== null
      && !chunkFiles.some((name) => name.startsWith(`${untouched.id}.`))
      && untouchedChunk && untouchedChunk.edited === false && Number(untouchedChunk.cells) === 0
      && untouchedTile && untouchedTile.material === persistTerrain.get(untouched.tx, untouched.ty),
    { chunkFiles, expected: uniqueExpected, untouched, untouchedTile, untouchedChunk });

  const restoredChunks = uniqueExpected.map((id) => {
    const probe = single(persist, { op: 'chunk', args: { cx: Number(id.split('_')[0]), cy: Number(id.split('_')[1]) } });
    return probe.result;
  });
  check('G23', 'every modified chunk is restored with exactly its saved revision and cell count',
    restoredChunks.every((entry, index) => {
      const saved = indexEntry(uniqueExpected[index]);
      return entry && entry.edited === true && entry.revision === Number(saved.revision) && entry.cells === Number(saved.cells);
    }),
    { restoredChunks, saved: uniqueExpected.map((id) => indexEntry(id)) });

  const partialChunk = uniqueExpected.find((id) => Number(id.split('_')[0]) === Math.floor((persistTerrain.width - 1) / 16));
  let partialOk = false;
  let partialDetail = { partialChunk };
  if (partialChunk) {
    const [pcx, pcy] = partialChunk.split('_').map(Number);
    const report = single(persist, { op: 'chunk', args: { cx: pcx, cy: pcy } }).result;
    partialOk = Boolean(report && report.edited === true);
    partialDetail = { ...partialDetail, report };
  } else {
    const boundaryWorld = makeWorld('mine-camp', 'a16-boundary', { inventory: [{ id: 'stone_brick', count: 2 }] });
    const boundaryTerrain = referenceTerrain(boundaryWorld.world.generation);
    const lastTx = boundaryTerrain.width - 1;
    const lastTy = findTile(boundaryTerrain, (t, tx, ty) => tx === lastTx && t.get(tx, ty) === 'stone'
      && t.get(tx, ty - 1) === 'air' && t.get(tx, ty - 2) === 'air');
    const bFeet = playerFeetForTile(lastTx, lastTy.ty);
    const boundaryRun = runProbe(boundaryWorld, [
      { op: 'set-position', args: { x: bFeet.x, y: bFeet.y } },
      { op: 'dig', args: { tx: lastTx, ty: lastTy.ty, requestId: 'g24-dig' } },
      { op: 'save' },
      { op: 'chunk', args: { cx: Math.floor(lastTx / 16), cy: Math.floor(lastTy.ty / 16) } },
    ], { saveOnExit: false });
    const reopened = single(boundaryWorld, { op: 'tile', args: { tx: lastTx, ty: lastTy.ty } });
    partialOk = Boolean(resultOf(boundaryRun, 3) && resultOf(boundaryRun, 3).edited === true
      && reopened.result && reopened.result.material === 'air');
    partialDetail = { tile: [lastTx, lastTy.ty], chunk: resultOf(boundaryRun, 3), reopened: reopened.result };
  }
  check('G24', 'a partial boundary chunk round-trips exactly', partialOk, partialDetail);

  // ---- G25..G28: corrupt, missing and version-changed progress
  const corrupt = makeWorld('mine-camp', 'a16-corrupt');
  const corruptTarget = findDiggable(referenceTerrain(corrupt.world.generation), 'stone');
  const corruptFeet = playerFeetForTile(corruptTarget.tx, corruptTarget.ty);
  runProbe(corrupt, [
    { op: 'set-position', args: { x: corruptFeet.x, y: corruptFeet.y } },
    { op: 'dig', args: { tx: corruptTarget.tx, ty: corruptTarget.ty, requestId: 'g25-dig' } },
    { op: 'save' },
  ], { saveOnExit: false });
  const corruptProgress = readProgress(corrupt);
  writeFileSync(corruptProgress.path, '{ this is not json');
  const corruptRun = runProbe(corrupt, [{ op: 'restore' }, { op: 'inventory' }], { saveOnExit: false });
  check('G25', 'a corrupt progress.json is rejected whole with an explicit reason and nothing is applied',
    corruptRun.response && corruptRun.response.ok === false
      && resultOf(corruptRun, 0) && resultOf(corruptRun, 0).ok === false
      && typeof resultOf(corruptRun, 0).reason === 'string'
      && resultOf(corruptRun, 1).stone === 0,
    { restore: resultOf(corruptRun, 0), inventory: resultOf(corruptRun, 1) });

  const corruptChunk = makeWorld('mine-camp', 'a16-chunk-corrupt');
  const ccTarget = findDiggable(referenceTerrain(corruptChunk.world.generation), 'stone');
  const ccFeet = playerFeetForTile(ccTarget.tx, ccTarget.ty);
  runProbe(corruptChunk, [
    { op: 'set-position', args: { x: ccFeet.x, y: ccFeet.y } },
    { op: 'dig', args: { tx: ccTarget.tx, ty: ccTarget.ty, requestId: 'g26-dig' } },
    { op: 'save' },
  ], { saveOnExit: false });
  const ccEntry = readProgress(corruptChunk).data.chunks[chunkIdOf(ccTarget.tx, ccTarget.ty)];
  const ccFile = join(chunksDir(corruptChunk), ccEntry.file);
  const ccText = readFileSync(ccFile, 'utf8');
  writeFileSync(ccFile, ccText.replace('"revision"', '"revisionXX"'));
  const ccRun = runProbe(corruptChunk, [{ op: 'restore' }], { saveOnExit: false });
  const ccReason = resultOf(ccRun, 0) && resultOf(ccRun, 0).reason;
  check('G26', 'a corrupt chunk file is rejected with chunk_corrupt or chunk_hash_mismatch',
    ['chunk_corrupt', 'chunk_hash_mismatch', 'missing_chunk'].includes(ccReason), { reason: ccReason });

  const missingChunk = makeWorld('mine-camp', 'a16-missing-chunk');
  const mcTarget = findDiggable(referenceTerrain(missingChunk.world.generation), 'stone');
  const mcFeet = playerFeetForTile(mcTarget.tx, mcTarget.ty);
  runProbe(missingChunk, [
    { op: 'set-position', args: { x: mcFeet.x, y: mcFeet.y } },
    { op: 'dig', args: { tx: mcTarget.tx, ty: mcTarget.ty, requestId: 'g27-dig' } },
    { op: 'save' },
  ], { saveOnExit: false });
  const mcEntry = readProgress(missingChunk).data.chunks[chunkIdOf(mcTarget.tx, mcTarget.ty)];
  rmSync(join(chunksDir(missingChunk), mcEntry.file), { force: true });
  const mcRun = runProbe(missingChunk, [{ op: 'restore' }], { saveOnExit: false });
  check('G27', 'an indexed but missing chunk file is rejected with missing_chunk',
    resultOf(mcRun, 0) && resultOf(mcRun, 0).reason === 'missing_chunk', { result: resultOf(mcRun, 0) });

  const versionWorld = makeWorld('mine-camp', 'a16-version');
  const vTarget = findDiggable(referenceTerrain(versionWorld.world.generation), 'stone');
  const vFeet = playerFeetForTile(vTarget.tx, vTarget.ty);
  runProbe(versionWorld, [
    { op: 'set-position', args: { x: vFeet.x, y: vFeet.y } },
    { op: 'dig', args: { tx: vTarget.tx, ty: vTarget.ty, requestId: 'g28-dig' } },
    { op: 'save' },
  ], { saveOnExit: false });
  const vProgress = readProgress(versionWorld);
  const vData = JSON.parse(vProgress.text);
  vData.state.stateVersion = 99;
  writeFileSync(vProgress.path, JSON.stringify(vData));
  const vRun = runProbe(versionWorld, [{ op: 'restore' }], { saveOnExit: false });
  const vReason = resultOf(vRun, 0) && resultOf(vRun, 0).reason;
  vData.state.stateVersion = 1;
  vData.state.format = 'craftmine.godot-mining-sandbox-state/0';
  writeFileSync(vProgress.path, JSON.stringify(vData));
  const fRun = runProbe(versionWorld, [{ op: 'restore' }], { saveOnExit: false });
  const fReason = resultOf(fRun, 0) && resultOf(fRun, 0).reason;
  check('G28', 'a changed stateVersion or format is rejected with bad_state_version / bad_format',
    ['bad_state_version', 'bad_version'].includes(vReason) && ['bad_format', 'bad_state'].includes(fReason),
    { versionReason: vReason, formatReason: fReason });

  // ---- G29: a real write failure
  const failWorld = makeWorld('mine-camp', 'a16-write-fail');
  const fTarget = findDiggable(referenceTerrain(failWorld.world.generation), 'stone');
  const fFeet = playerFeetForTile(fTarget.tx, fTarget.ty);
  runProbe(failWorld, [
    { op: 'set-position', args: { x: fFeet.x, y: fFeet.y } },
    { op: 'dig', args: { tx: fTarget.tx, ty: fTarget.ty, requestId: 'g29-dig' } },
    { op: 'save' },
  ], { saveOnExit: false });
  const goodSnapshot = snapshotOf(failWorld);
  const blocker = join(ROOT, 'g29-blocker');
  writeFileSync(blocker, 'not a directory');
  const failSave = single(failWorld, { op: 'save' }, { progressRoot: join(blocker, 'nested') });
  const reloaded = snapshotOf(failWorld);
  check('G29', 'a real write failure returns ok:false with a stage and the previous save stays loadable',
    failSave.result && failSave.result.ok === false && typeof failSave.result.stage === 'string'
      && reloaded && reloaded.terrainHash === goodSnapshot.terrainHash
      && JSON.stringify(reloaded.inventory) === JSON.stringify(goodSnapshot.inventory),
    { save: failSave.result, reloadedHash: reloaded && reloaded.terrainHash, expectedHash: goodSnapshot.terrainHash });

  // ---- G29b: a failure at the index stage must keep the previous commit loadable
  const indexWorld = makeWorld('mine-camp', 'a16-index-fail');
  const indexTerrain = referenceTerrain(indexWorld.world.generation);
  const iTarget = findDiggable(indexTerrain, 'stone');
  const iFeet = playerFeetForTile(iTarget.tx, iTarget.ty);
  const firstSave = runProbe(indexWorld, [
    { op: 'set-position', args: { x: iFeet.x, y: iFeet.y } },
    { op: 'dig', args: { tx: iTarget.tx, ty: iTarget.ty, requestId: 'g29b-dig-1' } },
    { op: 'save' },
  ], { saveOnExit: false });
  const afterFirst = snapshotOf(indexWorld);
  const indexDir = dirname(readProgress(indexWorld).path);
  // A directory at the index temp path makes the commit fail for real while the
  // previously committed progress.json and its chunks stay untouched.
  mkdirSync(join(indexDir, 'progress.json.tmp'), { recursive: true });
  const iSecond = findDiggable(indexTerrain, 'dirt');
  const iSecondFeet = playerFeetForTile(iSecond.tx, iSecond.ty);
  const secondSave = runProbe(indexWorld, [
    { op: 'set-position', args: { x: iSecondFeet.x, y: iSecondFeet.y } },
    { op: 'dig', args: { tx: iSecond.tx, ty: iSecond.ty, requestId: 'g29b-dig-2' } },
    { op: 'save' },
  ], { saveOnExit: false });
  rmSync(join(indexDir, 'progress.json.tmp'), { recursive: true, force: true });
  const reloadedAfterIndexFailure = snapshotOf(indexWorld);
  check('G29b', 'a failure at the index stage leaves the previous commit loadable',
    resultOf(firstSave, 2)?.ok === true
      && resultOf(secondSave, 2)?.ok === false && resultOf(secondSave, 2).stage === 'index'
      && reloadedAfterIndexFailure.terrainHash === afterFirst.terrainHash
      && JSON.stringify(reloadedAfterIndexFailure.inventory) === JSON.stringify(afterFirst.inventory),
    {
      first: resultOf(firstSave, 2),
      second: resultOf(secondSave, 2),
      reloaded: reloadedAfterIndexFailure && reloadedAfterIndexFailure.terrainHash,
      expected: afterFirst && afterFirst.terrainHash,
    });

  // ---- G30: no burying, and a saved overlap is rescued
  const rescue = makeWorld('mine-camp', 'a16-rescue', { inventory: [{ id: 'stone_brick', count: 2 }] });
  const rescueTerrain = referenceTerrain(rescue.world.generation);
  const rTarget = findDiggable(rescueTerrain, 'stone');
  const rFeet = playerFeetForTile(rTarget.tx, rTarget.ty);
  runProbe(rescue, [
    { op: 'set-position', args: { x: rFeet.x, y: rFeet.y } },
    { op: 'dig', args: { tx: rTarget.tx, ty: rTarget.ty, requestId: 'g30-dig' } },
    { op: 'save' },
  ], { saveOnExit: false });
  const rProgress = readProgress(rescue);
  const rData = JSON.parse(rProgress.text);
  const solidTile = { tx: rTarget.tx, ty: rTarget.ty + 2 };
  rData.state.player.tile = [solidTile.tx, solidTile.ty];
  rData.state.player.position = [solidTile.tx * 16 + 8, (solidTile.ty + 1) * 16];
  writeFileSync(rProgress.path, JSON.stringify(rData));
  const rescued = snapshotOf(rescue);
  check('G30', 'a saved overlap is rescued, reported, and the player is never inside a solid tile',
    rescued && rescued.rescue && rescued.rescue.resolved === true
      && rescued.player.tile[1] < solidTile.ty
      && rescued.physical.solidTilesInPlayerRect === 0,
    { rescue: rescued && rescued.rescue, player: rescued && rescued.player, physical: rescued && rescued.physical });

  // ---- G31: snapshot is read-only
  const ro = makeWorld('mine-camp', 'a16-readonly');
  const roTarget = findDiggable(referenceTerrain(ro.world.generation), 'stone');
  const roFeet = playerFeetForTile(roTarget.tx, roTarget.ty);
  const roRun = runProbe(ro, [
    { op: 'set-position', args: { x: roFeet.x, y: roFeet.y } },
    { op: 'dig', args: { tx: roTarget.tx, ty: roTarget.ty, requestId: 'g31-dig' } },
    { op: 'snapshot' },
    { op: 'snapshot' },
    { op: 'inventory' },
  ], { saveOnExit: false });
  const first = resultOf(roRun, 2);
  const second = resultOf(roRun, 3);
  check('G31', 'snapshot() is read-only: terrain hash, inventory and player do not change',
    first && second && first.terrainHash === second.terrainHash
      && JSON.stringify(first.inventory) === JSON.stringify(second.inventory)
      && JSON.stringify(first.player) === JSON.stringify(second.player),
    { first: first && { hash: first.terrainHash, inventory: first.inventory }, second: second && { hash: second.terrainHash, inventory: second.inventory } });

  // ---- G32: probe drives the real code path
  const probeSource = readFileSync(join(BASE, 'core', 'scripts', 'probe.gd'), 'utf8');
  const forbidden = [/FileAccess\.WRITE/g, /store_string\(/g, /"ok":\s*true/g, /save_store\s*=\s*/g];
  const writeSites = [...probeSource.matchAll(/FileAccess\.open\([^)]*,\s*FileAccess\.WRITE/g)].length;
  const opCalls = ['dig(', 'place(', 'craft(', 'save(', 'restore(', 'snapshot(', 'terrain_hash(', 'capture_managed(', 'restore_managed('];
  const opCoverage = opCalls.filter((call) => probeSource.includes(call));
  check('G32', 'probe ops call the real gameplay methods and the probe only writes its response file',
    opCoverage.length === opCalls.length && writeSites === 1 && !forbidden[2].test(probeSource),
    { opCoverage, writeSites, hasInlineOk: forbidden[2].test(probeSource) });

  // ---- G32b: a probe mutation is visible in the same run's finalSnapshot
  const visWorld = makeWorld('mine-camp', 'a16-visible', { inventory: [{ id: 'dirt', count: 2 }] });
  const visTerrain = referenceTerrain(visWorld.world.generation);
  const visTarget = findDiggable(visTerrain, 'stone');
  const visFeet = playerFeetForTile(visTarget.tx, visTarget.ty);
  const visibleRun = runProbe(visWorld, [
    { op: 'set-position', args: { x: visFeet.x, y: visFeet.y } },
    { op: 'dig', args: { tx: visTarget.tx, ty: visTarget.ty, requestId: 'g32-dig' } },
    { op: 'place', args: { tx: visTarget.tx, ty: visTarget.ty, materialId: 'dirt', requestId: 'g32-place' } },
  ], { saveOnExit: false });
  const visibleFinal = visibleRun.response && visibleRun.response.finalSnapshot;
  const visibleChunk = visibleFinal && visibleFinal.chunks[chunkIdOf(visTarget.tx, visTarget.ty)];
  check('G32b', 'a probe mutation is visible in the same run finalSnapshot',
    resultOf(visibleRun, 1)?.ok === true && resultOf(visibleRun, 2)?.ok === true
      && visibleChunk && Number(visibleChunk.cells) >= 1 && Number(visibleChunk.edited === true ? 1 : 0) === 1
      && visibleFinal.inventory.dirt === 1 && visibleFinal.inventory.stone === 1,
    { dig: resultOf(visibleRun, 1), place: resultOf(visibleRun, 2), chunk: visibleChunk, inventory: visibleFinal && visibleFinal.inventory });

  // ---- G33: build receipt
  const receipt = JSON.parse(readFileSync(join(BASE, 'worlds', 'mine-camp', 'world-build.json'), 'utf8'));
  const receiptDir = join(BASE, 'worlds', 'mine-camp');
  const receiptProblems = (receipt.files || []).filter((entry) => {
    const path = join(receiptDir, entry.path);
    return !existsSync(path) || statSync(path).size !== entry.bytes || sha256(readFileSync(path)) !== entry.sha256;
  });
  check('G33', 'world-build.json declares base id/version/protocols/engine and a valid SHA-256 per file',
    receipt.baseId === 'mining-sandbox' && receipt.baseVersion === MANIFEST.baseVersion
      && receipt.godotVersion === MANIFEST.godotVersion && receipt.progressFormat === MANIFEST.protocols.progressFormat
      && receipt.chunkFormat === MANIFEST.protocols.chunkFormat
      && (receipt.files || []).length > 0 && receiptProblems.length === 0,
    { baseId: receipt.baseId, files: (receipt.files || []).length, problems: receiptProblems });

  // ---- G34: declared reuse with real hashes
  const reusePath = join(BASE, 'docs', 'REUSE.md');
  const reuseText = existsSync(reusePath) ? readFileSync(reusePath, 'utf8') : '';
  const reuseSources = [...reuseText.matchAll(/`(desktop\/godot\/bases\/side-view\/[^`]+)`\s*\|\s*`([0-9a-f]{64})`/g)];
  const reuseProblems = reuseSources.filter((match) => {
    const path = join(REPO, match[1]);
    return !existsSync(path) || sha256(readFileSync(path)) !== match[2];
  });
  check('G34', 'manifest declares the side-view 1.0.0 reuse and docs/REUSE.md hashes match the real files',
    MANIFEST.reuses && MANIFEST.reuses.baseId === 'side-view' && MANIFEST.reuses.baseVersion === '1.0.0'
      && reuseSources.length >= 3 && reuseProblems.length === 0,
    { reuse: MANIFEST.reuses && MANIFEST.reuses.baseVersion, sources: reuseSources.length, problems: reuseProblems.map((match) => match[1]) });

  // ---- G35: the blank start really is blank
  const blankTemplate = JSON.parse(readFileSync(join(BASE, 'templates', 'blank', 'world.json.template'), 'utf8')
    .replace(/__([A-Z_]+)__/g, (match, key) => (key === 'WORLD_ID' ? 'template-check' : 'template-check')));
  check('G35', 'the blank template has an empty inventory, no recipes and no rewards',
    (blankTemplate.initialProgress.inventory || []).length === 0
      && (blankTemplate.recipes || []).length === 0
      && (blankTemplate.entities || []).length === 0
      && !blankTemplate.initialProgress.grantedRewards,
    { inventory: blankTemplate.initialProgress.inventory, recipes: blankTemplate.recipes });

  // ---- G36: the shared managed progress body carries the terrain
  const managed = makeWorld('mine-camp', 'a16-managed', { inventory: [{ id: 'stone_brick', count: 2 }] });
  const managedTerrain = referenceTerrain(managed.world.generation);
  const mTarget = findDiggable(managedTerrain, 'stone');
  const mFeet = playerFeetForTile(mTarget.tx, mTarget.ty);
  const captureRun = runProbe(managed, [
    { op: 'set-position', args: { x: mFeet.x, y: mFeet.y, facing: 'left' } },
    { op: 'dig', args: { tx: mTarget.tx, ty: mTarget.ty, requestId: 'g36-dig' } },
    { op: 'snapshot' },
    { op: 'capture-managed' },
  ], { saveOnExit: false });
  const capturedSnapshot = resultOf(captureRun, 2);
  const managedBody = resultOf(captureRun, 3)?.body;
  // Start the next processes from a clean progress root so the restore is what
  // changes the state, not a save left behind by the capture run.
  rmSync(managed.progressRoot, { recursive: true, force: true });
  mkdirSync(managed.progressRoot, { recursive: true });
  const tamperVariants = [
    ['unknown material', (body) => { body.chunks[Object.keys(body.chunks)[0]].cells[0][2] = 'unobtainium'; }],
    ['foreign world id', (body) => { body.worldId = 'someone-else'; }],
    ['wrong seed', (body) => { body.seed = 123456; }],
    ['wrong map size', (body) => { body.mapSize = [1, 1]; }],
    ['cell outside the map', (body) => { body.chunks[Object.keys(body.chunks)[0]].cells[0][0] = 9999; }],
    ['player tile outside the map', (body) => { body.state.player.tile = [9999, 9999]; }],
    ['unsupported state version', (body) => { body.stateVersion = 99; }],
  ];
  const tamperResults = [];
  for (const [name, mutate] of tamperVariants) {
    const body = JSON.parse(JSON.stringify(managedBody));
    mutate(body);
    rmSync(managed.progressRoot, { recursive: true, force: true });
    mkdirSync(managed.progressRoot, { recursive: true });
    const run = runProbe(managed, [
      { op: 'restore-managed', args: { body } },
      { op: 'snapshot' },
    ], { saveOnExit: false });
    tamperResults.push({
      name,
      rejected: Boolean(resultOf(run, 0) && resultOf(run, 0).ok === false),
      reason: resultOf(run, 0) && resultOf(run, 0).reason,
      hashAfter: resultOf(run, 1) && resultOf(run, 1).terrainHash,
    });
  }
  rmSync(managed.progressRoot, { recursive: true, force: true });
  mkdirSync(managed.progressRoot, { recursive: true });
  const restoreRun = runProbe(managed, [
    { op: 'restore-managed', args: { body: managedBody } },
    { op: 'snapshot' },
  ], { saveOnExit: false });
  const restored = resultOf(restoreRun, 1);
  check('G36', 'capture_managed / restore_managed round-trip state and terrain edits and reject every tampered body',
    managedBody && !managedBody.error && managedBody.format === 'craftmine.godot-mining-sandbox-managed/1'
      && Object.keys(managedBody.chunks).length >= 1
      && tamperResults.length === tamperVariants.length
      && tamperResults.every((entry) => entry.rejected && entry.hashAfter === managedTerrain.terrainHash)
      && resultOf(restoreRun, 0) && resultOf(restoreRun, 0).ok === true
      && restored && capturedSnapshot && restored.terrainHash === capturedSnapshot.terrainHash
      && JSON.stringify(restored.inventory) === JSON.stringify(capturedSnapshot.inventory)
      && JSON.stringify(restored.player.tile) === JSON.stringify(capturedSnapshot.player.tile),
    {
      bodyChunks: managedBody && Object.keys(managedBody.chunks || {}),
      tamperResults,
      generatedHash: managedTerrain.terrainHash,
      restored: restored && { hash: restored.terrainHash, inventory: restored.inventory, tile: restored.player.tile },
      captured: capturedSnapshot && { hash: capturedSnapshot.terrainHash, inventory: capturedSnapshot.inventory, tile: capturedSnapshot.player.tile },
    });

  // ---- G37/G38: stack limits are enforced, not decorative
  const stackWorld = makeWorld('mine-camp', 'a16-stack', {
    mutate: (world) => { world.items.find((item) => item.id === 'stone').stack = 2; },
  });
  const stackTerrain = referenceTerrain(stackWorld.world.generation);
  const stoneTiles = [];
  for (let ty = 4; ty < stackTerrain.height - 2 && stoneTiles.length < 3; ty += 1) {
    for (let tx = 2; tx < stackTerrain.width - 2 && stoneTiles.length < 3; tx += 1) {
      if (stackTerrain.get(tx, ty) === 'stone'
        && stackTerrain.get(tx, ty - 1) === 'air' && stackTerrain.get(tx, ty - 2) === 'air') {
        stoneTiles.push({ tx, ty });
      }
    }
  }
  const stackCommands = [];
  for (const [index, tile] of stoneTiles.entries()) {
    const feet = playerFeetForTile(tile.tx, tile.ty);
    stackCommands.push({ op: 'set-position', args: { x: feet.x, y: feet.y } });
    stackCommands.push({ op: 'dig', args: { tx: tile.tx, ty: tile.ty, requestId: `g37-dig-${index}` } });
  }
  stackCommands.push({ op: 'inventory' });
  const stackRun = runProbe(stackWorld, stackCommands, { saveOnExit: false });
  const stackDrops = stoneTiles.map((_, index) => resultOf(stackRun, index * 2 + 1)?.dropped);
  const stackInventory = resultOf(stackRun, stackCommands.length - 1);
  check('G37', 'a grant beyond the declared stack caps at the limit and reports overflow',
    stackDrops.length === 3
      && stackDrops[0]?.count === 1 && stackDrops[0]?.overflow === undefined
      && stackDrops[1]?.count === 1
      && stackDrops[2]?.overflow === 1 && stackDrops[2]?.count === 0
      && stackInventory?.stone === 2,
    { drops: stackDrops, inventory: stackInventory });

  const stackCraft = makeWorld('mine-camp', 'a16-stack-craft', {
    inventory: [{ id: 'stone', count: 2 }, { id: 'stone_brick', count: 1 }],
    mutate: (world) => { world.items.find((item) => item.id === 'stone_brick').stack = 1; },
  });
  const craftFull = single(stackCraft, { op: 'craft', args: { recipeId: 'stone-brick', requestId: 'g38-craft' } }, { saveOnExit: false });
  const craftFullInventory = single(stackCraft, { op: 'inventory' }, { saveOnExit: false });
  check('G38', 'a craft whose output stack is full is rejected with stack_full and consumes nothing',
    craftFull.result?.reason === 'stack_full'
      && craftFullInventory.result?.stone === 2 && craftFullInventory.result?.stone_brick === 1,
    { craft: craftFull.result, inventory: craftFullInventory.result });

  // ---- G39: a fully reverted chunk keeps its revision and leaves no file
  const revert = makeWorld('mine-camp', 'a16-revert');
  const revertTerrain = referenceTerrain(revert.world.generation);
  const revertTarget = findDiggable(revertTerrain, 'stone');
  const revertFeet = playerFeetForTile(revertTarget.tx, revertTarget.ty);
  const revertChunk = { cx: Math.floor(revertTarget.tx / 16), cy: Math.floor(revertTarget.ty / 16) };
  const revertRun = runProbe(revert, [
    { op: 'set-position', args: { x: revertFeet.x, y: revertFeet.y } },
    { op: 'dig', args: { tx: revertTarget.tx, ty: revertTarget.ty, requestId: 'g39-dig' } },
    { op: 'place', args: { tx: revertTarget.tx, ty: revertTarget.ty, materialId: 'stone', requestId: 'g39-place' } },
    { op: 'chunk', args: revertChunk },
    { op: 'save' },
  ], { saveOnExit: false });
  const revertedChunk = resultOf(revertRun, 3);
  const revertEntry = readProgress(revert).data.chunks[chunkIdOf(revertTarget.tx, revertTarget.ty)];
  const revertChunkFiles = existsSync(chunksDir(revert)) ? readdirSync(chunksDir(revert)) : [];
  const revertedAfterRestart = single(revert, { op: 'chunk', args: revertChunk }).result;
  check('G39', 'a chunk whose edits are all reverted keeps its revision and leaves no file',
    revertedChunk && revertedChunk.edited === false && revertedChunk.revision === 2 && revertedChunk.cells === 0
      && revertEntry && revertEntry.revision === 2 && revertEntry.file === '' && revertEntry.cells === 0
      && !revertChunkFiles.some((name) => name.startsWith(`${chunkIdOf(revertTarget.tx, revertTarget.ty)}.`))
      && revertedAfterRestart && revertedAfterRestart.edited === false && revertedAfterRestart.revision === 2,
    { before: revertedChunk, index: revertEntry, files: revertChunkFiles, after: revertedAfterRestart });

  // ---- G40/G41: the observation surface and the source/play-state boundary
  const savedChunks = saved.snapshot.chunks;
  const restartedChunks = after.chunks;
  check('G40', 'snapshot.chunks[].sha256 is identical before and after a restart',
    Object.keys(savedChunks).length > 0
      && Object.entries(savedChunks).every(([id, entry]) => restartedChunks[id] && restartedChunks[id].sha256 === entry.sha256),
    { saved: savedChunks, restarted: restartedChunks });

  const walkWorld = (dir) => {
    const found = [];
    const visit = (current) => {
      for (const name of readdirSync(current)) {
        const full = join(current, name);
        if (statSync(full).isDirectory()) visit(full);
        else found.push(full.slice(persist.dir.length + 1).replace(/\\/g, '/'));
      }
    };
    visit(dir);
    return found;
  };
  const worldFiles = walkWorld(persist.dir);
  check('G41', 'after a save the world project contains no progress or chunk files',
    worldFiles.length > 0
      && !worldFiles.some((name) => name.endsWith('progress.json') || name.includes('progress.json.') || name.startsWith('chunks/'))
      && !persist.progressRoot.startsWith(`${persist.dir}/`) && !persist.progressRoot.startsWith(`${persist.dir}\\`),
    { progressLike: worldFiles.filter((name) => name.includes('progress') || name.includes('chunk')), count: worldFiles.length });
}

let failure = null;
try {
  run();
} catch (error) {
  failure = error;
  results.push({ id: 'HARNESS', description: 'harness crashed', ok: false, detail: { message: error.message, stack: error.stack } });
  process.stderr.write(`HARNESS FAILURE: ${error.message}\n${error.stack}\n`);
}

const passed = results.filter((entry) => entry.ok).length;
const failed = results.filter((entry) => !entry.ok);
const report = {
  format: 'craftmine.mining-sandbox-a16-report/1',
  base: MANIFEST.baseId,
  baseVersion: MANIFEST.baseVersion,
  godot: GODOT,
  startedAt: new Date().toISOString(),
  tempRoot: ROOT,
  kept: KEEP,
  total: results.length,
  passed,
  failed: failed.map((entry) => entry.id),
  results,
};
log('report.json', report);
process.stdout.write(`\nA16 acceptance: ${passed}/${results.length} passed\n`);
if (failed.length > 0) {
  process.stdout.write(`failed: ${failed.map((entry) => entry.id).join(', ')}\n`);
}

if (!KEEP) {
  rmSync(ROOT, { recursive: true, force: true });
} else {
  process.stdout.write(`temp worlds kept at ${ROOT}\n`);
}

if (failure || failed.length > 0) process.exit(1);
