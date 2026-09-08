import { canonicalJSON } from '../canonical.mjs';
import { evaluateAssertions, validateAssertion } from './assertions.mjs';
import { buildTrace } from './trace.mjs';

// 渲染扩展 ABI：模型只能往画面里加「几何体」，不能碰存档、碰撞和输入。
// 这个文件必须同时能在 Node 和浏览器里跑，因此只依赖浏览器安全的模块，绝不 import node:*。
export const RENDER_EXTENSION_FORMAT = 'craftmine.render-extension/1';
export const RENDER_LOAD_FORMAT = 'craftmine.render-load/1';
export const RENDER_LIMITS = Object.freeze({
  drawables: 256, ttl: [0.05, 5], size: [0.02, 1], budgetMs: [1, 16], maxFailures: [1, 10], code: 8000, selfTests: 8, name: 60, description: 1000,
});
export const RENDER_DRAWABLE_KINDS = Object.freeze(['particle', 'box']);
// 画面里允许出现的范围：和世界边界、可站立高度一致，粒子飞出去就等于穿帮。
export const RENDER_FIELD = Object.freeze({ half: 46, minY: 6, maxY: 38 });
export const RENDER_EXTENSION_ID = /^[a-z][a-z0-9-]{0,47}$/;
export const NOOP_RENDER_CODE = 'export function emit() { return []; }';
export const RENDER_BUDGET_DEFAULT = 4;
export const RENDER_MAX_FAILURES_DEFAULT = 3;

const COLOR = /^#[0-9a-fA-F]{6}$/;
const isPlain = value => value && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

function need(condition, message) { if (!condition) throw Error(message); }
const inRange = (value, range) => finite(value) && value >= range[0] && value <= range[1];

export function renderExtensionRequirement(id, version) {
  return `render:${id}@${version}`;
}

// 不用 node:crypto：这个文件要能在浏览器里跑，稳定指纹用 canonicalJSON 就够了（同一份数据必然同一串）。
export function renderExtensionDigest(extension) {
  return canonicalJSON(extension);
}

export function validateRenderExtension(input) {
  need(isPlain(input), '渲染扩展必须是对象');
  need(input.format === RENDER_EXTENSION_FORMAT, `渲染扩展格式不兼容：需要 ${RENDER_EXTENSION_FORMAT}`);
  need(RENDER_EXTENSION_ID.test(input.id || ''), '渲染扩展 ID 无效（小写字母开头，可含数字和连字符）');
  need(text(input.name, RENDER_LIMITS.name), '渲染扩展名称无效');
  need(Number.isInteger(input.version) && input.version >= 1 && input.version <= 10000, '渲染扩展版本号无效');
  need(typeof input.description === 'string' && input.description.length <= RENDER_LIMITS.description, '渲染扩展说明无效');
  need(text(input.code, RENDER_LIMITS.code), '渲染扩展实现代码无效或过长');
  need(/export\s+(async\s+)?(function\s+emit|const\s+emit|let\s+emit|var\s+emit)\b/.test(input.code), '渲染扩展必须导出 emit({world, time, dt})');

  const extra = Object.keys(input).filter(key => !['format', 'id', 'name', 'version', 'description', 'code', 'budgetMs', 'maxFailures', 'selfTests'].includes(key));
  need(!extra.length, `渲染扩展包含不支持的字段：${extra.join('、')}`);

  need(input.budgetMs === undefined || (Number.isInteger(input.budgetMs) && inRange(input.budgetMs, RENDER_LIMITS.budgetMs)), `渲染扩展的单帧预算必须是 ${RENDER_LIMITS.budgetMs[0]}–${RENDER_LIMITS.budgetMs[1]} 毫秒`);
  need(input.maxFailures === undefined || (Number.isInteger(input.maxFailures) && inRange(input.maxFailures, RENDER_LIMITS.maxFailures)), `渲染扩展的失败上限必须是 ${RENDER_LIMITS.maxFailures[0]}–${RENDER_LIMITS.maxFailures[1]}`);

  need(Array.isArray(input.selfTests) && input.selfTests.length >= 1 && input.selfTests.length <= RENDER_LIMITS.selfTests, `渲染扩展需要 1–${RENDER_LIMITS.selfTests} 个自带测试`);
  for (const [index, test] of input.selfTests.entries()) {
    need(isPlain(test) && text(test.name, 80), `第 ${index + 1} 个自带测试缺少名称`);
    need(isPlain(test.world) && Array.isArray(test.world.objects), `自带测试「${test.name}」需要 world.objects`);
    need(finite(test.time), `自带测试「${test.name}」的 time 必须是数字`);
    need(finite(test.dt) && test.dt >= 0 && test.dt <= 1, `自带测试「${test.name}」的 dt 必须是 0–1 秒`);
    need(Array.isArray(test.expect) && test.expect.length >= 1, `自带测试「${test.name}」需要 expect 断言`);
    for (const assertion of test.expect) validateAssertion(assertion);
  }

  return {
    ...structuredClone(input),
    budgetMs: input.budgetMs ?? RENDER_BUDGET_DEFAULT,
    maxFailures: input.maxFailures ?? RENDER_MAX_FAILURES_DEFAULT,
  };
}

