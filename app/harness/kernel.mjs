import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAssertion, evaluateAssertions } from './assertions.mjs';
import { buildTrace } from './trace.mjs';
import { PART_KINDS } from './parts.mjs';

// 冻结内核：这些文件定义「什么叫通过」，所以它们自己永远不能被模型替换。
// 只有人改了规则之后，才允许人手动更新下面的哈希清单；模型没有这条路径。
export const KERNEL_CHECK_FORMAT = 'craftmine.kernel-check/1';
export const PART_LOAD_FORMAT = 'craftmine.kernel-part-load/1';

export const FROZEN_KERNEL = Object.freeze([
  'app/harness/acceptance.mjs',
  'app/harness/assertions.mjs',
  'app/harness/requirements.mjs',
  'app/harness/judge.mjs',
  'app/harness/metrics.mjs',
  'app/harness/extension.mjs',
  'app/harness/extension-loader.mjs',
  'app/store.mjs',
  'app/behavior-contracts.mjs',
  'app/canonical.mjs',
  'app/static-files.mjs',
]);

export const FROZEN_KERNEL_HASHES = Object.freeze({
  'app/harness/acceptance.mjs': 'dc41330bd7ccb08e34ac07b0334ea57bee138716384f75c68be4fd8e240f6ef0',
  'app/harness/assertions.mjs': 'fa860eef569397d8ad55001bad0ede296ca5d0577032d57b9cac33cd3c91ec5d',
  'app/harness/requirements.mjs': '04454be75b2fd10721695b7691ee3440eb284b86e2870d4f17ba5be5a155b343',
  'app/harness/judge.mjs': '9ee5f7b593c40acc7baa6bf640eee56b55cce5230183f8667c2915c73e0d0763',
  'app/harness/metrics.mjs': 'ceccfdc7991b174af56a1a7ad76711e2379f9af3c06cda896c9dc0d9935c3a44',
  'app/harness/extension.mjs': '10de8886a682148592262e4bb7908e4c79994a3d9430cf7045d888351df3e32e',
  'app/harness/extension-loader.mjs': 'a76d414edbc7359472de5e82ff6fcdca241326191853081cf33b7565904a2244',
  'app/store.mjs': '2469fad89532cc3642ecf74e09746d622773fc57de632a22129bfac120118f7a',
  'app/behavior-contracts.mjs': '536bd8616330610221a4f7d9f679b5c4e215c8813319bc896bc281068cb2b6de',
  'app/canonical.mjs': '788dee7dbae8231382b35952b20052db73e9e064bd85ea34603f1f00a5e03779',
  'app/static-files.mjs': '93cd5daa2bdfbaca7be1101d3b42a10171fc44070e9ecc2a3244cf4cc71daefd',
});

export function kernelRoot() {
  return path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
}

const isPlain = value => value && typeof value === 'object' && !Array.isArray(value);
const need = (condition, message) => { if (!condition) throw Error(message); };

export function verifyKernel({ root = kernelRoot(), files = null } = {}) {
  const entries = FROZEN_KERNEL.map(relative => {
    const expected = FROZEN_KERNEL_HASHES[relative];
    let actual;
    try {
      // 测试可以注入内容（files）来证明「改一个字节就变红」，否则从磁盘读同一套路径。
      const content = files && Object.hasOwn(files, relative) ? files[relative] : fs.readFileSync(path.join(root, relative), 'utf8');
      actual = createHash('sha256').update(content).digest('hex');
    } catch (error) { actual = 'missing:' + (error.code || error.message); }
    return { path: relative, expected, actual, ok: actual === expected };
  });
  const changed = entries.filter(entry => !entry.ok);
  return {
    format: KERNEL_CHECK_FORMAT,
    passed: changed.length === 0,
    entries,
    summary: changed.length
      ? `冻结内核被改动：${changed.map(entry => entry.path).join('、')}。只有人能更新冻结清单，模型不能改这些文件。`
      : `${entries.length} 个冻结内核文件都没有被改动`,
  };
}

