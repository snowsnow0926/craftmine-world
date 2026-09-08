import test from 'node:test';
import assert from 'node:assert/strict';
import { GameplaySession, SYSTEMS, validateGameplayState, validateSystem, validateSystems } from '../app/gameplay.mjs';
import { validateBehaviorResult } from '../app/behavior-contracts.mjs';
import { behaviorFrame, doorBehavior } from './behavior-fixtures.mjs';
import { capabilitiesCatalog, capabilitiesText } from '../app/harness/capabilities.mjs';

const resource = (id = 'system-stamina', name = '体力', config = { max: 100, regenPerSecond: 0, start: 100 }) => ({ id, name, type: 'resource', config, source: null });
const definition = (overrides = {}) => ({ ...doorBehavior(), permissions: ['resources.write'], ...overrides });
const commands = list => validateBehaviorResult({ state: {}, commands: list }, definition(), behaviorFrame());

test('自定义资源可以同时启用多个，其他系统类型仍然只能有一个', () => {
  assert.equal(SYSTEMS.resource.fields.max[1], 10000);
  assert.doesNotThrow(() => validateSystems([resource(), resource('system-mana', '魔法')]));
  assert.throws(() => validateSystems([resource(), resource()]), /重复/);
  assert.throws(() => validateSystems([resource(), resource('system-mana', '魔法'), { id: 'h1', name: '血量', type: 'health', config: { maxHealth: 100, fallDamage: 0, regenPerSecond: 0 }, source: null }, { id: 'h2', name: '血量2', type: 'health', config: { maxHealth: 100, fallDamage: 0, regenPerSecond: 0 }, source: null }]), /重复/);
  assert.throws(() => validateSystems(Array.from({ length: 7 }, (_, i) => resource('system-r' + i, '资源' + i))), /六类/);
});

test('资源系统配置范围受限，字段必须齐全', () => {
  assert.throws(() => validateSystem(resource('system-x', '体力', { max: 0, regenPerSecond: 0, start: 0 })), /数值/);
  assert.throws(() => validateSystem(resource('system-x', '体力', { max: 100, regenPerSecond: 101, start: 0 })), /数值/);
  assert.throws(() => validateSystem({ id: 'system-x', name: '体力', type: 'resource', config: { max: 100 }, source: null }), /字段/);
});

test('初始值、恢复速率和增减都夹在 0 到上限之间', () => {
  const session = new GameplaySession([resource('system-stamina', '体力', { max: 100, regenPerSecond: 10, start: 250 })]);
  assert.equal(session.resource('system-stamina').value, 100);
  session.setResource('system-stamina', 40);
  session.tick(1);
  assert.equal(session.resource('system-stamina').value, 50);
  session.tick(10);
  assert.equal(session.resource('system-stamina').value, 100);
  assert.equal(session.addResource('system-stamina', -999), 0);
  assert.equal(session.addResource('system-stamina', 999), 100);
  assert.equal(session.setResource('system-stamina', -5), 0);
  assert.equal(session.addResource('system-missing', 1), null);
  assert.equal(session.resource('system-missing'), null);
});

test('资源进度随存档保留，非法存档被拒绝', () => {
  const session = new GameplaySession([resource('system-mana', '魔法')]);
  session.setResource('system-mana', 37);
  const saved = session.snapshot();
  assert.doesNotThrow(() => validateGameplayState(saved));
  assert.equal(new GameplaySession([resource('system-mana', '魔法')], [], saved).resource('system-mana').value, 37);
  assert.throws(() => validateGameplayState({ ...saved, systems: { 'system-mana': { type: 'resource', value: 101, max: 100 } } }), /数值/);
  assert.throws(() => validateGameplayState({ ...saved, systems: { 'system-mana': { type: 'resource', value: 1, max: 100, extra: 1 } } }), /字段/);
});

test('资源不是武器，不会占用装备槽', () => {
  const session = new GameplaySession([resource()]);
  assert.equal(session.state.equipped, null);
  assert.equal(session.equip('resource'), false);
});

test('玩法命令可以增减资源，越权、越界和多余字段被拒绝', () => {
  assert.deepEqual(commands([{ type: 'resource.add', id: 'system-stamina', amount: -10 }]).commands, [{ type: 'resource.add', id: 'system-stamina', amount: -10 }]);
  assert.doesNotThrow(() => commands([{ type: 'resource.set', id: 'system-mana', value: 0 }]));
  assert.throws(() => validateBehaviorResult({ state: {}, commands: [{ type: 'resource.add', id: 'system-stamina', amount: 1 }] }, { ...doorBehavior(), permissions: ['objects.write'] }, behaviorFrame()), /权限/);
  assert.throws(() => commands([{ type: 'resource.add', id: 'system-stamina', amount: 10001 }]), /数值/);
  assert.throws(() => commands([{ type: 'resource.set', id: 'system-stamina', value: -1 }]), /数值/);
  assert.throws(() => commands([{ type: 'resource.add', id: 'System-Stamina', amount: 1 }]), /资源 ID/);
  assert.throws(() => commands([{ type: 'resource.add', id: 'system-stamina', amount: 1, extra: 1 }]), /字段/);
});

test('能力目录与提示词都反映自定义资源，模型不需要宿主改代码', () => {
  const catalog = capabilitiesCatalog();
  const types = catalog.commands.map(command => command.type);
  assert.ok(types.includes('resource.add') && types.includes('resource.set'));
  const system = catalog.systems.find(item => item.type === 'resource');
  assert.deepEqual(system.fields.map(field => field.name), ['max', 'regenPerSecond', 'start']);
  assert.ok(catalog.requires.includes('resource@1'));
  assert.ok(catalog.permissions.includes('resources.write'));
  const text = capabilitiesText();
  assert.ok(text.includes('resource.add'));
  assert.ok(text.includes('体力、魔法、饥饿、护甲'));
});
