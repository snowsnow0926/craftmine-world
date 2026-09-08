import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ProjectStore } from '../app/store.mjs';
import { floraScene } from './scene-fixtures.mjs';
import { contentHash } from '../app/harness/contracts.mjs';
import { TaskWorkspace } from '../app/harness/workspace.mjs';
import { DomainTools } from '../app/harness/tools.mjs';
import { HarnessLoop } from '../app/harness/orchestrator.mjs';
import { decideAction, actionPrompt } from '../app/harness/loop-model.mjs';

const TASK = '11111111-2222-3333-4444-555555555555';
const ROOT = path.resolve('test-results/harness-loop');
fs.mkdirSync(ROOT, { recursive: true });

function fixture({ selected = null, status = 'running' } = {}) {
  const store = new ProjectStore(fs.mkdtempSync(path.join(ROOT, 'project-')));
  const build = store.build(floraScene());
  store.change(d => { d.current = build.id; d.history.push({ id: build.id, summary: '花与草', time: Date.now() }); });
  const base = store.data.current;
  store.change(d => { d.tasks.push({ id: TASK, base, status, prompt: '把花挪到 x=4', attempts: [], logs: [] }); });
  const workspace = new TaskWorkspace(store, { id: TASK, base, selected });
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
const runLoop = (ctx, script, options = {}) => new HarnessLoop({
  workspace: ctx.workspace, tools: ctx.tools, requirement: '把 flower-one 挪到 x=4', ...options,
  decide: async state => {
    const next = script[state.step - 1];
    assert.ok(next, `脚本缺少第 ${state.step} 步`);
    return typeof next === 'function' ? next(state) : next;
  },
}).run();

test('分步闭环：查询、读取、局部修改、构建候选后正常结束', async () => {
  const ctx = fixture();
  const script = [
    action({ tool: 'world.query', args: { kind: 'object', limit: 2 }, summary: '先看目录' }),
    action({ tool: 'resource.read', args: { kind: 'object', id: 'flower-one' }, summary: '读取目标花' }),
    state => {
      const read = state.lastResult;
      assert.equal(read.id, 'flower-one');
      assert.match(read.text, /"flower-one"/);
      const value = JSON.parse(read.text);
      value.position.x = 4;
      return action({ tool: 'workspace.patch', args: { workspaceRevision: read.workspaceRevision, operations: [{ kind: 'object', id: value.id, expectedHash: read.hash, value }] }, summary: '把花挪到 x=4' });
    },
    action({ tool: 'candidate.build', args: {}, summary: '构建候选' }),
    action({ kind: 'finish', summary: 'flower-one 已挪到 x=4' }),
  ];
  const result = await runLoop(ctx, script);
  assert.equal(result.format, 'craftmine.harness-loop/1');
  assert.equal(result.status, 'finished');
  assert.equal(result.summary, 'flower-one 已挪到 x=4');
  assert.equal(result.draftRevision, 1);
  assert.equal(result.error, null);
  assert.equal(result.build.objects, floraScene().objects.length);
  assert.deepEqual(result.steps.map(s => s.tool), ['world.query', 'resource.read', 'workspace.patch', 'candidate.build', null]);
  assert.deepEqual(result.steps.map(s => s.status), ['ok', 'ok', 'ok', 'ok', 'finish']);
  assert.ok(result.steps.every(s => Number.isInteger(s.durationMs)));
  const scene = ctx.workspace.scene();
  assert.equal(scene.objects.find(o => o.id === 'flower-one').position.x, 4);
  assert.deepEqual(scene.objects.find(o => o.id === 'flower-two'), floraScene().objects[1], '只改了目标资源');
  assert.deepEqual(scene.objects.find(o => o.id === 'flower-three'), floraScene().objects[2]);
  assert.equal(scene.objects.length, floraScene().objects.length);
  assert.equal(ctx.store.data.candidate, null, '闭环本身不生成候选，交给任务状态机');
});

test('非法动作不崩：坏 JSON 与未知工具回灌后可继续并最终结束', async () => {
  const ctx = fixture();
  const script = [
    '这不是 JSON',
    action({ tool: 'shell.run', args: {}, summary: '越权工具' }),
    action({ tool: 'world.query', args: { kind: 'object', limit: 1 }, summary: '合法读取' }),
    action({ tool: 'candidate.build', args: {}, summary: '构建' }),
    state => {
      assert.ok(state.trace.some(entry => entry.status === 'rejected'));
      assert.equal(state.lastError, null);
      return action({ kind: 'finish', summary: '修正后结束' });
    },
  ];
  const result = await runLoop(ctx, script);
  assert.equal(result.status, 'finished');
  assert.deepEqual(result.steps.map(s => s.status), ['rejected', 'rejected', 'ok', 'ok', 'finish']);
  assert.match(result.steps[0].message, /有效 JSON/);
  assert.match(result.steps[1].message, /未授权或不存在/);
  assert.equal(result.steps[0].code, 'INVALID_ACTION');
  assert.equal(result.steps[1].code, 'UNKNOWN_TOOL');
  assert.equal(result.draftRevision, 0);
});

test('未成功构建候选前不能结束，草稿在构建后又变化时必须重新构建', async () => {
  const ctx = fixture();
  const patch = x => state => {
    const read = state.lastResult;
    const value = JSON.parse(read.text);
    value.position.x = x;
    return action({ tool: 'workspace.patch', args: { workspaceRevision: read.workspaceRevision, operations: [{ kind: 'object', id: value.id, expectedHash: read.hash, value }] }, summary: `挪到 x=${x}` });
  };
  const script = [
    action({ kind: 'finish', summary: '还没构建就结束' }),
    action({ tool: 'resource.read', args: { kind: 'object', id: 'flower-one' }, summary: '读取' }),
    patch(4),
    action({ tool: 'candidate.build', args: {}, summary: '构建' }),
    action({ tool: 'resource.read', args: { kind: 'object', id: 'flower-one' }, summary: '再读一次' }),
    patch(5),
    action({ kind: 'finish', summary: '构建后又改了草稿' }),
    action({ tool: 'candidate.build', args: {}, summary: '重新构建' }),
    action({ kind: 'finish', summary: '确认后结束' }),
  ];
  const result = await runLoop(ctx, script);
  assert.equal(result.status, 'finished');
  assert.equal(result.steps[0].status, 'rejected');
  assert.match(result.steps[0].message, /candidate\.build/);
  assert.equal(result.steps[0].code, 'BUILD_REQUIRED');
  assert.equal(result.steps[6].status, 'rejected');
  assert.match(result.steps[6].message, /重新调用 candidate\.build/);
  assert.equal(result.steps[6].code, 'BUILD_REQUIRED');
  assert.equal(result.draftRevision, 2);
  assert.equal(result.build.id, ctx.store.build(ctx.workspace.scene()).id);
});

test('预算耗尽返回 budget，且不生成候选、草稿保持原样', async () => {
  const ctx = fixture();
  const script = Array.from({ length: 10 }, () => action({ tool: 'world.query', args: { kind: 'object', limit: 1 }, summary: '继续查询' }));
  const bySteps = await runLoop(ctx, script, { steps: 3 });
  assert.equal(bySteps.status, 'budget');
  assert.equal(bySteps.build, null);
  assert.equal(bySteps.steps.length, 3);
  assert.equal(bySteps.draftRevision, 0);
  assert.match(bySteps.error, /步数预算/);
  assert.equal(ctx.store.data.candidate, null);
  assert.equal(ctx.workspace.readManifest().revision, 0);

  const byCalls = await runLoop(ctx, script, { steps: 10, calls: 2 });
  assert.equal(byCalls.status, 'budget');
  assert.equal(byCalls.build, null);
  assert.equal(byCalls.steps.length, 2);
  assert.match(byCalls.error, /工具调用预算/);
  assert.equal(ctx.store.data.candidate, null);
});

test('取消后返回 cancelled，草稿保留且不再执行新动作', async () => {
  const ctx = fixture();
  const controller = new AbortController();
  const script = [
    action({ tool: 'world.query', args: { kind: 'object', limit: 1 }, summary: '先看一眼' }),
    () => { controller.abort(); return action({ tool: 'world.query', args: { kind: 'object', limit: 1 }, summary: '取消前的动作' }); },
  ];
  const result = await runLoop(ctx, script, { signal: controller.signal });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.steps.length, 1);
  assert.equal(result.build, null);
  assert.equal(result.draftRevision, 0);
  assert.equal(ctx.workspace.readManifest().revision, 0);

  const already = new AbortController();
  already.abort();
  const second = await runLoop(ctx, [action({ tool: 'world.query', args: { kind: 'object' }, summary: '不该执行' })], { signal: already.signal });
  assert.equal(second.status, 'cancelled');
  assert.equal(second.steps.length, 0);
  assert.equal(ctx.workspace.readManifest().revision, 0);
});

