import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ProjectStore } from '../app/store.mjs';
import { behaviorScene, doorBehavior } from './behavior-fixtures.mjs';
import { TaskWorkspace } from '../app/harness/workspace.mjs';
import { authorExtension, extensionAuthorPrompt, parseExtensionPackage } from '../app/harness/extension-author.mjs';
import { extensionCatalog, validateExtension, validateExtensionResult } from '../app/harness/extension.mjs';

// E2 第一环：模型提议扩展。模型只能写「新命令名 + 翻译成宿主原子效果」。
const ROOT = path.resolve('test-results/extension-author');
fs.mkdirSync(ROOT, { recursive: true });

const EXTENSION = {
  format: 'craftmine.extension/1', id: 'life-steal', name: '吸血', version: 1,
  description: '命中时把伤害的一部分转成自己的生命',
  requires: [], permissions: ['targets.write', 'hud.message'], targets: ['door-one'], capabilities: [],
  provides: { commands: [{ type: 'life.steal', permission: 'targets.write', scope: '声明过的 targets', fields: [{ name: 'targetId', description: '目标 ID' }, { name: 'amount', description: '吸血量 1..50' }] }], events: [] },
  lifecycle: { register: 'onLoad', unload: 'rejectModules' },
  code: 'export function apply({ command }) { return { effects: [{ type: "target.damage", id: command.targetId, amount: Math.max(1, Math.min(50, command.amount | 0)) }, { type: "hud.message", text: "吸血" }], state: {} }; }',
  selfTests: [{
    name: '吸血扣目标血量', world: { objects: [{ id: 'door-one', position: { x: 0, y: 6, z: 0 }, visible: true, mesh: true, health: 40, solid: true }] },
    state: {}, commands: [{ type: 'life.steal', targetId: 'door-one', amount: 10 }],
    expect: [{ id: 'life.damage', kind: 'objectHealth', why: '目标真的掉血', red: '不扣血的实现', object: 'door-one', max: 30, step: 'command-1' }],
  }],
};

test('提议扩展的提示词把宿主原子效果、真实目标 ID 和反造假要求都写清楚', () => {
  const prompt = extensionAuthorPrompt({ said: '我要吸血', targets: ['door-one', 'pad-one'], extensions: [EXTENSION] });
  assert.match(prompt, /我要吸血/);
  assert.match(prompt, /craftmine\.extension\/1/);
  assert.match(prompt, /export function apply/);
  for (const type of ['object.patch', 'player.impulse', 'hud.message', 'audio.play', 'target.revive', 'target.damage', 'health.add', 'resource.add', 'resource.set', 'inventory.add', 'inventory.define', 'hud.panel']) {
    assert.match(prompt, new RegExp('\\b' + type.replace('.', '\\.') + '\\b'), `提示词必须列出宿主原子效果 ${type}`);
  }
  assert.match(prompt, /当前世界可用的目标对象 ID：door-one、pad-one/);
  assert.match(prompt, /空实现/);
  assert.match(prompt, /已装载扩展（新扩展可以依赖它们/);
  assert.match(prompt, /life-steal@1/);
  const empty = extensionAuthorPrompt({ said: '随便', targets: [], extensions: [] });
  assert.match(empty, /当前世界还没有对象/);
  assert.match(empty, /当前没有已装载扩展/);
});

test('提议解析：只接受通过格式校验的扩展包，坏包显式报错', () => {
  const parsed = parseExtensionPackage('```json\n' + JSON.stringify(EXTENSION) + '\n```');
  assert.equal(parsed.id, 'life-steal');
  assert.notEqual(parsed, EXTENSION, '解析结果必须是深拷贝');
  assert.throws(() => parseExtensionPackage('这里没有 JSON'), /没有返回 JSON 对象/);
  assert.throws(() => parseExtensionPackage('{"format":"craftmine.extension/1"}'), /扩展 ID 无效/);
  assert.throws(() => parseExtensionPackage(JSON.stringify({ ...EXTENSION, code: 'export const nothing = 1;' })), /必须导出 apply/);
  assert.throws(() => parseExtensionPackage(JSON.stringify({ ...EXTENSION, permissions: ['root.everything'] })), /不存在的权限/);
});

test('提议循环：第一次不合格就把宿主的拒绝理由回灌给模型重写', async () => {
  const bad = JSON.stringify({ ...EXTENSION, requires: ['health@1'] });
  const prompts = [];
  const good = await authorExtension({
    said: '我要吸血', targets: ['door-one'],
    generate: async (prompt, attempt) => { prompts.push({ attempt, prompt }); return attempt === 1 ? bad : JSON.stringify(EXTENSION); },
  });
  assert.equal(good.extension.id, 'life-steal');
  assert.equal(good.attempts, 2);
  assert.deepEqual(good.errors, ['扩展依赖格式无效：health@1']);
  assert.equal(prompts.length, 2);
  assert.equal(prompts[0].attempt, 1);
  assert.match(prompts[1].prompt, /上一次的提议被宿主拒绝：扩展依赖格式无效：health@1/);
  assert.match(prompts[1].prompt, /重新输出一份完整 JSON/);

  const failures = [];
  await assert.rejects(() => authorExtension({ said: 'x', generate: async () => { failures.push(1); return bad; }, attempts: 2 }), /连续 2 次没有通过宿主检查/);
  assert.equal(failures.length, 2, '重试用尽后必须显式失败，不能假装成功');
  await assert.rejects(() => authorExtension({ said: 'x', generate: null }), /模型调用函数/);
  await assert.rejects(() => authorExtension({ said: 'x', generate: async () => '', verify: 1 }), /校验器/);
  await assert.rejects(() => authorExtension({ said: 'x', generate: async () => '', attempts: 9 }), /重试次数/);
});

