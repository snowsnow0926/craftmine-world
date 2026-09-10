import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateGameplay, FOLLOW_PROOF_MIN_PX, FAR_PROOF_MIN_PX } from './gameplay-criteria.mjs';

// The play standard is the point of this file. Every machine-checkable claim gets
// a negative fixture, and every claim the product cannot settle must stay
// `review-required` — never `verified`, and never an overall pass.
//
// All fixtures below use the shapes recorded from real product receipts:
//   first-person snapshot: equipment/display/aim/inventory.slots/interactables/targets
//   interact result:       {handled, item, count, taken, snapshot}  (PickupItem)
//   fire result:           {fired, reason, hits, damage, equipment, attackMode, shot, snapshot}
//   town snapshot:         physical.overlaps[<entity_id>], physical.playerPosition
//   move result:           {ok, before, after, distance, blocked, facing, sceneId, steps}
//   talk result:           {ok, npcId, name, line, questId, questStatus}  (npcId is the data id)
const obs = (baseId, payload, sampledAt) => ({ format: 'craftmine.godot-observation/1', worldId: 'world-x', buildId: 'b', instanceId: 'i', baseId, baseVersion: '0.1.0', sampledAt, payload });
const at = (baseId, op, args, result, payload, observedAtMs, frame) => ({ op, args, result, observation: obs(baseId, payload, new Date(observedAtMs).toISOString().replace(/\.\d+Z$/, 'Z')), observedAtMs, ...(frame ? { frame } : {}) });

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
const shot = (t, fired, reason, over = {}) => ({ fired, reason, hits: fired ? [{ collider: 'TargetA', distance: 2.1 }] : [], damage: fired ? 20 : 0, equipment: 'thunder_hammer', attackMode: 'MELEE', shot: t, snapshot: fp(over) });

/** The plan the fixed helper runs, expressed with real timestamps. */
function hammerExercise({ interact = true, pickup = true, frames = true, cooldownLead = 66, attackDistance = null } = {}) {
  const actions = [];
  actions.push(at('first-person', 'resume', {}, { paused: false, snapshot: fp() }, fp(), 0));
  if (interact) {
    actions.push(at('first-person', 'look', { yaw: 0, pitch: -0.4 }, fp(), fp(), 50));
    for (const step of [0, 1]) {
      if (step) actions.push(at('first-person', 'walk', { forward: 1, frames: 24 }, fp(), fp(), 100 + step * 100));
      actions.push(at('first-person', 'interact', {}, pickup ? picked() : { handled: false, reason: 'no-target' }, pickup ? fp({ slots: [{ id: 'thunder_hammer', count: 1 }], interactables: [{ id: 'ThunderHammerPickup', enabled: true, taken: true }] }) : fp(), 150 + step * 100));
      if (pickup) break;
    }
  }
  const base = pickup ? 400 : 500;
  actions.push(at('first-person', 'equip', { value: 'thunder_hammer' }, fp({ slots: [{ id: 'thunder_hammer', count: 1 }] }), fp(), base));
  actions.push(at('first-person', 'look', { yaw: 0, pitch: 0 }, fp(), fp(), base + 50));
  actions.push(at('first-person', 'fire', {}, shot(1, true, '', { targets: [{ id: 'target_a', hitCount: 1, damageTaken: 20, destroyed: false, health: 30 }] }), fp(), base + 100, frames ? { file: 'hammer-frame-0-fire.png', sha256: 'a'.repeat(64), width: 1280, height: 720, observedAtMs: base + 100, offsetFromAttackMs: null } : undefined));
  actions.push(at('first-person', 'fire', {}, shot(1, false, 'cooling-down', { equipment: { cooldownRemaining: 1.2 }, targets: [{ id: 'target_a', hitCount: 1, damageTaken: 20, destroyed: false, health: 30 }] }), fp(), base + 400));
  actions.push(at('first-person', 'wait', { frames: cooldownLead }, fp(), fp(), base + 500));
  actions.push(at('first-person', 'fire', {}, shot(2, true, '', { targets: [{ id: 'target_a', hitCount: 2, damageTaken: 40, destroyed: false, health: 10 }] }), fp(), base + 500 + Math.round(cooldownLead * 1000 / 60) + 200, frames ? { file: 'hammer-frame-1-fire.png', sha256: 'b'.repeat(64), width: 1280, height: 720, observedAtMs: base + 1500, offsetFromAttackMs: null } : undefined));
  return { caseId: 'hammer', actions };
}
const seen = exercise => Object.fromEntries(exercise.criteria.map(item => [item.id, item]));
const verdict = (caseId, exercise, source) => { const result = evaluateGameplay({ caseId, exercise, source }); return { ...seen(result), verified: result.verified, machineVerified: result.machineVerified, failed: result.failed, insufficient: result.insufficient, reviewRequired: result.reviewRequired }; };

