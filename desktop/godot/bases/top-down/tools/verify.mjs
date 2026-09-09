#!/usr/bin/env node
// Independent acceptance runner for the top-down base.
//
// It creates throwaway world instances in a scratch directory, imports them with
// the pinned Godot build and drives them through the headless probe interface.
// No real mouse or keyboard input is sent, no window is created or focused, and
// no Pointer Lock is requested: the probe supplies the same movement vector a
// player would, and every rule is then checked by real physics and real state.
//
// Usage:
//   node tools/verify.mjs [--godot <engine>] [--work <dir>] [--out <dir>] [--keep]

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE_DIR = resolve(HERE, '..');
const MANIFEST = JSON.parse(readFileSync(join(BASE_DIR, 'manifest.json'), 'utf8'));

const PROBE_FORMAT = MANIFEST.protocols.probeFormat;
const IMPORT_TIMEOUT_MS = 300000;
const PROBE_TIMEOUT_MS = 300000;

// ---------------------------------------------------------------- utilities

function parseArgs(argv) {
  const args = { keep: false, reuse: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--godot') args.godot = argv[++i];
    else if (argv[i] === '--work') args.work = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--keep') args.keep = true;
    else if (argv[i] === '--reuse') args.reuse = true;
    else if (argv[i] === '--run-id') args.runId = argv[++i];
  }
  return args;
}

function resolveGodot(explicit) {
  const candidates = [
    explicit,
    process.env.CRAFTMINE_GODOT_BIN,
    'D:/Craftmine World/desktop/build/godot/4.7.2-stable/editor/Godot_v4.7.2-stable_win64_console.exe',
    'godot',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate === 'godot') return candidate;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    timeout: options.timeoutMs || 60000,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
}

class Checks {
  constructor() {
    this.items = [];
  }

