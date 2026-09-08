import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ProjectStore } from '../app/store.mjs';
import { floraScene, flower } from './scene-fixtures.mjs';
import { HARNESS_LIMITS, TOOL_NAMES, contentHash, fields, parseAction, requireValue } from '../app/harness/contracts.mjs';
import { BEHAVIOR_LIMITS } from '../app/behavior-contracts.mjs';
import { TaskWorkspace } from '../app/harness/workspace.mjs';
import { DomainTools } from '../app/harness/tools.mjs';

const TASK = '11111111-2222-3333-4444-555555555555';
fs.mkdirSync('test-results/harness', { recursive: true });

function fixture({ selected = null, status = 'running' } = {}) {
  const store = new ProjectStore(fs.mkdtempSync(path.resolve('test-results/harness/project-')));
  const build = store.build(floraScene());
  store.change(d => { d.current = build.id; d.history.push({ id: build.id, summary: '花与草', time: Date.now() }); });
  const base = store.data.current;
  store.change(d => { d.tasks.push({ id: TASK, base, status, prompt: '开门要消耗一块木头', attempts: [], logs: [] }); });
  return { store, base, workspace: new TaskWorkspace(store, { id: TASK, base, selected }) };
}
const readObject = (workspace, id) => workspace.readResource({ kind: 'object', id });
const replace = (workspace, read, mutate) => {
  const value = JSON.parse(read.text);
  mutate(value);
  return { workspaceRevision: read.workspaceRevision, operations: [{ kind: 'object', id: value.id, expectedHash: read.hash, value }] };
};
const action = (value) => JSON.stringify({ kind: 'tool', tool: value.tool ?? null, argumentsJSON: JSON.stringify(value.args ?? {}), summary: value.summary ?? '测试动作' });

test('新增对象和玩法在同一事务编译，丢失回执后重放不会重复新增', () => {
  const { store, base, workspace } = fixture();
  const behavior = {
    format: 'craftmine.behavior/2', id: 'new-behavior', name: '花的动作', description: '生成的新玩法',
    code: 'export function step({state}) { return {state,commands:[]}; }',
    stateVersion: 1, initialState: {}, params: {}, targets: ['new-flower'],
    permissions: ['objects.write'], requires: [], binding: null, keys: [],
  };
  const request = { workspaceRevision: 0, operations: [
    { op: 'add', kind: 'object', id: 'new-flower', expectedHash: null, value: flower('new-flower', 5, 15) },
    { op: 'add', kind: 'behavior', id: behavior.id, expectedHash: null, value: behavior },
  ] };
  const result = workspace.patch(request, 'create-once');
  assert.equal(result.workspaceRevision, 1);
  assert.equal(workspace.scene().behaviors[0].id, behavior.id);
  assert.equal(store.data.current, base);
  const restored = new TaskWorkspace(store, { id: TASK, base });
  assert.deepEqual(restored.patch(request, 'create-once'), result);
  assert.equal(restored.scene().objects.filter(o => o.id === 'new-flower').length, 1);
  assert.throws(() => restored.patch({ ...request, workspaceRevision: 1 }, 'duplicate'), /已经存在/);
});

test('新增必须声明空哈希，失败批次不残留对象，选中对象任务不能新增其他对象', () => {
  const { workspace } = fixture();
  const op = { op: 'add', kind: 'object', id: 'new-flower', expectedHash: null, value: flower('new-flower', 5, 15) };
  assert.throws(() => workspace.patch({ workspaceRevision: 0, operations: [{ ...op, expectedHash: 'invented' }] }, 'bad-hash'), /必须为 null/);
  const invalid = { ...op, id: 'other', value: { ...op.value, id: 'other', parts: [] } };
  assert.throws(() => workspace.patch({ workspaceRevision: 0, operations: [op, invalid] }, 'atomic-failure'), /几何部分/);
  assert.equal(workspace.readManifest().revision, 0);
  assert.equal(workspace.scene().objects.length, 5);
  const scoped = fixture({ selected: 'flower-one' }).workspace;
  assert.throws(() => scoped.patch({ workspaceRevision: 0, operations: [op] }, 'scope-failure'), /范围/);
});

