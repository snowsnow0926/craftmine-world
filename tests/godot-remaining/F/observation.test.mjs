// F task: an observation is only trustworthy with world/build/base/sample
// identity, and a bounded operation may never install state directly.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  BOUNDED_OPERATIONS,
  FORBIDDEN_OPERATIONS,
  OBSERVATION_FORMAT,
  buildOperationRequest,
  createObservationEnvelope,
  validateObservationEnvelope,
  validateOperation,
} from '../../../desktop/godot/shared/observation.mjs';

const SHARED = 'desktop/godot/shared';
const identity = {
  worldId: 'world-alpha',
  buildId: 'build-7',
  instanceId: 'instance-1',
  baseId: 'side-view',
  baseVersion: '1.0.0',
};

test('an observation envelope carries world, build, base version and sample time', () => {
  const envelope = createObservationEnvelope({ ...identity, payload: { player: { x: 1 }, roomId: 'start' } });
  assert.equal(envelope.format, OBSERVATION_FORMAT);
  assert.equal(envelope.buildId, 'build-7');
  assert.ok(!Number.isNaN(Date.parse(envelope.sampledAt)));
  const result = validateObservationEnvelope(envelope, { expect: { worldId: 'world-alpha', buildId: 'build-7' } });
  assert.deepEqual(result.issues, []);
});

test('an observation without build or sample time is rejected', () => {
  const envelope = createObservationEnvelope({ ...identity, payload: {} });
  delete envelope.buildId;
  envelope.sampledAt = 'not a date';
  const result = validateObservationEnvelope(envelope);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((entry) => entry.message.includes('buildId')));
  assert.ok(result.issues.some((entry) => entry.code === 'sampled-at'));
});

test('an observation from another world fails the identity expectation', () => {
  const envelope = createObservationEnvelope({ ...identity, worldId: 'world-beta', payload: {} });
  const result = validateObservationEnvelope(envelope, { expect: { worldId: 'world-alpha' } });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((entry) => entry.code === 'identity-mismatch'));
});

test('state-installing operations are refused for every base', () => {
  for (const baseId of Object.keys(BOUNDED_OPERATIONS)) {
    for (const op of FORBIDDEN_OPERATIONS) {
      const result = validateOperation({ baseId, op, args: {} });
      assert.equal(result.ok, false, `${baseId}/${op}`);
      assert.ok(result.issues.some((entry) => entry.code === 'forbidden-state-operation'), `${baseId}/${op}`);
    }
  }
});

test('unknown operations and unknown arguments are refused', () => {
  assert.equal(validateOperation({ baseId: 'side-view', op: 'set-position', args: {} }).ok, false);
  assert.equal(validateOperation({ baseId: 'side-view', op: 'jump', args: {} }).ok, false);
  const extra = validateOperation({ baseId: 'top-down', op: 'buy', args: { shopId: 'general', itemId: 'bread', coins: 999 } });
  assert.equal(extra.ok, false);
  assert.ok(extra.issues.some((entry) => entry.code === 'unknown-argument'));
});

test('bounds match the real adapters', () => {
  assert.equal(validateOperation({ baseId: 'first-person', op: 'walk', args: { forward: 1, frames: 600 } }).ok, true);
  assert.equal(validateOperation({ baseId: 'first-person', op: 'walk', args: { forward: 1, frames: 601 } }).ok, false);
  assert.equal(validateOperation({ baseId: 'first-person', op: 'walk', args: { right: 2, frames: 30 } }).ok, false);
  assert.equal(validateOperation({ baseId: 'first-person', op: 'wait', args: { frames: 0 } }).ok, false);
  assert.equal(validateOperation({ baseId: 'first-person', op: 'equip', args: { value: 'pistol' } }).ok, true);
  assert.equal(validateOperation({ baseId: 'first-person', op: 'equip', args: { id: 'pistol' } }).ok, true);
  assert.equal(validateOperation({ baseId: 'first-person', op: 'equip', args: {} }).ok, false);
  assert.equal(validateOperation({ baseId: 'top-down', op: 'move', args: { dx: 1, dy: -1, steps: 600 } }).ok, true);
  assert.equal(validateOperation({ baseId: 'top-down', op: 'move', args: { steps: 601 } }).ok, false);
  assert.equal(validateOperation({ baseId: 'top-down', op: 'gather', args: { zoneId: 'HerbPatch' } }).ok, true);
  assert.equal(validateOperation({ baseId: 'top-down', op: 'buy', args: { shopId: 'general' } }).ok, false);
  assert.equal(validateOperation({ baseId: 'side-view', op: 'control', args: { segments: [{ ticks: 60, move: 1, jump: true }] } }).ok, true);
  assert.equal(validateOperation({ baseId: 'side-view', op: 'control', args: { segments: [] } }).ok, false);
  assert.equal(
    validateOperation({ baseId: 'side-view', op: 'control', args: { segments: Array.from({ length: 65 }, () => ({ ticks: 1 })) } }).ok,
    false,
  );
  assert.equal(
    validateOperation({ baseId: 'side-view', op: 'control', args: { segments: [{ ticks: 600 }, { ticks: 101 }] } }).ok,
    false,
  );
  assert.equal(
    validateOperation({ baseId: 'side-view', op: 'control', args: { segments: [{ ticks: 10, teleport: true }] } }).ok,
    false,
  );
});