export function assertKernelIntact(options) {
  const report = verifyKernel(options);
  if (!report.passed) throw Error(report.summary);
  return report;
}

// 可替换部件：接口固定、预算固定，模型只能换实现，不能换契约。
export const REPLACEABLE_PARTS = Object.freeze({
  renderPass: {
    kind: 'renderPass', entry: 'run', interface: 'run({time, primitives, objects}) -> void', budgetMs: 1,
    builtin: { id: 'default', selfTests: [{ id: 'part.render-pass.default', kind: 'step', why: '默认渲染通道每帧被调用但什么都不改', red: '把渲染通道写成会改世界的实现', label: 'run-1', minCommands: 0 }] },
  },
  hudWidget: {
    kind: 'hudWidget', entry: 'render', interface: 'render({play, time}) -> null', budgetMs: 1,
    builtin: { id: 'default', selfTests: [{ id: 'part.hud-widget.default', kind: 'step', why: '默认 HUD 部件返回 null，不往画面加任何东西', red: '默认部件偷偷改 HUD', label: 'run-1', minCommands: 0 }] },
  },
  postProcess: {
    kind: 'postProcess', entry: 'apply', interface: 'apply(frame) -> frame', budgetMs: 2,
    builtin: { id: 'default', selfTests: [{ id: 'part.post-process.default', kind: 'step', why: '默认后处理是恒等变换', red: '默认后处理改变了帧', label: 'run-1', minCommands: 0 }] },
  },
});

// 空实现必须和真实实现产出不同，否则自带测试证明不了任何事。
export const PART_NOOP_CODE = Object.freeze({
  renderPass: 'export function run() { return null; }',
  hudWidget: 'export function render() { return null; }',
  postProcess: 'export function apply() { return null; }',
});

const PART_ID = /^[a-z][a-z0-9-]{0,47}$/;

for (const definition of Object.values(REPLACEABLE_PARTS)) {
  for (const assertion of definition.builtin.selfTests) validateAssertion(assertion);
}

function validatePart(part) {
  need(isPlain(part), '内核部件必须是对象');
  need(PART_KINDS.includes(part.kind), `内核部件类型无效：${part.kind}；只支持 ${PART_KINDS.join('、')}`);
  const definition = REPLACEABLE_PARTS[part.kind];
  need(PART_ID.test(part.id || ''), '内核部件 ID 无效（小写字母开头，可含数字和连字符）');
  need(Number.isInteger(part.version) && part.version >= 1 && part.version <= 10000, '内核部件版本号无效');
  need(typeof part.code === 'string' && part.code.trim().length > 0 && part.code.length <= 12000, '内核部件代码无效或过长');
  const entry = definition.entry;
  need(new RegExp(`export\\s+(async\\s+)?(function\\s+${entry}|const\\s+${entry}|let\\s+${entry}|var\\s+${entry})\\b`).test(part.code), `内核部件必须导出 ${entry}：${definition.interface}`);
  need(Array.isArray(part.selfTests) && part.selfTests.length >= 1 && part.selfTests.length <= 8, '内核部件需要 1–8 个自带测试');
  for (const [index, test] of part.selfTests.entries()) {
    need(isPlain(test) && typeof test.name === 'string' && test.name.length > 0 && test.name.length <= 80, `第 ${index + 1} 个自带测试缺少名称`);
    need(isPlain(test.world) && Array.isArray(test.world.objects), `自带测试「${test.name}」需要 world.objects`);
    need(Array.isArray(test.expect) && test.expect.length >= 1, `自带测试「${test.name}」需要 expect 断言`);
    for (const assertion of test.expect) validateAssertion(assertion);
  }
  return part;
}

