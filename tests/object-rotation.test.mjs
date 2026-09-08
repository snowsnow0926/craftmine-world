import test from 'node:test';
import assert from 'node:assert/strict';
import { compileScene } from '../app/scene.mjs';
import { BehaviorState } from '../app/behavior-state.mjs';
import { validateBehaviorResult } from '../app/behavior-contracts.mjs';
import { observableChange, worldSnapshot } from '../app/harness/acceptance.mjs';
import { behaviorFrame, behaviorScene, doorBehavior } from './behavior-fixtures.mjs';
import { part } from './scene-fixtures.mjs';

const build = scene => compileScene(scene);
const rotated = (yaw, scene = behaviorScene()) => {
  const compiled = build(scene);
  const state = new BehaviorState(compiled, null);
  const artifact = compiled.behaviors.find(b => b.definition.id === 'sliding-door');
  state.apply(artifact, { state: { open: true }, commands: [{ type: 'object.patch', id: 'door-one', yaw }] }, behaviorFrame());
  return state;
};
const extent = (state, id) => {
  const parts = state.view.primitives.filter(p => p.id === id);
  return ['x', 'y', 'z'].map(axis => Number((Math.max(...parts.map(p => p.max[axis])) - Math.min(...parts.map(p => p.min[axis]))).toFixed(3)));
};

test('朝向只接受 90 度整步，其他角度被拒绝', () => {
  const definition = doorBehavior();
  const run = yaw => validateBehaviorResult({ state: {}, commands: [{ type: 'object.patch', id: 'door-one', yaw }] }, definition, behaviorFrame());
  for (const yaw of [0, 90, 180, 270, null]) assert.doesNotThrow(() => run(yaw));
  for (const yaw of [45, 91, -90, '90']) assert.throws(() => run(yaw), /朝向/);
});

test('旋转把长度换到另一轴，Y 方向不变，结果精确而不是近似', () => {
  const before = extent(new BehaviorState(build(behaviorScene()), null), 'door-one');
  assert.deepEqual(before, [1, 2.5, 0.23]);
  assert.deepEqual(extent(rotated(90), 'door-one'), [before[2], before[1], before[0]]);
  assert.deepEqual(extent(rotated(180), 'door-one'), before);
  assert.deepEqual(extent(rotated(270), 'door-one'), [before[2], before[1], before[0]]);
});

test('朝向写进玩法进度，重新载入后仍然保持', () => {
  const state = rotated(90);
  assert.equal(state.snapshot().modules['sliding-door'].overrides['door-one'].yaw, 90);
  const restored = new BehaviorState(build(behaviorScene()), state.snapshot());
  assert.deepEqual(extent(restored, 'door-one'), [0.23, 2.5, 1]);
  assert.equal(restored.value.modules['sliding-door'].overrides['door-one'].yaw, 90);
});

test('旋转后超出场地会被拒绝，整步不生效', () => {
  const scene = { ...behaviorScene(), objects: [{ ...behaviorScene().objects[0], position: { x: 40, y: 6, z: 0 }, parts: [part([0, 0, 0], [0.5, 2, 24], '#d3ad6d', 'box', true, 'wood')] }, behaviorScene().objects[1]] };
  const compiled = build(scene);
  const state = new BehaviorState(compiled, null);
  const artifact = compiled.behaviors.find(b => b.definition.id === 'sliding-door');
  assert.throws(() => state.apply(artifact, { state: {}, commands: [{ type: 'object.patch', id: 'door-one', yaw: 90 }] }, behaviorFrame()), /超出世界边界/);
  assert.equal(state.value.modules['sliding-door'].overrides['door-one'], undefined);
});

test('结果级验收能看见朝向变化，不会把旋转当成没效果', () => {
  const before = worldSnapshot({ objects: [{ id: 'door-one', bounds: { min: { x: 0, y: 6, z: 6 }, max: { x: 1, y: 8, z: 7 } } }] });
  const after = worldSnapshot({ objects: [{ id: 'door-one', bounds: { min: { x: 0, y: 6, z: 6 }, max: { x: 0.15, y: 8, z: 8 } } }] });
  assert.deepEqual(observableChange(before, after).fields, ['object:door-one.bounds']);
  assert.equal(observableChange(before, before).changed, false);
});
