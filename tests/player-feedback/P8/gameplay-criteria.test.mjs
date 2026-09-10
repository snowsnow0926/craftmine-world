import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateGameplay, HAMMER_MIN_COOLDOWN_SECONDS, DOG_FAR_MIN_DISPLACEMENT } from './gameplay-criteria.mjs';

// The play standard is the point of this file. Every required mechanic gets a
// negative fixture, so a future edit that loosens the evaluator (or a stub that
// only reports success) fails here instead of passing a real acceptance run.
const seen = exercise => Object.fromEntries((exercise.criteria ?? []).map(item => [item.id, item]));
const verdict = (caseId, exercise, source) => {
  const result = evaluateGameplay({ caseId, exercise, source });
  return { ...seen(result), verified: result.verified, failed: result.failed, insufficient: result.insufficient };
};
const observation = (baseId, payload) => ({ format: 'craftmine.godot-observation/1', worldId: 'world-x', buildId: 'b', instanceId: 'i', baseId, baseVersion: '0.1.0', sampledAt: '2026-09-10T00:00:00Z', payload });
const step = (baseId, op, args, result, payload) => ({ op, args, result, observation: observation(baseId, payload ?? {}) });

const hammerWorld = (over = {}) => ({
  equipment: { active: 'thunder_hammer', displayName: 'Thunder hammer', attackMode: 'MELEE', damage: 20, cooldownSeconds: 1.5, crosshairVisible: true, magazine: 0, capacity: 0, reserve: 0, cooldownRemaining: 0, reloading: false, blockReason: '', ...(over.equipment ?? {}) },
  display: { visible: true, meshPath: 'res://assets/meshes/hammer.obj', local: [0, 0, 0], global: [0, 0, 0], attachedToCamera: true, alignedWithCamera: true, forwardDot: 1, ...(over.display ?? {}) },
  inventory: over.inventory ?? { slots: [{ id: 'thunder_hammer', count: 1 }] },
  interactables: over.interactables ?? [{ id: 'hammer_pickup', enabled: true }],
  targets: over.targets ?? [{ id: 'target_a', hitCount: 0, damageTaken: 0, destroyed: false }],
});
const hammerSource = [
  { path: 'data/equipment/thunder_hammer.tres', kind: 'source', text: 'id = "thunder_hammer"\ncooldown_seconds = 1.5' },
  { path: 'scripts/core/thunder_hammer_effect.gd', kind: 'source', text: '# spawn_pickup near the spawn marker, bolt is a local flash\nvar bolt := OmniLight3D.new()\nspawn_pickup("thunder_hammer", Vector3(2, 0, 4))' },
];
function hammerExercise({ equipResult, cooldownSeconds = 1.5, suppress = true, hits = true, display, inventory, interactables } = {}) {
  const world = over => hammerWorld({ ...over, equipment: { cooldownSeconds, ...(over.equipment ?? {}) } });
  const shot = (remaining, count, damage) => world({ equipment: { cooldownRemaining: remaining }, targets: [{ id: 'target_a', hitCount: count, damageTaken: damage, destroyed: false }] });
  return { caseId: 'hammer', actions: [
    step('first-person', 'resume', {}, { paused: false }, world({})),
    step('first-person', 'equip', { value: 'thunder_hammer' }, equipResult ?? world({ display, inventory, interactables }), world({})),
    step('first-person', 'look', { yaw: 0, pitch: 0 }, world({}), world({})),
    step('first-person', 'fire', {}, { fired: true, reason: '', hits: hits ? [{ collider: 'TargetA' }] : [], damage: hits ? 20 : 0, equipment: 'thunder_hammer', attackMode: 'MELEE', shot: 1, snapshot: shot(1.5, hits ? 1 : 0, hits ? 20 : 0) }),
    step('first-person', 'fire', {}, { fired: !suppress, reason: suppress ? 'cooldown' : '', hits: [], damage: 0, equipment: 'thunder_hammer', attackMode: 'MELEE', shot: suppress ? 1 : 2, snapshot: shot(1.4, hits ? 1 : 0, hits ? 20 : 0) }),
    step('first-person', 'wait', { frames: 90 }, world({}), world({})),
    step('first-person', 'fire', {}, { fired: true, reason: '', hits: hits ? [{ collider: 'TargetA' }] : [], damage: hits ? 20 : 0, equipment: 'thunder_hammer', attackMode: 'MELEE', shot: 2, snapshot: shot(1.5, hits ? 2 : 0, hits ? 40 : 0) }),
  ] };
}

