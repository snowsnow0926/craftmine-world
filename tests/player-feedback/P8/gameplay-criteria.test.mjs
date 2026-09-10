import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FOLLOW_PROOF_MIN_PX, FAR_PROOF_MIN_PX, LIGHTNING_MIN_COOLDOWN_SECONDS } from './gameplay-criteria.mjs';
import { hammerExercise, hammerSource, dogExercise, dogSource, line, verdict } from './gameplay-fixtures.mjs';



test('a complete hammer run verifies the machine-checkable mechanics and defers only the lightning claims', () => {
  const got = verdict('hammer', hammerExercise({ interact: 3 }), hammerSource);
  assert.deepEqual(got.failed, []);
  assert.deepEqual(got.insufficient, []);
  assert.deepEqual(got.reviewRequired, ['lightning-visible-in-frames', 'lightning-cooldown-at-least-one-second']);
  for (const id of ['stable-equipment-id-authored', 'pickup-source-hint', 'pickup-actual', 'equip-stable-id', 'equipment-visible', 'attack-accepted', 'attack-gate-diagnostic', 'attack-affects-target', 'lightning-visual-in-source']) assert.equal(got[id].status, 'verified', id);
  assert.equal(got.machineVerified, false); assert.equal(got.verified, false);
  assert.equal(got['attack-gate-diagnostic'].evidence.adjacent.reason, 'cooling-down');
  assert.equal(got['attack-gate-diagnostic'].evidence.adjacent.capturedBetween, false);
  assert.equal(got['attack-gate-diagnostic'].evidence.weaponCooldowns[0], 1.5);
  assert.equal(got['lightning-cooldown-at-least-one-second'].evidence.declared[0].name, 'LIGHTNING_COOLDOWN');
});

test('the frame evidence keeps the real capture times, attack association and offsets', () => {
  const got = verdict('hammer', hammerExercise({ interact: 3 }), hammerSource);
  const frames = got['lightning-cooldown-at-least-one-second'].evidence.frames;
  assert.equal(frames.length, 3);
  for (const frame of frames) {
    assert.ok(Number.isFinite(frame.capturedAtMs) && Number.isFinite(frame.captureStartedAtMs));
    assert.ok(Number.isFinite(frame.commandCompletedAtMs) && Number.isFinite(frame.observedAtMs));
    assert.ok(frame.sampledAt && frame.sha256 && frame.file);
  }
  const attackFrames = frames.filter(frame => frame.associatedAttack !== null);
  assert.ok(attackFrames.length >= 1);
  assert.ok(attackFrames.every(frame => Number.isInteger(frame.associatedAttack) && Number.isFinite(frame.offsetFromAttackCompletedMs)));
  assert.equal(frames[0].associatedAttack, null);
  assert.equal(frames[0].offsetFromAttackCompletedMs, null, 'a frame with no attack reports null rather than a zero');
});

test('the ordinary attack gate is a diagnostic and never a failure', () => {
  const neverRefused = verdict('hammer', hammerExercise({ interact: 3, gap: 30 }), hammerSource);
  assert.equal(neverRefused['attack-gate-diagnostic'].status, 'verified');
  // A weapon whose cooldown is shorter than a second, with an independent effect
  // cooldown, is a legal implementation: this must not be a machine failure.
  const shortWeapon = verdict('hammer', hammerExercise({ interact: 3, gap: 200 }), hammerSource);
  assert.equal(shortWeapon.failed.includes('attack-gate-diagnostic'), false);
  assert.notEqual(shortWeapon['attack-gate-diagnostic'].status, 'failed');
  assert.match(shortWeapon['attack-gate-diagnostic'].evidence.scope, /not a failure/);
  // A capture between the two attacks means their gap is not an adjacent-attack
  // measurement. The real elapsed time is reported, never adjusted downwards.
  const captured = verdict('hammer', hammerExercise({ interact: 3, captureBetween: true }), hammerSource);
  assert.equal(captured['attack-gate-diagnostic'].status, 'insufficient');
  assert.equal(captured['attack-gate-diagnostic'].evidence.adjacent.capturedBetween, true);
  assert.match(captured['attack-gate-diagnostic'].evidence.note, /real elapsed time is not adjusted/);
  assert.equal(captured['attack-gate-diagnostic'].evidence.adjacent.gapMs >= 400, true, 'the real gap is reported as measured, capture included');
  const noAttacks = verdict('hammer', hammerExercise({ interact: 3 }), hammerSource);
  assert.notEqual(noAttacks['attack-gate-diagnostic'].status, 'failed');
});

