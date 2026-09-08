import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ProjectStore } from '../app/store.mjs';
import { floraScene } from './scene-fixtures.mjs';
import { TOOL_NAMES } from '../app/harness/contracts.mjs';
import { TaskWorkspace } from '../app/harness/workspace.mjs';
import { DomainTools } from '../app/harness/tools.mjs';

const TASK = '11111111-2222-3333-4444-555555555555';
fs.mkdirSync('test-results/harness', { recursive: true });

function fixture({ verify } = {}) {
  const store = new ProjectStore(fs.mkdtempSync(path.resolve('test-results/harness/tools-')));
  const build = store.build(floraScene());
  store.change(d => { d.current = build.id; d.history.push({ id: build.id, summary: '花与草', time: Date.now() }); });
  const base = store.data.current;
  store.change(d => { d.tasks.push({ id: TASK, base, status: 'running', prompt: '开门要消耗一块木头', attempts: [], logs: [] }); });
  const workspace = new TaskWorkspace(store, { id: TASK, base, selected: null });
  return { store, base, workspace, tools: new DomainTools(workspace, { build: async () => ({ id: base, hash: 'sha256:build', passed: true }), verify }) };
}

test('工具清单包含全部领域工具，未授权的工具调用会被拒绝', async () => {
  const { tools } = fixture();
  for (const name of ['memory.search', 'memory.remember', 'task.plan', 'task.step', 'task.finish', 'evidence.read', 'verify.run']) {
    assert.ok(TOOL_NAMES.includes(name), name);
  }
  await assert.rejects(() => tools.execute('shell.exec', {}), /未授权工具/);
  await assert.rejects(() => tools.execute('memory.search', { extra: 1 }), /字段/);
});

test('任务计划与步骤状态：结束前每一步都必须 done 或 dropped', async () => {
  const { tools } = fixture();
  const planned = await tools.execute('task.plan', { steps: ['读门与背包', '改源码', '验证扣料'] });
  assert.equal(planned.plan.length, 3);
  assert.deepEqual(planned.plan.map(step => step.status), ['todo', 'todo', 'todo']);
  await tools.execute('task.step', { id: 'step-1', status: 'done' });
  const open = await tools.execute('task.step', { id: 'step-2', status: 'doing' });
  assert.equal(open.plan[1].status, 'doing');
  await assert.rejects(() => tools.execute('task.finish', { summary: '做完了', noChangeReason: '无', evidenceRefs: ['evidence:x'] }), /还有 2 步没有结束/);
  await tools.execute('task.step', { id: 'step-2', status: 'done' });
  await tools.execute('task.step', { id: 'step-3', status: 'dropped', note: '用户改主意' });
  await assert.rejects(() => tools.execute('task.finish', { summary: '做完了', noChangeReason: '无', evidenceRefs: ['evidence:missing'] }), /证据不存在/);
  await assert.rejects(() => tools.execute('task.step', { id: 'step-9', status: 'done' }), /没有这一步/);
});

test('候选构建自动成为证据，任务凭证据和候选引用才能提交回执', async () => {
  const { tools } = fixture();
  const built = await tools.execute('candidate.build', {});
  assert.match(built.evidenceRef, /^evidence:/);
  await tools.execute('task.plan', { steps: ['改门'] });
  await tools.execute('task.step', { id: 'step-1', status: 'done' });
  const read = await tools.execute('evidence.read', { ref: built.evidenceRef });
  assert.match(read.text, /sha256:build/);
  assert.equal(read.next, null);
  const receipt = await tools.execute('task.finish', { summary: '门改成消耗一块木头', candidateRef: 'candidate:1', evidenceRefs: [built.evidenceRef] });
  assert.equal(receipt.format, 'craftmine.task-receipt/1');
  assert.equal(receipt.candidateRef, 'candidate:1');
  await assert.rejects(() => tools.execute('task.plan', { steps: ['再来一次'] }), /已经提交完成回执/);
});

test('玩法验收必须由宿主注入；没有执行器就明确返回不可用，不会假装跑过', async () => {
  const without = fixture();
  await assert.rejects(() => without.tools.execute('verify.run', {}), /不能假装跑过/);
  const withVerify = fixture({ verify: async ({ requirement }) => ({ passed: true, summary: `验收通过：${requirement}` }) });
  const report = await withVerify.tools.execute('verify.run', { requirement: '开门消耗木头' });
  assert.equal(report.passed, true);
  assert.match(report.evidenceRef, /^evidence:/);
  const read = await withVerify.tools.execute('evidence.read', { ref: report.evidenceRef, limit: 20 });
  assert.equal(read.totalChars > 20, true);
  assert.equal(typeof read.next, 'number', '分段读取必须给出 next');
});

test('记忆：没有来源或含凭据会被拒绝；同 ID 改写必须声明替代；检索能命中', async () => {
  const { tools } = fixture();
  const record = {
    id: 'rule:door-costs-wood', kind: 'project-rule', scope: { projectId: 'project:home' },
    claim: '开门要消耗一块木头', status: 'validated', sourceRefs: ['user:2026-09-09'], tags: ['门'],
  };
  const saved = await tools.execute('memory.remember', { record });
  assert.equal(saved.id, 'rule:door-costs-wood');
  await assert.rejects(() => tools.execute('memory.remember', { record: { ...record, sourceRefs: [] } }), /来源/);
  await assert.rejects(() => tools.execute('memory.remember', { record: { ...record, claim: 'api key 是 x' } }), /凭据/);
  await assert.rejects(() => tools.execute('memory.remember', { record: { ...record, claim: '改成两块木头' } }), /同 ID 记忆已存在/);
  const superseded = await tools.execute('memory.remember', { record: { ...record, id: 'rule:door-costs-two', claim: '改成两块木头', supersedes: ['rule:door-costs-wood'] } });
  assert.equal(superseded.superseded, 'rule:door-costs-wood');
  const found = await tools.execute('memory.search', { text: '木头', projectId: 'project:home' });
  assert.deepEqual(found.records.map(item => item.id), ['rule:door-costs-two'], '被替代的旧规则不再参与检索');
  assert.match(found.records[0].reasons.join('；'), /命中关键词|用户明确约定/);
  const none = await tools.execute('memory.search', { text: '彩虹钢琴' });
  assert.equal(none.total, 0);
});