test('a complete hammer implementation verifies every required mechanic', () => {
  const seen = verdict('hammer', hammerExercise(), hammerSource);
  assert.deepEqual(seen.verified, true);
  assert.deepEqual(seen.failed, []); assert.deepEqual(seen.insufficient, []);
  for (const id of ['stable-equipment-id-authored', 'equip-stable-id', 'equipment-visible', 'obtainable-near-spawn', 'ordinary-attack-accepted', 'attack-affects-target', 'lightning-cooldown-at-least-one-second', 'cooldown-enforced-live', 'lightning-visual-authored']) assert.equal(seen[id].status, 'verified', id);
  assert.equal(seen['lightning-cooldown-at-least-one-second'].evidence.cooldownSeconds, 1.5);
  assert.equal(seen['cooldown-enforced-live'].evidence.reason, 'cooldown');
  assert.equal(seen['attack-affects-target'].evidence.targetHitCount.after, 2);
});

test('the hammer id must exist in the built source, not only in a claim', () => {
  const seen = verdict('hammer', hammerExercise(), [{ path: 'scripts/core/world.gd', kind: 'source', text: 'func _ready():\n\tpass' }]);
  assert.equal(seen.verified, false);
  assert.ok(seen.failed.includes('stable-equipment-id-authored'));
  assert.ok(seen.failed.includes('lightning-visual-authored'));
});

test('a rejected equip leaves visibility and obtainability unproven rather than passed', () => {
  const seen = verdict('hammer', hammerExercise({ equipResult: { error: 'Unknown equipment: thunder_hammer' } }), hammerSource);
  assert.equal(seen.verified, false);
  assert.equal(seen['equip-stable-id'].status, 'failed');
  assert.equal(seen['equipment-visible'].status, 'insufficient');
  assert.equal(seen['obtainable-near-spawn'].status, 'insufficient');
});

test('an equipped but invisible hammer is a failure, not a technicality', () => {
  const seen = verdict('hammer', hammerExercise({ display: { visible: false, meshPath: '' } }), hammerSource);
  assert.equal(seen['equip-stable-id'].status, 'verified');
  assert.equal(seen['equipment-visible'].status, 'failed');
  assert.equal(seen.verified, false);
});

test('a hammer nobody can pick up fails obtainability', () => {
  const seen = verdict('hammer', hammerExercise({ inventory: { slots: [] }, interactables: [] }), [{ path: 'data/equipment/thunder_hammer.tres', kind: 'source', text: 'id = "thunder_hammer"\ncooldown_seconds = 1.5' }]);
  assert.equal(seen['obtainable-near-spawn'].status, 'failed');
  assert.equal(seen.verified, false);
});

test('a sub-second cooldown fails the one second requirement', () => {
  const seen = verdict('hammer', hammerExercise({ cooldownSeconds: 0.35 }), hammerSource);
  assert.equal(HAMMER_MIN_COOLDOWN_SECONDS, 1);
  assert.equal(seen['lightning-cooldown-at-least-one-second'].status, 'failed');
  assert.equal(seen.verified, false);
});

test('two attacks inside one cooldown window without suppression fail enforcement', () => {
  const seen = verdict('hammer', hammerExercise({ suppress: false }), hammerSource);
  assert.equal(seen['cooldown-enforced-live'].status, 'failed');
  assert.equal(seen.verified, false);
});

test('an attack that never changes a target fails the damage requirement', () => {
  const seen = verdict('hammer', hammerExercise({ hits: false }), hammerSource);
  assert.equal(seen['ordinary-attack-accepted'].status, 'verified');
  assert.equal(seen['attack-affects-target'].status, 'failed');
  assert.equal(seen.verified, false);
});

test('an authored hammer without a light or flash fails the lightning requirement', () => {
  const source = [{ path: 'data/equipment/thunder_hammer.tres', kind: 'source', text: 'id = "thunder_hammer"\ncooldown_seconds = 1.5\nspawn_pickup("thunder_hammer")' }];
  const seen = verdict('hammer', hammerExercise(), source);
  assert.equal(seen['lightning-visual-authored'].status, 'failed');
  assert.equal(seen.verified, false);
});