const snapshotOf = world => ({
  playerHealth: Number.isFinite(world?.playerHealth) ? world.playerHealth : null,
  objects: (world?.objects || []).map(object => ({
    id: object.id,
    position: object.position ? { ...object.position } : null,
    visible: object.visible !== false,
    mesh: object.mesh !== false,
    health: Number.isFinite(object.health) ? object.health : null,
    solid: object.solid !== false,
    color: typeof object.color === 'string' ? object.color : null,
  })).sort((a, b) => String(a.id).localeCompare(String(b.id))),
  inventory: { ...(world?.inventory || {}) },
  resources: structuredClone(world?.resources || {}),
  panels: structuredClone(world?.panels || {}),
  effects: [],
});

async function runPartTest(part, test, { createRunner, noop = false } = {}) {
  const definition = REPLACEABLE_PARTS[part.kind];
  const source = noop ? { ...part, code: PART_NOOP_CODE[part.kind] } : part;
  const runner = createRunner(source);
  try {
    await runner.ready;
    const world = { playerHealth: 100, objects: [], ...structuredClone(test.world) };
    const start = snapshotOf(world);
    const value = await runner.run({ world, time: 0, dt: 0.016, kind: part.kind, interface: definition.interface });
    // 部件返回值统一折成 commands：轨迹和断言 DSL 只认这一种形状。
    const commands = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
    const steps = [{
      label: 'run-1', event: { type: 'part', targetId: null }, commands,
      before: start, after: snapshotOf(world), change: { changed: commands.length > 0, fields: [] },
    }];
    return buildTrace({ requirement: `part:${part.kind}/${part.id}@${part.version}`, start, steps, final: steps[0].after });
  } finally { runner.dispose?.(); }
}

export async function runPartSelfTests(part, { createRunner } = {}) {
  if (typeof createRunner !== 'function') throw Error('内核部件的自带测试需要一个沙箱执行器');
  const results = [];
  for (const test of part.selfTests) {
    const entry = { name: test.name, passed: false, real: null, noop: null, detail: '' };
    try {
      const realReport = evaluateAssertions(test.expect, await runPartTest(part, test, { createRunner }));
      entry.real = { passed: realReport.passed, detail: realReport.summary };
      const fakeReport = evaluateAssertions(test.expect, await runPartTest(part, test, { createRunner, noop: true }));
      entry.noop = { passed: fakeReport.passed, detail: fakeReport.summary };
      if (!realReport.passed) entry.detail = `自带测试没有通过：${realReport.summary}`;
      else if (fakeReport.passed) entry.detail = '自带测试对空实现也通过，证明不了任何事，拒绝装载';
      else { entry.passed = true; entry.detail = '自带测试通过，且空实现会被打红'; }
    } catch (error) { entry.detail = '自带测试执行失败：' + error.message; }
    results.push(entry);
  }
  const failed = results.filter(result => !result.passed);
  return {
    format: 'craftmine.kernel-part-selftest/1', passed: failed.length === 0, results,
    summary: failed.length ? `${failed.length} 个自带测试不合格：${failed.map(result => `${result.name}（${result.detail}）`).join('；')}` : `${results.length} 个自带测试全部通过，且都对空实现变红`,
  };
}

export function partDigest(part) {
  return createHash('sha256').update(String(part?.code ?? '')).digest('hex');
}