  add(id, name, ok, detail) {
    this.items.push({ id, name, ok: Boolean(ok), detail: detail === undefined ? null : detail });
    process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${name}${ok ? '' : `  <- ${JSON.stringify(detail)}`}\n`);
  }

  get passed() {
    return this.items.filter((item) => item.ok).length;
  }

  get failed() {
    return this.items.filter((item) => !item.ok).length;
  }
}

// -------------------------------------------------------------- world driver

class World {
  constructor({ worldId, template, root, godot, evidenceDir }) {
    this.worldId = worldId;
    this.template = template;
    this.root = root;
    this.godot = godot;
    this.evidenceDir = evidenceDir;
  }

  create() {
    const outcome = run('node', [
      join(BASE_DIR, 'tools', 'new-world.mjs'),
      '--template', this.template,
      '--world-id', this.worldId,
      '--name', this.worldId,
      '--out', this.root,
      '--force',
    ], { timeoutMs: 60000 });
    if (outcome.status !== 0) {
      throw new Error(`new-world failed for ${this.worldId}: ${outcome.stderr || outcome.stdout}`);
    }
    return JSON.parse(readFileSync(join(this.root, 'world-build.json'), 'utf8'));
  }

  importProject() {
    const outcome = run(this.godot, ['--headless', '--path', this.root, '--import'], { timeoutMs: IMPORT_TIMEOUT_MS });
    const output = `${outcome.stdout || ''}${outcome.stderr || ''}`;
    writeFileSync(join(this.evidenceDir, `${this.worldId}-import.log`), output);
    if (/SCRIPT ERROR|Parse Error/.test(output)) {
      throw new Error(`import reported script errors for ${this.worldId}`);
    }
    return output;
  }

  // Returns { snapshot, byLabel, raw }.
  probe(label, commands) {
    const requestPath = join(this.evidenceDir, `${this.worldId}-${label}-request.json`);
    const responsePath = join(this.evidenceDir, `${this.worldId}-${label}-response.json`);
    writeFileSync(requestPath, `${JSON.stringify({ format: PROBE_FORMAT, commands }, null, 2)}\n`);
    const outcome = run(this.godot, [
      '--headless', '--path', this.root,
      '--', '--probe', `--probe-request=${requestPath}`, `--probe-response=${responsePath}`,
    ], { timeoutMs: PROBE_TIMEOUT_MS });
    writeFileSync(
      join(this.evidenceDir, `${this.worldId}-${label}-process.log`),
      `exit=${outcome.status}\n--- stdout ---\n${outcome.stdout || ''}\n--- stderr ---\n${outcome.stderr || ''}\n`,
    );
    if (!existsSync(responsePath)) {
      throw new Error(`probe ${label} on ${this.worldId} produced no response (exit ${outcome.status})`);
    }
    const raw = JSON.parse(readFileSync(responsePath, 'utf8'));
    const byLabel = {};
    for (const entry of raw.results || []) {
      const key = entry.args && entry.args.label ? entry.args.label : `${entry.op}#${Object.keys(byLabel).length}`;
      byLabel[key] = entry.result;
    }
    return { snapshot: raw.finalSnapshot, byLabel, raw };
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const godot = resolveGodot(args.godot);
  if (!godot) {
    process.stderr.write('verify: no Godot build found; pass --godot <engine> or set CRAFTMINE_GODOT_BIN\n');
    process.exit(2);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const work = resolve(args.work || join(process.env.PI_SCRATCH_DIR || process.env.TEMP || '.', `topdown-verify-${stamp}`));
  const out = resolve(args.out || join(work, 'report'));
  const evidenceDir = join(out, 'evidence');
  mkdirSync(evidenceDir, { recursive: true });
  mkdirSync(work, { recursive: true });

  const versionRun = run(godot, ['--version'], { timeoutMs: 60000 });
  const godotVersion = (versionRun.stdout || '').trim();

  const checks = new Checks();
  const worlds = {};
  // Each run gets its own world ids, so `custom_user_dir_name` (and therefore
  // user://) is unique per run and a previous run's progress cannot leak in.
  const runId = (args.runId || Date.now().toString(36)).toLowerCase();
  const ids = {
    blank: `verify-blank-${runId}`,
    town: `verify-town-${runId}`,
    townB: `verify-town-b-${runId}`,
    townC: `verify-town-c-${runId}`,
  };

  const makeWorld = (key, worldId, template) => {
    const world = new World({ worldId, template, root: join(work, key), godot, evidenceDir });
    const reusable = args.reuse && existsSync(join(world.root, '.godot', 'imported'));
    const build = reusable
      ? JSON.parse(readFileSync(join(world.root, 'world-build.json'), 'utf8'))
      : (world.create(), world.importProject(), JSON.parse(readFileSync(join(world.root, 'world-build.json'), 'utf8')));
    worlds[key] = { world, build };
    return worlds[key];
  };

  try {
    // ---------------------------------------------------------- blank start
    const blank = makeWorld('blank', ids.blank, 'blank');
    const blankProbe = blank.world.probe('run', [
      { op: 'snapshot', args: { label: 'start' } },
      { op: 'move', args: { dx: 0, dy: -1, steps: 30, label: 'up' } },
      { op: 'snapshot', args: { label: 'after' } },
    ]);
    checks.add('blank-01', 'blank start builds a real tilemap with real collision',
      Boolean(blankProbe.snapshot.maps['blank-room'])
      && blankProbe.snapshot.maps['blank-room'].ok === true
      && blankProbe.snapshot.maps['blank-room'].collisionShapes > 0,
      blankProbe.snapshot.maps['blank-room']);
    checks.add('blank-02', 'player moves through real physics and faces the travel direction',
      blankProbe.byLabel.up.distance > 20 && blankProbe.snapshot.physical.facing === 'up',
      { moved: blankProbe.byLabel.up.distance, facing: blankProbe.snapshot.physical.facing });
    checks.add('blank-03', 'blank start has no inherited progress',
      blankProbe.snapshot.coins === 0 && Object.keys(blankProbe.snapshot.grantedRewards).length === 0,
      { coins: blankProbe.snapshot.coins, grantedRewards: blankProbe.snapshot.grantedRewards });

    // -------------------------------------------------------------- town
    const town = makeWorld('town', ids.town, 'town');
    const initial = town.world.probe('initial', [{ op: 'snapshot', args: { label: 'start' } }]);
    checks.add('town-01', 'town ships initial progress with an unclaimed quest',
      initial.snapshot.coins === 40
      && initial.snapshot.shops.general.stock.bread === 3
      && initial.snapshot.quests['herb-delivery'].rewarded === false
      && Object.keys(initial.snapshot.grantedRewards).length === 0,
      { coins: initial.snapshot.coins, stock: initial.snapshot.shops.general.stock, quest: initial.snapshot.quests['herb-delivery'] });

    // Real collision against the shop wall.
    const collision = town.world.probe('collision', [
      { op: 'set-position', args: { x: 416, y: 160, facing: 'up', label: 'place' } },
      { op: 'move', args: { dx: 0, dy: -1, steps: 60, label: 'into-wall' } },
      { op: 'snapshot', args: { label: 'after' } },
    ]);
    checks.add('town-02', 'real collision stops the player at the building wall',
      collision.byLabel['into-wall'].after[1] - 6 >= 127.5 && collision.byLabel['into-wall'].after[1] < 145,
      collision.byLabel['into-wall']);

    // ------------------------------------------- shop: range, price, stock
    const shop = town.world.probe('shop', [
      { op: 'change-scene', args: { scene: 'res://scenes/shop_interior.tscn', spawn: 'from-street', label: 'enter' } },
      { op: 'buy', args: { shopId: 'shop-general', itemId: 'bread', label: 'buy-away' } },
      { op: 'set-position', args: { x: 160, y: 108, label: 'at-counter' } },
      { op: 'focus', args: { label: 'focus' } },
      { op: 'buy', args: { shopId: 'shop-general', itemId: 'bread', label: 'buy-1' } },
      { op: 'buy', args: { shopId: 'shop-general', itemId: 'bread', label: 'buy-2' } },
      { op: 'buy', args: { shopId: 'shop-general', itemId: 'bread', label: 'buy-3' } },
      { op: 'buy', args: { shopId: 'shop-general', itemId: 'bread', label: 'buy-4' } },
      { op: 'set-position', args: { x: 160, y: 180, label: 'leave' } },
      { op: 'buy', args: { shopId: 'shop-general', itemId: 'bread', label: 'buy-left' } },
      { op: 'set-position', args: { x: 160, y: 108, label: 'back' } },
      { op: 'deliver', args: { npcId: 'npc-shopkeeper', questId: 'herb-delivery', label: 'deliver-wrong-giver' } },
      { op: 'buy', args: { shopId: 'shop-general', itemId: 'rope', label: 'buy-rope' } },
      { op: 'buy', args: { shopId: 'shop-general', itemId: 'potion', label: 'buy-poor' } },
      { op: 'change-scene', args: { scene: 'res://scenes/overworld.tscn', spawn: 'from-shop', label: 'exit' } },
      { op: 'snapshot', args: { label: 'after-exit' } },
      { op: 'save', args: { label: 'save' } },
    ]);
    checks.add('shop-01', 'scene switch into the shop interior binds the new scene',
      shop.byLabel.enter.ok === true && shop.byLabel.enter.sceneId === 'shop-interior',
      shop.byLabel.enter);
    checks.add('shop-02', 'buying outside the counter range is rejected',
      shop.byLabel['buy-away'].ok === false && shop.byLabel['buy-away'].reason === 'out_of_range',
      shop.byLabel['buy-away']);
    checks.add('shop-03', 'the counter is the focused interactable at the counter',
      shop.byLabel.focus.focus === 'shop-general', shop.byLabel.focus);
    checks.add('shop-03b', 'a quest cannot be handed in to an NPC that is not its declared giver',
      shop.byLabel['deliver-wrong-giver'].ok === false
      && shop.byLabel['deliver-wrong-giver'].reason === 'wrong_giver',
      shop.byLabel['deliver-wrong-giver']);
    checks.add('shop-04', 'buying at the counter moves coins, inventory and stock together',
      shop.byLabel['buy-1'].ok === true
      && shop.byLabel['buy-1'].coins === 34
      && shop.byLabel['buy-1'].inventory === 1
      && shop.byLabel['buy-1'].stock === 2,
      shop.byLabel['buy-1']);
    checks.add('shop-05', 'stock is a hard boundary and never goes below zero',
      shop.byLabel['buy-3'].stock === 0
      && shop.byLabel['buy-4'].ok === false
      && shop.byLabel['buy-4'].reason === 'out_of_stock',
      { third: shop.byLabel['buy-3'], fourth: shop.byLabel['buy-4'] });
    checks.add('shop-06', 'leaving the counter range blocks further purchases',
      shop.byLabel['buy-left'].ok === false && shop.byLabel['buy-left'].reason === 'out_of_range',
      shop.byLabel['buy-left']);
    checks.add('shop-07', 'insufficient coins are rejected without changing state',
      shop.byLabel['buy-poor'].ok === false && shop.byLabel['buy-poor'].reason === 'not_enough_coins',
      shop.byLabel['buy-poor']);
    const afterExit = shop.byLabel['after-exit'].snapshot;
    checks.add('shop-08', 'returning to the overworld keeps coins, items and stock',
      shop.byLabel.exit.ok === true && shop.byLabel.exit.sceneId === 'overworld'
      && afterExit.coins === 7
      && afterExit.inventory.bread === 3
      && afterExit.inventory.rope === 1
      && afterExit.shops.general.stock.bread === 0
      && afterExit.shops.general.stock.rope === 0,
      { coins: afterExit.coins, inventory: afterExit.inventory, stock: afterExit.shops.general.stock });

    // ---------------------------------------- zones: enter, gather, leave
    const gather = town.world.probe('gather', [
      { op: 'set-position', args: { x: 96, y: 300, label: 'below' } },
      { op: 'gather', args: { zoneId: 'zone-herb-patch', label: 'gather-away' } },
      { op: 'move', args: { dx: 0, dy: -1, steps: 40, label: 'walk-in' } },
      { op: 'snapshot', args: { label: 'inside' } },
      { op: 'gather', args: { zoneId: 'zone-herb-patch', label: 'gather-1' } },
      { op: 'gather', args: { zoneId: 'zone-herb-patch', label: 'gather-2' } },
      { op: 'gather', args: { zoneId: 'zone-herb-patch', label: 'gather-3' } },
      { op: 'move', args: { dx: 0, dy: 1, steps: 40, label: 'walk-out' } },
      { op: 'gather', args: { zoneId: 'zone-herb-patch', label: 'gather-after' } },
      { op: 'snapshot', args: { label: 'outside' } },
    ]);
    checks.add('zone-01', 'gathering outside the patch is rejected',
      gather.byLabel['gather-away'].ok === false && gather.byLabel['gather-away'].reason === 'out_of_range',
      gather.byLabel['gather-away']);
    checks.add('zone-02', 'walking into the patch creates a real physics overlap',
      gather.byLabel.inside.snapshot.physical.overlaps['zone-herb-patch'] === true,
      gather.byLabel.inside.snapshot.physical.overlaps);
    checks.add('zone-03', 'gathering inside the patch yields items and consumes charges',
      gather.byLabel['gather-1'].ok === true
      && gather.byLabel['gather-1'].chargesLeft === 4
      && gather.byLabel['gather-3'].inventory === 3
      && gather.byLabel['gather-3'].chargesLeft === 2,
      { first: gather.byLabel['gather-1'], third: gather.byLabel['gather-3'] });
    checks.add('zone-04', 'leaving the patch clears the overlap and blocks gathering',
      gather.byLabel.outside.snapshot.physical.overlaps['zone-herb-patch'] === false
      && gather.byLabel['gather-after'].ok === false
      && gather.byLabel['gather-after'].reason === 'out_of_range',
      { overlaps: gather.byLabel.outside.snapshot.physical.overlaps, gather: gather.byLabel['gather-after'] });

    // ------------------------------------------- quest: deliver exactly once
    const quest = town.world.probe('quest', [
      { op: 'set-position', args: { x: 200, y: 240, label: 'far' } },
      { op: 'deliver', args: { npcId: 'npc-mira', questId: 'herb-delivery', label: 'deliver-far' } },
      { op: 'set-position', args: { x: 200, y: 176, label: 'near' } },
      { op: 'deliver', args: { npcId: 'npc-mira', questId: 'no-such-quest', label: 'deliver-unknown' } },
      { op: 'talk', args: { npcId: 'npc-mira', label: 'talk-before' } },
      { op: 'deliver', args: { npcId: 'npc-mira', questId: 'herb-delivery', label: 'deliver-1' } },
      { op: 'deliver', args: { npcId: 'npc-mira', questId: 'herb-delivery', label: 'deliver-2' } },
      { op: 'talk', args: { npcId: 'npc-mira', label: 'talk-after' } },
      { op: 'snapshot', args: { label: 'after' } },
    ]);
    checks.add('quest-01', 'delivery outside NPC range is rejected',
      quest.byLabel['deliver-far'].ok === false && quest.byLabel['deliver-far'].reason === 'out_of_range',
      quest.byLabel['deliver-far']);
    checks.add('quest-01b', 'delivering an unknown quest id is rejected',
      quest.byLabel['deliver-unknown'].ok === false && quest.byLabel['deliver-unknown'].reason === 'unknown_quest',
      quest.byLabel['deliver-unknown']);
    checks.add('quest-02', 'dialogue reports the active quest before delivery',
      quest.byLabel['talk-before'].ok === true && quest.byLabel['talk-before'].questStatus === 'active',
      quest.byLabel['talk-before']);
    checks.add('quest-03', 'the first delivery consumes the herbs and pays the reward once',
      quest.byLabel['deliver-1'].ok === true
      && quest.byLabel['deliver-1'].coins === 37
      && quest.byLabel['deliver-1'].snapshot.inventory.herb === undefined
      && quest.byLabel['deliver-1'].snapshot.quests['herb-delivery'].rewarded === true
      && quest.byLabel['deliver-1'].snapshot.grantedRewards['herb-delivery#reward'] === true,
      quest.byLabel['deliver-1']);
    checks.add('quest-04', 'the second delivery is rejected and pays nothing',
      quest.byLabel['deliver-2'].ok === false
      && quest.byLabel['deliver-2'].reason === 'already_rewarded'
      && quest.byLabel['deliver-2'].coins === 37,
      quest.byLabel['deliver-2']);
    checks.add('quest-05', 'dialogue and quest status show completion after delivery',
      quest.byLabel['talk-after'].questStatus === 'completed'
      && quest.snapshot.quests['herb-delivery'].status === 'completed',
      quest.byLabel['talk-after']);

    // -------------------------------------------------- directional animation
    const anim = town.world.probe('anim', [
      { op: 'set-position', args: { x: 104, y: 168, label: 'place' } },
      { op: 'move-capture', args: { dx: 1, dy: 0, steps: 30, label: 'walk' } },
      { op: 'snapshot', args: { label: 'right' } },
      { op: 'move', args: { dx: 0, dy: 1, steps: 8, label: 'down' } },
      { op: 'snapshot', args: { label: 'down' } },
      { op: 'move', args: { dx: -1, dy: 0, steps: 8, label: 'left' } },
      { op: 'snapshot', args: { label: 'left' } },
      { op: 'move', args: { dx: 0, dy: -1, steps: 8, label: 'up' } },
      { op: 'snapshot', args: { label: 'up' } },
    ]);
    const dirs = {
      right: anim.byLabel.right.snapshot.sprite,
      down: anim.byLabel.down.snapshot.sprite,
      left: anim.byLabel.left.snapshot.sprite,
      up: anim.byLabel.up.snapshot.sprite,
    };
    checks.add('anim-01', 'directional animation follows movement in all four directions',
      dirs.right.facing === 'right' && dirs.down.facing === 'down'
      && dirs.left.facing === 'left' && dirs.up.facing === 'up',
      dirs);
    checks.add('anim-02', 'the walk cycle advances while moving in one direction',
      anim.byLabel.walk.distinctFrames >= 2 && anim.byLabel.walk.facing === 'right',
      { distinctFrames: anim.byLabel.walk.distinctFrames, sample: anim.byLabel.walk.frames.slice(0, 12) });

    // ------------------------------------------------ full restart persistence
    const restart = town.world.probe('restart', [
      { op: 'snapshot', args: { label: 'loaded' } },
      { op: 'set-position', args: { x: 200, y: 176, label: 'near-npc' } },
      { op: 'deliver', args: { npcId: 'npc-mira', questId: 'herb-delivery', label: 'deliver-again' } },
      { op: 'set-position', args: { x: 96, y: 248, label: 'patch' } },
      { op: 'gather', args: { zoneId: 'zone-herb-patch', label: 'gather-after-restart' } },
      { op: 'change-scene', args: { scene: 'res://scenes/shop_interior.tscn', spawn: 'from-street', label: 'enter' } },
      { op: 'set-position', args: { x: 160, y: 108, label: 'counter' } },
      { op: 'buy', args: { shopId: 'shop-general', itemId: 'potion', label: 'buy-potion' } },
      { op: 'save', args: { label: 'save' } },
    ]);
    const loaded = restart.byLabel.loaded.snapshot;
    checks.add('restart-01', 'a full process restart restores coins, inventory, stock and quest state',
      loaded.coins === 37
      && loaded.inventory.bread === 3
      && loaded.inventory.rope === 1
      && loaded.inventory.apple === 1
      && loaded.shops.general.stock.bread === 0
      && loaded.shops.general.stock.rope === 0
      && loaded.quests['herb-delivery'].rewarded === true
      && loaded.grantedRewards['herb-delivery#reward'] === true,
      { coins: loaded.coins, inventory: loaded.inventory, stock: loaded.shops.general.stock, quest: loaded.quests['herb-delivery'] });
    checks.add('restart-02', 'the quest reward stays one-shot after a full restart',
      restart.byLabel['deliver-again'].ok === false
      && restart.byLabel['deliver-again'].reason === 'already_rewarded'
      && restart.byLabel['deliver-again'].coins === 37,
      restart.byLabel['deliver-again']);
    checks.add('restart-03', 'shopping still works after a full restart',
      restart.byLabel['buy-potion'].ok === true
      && restart.byLabel['buy-potion'].coins === 25
      && restart.byLabel['buy-potion'].stock === 1,
      restart.byLabel['buy-potion']);
    checks.add('restart-04', 'gather charges persist across a full restart',
      restart.byLabel['gather-after-restart'].ok === true
      && restart.byLabel['gather-after-restart'].chargesLeft === 1
      && restart.byLabel['gather-after-restart'].snapshot.flags['zone.herb-patch.gathered'] === 4,
      restart.byLabel['gather-after-restart']);

    // --------------------------------------------------- instance independence
    const townB = makeWorld('town-b', ids.townB, 'town');
    const isolated = townB.world.probe('isolated', [
      { op: 'snapshot', args: { label: 'start' } },
      { op: 'set-position', args: { x: 96, y: 248, label: 'patch' } },
      { op: 'gather', args: { zoneId: 'zone-herb-patch', label: 'gather' } },
      { op: 'snapshot', args: { label: 'after' } },
    ]);
    checks.add('instance-01', 'a second town instance starts from its own initial state',
      isolated.byLabel.start.snapshot.coins === 40
      && isolated.byLabel.start.snapshot.shops.general.stock.bread === 3
      && isolated.byLabel.start.snapshot.quests['herb-delivery'].rewarded === false
      && Object.keys(isolated.byLabel.start.snapshot.grantedRewards).length === 0,
      { coins: isolated.byLabel.start.snapshot.coins, quest: isolated.byLabel.start.snapshot.quests['herb-delivery'] });
    checks.add('instance-02', 'the two instances keep different identities and independent progress',
      isolated.byLabel.after.snapshot.worldId === ids.townB
      && isolated.byLabel.after.snapshot.worldId !== loaded.worldId
      && isolated.byLabel.after.snapshot.inventory.herb === 1
      && isolated.byLabel.after.snapshot.coins === 40,
      { worldId: isolated.byLabel.after.snapshot.worldId, other: loaded.worldId, inventory: isolated.byLabel.after.snapshot.inventory });

    // ------------------------------- new world created after the example was played
    const townC = makeWorld('town-c', ids.townC, 'town');
    const fresh = townC.world.probe('fresh', [{ op: 'snapshot', args: { label: 'start' } }]);
    checks.add('new-world-01', 'a world created after the example was finished inherits no rewards',
      fresh.snapshot.coins === 40
      && fresh.snapshot.shops.general.stock.bread === 3
      && fresh.snapshot.quests['herb-delivery'].rewarded === false
      && Object.keys(fresh.snapshot.grantedRewards).length === 0
      && fresh.snapshot.worldId === ids.townC,
      { coins: fresh.snapshot.coins, quest: fresh.snapshot.quests['herb-delivery'], granted: fresh.snapshot.grantedRewards });

    // The create-world guard itself: a template that ships author progress must
    // be refused, not silently sanitised.
    const guardDir = join(work, 'template-guard');
    cpSync(join(BASE_DIR, 'templates', 'town'), guardDir, { recursive: true });
    const guardFile = join(guardDir, 'world.json.template');
    const guardSource = readFileSync(guardFile, 'utf8');
    const shippedReward = run('node', [join(BASE_DIR, 'tools', 'new-world.mjs'), '--check-template', guardDir]);
    writeFileSync(guardFile, guardSource.replace('"status": "active"', '"status": "active", "rewarded": true'));
    const rejectedReward = run('node', [join(BASE_DIR, 'tools', 'new-world.mjs'), '--check-template', guardDir]);
    writeFileSync(guardFile, guardSource.replace('"status": "active"', '"status": "completed"'));
    const rejectedCompleted = run('node', [join(BASE_DIR, 'tools', 'new-world.mjs'), '--check-template', guardDir]);
    checks.add('new-world-02', 'the create-world guard accepts an initial-progress template and rejects author progress',
      shippedReward.status === 0
      && rejectedReward.status !== 0
      && rejectedCompleted.status !== 0,
      {
        acceptedTemplate: shippedReward.status,
        shippedReward: rejectedReward.status,
        completedQuest: rejectedCompleted.status,
        message: (rejectedReward.stderr || '').trim(),
      });

    // ------------------------------------------------------------- report
    const report = {
      format: 'craftmine.godot-topdown-acceptance/1',
      generatedAt: new Date().toISOString(),
      godotVersion,
      baseId: MANIFEST.baseId,
      baseVersion: MANIFEST.baseVersion,
      baseProtocolVersion: MANIFEST.protocols.baseProtocolVersion,
      probeFormat: PROBE_FORMAT,
      inputMethod: 'scripted movement vector through the real CharacterBody2D; no OS mouse or keyboard events',
      workDirectory: work,
      evidenceDirectory: evidenceDir,
      worlds: Object.fromEntries(Object.entries(worlds).map(([key, value]) => [key, {
        worldId: value.world.worldId,
        template: value.world.template,
        directory: value.world.root,
        worldBuildSha256: sha256(readFileSync(join(value.world.root, 'world-build.json'))),
        entryScene: value.build.entryScene,
      }])),
      summary: { total: checks.items.length, passed: checks.passed, failed: checks.failed },
      checks: checks.items,
    };
    writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`\n${checks.passed}/${checks.items.length} checks passed (${checks.failed} failed)\n`);
    process.stdout.write(`report: ${join(out, 'report.json')}\n`);

    // Remove the throwaway user data directories this run created, so repeated
    // runs do not accumulate progress in %APPDATA%.
    if (!args.keep && process.env.APPDATA) {
      for (const worldId of Object.values(ids)) {
        const userDir = join(process.env.APPDATA, `craftmine-topdown-${worldId}`);
        if (existsSync(userDir)) rmSync(userDir, { recursive: true, force: true });
      }
    }
    process.exit(checks.failed === 0 ? 0 : 1);
  } catch (error) {
    process.stderr.write(`verify: ${error.stack || error.message}\n`);
    process.exit(3);
  }
}

main();