test('a complete hammer run verifies the machine-checkable mechanics and defers only the lightning claims', () => {
  const got = verdict('hammer', hammerExercise(), hammerSource);
  assert.deepEqual(got.failed, []);
  assert.deepEqual(got.insufficient, []);
  assert.deepEqual(got.reviewRequired, ['lightning-visible-in-frames', 'lightning-cooldown-at-least-one-second']);
  for (const id of ['stable-equipment-id-authored', 'pickup-source-hint', 'pickup-actual', 'equip-stable-id', 'equipment-visible', 'attack-accepted', 'attack-gate-refused-within-one-second', 'attack-gate-accepted-after-one-second', 'attack-affects-target', 'lightning-visual-in-source']) assert.equal(got[id].status, 'verified', id);
  // No product channel reports the effect's own visibility or cooldown, so the
  // driver must not call itself verified: a reviewer merges that later.
  assert.equal(got.machineVerified, false); assert.equal(got.verified, false);
  assert.equal(got['pickup-actual'].evidence.attempts[0].handled, true);
  assert.equal(got['attack-gate-refused-within-one-second'].evidence.refusal.wallMs, 300);
  assert.equal(got['attack-gate-accepted-after-one-second'].evidence.reopen.wallMs >= 1000, true);
  assert.equal(got['lightning-cooldown-at-least-one-second'].evidence.declared[0].name, 'LIGHTNING_COOLDOWN');
});

test('the ordinary attack gate is never read as the lightning cooldown', () => {
  const got = verdict('hammer', hammerExercise(), hammerSource);
  assert.match(got['attack-gate-refused-within-one-second'].evidence.scope, /lightning effect has its own cooldown and is judged separately/);
  assert.match(got['lightning-cooldown-at-least-one-second'].evidence.scope, /Neither the ordinary attack cooldown nor a model self-report/);
  // Even a source-declared effect cooldown leaves the claim deferred.
  assert.equal(got['lightning-cooldown-at-least-one-second'].status, 'review-required');
});

test('a directly equipped hammer is not a pickup, and a failed pickup is not hidden', () => {
  const noStep = verdict('hammer', hammerExercise({ interact: false }), hammerSource);
  assert.equal(noStep['pickup-actual'].status, 'insufficient');
  assert.equal(noStep['pickup-actual'].evidence.stepPresent, false);
  assert.equal(noStep['equip-stable-id'].status, 'verified', 'equip still works; it is simply not pickup evidence');
  const attempted = verdict('hammer', hammerExercise({ pickup: false }), hammerSource);
  assert.equal(attempted['pickup-actual'].status, 'failed');
  assert.equal(attempted['pickup-actual'].evidence.stepPresent, true);
  assert.deepEqual(attempted.failed.includes('pickup-actual'), true);
  assert.ok(attempted['pickup-actual'].evidence.attempts.every(entry => entry.handled === false));
});

