import { evaluateGameplay } from './gameplay-criteria.mjs';

// Shared gameplay fixtures for the P8 driver tests. Every shape here was
// checked against real product receipts, and the aggregate test feeds these
// fixtures through the real evaluateGameplay so the report layer is judged on
// the structure the driver actually writes.

// The play standard is the point of this file. Every machine-checkable claim gets
// a negative fixture, and every claim the product cannot settle must stay
// `review-required` — never `verified`, and never an overall pass.
//
// All fixtures use the shapes recorded from real product receipts:
//   first-person snapshot: equipment/display/aim/inventory.slots/interactables/targets
//   interact result:       {handled, item, count, taken, snapshot}  (PickupItem)
//   fire result:           {fired, reason, hits, damage, equipment, attackMode, shot, snapshot}
//   town snapshot:         physical.overlaps[<entity_id>], physical.playerPosition
//   move result:           {ok, before, after, distance, blocked, facing, sceneId, steps}
//   talk result:           {ok, npcId, name, line, questId, questStatus}  (npcId is the data id)
//   frame object:          command/capture times, associatedAttack, real offsets
const obs = (baseId, payload, sampledAt) => ({ format: 'craftmine.godot-observation/1', worldId: 'world-x', buildId: 'b', instanceId: 'i', baseId, baseVersion: '0.1.0', sampledAt, payload });
/** One recorded action, with the real receipt times the driver writes. */
const at = (baseId, op, args, result, payload, observedAtMs, frame) => ({
  op, args, result, observation: obs(baseId, payload, new Date(observedAtMs).toISOString().replace(/\.\d+Z$/, 'Z')),
  commandStartedAtMs: observedAtMs - 20, commandCompletedAtMs: observedAtMs - 10, observedAtMs, ...(frame ? { frame } : {}),
});
/** A frame as the helper really records it: the capture window sits after the
 * observation, and the next command cannot start before it closes. */
const frameOf = (file, observedAtMs, attackIndex, offsetMs, captureMs = 30) => ({
  file, sha256: file.replace(/\W/g, '').padEnd(64, 'a').slice(0, 64), width: 1280, height: 720,
  commandStartedAtMs: observedAtMs - 20, commandCompletedAtMs: observedAtMs - 10, observedAtMs,
  captureStartedAtMs: observedAtMs + 5, capturedAtMs: observedAtMs + 5 + captureMs,
  sampledAt: new Date(observedAtMs).toISOString().replace(/\.\d+Z$/, 'Z'), resampledAt: '2026-09-10T12:00:01Z',
  associatedAttack: attackIndex === null ? null : { attackIndex, op: 'fire', fired: true, reason: null, commandStartedAtMs: observedAtMs - 20, commandCompletedAtMs: observedAtMs - 10, observedAtMs },
  offsetFromAttackObservedMs: offsetMs, offsetFromAttackCompletedMs: offsetMs === null ? null : offsetMs - 10,
});

const fp = (over = {}) => ({
  base: 'first-person', baseVersion: '0.1.0', worldId: 'world-hammer', levelTitle: 'Training range', viewportSize: [1200, 800], windowSize: [1200, 800],
  equipment: { active: 'thunder_hammer', displayName: 'Thunder hammer', attackMode: 'MELEE', damage: 20, cooldownSeconds: 1.5, crosshairVisible: true, magazine: 0, capacity: 0, reserve: 0, cooldownRemaining: 0, reloading: false, blockReason: '', ...(over.equipment ?? {}) },
  display: { visible: true, meshPath: 'res://assets/meshes/thunder_hammer.obj', local: [0, 0, 0], global: [0, 0, 0], cameraGlobal: [0, 0, 0], attachedToCamera: true, alignedWithCamera: true, forwardDot: 1, ...(over.display ?? {}) },
  aim: { hit: true, collider: 'ThunderHammerPickup', position: [0, 1, 4], interactable: true, prompt: 'Pick up  thunder_hammer  [E]', ...(over.aim ?? {}) },
  player: { onFloor: true, pitch: 0, position: [0, 0.9, 6], yaw: 0 },
  inventory: { slots: over.slots ?? [] },
  quests: { quests: [] }, hud: { message: '' },
  targets: over.targets ?? [{ id: 'target_a', hitCount: 0, damageTaken: 0, destroyed: false, health: 50 }],
  interactables: over.interactables ?? [{ id: 'ThunderHammerPickup', enabled: true, taken: false }],
});
const hammerSource = [
  { path: 'data/equipment/thunder_hammer.tres', kind: 'source', text: 'id = "thunder_hammer"\ndisplay_name = "Thunder hammer"\ncooldown_seconds = 1.5' },
  { path: 'scripts/core/thunder_hammer_effect.gd', kind: 'source', text: '# spawn_pickup places thunder_hammer near the spawn marker\nvar bolt := OmniLight3D.new()\nconst LIGHTNING_COOLDOWN := 1.2\nspawn_pickup("thunder_hammer", Vector3(0, 0.2, 4))' },
];
const picked = () => ({ handled: true, item: 'thunder_hammer', count: 1, taken: true, snapshot: fp({ slots: [{ id: 'thunder_hammer', count: 1 }], interactables: [{ id: 'ThunderHammerPickup', enabled: true, taken: true }] }) });
const shot = (n, fired, reason, over = {}) => ({ fired, reason, hits: fired ? [{ collider: 'TargetA', distance: 2.1 }] : [], damage: fired ? 20 : 0, equipment: 'thunder_hammer', attackMode: 'MELEE', shot: n, snapshot: fp(over) });

