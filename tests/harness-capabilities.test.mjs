import test from 'node:test';
import assert from 'node:assert/strict';
import { BEHAVIOR_API_GUIDE, BEHAVIOR_CAPABILITIES, BEHAVIOR_KEYS, BEHAVIOR_LIMITS, BEHAVIOR_PERMISSIONS } from '../app/behavior-contracts.mjs';
import { SYSTEMS } from '../app/gameplay.mjs';
import { MATERIALS } from '../app/scene.mjs';
import { EVENT_TYPES, SCENE_LIMITS, STORAGE_LIMITS, capabilitiesCatalog, capabilitiesText } from '../app/harness/capabilities.mjs';

const declared = source => [...source.matchAll(/type:'([a-z]+\.[a-z.]+)'/g)].map(match => match[1]);

test('能力目录的命令集合与运行契约说明严格一致，不能出现目录之外的动词', () => {
  const catalog = capabilitiesCatalog();
  assert.deepEqual(catalog.commands.map(command => command.type).sort(), [...new Set(declared(BEHAVIOR_API_GUIDE))].sort());
  assert.equal(new Set(catalog.commands.map(command => command.type)).size, catalog.commands.length);
  for (const command of catalog.commands) {
    assert.ok(BEHAVIOR_PERMISSIONS.includes(command.permission), `${command.type} 的权限不在契约里`);
    if (command.capability) assert.ok(BEHAVIOR_CAPABILITIES.includes(command.capability), `${command.type} 的能力不在契约里`);
    assert.ok(command.scope && command.quota && command.example, `${command.type} 缺少作用范围、配额或例子`);
    assert.ok(Array.isArray(command.fields) && command.fields.length > 0);
    assert.ok(BEHAVIOR_API_GUIDE.includes(command.type));
  }
});

test('目录覆盖全部权限，事件与按键列表来自运行契约', () => {
  const catalog = capabilitiesCatalog();
  const used = new Set(catalog.commands.map(command => command.permission));
  assert.deepEqual(BEHAVIOR_PERMISSIONS.filter(permission => !used.has(permission)), []);
  assert.deepEqual(catalog.keys, [...BEHAVIOR_KEYS]);
  assert.deepEqual(catalog.events.map(event => event.type), ['start', 'tick', 'interact', 'contact', 'attack', 'land', 'key']);
  assert.deepEqual(EVENT_TYPES.find(event => event.type === 'key').payload, { code: 'keys 中声明过的按键代码' });
  assert.ok(catalog.events.every(event => event.note && typeof event.payload === 'object'));
});

test('玩法系统、材质、形状和上限都从实现派生', () => {
  const catalog = capabilitiesCatalog();
  assert.deepEqual(catalog.materials, [...Object.keys(MATERIALS), 'solid']);
  assert.deepEqual(catalog.shapes, ['box', 'blade']);
  for (const system of catalog.systems) {
    const definition = SYSTEMS[system.type];
    assert.ok(definition, `目录出现了不存在的玩法系统 ${system.type}`);
    assert.deepEqual(system.fields.map(field => field.name), Object.keys(definition.fields));
    for (const field of system.fields) assert.deepEqual([field.min, field.max], definition.fields[field.name]);
  }
  assert.equal(catalog.storageLimits.codeChars, BEHAVIOR_LIMITS.code);
  assert.equal(catalog.storageLimits.targets, BEHAVIOR_LIMITS.targets);
  assert.equal(catalog.sceneLimits.objects, SCENE_LIMITS.objects);
  assert.equal(catalog.runtime, 'craftmine-web/5');
});

test('目录返回副本，模型读到的内容不会反向污染宿主事实', () => {
  const first = capabilitiesCatalog();
  first.commands[0].type = 'hacked';
  first.keys.push('KeyA');
  first.sceneLimits.objects = 9999;
  const second = capabilitiesCatalog();
  assert.equal(second.commands[0].type, 'object.patch');
  assert.equal(second.keys.includes('KeyA'), false);
  assert.equal(second.sceneLimits.objects, SCENE_LIMITS.objects);
});

test('给模型看的文本列出真实命令、配额和按键，不解释立场', () => {
  const text = capabilitiesText();
  for (const type of ['object.patch', 'player.impulse', 'hud.message', 'audio.play', 'target.revive', 'inventory.add', 'inventory.define', 'hud.panel']) assert.ok(text.includes(type), `文本缺少 ${type}`);
  assert.ok(text.includes(`每步最多 ${BEHAVIOR_LIMITS.commands} 条`));
  assert.ok(text.includes('KeyG'));
  assert.ok(text.includes('不要读 frame.keys'));
  assert.ok(text.includes('target.revive'));
});
