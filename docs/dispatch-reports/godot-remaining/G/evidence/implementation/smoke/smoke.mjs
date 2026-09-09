#!/usr/bin/env node
// G runtime smoke: drives the mining-sandbox base through the real probe only.
// Every world is created in a private temp directory with a private progress
// root. No OS input, no window, no pointer lock.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.CRAFTMINE_MINING_SANDBOX_BASE
  || 'D:/Craftmine World-worktrees/godot-remaining-g-20260910/desktop/godot/bases/mining-sandbox';
const GODOT = process.env.CRAFTMINE_GODOT_BIN;
const EVIDENCE = join(HERE, 'evidence');
const ROOT = mkdtempSync(join(HERE, 'smoke-'));
const PARAMS = JSON.parse(readFileSync(join(BASE, 'params', 'mining_sandbox_params.json'), 'utf8'));

const results = [];
let runCounter = 0;

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

// --- independent reference terrain (mirrors docs/SPEC.md section 2) --------

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
      if (direction === 0) cx += 1; else if (direction === 1) cx -= 1; else if (direction === 2) cy += 1; else cy -= 1;
      if (cx < 0 || cy < 0 || cx >= width || cy >= height) return;
    }
  };
  (generation.ores || []).forEach((ore, oreIndex) => {
    const salt = seed ^ ((oreIndex + 1) * 7919);
    const veinSalt = seed ^ ((oreIndex + 1) * 104729);
    for (let ty = ore.minRow; ty <= Math.min(ore.maxRow, height - 1); ty += 1) {
      if (ty >= height - generation.bedrockRows) continue;
      for (let tx = 0; tx < width; tx += 1) {
        if (!ore.hostMaterials.includes(get(tx, ty))) continue;
        if (hash3(tx, ty, salt) % 1000 < ore.chancePerMille) growVein(tx, ty, ore.material, ore.veinSize, veinSalt, ore.hostMaterials);
      }
    }
  });
  const caves = generation.caves || { chancePerMille: 0 };
  if (caves.chancePerMille > 0) {
    const salt = seed ^ 0x5EED;
    const veinSalt = seed ^ 0xCA7E;
    for (let ty = caves.minRow; ty <= Math.min(caves.maxRow, height - 1); ty += 1) {
      if (ty >= height - generation.bedrockRows) continue;
      for (let tx = 0; tx < width; tx += 1) {
        const current = get(tx, ty);
        if (current === 'air' || current === 'bedrock') continue;
        if (hash3(tx, ty, salt) % 1000 >= caves.chancePerMille) continue;
        let cx = tx;
        let cy = ty;
        for (let step = 0; step < caves.veinSize; step += 1) {
          if (cy <= surfaceRow(cx) || cy >= height - generation.bedrockRows) break;
          if (get(cx, cy) !== 'bedrock' && get(cx, cy) !== null) set(cx, cy, 'air');
          const direction = hash3(cx, cy, veinSalt) % 4;
          if (direction === 0) cx += 1; else if (direction === 1) cx -= 1; else if (direction === 2) cy += 1; else cy -= 1;
          if (cx < 0 || cy < 0 || cx >= width || cy >= height) break;
        }
      }
    }
  }
  const entries = [];
  for (let ty = 0; ty < height; ty += 1) for (let tx = 0; tx < width; tx += 1) entries.push(`${tx},${ty},${get(tx, ty)}`);
  return { width, height, get, surfaceRow, terrainHash: createHash('sha256').update(entries.join('\n')).digest('hex') };
}

// --- helpers --------------------------------------------------------------

function makeWorld(template, worldId, options = {}) {
  const out = join(ROOT, worldId);
  const create = spawnSync(process.execPath, [join(BASE, 'tools', 'new-world.mjs'), '--template', template, '--world-id', worldId, '--name', options.name || worldId, '--out', out], { encoding: 'utf8' });
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
  log(`${worldId}-import.log`, `exit=${imported.status}\n${imported.stdout}\n${imported.stderr}\n`);
  return { dir: out, world, progressRoot, worldId };
}

function runProbe(world, commands, options = {}) {
  runCounter += 1;
  const tag = `${world.worldId}-${String(runCounter).padStart(3, '0')}`;
  const reqPath = join(ROOT, `${tag}-req.json`);
  const resPath = join(ROOT, `${tag}-res.json`);
  const request = { format: 'craftmine.godot-mining-sandbox-probe/1', commands };
  if (options.saveOnExit !== undefined) request.saveOnExit = options.saveOnExit;
  writeFileSync(reqPath, `${JSON.stringify(request, null, 2)}\n`);
  const env = { ...process.env, CRAFTMINE_MINING_SANDBOX_PROGRESS_ROOT: options.progressRoot || world.progressRoot };
  const run = spawnSync(GODOT, ['--headless', '--path', world.dir, '--', '--probe', `--probe-request=${reqPath}`, `--probe-response=${resPath}`], { encoding: 'utf8', timeout: 180000, env });
  let response = null;
  if (existsSync(resPath)) {
    try { response = JSON.parse(readFileSync(resPath, 'utf8')); } catch (error) { response = { ok: false, error: `response not JSON: ${error.message}` }; }
  }
  log(`${tag}.log`, [`exit=${run.status}`, `request=${JSON.stringify(request)}`, `response=${JSON.stringify(response)}`, '--- stdout ---', run.stdout || '', '--- stderr ---', run.stderr || ''].join('\n'));
  return { exitCode: run.status, response, stdout: run.stdout || '', stderr: run.stderr || '' };
}