const dogSource = [{ path: 'data/npcs/p8-dog.json', kind: 'source', text: '{ "id": "p8-dog", "name": "小狗", "sprite": "res://assets/characters/dog.png", "lines": [{ "when": "always", "text": "汪！" }] }' }];
const dogPayload = position => ({ physical: { playerPosition: position, facing: 'down', overlaps: {} }, sceneId: 'town-overworld', duplicateEntityIds: ['p8-dog'] });
function dogExercise({ spawnTalk = true, followTalk = true, farTalk = false } = {}) {
  const line = { ok: true, npcId: 'p8-dog', name: '小狗', line: '汪！', questId: '', questStatus: 'inactive' };
  return { caseId: 'dog', actions: [
    step('top-down', 'resume', {}, { paused: false, snapshot: dogPayload([0, 0]) }),
    step('top-down', 'talk', { npcId: 'p8-dog' }, spawnTalk ? line : { error: 'out_of_range' }),
    step('top-down', 'move', { dx: 1, dy: 0, steps: 45 }, { ok: true, before: [0, 0], after: [66, 0], distance: 66, blocked: false }),
    step('top-down', 'wait', { frames: 60 }, { ok: true, frames: 60 }),
    step('top-down', 'talk', { npcId: 'p8-dog' }, followTalk ? line : { error: 'out_of_range' }),
    step('top-down', 'move', { dx: 1, dy: 0, steps: 600 }, { ok: true, before: [66, 0], after: [640, 0], distance: 574, blocked: true }),
    step('top-down', 'wait', { frames: 60 }, { ok: true, frames: 60 }),
    step('top-down', 'move', { dx: 0, dy: 1, steps: 600 }, { ok: true, before: [640, 0], after: [640, 352], distance: 352, blocked: true }),
    step('top-down', 'wait', { frames: 60 }, { ok: true, frames: 60 }),
    step('top-down', 'talk', { npcId: 'p8-dog' }, farTalk ? line : { error: 'out_of_range' }),
  ] };
}

test('a complete dog implementation verifies every required behaviour', () => {
  const seen = verdict('dog', dogExercise(), dogSource);
  assert.equal(seen.verified, true);
  for (const id of ['stable-dog-id-authored', 'dog-visible-authored', 'close-range-dialogue', 'bounded-distance-follow', 'stops-when-far']) assert.equal(seen[id].status, 'verified', id);
  assert.equal(seen['stops-when-far'].evidence.travelled, 992);
  assert.ok(seen['stops-when-far'].evidence.travelled >= DOG_FAR_MIN_DISPLACEMENT);
});

test('a dog that keeps answering from far away fails the bounded follow', () => {
  const seen = verdict('dog', dogExercise({ farTalk: true }), dogSource);
  assert.equal(seen['close-range-dialogue'].status, 'verified');
  assert.equal(seen['stops-when-far'].status, 'failed');
  assert.equal(seen.verified, false);
});

test('a dog out of range at spawn fails the close-range requirement', () => {
  const seen = verdict('dog', dogExercise({ spawnTalk: false }), dogSource);
  assert.equal(seen['close-range-dialogue'].status, 'failed');
  assert.equal(seen.verified, false);
});

test('a dog that does not keep up over a short walk fails the follow requirement', () => {
  const seen = verdict('dog', dogExercise({ followTalk: false }), dogSource);
  assert.equal(seen['close-range-dialogue'].status, 'verified');
  assert.equal(seen['bounded-distance-follow'].status, 'failed');
  assert.equal(seen.verified, false);
});

test('a dog defined only as data with no visible representation fails visibility', () => {
  const seen = verdict('dog', dogExercise(), [{ path: 'scripts/core/dog.gd', kind: 'source', text: 'const DOG_ID := "p8-dog"' }]);
  assert.equal(seen['stable-dog-id-authored'].status, 'verified');
  assert.equal(seen['dog-visible-authored'].status, 'failed');
  assert.equal(seen.verified, false);
});

test('no evidence at all can never be verified', () => {
  for (const caseId of ['hammer', 'dog']) {
    const seen = verdict(caseId, { actions: [] }, []);
    assert.equal(seen.verified, false); assert.ok(seen.failed.length > 0);
    // The hammer has criteria with no subject at all (nothing was ever equipped),
    // which must read as unproven rather than as a failure of a mechanic.
    if (caseId === 'hammer') assert.ok(seen.insufficient.length > 0, caseId);
  }
});