test('工具执行报错变成可读结果回灌，不抛出且草稿不变', async () => {
  const ctx = fixture();
  let observed = null;
  const script = [
    action({ tool: 'resource.read', args: { kind: 'object', id: 'flower-one' }, summary: '读取' }),
    state => {
      const read = state.lastResult;
      const value = JSON.parse(read.text);
      value.position.x = 5;
      return action({ tool: 'workspace.patch', args: { workspaceRevision: read.workspaceRevision + 1, operations: [{ kind: 'object', id: value.id, expectedHash: read.hash, value }] }, summary: '用过期的草稿版本提交' });
    },
    state => { observed = state.lastError; return action({ tool: 'candidate.build', args: {}, summary: '改用正确版本后构建' }); },
    action({ kind: 'finish', summary: '记录失败后结束' }),
  ];
  const result = await runLoop(ctx, script);
  assert.equal(result.status, 'finished');
  const failed = result.steps.find(step => step.status === 'error');
  assert.equal(failed.tool, 'workspace.patch');
  assert.equal(failed.code, 'STALE_DRAFT');
  assert.match(failed.message, /草稿已改变/);
  assert.equal(observed.code, 'STALE_DRAFT');
  assert.equal(result.draftRevision, 0);
  assert.equal(ctx.workspace.readManifest().revision, 0);
});