test('pickup evidence records the aim, the interact return and the inventory around it', () => {
  const got = verdict('hammer', hammerExercise(), hammerSource);
  const attempt = got['pickup-actual'].evidence.attempts[0];
  assert.equal(attempt.aimInteractable, true);
  assert.equal(attempt.handled, true); assert.equal(attempt.item, 'thunder_hammer'); assert.equal(attempt.taken, true);
  assert.equal(attempt.carriedBefore, false); assert.equal(attempt.carriedAfter, true);
  assert.deepEqual(attempt.interactablesBefore, [{ id: 'ThunderHammerPickup', enabled: true, taken: false }]);
  assert.deepEqual(attempt.interactablesAfter, [{ id: 'ThunderHammerPickup', enabled: true, taken: true }]);
});

test('an attack repeated inside the second must be refused, and must reopen after it', () => {
  const notRefused = verdict('hammer', hammerExercise({ attackDistance: 0 }), hammerSource);
  assert.equal(notRefused['attack-accepted'].status, 'verified');
  const refused = verdict('hammer', hammerExercise(), hammerSource);
  assert.equal(refused['attack-gate-refused-within-one-second'].status, 'verified');
  const tooEarly = verdict('hammer', hammerExercise({ cooldownLead: 30 }), hammerSource);
  assert.equal(tooEarly['attack-gate-accepted-after-one-second'].status, 'failed', 'a 0.5s wait must not be called a reopened gate');
});

test('the hammer id and the lightning effect must exist in the built source', () => {
  const got = verdict('hammer', hammerExercise(), [{ path: 'scripts/core/world.gd', kind: 'source', text: 'func _ready():\n\tpass' }]);
  assert.ok(got.failed.includes('stable-equipment-id-authored'));
  assert.ok(got.failed.includes('pickup-source-hint'));
  assert.ok(got.failed.includes('lightning-visual-in-source'));
  const noEffect = verdict('hammer', hammerExercise(), [{ path: 'data/equipment/thunder_hammer.tres', kind: 'source', text: 'id = "thunder_hammer"\nspawn_pickup("thunder_hammer")' }]);
  assert.equal(noEffect['lightning-visual-in-source'].status, 'failed');
});

const td = (over = {}) => ({
  format: 'craftmine.godot-topdown-snapshot/1', worldId: 'world-dog', stateVersion: 1, coins: 40, inventory: {}, shops: {}, quests: {}, grantedRewards: {}, flags: {}, scenePositions: {},
  player: { sceneId: 'overworld', position: over.position ?? [104, 168], facing: 'down' }, sceneId: 'overworld', duplicateEntityIds: [], bootError: '', maps: {}, sprite: { frame: 0, facing: 'down', moving: false },
  physical: { playerPosition: over.position ?? [104, 168], facing: 'down', overlaps: over.overlaps ?? { 'p8-dog': true } },
});
const moved = (before, after, blocked = false) => ({ ok: true, before, after, distance: Math.hypot(after[0] - before[0], after[1] - before[1]), blocked, facing: 'down', sceneId: 'overworld', steps: 1 });
const line = (over = {}) => ({ ok: true, npcId: over.npcId ?? 'p8-dog', name: over.name ?? '小狗', line: over.line ?? '汪！', questId: '', questStatus: 'inactive', snapshot: td(over.snapshot ?? {}) });
const dogSource = [{ path: 'data/npcs/p8-dog.json', kind: 'source', text: '{ "id": "p8-dog", "name": "小狗", "sprite": "res://assets/characters/dog.png", "lines": [{ "when": "always", "text": "汪！" }] }' }];