// 宿主只认这三种 drawable，且必须落在世界里；越界、超量、坏颜色一律拒绝。
export function validateDrawables(list) {
  need(Array.isArray(list), '渲染扩展的 emit 必须返回 drawable 数组');
  need(list.length <= RENDER_LIMITS.drawables, `渲染扩展一帧最多产出 ${RENDER_LIMITS.drawables} 个 drawable`);
  list.forEach((drawable, index) => {
    const where = `第 ${index + 1} 个 drawable`;
    need(isPlain(drawable), `${where}必须是对象`);
    need(RENDER_DRAWABLE_KINDS.includes(drawable.kind), `${where}的类型无效：${drawable.kind}；只支持 ${RENDER_DRAWABLE_KINDS.join('、')}`);
    need(COLOR.test(drawable.color || ''), `${where}的颜色必须是 #RRGGBB`);
    if (drawable.kind === 'particle') {
      const extra = Object.keys(drawable).filter(key => !['kind', 'position', 'size', 'ttl', 'color'].includes(key));
      need(!extra.length, `${where}包含不支持的字段：${extra.join('、')}`);
      const position = drawable.position;
      need(isPlain(position) && ['x', 'y', 'z'].every(axis => finite(position[axis])), `${where}需要 {x,y,z} 位置`);
      need(Math.abs(position.x) <= RENDER_FIELD.half && Math.abs(position.z) <= RENDER_FIELD.half, `${where}水平位置超出世界范围（|x|、|z| 必须 ≤ ${RENDER_FIELD.half}）`);
      need(position.y >= RENDER_FIELD.minY && position.y <= RENDER_FIELD.maxY, `${where}的高度必须在 ${RENDER_FIELD.minY}–${RENDER_FIELD.maxY} 之间`);
      need(inRange(drawable.size, RENDER_LIMITS.size), `${where}的 size 必须在 ${RENDER_LIMITS.size[0]}–${RENDER_LIMITS.size[1]} 之间`);
      need(inRange(drawable.ttl, RENDER_LIMITS.ttl), `${where}的 ttl 必须在 ${RENDER_LIMITS.ttl[0]}–${RENDER_LIMITS.ttl[1]} 秒之间`);
    } else {
      const extra = Object.keys(drawable).filter(key => !['kind', 'min', 'max', 'color'].includes(key));
      need(!extra.length, `${where}包含不支持的字段：${extra.join('、')}`);
      const { min, max } = drawable;
      need(isPlain(min) && isPlain(max) && ['x', 'y', 'z'].every(axis => finite(min[axis]) && finite(max[axis])), `${where}需要 {min,max} 两个角`);
      for (const axis of ['x', 'y', 'z']) need(min[axis] < max[axis], `${where}的 ${axis} 轴 min 必须小于 max`);
      need(['x', 'z'].every(axis => Math.abs(min[axis]) <= RENDER_FIELD.half && Math.abs(max[axis]) <= RENDER_FIELD.half), `${where}水平位置超出世界范围（|x|、|z| 必须 ≤ ${RENDER_FIELD.half}）`);
      need(['x', 'y', 'z'].every(axis => min[axis] >= (axis === 'y' ? RENDER_FIELD.minY : -RENDER_FIELD.half) && max[axis] <= (axis === 'y' ? RENDER_FIELD.maxY : RENDER_FIELD.half)), `${where}超出世界范围（高度必须在 ${RENDER_FIELD.minY}–${RENDER_FIELD.maxY} 之间）`);
    }
  });
  return list;
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

// 一个自带测试 = 一次 emit。轨迹里的 commands 就是这一帧产出的 drawable，断言只读它。
async function runRenderTest(extension, test, { createRunner, noop = false } = {}) {
  const source = noop ? { ...extension, code: NOOP_RENDER_CODE } : extension;
  const runner = createRunner(source);
  try {
    await runner.ready;
    const world = { playerHealth: 100, objects: [], inventory: {}, resources: {}, panels: {}, ...structuredClone(test.world) };
    const start = snapshotOf(world);
    const value = await runner.emit({ world, time: test.time, dt: test.dt });
    const drawables = Array.isArray(value) ? value : [];
    const steps = [{
      label: 'emit-1', event: { type: 'extension', targetId: null }, commands: drawables,
      before: start, after: snapshotOf(world), change: { changed: drawables.length > 0, fields: [] },
    }];
    return { trace: buildTrace({ requirement: renderExtensionRequirement(extension.id, extension.version), start, steps, final: steps[0].after }), drawables };
  } finally { runner.dispose?.(); }
}

export async function runRenderSelfTests(extension, { createRunner } = {}) {
  if (typeof createRunner !== 'function') throw Error('渲染扩展的自带测试需要一个沙箱执行器');
  const results = [];
  for (const test of extension.selfTests) {
    const entry = { name: test.name, passed: false, real: null, noop: null, detail: '' };
    try {
      const real = await runRenderTest(extension, test, { createRunner });
      const realReport = evaluateAssertions(test.expect, real.trace);
      entry.real = { passed: realReport.passed, detail: realReport.summary, drawables: real.drawables.map(drawable => drawable.kind) };
      const fake = await runRenderTest(extension, test, { createRunner, noop: true });
      const fakeReport = evaluateAssertions(test.expect, fake.trace);
      entry.noop = { passed: fakeReport.passed, detail: fakeReport.summary };
      if (!realReport.passed) entry.detail = `自带测试没有通过：${realReport.summary}`;
      else if (fakeReport.passed) entry.detail = '自带测试对空实现也通过，证明不了任何事，拒绝装载';
      else { entry.passed = true; entry.detail = '自带测试通过，且空实现会被打红'; }
    } catch (error) { entry.detail = '自带测试执行失败：' + error.message; }
    results.push(entry);
  }
  const failed = results.filter(result => !result.passed);
  return {
    format: 'craftmine.render-selftest/1', passed: failed.length === 0, results,
    summary: failed.length ? `${failed.length} 个自带测试不合格：${failed.map(result => `${result.name}（${result.detail}）`).join('；')}` : `${results.length} 个自带测试全部通过，且都对空实现变红`,
  };
}

export function prepareRenderExtension(input) {
  const extension = validateRenderExtension(input);
  return { format: RENDER_LOAD_FORMAT, extension, hash: renderExtensionDigest(extension), requirement: renderExtensionRequirement(extension.id, extension.version) };
}

export async function stageRenderExtension({ extension: input, createRunner, verifyWorld } = {}) {
  let prepared;
  try { prepared = prepareRenderExtension(input); }
  catch (error) {
    return { format: RENDER_LOAD_FORMAT, status: 'rejected', extension: null, hash: null, requirement: null, selfTests: null, checks: [{ name: '格式', passed: false, detail: error.message }], error: error.message };
  }
  let selfTests;
  try { selfTests = await runRenderSelfTests(prepared.extension, { createRunner }); }
  catch (error) { selfTests = { format: 'craftmine.render-selftest/1', passed: false, results: [], summary: error.message }; }
  const checks = [{ name: '自带测试与反造假', passed: selfTests.passed, detail: selfTests.summary }];
  if (selfTests.passed && typeof verifyWorld === 'function') {
    try {
      const report = await verifyWorld(prepared.extension);
      checks.push({ name: '冻结回归', passed: report?.passed !== false, detail: report?.summary || '冻结回归通过' });
    } catch (error) { checks.push({ name: '冻结回归', passed: false, detail: '冻结回归执行失败：' + error.message }); }
  }
  const failed = checks.filter(check => !check.passed);
  return {
    ...prepared, status: failed.length ? 'rejected' : 'ready', checks,
    error: failed.length ? failed.map(check => check.detail).join('；') : null,
    selfTests,
  };
}

// 注册表语义和玩法扩展一致：启用新版本会把旧版本推进历史，回退必须显式，卸载未装载的必须报错。
export class RenderExtensionRegistry {
  constructor({ createRunner, verifyWorld } = {}) {
    this.createRunner = createRunner;
    this.verifyWorld = verifyWorld;
    this.active = new Map();
    this.history = new Map();
    this.rejected = [];
  }
  get loaded() { return [...this.active.values()]; }
  has(id, version) {
    const found = this.active.get(id);
    return Boolean(found) && (version === undefined || found.version === version);
  }
  async stage(input) {
    const candidate = await stageRenderExtension({ extension: input, createRunner: this.createRunner, verifyWorld: this.verifyWorld });
    if (candidate.status !== 'ready') this.rejected.push({ id: candidate.extension?.id || input?.id || null, version: candidate.extension?.version ?? input?.version ?? null, error: candidate.error });
    return candidate;
  }
  activate(candidate) {
    if (candidate?.status !== 'ready') throw Error('只有通过全部检查的渲染扩展才能启用');
    const id = candidate.extension.id, previous = this.active.get(id) || null;
    if (previous) {
      const list = this.history.get(id) || [];
      list.push(previous);
      this.history.set(id, list.slice(-5));
    }
    this.active.set(id, candidate.extension);
    return {
      format: RENDER_LOAD_FORMAT,
      activated: renderExtensionRequirement(id, candidate.extension.version),
      previous: previous ? renderExtensionRequirement(previous.id, previous.version) : null,
      loaded: this.loaded.map(extension => renderExtensionRequirement(extension.id, extension.version)),
    };
  }
  rollback(id) {
    const list = this.history.get(id) || [];
    const previous = list.pop();
    if (!previous) throw Error(`渲染扩展 ${id} 没有可以回退的历史版本`);
    this.history.set(id, list);
    this.active.set(id, previous);
    return { format: RENDER_LOAD_FORMAT, activated: renderExtensionRequirement(previous.id, previous.version), rolledBack: true };
  }
  unload(id) {
    const extension = this.active.get(id);
    if (!extension) throw Error(`渲染扩展 ${id} 没有装载`);
    this.active.delete(id);
    return { format: RENDER_LOAD_FORMAT, unloaded: renderExtensionRequirement(extension.id, extension.version) };
  }
  report() {
    return {
      format: RENDER_LOAD_FORMAT,
      loaded: this.loaded.map(extension => ({ id: extension.id, version: extension.version, hash: renderExtensionDigest(extension), budgetMs: extension.budgetMs, maxFailures: extension.maxFailures })),
      history: [...this.history.entries()].map(([id, list]) => ({ id, versions: list.map(extension => extension.version) })),
      rejected: this.rejected.slice(-10),
      limits: RENDER_LIMITS,
    };
  }
}