test('未先读取就补丁：返回 READ_CONFLICT，草稿未变', async () => {
  const ctx = fixture();
  const before = contentHash(ctx.workspace.scene());
  const value = structuredClone(floraScene().objects[0]);
  value.position.x = 4;
  const script = [
    action({ tool: 'workspace.patch', args: { workspaceRevision: 0, operations: [{ kind: 'object', id: 'flower-one', expectedHash: contentHash(floraScene().objects[0]), value }] }, summary: '未读取直接修改' }),
    action({ tool: 'candidate.build', args: {}, summary: '构建当前草稿' }),
    action({ kind: 'finish', summary: '放弃修改，保留草稿' }),
  ];
  const result = await runLoop(ctx, script);
  const failed = result.steps.find(step => step.status === 'error');
  assert.equal(failed.code, 'READ_CONFLICT');
  assert.match(failed.message, /先读取/);
  assert.equal(result.draftRevision, 0);
  assert.equal(ctx.workspace.readManifest().revision, 0);
  assert.equal(contentHash(ctx.workspace.scene()), before);
  assert.equal(ctx.workspace.scene().objects.find(o => o.id === 'flower-one').position.x, 0);
});

test('decideAction 复用现有 provider 分发，actionPrompt 带齐事实', async () => {
  const calls = [];
  const model = async input => { calls.push(input); return action({ kind: 'finish', summary: '完成' }); };
  const dir = fs.mkdtempSync(path.join(ROOT, 'prompt-'));
  const controller = new AbortController();
  const raw = await decideAction({ model, dir, prompt: actionPrompt({ requirement: '开门要消耗一块木头', draftRevision: 2, step: 3, remainingSteps: 13, remainingCalls: 45 }), signal: controller.signal, onLog: () => {} });
  assert.equal(JSON.parse(raw).kind, 'finish');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].dir, dir);
  assert.equal(calls[0].schema.type, 'object');
  assert.equal(calls[0].active.abort.signal, controller.signal);
  assert.match(calls[0].prompt, /开门要消耗一块木头/);
  assert.match(calls[0].prompt, /workspace\.patch/);
  assert.match(calls[0].prompt, /运行版本 craftmine-web/);
  assert.match(calls[0].prompt, /当前草稿版本：2/);

  await assert.rejects(() => decideAction({ model, dir: '', prompt: 'x' }), /工作目录/);
  await assert.rejects(() => decideAction({ model, dir, prompt: '   ' }), /提示不能为空/);
  await assert.rejects(() => decideAction({ model: async () => '', dir, prompt: 'x' }), /没有返回操作/);
});

