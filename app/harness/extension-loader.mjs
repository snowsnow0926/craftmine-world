import { evaluateAssertions } from './assertions.mjs';
import { buildTrace } from './trace.mjs';
import { extensionCatalog, extensionDigest, extensionRequirement, validateExtension } from './extension.mjs';
import { EXTENSION_EFFECT_LIMIT } from './extension-effects.mjs';

// 装载流水线：模型提议 → 自带测试 + 反造假 + 冻结回归 → 人一键接受 → 生效或回滚。
// 这里没有一行「相信模型」的逻辑：每一步都是确定性检查，任何一步不过就拒绝。
export const EXTENSION_LOAD_FORMAT = 'craftmine.extension-load/1';
export const NOOP_CODE = 'export function apply({ state }) { return { effects: [], state: state || {} }; }';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// 把内核原子效果落到一个普通世界模型上，让自带测试能检查「玩家看得见的结果」。
export function applyEffects(world, effects = []) {
  const next = structuredClone(world || {});
  next.objects = (next.objects || []).map(object => ({ ...object, position: object.position ? { ...object.position } : object.position }));
  next.inventory = { ...(next.inventory || {}) };
  next.resources = { ...(next.resources || {}) };
  next.panels = { ...(next.panels || {}) };
  for (const effect of effects) {
    const object = effect.id ? next.objects.find(item => item.id === effect.id) : null;
    if (effect.type === 'object.patch' && object) {
      if (effect.position) object.position = { ...effect.position };
      if (effect.visible !== null && effect.visible !== undefined) {
        object.visible = effect.visible;
        if (effect.visible && object.mesh !== undefined) object.mesh = (object.health ?? 0) >= 0;
      }
      if (effect.solid !== null && effect.solid !== undefined) object.solid = effect.solid;
      if (effect.color) object.color = effect.color;
      if (effect.yaw !== null && effect.yaw !== undefined) object.yaw = effect.yaw;
    }
    if (effect.type === 'target.revive' && object) { object.health = object.maxHealth ?? object.health ?? 1; object.visible = true; object.mesh = true; }
    if (effect.type === 'target.damage' && object) {
      object.health = Math.max(0, (object.health || 0) - effect.amount);
      if (object.health === 0) { object.visible = false; object.mesh = false; }
    }
    if (effect.type === 'health.add') next.playerHealth = clamp((next.playerHealth ?? 0) + effect.amount, 0, 10000);
    if (effect.type === 'resource.add' && next.resources[effect.id]) next.resources[effect.id].value = clamp(next.resources[effect.id].value + effect.amount, 0, next.resources[effect.id].max);
    if (effect.type === 'resource.set' && next.resources[effect.id]) next.resources[effect.id].value = clamp(effect.value, 0, next.resources[effect.id].max);
    if (effect.type === 'inventory.add') {
      const total = (next.inventory[effect.item] || 0) + effect.count;
      if (total > 0) next.inventory[effect.item] = total; else delete next.inventory[effect.item];
    }
    if (effect.type === 'hud.panel') {
      if (effect.panel === null) delete next.panels[effect.key]; else next.panels[effect.key] = effect.panel;
    }
  }
  return next;
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
    bounds: object.bounds || null,
  })).sort((a, b) => a.id.localeCompare(b.id)),
  inventory: { ...(world?.inventory || {}) },
  items: { ...(world?.items || {}) },
  resources: structuredClone(world?.resources || {}),
  panels: structuredClone(world?.panels || {}),
  effects: [],
});

