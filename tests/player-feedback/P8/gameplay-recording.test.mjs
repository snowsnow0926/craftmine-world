import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { evaluateGameplay } from './gameplay-criteria.mjs';

// This regression runs the real `exerciseP8Gameplay` from the Main TypeScript
// source. It exists because source-regex checks and hand-built action arrays
// cannot catch a wiring bug: the first version of this helper performed real
// product commands but never recorded them, so a run would have produced an empty
// action list while every unit test passed. The stubs below reproduce the real
// geometry the plan has to survive — a ray from eye height, a small contact radius
// on a small map with walls, and a cooldown gate — so a plan that cannot work in
// the product fails here.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const helper = path.join(root, 'vendor/pi-desktop/apps/desktop/electron/main/craftmine-acceptance-p8-gameplay.ts');
const { exerciseP8Gameplay } = await import(pathToFileURL(helper).href);

const FPS = 60, EYE_HEIGHT = 1.6;
/** First-person runtime with the base's real aiming geometry: the aim ray is the
 * camera's -Z, a negative pitch looks down, and a ray meets the ground at
 * eye_height / tan(|pitch|). */
function firstPerson({ pickup = null, refuseInteract = false, cooldownSeconds = 1.0 } = {}) {
  const state = { yaw: 0, pitch: 0, x: 0, z: 6, carried: false, shots: 0, hits: 0, gameMs: 0, cooldownUntil: -1 };
  const ops = [];
  const itemPos = pickup ? [-Math.sin(pickup.bearing) * pickup.distance, 0.05, 6 - Math.cos(pickup.bearing) * pickup.distance] : null;
  const direction = () => [-Math.cos(state.pitch) * Math.sin(state.yaw), Math.sin(state.pitch), -Math.cos(state.pitch) * Math.cos(state.yaw)];
  const rayHitsItem = () => {
    if (!itemPos || state.carried) return false;
    const origin = [state.x, EYE_HEIGHT, state.z], d = direction();
    for (let t = 0.1; t <= 3.5; t += 0.01) {
      const at = [origin[0] + d[0] * t, origin[1] + d[1] * t, origin[2] + d[2] * t];
      if (Math.abs(at[0] - itemPos[0]) <= 0.2 && Math.abs(at[1] - itemPos[1]) <= 0.2 && Math.abs(at[2] - itemPos[2]) <= 0.2) return true;
    }
    return false;
  };
  const snapshot = () => ({
    base: 'first-person', worldId: 'world-hammer', levelTitle: 'Training range', viewportSize: [1200, 800],
    equipment: { active: state.carried ? 'thunder_hammer' : '', displayName: 'Thunder hammer', attackMode: 'MELEE', damage: 20,
      cooldownSeconds, cooldownRemaining: Math.max(0, state.cooldownUntil - state.gameMs) / 1000, blockReason: state.gameMs < state.cooldownUntil ? 'cooling-down' : '',
      magazine: 0, capacity: 0, reserve: 0, reloading: false, crosshairVisible: true },
    display: { visible: state.carried, meshPath: state.carried ? 'res://assets/meshes/thunder_hammer.obj' : '', attachedToCamera: true, alignedWithCamera: true },
    aim: { hit: Boolean(itemPos), collider: rayHitsItem() ? 'ThunderHammerPickup' : 'TargetA', position: [0, 1, 4], interactable: rayHitsItem(), prompt: rayHitsItem() ? 'Pick up  thunder_hammer  [E]' : '' },
    player: { position: [state.x, 0.9, state.z], yaw: state.yaw, pitch: state.pitch, onFloor: true },
    inventory: { slots: state.carried ? [{ id: 'thunder_hammer', count: 1 }] : [] },
    interactables: [{ id: 'ThunderHammerPickup', enabled: true, taken: state.carried }],
    targets: [{ id: 'target_a', hitCount: state.hits, damageTaken: state.hits * 20, destroyed: false, health: 50 - state.hits * 20 }],
    quests: { quests: [] }, hud: { message: '' },
  });
  const envelope = () => ({ format: 'craftmine.godot-observation/1', worldId: 'world-hammer', buildId: 'build-1', instanceId: 'instance-1', baseId: 'first-person', baseVersion: '0.1.0', sampledAt: '2026-09-10T12:00:00Z', protocol: 'craftmine.godot-runtime/2', payload: snapshot() });
  return {
    ops,
    access: {
      observe: async () => envelope(),
      action: async (op, args) => {
        ops.push({ op, args });
        if (op === 'look') { state.yaw = Number(args.yaw ?? state.yaw); state.pitch = Number(args.pitch ?? state.pitch); return snapshot(); }
        if (op === 'walk') { state.z += direction()[2] * (4.5 / FPS) * Number(args.frames ?? 30); state.gameMs += (Number(args.frames ?? 30) / FPS) * 1000; return snapshot(); }
        if (op === 'wait') { state.gameMs += (Number(args.frames ?? 1) / FPS) * 1000; return snapshot(); }
        if (op === 'interact') {
          if (rayHitsItem() && !refuseInteract) { state.carried = true; return { handled: true, item: 'thunder_hammer', count: 1, taken: true, snapshot: snapshot() }; }
          return { handled: false, reason: 'no-target', snapshot: snapshot() };
        }
        if (op === 'equip') return state.carried ? snapshot() : (() => { throw Error('Unknown equipment: thunder_hammer'); })();
        if (op === 'fire' || op === 'attack') {
          state.shots += 1;
          if (state.gameMs < state.cooldownUntil) return { fired: false, reason: 'cooling-down', hits: [], damage: 0, equipment: 'thunder_hammer', attackMode: 'MELEE', shot: state.shots, snapshot: snapshot() };
          state.hits += 1; state.cooldownUntil = state.gameMs + cooldownSeconds * 1000;
          return { fired: true, reason: '', hits: [{ collider: 'TargetA', distance: 2.1 }], damage: 20, equipment: 'thunder_hammer', attackMode: 'MELEE', shot: state.shots, snapshot: snapshot() };
        }
        return { ok: true, snapshot: snapshot() };
      },
      capture: async (width, height) => ({ pngBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', width, height, pixelStats: { bytes: 4, sampledColors: 1 }, viewportObservation: envelope() }),
    },
  };
}

/** Town runtime with the base's real map bounds, movement speed and a small
 * contact area, so `physical.overlaps` decides contact from the position the plan
 * actually walked to. */
function town({ dogStop = { x: 397, y: 168 }, radius = { x: 15, y: 14 }, bounds = { minX: 16, maxX: 620, minY: 16, maxY: 330 } } = {}) {
  const player = { x: 104, y: 168 }, ops = [];
  let gameMs = 0;
  const inContact = () => Math.abs(player.x - dogStop.x) <= radius.x && Math.abs(player.y - dogStop.y) <= radius.y;
  const snapshot = () => ({
    format: 'craftmine.godot-topdown-snapshot/1', worldId: 'world-dog', stateVersion: 1, coins: 40, inventory: {}, shops: {}, quests: {}, grantedRewards: {}, flags: {}, scenePositions: {},
    player: { sceneId: 'overworld', position: [player.x, player.y], facing: 'down' }, sceneId: 'overworld', duplicateEntityIds: [], bootError: '', maps: {}, sprite: { frame: 0, facing: 'down', moving: false },
    physical: { playerPosition: [player.x, player.y], facing: 'down', overlaps: { 'p8-dog': inContact() } },
  });
  const envelope = () => ({ format: 'craftmine.godot-observation/1', worldId: 'world-dog', buildId: 'build-1', instanceId: 'instance-1', baseId: 'top-down', baseVersion: '1.0.0', sampledAt: '2026-09-10T12:00:00Z', protocol: 'craftmine.godot-runtime/2', payload: snapshot() });
  return {
    ops, contact: inContact, position: { ...player },
    access: {
      observe: async () => envelope(),
      action: async (op, args) => {
        ops.push({ op, args });
        if (op === 'move') {
          const before = { x: player.x, y: player.y }, speed = 88 / FPS, steps = Number(args.steps ?? 1);
          for (let index = 0; index < steps; index++) {
            player.x = Math.min(bounds.maxX, Math.max(bounds.minX, player.x + Number(args.dx ?? 0) * speed));
            player.y = Math.min(bounds.maxY, Math.max(bounds.minY, player.y + Number(args.dy ?? 0) * speed));
          }
          gameMs += (steps / FPS) * 1000;
          return { ok: true, before: [before.x, before.y], after: [player.x, player.y], distance: Math.hypot(player.x - before.x, player.y - before.y), blocked: Math.hypot(player.x - before.x, player.y - before.y) <= 0.01, facing: 'down', sceneId: 'overworld', steps };
        }
        if (op === 'wait') { gameMs += (Number(args.frames ?? 1) / FPS) * 1000; return { ok: true, frames: args.frames }; }
        if (op === 'talk') {
          if (!inContact()) throw Error('out_of_range');
          return { ok: true, npcId: 'p8-dog', name: '小狗', line: '汪！', questId: '', questStatus: 'inactive', snapshot: snapshot() };
        }
        return { ok: true };
      },
      capture: async (width, height) => ({ pngBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', width, height, pixelStats: { bytes: 4, sampledColors: 1 }, viewportObservation: envelope() }),
    },
  };
}
const dogSource = [{ path: 'data/npcs/p8-dog.json', kind: 'source', text: '{ "id": "p8-dog", "name": "小狗", "sprite": "res://assets/characters/dog.png", "lines": [{ "when": "always", "text": "汪！" }] }' }];

test('the real hammer plan records every action, frame and error it produced', async () => {
  const fake = firstPerson({ pickup: { bearing: 0, distance: 1.2 } });
  const result = await exerciseP8Gameplay(fake.access, 'hammer', 'world-hammer');
  assert.ok(Array.isArray(result.actions) && result.actions.length >= 15, 'actions must be recorded, not only performed');
  assert.equal(result.caseId, 'hammer');
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
  const frames = result.actions.filter(action => action.frame);
  assert.ok(frames.length >= 4 && frames.length <= result.plan.maxFrames, 'frames in ' + frames.length);
  for (const action of frames) {
    assert.ok(action.frame.pngBase64.startsWith('iVBORw0KGgo'), 'real PNG bytes');
    assert.equal(action.frame.width, 1280); assert.equal(action.frame.height, 720);
    assert.ok(Number.isFinite(action.frame.capturedAtMs) && action.frame.capturedAtMs >= action.frame.captureStartedAtMs, 'capture timing');
  }
  const attackFrames = frames.filter(action => action.op === 'fire');
  assert.ok(attackFrames.length >= 2);
  // The captured attacks are the third, fourth and seventh attack commands: the
  // first two are deliberately left uncaptured so their gap stays real.
  assert.deepEqual(attackFrames.map(action => action.frame.associatedAttack.attackIndex), [3, 4, 7]);
  for (const action of attackFrames) assert.equal(action.frame.associatedAttack.fired, action.result.fired, 'the frame keeps the actual attack outcome, including a cooldown refusal');
  assert.ok(attackFrames.every(action => Number.isFinite(action.frame.offsetFromAttackObservedMs) && Number.isFinite(action.frame.offsetFromAttackCompletedMs)));
  // Two adjacent attacks with nothing between them: no capture may sit in the gap.
  const fires = result.actions.filter(action => action.op === 'fire');
  assert.deepEqual(result.actions.slice(result.actions.indexOf(fires[0]) + 1, result.actions.indexOf(fires[1])), [], 'the first two attacks are adjacent');
  assert.equal(fires[0].result.fired, true); assert.equal(fires[1].result.fired, false);
});

test('the pickup scan reaches a legal ground pickup and the aim evidence is recorded', async () => {
  for (const distance of [1.2, 4.0]) {
    const fake = firstPerson({ pickup: { bearing: 0, distance } });
    const result = await exerciseP8Gameplay(fake.access, 'hammer', 'world-hammer');
    const interacts = result.actions.filter(action => action.op === 'interact');
    const picked = interacts.find(action => action.result.handled === true);
    assert.ok(picked, 'a pickup ' + distance + ' m ahead must be reachable by the bounded scan');
    assert.equal(picked.result.item, 'thunder_hammer');
    const index = result.actions.indexOf(picked);
    assert.equal(result.actions[index - 1].observation.payload.aim.interactable, true, 'the scan aimed before it interacted');
    const equip = result.actions.find(action => action.op === 'equip');
    assert.equal(equip.result.equipment.active, 'thunder_hammer');
  }
});

test('a pickup the scan never aimed at is untested, and an aimed refusal is a mismatch', async () => {
  // Far to the side: the bounded scan does not cover that bearing, so the driver
  // must report that it did not test the claim rather than blame the product.
  const aside = firstPerson({ pickup: { bearing: 0.87, distance: 2.0 } });
  const missed = await exerciseP8Gameplay(aside.access, 'hammer', 'world-hammer');
  const missedVerdict = evaluateGameplay({ caseId: 'hammer', exercise: missed, source: [] });
  const pickup = missedVerdict.criteria.find(row => row.id === 'pickup-actual');
  assert.equal(pickup.status, 'insufficient');
  assert.equal(pickup.evidence.aimedAttempts, 0);
  assert.ok(pickup.evidence.attempts.length > 10, 'every attempt is kept as evidence');
  assert.match(pickup.evidence.note, /did not test this claim/);
  // The real refusal of the hammer's own pickup is a contradiction.
  const refused = firstPerson({ pickup: { bearing: 0, distance: 1.2 }, refuseInteract: true });
  const contradiction = await exerciseP8Gameplay(refused.access, 'hammer', 'world-hammer');
  const refusedVerdict = evaluateGameplay({ caseId: 'hammer', exercise: contradiction, source: [] });
  assert.equal(refusedVerdict.criteria.find(row => row.id === 'pickup-actual').status, 'failed');
  assert.ok(refusedVerdict.criteria.find(row => row.id === 'pickup-actual').evidence.contradiction);
});

test('the real dog plan walks the recorded outbound path back and finds the dog', async () => {
  const fake = town();
  const result = await exerciseP8Gameplay(fake.access, 'dog', 'world-dog');
  assert.ok(result.retrace, 'the retrace must be recorded');
  // The outbound southward leg was cut short by the wall, so a fixed step count
  // would have overshot into the north wall. The return leg is sized from the
  // distance that leg really covered.
  assert.ok(result.retrace.southPx > 0 && result.retrace.southPx < 300, 'the south leg is wall-truncated: ' + result.retrace.southPx);
  assert.ok(Math.abs(result.retrace.northPx - result.retrace.southPx) <= 20, `north ${result.retrace.northPx} must land on the outbound row, not past it`);
  assert.equal(result.retrace.complete, true);
  assert.equal(result.retrace.contact, true, 'the sweep must find the dog');
  // The sweep advances far less than the contact area, so it cannot step over it.
  assert.ok(result.retrace.chunkSteps * result.retrace.pxPerStep <= 2 * 15, 'chunk span must stay inside the contact area');
  const talks = result.actions.filter(action => action.op === 'talk');
  assert.ok(talks.length >= 3);
  assert.equal(talks.at(-1).result.ok, true, 'the re-contact talk must be answered');
  assert.ok(result.actions.filter(action => action.op === 'talk' && action.frame).length >= 2);
  const ops = result.actions.map(action => action.op);
  assert.deepEqual(ops.slice(0, 2), ['resume', 'talk']);
  const verdict = evaluateGameplay({ caseId: 'dog', exercise: result, source: dogSource });
  const byId = Object.fromEntries(verdict.criteria.map(row => [row.id, row]));
  assert.equal(byId['far-out-of-contact-observed'].status, 'verified');
  assert.equal(byId['approach-recontact-observed'].status, 'verified', 'both directions must hold at once');
  assert.equal(byId['bounded-follow-observed'].status, 'verified');
  // This geometry fixture holds the dog at its stopping point throughout. It
  // proves retracing and contact, not initial dialogue or near-spawn presence.
  assert.deepEqual(verdict.failed, ['dog-dialogue-live', 'dog-near-spawn-observed']);
});

test('a short outbound leg is handled without overshooting the return', async () => {
  const fake = town({ dogStop: { x: 110, y: 168 }, bounds: { minX: 16, maxX: 130, minY: 16, maxY: 330 } });
  const result = await exerciseP8Gameplay(fake.access, 'dog', 'world-dog');
  assert.ok(result.retrace.requiredPx < 100, 'the east leg is wall-truncated early: ' + result.retrace.requiredPx);
  assert.equal(result.retrace.contact, true);
  assert.equal(result.retrace.complete, true);
  const verdict = evaluateGameplay({ caseId: 'dog', exercise: result, source: dogSource });
  assert.equal(verdict.criteria.find(row => row.id === 'approach-recontact-observed').status, 'verified');
});

test('a dog that is not where it stopped is a proven mismatch, not a geometry failure', async () => {
  const fake = town({ dogStop: { x: 397, y: 250 } });
  const result = await exerciseP8Gameplay(fake.access, 'dog', 'world-dog');
  assert.equal(result.retrace.contact, false);
  assert.equal(result.retrace.complete, true, 'the retrace covered the whole outbound path');
  const verdict = evaluateGameplay({ caseId: 'dog', exercise: result, source: dogSource });
  const approach = verdict.criteria.find(row => row.id === 'approach-recontact-observed');
  assert.equal(approach.status, 'failed');
  assert.match(approach.evidence.note, /covered the whole outbound path/);
  // An exhausted retrace that never touched the dog is untested, not a failure.
  const stuck = town({ dogStop: { x: 397, y: 250 }, radius: { x: 1, y: 1 } });
  const stuckResult = await exerciseP8Gameplay(stuck.access, 'dog', 'world-dog');
  const stuckVerdict = evaluateGameplay({ caseId: 'dog', exercise: { ...stuckResult, retrace: { ...stuckResult.retrace, complete: false } }, source: dogSource });
  assert.equal(stuckVerdict.criteria.find(row => row.id === 'approach-recontact-observed').status, 'insufficient');
});

test('a failing operation is recorded as evidence and does not abort the plan', async () => {
  const fake = firstPerson({ pickup: { bearing: 0, distance: 1.2 } });
  const access = { ...fake.access, action: async (op, args) => { const result = await fake.access.action(op, args); return op === 'fire' ? { error: 'P8_GAMEPLAY_FAILED' } : result; } };
  const result = await exerciseP8Gameplay(access, 'hammer', 'world-hammer');
  const failed = result.actions.filter(action => action.result?.error);
  assert.equal(failed.length, 7, 'every refused attack is retained, not swallowed');
  assert.ok(result.actions.at(-1).op === 'fire', 'the plan still runs to the end');
});

test('the plan refuses to keep running when the runtime identity changes', async () => {
  const fake = firstPerson({ pickup: null });
  let calls = 0;
  const access = { ...fake.access, observe: async () => { calls += 1; const value = await fake.access.observe(); return calls > 2 ? { ...value, instanceId: 'foreign' } : value; } };
  await assert.rejects(exerciseP8Gameplay(access, 'hammer', 'world-hammer'), /P8_RUNTIME_CHANGED/);
  const dog = town();
  let dogCalls = 0;
  const dogAccess = { ...dog.access, observe: async () => { dogCalls += 1; const value = await dog.access.observe(); return dogCalls > 2 ? { ...value, instanceId: 'foreign' } : value; } };
  await assert.rejects(exerciseP8Gameplay(dogAccess, 'dog', 'world-dog'), /P8_RUNTIME_CHANGED/);
});