function dogExercise({ shortSteps = 200, farSteps = 600, spawnOverlaps = { 'p8-dog': true }, farOverlaps = { 'p8-dog': false }, retraceContact = true, spawnTalk = line(), farTalk = { error: 'out_of_range' }, shortTalk = line() } = {}) {
  const actions = [], t0 = 1_000_000;
  actions.push(at('top-down', 'resume', {}, { paused: false }, td({ overlaps: spawnOverlaps }), t0, { file: 'dog-frame-0-resume.png', sha256: 'c'.repeat(64), width: 1280, height: 720, observedAtMs: t0 }));
  actions.push(at('top-down', 'talk', { npcId: 'p8-dog' }, spawnTalk, td({ overlaps: spawnOverlaps }), t0 + 100));
  const shortDistance = Math.hypot(shortSteps * 1.4667, 0);
  actions.push(at('top-down', 'move', { dx: 1, dy: 0, steps: shortSteps }, moved([104, 168], [104 + shortDistance, 168]), td({ position: [104 + shortDistance, 168], overlaps: spawnOverlaps }), t0 + 200));
  actions.push(at('top-down', 'wait', { frames: 60 }, { ok: true, frames: 60 }, td({ position: [104 + shortDistance, 168], overlaps: shortTalk.ok && shortTalk.line ? { 'p8-dog': true } : farOverlaps }), t0 + 300));
  actions.push(at('top-down', 'talk', { npcId: 'p8-dog' }, shortTalk, td({ overlaps: shortTalk.ok && shortTalk.line ? { 'p8-dog': true } : farOverlaps }), t0 + 400, { file: 'dog-frame-1-follow.png', sha256: 'd'.repeat(64), width: 1280, height: 720, observedAtMs: t0 + 400 }));
  const farDistance = Math.hypot(farSteps * 1.4667, 0);
  actions.push(at('top-down', 'move', { dx: 1, dy: 0, steps: farSteps }, moved([104 + shortDistance, 168], [104 + shortDistance + farDistance, 168], true), td({ position: [104 + shortDistance + farDistance, 168], overlaps: farOverlaps }), t0 + 500));
  actions.push(at('top-down', 'wait', { frames: 60 }, { ok: true, frames: 60 }, td({ overlaps: farOverlaps }), t0 + 600));
  actions.push(at('top-down', 'move', { dx: 0, dy: 1, steps: farSteps }, moved([104 + shortDistance + farDistance, 168], [104 + shortDistance + farDistance, 168 + farDistance], true), td({ overlaps: farOverlaps }), t0 + 700));
  actions.push(at('top-down', 'wait', { frames: 60 }, { ok: true, frames: 60 }, td({ overlaps: farOverlaps }), t0 + 800));
  actions.push(at('top-down', 'talk', { npcId: 'p8-dog' }, farTalk, td({ overlaps: farOverlaps }), t0 + 900, { file: 'dog-frame-2-far.png', sha256: 'e'.repeat(64), width: 1280, height: 720, observedAtMs: t0 + 900 }));
  actions.push(at('top-down', 'move', { dx: 0, dy: -1, steps: 400 }, moved([104 + shortDistance + farDistance, 168 + farDistance], [104 + shortDistance + farDistance, 168 + farDistance - 586], true), td({ overlaps: retraceContact ? { 'p8-dog': false } : farOverlaps }), t0 + 1000));
  actions.push(at('top-down', 'wait', { frames: 45 }, { ok: true, frames: 45 }, td({ overlaps: retraceContact ? { 'p8-dog': true } : farOverlaps }), t0 + 1100));
  actions.push(at('top-down', 'talk', { npcId: 'p8-dog' }, retraceContact ? line() : { error: 'out_of_range' }, td({ overlaps: retraceContact ? { 'p8-dog': true } : farOverlaps }), t0 + 1200, retraceContact ? { file: 'dog-frame-3-recontact.png', sha256: 'f'.repeat(64), width: 1280, height: 720, observedAtMs: t0 + 1200 } : undefined));
  return { caseId: 'dog', actions };
}

test('a complete dog run verifies following and the far stop, and defers only the visual claims', () => {
  const got = verdict('dog', dogExercise(), dogSource);
  assert.deepEqual(got.failed, []); assert.deepEqual(got.insufficient, []);
  assert.deepEqual(got.reviewRequired, ['dog-visible-in-frames', 'dog-stop-not-continuing']);
  for (const id of ['stable-dog-id-authored', 'dog-dialogue-live', 'dog-near-spawn-observed', 'bounded-follow-observed', 'far-out-of-contact-observed', 'approach-recontact-observed']) assert.equal(got[id].status, 'verified', id);
  assert.equal(got.verified, false, 'the visible stop is not machine-decidable and must not be reported as a pass');
  assert.equal(got['bounded-follow-observed'].evidence.requiredTravelled, FOLLOW_PROOF_MIN_PX);
  assert.equal(got['far-out-of-contact-observed'].evidence.requiredTravelled, FAR_PROOF_MIN_PX);
});