async function runCommands(extension, test, { createRunner, noop = false } = {}) {
  const source = noop ? { ...extension, code: NOOP_CODE } : extension;
  const runner = createRunner(source);
  try {
    await runner.ready;
    let world = { playerHealth: 100, objects: [], inventory: {}, resources: {}, panels: {}, ...structuredClone(test.world) };
    let state = structuredClone(test.state || {});
    const start = snapshotOf(world), steps = [];
    for (const [index, command] of test.commands.entries()) {
      const before = snapshotOf(world);
      const result = await runner.apply({ command, world: { objects: world.objects }, state });
      state = result.state;
      world = applyEffects(world, result.effects);
      const after = snapshotOf(world);
      steps.push({ label: `command-${index + 1}`, event: { type: 'extension', targetId: null }, commands: result.effects, before, after, change: { changed: JSON.stringify(before) !== JSON.stringify(after), fields: [] } });
    }
    return { trace: buildTrace({ requirement: extension.id, start, steps, final: steps[steps.length - 1]?.after || start }), effects: steps.flatMap(step => step.commands) };
  } finally { runner.dispose?.(); }
}

export async function runSelfTests(extension, { createRunner } = {}) {
  if (typeof createRunner !== 'function') throw Error('自带测试需要一个沙箱执行器');
  const results = [];
  for (const test of extension.selfTests) {
    const entry = { name: test.name, passed: false, real: null, noop: null, detail: '' };
    try {
      const real = await runCommands(extension, test, { createRunner });
      const realReport = evaluateAssertions(test.expect, real.trace);
      entry.real = { passed: realReport.passed, detail: realReport.summary, effects: real.effects.map(effect => effect.type) };
      const fake = await runCommands(extension, test, { createRunner, noop: true });
      const fakeReport = evaluateAssertions(test.expect, fake.trace);
      entry.noop = { passed: fakeReport.passed, detail: fakeReport.summary };
      if (!realReport.passed) entry.detail = `自带测试没有通过：${realReport.summary}`;
      else if (fakeReport.passed) entry.detail = '自带测试对空实现也通过，证明不了任何事，拒绝装载';
      else { entry.passed = true; entry.detail = '自带测试通过，且空实现会被打红'; }
    } catch (error) { entry.detail = '自带测试执行失败：' + error.message; }
    results.push(entry);
  }
  const failed = results.filter(result => !result.passed);
  return { format: 'craftmine.extension-selftest/1', passed: failed.length === 0, results, summary: failed.length ? `${failed.length} 个自带测试不合格：${failed.map(result => `${result.name}（${result.detail}）`).join('；')}` : `${results.length} 个自带测试全部通过，且都对空实现变红` };
}

export function prepareExtension(input, { loaded = [] } = {}) {
  const extension = validateExtension(input);
  const requirement = extensionRequirement(extension.id, extension.version);
  const types = new Set(extension.provides.commands.map(command => command.type));
  for (const other of loaded) {
    if (other.id === extension.id) continue;
    const clash = other.provides.commands.find(command => types.has(command.type));
    if (clash) throw Error(`扩展命令 ${clash.type} 已经被 ${other.id} 占用`);
  }
  return { format: EXTENSION_LOAD_FORMAT, extension, hash: extensionDigest(extension), requirement };
}