test('构造参数与状态快照受校验，预算字段不合法直接拒绝', () => {
  const ctx = fixture();
  const base = { workspace: ctx.workspace, tools: ctx.tools, decide: () => '{}' };
  assert.throws(() => new HarnessLoop({ ...base, workspace: null }), /工作区/);
  assert.throws(() => new HarnessLoop({ ...base, tools: null }), /领域工具集/);
  assert.throws(() => new HarnessLoop({ ...base, decide: null }), /决策函数/);
  assert.throws(() => new HarnessLoop({ ...base, steps: -1 }), /步数预算/);
  assert.throws(() => new HarnessLoop({ ...base, budget: { calls: 1.5 } }), /工具调用预算/);
  const loop = new HarnessLoop({ ...base, steps: 2, calls: 2, requirement: '需求' });
  const state = loop.state(1);
  assert.equal(state.format, 'craftmine.harness-state/1');
  assert.equal(state.remainingSteps, 2);
  assert.equal(state.remainingCalls, 2);
  assert.equal(state.draftRevision, 0);
  assert.equal(state.lastResult, null);
  assert.match(state.guide, /candidate\.build/);
  assert.match(state.capabilities, /运行版本/);
});

test('agent 新路径默认关闭，只有 CRAFTMINE_HARNESS_LOOP=1 才启用', async () => {
  const { harnessLoopEnabled } = await import('../app/agent.mjs');
  const saved = process.env.CRAFTMINE_HARNESS_LOOP;
  try {
    delete process.env.CRAFTMINE_HARNESS_LOOP;
    assert.equal(harnessLoopEnabled(), false);
    process.env.CRAFTMINE_HARNESS_LOOP = '0';
    assert.equal(harnessLoopEnabled(), false);
    process.env.CRAFTMINE_HARNESS_LOOP = 'on';
    assert.equal(harnessLoopEnabled(), false);
    process.env.CRAFTMINE_HARNESS_LOOP = '1';
    assert.equal(harnessLoopEnabled(), true);
  } finally {
    if (saved === undefined) delete process.env.CRAFTMINE_HARNESS_LOOP; else process.env.CRAFTMINE_HARNESS_LOOP = saved;
  }
});

