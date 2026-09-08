import test from 'node:test';
import assert from 'node:assert/strict';
import { allocate, budgetText, contextBudget, estimateTokens, measure } from '../app/harness/context-budget.mjs';

test('Token 估算区分中英文，并且明确标注是估算', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('中文四个字'), 5);
  assert.ok(estimateTokens('中文abc') > estimateTokens('abcdef'));
  assert.equal(measure({ budget: contextBudget({ window: 100000 }), segments: [{ id: 'a', text: 'abcd' }] }).source, 'estimated');
  const reported = measure({ budget: contextBudget({ window: 100000 }), segments: [{ id: 'a', text: 'abcd' }], reported: 42 });
  assert.equal(reported.source, 'reported');
  assert.equal(reported.reported, 42);
});

test('预算公式：预留输出、工具和误差之后才是可用输入', () => {
  const budget = contextBudget({ window: 128000, reserveOutput: 6000, reserveTools: 6000, reserveSlack: 4000 });
  assert.equal(budget.available, 112000);
  assert.equal(budget.softAt, 78400);
  assert.equal(budget.compactAt, 100800);
  assert.equal(budget.targetAt, 56000);
  const capped = contextBudget({ window: 1000000, cap: 48000 });
  assert.equal(capped.available, 48000);
  assert.equal(capped.capped, true);
  assert.throws(() => contextBudget({ window: 1000, reserveOutput: 900, reserveTools: 900, reserveSlack: 900 }), /没有可用输入空间/);
  assert.throws(() => contextBudget({ window: 0 }), /窗口必须是正数/);
});

test('分配：必保留内容优先；必保留都装不下时必须分块，不能硬塞', () => {
  const budget = contextBudget({ window: 40000, reserveOutput: 0, reserveTools: 0, reserveSlack: 0 });
  assert.equal(budget.available, 40000);
  const ok = allocate({ budget, segments: [
    { id: 'rules', share: 'rules', tokens: 4000, mandatory: true },
    { id: 'scene', share: 'scene', tokens: 5000 },
    { id: 'history', share: 'history', tokens: 5000 },
  ] });
  assert.equal(ok.withinBudget, true);
  assert.equal(ok.action, 'none');
  assert.deepEqual(ok.dropped, []);
  assert.equal(ok.allowances.reduce((total, entry) => total + entry.allowed, 0), 14000);

  const tight = allocate({ budget, segments: [
    { id: 'rules', share: 'rules', tokens: 4000, mandatory: true },
    { id: 'history', share: 'history', tokens: 30000 },
  ] });
  assert.equal(tight.withinBudget, false);
  assert.deepEqual(tight.truncated, ['history']);
  assert.equal(tight.action, 'dedupe');

  const tooBig = allocate({ budget, segments: [{ id: 'scene', share: 'scene', tokens: 50000, mandatory: true }] });
  assert.equal(tooBig.action, 'split');
  assert.match(tooBig.detail, /必须分块或外置/);
});

test('阈值决定动作：软阈值去重，压缩阈值压缩，并用后端回报校准估算', () => {
  const budget = contextBudget({ window: 100000, reserveOutput: 0, reserveTools: 0, reserveSlack: 0 });
  assert.equal(budget.available, 100000);
  assert.equal(measure({ budget, segments: [{ id: 'a', tokens: 10000 }] }).action, 'none');
  assert.equal(measure({ budget, segments: [{ id: 'a', tokens: 75000 }] }).action, 'dedupe');
  assert.equal(measure({ budget, segments: [{ id: 'a', tokens: 95000 }] }).action, 'compact');
  const calibrated = measure({ budget, segments: [{ id: 'a', text: '很小' }], reported: 99000 });
  assert.equal(calibrated.action, 'compact', '后端回报的数字优先于估算');
  assert.match(budgetText(calibrated), /后端回报 99000/);
});