/** The plan the fixed helper runs, expressed with real receipt times. */
function hammerExercise({ interact = 0, pickup = true, aim = {}, frames = true, gap = 30, captureBetween = false } = {}) {
  const actions = [], t0 = 1_000_000;
  actions.push(at('first-person', 'resume', {}, { paused: false, snapshot: fp() }, fp(), t0));
  if (interact > 0) {
    actions.push(at('first-person', 'look', { yaw: 0, pitch: -0.6 }, fp(), fp({ aim }), t0 + 50, frames ? frameOf('hammer-frame-0-look.png', t0 + 50, null, null) : undefined));
    for (let index = 0; index < interact; index++) {
      const delivered = pickup && index === 0;
      actions.push(at('first-person', 'interact', {}, delivered ? picked() : { handled: false, reason: 'no-target' },
        delivered ? fp({ slots: [{ id: 'thunder_hammer', count: 1 }], interactables: [{ id: 'ThunderHammerPickup', enabled: true, taken: true }] }) : fp({ aim }), t0 + 100 + index * 50));
    }
  }
  const base = t0 + 400;
  actions.push(at('first-person', 'equip', { value: 'thunder_hammer' }, fp({ slots: [{ id: 'thunder_hammer', count: 1 }] }), fp(), base));
  actions.push(at('first-person', 'look', { yaw: 0, pitch: 0 }, fp(), fp(), base + 50, frames ? frameOf('hammer-frame-1-aim.png', base + 50, null, null) : undefined));
  // When a capture really sits between the two attacks, the second command starts
  // after that capture closed: the real gap includes it and is never reduced.
  const captureMs = 400, betweenMs = captureBetween ? captureMs + 20 : gap;
  actions.push(at('first-person', 'fire', {}, shot(1, true, '', { targets: [{ id: 'target_a', hitCount: 1, damageTaken: 20, destroyed: false, health: 30 }] }), fp(), base + 100,
    captureBetween ? frameOf('hammer-frame-between.png', base + 100, 1, 0, captureMs) : undefined));
  actions.push(at('first-person', 'fire', {}, shot(1, false, 'cooling-down', { equipment: { cooldownRemaining: 1.2 }, targets: [{ id: 'target_a', hitCount: 1, damageTaken: 20, destroyed: false, health: 30 }] }), fp(), base + 100 + betweenMs));
  actions.push(at('first-person', 'wait', { frames: 66 }, fp(), fp(), base + 500));
  actions.push(at('first-person', 'fire', {}, shot(2, true, '', { targets: [{ id: 'target_a', hitCount: 2, damageTaken: 40, destroyed: false, health: 10 }] }), fp(), base + 1500, frames ? frameOf('hammer-frame-2-fire.png', base + 1500, 3, 900) : undefined));
  return { caseId: 'hammer', actions };
}
const seen = exercise => Object.fromEntries(exercise.criteria.map(item => [item.id, item]));
const verdict = (caseId, exercise, source) => { const result = evaluateGameplay({ caseId, exercise, source }); return { ...seen(result), verified: result.verified, machineVerified: result.machineVerified, failed: result.failed, insufficient: result.insufficient, reviewRequired: result.reviewRequired }; };

const td = (over = {}) => ({
  format: 'craftmine.godot-topdown-snapshot/1', worldId: 'world-dog', stateVersion: 1, coins: 40, inventory: {}, shops: {}, quests: {}, grantedRewards: {}, flags: {}, scenePositions: {},
  player: { sceneId: 'overworld', position: over.position ?? [104, 168], facing: 'down' }, sceneId: 'overworld', duplicateEntityIds: [], bootError: '', maps: {}, sprite: { frame: 0, facing: 'down', moving: false },
  physical: { playerPosition: over.position ?? [104, 168], facing: 'down', overlaps: over.overlaps ?? { 'p8-dog': true } },
});
const moved = (before, after, blocked = false) => ({ ok: true, before, after, distance: Math.hypot(after[0] - before[0], after[1] - before[1]), blocked, facing: 'down', sceneId: 'overworld', steps: 1 });
const line = (over = {}) => ({ ok: true, npcId: over.npcId ?? 'p8-dog', name: over.name ?? '小狗', line: over.line ?? '汪！', questId: '', questStatus: 'inactive', snapshot: td(over.snapshot ?? {}) });
const dogSource = [{ path: 'data/npcs/p8-dog.json', kind: 'source', text: '{ "id": "p8-dog", "name": "小狗", "sprite": "res://assets/characters/dog.png", "lines": [{ "when": "always", "text": "汪！" }] }' }];

