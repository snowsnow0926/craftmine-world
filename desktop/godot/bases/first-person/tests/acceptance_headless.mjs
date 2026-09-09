// First-person base: real engine import plus scripted headless observation.
//
// This is a trusted authored base and a fixed-assertion acceptance run. It is
// not model-authored evidence and it does not check rendered pixels (see
// acceptance_web.mjs) or player feel.
//
// Run:  node desktop/godot/bases/first-person/tests/acceptance_headless.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createGodotProbeEnvironment,godotLock} from '../../../../../desktop/godot/toolchain.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const baseDirectory = path.resolve(here, '..');
const root = path.resolve(baseDirectory, '../../../../..');
const resultsDirectory = path.join(root, 'test-results');
fs.mkdirSync(resultsDirectory, {recursive: true});
const out = fs.mkdtempSync(path.join(resultsDirectory, 'godot-first-person-base-'));

const project = path.join(out, 'project');
fs.cpSync(baseDirectory, project, {recursive: true, filter: source => path.basename(source) !== '.godot'});

const report = {
  kind: 'first-person-base-headless',
  engine: godotLock.version,
  checks: [],
  runs: [],
  observations: {},
  errors: [],
  notVerified: [
    'model-authored creation from the blank start (see docs/MODEL_ACCEPTANCE_TASKS.md)',
    'rendered pixels and compositor output (see acceptance_web.mjs)',
    'product PI/Rust project transactions and application receipts',
    'OS-level isolation of untrusted projects',
    'player feel and hardware GPU performance',
  ],
};
const check = (name, value, evidence) => {
  report.checks.push({name, passed: !!value, ...(evidence === undefined ? {} : {evidence})});
  assert.ok(value, name);
  console.log('PASS ' + name);
};

function writeScript(name, commands) {
  fs.writeFileSync(path.join(project, name + '.json'), JSON.stringify(commands));
  return 'res://' + name + '.json';
}

async function run(environment, label, scriptPath, extra = [], scene = '') {
  const args = ['--path', project];
  if (scene) args.push(scene);
  args.push('--', `--base-script=${scriptPath}`, ...extra);
  const stdout = await environment.run(label, args);
  const lines = stdout.split(/\r?\n/).filter(line => line.startsWith('CRAFTMINE_FP_BASE='));
  assert.equal(lines.length, 1, `Exactly one result line for ${label}`);
  return JSON.parse(lines[0].slice('CRAFTMINE_FP_BASE='.length));
}

const byOp = (payload, op) => payload.results.filter(entry => entry.op === op);
const healthOf = (snapshot, id) => (snapshot.targets.find(target => target.id === id) || {}).health;

// TargetA sits at (-3, 0, -6) and TargetB at (0, 0, -10); the player starts at
// (0, 0.9, 6) looking down -Z.
const YAW_TO_TARGET_A = 0.2450;