test('开启开关后任务走闭环：写草稿目录、生成候选、状态 ready', async () => {
  const { AgentRunner } = await import('../app/agent.mjs');
  const store = new ProjectStore(fs.mkdtempSync(path.join(ROOT, 'agent-')));
  const build = store.build(floraScene());
  store.change(d => { d.current = build.id; d.history.push({ id: build.id, summary: '花与草', time: Date.now() }); });
  const script = [
    action({ tool: 'resource.read', args: { kind: 'object', id: 'flower-one' }, summary: '读取目标花' }),
    state => {
      const read = state.lastResult;
      const value = JSON.parse(read.text);
      value.position.x = 4;
      return action({ tool: 'workspace.patch', args: { workspaceRevision: read.workspaceRevision, operations: [{ kind: 'object', id: value.id, expectedHash: read.hash, value }] }, summary: '把花挪到 x=4' });
    },
    action({ tool: 'candidate.build', args: {}, summary: '构建候选' }),
    action({ kind: 'finish', summary: 'flower-one 已挪到 x=4' }),
  ];
  const seen = [];
  const runner = new AgentRunner(store, {
    timeoutMs: 20000,
    harnessDecide: async state => {
      seen.push(state.step);
      const next = script[state.step - 1];
      assert.ok(next, `脚本缺少第 ${state.step} 步`);
      return typeof next === 'function' ? next(state) : next;
    },
  });
  const saved = { loop: process.env.CRAFTMINE_HARNESS_LOOP, provider: process.env.CRAFTMINE_MODEL_PROVIDER, key: process.env.CRAFTMINE_DEEPSEEK_API_KEY };
  process.env.CRAFTMINE_HARNESS_LOOP = '1';
  process.env.CRAFTMINE_MODEL_PROVIDER = 'deepseek';
  process.env.CRAFTMINE_DEEPSEEK_API_KEY = 'sk-fixture';
  try {
    const id = runner.start('把 flower-one 挪到 x=4', 'execute', { selected: null, player: null });
    await runner.active.done;
    const task = store.data.tasks.find(t => t.id === id);
    assert.equal(task.status, 'ready');
    assert.equal(task.build, store.data.candidate.id);
    assert.equal(task.attempts.length, 1);
    assert.equal(task.attempts[0].kind, 'harness');
    assert.equal(task.attempts[0].status, 'passed');
    assert.deepEqual(seen, [1, 2, 3, 4]);
    assert.ok(task.logs.some(line => /分步工具闭环已开启/.test(line.text)));
    assert.ok(task.logs.some(line => /第 1 步：resource\.read 完成/.test(line.text)));
    const workspaceFile = path.join(store.root, 'tasks', id, 'workspace', 'loop.json');
    assert.ok(fs.existsSync(workspaceFile), '闭环结果写入草稿目录');
    const loop = JSON.parse(fs.readFileSync(workspaceFile, 'utf8'));
    assert.equal(loop.status, 'finished');
    assert.equal(loop.draftRevision, 1);
    assert.ok(fs.existsSync(path.join(store.root, 'tasks', id, 'workspace', 'loop', 'step-1.request.txt')));
    assert.ok(fs.existsSync(path.join(store.root, 'tasks', id, 'workspace', 'loop', 'step-4.action.json')));
    assert.equal(store.readBuild(store.data.candidate.id).scene.objects.find(o => o.id === 'flower-one').position.x, 4);
    assert.equal(store.data.current, build.id, '正式世界未改变');
  } finally {
    for (const [key, value] of Object.entries({ CRAFTMINE_HARNESS_LOOP: saved.loop, CRAFTMINE_MODEL_PROVIDER: saved.provider, CRAFTMINE_DEEPSEEK_API_KEY: saved.key })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('讨论意图不会进入执行闭环，只有执行意图才走分步工具', async () => {
  const { usesHarnessLoop } = await import('../app/agent.mjs');
  const saved = process.env.CRAFTMINE_HARNESS_LOOP;
  try {
    delete process.env.CRAFTMINE_HARNESS_LOOP;
    assert.equal(usesHarnessLoop('execute'), false);
    process.env.CRAFTMINE_HARNESS_LOOP = '1';
    assert.equal(usesHarnessLoop('execute'), true);
    assert.equal(usesHarnessLoop('discuss'), false);
    assert.equal(usesHarnessLoop(undefined), false);
  } finally {
    if (saved === undefined) delete process.env.CRAFTMINE_HARNESS_LOOP; else process.env.CRAFTMINE_HARNESS_LOOP = saved;
  }
});

test('模型返回空内容只算一次拒绝，不会判死任务', async () => {
  const ctx = fixture();
  let calls = 0;
  const result = await new HarnessLoop({
    workspace: ctx.workspace, tools: ctx.tools, requirement: '把 flower-one 挪到 x=4',
    decide: async () => {
      calls += 1;
      if (calls === 1) { const error = new Error('模型没有返回操作'); error.code = 'EMPTY_ACTION'; throw error; }
      if (calls === 2) return action({ tool: 'candidate.build', args: {}, summary: '构建候选' });
      return action({ kind: 'finish', summary: '完成' });
    },
  }).run();
  assert.equal(result.status, 'finished');
  assert.equal(result.steps[0].status, 'rejected');
  assert.equal(result.steps[0].code, 'EMPTY_ACTION');
  assert.equal(result.steps.at(-1).status, 'finish');
});

test('构建成功之后工具调用预算用尽，仍然允许结束', async () => {
  const ctx = fixture();
  const result = await runLoop(ctx, [
    action({ tool: 'candidate.build', args: {}, summary: '构建候选' }),
    action({ kind: 'finish', summary: '结束' }),
  ], { calls: 1 });
  assert.equal(result.status, 'finished');
  assert.equal(result.build.objects, 5);
});

test('构建结果只把引用交给下一步，不会把整份场景塞进提示', async () => {
  const ctx = fixture();
  let seen = null;
  const result = await runLoop(ctx, [
    action({ tool: 'candidate.build', args: {}, summary: '构建候选' }),
    state => { seen = state.lastResult; return action({ kind: 'finish', summary: '结束' }); },
  ]);
  assert.equal(result.status, 'finished');
  assert.equal(seen.scene, undefined);
  assert.equal(typeof seen.id, 'string');
  assert.equal(seen.objects, 5);
});

test('同一个 attempt 内的多次模型调用用量累加，不是只保留最后一次', async () => {
  const { AgentRunner } = await import('../app/agent.mjs');
  const store = new ProjectStore(fs.mkdtempSync(path.join(ROOT, 'usage-')));
  store.change(d => { d.tasks.push({ id: TASK, base: d.current, intent: 'execute', status: 'running', started: Date.now(), attempts: [{ number: 1, status: 'running' }], logs: [] }); });
  const runner = new AgentRunner(store, {});
  runner.applyUsage({ id: TASK }, 1, { input_tokens: 10, output_tokens: 4 });
  runner.applyUsage({ id: TASK }, 1, { input_tokens: 3, output_tokens: 2 });
  const task = store.data.tasks.find(t => t.id === TASK);
  assert.deepEqual(task.attempts[0].usage, { input_tokens: 13, output_tokens: 6 });
  assert.deepEqual(task.usage, { input_tokens: 13, output_tokens: 6 });
});

test('上下文到压缩阈值就停下来让宿主整理，不硬塞进窗口', async () => {
  const ctx = fixture();
  const result = await runLoop(ctx, [action({ tool: 'project.inspect', args: {}, summary: '不该走到这里' })], { contextWindow: 40000, requirement: '把 flower-one 挪到 x=4'.repeat(5000) });
  assert.equal(result.status, 'context');
  assert.match(result.error, /压缩阈值/);
  assert.equal(result.steps.length, 0, '超预算时一次模型调用都不该发生');
  assert.equal(result.context.known, true);
  assert.ok(result.context.estimated > 0);
  const unknown = await runLoop(ctx, [action({ tool: 'project.inspect', args: {}, summary: '先看目录' })]);
  assert.equal(unknown.context.known, false);
  assert.match(unknown.context.detail, /没有回报上下文容量/);
});

test('闭环结束时给出机器事实检查点：基准、草稿、验收引用和证据都在', async () => {
  const ctx = fixture();
  const script = [
    action({ tool: 'project.inspect', args: {}, summary: '先看目录' }),
    action({ tool: 'resource.read', args: { kind: 'object', id: 'flower-one' }, summary: '读取目标花' }),
    state => {
      const read = state.lastResult, value = JSON.parse(read.text);
      value.position.x = 4;
      return action({ tool: 'workspace.patch', args: { workspaceRevision: read.workspaceRevision, operations: [{ kind: 'object', id: 'flower-one', expectedHash: read.hash, value }] }, summary: '挪到 x=4' });
    },
    action({ tool: 'candidate.build', args: {}, summary: '构建候选' }),
    action({ kind: 'finish', args: {}, summary: '改好了' }),
  ];
  const result = await runLoop(ctx, script, { intentRevision: 2 });
  assert.equal(result.status, 'finished');
  assert.equal(result.checkpoint.format, 'craftmine.checkpoint/1');
  assert.equal(result.checkpoint.baseBuild, ctx.base);
  assert.match(result.checkpoint.draftHead, /^\d+-[a-f0-9]{64}\.json$/);
  assert.match(result.checkpoint.acceptanceRef, /^acceptance:/);
  assert.equal(result.checkpoint.budgetRef, 'budget:' + TASK);
  assert.equal(result.checkpoint.intentRevision, 2);
  assert.equal(result.checkpoint.journalThrough, result.steps.length);
  assert.ok(result.checkpoint.completedSteps.length >= 4);
  assert.ok(result.checkpoint.artifactRefs.some(ref => ref.startsWith('evidence:')), '候选构建要留下证据引用');
  assert.equal(result.checkpoint.candidateRef, result.build.id);
});

test('模型「演」出多步对话时，宿主只取第一个满足 schema 的操作对象', async () => {
  const { parseAction } = await import('../app/harness/contracts.mjs');
  const one = JSON.stringify({ kind: 'tool', tool: 'project.inspect', argumentsJSON: '{}', summary: '看目录' });
  assert.equal(parseAction(one).tool, 'project.inspect');
  const simulated = one + '\n\n<result>\n{"draftRevision":0}\n</result>\n\n' + JSON.stringify({ kind: 'tool', tool: 'world.query', argumentsJSON: '{"kind":"object"}', summary: '第二步' });
  assert.equal(parseAction(simulated).tool, 'project.inspect', '只执行第一个操作，伪造的后续步骤和结果是噪声');
  assert.equal(parseAction('说明文字\n```json\n' + one + '\n```').tool, 'project.inspect');
  assert.equal(parseAction(JSON.stringify({ kind: 'tool', tool: 'resource.read', argumentsJSON: JSON.stringify({ kind: 'object', id: 'flower-one' }), summary: '说明里带 { 和 } 也要正确切分' })).args.id, 'flower-one');
  assert.throws(() => parseAction('这里没有 JSON'), /有效 JSON/);
  assert.throws(() => parseAction('{"draftRevision":0}'), /字段/);
  assert.throws(() => parseAction(JSON.stringify({ kind: 'tool', tool: 'shell.run', argumentsJSON: '{}', summary: '越权' })), /未授权或不存在/);
});