function dogExercise({ shortSteps = 200, farSteps = 600, spawnOverlaps = { 'p8-dog': true }, farOverlaps = { 'p8-dog': false }, retraceContact = true, retrace = { complete: true, contact: true, southPx: 162, northPx: 162, requiredPx: 515, coveredPx: 520, chunks: 36 }, spawnTalk = line(), farTalk = { error: 'out_of_range' }, shortTalk = line() } = {}) {
  const actions = [], t0 = 1_000_000;
  actions.push(at('top-down', 'resume', {}, { paused: false }, td({ overlaps: spawnOverlaps }), t0, frameOf('dog-frame-0-resume.png', t0, null, null)));
  actions.push(at('top-down', 'talk', { npcId: 'p8-dog' }, spawnTalk, td({ overlaps: spawnOverlaps }), t0 + 100));
  const shortDistance = Math.hypot(shortSteps * 1.4667, 0);
  actions.push(at('top-down', 'move', { dx: 1, dy: 0, steps: shortSteps }, moved([104, 168], [104 + shortDistance, 168]), td({ position: [104 + shortDistance, 168], overlaps: spawnOverlaps }), t0 + 200));
  actions.push(at('top-down', 'wait', { frames: 60 }, { ok: true, frames: 60 }, td({ position: [104 + shortDistance, 168], overlaps: shortTalk.ok && shortTalk.line ? { 'p8-dog': true } : farOverlaps }), t0 + 300));
  actions.push(at('top-down', 'talk', { npcId: 'p8-dog' }, shortTalk, td({ overlaps: shortTalk.ok && shortTalk.line ? { 'p8-dog': true } : farOverlaps }), t0 + 400, frameOf('dog-frame-1-follow.png', t0 + 400, null, null)));
  const farDistance = Math.hypot(farSteps * 1.4667, 0);
  actions.push(at('top-down', 'move', { dx: 1, dy: 0, steps: farSteps }, moved([104 + shortDistance, 168], [104 + shortDistance + farDistance, 168], true), td({ position: [104 + shortDistance + farDistance, 168], overlaps: farOverlaps }), t0 + 500));
  actions.push(at('top-down', 'wait', { frames: 60 }, { ok: true, frames: 60 }, td({ overlaps: farOverlaps }), t0 + 600));
  actions.push(at('top-down', 'move', { dx: 0, dy: 1, steps: farSteps }, moved([104 + shortDistance + farDistance, 168], [104 + shortDistance + farDistance, 168 + farDistance], true), td({ overlaps: farOverlaps }), t0 + 700));
  actions.push(at('top-down', 'wait', { frames: 60 }, { ok: true, frames: 60 }, td({ overlaps: farOverlaps }), t0 + 800));
  actions.push(at('top-down', 'talk', { npcId: 'p8-dog' }, farTalk, td({ overlaps: farOverlaps }), t0 + 900, frameOf('dog-frame-2-far.png', t0 + 900, null, null)));
  actions.push(at('top-down', 'move', { dx: 0, dy: -1, steps: 110 }, moved([104 + shortDistance + farDistance, 168 + farDistance], [104 + shortDistance + farDistance, 168], true), td({ overlaps: farOverlaps }), t0 + 1000));
  actions.push(at('top-down', 'wait', { frames: 30 }, { ok: true, frames: 30 }, td({ overlaps: farOverlaps }), t0 + 1100));
  for (let chunk = 0; chunk < 3; chunk++) {
    const contacted = retraceContact && chunk === 2;
    actions.push(at('top-down', 'move', { dx: -1, dy: 0, steps: 10 }, moved([600 - chunk * 14.7, 168], [600 - (chunk + 1) * 14.7, 168]), td({ overlaps: contacted ? { 'p8-dog': true } : farOverlaps }), t0 + 1200 + chunk * 100));
    actions.push(at('top-down', 'wait', { frames: 15 }, { ok: true, frames: 15 }, td({ overlaps: contacted ? { 'p8-dog': true } : farOverlaps }), t0 + 1250 + chunk * 100));
  }
  actions.push(at('top-down', 'talk', { npcId: 'p8-dog' }, retraceContact ? line() : { error: 'out_of_range' }, td({ overlaps: retraceContact ? { 'p8-dog': true } : farOverlaps }), t0 + 1600, retraceContact ? frameOf('dog-frame-3-recontact.png', t0 + 1600, null, null) : undefined));
  return { caseId: 'dog', actions, retrace: { ...retrace, contact: retraceContact && retrace.contact !== false } };
}


export { obs, at, frameOf, fp, hammerSource, picked, shot, hammerExercise, td, moved, line, dogSource, dogExercise, seen, verdict };
