import test from 'node:test';
import assert from 'node:assert/strict';
import { compileScene } from '../app/scene.mjs';
import { BehaviorState } from '../app/behavior-state.mjs';
import { validateBehaviorResult } from '../app/behavior-contracts.mjs';
import { boundsCenter, easeInOut, sameBounds, tweenDelta, tweenProgress, unionBounds } from '../app/tween.mjs';
import { observableChange, worldSnapshot } from '../app/harness/acceptance.mjs';
import { behaviorFrame, behaviorScene, doorBehavior } from './behavior-fixtures.mjs';

const box = (min, max) => ({ min: { x: min[0], y: min[1], z: min[2] }, max: { x: max[0], y: max[1], z: max[2] } });
const apply = commands => {
  const build = compileScene(behaviorScene());
  const state = new BehaviorState(build, null);
  const artifact = build.behaviors.find(b => b.definition.id === 'sliding-door');
  return { state, applied: state.apply(artifact, { state: { open: true }, commands }, behaviorFrame()) };
};

test('插值进度在起点为 0、终点为 1，非法时长直接完成', () => {
  assert.equal(tweenProgress(10, 10, 2), 0);
  assert.equal(tweenProgress(10, 11, 2), 0.5);
  assert.equal(tweenProgress(10, 12, 2), 1);
  assert.equal(tweenProgress(10, 20, 2), 1);
  assert.equal(tweenProgress(10, 9, 2), 0);
  assert.equal(tweenProgress(10, 11, 0), 1);
  assert.equal(tweenProgress(10, 11, -1), 1);
});

test('缓动曲线端点正确、单调递增，且对称', () => {
  assert.equal(easeInOut(0), 0);
  assert.equal(easeInOut(1), 1);
  assert.equal(easeInOut(0.5), 0.5);
  assert.equal(easeInOut(-1), 0);
  assert.equal(easeInOut(2), 1);
  let previous = -1;
  for (let t = 0; t <= 1.0001; t += 0.05) { const value = easeInOut(t); assert.ok(value >= previous); previous = value; }
  assert.equal(Number(easeInOut(0.25).toFixed(4)), Number((1 - easeInOut(0.75)).toFixed(4)));
});

test('位移按包围盒中心计算，起点不动、终点到位，尺寸不参与', () => {
  const from = box([0, 6, 0], [1, 8, 1]);
  const to = box([4, 6, -2], [5, 8, -1]);
  assert.deepEqual(tweenDelta(from, to, 0), { x: 0, y: 0, z: 0 });
  assert.deepEqual(tweenDelta(from, to, 1), { x: 4, y: 0, z: -2 });
  assert.deepEqual(tweenDelta(from, to, 0.5), { x: 2, y: 0, z: -1 });
  assert.deepEqual(boundsCenter(from), { x: 0.5, y: 7, z: 0.5 });
  assert.equal(sameBounds(from, from), true);
  assert.equal(sameBounds(from, to), false);
  assert.equal(sameBounds(null, to), false);
  assert.deepEqual(unionBounds([box([0, 0, 0], [1, 1, 1]), box([2, 0, -1], [3, 2, 0])]), box([0, 0, -1], [3, 2, 1]));
  assert.equal(unionBounds([]), null);
});

test('移动时长只接受 0 到 5 秒，省略或 0 表示瞬间移动', () => {
  const run = duration => validateBehaviorResult({ state: {}, commands: [{ type: 'object.patch', id: 'door-one', duration }] }, doorBehavior(), behaviorFrame());
  for (const duration of [0, 0.5, 5, undefined, null]) assert.doesNotThrow(() => run(duration));
  for (const duration of [-0.1, 5.1, 60, 'fast']) assert.throws(() => run(duration), /移动时长/);
});

test('带时长的移动发出平滑移动效果，但不把时长写进存档', () => {
  const { state, applied } = apply([{ type: 'object.patch', id: 'door-one', position: { x: 1.2, y: 6, z: 7 }, duration: 0.8 }]);
  assert.deepEqual(applied.effects, [{ type: 'object.move', id: 'door-one', duration: 0.8 }]);
  assert.deepEqual(applied.changed, ['door-one']);
  const override = state.value.modules['sliding-door'].overrides['door-one'];
  assert.equal(override.duration, undefined);
  assert.deepEqual(Object.keys(override).sort(), ['color', 'offset', 'solid', 'visible', 'yaw']);
  assert.deepEqual(state.snapshot().modules['sliding-door'].overrides['door-one'], override);
});

test('瞬间移动和没有实际变化的移动都不会产生平滑移动效果', () => {
  const instant = apply([{ type: 'object.patch', id: 'door-one', position: { x: 1.2, y: 6, z: 7 } }]);
  assert.deepEqual(instant.applied.effects, []);
  const same = apply([{ type: 'object.patch', id: 'door-one', position: { x: 0, y: 6, z: 7 }, duration: 1 }]);
  assert.deepEqual(same.applied.effects, []);
  assert.deepEqual(same.applied.changed, []);
});

test('平滑移动在结果级验收里算可观测变化', () => {
  const before = worldSnapshot({ objects: [{ id: 'door-one' }], effects: [] });
  const after = worldSnapshot({ objects: [{ id: 'door-one' }], effects: [{ type: 'object.move' }] });
  assert.deepEqual(observableChange(before, after).fields, ['effects']);
});