test('the returned npcId is the data id and must not be required to equal the argument', () => {
  const got = verdict('dog', dogExercise({ spawnTalk: line({ npcId: 'dog', name: '小狗' }) }), dogSource);
  assert.equal(got['dog-dialogue-live'].status, 'verified');
  assert.equal(got['dog-dialogue-live'].evidence.argument, 'p8-dog');
  assert.equal(got['dog-dialogue-live'].evidence.dataId, 'dog');
  const missing = verdict('dog', dogExercise({ spawnTalk: { error: 'unknown_npc' } }), dogSource);
  assert.equal(missing['dog-dialogue-live'].status, 'failed');
});

test('presence must come from the live overlap report, not from a name in the source', () => {
  const absent = verdict('dog', dogExercise({ spawnOverlaps: { 'npc-mira': true } }), dogSource);
  assert.equal(absent['dog-near-spawn-observed'].status, 'failed');
  assert.match(absent['dog-near-spawn-observed'].evidence.note, /no p8-dog key/);
  const outOfRange = verdict('dog', dogExercise({ spawnOverlaps: { 'p8-dog': false } }), dogSource);
  assert.equal(outOfRange['dog-near-spawn-observed'].status, 'failed');
});

test('a 66px shuffle is not proof of a bounded follow', () => {
  const short = verdict('dog', dogExercise({ shortSteps: 45 }), dogSource);
  assert.equal(short['bounded-follow-observed'].status, 'failed');
  // Nothing in the run ever put the dog in range after the player outwalked the
  // radius, so no follow was observed at all.
  assert.equal(short['bounded-follow-observed'].evidence.followOverlap, null);
  const lost = verdict('dog', dogExercise({ shortTalk: { error: 'out_of_range' } }), dogSource);
  assert.equal(lost['bounded-follow-observed'].status, 'failed');
});

test('a dog that keeps answering from far away is not bounded', () => {
  const unbounded = verdict('dog', dogExercise({ farTalk: line() }), dogSource);
  assert.equal(unbounded['far-out-of-contact-observed'].status, 'failed');
  assert.equal(unbounded.verified, false);
});

test('the far stop needs a real distance and a lost contact, not just a refusal', () => {
  // Neither leg is long enough in total, so "out of range" cannot mean the dog
  // stopped: the player simply never travelled far from the spawn area.
  const tooNear = verdict('dog', dogExercise({ shortSteps: 45, farSteps: 60 }), dogSource);
  assert.equal(tooNear['far-out-of-contact-observed'].status, 'failed');
  assert.match(tooNear['far-out-of-contact-observed'].evidence.note, /far leg did not produce/);
  const stillContact = verdict('dog', dogExercise({ farOverlaps: { 'p8-dog': true } }), dogSource);
  assert.equal(stillContact['far-out-of-contact-observed'].status, 'failed');
});

test('walking back must re-establish real contact before it counts as an approach', () => {
  const never = verdict('dog', dogExercise({ retraceContact: false }), dogSource);
  assert.equal(never['approach-recontact-observed'].status, 'failed');
  assert.equal(never.verified, false);
});

test('no evidence at all can never be verified', () => {
  for (const caseId of ['hammer', 'dog']) {
    const got = verdict(caseId, { actions: [] }, []);
    assert.equal(got.verified, false); assert.equal(got.machineVerified, false);
    assert.ok(got.failed.length > 0);
  }
  const dog = verdict('dog', { actions: [] }, []);
  assert.ok(dog.reviewRequired.length > 0, 'the deferred visual claim is still reported, never silently dropped');
});