export async function stageExtension(input, { loaded = [], createRunner, verifyWorld, review } = {}) {
  let prepared;
  try { prepared = prepareExtension(input, { loaded }); }
  catch (error) {
    return { format: EXTENSION_LOAD_FORMAT, status: 'rejected', extension: null, hash: null, requirement: null, selfTests: null, checks: [{ name: '格式与命令名冲突', passed: false, detail: error.message }], error: error.message };
  }
  const selfTests = await runSelfTests(prepared.extension, { createRunner });
  const checks = [{ name: '自带测试与反造假', passed: selfTests.passed, detail: selfTests.summary }];
  // 对抗评审是装载流程的必经环节：没有评审，扩展不允许进入候选状态。
  if (typeof review !== 'function') checks.push({ name: '对抗评审', passed: false, detail: '装载扩展必须先过对抗评审（评审只能提出带断言的问题）' });
  else if (selfTests.passed) {
    try {
      const report = await review(prepared.extension);
      const findings = report?.findings || [];
      checks.push({ name: '对抗评审', passed: report?.passed !== false && !(report?.blocked), detail: report?.summary || (findings.length ? `评审提出 ${findings.length} 条问题` : '评审没有提出阻断问题') });
    } catch (error) { checks.push({ name: '对抗评审', passed: false, detail: '对抗评审执行失败：' + error.message }); }
  }
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

export class ExtensionRegistry {
  constructor({ createRunner, verifyWorld, review } = {}) {
    this.createRunner = createRunner;
    this.verifyWorld = verifyWorld;
    this.review = review;
    this.active = new Map();
    this.history = new Map();
    this.rejected = [];
  }
  get loaded() { return [...this.active.values()]; }
  requirement(id, version) { return extensionRequirement(id, version); }
  requirementId(requirement) { return String(requirement || '').replace(/^ext:/, '').split('@')[0]; }
  requirementVersion(requirement) { return Number(String(requirement || '').split('@')[1]); }
  has(requirement) {
    const found = this.active.get(this.requirementId(requirement));
    return Boolean(found) && found.version === this.requirementVersion(requirement);
  }
  // 卸载语义：引用已卸载扩展的模块必须显式失败，不能静默失效。
  require(requirement) {
    if (!this.has(requirement)) throw Error(`扩展没有装载：${requirement}。装载它，或把这个模块的 requires 改掉。`);
    return this.active.get(this.requirementId(requirement));
  }
  dependentsOf(id) {
    return this.loaded.filter(extension => extension.requires.some(requirement => this.requirementId(requirement) === id)).map(extension => extension.id);
  }
  async stage(input) {
    const candidate = await stageExtension(input, { loaded: this.loaded, createRunner: this.createRunner, verifyWorld: this.verifyWorld, review: this.review });
    if (candidate.status !== 'ready') this.rejected.push({ id: candidate.extension?.id || input?.id || null, version: candidate.extension?.version ?? input?.version ?? null, error: candidate.error });
    return candidate;
  }
  activate(candidate) {
    if (candidate?.status !== 'ready') throw Error('只有通过全部检查的扩展才能启用');
    const id = candidate.extension.id, previous = this.active.get(id) || null;
    if (previous) {
      const list = this.history.get(id) || [];
      list.push(previous);
      this.history.set(id, list.slice(-5));
    }
    for (const requirement of candidate.extension.requires) this.require(requirement);
    this.active.set(id, candidate.extension);
    return { format: EXTENSION_LOAD_FORMAT, activated: extensionRequirement(id, candidate.extension.version), previous: previous ? extensionRequirement(previous.id, previous.version) : null, catalog: extensionCatalog(this.loaded) };
  }
  rollback(id) {
    const list = this.history.get(id) || [];
    const previous = list.pop();
    if (!previous) throw Error(`扩展 ${id} 没有可以回退的历史版本`);
    this.history.set(id, list);
    this.active.set(id, previous);
    return { format: EXTENSION_LOAD_FORMAT, activated: extensionRequirement(previous.id, previous.version), rolledBack: true };
  }
  unload(id) {
    const extension = this.active.get(id);
    if (!extension) throw Error(`扩展 ${id} 没有装载`);
    const dependents = this.dependentsOf(id);
    if (dependents.length) throw Error(`不能卸载 ${id}：${dependents.join('、')} 依赖它。先卸载依赖方。`);
    this.active.delete(id);
    return { format: EXTENSION_LOAD_FORMAT, unloaded: extensionRequirement(extension.id, extension.version) };
  }
  catalog() { return extensionCatalog(this.loaded); }
  report() {
    return {
      format: EXTENSION_LOAD_FORMAT,
      loaded: extensionCatalog(this.loaded),
      history: [...this.history.entries()].map(([id, list]) => ({ id, versions: list.map(extension => extension.version) })),
      rejected: this.rejected.slice(-10),
      limits: { code: 12000, effects: EXTENSION_EFFECT_LIMIT },
    };
  }
}
