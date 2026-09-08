import test from 'node:test';
import assert from 'node:assert/strict';
import { compactionPlan, compactionTransaction, machineCheckpoint, reconcileCompaction, validateCheckpoint } from '../app/harness/checkpoint.mjs';

const checkpoint = (overrides = {}) => machineCheckpoint({
  taskId: 'task:door', intentRevision: 2, baseBuild: 'build:base', draftHead: 'draft:7',
  acceptanceRef: 'acceptance:2', budgetRef: 'budget:task-door', journalThrough: 10,
  completedSteps: [{ id: 'step:3', evidenceRef: 'evidence:3' }], pendingSteps: ['验证重启恢复'],
  openToolCalls: [], candidateRef: null, artifactRefs: ['artifact:door-source'], ...overrides,
});
const events = n => Array.from({ length: n }, (_, index) => ({ sequence: index + 1, type: 'tool', detail: `e${index + 1}` }));

test('检查点只装机器事实：缺一项就不许创建', () => {
  const record = checkpoint();
  assert.equal(record.format, 'craftmine.checkpoint/1');
  assert.equal(validateCheckpoint(record), record);
  assert.throws(() => machineCheckpoint({ ...checkpoint(), taskId: '' }), /taskId/);
  assert.throws(() => machineCheckpoint({ ...checkpoint(), draftHead: undefined }), /draftHead/);
  assert.throws(() => machineCheckpoint({ ...checkpoint(), journalThrough: -1 }), /journalThrough/);
  assert.throws(() => validateCheckpoint({ format: 'craftmine.checkpoint/1', journalThrough: 1 }), /缺少机器事实/);
});

test('压缩计划把旧事件转成解释、保留最近完整步骤，并列出必须保留的引用', () => {
  const plan = compactionPlan({ checkpoint: checkpoint(), events: events(12), keepRecent: 3 });
  assert.equal(plan.through, 10);
  assert.deepEqual(plan.keep, [8, 9, 10]);
  assert.deepEqual(plan.summarize, [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(plan.after, [11, 12]);
  assert.ok(plan.mustKeepRefs.includes('build:base'));
  assert.ok(plan.mustKeepRefs.includes('artifact:door-source'));
});

test('压缩事务：摘要缺引用或被打断就拒绝替换，保留旧检查点', () => {
  const plan = compactionPlan({ checkpoint: checkpoint(), events: events(12), keepRecent: 3 });
  const missing = compactionTransaction({ checkpoint: checkpoint(), plan, summary: { text: '整理了一下旧对话' } });
  assert.equal(missing.committed, false);
  assert.match(missing.error, /摘要缺少关键引用/);
  assert.equal(missing.checkpoint.journalThrough, 10, '失败时检查点不动');
  assert.equal(missing.journal.filter(entry => entry.type === 'compaction.failed').length, 1);

  const truncated = compactionTransaction({ checkpoint: checkpoint(), plan, summary: { text: 'build:base draft:7 acceptance:2 budget:task-door artifact:door-source', truncated: true } });
  assert.equal(truncated.committed, false);
  assert.match(truncated.error, /截断/);

  const text = '目标：开门消耗木头。build:base draft:7 acceptance:2 budget:task-door artifact:door-source';
  const done = compactionTransaction({ checkpoint: checkpoint(), plan, summary: { text, hash: 'sha256:summary', narrativeRef: 'summary:2' } });
  assert.equal(done.committed, true);
  assert.equal(done.checkpoint.journalThrough, 10);
  assert.equal(done.checkpoint.narrativeRef, 'summary:2');
  assert.equal(done.manifest.coversThrough, 10);
  assert.deepEqual(done.manifest.dropped, [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(done.journal.map(entry => entry.type), ['compaction.started', 'compaction.completed']);
});

test('重启后核对：未闭合的压缩不算成功，以磁盘上的 manifest 为准', () => {
  const plan = compactionPlan({ checkpoint: checkpoint(), events: events(12), keepRecent: 3 });
  const done = compactionTransaction({ checkpoint: checkpoint(), plan, summary: { text: 'build:base draft:7 acceptance:2 budget:task-door artifact:door-source' } });
  assert.equal(reconcileCompaction({ journal: done.journal }).open, false);
  const crashed = { journal: [{ type: 'compaction.started', id: 'compact:task:door:10', at: 1 }] };
  const report = reconcileCompaction(crashed);
  assert.equal(report.open, true);
  assert.match(report.detail, /未闭合/);
});