test('提议循环会把沙箱自带测试的失败原因回灌给模型重写', async () => {
  const prompts = [];
  let verifies = 0;
  const good = await authorExtension({
    said: '我要吸血',
    generate: async (prompt, attempt) => { prompts.push({ attempt, prompt }); return JSON.stringify(EXTENSION); },
    verify: async extension => {
      verifies += 1;
      assert.equal(extension.id, 'life-steal');
      if (verifies === 1) throw Error('自带测试不合格：编造了未声明的目标 zombie-1');
    },
  });
  assert.equal(good.attempts, 2);
  assert.deepEqual(prompts.map(item => item.attempt), [1, 2]);
  assert.equal(verifies, 2);
  assert.deepEqual(good.errors, ['自带测试不合格：编造了未声明的目标 zombie-1']);
  assert.match(prompts[1].prompt, /上一次的提议被宿主拒绝：自带测试不合格/);
});

test('扩展不能发明新效果：非宿主原子效果被拒绝', () => {
  const extension = validateExtension(EXTENSION);
  const world = { objects: [{ id: 'door-one', position: { x: 0, y: 6, z: 0 }, visible: true, solid: true, health: 40 }] };
  const ok = validateExtensionResult({ state: {}, effects: [{ type: 'target.damage', id: 'door-one', amount: 1 }] }, extension, world);
  assert.equal(ok.effects.length, 1);
  assert.throws(() => validateExtensionResult({ state: {}, effects: [{ type: 'world.teleport', id: 'door-one' }] }, extension, world), /不支持的玩法命令/);
  assert.throws(() => validateExtensionResult({ state: {}, effects: [{ type: 'target.damage', id: 'pad-one', amount: 1 }] }, extension, world), /未授权/);
  assert.throws(() => validateExtensionResult({ state: {}, effects: [], extra: 1 }, extension, world), /不支持的字段/);
});

test('已装载扩展参与草稿编译：声明 ext: 依赖的模块能改，卸载后显式失败', () => {
  const store = new ProjectStore(fs.mkdtempSync(path.join(ROOT, 'project-')));
  const build = store.build(behaviorScene());
  store.change(d => { d.current = build.id; d.history.push({ id: build.id, summary: '源码玩法', time: Date.now() }); d.extensions = [validateExtension(EXTENSION)]; });
  const base = store.data.current;
  const taskId = '44444444-5555-6666-7777-888888888888';
  store.change(d => { d.tasks.push({ id: taskId, base, status: 'running', prompt: '让滑门用吸血扩展', attempts: [], logs: [] }); });
  const workspace = new TaskWorkspace(store, { id: taskId, base, selected: null });
  const read = workspace.readResource({ kind: 'behavior', id: 'sliding-door' });
  const value = JSON.parse(read.text);
  // 只有 craftmine.behavior/2 与 /3 允许声明 requires；/1 是旧格式，不能引用扩展。
  value.format = 'craftmine.behavior/2';
  value.requires = ['ext:life-steal@1'];
  value.binding = null;
  value.permissions = [...value.permissions, 'targets.write'];
  const patched = workspace.patch({ workspaceRevision: read.workspaceRevision, operations: [{ kind: 'behavior', id: 'sliding-door', expectedHash: read.hash, value }] }, 'call-ext-1');
  assert.deepEqual(patched.changed, ['behavior:sliding-door']);
  assert.deepEqual(workspace.scene().behaviors.find(b => b.id === 'sliding-door').requires, ['ext:life-steal@1']);

  // 卸载扩展后再提交同样的改动必须显式失败，而不是静默失效。
  store.change(d => { d.extensions = []; });
  const again = workspace.readResource({ kind: 'behavior', id: 'sliding-door' });
  const next = JSON.parse(again.text);
  next.name = '交互滑门（改名）';
  assert.throws(() => workspace.patch({ workspaceRevision: again.workspaceRevision, operations: [{ kind: 'behavior', id: 'sliding-door', expectedHash: again.hash, value: next }] }, 'call-ext-2'), /扩展没有装载/);
});

test('扩展目录带着命令字段一起给模型看，模型才知道怎么调用', () => {
  const [entry] = extensionCatalog([validateExtension(EXTENSION)]);
  assert.equal(entry.id, 'life-steal');
  assert.equal(entry.commands[0].type, 'life.steal');
  assert.deepEqual(entry.commands[0].fields, ['targetId：目标 ID', 'amount：吸血量 1..50']);
  assert.match(JSON.stringify(entry), /targets\.write/);
  assert.deepEqual(doorBehavior().targets, ['door-one'], '夹具没有被改动');
});
