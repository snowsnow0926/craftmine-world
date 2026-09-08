import test from 'node:test';
import assert from 'node:assert/strict';
import { compileScene } from '../app/scene.mjs';
import { BehaviorState } from '../app/behavior-state.mjs';
import { validateBehavior } from '../app/behavior-contracts.mjs';
import { behaviorScene, doorBehavior } from './behavior-fixtures.mjs';

const build = (overrides = {}) => compileScene({ ...behaviorScene(), behaviors: [{ ...doorBehavior(), ...overrides }] });
const v2 = (overrides = {}) => ({ stateVersion: 2, initialState: { open: false, cooldown: 0 }, ...overrides });
const saved = (state, overrides = {}) => {
  const snapshot = new BehaviorState(build(), null).snapshot();
  snapshot.modules['sliding-door'] = { ...snapshot.modules['sliding-door'], state, ...overrides };
  return snapshot;
};

test('没有声明迁移时拒绝升级，并明确告诉模型怎么补 migrate', () => {
  assert.throws(() => new BehaviorState(build(v2()), saved({ open: true })), /需要迁移状态 v1 → v2.*migrate/);
});

test('声明迁移后按 rename/keep/add 迁移，并保留世界改动', () => {
  const migrated = new BehaviorState(build(v2({ migrate: [{ from: 1, rename: { opened: 'open' }, keep: ['open'], add: { cooldown: 3 } }] })), saved({ opened: true, junk: 1 }, { overrides: { 'door-one': { offset: { x: 1, y: 0, z: 0 }, visible: true, solid: null, color: null } } }));
  const record = migrated.value.modules['sliding-door'];
  assert.equal(record.stateVersion, 2);
  assert.deepEqual(record.state, { open: true, cooldown: 3 });
  assert.equal(record.overrides['door-one'].offset.x, 1);
  assert.equal(record.error, '');
});

test('缺少的新字段自动用 initialState 补齐，旧的同名值保留', () => {
  const migrated = new BehaviorState(build(v2({ migrate: [{ from: 1 }] })), saved({ open: true }));
  assert.deepEqual(migrated.value.modules['sliding-door'].state, { open: true, cooldown: 0 });
});

test('迁移声明本身受校验：起始版本、重复、字段和数量', () => {
  const base = doorBehavior();
  assert.doesNotThrow(() => validateBehavior({ ...base, stateVersion: 2, migrate: [{ from: 1, keep: ['open'], rename: { a: 'b' }, add: { c: 1 } }] }));
  assert.throws(() => validateBehavior({ ...base, stateVersion: 2, migrate: [{ from: 2 }] }), /起始版本/);
  assert.throws(() => validateBehavior({ ...base, stateVersion: 3, migrate: [{ from: 1 }, { from: 1 }] }), /起始版本/);
  assert.throws(() => validateBehavior({ ...base, stateVersion: 2, migrate: [{ from: 1, drop: ['open'] }] }), /只允许/);
  assert.throws(() => validateBehavior({ ...base, stateVersion: 2, migrate: [{ from: 1, keep: ['__proto__'] }] }), /保留字段/);
  assert.throws(() => validateBehavior({ ...base, stateVersion: 2, migrate: [{ from: 1, rename: { a: 1 } }] }), /重命名字段/);
  assert.throws(() => validateBehavior({ ...base, stateVersion: 2, migrate: Array.from({ length: 9 }, (_, i) => ({ from: i + 1 })) }), /最多 8 条/);
});

test('状态版本相同时不会误用迁移', () => {
  const same = new BehaviorState(build(), saved({ open: true }));
  assert.deepEqual(same.value.modules['sliding-door'].state, { open: true });
  assert.equal(same.value.modules['sliding-door'].stateVersion, 1);
});