const resultOf = (probe, index) => (probe.response && Array.isArray(probe.response.results) && probe.response.results[index] ? probe.response.results[index].result : null);
function single(world, command, options) {
  const probe = runProbe(world, [command], options);
  return { probe, result: resultOf(probe, 0), snapshot: probe.response && probe.response.finalSnapshot };
}
const snapshotOf = (world, options) => { const probe = runProbe(world, [{ op: 'snapshot' }], options); return probe.response && probe.response.finalSnapshot; };
const playerFeetForTile = (tx, ty) => ({ x: tx * PARAMS.grid.tileSize + PARAMS.grid.tileSize / 2, y: ty * PARAMS.grid.tileSize });
const chunkIdOf = (tx, ty) => `${Math.floor(tx / PARAMS.grid.chunkTiles[0])}_${Math.floor(ty / PARAMS.grid.chunkTiles[1])}`;

function findTile(terrain, predicate, fromRow = 2) {
  for (let ty = fromRow; ty < terrain.height; ty += 1) for (let tx = 2; tx < terrain.width - 2; tx += 1) if (predicate(terrain, tx, ty)) return { tx, ty };
  return null;
}
const findDiggable = (terrain, material) => findTile(terrain, (t, tx, ty) => t.get(tx, ty) === material && t.get(tx, ty - 1) === 'air' && t.get(tx, ty - 2) === 'air');

const progressFile = (world, progressRoot = world.progressRoot) => join(progressRoot, 'worlds', createHash('sha256').update(world.worldId).digest('hex'), 'progress.json');
const chunksDir = (world, progressRoot = world.progressRoot) => join(progressRoot, 'worlds', createHash('sha256').update(world.worldId).digest('hex'), 'chunks');
const readProgress = (world, progressRoot) => { const path = progressFile(world, progressRoot); return existsSync(path) ? { path, text: readFileSync(path, 'utf8'), data: JSON.parse(readFileSync(path, 'utf8')) } : null; };

// --- scenarios ------------------------------------------------------------

