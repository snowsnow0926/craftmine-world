import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This regression runs the real `exerciseP8Gameplay` from the Main TypeScript
// source. It exists because source-regex checks and hand-built action arrays
// cannot catch a wiring bug: the first version of this helper performed real
// product commands but never recorded them, so a run would have produced an empty
// action list while every unit test passed.
//
// The injected GodotGameplayAccess returns the shapes recorded from real product
// receipts (first-person snapshot with equipment/display/aim/inventory, PickupItem
// interact result, town snapshot with physical.overlaps, move result with
// distance).
const root = fileURLToPath(new URL('../../../', import.meta.url));
const helper = path.join(root, 'vendor/pi-desktop/apps/desktop/electron/main/craftmine-acceptance-p8-gameplay.ts');
const { exerciseP8Gameplay } = await import(pathToFileURL(helper).href);

const fp = (over = {}) => ({
  base: 'first-person', worldId: over.worldId ?? 'world-hammer', levelTitle: 'Training range', viewportSize: [1200, 800],
  equipment: { active: 'thunder_hammer', displayName: 'Thunder hammer', attackMode: 'MELEE', damage: 20, cooldownSeconds: 1.5, cooldownRemaining: 0, blockReason: '', magazine: 0, capacity: 0, reserve: 0, reloading: false, crosshairVisible: true, ...(over.equipment ?? {}) },
  display: { visible: true, meshPath: 'res://assets/meshes/thunder_hammer.obj', attachedToCamera: true, alignedWithCamera: true },
  aim: { hit: true, collider: 'ThunderHammerPickup', position: [0, 1, 4], interactable: true, prompt: 'Pick up  thunder_hammer  [E]' },
  player: { onFloor: true, pitch: 0, position: [0, 0.9, 6], yaw: 0 },
  inventory: { slots: over.slots ?? [] },
  quests: { quests: [] }, hud: {}, targets: over.targets ?? [{ id: 'target_a', hitCount: 0, damageTaken: 0, destroyed: false, health: 50 }],
  interactables: over.interactables ?? [{ id: 'ThunderHammerPickup', enabled: true, taken: false }],
});
const td = (over = {}) => ({
  format: 'craftmine.godot-topdown-snapshot/1', worldId: over.worldId ?? 'world-dog', coins: 40, inventory: {}, quests: {}, flags: {}, shops: {}, grantedRewards: {}, scenePositions: {},
  player: { sceneId: 'overworld', position: [104, 168], facing: 'down' }, sceneId: 'overworld', duplicateEntityIds: [], bootError: '', maps: {}, sprite: {},
  physical: { playerPosition: [104, 168], facing: 'down', overlaps: over.overlaps ?? { 'p8-dog': true } },
});
const envelope = (worldId, baseId, payload) => ({ format: 'craftmine.godot-observation/1', worldId, buildId: 'build-1', instanceId: 'instance-1', baseId, baseVersion: '0.1.0', sampledAt: '2026-09-10T12:00:00Z', protocol: 'craftmine.godot-runtime/2', payload });