test('a pickup that was never aimed at is untested, not a product failure', () => {
  // The scan never pointed at an interactable: the driver did not test the claim.
  const neverAimed = verdict('hammer', hammerExercise({ interact: 3, pickup: false, aim: { interactable: false, collider: '', prompt: '' } }), hammerSource);
  assert.equal(neverAimed['pickup-actual'].status, 'insufficient');
  assert.equal(neverAimed['pickup-actual'].evidence.stepPresent, true);
  assert.equal(neverAimed['pickup-actual'].evidence.aimedAttempts, 0);
  assert.match(neverAimed['pickup-actual'].evidence.note, /did not test this claim/);
  assert.equal(neverAimed.failed.includes('pickup-actual'), false);
  // The ray was on the hammer's own pickup and the product refused it: that is a
  // real contradiction.
  const refused = verdict('hammer', hammerExercise({ interact: 3, pickup: false, aim: { interactable: true, collider: 'ThunderHammerPickup', prompt: 'Pick up thunder_hammer [E]' } }), hammerSource);
  assert.equal(refused['pickup-actual'].status, 'failed');
  assert.ok(refused['pickup-actual'].evidence.contradiction);
  // Directly equipping is still not a pickup, and there is no fallback equip path.
  const equippedOnly = verdict('hammer', hammerExercise({ interact: 0 }), hammerSource);
  assert.equal(equippedOnly['pickup-actual'].status, 'insufficient');
  assert.equal(equippedOnly['pickup-actual'].evidence.stepPresent, false);
  assert.equal(equippedOnly['equip-stable-id'].status, 'verified');
});

test('pickup evidence records the aim, the interact return and the inventory around it', () => {
  const got = verdict('hammer', hammerExercise({ interact: 3 }), hammerSource);
  const attempt = got['pickup-actual'].evidence.attempts[0];
  assert.equal(attempt.aimInteractable, true);
  assert.equal(attempt.handled, true); assert.equal(attempt.item, 'thunder_hammer'); assert.equal(attempt.taken, true);
  assert.equal(attempt.carriedBefore, false); assert.equal(attempt.carriedAfter, true);
  assert.deepEqual(attempt.interactablesBefore, [{ id: 'ThunderHammerPickup', enabled: true, taken: false }]);
  assert.deepEqual(attempt.interactablesAfter, [{ id: 'ThunderHammerPickup', enabled: true, taken: true }]);
});

test('the hammer id and the lightning effect must exist in the built source', () => {
  const got = verdict('hammer', hammerExercise({ interact: 3 }), [{ path: 'scripts/core/world.gd', kind: 'source', text: 'func _ready():\n\tpass' }]);
  assert.ok(got.failed.includes('stable-equipment-id-authored'));
  assert.ok(got.failed.includes('pickup-source-hint'));
  assert.ok(got.failed.includes('lightning-visual-in-source'));
  const noEffect = verdict('hammer', hammerExercise({ interact: 3 }), [{ path: 'data/equipment/thunder_hammer.tres', kind: 'source', text: 'id = "thunder_hammer"\nspawn_pickup("thunder_hammer")' }]);
  assert.equal(noEffect['lightning-visual-in-source'].status, 'failed');
});

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
  const tooNear = verdict('dog', dogExercise({ shortSteps: 45, farSteps: 60 }), dogSource);
  assert.equal(tooNear['far-out-of-contact-observed'].status, 'failed');
  assert.match(tooNear['far-out-of-contact-observed'].evidence.note, /far leg did not produce/);
  const stillContact = verdict('dog', dogExercise({ farOverlaps: { 'p8-dog': true } }), dogSource);
  assert.equal(stillContact['far-out-of-contact-observed'].status, 'failed');
});

test('an unfinished retrace is untested while a completed one that never touches the dog is a failure', () => {
  const never = verdict('dog', dogExercise({ retraceContact: false, retrace: { complete: true, contact: false, requiredPx: 515, coveredPx: 520, chunks: 36 } }), dogSource);
  assert.equal(never['approach-recontact-observed'].status, 'failed');
  assert.match(never['approach-recontact-observed'].evidence.note, /covered the whole outbound path/);
  const short = verdict('dog', dogExercise({ retraceContact: false, retrace: { complete: false, contact: false, requiredPx: 515, coveredPx: 120, chunks: 60 } }), dogSource);
  assert.equal(short['approach-recontact-observed'].status, 'insufficient');
  assert.match(short['approach-recontact-observed'].evidence.note, /did not cover the outbound path/);
  assert.equal(short.failed.includes('approach-recontact-observed'), false, 'a driver geometry limit is not a product failure');
  const missing = verdict('dog', { actions: dogExercise().actions }, dogSource);
  assert.equal(missing['approach-recontact-observed'].status, 'verified', 'without a retrace record the talk evidence still decides');
});

test('no evidence at all can never be verified', () => {
  for (const caseId of ['hammer', 'dog']) {
    const got = verdict(caseId, { actions: [] }, []);
    assert.equal(got.verified, false); assert.equal(got.machineVerified, false);
    assert.ok(got.failed.length > 0);
  }
  const dog = verdict('dog', { actions: [] }, []);
  assert.ok(dog.reviewRequired.length > 0, 'the deferred visual claim is still reported, never silently dropped');
  assert.equal(LIGHTNING_MIN_COOLDOWN_SECONDS, 1);
});