export async function loadPart({ kind, part, approvals = [], createRunner, verifyKernel: verify = assertKernelIntact } = {}) {
  need(PART_KINDS.includes(kind), `内核部件类型无效：${kind}；只支持 ${PART_KINDS.join('、')}`);
  need(isPlain(part), '内核部件必须是对象');
  need(part.kind === kind, `内核部件的 kind 必须是 ${kind}`);
  // 人审是硬门槛：没有审批记录就没有任何后续步骤。
  const approval = (approvals || []).find(record => isPlain(record) && record.id === part.id && typeof record.by === 'string' && record.by.trim().length > 0 && typeof record.at === 'string' && record.at.trim().length > 0);
  need(approval, '改动内核部件必须有人审一次');
  validatePart(part);
  // 规则文件自己先得是原样的，否则「通过」二字没有意义。
  const kernelReport = (typeof verify === 'function' ? verify : assertKernelIntact)();
  if (kernelReport?.passed === false) throw Error(kernelReport.summary || '冻结内核被改动');
  const selfTests = await runPartSelfTests(part, { createRunner });
  const checks = [
    { name: '人工审批', passed: true, detail: `${approval.by} 于 ${approval.at} 审批` },
    { name: '冻结内核', passed: true, detail: '冻结内核没有被改动' },
    { name: '自带测试与反造假', passed: selfTests.passed, detail: selfTests.summary },
  ];
  const failed = checks.filter(check => !check.passed);
  return {
    format: PART_LOAD_FORMAT, status: failed.length ? 'rejected' : 'ready',
    part: { id: part.id, kind: part.kind, version: part.version, entry: REPLACEABLE_PARTS[kind].entry, digest: partDigest(part) },
    approval: { id: approval.id, by: approval.by, at: approval.at },
    checks, selfTests,
    error: failed.length ? failed.map(check => check.detail).join('；') : null,
  };
}

// 部件注册表：激活新版本把旧版本推进历史，回退必须显式，未装载的部件不能回退。
export class PartRegistry {
  constructor({ createRunner, verifyKernel: verify, approvals = [] } = {}) {
    this.createRunner = createRunner;
    this.verify = verify;
    this.approvals = approvals;
    this.active = new Map();
    this.versions = new Map();
    this.rejected = [];
  }
  get loaded() { return [...this.active.values()].map(part => ({ id: part.id, kind: part.kind, version: part.version })); }
  async load(part, { approvals } = {}) {
    const candidate = await loadPart({ kind: part?.kind, part, approvals: approvals ?? this.approvals, createRunner: this.createRunner, verifyKernel: this.verify });
    if (candidate.status !== 'ready') this.rejected.push({ id: candidate.part?.id || part?.id || null, kind: part?.kind || null, error: candidate.error });
    return candidate;
  }
  activate(candidate) {
    if (candidate?.status !== 'ready') throw Error('只有通过全部检查的内核部件才能启用');
    const { id, kind, version } = candidate.part;
    const previous = this.active.get(kind) || null;
    if (previous) this.versions.set(kind, [...(this.versions.get(kind) || []), previous].slice(-5));
    this.active.set(kind, candidate.part);
    return { format: PART_LOAD_FORMAT, activated: `${kind}:${id}@${version}`, previous: previous ? `${previous.kind}:${previous.id}@${previous.version}` : null };
  }
  fallback(kind) {
    need(PART_KINDS.includes(kind), `内核部件类型无效：${kind}；只支持 ${PART_KINDS.join('、')}`);
    const list = this.versions.get(kind) || [];
    const previous = list.pop();
    this.versions.set(kind, list);
    if (previous) {
      this.active.set(kind, previous);
      return { format: PART_LOAD_FORMAT, fallback: `${kind}:${previous.id}@${previous.version}`, builtin: false };
    }
    if (!this.active.has(kind)) throw Error(`内核部件 ${kind} 没有可回退的版本`);
    this.active.delete(kind);
    return { format: PART_LOAD_FORMAT, fallback: `${kind}:${REPLACEABLE_PARTS[kind].builtin.id}`, builtin: true };
  }
  current(kind) {
    need(PART_KINDS.includes(kind), `内核部件类型无效：${kind}；只支持 ${PART_KINDS.join('、')}`);
    return this.active.get(kind) || null;
  }
  history(kind) {
    need(PART_KINDS.includes(kind), `内核部件类型无效：${kind}；只支持 ${PART_KINDS.join('、')}`);
    return [...(this.versions.get(kind) || [])];
  }
}