/** A fake runtime that answers with real product shapes and can be told to fail. */
function runtime({ baseId, worldId, faults = {} } = {}) {
  const ops = [];
  let picked = false, fired = 0;
  const observe = async () => envelope(worldId, baseId, baseId === 'first-person' ? fp({ slots: picked ? [{ id: 'thunder_hammer', count: 1 }] : [], interactables: picked ? [{ id: 'ThunderHammerPickup', enabled: true, taken: true }] : undefined }) : td({ overlaps: { 'p8-dog': true } }));
  return {
    ops,
    access: {
      observe,
      action: async (op, args) => {
        ops.push({ op, args });
        if (faults[op]) throw Error(faults[op]);
        if (op === 'interact') { if (!picked) { picked = true; return { handled: true, item: 'thunder_hammer', count: 1, taken: true }; } return { handled: false, reason: 'empty' }; }
        if (op === 'fire' || op === 'attack') { fired += 1; return { fired: fired !== 2, reason: fired === 2 ? 'cooling-down' : '', hits: fired === 2 ? [] : [{ collider: 'TargetA', distance: 2.1 }], damage: fired === 2 ? 0 : 20, equipment: 'thunder_hammer', attackMode: 'MELEE', shot: fired }; }
        if (op === 'move') return { ok: true, before: [104, 168], after: [104 + Number(args.steps) * 1.4667, 168], distance: Number(args.steps) * 1.4667, blocked: false, facing: 'down', sceneId: 'overworld', steps: args.steps };
        if (op === 'talk') return { ok: true, npcId: 'p8-dog', name: '小狗', line: '汪！', questId: '', questStatus: 'inactive' };
        return { ok: true };
      },
      capture: async (width, height) => ({ pngBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', width, height, pixelStats: { bytes: 4, sampledColors: 1 }, viewportObservation: await observe() }),
    },
  };
}

test('the real hammer plan records every action, frame and error it produced', async () => {
  const fake = runtime({ baseId: 'first-person', worldId: 'world-hammer' });
  const result = await exerciseP8Gameplay(fake.access, 'hammer', 'world-hammer');
  assert.ok(Array.isArray(result.actions) && result.actions.length >= 15, 'actions must be recorded, not only performed');
  assert.equal(result.caseId, 'hammer'); assert.equal(result.before.format, 'craftmine.godot-observation/1');
  for (const [index, action] of result.actions.entries()) {
    assert.equal(typeof action.op, 'string', 'op at ' + index);
    assert.equal(typeof action.args, 'object', 'args at ' + index);
    assert.ok('result' in action, 'raw result at ' + index);
    assert.equal(action.observation?.format, 'craftmine.godot-observation/1', 'observation envelope at ' + index);
    assert.ok(Number.isFinite(action.commandStartedAtMs) && Number.isFinite(action.commandCompletedAtMs) && Number.isFinite(action.observedAtMs), 'real receipt times at ' + index);
    assert.ok(action.commandCompletedAtMs >= action.commandStartedAtMs && action.observedAtMs >= action.commandCompletedAtMs, 'times must be ordered at ' + index);
  }
  const ops = result.actions.map(action => action.op);
  assert.deepEqual(ops.slice(0, 3), ['resume', 'look', 'interact']);
  assert.ok(ops.includes('equip') && ops.includes('fire') && ops.includes('wait'));
  // The sweep stops early once the hammer is really carried: one interact only.
  assert.equal(ops.filter(op => op === 'interact').length, 1, 'the pickup sweep must stop at the first real pickup');
  assert.equal(result.plan.interactions, 1); assert.equal(result.plan.actions, result.actions.length);
  const frames = result.actions.filter(action => action.frame);
  assert.ok(frames.length >= 4 && frames.length <= result.plan.maxFrames, 'frames in ' + frames.length);
  for (const action of frames) {
    assert.ok(action.frame.pngBase64.startsWith('iVBORw0KGgo'), 'real PNG bytes');
    assert.equal(action.frame.width, 1280); assert.equal(action.frame.height, 720);
    assert.ok(Number.isFinite(action.frame.capturedAtMs) && action.frame.capturedAtMs >= action.frame.captureStartedAtMs, 'capture timing');
  }
  // Every attack frame says which attack it belongs to, and the first attack frame
  // is associated with that same attack rather than a previous one.
  const attackFrames = frames.filter(action => action.op === 'fire');
  assert.ok(attackFrames.length >= 2);
  assert.equal(attackFrames[0].frame.associatedAttack.attackIndex, 1);
  assert.equal(attackFrames[0].frame.associatedAttack.op, 'fire');
  assert.equal(attackFrames[0].frame.offsetFromAttackCompletedMs >= 0, true);
  assert.equal(attackFrames[1].frame.associatedAttack.attackIndex >= 2, true, 'a later frame must not claim the previous attack');
  assert.ok(attackFrames.every(action => Number.isFinite(action.frame.offsetFromAttackObservedMs)));
  assert.equal(fake.ops.some(entry => entry.op === 'equip' && entry.args.value === 'thunder_hammer'), true);
});

test('the real dog plan records its legs, talks and frames, and never invents a distance', async () => {
  const fake = runtime({ baseId: 'top-down', worldId: 'world-dog' });
  const result = await exerciseP8Gameplay(fake.access, 'dog', 'world-dog');
  const ops = result.actions.map(action => action.op);
  assert.deepEqual(ops.slice(0, 2), ['resume', 'talk']);
  assert.ok(ops.filter(op => op === 'move').length >= 4, 'the far leg and the walk back must both be recorded');
  assert.ok(ops.filter(op => op === 'talk').length >= 3);
  const moves = result.actions.filter(action => action.op === 'move');
  for (const move of moves) {
    assert.equal(typeof move.result.distance, 'number', 'the recorded move result carries the real distance');
    assert.equal(move.args.steps <= 600, true, 'op arguments stay inside the product limits');
  }
  assert.ok(result.actions.some(action => action.op === 'move' && action.result.distance >= 250), 'a genuinely long leg exists');
  assert.ok(result.actions.filter(action => action.frame).length <= result.plan.maxFrames);
  assert.equal(fake.ops.every(entry => ['resume', 'talk', 'move', 'wait'].includes(entry.op)), true, 'the dog plan uses only ordinary town operations');
});

test('a failing operation is recorded as evidence and does not abort the plan', async () => {
  const fake = runtime({ baseId: 'first-person', worldId: 'world-hammer', faults: { fire: 'P8_GAMEPLAY_FAILED' } });
  const result = await exerciseP8Gameplay(fake.access, 'hammer', 'world-hammer');
  const failed = result.actions.filter(action => action.result?.error);
  assert.ok(failed.length >= 5, 'every refused attack is retained, not swallowed');
  assert.ok(failed.every(action => action.result.error === 'P8_GAMEPLAY_FAILED'));
  assert.ok(result.actions.at(-1).op === 'fire', 'the plan still runs to the end');
  assert.ok(result.actions.some(action => action.frame?.associatedAttack?.fired === false), 'a frame can be associated with a refused attack');
});

test('a talk the running build refuses is retained with the product error text', async () => {
  const fake = runtime({ baseId: 'top-down', worldId: 'world-dog', faults: { talk: 'out_of_range' } });
  const result = await exerciseP8Gameplay(fake.access, 'dog', 'world-dog');
  const talks = result.actions.filter(action => action.op === 'talk');
  assert.ok(talks.length >= 3);
  assert.ok(talks.every(action => action.result.error === 'out_of_range'));
});

test('the plan refuses to keep running when the runtime identity changes', async () => {
  const fake = runtime({ baseId: 'first-person', worldId: 'world-hammer' });
  let calls = 0;
  const access = { ...fake.access, observe: async () => { calls += 1; const value = await fake.access.observe(); return calls > 2 ? { ...value, instanceId: 'foreign' } : value; } };
  await assert.rejects(exerciseP8Gameplay(access, 'hammer', 'world-hammer'), /P8_RUNTIME_CHANGED/);
});