test('read-only operations are marked and build a request without mutation', () => {
  for (const baseId of Object.keys(BOUNDED_OPERATIONS)) {
    const result = validateOperation({ baseId, op: 'snapshot', args: {} });
    assert.equal(result.ok, true, baseId);
    assert.equal(result.readOnly, true, baseId);
  }
  const request = buildOperationRequest({ id: 7, ...identity, baseId: 'top-down', op: 'move', args: { dx: 1, dy: 0, steps: 120 } });
  assert.equal(request.id, 7);
  assert.equal(request.op, 'move');
  assert.equal(request.readOnly, false);
  assert.throws(
    () => buildOperationRequest({ id: 8, ...identity, baseId: 'top-down', op: 'set-coins', args: { value: 999 } }),
    /forbidden-state-operation/,
  );
});

test('the Godot bridge registers the additive observe-envelope op', () => {
  const bridge = fs.readFileSync(`${SHARED}/runtime_bridge.gd`, 'utf8');
  assert.match(bridge, /"observe-envelope"/);
  for (const field of ['format', 'worldId', 'buildId', 'instanceId', 'baseId', 'baseVersion', 'sampledAt', 'payload']) {
    assert.match(bridge, new RegExp(`"${field}":`), `bridge envelope declares ${field}`);
  }
  assert.match(bridge, /craftmine\.godot-observation\/1/);
  // The existing observe shape is untouched, so cycle-06 consumers keep working.
  assert.match(bridge, /"observe":\s*\r?\n\s*return \{"result": adapter\.observe\(\)\}/);
});

test('each base adapter allowlist matches the shared bounded operation schema', () => {
  const adapters = {
    'first-person': `${SHARED}/adapters/first-person.gd`,
    'top-down': `${SHARED}/adapters/top-down.gd`,
    'side-view': `${SHARED}/adapters/side-view.gd`,
    'mining-sandbox': `${SHARED}/adapters/mining-sandbox.gd`,
  };
  const declaredOps = (text) => {
    const allowed = /ALLOWED_OPERATIONS\s*:=\s*(\[[^\]]*\])/.exec(text);
    if (allowed) return JSON.parse(allowed[1]);
    const inList = /op in \[([^\]]*)\]/.exec(text);
    if (inList) {
      return inList[1]
        .split(',')
        .map((token) => token.trim().replace(/^"|"$/g, ''))
        .filter(Boolean);
    }
    if (/"control"/.test(text)) return ['control'];
    return [];
  };
  for (const [baseId, file] of Object.entries(adapters)) {
    const text = fs.readFileSync(file, 'utf8');
    const schema = BOUNDED_OPERATIONS[baseId];
    // `snapshot` is intercepted by the runtime bridge, so it is a valid shared
    // read-only operation but never reaches the per-base adapter.
    const bridgeOps = ['snapshot'];
    const allowed = [...schema.readOnly, ...Object.keys(schema.mutating)].filter((op) => !bridgeOps.includes(op)).sort();
    const declared = declaredOps(text).filter((op) => !bridgeOps.includes(op)).sort();
    assert.deepEqual(declared, allowed, `${baseId} adapter allowlist drifted from the shared schema`);
    for (const op of FORBIDDEN_OPERATIONS) {
      assert.ok(!declared.includes(op), `${baseId} adapter must not declare ${op}`);
    }
  }
});