function run() {
  if (!existsSync(GODOT)) throw new Error(`Godot binary not found: ${GODOT}`);
  log('environment.json', { godot: GODOT, base: BASE, tempRoot: ROOT, startedAt: new Date().toISOString() });

  // S01/S02/S03: deterministic generation, engine vs independent reference
  const genA = makeWorld('blank', 'smoke-gen-a', { seed: 424242 });
  const genB = makeWorld('blank', 'smoke-gen-b', { seed: 424242 });
  const genC = makeWorld('blank', 'smoke-gen-c', { seed: 999999 });
  const terrainA = referenceTerrain(genA.world.generation);
  const terrainC = referenceTerrain(genC.world.generation);
  const hashA = single(genA, { op: 'hash' }).result;
  const hashB = single(genB, { op: 'hash' }).result;
  const hashC = single(genC, { op: 'hash' }).result;
  check('S01', 'same generation block -> same terrainHash', hashA && hashB && hashA.hash === hashB.hash && hashA.hash === terrainA.terrainHash, { hashA: hashA && hashA.hash, hashB: hashB && hashB.hash, reference: terrainA.terrainHash });
  check('S02', 'different seed -> different terrainHash', hashC && hashC.hash !== hashA.hash && hashC.hash === terrainC.terrainHash, { hashC: hashC && hashC.hash, reference: terrainC.terrainHash });

  const sampleTiles = [];
  for (let ty = 0; ty < terrainA.height; ty += 3) for (let tx = 0; tx < terrainA.width; tx += 5) sampleTiles.push([tx, ty]);
  const sampleProbe = runProbe(genA, sampleTiles.map(([tx, ty]) => ({ op: 'tile', args: { tx, ty } })));
  const mismatches = sampleTiles.filter(([tx, ty], i) => { const r = resultOf(sampleProbe, i); return !r || r.material !== terrainA.get(tx, ty); });
  check('S03', 'engine terrain matches the independent JS reference on a sampled grid', mismatches.length === 0, { sampled: sampleTiles.length, mismatches: mismatches.slice(0, 6) });

  // S04: chunk mapping interior / edge / partial
  const edge = runProbe(genA, [
    { op: 'tile', args: { tx: 0, ty: 0 } },
    { op: 'tile', args: { tx: 47, ty: 23 } },
    { op: 'tile', args: { tx: 16, ty: 16 } },
    { op: 'tile', args: { tx: 32, ty: 17 } },
  ]);
  const edgeChunks = [0, 1, 2, 3].map((i) => resultOf(edge, i) && resultOf(edge, i).chunk);
  check('S04', 'tile-to-chunk mapping is <tx/16>_<ty/16> for interior, edge and partial tiles',
    edgeChunks[0] === '0_0' && edgeChunks[1] === '2_1' && edgeChunks[2] === '1_1' && edgeChunks[3] === '2_1', { edgeChunks });

  // S05..S11: dig rules on the example world
  const mine = makeWorld('mine-camp', 'smoke-dig');
  const terrain = referenceTerrain(mine.world.generation);
  const stone = findDiggable(terrain, 'stone');
  const coal = findDiggable(terrain, 'coal_ore');
  const bedrock = findTile(terrain, (t, tx, ty) => t.get(tx, ty) === 'bedrock' && t.get(tx, ty - 1) === 'air');
  const feet = playerFeetForTile(stone.tx, stone.ty);
  const digFlow = runProbe(mine, [
    { op: 'set-position', args: { x: feet.x, y: feet.y, facing: 'right' } },
    { op: 'inventory' },
    { op: 'dig', args: { tx: stone.tx, ty: stone.ty, requestId: 's05-dig' } },
    { op: 'tile', args: { tx: stone.tx, ty: stone.ty } },
    { op: 'inventory' },
    { op: 'chunk', args: { cx: Math.floor(stone.tx / 16), cy: Math.floor(stone.ty / 16) } },
  ], { saveOnExit: false });
  const digResult = resultOf(digFlow, 2);
  const beforeStone = resultOf(digFlow, 1);
  const afterStone = resultOf(digFlow, 4);
  check('S05', 'legal dig removes the tile, bumps the chunk revision and grants exactly one drop',
    digResult && digResult.ok === true && resultOf(digFlow, 3).material === 'air' && afterStone.stone === beforeStone.stone + 1 && resultOf(digFlow, 5).revision >= 1,
    { digResult, tile: resultOf(digFlow, 3), before: beforeStone, after: afterStone, chunk: resultOf(digFlow, 5) });

  const far = runProbe(mine, [
    { op: 'set-position', args: { x: feet.x, y: 4 } },
    { op: 'dig', args: { tx: stone.tx + 1, ty: stone.ty, requestId: 's06-dig' } },
    { op: 'inventory' },
    { op: 'hash' },
  ], { saveOnExit: false });
  check('S06', 'dig beyond reachTiles -> out_of_range, nothing changes',
    resultOf(far, 1) && resultOf(far, 1).reason === 'out_of_range' && resultOf(far, 2).stone === afterStone.stone && resultOf(far, 3).hash === digFlow.response.finalSnapshot.terrainHash,
    { result: resultOf(far, 1), inventory: resultOf(far, 2) });

  const airTile = { tx: stone.tx, ty: 2 };
  const airDig = runProbe(mine, [
    { op: 'set-position', args: { x: playerFeetForTile(airTile.tx, airTile.ty).x, y: playerFeetForTile(airTile.tx, airTile.ty).y } },
    { op: 'dig', args: { tx: airTile.tx, ty: airTile.ty, requestId: 's07-dig' } },
  ], { saveOnExit: false });
  check('S07', 'digging air -> not_solid', resultOf(airDig, 1) && resultOf(airDig, 1).reason === 'not_solid', { result: resultOf(airDig, 1) });

  const bedrockDig = runProbe(mine, [
    { op: 'set-position', args: { x: playerFeetForTile(bedrock.tx, bedrock.ty).x, y: playerFeetForTile(bedrock.tx, bedrock.ty).y } },
    { op: 'dig', args: { tx: bedrock.tx, ty: bedrock.ty, requestId: 's08-dig' } },
  ], { saveOnExit: false });
  check('S08', 'digging bedrock -> unbreakable', resultOf(bedrockDig, 1) && resultOf(bedrockDig, 1).reason === 'unbreakable', { result: resultOf(bedrockDig, 1) });

  const tierDig = runProbe(mine, [
    { op: 'set-position', args: { x: playerFeetForTile(coal.tx, coal.ty).x, y: playerFeetForTile(coal.tx, coal.ty).y } },
    { op: 'dig', args: { tx: coal.tx, ty: coal.ty, requestId: 's09-dig' } },
  ], { saveOnExit: false });
  check('S09', 'digging above the equipped tool tier -> tool_tier_too_low', resultOf(tierDig, 1) && resultOf(tierDig, 1).reason === 'tool_tier_too_low', { result: resultOf(tierDig, 1) });

  const duplicate = runProbe(mine, [
    { op: 'set-position', args: { x: feet.x, y: feet.y } },
    { op: 'dig', args: { tx: stone.tx, ty: stone.ty, requestId: 's05-dig' } },
    { op: 'inventory' },
  ], { saveOnExit: false });
  check('S10', 'replaying a dig requestId after a restart -> duplicate, no second drop',
    resultOf(duplicate, 1) && resultOf(duplicate, 1).ok === true && resultOf(duplicate, 1).duplicate === true && resultOf(duplicate, 2).stone === afterStone.stone,
    { result: resultOf(duplicate, 1), inventory: resultOf(duplicate, 2) });

  const cancelWorld = makeWorld('mine-camp', 'smoke-cancel');
  const cancelTarget = findDiggable(referenceTerrain(cancelWorld.world.generation), 'stone');
  const cancelled = runProbe(cancelWorld, [
    { op: 'set-position', args: { x: playerFeetForTile(cancelTarget.tx, cancelTarget.ty).x, y: playerFeetForTile(cancelTarget.tx, cancelTarget.ty).y } },
    { op: 'cancel', args: { requestId: 's11-dig' } },
    { op: 'dig', args: { tx: cancelTarget.tx, ty: cancelTarget.ty, requestId: 's11-dig' } },
    { op: 'tile', args: { tx: cancelTarget.tx, ty: cancelTarget.ty } },
    { op: 'inventory' },
  ], { saveOnExit: false });
  check('S11', 'cancelled requestId -> cancelled_request, nothing applied',
    resultOf(cancelled, 2) && resultOf(cancelled, 2).reason === 'cancelled_request' && resultOf(cancelled, 3).material === 'stone' && resultOf(cancelled, 4).stone === 0,
    { result: resultOf(cancelled, 2), tile: resultOf(cancelled, 3), inventory: resultOf(cancelled, 4) });

  // S12..S17: place rules
  const place = makeWorld('mine-camp', 'smoke-place', { inventory: [{ id: 'stone_brick', count: 20 }, { id: 'dirt', count: 20 }] });
  const placeTerrain = referenceTerrain(place.world.generation);
  const placeTarget = findTile(placeTerrain, (t, tx, ty) => t.get(tx, ty) === 'air' && t.get(tx, ty - 1) === 'air' && t.get(tx, ty + 1) !== 'air' && t.get(tx, ty + 1) !== null);
  const placeFlow = runProbe(place, [
    { op: 'set-position', args: { x: playerFeetForTile(placeTarget.tx, placeTarget.ty - 2).x, y: playerFeetForTile(placeTarget.tx, placeTarget.ty - 2).y } },
    { op: 'place', args: { tx: placeTarget.tx, ty: placeTarget.ty, materialId: 'stone_brick', requestId: 's12-place' } },
    { op: 'tile', args: { tx: placeTarget.tx, ty: placeTarget.ty } },
    { op: 'inventory' },
  ], { saveOnExit: false });
  check('S12', 'legal place consumes exactly one item and sets the tile',
    resultOf(placeFlow, 1) && resultOf(placeFlow, 1).ok === true && resultOf(placeFlow, 2).material === 'stone_brick' && resultOf(placeFlow, 3).stone_brick === 19,
    { result: resultOf(placeFlow, 1), tile: resultOf(placeFlow, 2), inventory: resultOf(placeFlow, 3) });

  const nextAir = findTile(placeTerrain, (t, tx, ty) => t.get(tx, ty) === 'air' && t.get(tx, ty + 1) !== 'air' && Math.abs(tx - placeTarget.tx) + Math.abs(ty - placeTarget.ty) > 4);
  const noMaterial = runProbe(place, [
    { op: 'set-position', args: { x: playerFeetForTile(nextAir.tx, nextAir.ty - 2).x, y: playerFeetForTile(nextAir.tx, nextAir.ty - 2).y } },
    { op: 'place', args: { tx: nextAir.tx, ty: nextAir.ty, materialId: 'iron_ingot', requestId: 's13-place' } },
    { op: 'tile', args: { tx: nextAir.tx, ty: nextAir.ty } },
  ], { saveOnExit: false });
  check('S13', 'placing a material that is not held/placeable -> insufficient_materials or material_not_placeable',
    resultOf(noMaterial, 1) && ['insufficient_materials', 'material_not_placeable'].includes(resultOf(noMaterial, 1).reason) && resultOf(noMaterial, 2).material === 'air',
    { result: resultOf(noMaterial, 1), tile: resultOf(noMaterial, 2) });

  const occupied = runProbe(place, [
    { op: 'set-position', args: { x: playerFeetForTile(placeTarget.tx, placeTarget.ty - 2).x, y: playerFeetForTile(placeTarget.tx, placeTarget.ty - 2).y } },
    { op: 'place', args: { tx: placeTarget.tx, ty: placeTarget.ty, materialId: 'stone_brick', requestId: 's14-place' } },
    { op: 'inventory' },
  ], { saveOnExit: false });
  check('S14', 'placing into a non-air tile -> cell_occupied, consumes nothing',
    resultOf(occupied, 1) && resultOf(occupied, 1).reason === 'cell_occupied' && resultOf(occupied, 2).stone_brick === 19,
    { result: resultOf(occupied, 1), inventory: resultOf(occupied, 2) });

  const outOfReach = runProbe(place, [
    { op: 'set-position', args: { x: nextAir.tx * 16 + 8, y: 4 } },
    { op: 'place', args: { tx: nextAir.tx, ty: nextAir.ty, materialId: 'stone_brick', requestId: 's15-place' } },
    { op: 'inventory' },
  ], { saveOnExit: false });
  check('S15', 'placing beyond reachTiles -> out_of_range, consumes nothing',
    resultOf(outOfReach, 1) && resultOf(outOfReach, 1).reason === 'out_of_range' && resultOf(outOfReach, 2).stone_brick === 19,
    { result: resultOf(outOfReach, 1), inventory: resultOf(outOfReach, 2) });

  const bury = runProbe(place, [
    { op: 'set-position', args: { x: nextAir.tx * 16 + 8, y: nextAir.ty * 16 } },
    { op: 'place', args: { tx: nextAir.tx, ty: nextAir.ty - 1, materialId: 'stone_brick', requestId: 's16-place' } },
    { op: 'tile', args: { tx: nextAir.tx, ty: nextAir.ty - 1 } },
    { op: 'snapshot' },
  ], { saveOnExit: false });
  check('S16', 'placing into the player body -> would_bury_player, player rect stays clear',
    resultOf(bury, 1) && resultOf(bury, 1).reason === 'would_bury_player' && resultOf(bury, 2).material === 'air' && resultOf(bury, 3).physical.solidTilesInPlayerRect === 0,
    { result: resultOf(bury, 1), tile: resultOf(bury, 2), physical: resultOf(bury, 3) && resultOf(bury, 3).physical });

  const floating = findTile(placeTerrain, (t, tx, ty) => t.get(tx, ty) === 'air' && t.get(tx + 1, ty) === 'air' && t.get(tx - 1, ty) === 'air' && t.get(tx, ty + 1) === 'air' && t.get(tx, ty - 1) === 'air' && ty > 2 && ty < 6);
  const notAdjacent = runProbe(place, [
    { op: 'set-position', args: { x: floating.tx * 16 + 8, y: (floating.ty + 2) * 16 } },
    { op: 'place', args: { tx: floating.tx, ty: floating.ty, materialId: 'stone_brick', requestId: 's17-place' } },
    { op: 'tile', args: { tx: floating.tx, ty: floating.ty } },
  ], { saveOnExit: false });
  check('S17', 'placing without a non-air neighbour -> not_adjacent',
    resultOf(notAdjacent, 1) && resultOf(notAdjacent, 1).reason === 'not_adjacent' && resultOf(notAdjacent, 2).material === 'air',
    { result: resultOf(notAdjacent, 1), tile: resultOf(notAdjacent, 2) });

  // S18..S20: crafting
  const craft = makeWorld('mine-camp', 'smoke-craft', { inventory: [{ id: 'stone', count: 4 }, { id: 'wood', count: 4 }, { id: 'iron_ore', count: 3 }, { id: 'coal', count: 1 }] });
  const craftFlow = runProbe(craft, [
    { op: 'craft', args: { recipeId: 'stone-pickaxe', requestId: 's18-craft' } },
    { op: 'inventory' },
  ], { saveOnExit: false });
  check('S18', 'legal craft consumes every input and grants the output once',
    resultOf(craftFlow, 0) && resultOf(craftFlow, 0).ok === true && resultOf(craftFlow, 1).stone === 1 && resultOf(craftFlow, 1).wood === 2 && resultOf(craftFlow, 1).stone_pickaxe === 1,
    { result: resultOf(craftFlow, 0), inventory: resultOf(craftFlow, 1) });

  const insufficient = runProbe(craft, [
    { op: 'craft', args: { recipeId: 'iron-pickaxe', requestId: 's19-craft' } },
    { op: 'inventory' },
  ], { saveOnExit: false });
  check('S19', 'craft with missing inputs -> insufficient_materials/missing_station/out_of_range, consumes nothing',
    resultOf(insufficient, 0) && ['insufficient_materials', 'missing_station', 'out_of_range'].includes(resultOf(insufficient, 0).reason) && resultOf(insufficient, 1).stone === 1,
    { result: resultOf(insufficient, 0), inventory: resultOf(insufficient, 1) });

  const station = craft.world.entities.find((e) => e.id === 'camp-forge');
  const stationCraft = runProbe(craft, [
    { op: 'set-position', args: { x: station.tile[0] * 16 + 8, y: (station.tile[1] + 1) * 16 } },
    { op: 'craft', args: { recipeId: 'iron-ingot', requestId: 's20-craft' } },
    { op: 'inventory' },
    { op: 'craft', args: { recipeId: 'iron-ingot', requestId: 's20-craft' } },
    { op: 'inventory' },
  ], { saveOnExit: false });
  check('S20', 'replaying a craft requestId consumes nothing a second time',
    resultOf(stationCraft, 1) && resultOf(stationCraft, 1).ok === true && resultOf(stationCraft, 2).iron_ingot === 1 && resultOf(stationCraft, 3) && resultOf(stationCraft, 3).duplicate === true && resultOf(stationCraft, 4).iron_ore === 0 && resultOf(stationCraft, 4).iron_ingot === 1,
    { first: resultOf(stationCraft, 1), afterFirst: resultOf(stationCraft, 2), replay: resultOf(stationCraft, 3), afterReplay: resultOf(stationCraft, 4) });

  // S21..S24: persistence
  const persist = makeWorld('mine-camp', 'smoke-persist', { inventory: [{ id: 'wood', count: 6 }, { id: 'stone_brick', count: 4 }] });
  const persistTerrain = referenceTerrain(persist.world.generation);
  const firstTarget = findDiggable(persistTerrain, 'stone');
  const secondTarget = findDiggable(persistTerrain, 'dirt');
  const thirdTarget = findTile(persistTerrain, (t, tx, ty) => t.get(tx, ty) === 'stone' && chunkIdOf(tx, ty) !== chunkIdOf(firstTarget.tx, firstTarget.ty) && t.get(tx, ty - 1) === 'air' && t.get(tx, ty - 2) === 'air');
  const session = runProbe(persist, [
    { op: 'set-position', args: { x: playerFeetForTile(firstTarget.tx, firstTarget.ty).x, y: playerFeetForTile(firstTarget.tx, firstTarget.ty).y, facing: 'left' } },
    { op: 'dig', args: { tx: firstTarget.tx, ty: firstTarget.ty, requestId: 's21-dig-1' } },
    { op: 'set-position', args: { x: playerFeetForTile(secondTarget.tx, secondTarget.ty).x, y: playerFeetForTile(secondTarget.tx, secondTarget.ty).y } },
    { op: 'dig', args: { tx: secondTarget.tx, ty: secondTarget.ty, requestId: 's21-dig-2' } },
    { op: 'set-position', args: { x: playerFeetForTile(thirdTarget.tx, thirdTarget.ty).x, y: playerFeetForTile(thirdTarget.tx, thirdTarget.ty).y } },
    { op: 'dig', args: { tx: thirdTarget.tx, ty: thirdTarget.ty, requestId: 's21-dig-3' } },
    { op: 'craft', args: { recipeId: 'stone-brick', requestId: 's21-craft' } },
    { op: 'set-position', args: { x: playerFeetForTile(firstTarget.tx, firstTarget.ty - 2).x, y: playerFeetForTile(firstTarget.tx, firstTarget.ty - 2).y } },
    { op: 'place', args: { tx: firstTarget.tx, ty: firstTarget.ty, materialId: 'stone_brick', requestId: 's21-place' } },
    { op: 'snapshot' },
    { op: 'save' },
  ], { saveOnExit: false });
  const before = resultOf(session, 9);
  const saved = resultOf(session, 10);
  const after = snapshotOf(persist);
  check('S21', 'dig + craft + place, save, restart: terrainHash, inventory, tools and player tile are identical',
    before && after && saved && saved.ok === true && before.terrainHash === after.terrainHash && JSON.stringify(before.inventory) === JSON.stringify(after.inventory) && JSON.stringify(before.tools) === JSON.stringify(after.tools) && JSON.stringify(before.player.tile) === JSON.stringify(after.player.tile),
    { saved: saved && { ok: saved.ok, bytes: saved.bytes }, before: before && { hash: before.terrainHash, inventory: before.inventory, tile: before.player.tile }, after: after && { hash: after.terrainHash, inventory: after.inventory, tile: after.player.tile } });

  const progress = readProgress(persist);
  const chunkFiles = existsSync(chunksDir(persist)) ? readdirSync(chunksDir(persist)) : [];
  const expectedChunks = [...new Set([chunkIdOf(firstTarget.tx, firstTarget.ty), chunkIdOf(secondTarget.tx, secondTarget.ty), chunkIdOf(thirdTarget.tx, thirdTarget.ty)])];
  const untouched = (() => {
    for (let cy = 0; cy < Math.ceil(persistTerrain.height / 16); cy += 1) for (let cx = 0; cx < Math.ceil(persistTerrain.width / 16); cx += 1) {
      const id = `${cx}_${cy}`;
      if (expectedChunks.includes(id)) continue;
      const tx = cx * 16 + 1; const ty = cy * 16 + 1;
      if (persistTerrain.get(tx, ty) !== 'air') return { id, tx, ty };
    }
    return null;
  })();
  const untouchedTile = untouched ? single(persist, { op: 'tile', args: { tx: untouched.tx, ty: untouched.ty } }).result : null;
  check('S22', 'an unmodified chunk has no file and regenerates after restart',
    progress !== null && expectedChunks.every((id) => chunkFiles.includes(`${id}.json`)) && Object.keys(progress.data.chunks).every((id) => expectedChunks.includes(id)) && untouched !== null && !chunkFiles.includes(`${untouched.id}.json`) && untouchedTile && untouchedTile.material === persistTerrain.get(untouched.tx, untouched.ty),
    { chunkFiles, expected: expectedChunks, untouched, untouchedTile: untouchedTile && untouchedTile.material });

  const restoredChunks = expectedChunks.map((id) => single(persist, { op: 'chunk', args: { cx: Number(id.split('_')[0]), cy: Number(id.split('_')[1]) } }).result);
  check('S23', 'every modified chunk is restored with its revision and cell count',
    expectedChunks.length >= 2 && restoredChunks.every((entry) => entry && entry.edited === true && entry.revision >= 1 && entry.cells >= 1),
    { restoredChunks });

  const partial = makeWorld('blank', 'smoke-partial');
  const partialTerrain = referenceTerrain(partial.world.generation);
  let partialTarget = null;
  for (let ty = 16; ty <= 21 && partialTarget === null; ty += 1) {
    for (let tx = 32; tx < 48 && partialTarget === null; tx += 1) {
      if (partialTerrain.get(tx, ty) === 'stone') partialTarget = { tx, ty };
    }
  }
  const lastTx = partialTarget ? partialTarget.tx : 47;
  const lastTy = partialTarget ? { ty: partialTarget.ty } : null;
  check('S24-pre', 'a diggable stone tile exists inside the partial boundary chunk (2_1)', partialTarget !== null, { partialTarget });
  const boundaryRun = runProbe(partial, [
    { op: 'set-position', args: { x: playerFeetForTile(lastTx, lastTy.ty).x, y: playerFeetForTile(lastTx, lastTy.ty).y } },
    { op: 'dig', args: { tx: lastTx, ty: lastTy.ty, requestId: 's24-dig' } },
    { op: 'save' },
    { op: 'chunk', args: { cx: Math.floor(lastTx / 16), cy: Math.floor(lastTy.ty / 16) } },
  ], { saveOnExit: false });
  const reopened = single(partial, { op: 'tile', args: { tx: lastTx, ty: lastTy.ty } });
  check('S24', 'a partial boundary chunk (48x24 map) round-trips exactly',
    resultOf(boundaryRun, 3) && resultOf(boundaryRun, 3).edited === true && reopened.result && reopened.result.material === 'air',
    { tile: [lastTx, lastTy.ty], chunk: resultOf(boundaryRun, 3), reopened: reopened.result });

  // S25..S29: corrupt, missing, version, write failure
  const corrupt = makeWorld('mine-camp', 'smoke-corrupt');
  const corruptTarget = findDiggable(referenceTerrain(corrupt.world.generation), 'stone');
  runProbe(corrupt, [
    { op: 'set-position', args: { x: playerFeetForTile(corruptTarget.tx, corruptTarget.ty).x, y: playerFeetForTile(corruptTarget.tx, corruptTarget.ty).y } },
    { op: 'dig', args: { tx: corruptTarget.tx, ty: corruptTarget.ty, requestId: 's25-dig' } },
    { op: 'save' },
  ], { saveOnExit: false });
  const corruptProgress = readProgress(corrupt);
  writeFileSync(corruptProgress.path, '{ this is not json');
  const corruptRun = runProbe(corrupt, [{ op: 'restore' }, { op: 'inventory' }], { saveOnExit: false });
  check('S25', 'corrupt progress.json -> whole reject with an explicit reason, nothing applied',
    corruptRun.response && resultOf(corruptRun, 0) && resultOf(corruptRun, 0).ok === false && typeof resultOf(corruptRun, 0).reason === 'string' && resultOf(corruptRun, 1).stone === 0,
    { restore: resultOf(corruptRun, 0), inventory: resultOf(corruptRun, 1) });

  const chunkCorrupt = makeWorld('mine-camp', 'smoke-chunk-corrupt');
  const ccTarget = findDiggable(referenceTerrain(chunkCorrupt.world.generation), 'stone');
  runProbe(chunkCorrupt, [
    { op: 'set-position', args: { x: playerFeetForTile(ccTarget.tx, ccTarget.ty).x, y: playerFeetForTile(ccTarget.tx, ccTarget.ty).y } },
    { op: 'dig', args: { tx: ccTarget.tx, ty: ccTarget.ty, requestId: 's26-dig' } },
    { op: 'save' },
  ], { saveOnExit: false });
  const ccFile = join(chunksDir(chunkCorrupt), `${chunkIdOf(ccTarget.tx, ccTarget.ty)}.json`);
  writeFileSync(ccFile, readFileSync(ccFile, 'utf8').replace('"revision"', '"revisionXX"'));
  const ccRun = runProbe(chunkCorrupt, [{ op: 'restore' }], { saveOnExit: false });
  check('S26', 'corrupt chunk file -> chunk_corrupt or chunk_hash_mismatch',
    resultOf(ccRun, 0) && ['chunk_corrupt', 'chunk_hash_mismatch'].includes(resultOf(ccRun, 0).reason), { result: resultOf(ccRun, 0) });

  const missing = makeWorld('mine-camp', 'smoke-missing-chunk');
  const mcTarget = findDiggable(referenceTerrain(missing.world.generation), 'stone');
  runProbe(missing, [
    { op: 'set-position', args: { x: playerFeetForTile(mcTarget.tx, mcTarget.ty).x, y: playerFeetForTile(mcTarget.tx, mcTarget.ty).y } },
    { op: 'dig', args: { tx: mcTarget.tx, ty: mcTarget.ty, requestId: 's27-dig' } },
    { op: 'save' },
  ], { saveOnExit: false });
  rmSync(join(chunksDir(missing), `${chunkIdOf(mcTarget.tx, mcTarget.ty)}.json`), { force: true });
  const mcRun = runProbe(missing, [{ op: 'restore' }], { saveOnExit: false });
  check('S27', 'indexed but missing chunk file -> missing_chunk', resultOf(mcRun, 0) && resultOf(mcRun, 0).reason === 'missing_chunk', { result: resultOf(mcRun, 0) });

  const version = makeWorld('mine-camp', 'smoke-version');
  const vTarget = findDiggable(referenceTerrain(version.world.generation), 'stone');
  runProbe(version, [
    { op: 'set-position', args: { x: playerFeetForTile(vTarget.tx, vTarget.ty).x, y: playerFeetForTile(vTarget.tx, vTarget.ty).y } },
    { op: 'dig', args: { tx: vTarget.tx, ty: vTarget.ty, requestId: 's28-dig' } },
    { op: 'save' },
  ], { saveOnExit: false });
  const vProgress = readProgress(version);
  const vData = JSON.parse(vProgress.text);
  vData.state.stateVersion = 99;
  writeFileSync(vProgress.path, JSON.stringify(vData));
  const vRun = runProbe(version, [{ op: 'restore' }], { saveOnExit: false });
  vData.state.stateVersion = 1;
  vData.state.format = 'craftmine.godot-mining-sandbox-state/0';
  writeFileSync(vProgress.path, JSON.stringify(vData));
  const fRun = runProbe(version, [{ op: 'restore' }], { saveOnExit: false });
  check('S28', 'changed stateVersion/format -> bad_state_version / bad_format',
    ['bad_state_version', 'bad_version'].includes(resultOf(vRun, 0) && resultOf(vRun, 0).reason) && ['bad_format', 'bad_state'].includes(resultOf(fRun, 0) && resultOf(fRun, 0).reason),
    { versionReason: resultOf(vRun, 0) && resultOf(vRun, 0).reason, formatReason: resultOf(fRun, 0) && resultOf(fRun, 0).reason });

  const failWorld = makeWorld('mine-camp', 'smoke-write-fail');
  const fTarget = findDiggable(referenceTerrain(failWorld.world.generation), 'stone');
  runProbe(failWorld, [
    { op: 'set-position', args: { x: playerFeetForTile(fTarget.tx, fTarget.ty).x, y: playerFeetForTile(fTarget.tx, fTarget.ty).y } },
    { op: 'dig', args: { tx: fTarget.tx, ty: fTarget.ty, requestId: 's29-dig' } },
    { op: 'save' },
  ], { saveOnExit: false });
  const goodSnapshot = snapshotOf(failWorld);
  const blocker = join(ROOT, 's29-blocker');
  writeFileSync(blocker, 'not a directory');
  const failSave = single(failWorld, { op: 'save' }, { progressRoot: join(blocker, 'nested') });
  const reloaded = snapshotOf(failWorld);
  check('S29', 'real write failure -> ok:false with a stage and the previous save stays loadable',
    failSave.result && failSave.result.ok === false && typeof failSave.result.stage === 'string' && reloaded && reloaded.terrainHash === goodSnapshot.terrainHash && JSON.stringify(reloaded.inventory) === JSON.stringify(goodSnapshot.inventory),
    { save: failSave.result, reloadedHash: reloaded && reloaded.terrainHash, expectedHash: goodSnapshot.terrainHash });

  // S30: rescue a saved overlap
  const rescue = makeWorld('mine-camp', 'smoke-rescue', { inventory: [{ id: 'stone_brick', count: 2 }] });
  const rescueTerrain = referenceTerrain(rescue.world.generation);
  const rTarget = findDiggable(rescueTerrain, 'stone');
  runProbe(rescue, [
    { op: 'set-position', args: { x: playerFeetForTile(rTarget.tx, rTarget.ty).x, y: playerFeetForTile(rTarget.tx, rTarget.ty).y } },
    { op: 'dig', args: { tx: rTarget.tx, ty: rTarget.ty, requestId: 's30-dig' } },
    { op: 'save' },
  ], { saveOnExit: false });
  const rProgress = readProgress(rescue);
  const rData = JSON.parse(rProgress.text);
  const solidTile = { tx: rTarget.tx, ty: rTarget.ty + 2 };
  rData.state.player.tile = [solidTile.tx, solidTile.ty];
  rData.state.player.position = [solidTile.tx * 16 + 8, (solidTile.ty + 1) * 16];
  writeFileSync(rProgress.path, JSON.stringify(rData));
  const rescued = snapshotOf(rescue);
  check('S30', 'a saved overlap is rescued and reported, and the player is never inside a solid tile',
    rescued && rescued.rescue && rescued.rescue.resolved === true && rescued.player.tile[1] < solidTile.ty && rescued.physical.solidTilesInPlayerRect === 0,
    { rescue: rescued && rescued.rescue, player: rescued && rescued.player, physical: rescued && rescued.physical });

  // S31: snapshot is read-only
  const ro = makeWorld('mine-camp', 'smoke-readonly');
  const roTarget = findDiggable(referenceTerrain(ro.world.generation), 'stone');
  const roRun = runProbe(ro, [
    { op: 'set-position', args: { x: playerFeetForTile(roTarget.tx, roTarget.ty).x, y: playerFeetForTile(roTarget.tx, roTarget.ty).y } },
    { op: 'dig', args: { tx: roTarget.tx, ty: roTarget.ty, requestId: 's31-dig' } },
    { op: 'snapshot' },
    { op: 'snapshot' },
    { op: 'inventory' },
  ], { saveOnExit: false });
  const firstSnap = resultOf(roRun, 2);
  const secondSnap = resultOf(roRun, 3);
  check('S31', 'snapshot() is read-only',
    firstSnap && secondSnap && firstSnap.terrainHash === secondSnap.terrainHash && JSON.stringify(firstSnap.inventory) === JSON.stringify(secondSnap.inventory) && JSON.stringify(firstSnap.player) === JSON.stringify(secondSnap.player),
    { first: firstSnap && { hash: firstSnap.terrainHash, inventory: firstSnap.inventory, player: firstSnap.player }, second: secondSnap && { hash: secondSnap.terrainHash, inventory: secondSnap.inventory, player: secondSnap.player } });

  // S32: reset-to-initial clears edits and progress
  const reset = makeWorld('mine-camp', 'smoke-reset');
  const resetTerrain = referenceTerrain(reset.world.generation);
  const r2Target = findDiggable(resetTerrain, 'stone');
  const resetRun = runProbe(reset, [
    { op: 'set-position', args: { x: playerFeetForTile(r2Target.tx, r2Target.ty).x, y: playerFeetForTile(r2Target.tx, r2Target.ty).y } },
    { op: 'dig', args: { tx: r2Target.tx, ty: r2Target.ty, requestId: 's32-dig' } },
    { op: 'save' },
    { op: 'reset-to-initial' },
    { op: 'tile', args: { tx: r2Target.tx, ty: r2Target.ty } },
    { op: 'inventory' },
    { op: 'hash' },
  ], { saveOnExit: false });
  const resetProgress = readProgress(reset);
  const resetChunks = existsSync(chunksDir(reset)) ? readdirSync(chunksDir(reset)) : [];
  check('S32', 'reset-to-initial restores generated terrain, clears edits and drops chunk files',
    resultOf(resetRun, 4) && resultOf(resetRun, 4).material === 'stone' && resultOf(resetRun, 5).stone === 0 && resultOf(resetRun, 6).hash === resetTerrain.terrainHash && resetChunks.length === 0 && (!resetProgress || Object.keys(resetProgress.data.chunks).length === 0),
    { tile: resultOf(resetRun, 4), inventory: resultOf(resetRun, 5), hashMatches: resultOf(resetRun, 6).hash === resetTerrain.terrainHash, resetChunks, progressChunks: resetProgress && Object.keys(resetProgress.data.chunks) });

  // S33: a tile restored to its generated material leaves no chunk file behind
  const revert = makeWorld('mine-camp', 'smoke-revert');
  const revertTerrain = referenceTerrain(revert.world.generation);
  const revertTarget = findDiggable(revertTerrain, 'stone');
  const revertFeet = playerFeetForTile(revertTarget.tx, revertTarget.ty);
  const revertRun = runProbe(revert, [
    { op: 'set-position', args: { x: revertFeet.x, y: revertFeet.y } },
    { op: 'dig', args: { tx: revertTarget.tx, ty: revertTarget.ty, requestId: 's33-dig' } },
    { op: 'place', args: { tx: revertTarget.tx, ty: revertTarget.ty, materialId: 'stone', requestId: 's33-place' } },
    { op: 'chunk', args: { cx: Math.floor(revertTarget.tx / 16), cy: Math.floor(revertTarget.ty / 16) } },
    { op: 'save' },
    { op: 'hash' },
  ], { saveOnExit: false });
  const revertProgress = readProgress(revert);
  const revertChunkFile = join(chunksDir(revert), `${chunkIdOf(revertTarget.tx, revertTarget.ty)}.json`);
  check('S33', 'dig + place back to the generated material leaves no chunk file and no index entry',
    resultOf(revertRun, 3) && resultOf(revertRun, 3).edited === false && resultOf(revertRun, 5).hash === revertTerrain.terrainHash && !existsSync(revertChunkFile) && revertProgress && Object.keys(revertProgress.data.chunks).length === 0,
    { chunk: resultOf(revertRun, 3), hashMatches: resultOf(revertRun, 5).hash === revertTerrain.terrainHash, chunkFile: existsSync(revertChunkFile), progressChunks: revertProgress && Object.keys(revertProgress.data.chunks) });
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
const report = { format: 'craftmine.mining-sandbox-smoke/1', godot: GODOT, tempRoot: ROOT, total: results.length, passed, failed: failed.map((entry) => entry.id), results };
log('report.json', report);
process.stdout.write(`\nG smoke: ${passed}/${results.length} passed\n`);
if (failed.length > 0) process.stdout.write(`failed: ${failed.map((entry) => entry.id).join(', ')}\n`);
process.exit(failure || failed.length > 0 ? 1 : 0);
