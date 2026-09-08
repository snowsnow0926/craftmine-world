import test from 'node:test';
import assert from 'node:assert/strict';
import { isActive, markStale, memoryRecord, retrieve, retire, supersede } from '../app/harness/memory-records.mjs';

const rule = (overrides = {}) => ({
  id: 'rule:door-costs-wood', kind: 'project-rule', scope: { projectId: 'project:home' },
  claim: '开门要消耗一块木头，材料不足时门保持关闭', status: 'validated',
  sourceRefs: ['user:2026-09-09', 'task:t-1'], tags: ['门', '木头'], ...overrides,
});

test('记忆记录必须带来源、范围和状态，凭据与无来源的猜测进不了库', () => {
  const record = memoryRecord(rule());
  assert.equal(record.format, 'craftmine.memory/1');
  assert.deepEqual(record.scope, { projectId: 'project:home' });
  assert.equal(record.status, 'validated');
  assert.throws(() => memoryRecord(rule({ sourceRefs: [] })), /至少有一个来源引用/);
  assert.throws(() => memoryRecord(rule({ status: 'validated', sourceRefs: ['guess:随便想的'] })), /只有真实任务/);
  assert.throws(() => memoryRecord(rule({ claim: '把 api key 写进这里' })), /凭据不能写进记忆/);
  assert.throws(() => memoryRecord(rule({ id: 'door' })), /记忆 ID 无效/);
  assert.throws(() => memoryRecord(rule({ kind: '感觉' })), /记忆类型无效/);
  assert.throws(() => memoryRecord(rule({ extra: 1 })), /不支持的字段/);
  assert.equal(memoryRecord(rule({ status: 'proposed' })).status, 'proposed');
});

test('新规则替代旧规则：旧的立刻停止参与检索，但记录本身保留', () => {
  const previous = memoryRecord(rule());
  const { next, previous: old } = supersede(previous, {
    id: 'rule:door-costs-two-wood', kind: 'project-rule', scope: { projectId: 'project:home' },
    claim: '开门改成消耗两块木头', status: 'validated', sourceRefs: ['user:2026-09-09'],
  });
  assert.deepEqual(next.supersedes, ['rule:door-costs-wood']);
  assert.equal(old.supersededBy, 'rule:door-costs-two-wood');
  assert.equal(isActive(old), false);
  assert.equal(isActive(next), true);
  const found = retrieve([old, next], { text: '木头 门', projectId: 'project:home' });
  assert.deepEqual(found.map(entry => entry.id), ['rule:door-costs-two-wood']);
});

test('源码或运行器变了，旧经验标成需要重新验证，而不是继续算通过', () => {
  const experience = memoryRecord({
    id: 'experience:chop-damage', kind: 'verified-experience', scope: { projectId: 'project:home', moduleId: 'module:tree' },
    claim: '采集完成要看实际生命值，不能按攻击次数', status: 'validated',
    sourceRefs: ['evidence:run-3'], appliesTo: { sourceHashes: ['sha256:old'], runtimeRange: 'craftmine-web/5' },
  });
  assert.equal(markStale(experience, { sourceHashes: ['sha256:old'] }), experience, '源码没变就不动');
  assert.equal(markStale(experience, { sourceHashes: ['sha256:new'] }).status, 'needs_revalidation');
  assert.equal(markStale(experience, { runtimeVersion: 'craftmine-web/6' }).status, 'needs_revalidation');
  const retired = retire(experience, { reason: '用户改成按伤害判定' });
  assert.equal(retired.status, 'retired');
  assert.equal(isActive(retired), false);
  assert.throws(() => retire(experience, {}), /必须写明原因/);
});

test('检索按关键词、类型和作用域过滤，并说明命中原因', () => {
  const records = [
    memoryRecord(rule()),
    memoryRecord({ id: 'experience:flower-look', kind: 'verified-experience', scope: { projectId: 'project:home' }, claim: '花要有细茎和薄花瓣', status: 'validated', sourceRefs: ['user:2026-09-09'], tags: ['花'] }),
    memoryRecord({ id: 'rule:other-project', kind: 'project-rule', scope: { projectId: 'project:other' }, claim: '开门要消耗一块木头', status: 'validated', sourceRefs: ['user:2026-09-09'] }),
  ];
  const wood = retrieve(records, { text: '木头', projectId: 'project:home' });
  assert.deepEqual(wood.map(entry => entry.id), ['rule:door-costs-wood'], '跨项目的约定不能被检索到');
  assert.match(wood[0].reasons.join('；'), /命中关键词|用户明确约定/);
  assert.equal(retrieve(records, { kind: 'verified-experience', projectId: 'project:home' }).length, 1);
  assert.equal(retrieve(records, { text: '木头', projectId: 'project:home', limit: 1 }).length, 1);
  assert.equal(retrieve(records, { text: '彩虹 钢琴', projectId: 'project:home' }).length, 0);
});
