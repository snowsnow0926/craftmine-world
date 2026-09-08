import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ProjectStore } from '../app/store.mjs';
import { floraScene } from './scene-fixtures.mjs';
import { TaskWorkspace } from '../app/harness/workspace.mjs';
import { DomainTools } from '../app/harness/tools.mjs';
import { HarnessLoop } from '../app/harness/orchestrator.mjs';

// 压缩后恢复：只信机器检查点，检查点与草稿对不上就显式拒绝。
const TASK = '22222222-3333-4444-5555-666666666666';
const ROOT = path.resolve('test-results/harness-resume');
fs.mkdirSync(ROOT, { recursive: true });

function fixture() {
  const store = new ProjectStore(fs.mkdtempSync(path.join(ROOT, 'project-')));
  const build = store.build(floraScene());
  store.change(d => { d.current = build.id; d.history.push({ id: build.id, summary: '花与草', time: Date.now() }); });
  const base = store.data.current;
  store.change(d => { d.tasks.push({ id: TASK, base, status: 'running', prompt: '把花挪到 x=4', attempts: [], logs: [] }); });
  const workspace = new TaskWorkspace(store, { id: TASK, base, selected: null });
  const tools = new DomainTools(workspace, {
    build: () => {
      const draft = store.build(workspace.scene());
      workspace.validated(draft, { passed: true, checks: ['草稿编译通过'] });
      return draft;
    },
  });
  return { store, base, workspace, tools };
}

const action = value => JSON.stringify({ kind: value.kind ?? 'tool', tool: value.tool ?? null, argumentsJSON: JSON.stringify(value.args ?? {}), summary: value.summary ?? '测试动作' });
const moveScript = x => [
  action({ tool: 'resource.read', args: { kind: 'object', id: 'flower-one' }, summary: '读取目标花' }),
  state => {
    const read = state.lastResult, value = JSON.parse(read.text);
    value.position.x = x;
    return action({ tool: 'workspace.patch', args: { workspaceRevision: read.workspaceRevision, operations: [{ kind: 'object', id: value.id, expectedHash: read.hash, value }] }, summary: `挪到 x=${x}` });
  },
  action({ tool: 'candidate.build', args: {}, summary: '构建候选' }),
  action({ kind: 'finish', summary: '改好了' }),
];
const runLoop = (ctx, script, options = {}) => {
  let index = 0;
  return new HarnessLoop({
    workspace: ctx.workspace, tools: ctx.tools, requirement: '把 flower-one 挪到 x=4', ...options,
    decide: async state => {
      const next = script[index];
      index += 1;
      assert.ok(next, `脚本缺少第 ${index} 步`);
      return typeof next === 'function' ? next(state) : next;
    },
  });
};

test('压缩后恢复：接上机器检查点，步号继续，且可以立刻结束', async () => {
  const ctx = fixture();
  const first = await runLoop(ctx, moveScript(4)).run();
  assert.equal(first.status, 'finished');
  assert.equal(first.checkpoint.candidateRef, first.build.id);
  assert.equal(first.checkpoint.journalThrough, 4);

  // 恢复时不再重放任何原始结果：轨迹清空，只把「已完成哪几步」交给模型。
  const resumed = runLoop(ctx, [action({ kind: 'finish', summary: '压缩后确认完成' })], {
    checkpoint: first.checkpoint, resumeTrace: first.steps.map(step => ({ step: step.step, tool: step.tool, status: step.status, message: step.message })),
  });
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.round, 4);
  assert.deepEqual(resumed.steps.map(step => step.step), [1, 2, 3, 4]);
  assert.ok(resumed.steps.every(step => step.resumed === true));
  const state = resumed.state(5);
  assert.equal(state.step, 5);
  assert.equal(state.trace.length, 4);
  assert.ok(state.trace.every(entry => entry.result === undefined), '压缩后的轨迹不能再带原始结果');
  assert.equal(state.lastResult, null);
  assert.equal(state.built.id, first.build.id, '候选引用来自检查点，不需要重新构建');

  const second = await resumed.run();
  assert.equal(second.status, 'finished');
  assert.equal(second.resumed, true);
  assert.equal(second.steps.length, 5);
  assert.equal(second.steps.at(-1).status, 'finish');
  assert.equal(second.draftRevision, first.draftRevision, '恢复过程不改草稿');
  assert.equal(second.checkpoint.candidateRef, first.build.id);
});

test('恢复会拒绝与当前草稿对不上的检查点，不做「大概是对的」猜测', async () => {
  const ctx = fixture();
  const first = await runLoop(ctx, moveScript(4)).run();
  // 草稿在压缩之后又被改过：检查点里的 draftHead 已经不是当前草稿。
  const read = ctx.workspace.readResource({ kind: 'object', id: 'flower-one' });
  const value = JSON.parse(read.text);
  value.position.x = 5;
  ctx.workspace.patch({ workspaceRevision: read.workspaceRevision, operations: [{ kind: 'object', id: value.id, expectedHash: read.hash, value }] }, 'call-resume-1');
  assert.throws(() => runLoop(ctx, [], { checkpoint: first.checkpoint }), /草稿版本与当前草稿不一致/);

  const other = { ...first.checkpoint, taskId: '33333333-4444-5555-6666-777777777777' };
  assert.throws(() => runLoop(ctx, [], { checkpoint: other }), /属于另一个任务/);
  const broken = { ...first.checkpoint, acceptanceRef: null };
  assert.throws(() => runLoop(ctx, [], { checkpoint: broken }), /机器事实/);
});