test('草稿建立不可变版本，读取记录来源哈希，重启后仍能恢复', () => {
  const { store, base, workspace } = fixture();
  const manifest = workspace.readManifest();
  assert.equal(manifest.revision, 0);
  assert.match(manifest.head, /^0-[a-f0-9]{64}\.json$/);
  const read = readObject(workspace, 'flower-one');
  const value = floraScene().objects[0];
  assert.equal(read.hash, contentHash(value));
  assert.match(read.text, /"flower-one"/);
  assert.equal(read.next, null);
  assert.equal(read.workspaceRevision, 0);
  const resumed = new TaskWorkspace(store, { id: TASK, base, selected: null });
  assert.equal(resumed.readManifest().revision, 0);
  assert.equal(resumed.readManifest().reads['object:flower-one'], read.hash);
});

test('未读取或哈希不匹配的补丁被拒绝，必须先读取当前资源', () => {
  const { workspace } = fixture();
  const value = floraScene().objects[0];
  assert.throws(() => workspace.patch({ workspaceRevision: 0, operations: [{ kind: 'object', id: 'flower-one', expectedHash: contentHash(value), value }] }, 'call-x'), /先读取/);
  const read = readObject(workspace, 'flower-one');
  const stale = replace(workspace, read, v => { v.position.x = 2; });
  stale.operations[0].expectedHash = 'deadbeef';
  assert.throws(() => workspace.patch(stale, 'call-y'), /先读取/);
});

test('补丁原子替换资源并推进草稿版本，重放同一调用返回相同结果', () => {
  const { workspace } = fixture();
  const read = readObject(workspace, 'flower-one');
  const request = replace(workspace, read, v => { v.position.x = 4; });
  const result = workspace.patch(request, 'call-1');
  assert.equal(result.workspaceRevision, 1);
  assert.deepEqual(result.changed, ['object:flower-one']);
  assert.equal(workspace.scene().objects.find(o => o.id === 'flower-one').position.x, 4);
  assert.equal(workspace.readManifest().revision, 1);
  assert.deepEqual(workspace.patch(request, 'call-1'), result);
  const other = replace(workspace, readObject(workspace, 'flower-one'), v => { v.position.x = 5; });
  assert.throws(() => workspace.patch(other, 'call-1'), /不同操作/);
});

test('过期草稿版本和重复修改同一资源被拒绝', () => {
  const { workspace } = fixture();
  const read = readObject(workspace, 'flower-one');
  workspace.patch(replace(workspace, read, v => { v.position.x = 4; }), 'call-1');
  const again = replace(workspace, readObject(workspace, 'flower-one'), v => { v.position.x = 5; });
  again.workspaceRevision = 0;
  assert.throws(() => workspace.patch(again, 'call-2'), /草稿已改变/);
  const dup = replace(workspace, readObject(workspace, 'flower-one'), v => { v.position.x = 6; });
  dup.operations.push({ ...dup.operations[0] });
  assert.throws(() => workspace.patch(dup, 'call-3'), /重复/);
});

test('补丁必须保留资源身份，也不能越出选中对象的范围', () => {
  const { workspace } = fixture({ selected: 'flower-one' });
  const read = readObject(workspace, 'flower-one');
  const renamed = JSON.parse(read.text);
  renamed.id = 'flower-renamed';
  renamed.position.x = 4;
  assert.throws(() => workspace.patch({ workspaceRevision: 0, operations: [{ kind: 'object', id: 'flower-one', expectedHash: read.hash, value: renamed }] }, 'call-1'), /身份/);
  const otherRead = readObject(workspace, 'flower-two');
  assert.throws(() => workspace.patch(replace(workspace, otherRead, v => { v.position.x = 4; }), 'call-2'), /超出/);
  assert.doesNotThrow(() => workspace.patch(replace(workspace, readObject(workspace, 'flower-one'), v => { v.position.x = 4; }), 'call-3'));
});