try {
  const environment = await createGodotProbeEnvironment(out);
  report.runs = environment.runs;
  await environment.run('base-import', ['--path', project, '--editor', '--import']);
  check('Pinned real engine imports the base project headlessly', true);

  // ---------------------------------------------------------------- fresh start
  const fresh = await run(environment, 'base-fresh', writeScript('fresh', [
    {op: 'snapshot'},
    {op: 'resize', args: {width: 1280, height: 720}},
    {op: 'resize', args: {width: 800, height: 600}},
    {op: 'resize', args: {width: 1920, height: 1080}},
    {op: 'look', args: {yaw: 0.7, pitch: 0.2}},
    {op: 'snapshot'},
    {op: 'look', args: {yaw: 0.0, pitch: 0.0}},
    {op: 'equip', args: {value: 'practice_sword'}},
    {op: 'attack'},
    {op: 'snapshot'},
    {op: 'equip', args: {value: 'pistol'}},
    {op: 'snapshot'},
  ]), ['--base-world-id=fresh-world']);
  report.observations.fresh = fresh;
  const initial = fresh.results[0].result;
  check('Base starts headless with a real viewport and no captured input', fresh.headless === true && initial.viewportSize[0] > 0 && initial.inputCaptured === false, initial.viewportSize);
  check('Crosshair is a full-rect control centred on the real viewport', JSON.stringify(initial.crosshair.size) === JSON.stringify(initial.viewportSize) && Math.abs(initial.crosshair.offsetFromViewportCenter[0]) < 0.5 && Math.abs(initial.crosshair.offsetFromViewportCenter[1]) < 0.5, {size: initial.crosshair.size, offset: initial.crosshair.offsetFromViewportCenter});
  const resizes = byOp(fresh, 'resize').map(entry => entry.result);
  check('Crosshair stays centred across real resolution changes', resizes.length === 3 && resizes.every(entry => Math.abs(entry.crosshair.offsetFromViewportCenter[0]) < 0.5 && Math.abs(entry.crosshair.offsetFromViewportCenter[1]) < 0.5 && JSON.stringify(entry.crosshair.size) === JSON.stringify(entry.viewportSize)), resizes.map(entry => ({viewport: entry.viewportSize, offset: entry.crosshair.offsetFromViewportCenter})));
  check('Resolution changes really reach the engine viewport', resizes[0].viewportSize[0] === 1280 && resizes[1].viewportSize[0] === 800 && resizes[2].viewportSize[0] === 1920, resizes.map(entry => entry.viewportSize));
  const looked = fresh.results.find(entry => entry.op === 'look' && entry.args.yaw === 0.7).result;
  check('Held model keeps its camera-local mount after a real look', looked.display.attachedToCamera && looked.display.alignedWithCamera && JSON.stringify(looked.display.local) === JSON.stringify(initial.display.local), looked.display);
  check('Held model moves and turns in world space with the camera', JSON.stringify(looked.display.global) !== JSON.stringify(initial.display.global) && looked.display.forwardDot > 0.99, {before: initial.display.global, after: looked.display.global, forwardDot: looked.display.forwardDot});
  const sword = byOp(fresh, 'equip')[0].result;
  check('Sword state swaps the model and hides the crosshair from the same state', sword.equipment.active === 'practice_sword' && sword.equipment.attackMode === 'MELEE' && sword.display.meshPath.endsWith('weapon_sword.obj') && sword.display.visible === true && sword.crosshair.visible === false && sword.crosshair.drawn === false, {equipment: sword.equipment.active, mesh: sword.display.meshPath, crosshair: sword.crosshair.visible});
  const swordAttack = byOp(fresh, 'attack')[0].result;
  check('Sword attack executes melee, uses no ammunition and respects real reach', swordAttack.fired === true && swordAttack.attackMode === 'MELEE' && swordAttack.snapshot.equipment.capacity === 0 && swordAttack.hit === false, swordAttack);
  const backToGun = byOp(fresh, 'equip')[1].result;
  check('Switching back restores the gun model, reticle and untouched ammunition', backToGun.equipment.active === 'pistol' && backToGun.display.meshPath.endsWith('weapon_pistol.obj') && backToGun.crosshair.visible === true && backToGun.crosshair.segments.length === 4 && backToGun.equipment.magazine === 6 && backToGun.equipment.reserve === 12, {crosshair: backToGun.crosshair.segments.length, equipment: backToGun.equipment});

  // --------------------------------------------------- real movement and shooting
  const play = await run(environment, 'base-play', writeScript('play', [
    {op: 'walk', args: {forward: 1.0, frames: 60}},
    {op: 'attack'},
    {op: 'attack'},
    {op: 'wait', args: {frames: 30}},
    {op: 'attack'},
    {op: 'snapshot'},
    {op: 'reload'},
    {op: 'wait', args: {frames: 90}},
    {op: 'snapshot'},
    {op: 'save'},
  ]), ['--base-world-id=fresh-world']);
  report.observations.play = play;
  const walked = play.results[0].result;
  check('Forward movement is real and the body stays on the floor', walked.after.position[2] < walked.before.position[2] && walked.after.onFloor === true, {before: walked.before.position, after: walked.after.position});
  const shots = byOp(play, 'attack').map(entry => entry.result);
  check('Real aim ray hits the centre target with the authored damage', shots[0].fired === true && shots[0].hit === true && shots[0].attackMode === 'RANGED' && shots[0].damage === 12 && shots[0].snapshot.equipment.magazine === 5, {damage: shots[0].damage, hits: shots[0].hits});
  check('A second immediate shot is blocked by the real cooldown', shots[1].fired === false && shots[1].reason === 'cooling-down' && shots[1].snapshot.equipment.magazine === 5, shots[1].reason);
  check('After the cooldown expires the next shot fires and damages the target', shots[2].fired === true && shots[2].damage === 12 && healthOf(shots[2].snapshot, 'target_b') === 26 && shots[2].snapshot.equipment.magazine === 4, {health: healthOf(shots[2].snapshot, 'target_b'), magazine: shots[2].snapshot.equipment.magazine});
  const snapshots = play.results.filter(entry => entry.op === 'snapshot');
  const reloaded = snapshots[1].result;
  check('Reload moves real rounds from the reserve into the magazine', reloaded.equipment.magazine === 6 && reloaded.equipment.reserve === 10, reloaded.equipment);
  const saved = byOp(play, 'save')[0];
  check('Saving writes progress through the real filesystem', saved.result.written === true && saved.result.snapshot.hasSave === true && saved.result.path.startsWith('user://'), saved.result.path);

  const wall = await run(environment, 'base-wall', writeScript('wall', [
    {op: 'walk', args: {right: 1.0, frames: 400}},
    {op: 'snapshot'},
  ]), ['--base-world-id=wall-world']);
  report.observations.wall = wall;
  const pushed = wall.results[1].result;
  check('Sliding into the range wall stops movement instead of passing through it', pushed.player.position[0] > 10 && pushed.player.position[0] < 19.5, pushed.player.position);

  // ------------------------------------------------------------ restart and restore
  const restored = await run(environment, 'base-restored', writeScript('restored', [
    {op: 'snapshot'},
    {op: 'restore'},
    {op: 'snapshot'},
  ]), ['--base-world-id=fresh-world']);
  report.observations.restored = restored;
  const beforeRestore = restored.results[0].result;
  check('A brand new process starts from authored defaults', beforeRestore.equipment.magazine === 6 && beforeRestore.equipment.reserve === 12 && beforeRestore.targets.every(target => target.health === 50), {equipment: beforeRestore.equipment, targets: beforeRestore.targets});
  const afterRestore = restored.results[1].result;
  check('Restore across a full process restart recovers ammo, equipment and target damage', afterRestore.equipment.magazine === 6 && afterRestore.equipment.reserve === 10 && healthOf(afterRestore, 'target_b') === 26, {equipment: afterRestore.equipment, targetB: healthOf(afterRestore, 'target_b')});
  check('Restored player position and look match the saved state', JSON.stringify(afterRestore.player.position) === JSON.stringify(saved.result.snapshot.player.position) && afterRestore.player.yaw === saved.result.snapshot.player.yaw, {saved: saved.result.snapshot.player, restored: afterRestore.player});
  check('A restored world reports the same save on disk', afterRestore.hasSave === true && afterRestore.persistentStorage === true, {hasSave: afterRestore.hasSave, persistent: afterRestore.persistentStorage});

  // ------------------------------------------------------------- melee at real reach
  // Approach with real movement first, then aim at the target from the position
  // the physics actually produced, exactly as a player would.
  const approach = await run(environment, 'base-melee-approach', writeScript('melee-approach', [
    {op: 'equip', args: {value: 'practice_sword'}},
    {op: 'look', args: {yaw: YAW_TO_TARGET_A, pitch: 0.0}},
    {op: 'walk', args: {forward: 1.0, frames: 200}},
    {op: 'snapshot'},
  ]), ['--base-world-id=melee-world']);
  report.observations.meleeApproach = approach;
  const approached = approach.results[3].result;
  check('Walking with the sword equipped closes the real distance to the target', approached.player.position[2] < 0 && approached.display.meshPath.endsWith('weapon_sword.obj') && approached.crosshair.visible === false, {position: approached.player.position, mesh: approached.display.meshPath});
  const standing = approached.player.position;
  const toTargetX = -3 - standing[0];
  const toTargetZ = -6 - standing[2];
  const meleeYaw = Math.atan2(-toTargetX, -toTargetZ);
  const meleePitch = Math.atan2(1.05 - 1.6, Math.hypot(toTargetX, toTargetZ));
  const melee = await run(environment, 'base-melee', writeScript('melee', [
    {op: 'equip', args: {value: 'practice_sword'}},
    {op: 'look', args: {yaw: YAW_TO_TARGET_A, pitch: 0.0}},
    {op: 'walk', args: {forward: 1.0, frames: 200}},
    {op: 'look', args: {yaw: meleeYaw, pitch: meleePitch}},
    {op: 'snapshot'},
    {op: 'attack'},
    {op: 'snapshot'},
  ]), ['--base-world-id=melee-world']);
  report.observations.melee = melee;
  const meleeAim = melee.results[4].result;
  check('Aimed sword melee reports the target inside real reach', meleeAim.aim.hit === true && meleeAim.aim.collider === 'TargetA' && meleeAim.display.meshPath.endsWith('weapon_sword.obj'), meleeAim.aim);
  const meleeHit = melee.results[5].result;
  check('Sword melee damages a target inside its real reach', meleeHit.fired === true && meleeHit.hit === true && meleeHit.attackMode === 'MELEE' && meleeHit.damage === 20 && healthOf(meleeHit.snapshot, 'target_a') === 30, {damage: meleeHit.damage, targetA: healthOf(meleeHit.snapshot, 'target_a')});

  // ------------------------------------------------- quest completion and one-time reward
  const questScript = [{op: 'look', args: {yaw: 0.0, pitch: 0.0}}];
  for (let index = 0; index < 5; index++) questScript.push({op: 'attack'}, {op: 'wait', args: {frames: 25}});
  questScript.push({op: 'look', args: {yaw: YAW_TO_TARGET_A, pitch: 0.0}}, {op: 'attack'}, {op: 'wait', args: {frames: 25}}, {op: 'reload'}, {op: 'wait', args: {frames: 80}});
  for (let index = 0; index < 4; index++) questScript.push({op: 'attack'}, {op: 'wait', args: {frames: 25}});
  questScript.push({op: 'snapshot'}, {op: 'save'});
  const quest = await run(environment, 'base-quest', writeScript('quest', questScript), ['--base-world-id=quest-world']);
  report.observations.quest = quest;
  const questState = byOp(quest, 'snapshot')[0].result;
  check('Destroying two targets completes the authored quest', questState.targets.filter(target => target.destroyed).length === 2 && questState.quests.quests[0].status === 2 && questState.quests.quests[0].rewardGranted === true, {destroyed: questState.targets.filter(target => target.destroyed).map(target => target.id), quest: questState.quests.quests});
  check('Quest completion grants the reserve and inventory reward exactly once', questState.equipment.reserve === 18 && questState.inventory.slots.some(slot => slot.id === 'marksman_badge' && slot.count === 1), {reserve: questState.equipment.reserve, inventory: questState.inventory});
  check('The HUD shows the live quest and inventory from the same state', questState.hud.quests.includes('✔') && questState.hud.inventory.includes('marksman_badge'), questState.hud);

  const questRestart = await run(environment, 'base-quest-restart', writeScript('quest-restart', [
    {op: 'restore'},
    {op: 'snapshot'},
  ]), ['--base-world-id=quest-world']);
  report.observations.questRestart = questRestart;
  const questAfter = questRestart.results[0].result;
  check('Quest progress and the one-time reward survive a full restart', questAfter.quests.quests[0].status === 2 && questAfter.quests.quests[0].rewardGranted === true && questAfter.inventory.slots.some(slot => slot.id === 'marksman_badge' && slot.count === 1) && questAfter.equipment.reserve === 18, {quest: questAfter.quests.quests, inventory: questAfter.inventory, reserve: questAfter.equipment.reserve});

  // ------------------------------------------------------------- blank starting point
  const blank = await run(environment, 'base-blank', writeScript('blank', [
    {op: 'snapshot'},
    {op: 'walk', args: {forward: 1.0, frames: 30}},
    {op: 'attack'},
    {op: 'save'},
    {op: 'restore'},
  ]), ['--base-world-id=blank-world'], 'res://scenes/blank_start.tscn');
  report.observations.blank = blank;
  const blankInitial = blank.results[0].result;
  check('Blank start runs as its own real scene with no targets or interactables', blankInitial.levelTitle === 'Blank start' && blankInitial.crosshair.drawn === true && blankInitial.equipment.active === 'pistol' && blankInitial.targets.length === 0 && blankInitial.interactables.length === 0, {title: blankInitial.levelTitle, targets: blankInitial.targets.length, interactables: blankInitial.interactables.length});
  const blankWalk = blank.results[1].result;
  check('Blank start moves with real physics and fires with no target present', blankWalk.after.position[2] < blankWalk.before.position[2] && byOp(blank, 'attack')[0].result.fired === true && byOp(blank, 'attack')[0].result.hit === false, {before: blankWalk.before.position, after: blankWalk.after.position});
  check('Blank start saves and restores its own world identity', blank.results.at(-1).result.equipment.magazine === 5 && blank.results.at(-1).result.worldId === 'blank-world', blank.results.at(-1).result.equipment);

  // ------------------------------------------------------------------- interaction
  const interact = await run(environment, 'base-interact', writeScript('interact', [
    {op: 'look', args: {yaw: -0.827, pitch: -0.45}},
    {op: 'snapshot'},
    {op: 'interact'},
    {op: 'save'},
  ]), ['--base-world-id=interact-world']);
  report.observations.interact = interact;
  const aimed = interact.results[1].result;
  check('Pointing at the crate produces a real aim result and prompt', aimed.aim.hit === true && aimed.aim.interactable === true && aimed.aim.prompt.length > 0 && aimed.hud.prompt.length > 0, {aim: aimed.aim, hud: aimed.hud.prompt});
  const taken = interact.results[2].result;
  check('Interacting adds real reserve ammunition through EquipmentState', taken.handled === true && taken.ammo === 12 && taken.snapshot.equipment.reserve === 24, taken);
  const interactRestart = await run(environment, 'base-interact-restart', writeScript('interact-restart', [
    {op: 'restore'},
    {op: 'snapshot'},
  ]), ['--base-world-id=interact-world']);
  report.observations.interactRestart = interactRestart;
  check('Interactable state and the granted ammunition survive a restart', interactRestart.results[0].result.interactables.some(entry => entry.id === 'AmmoCrate' && entry.usesLeft === 2) && interactRestart.results[0].result.equipment.reserve === 24, {interactables: interactRestart.results[0].result.interactables, reserve: interactRestart.results[0].result.equipment.reserve});

  // ------------------------------------------------------------ rejection of bad state
  const invalid = await run(environment, 'base-invalid', writeScript('invalid', [
    {op: 'snapshot'},
    {op: 'restore-state', args: {state: {format: 'craftmine.godot-base-state/1', stateVersion: 1, worldId: 'fresh-world', base: 'first-person', player: {position: [0, 1, 2]}, equipment: {active: 'pistol', items: []}, inventory: {slots: []}, targets: [], quests: {quests: []}}}},
    {op: 'snapshot'},
    {op: 'restore-state', args: {state: {format: 'craftmine.godot-base-state/1', stateVersion: 99, worldId: 'fresh-world', base: 'first-person'}}},
    {op: 'snapshot'},
  ]), ['--base-world-id=fresh-world']);
  report.observations.invalid = invalid;
  check('An incomplete state is rejected with a concrete reason', typeof invalid.results[1].error === 'string' && invalid.results[1].error.length > 0, invalid.results[1].error);
  check('A newer state version is rejected instead of being guessed at', typeof invalid.results[3].error === 'string' && invalid.results[3].error.includes('newer'), invalid.results[3].error);
  check('Rejected states leave the live world completely unchanged', JSON.stringify(invalid.results[0].result) === JSON.stringify(invalid.results[2].result) && JSON.stringify(invalid.results[2].result) === JSON.stringify(invalid.results[4].result));

  // ------------------------------------------------------------------ asset source
  const meshCheck = await run(environment, 'base-mesh-check', writeScript('mesh-check', [{op: 'snapshot'}]), ['--base-world-id=fresh-world']);
  check('Equipment models resolve to the authored OBJ assets in this project', meshCheck.results[0].result.display.meshPath.startsWith('res://assets/meshes/'), meshCheck.results[0].result.display.meshPath);
  // ------------------------------------------------- attack block reasons and reticle colour
  const sameColor = (a, b, tolerance = 0.01) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => Math.abs(value - b[index]) <= tolerance);
  const STYLE_COLOR = [1, 1, 1, 0.92];
  const HIT_COLOR = [1, 0.45, 0.3, 1];
  const COOLDOWN_COLOR = [1, 0.8, 0.35, 0.9];
  const blocksA = await run(environment, 'base-blocks-a', writeScript('blocks-a', [
    {op: 'snapshot'},
    {op: 'attack'},
    {op: 'attack'},
    {op: 'wait', args: {frames: 12}},
    {op: 'snapshot'},
    {op: 'wait', args: {frames: 25}},
    {op: 'reload'},
    {op: 'attack'},
    {op: 'wait', args: {frames: 90}},
    {op: 'snapshot'},
  ]), ['--base-world-id=blocks-world']);
  report.observations.blocksA = blocksA;
  check('A ready weapon shows the style colour before any attack', sameColor(blocksA.results[0].result.crosshair.color, STYLE_COLOR), blocksA.results[0].result.crosshair.color);
  check('A confirmed hit turns the reticle to the hit colour', sameColor(blocksA.results[1].result.snapshot.crosshair.color, HIT_COLOR), blocksA.results[1].result.snapshot.crosshair.color);
  check('A second attack is refused while cooling down', blocksA.results[2].result.fired === false && blocksA.results[2].result.reason === 'cooling-down', blocksA.results[2].result.reason);
  check('The reticle shows the cooldown colour while the item is cooling down', sameColor(blocksA.results[4].result.crosshair.color, COOLDOWN_COLOR), blocksA.results[4].result.crosshair.color);
  check('An attack is refused while reloading', blocksA.results[7].result.fired === false && blocksA.results[7].result.reason === 'reloading', blocksA.results[7].result.reason);
  check('After the reload the reticle returns to the style colour and the magazine is full', sameColor(blocksA.results[9].result.crosshair.color, STYLE_COLOR) && blocksA.results[9].result.equipment.magazine === 6 && blocksA.results[9].result.equipment.reserve === 11, {color: blocksA.results[9].result.crosshair.color, equipment: blocksA.results[9].result.equipment});

  const blocksB = await run(environment, 'base-blocks-b', writeScript('blocks-b', [
    {op: 'attack'}, {op: 'snapshot'}, {op: 'wait', args: {frames: 25}}, {op: 'snapshot'},
    {op: 'attack'}, {op: 'wait', args: {frames: 25}},
    {op: 'attack'}, {op: 'wait', args: {frames: 25}},
    {op: 'attack'}, {op: 'wait', args: {frames: 25}},
    {op: 'attack'}, {op: 'wait', args: {frames: 25}},
    {op: 'attack'},
    {op: 'snapshot'},
    {op: 'wait', args: {frames: 25}},
    {op: 'attack'},
    {op: 'equip', args: {value: 'inspection_tool'}},
    {op: 'snapshot'},
    {op: 'attack'},
  ]), ['--base-world-id=blocks-world']);
  report.observations.blocksB = blocksB;
  check('An empty magazine refuses the next attack with the empty reason', blocksB.results[13].result.equipment.magazine === 0 && blocksB.results[15].result.fired === false && blocksB.results[15].result.reason === 'empty', {magazine: blocksB.results[13].result.equipment.magazine, reason: blocksB.results[15].result.reason});
  const tool = blocksB.results[17].result;
  check('A no-attack item shows no model and no reticle from the same state', tool.equipment.active === 'inspection_tool' && tool.equipment.attackMode === 'NONE' && tool.crosshair.visible === false && tool.display.visible === false, {equipment: tool.equipment, crosshair: tool.crosshair.visible, display: tool.display.visible});
  check('A no-attack item refuses an attack with the no-attack reason', blocksB.results[18].result.fired === false && blocksB.results[18].result.reason === 'no-attack', blocksB.results[18].result.reason);

  // ------------------------------------------------ rollback after a mid-apply failure
  const rollbackState = {
    worldId: 'rollback-world',
    format: 'craftmine.godot-base-state/1',
    stateVersion: 1,
    base: 'first-person',
    player: {position: [7.5, 0.9, -3.25], yaw: 1.0, pitch: 0.0},
    equipment: {active: 'pistol', items: [
      {id: 'pistol', magazine: 1, reserve: 3},
      {id: 'practice_sword', magazine: 0, reserve: 0},
      {id: 'inspection_tool', magazine: 0, reserve: 0},
    ]},
    inventory: {slots: [{id: 'bogus_item', count: 1}]},
    targets: [],
    interactables: [],
    quests: {quests: [{id: 'range_basic', status: 1, count: 0, rewardGranted: false}]},
  };
  const rollback = await run(environment, 'base-rollback', writeScript('rollback', [
    {op: 'snapshot'},
    {op: 'restore-state', args: {state: rollbackState}},
    {op: 'snapshot'},
  ]), ['--base-world-id=rollback-world']);
  report.observations.rollback = rollback;
  check('A state that fails on a later block is rejected with a concrete reason', typeof rollback.results[1].error === 'string' && rollback.results[1].error.length > 0, rollback.results[1].error);
  check('Blocks applied before the failure are rolled back completely', JSON.stringify(rollback.results[0].result) === JSON.stringify(rollback.results[2].result), {before: rollback.results[0].result.player, after: rollback.results[2].result.player, inventory: rollback.results[2].result.inventory});

  // ------------------------------------------------------------- world identity isolation
  const isolation = await run(environment, 'base-isolation', writeScript('isolation', [
    {op: 'snapshot'},
    {op: 'restore'},
  ]), ['--base-world-id=a-world-with-no-save']);
  report.observations.isolation = isolation;
  check('A world with no save of its own cannot read another world progress', typeof isolation.results[1].error === 'string' && isolation.results[1].error.includes('missing') && isolation.results[0].result.worldId === 'a-world-with-no-save', isolation.results[1].error);

  // ------------------------------------- change damage in source, keep the progress
  // This mutates the project source, so it runs last.
  const weaponFile = path.join(project, 'data/equipment/pistol.tres');
  const weaponSource = fs.readFileSync(weaponFile, 'utf8');
  assert.ok(weaponSource.includes('damage = 12.0'), 'Authored damage marker must exist');
  fs.writeFileSync(weaponFile, weaponSource.replace('damage = 12.0', 'damage = 7.0'));
  await environment.run('base-reimport', ['--path', project, '--editor', '--import']);
  const changed = await run(environment, 'base-changed', writeScript('changed', [
    {op: 'restore'},
    {op: 'attack'},
    {op: 'wait', args: {frames: 40}},
    {op: 'attack'},
    {op: 'snapshot'},
  ]), ['--base-world-id=fresh-world']);
  report.observations.changed = changed;
  const changedRestore = changed.results[0].result;
  check('Edited source damage applies without discarding saved progress', changedRestore.equipment.damage === 7 && changedRestore.equipment.reserve === 10 && healthOf(changedRestore, 'target_b') === 26, {damage: changedRestore.equipment.damage, reserve: changedRestore.equipment.reserve, targetB: healthOf(changedRestore, 'target_b')});
  const changedShots = byOp(changed, 'attack').map(entry => entry.result);
  check('The edited damage drives the next real hit', changedShots[0].damage === 7 && healthOf(changedShots[0].snapshot, 'target_b') === 19 && changedShots[1].damage === 7 && healthOf(changedShots[1].snapshot, 'target_b') === 12, {first: healthOf(changedShots[0].snapshot, 'target_b'), second: healthOf(changedShots[1].snapshot, 'target_b')});
} catch (error) {
  report.errors.push(String(error.stack));
  process.exitCode = 1;
  console.error(error.message);
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log('Evidence: ' + out);
}