test('任务停止后不能提交迟到操作，冲突时草稿保持原样', () => {
  const { store, workspace } = fixture();
  const read = readObject(workspace, 'flower-one');
  const before = contentHash(workspace.scene());
  store.change(d => { d.tasks[0].status = 'failed'; });
  assert.throws(() => workspace.patch(replace(workspace, read, v => { v.position.x = 4; }), 'call-1'), /任务已经停止/);
  assert.equal(workspace.readManifest().revision, 0);
  assert.equal(contentHash(workspace.scene()), before);
});

test('验证结果必须对应当前草稿，未通过检查不能被记录为通过', () => {
  const { store, workspace } = fixture();
  const read = readObject(workspace, 'flower-one');
  workspace.patch(replace(workspace, read, v => { v.position.x = 4; }), 'call-1');
  const draftBuild = store.build(workspace.scene());
  assert.throws(() => workspace.validated(store.readBuild(store.data.current), { passed: true }), /不是当前草稿/);
  assert.throws(() => workspace.validated(draftBuild, { passed: false }), /未通过/);
  const recorded = workspace.validated(draftBuild, { passed: true, checks: ['语法检查通过'] });
  assert.equal(recorded.revision, 1);
  assert.equal(workspace.readManifest().validation.report.checks[0], '语法检查通过');
  workspace.patch(replace(workspace, readObject(workspace, 'flower-one'), v => { v.position.x = 5; }), 'call-2');
  assert.equal(workspace.readManifest().validation, null);
});

test('领域工具只读取当前草稿，未授权工具和越界参数被网关拒绝', async () => {
  const { workspace, base } = fixture();
  const tools = new DomainTools(workspace);
  const project = await tools.execute('project.inspect', {});
  assert.equal(project.base, base);
  assert.equal(project.resources.length, 5);
  const page = await tools.execute('world.query', { kind: 'object', limit: 2 });
  assert.equal(page.total, 5);
  assert.equal(page.resources.length, 2);
  assert.equal(page.next, 2);
  assert.equal((await tools.execute('world.query', { kind: 'object', offset: 2, limit: 2 })).next, 4);
  const capabilities = await tools.execute('capabilities.read', {});
  assert.ok(capabilities.permissions.includes('objects.write'));
  assert.equal(capabilities.limits.commands, BEHAVIOR_LIMITS.commands);
  assert.equal(capabilities.limits.commands, 32);
  await assert.rejects(() => tools.execute('shell.run', {}), /未授权工具/);
  await assert.rejects(() => tools.execute('world.query', { kind: 'asset' }), /资源类型无效/);
  await assert.rejects(() => tools.execute('world.query', { kind: 'object', limit: 99 }), /目录数量/);
  await assert.rejects(() => tools.execute('project.inspect', { path: 'C:/' }), /字段/);
  await assert.rejects(() => tools.execute('candidate.build', {}), /没有配置候选验证器/);
});

test('工具调用协议拒绝非法 JSON、未知工具和越界参数', () => {
  assert.deepEqual(TOOL_NAMES.includes('workspace.patch'), true);
  assert.throws(() => parseAction('{'), /有效 JSON/);
  assert.throws(() => parseAction(JSON.stringify({ kind: 'tool', tool: 'shell.run', argumentsJSON: '{}', summary: 'x' })), /未授权或不存在/);
  assert.throws(() => parseAction(JSON.stringify({ kind: 'finish', tool: 'world.query', argumentsJSON: '{}', summary: 'x' })), /未授权或不存在/);
  assert.throws(() => parseAction(JSON.stringify({ kind: 'tool', tool: 'world.query', argumentsJSON: '[]', summary: 'x' })), /必须是对象/);
  assert.throws(() => parseAction(JSON.stringify({ kind: 'tool', tool: 'world.query', argumentsJSON: '{}', summary: '' })), /说明无效/);
  assert.throws(() => parseAction(JSON.stringify({ kind: 'tool', tool: 'world.query', argumentsJSON: '{}', summary: 'x', extra: 1 })), /字段/);
  const parsed = parseAction(action({ tool: 'world.query', args: { kind: 'object', limit: 3 } }));
  assert.equal(parsed.args.limit, 3);
  assert.throws(() => fields({ kind: 'object', id: 'x', extra: 1 }, ['kind', 'id']), /字段/);
  assert.throws(() => requireValue(false, 'INVALID', '拒绝'), /拒绝/);
});
