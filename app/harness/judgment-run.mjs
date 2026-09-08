import fs from 'node:fs';
import path from 'node:path';
import { playwright, browserOptions } from '../browser-tools.mjs';
import { compileScene } from '../scene.mjs';
import { atomicJSON } from '../store.mjs';
import { SCENARIOS } from './scenarios.mjs';
import { REQUIREMENTS, requirementById, requirementsHash } from './requirements.mjs';
import { judgeSet, summarizeJudgments, judgmentSignature, verifyRedness, assertionInventory } from './judge.mjs';
import { buildTrace } from './trace.mjs';

// 跑分器：Node 侧编排（建场景 → 浏览器里跑一遍 → 拿回轨迹 → 裁判判对错 → 指标落盘）。
// 模型只负责提供候选实现，不能参与判定。
export const RUN_FORMAT = 'craftmine.judgment-run/1';

export function scenarioBuild(name, candidate = {}) {
  const spec = SCENARIOS[name];
  if (!spec) throw Error(`没有名为 ${name} 的需求场景`);
  const base = typeof candidate.scene === 'function' ? candidate.scene(spec.scene()) : spec.scene();
  const behaviors = candidate.behaviors || base.behaviors || [];
  return compileScene({ ...base, behaviors });
}

export function scenarioSpec(name) {
  const spec = SCENARIOS[name];
  if (!spec) throw Error(`没有名为 ${name} 的需求场景`);
  return { player: spec.player, events: spec.events, inventory: spec.inventory || {}, gameplay: spec.gameplay || null };
}

export async function recordRequirement({ origin, requirement, candidate, signal, deadline = Date.now() + 60000, browser = null }) {
  if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw Error('缺少本机隔离检查地址');
  const spec = scenarioSpec(requirement.scenario);
  const build = scenarioBuild(requirement.scenario, candidate);
  // 基准面：没有候选实现时的同一个世界，用来区分「候选新增的」和「本来就有的」。
  const baseline = scenarioBuild(requirement.scenario, {});
  const { viewport, ...options } = browserOptions();
  const remaining = Math.max(1, Math.min(60000, deadline - Date.now()));
  const own = !browser;
  let active = browser, timedOut = false, timer;
  const close = () => { if (own) active?.close().catch(() => {}); };
  try {
    timer = setTimeout(() => { timedOut = true; close(); }, remaining);
    if (!active) active = await playwright().chromium.launch({ ...options, timeout: remaining });
    signal?.addEventListener('abort', close, { once: true });
    if (signal?.aborted) throw Error('需求跑分已取消');
    const context = await active.newContext({ viewport });
    await context.addInitScript(() => { Element.prototype.requestPointerLock = () => { throw Error('后台验证禁止鼠标锁定'); }; window.focus = () => {}; });
    const page = await context.newPage();
    await page.goto(origin + '/verify');
    const raw = await page.frameLocator('iframe').locator('body').evaluate(async (_, { build, baseline, scenario, requirement }) => {
      const { recordTrace } = await import('/app/harness/trace-runner.mjs');
      return recordTrace({ build, baseline, scenario, requirement });
    }, { build, baseline, scenario: spec, requirement: requirement.id });
    if (signal?.aborted) throw Error('需求跑分已取消');
    return buildTrace({ ...raw, build: build.hash });
  } catch (error) {
    throw Error(signal?.aborted ? '需求跑分已取消' : timedOut ? `需求「${requirement.said}」的录制超过时限` : `需求「${requirement.said}」录制失败：${error.message}`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', close);
    await close();
  }
}

export async function runRequirementSet({ origin, candidates = {}, requirements = REQUIREMENTS, signal, onResult = () => {}, deadline = Date.now() + 600000 } = {}) {
  const started = Date.now();
  const traces = {}, records = [];
  const { viewport, ...options } = browserOptions();
  let browser = null;
  try {
    browser = await playwright().chromium.launch(options);
    for (const requirement of requirements) {
      const candidate = candidates[requirement.id];
      const attemptStart = Date.now();
      try {
        if (!candidate) throw Error('没有提供候选实现');
        const trace = await recordRequirement({ origin, requirement, candidate, signal, deadline, browser });
        traces[requirement.id] = trace;
        const judged = judgeSet({ traces: { [requirement.id]: trace }, requirements: [requirement] }).items[0];
        const record = {
          requirement: requirement.id, said: requirement.said, passed: judged.passed, firstPass: judged.passed,
          repaired: false, failureClass: judged.passed ? null : 'assertion', durationMs: Date.now() - attemptStart,
          inputTokens: candidate.inputTokens ?? null, outputTokens: candidate.outputTokens ?? null,
          reviewFindings: candidate.reviewFindings ?? 0, summary: judged.summary,
        };
        records.push(record);
        onResult(record, judged);
      } catch (error) {
        const record = {
          requirement: requirement.id, said: requirement.said, passed: false, firstPass: false, repaired: false,
          failureClass: 'recording', durationMs: Date.now() - attemptStart,
          inputTokens: candidate?.inputTokens ?? null, outputTokens: candidate?.outputTokens ?? null,
          reviewFindings: candidate?.reviewFindings ?? 0, summary: error.message,
        };
        records.push(record);
        onResult(record, null);
      }
    }
  } finally {
    await browser?.close().catch(() => {});
  }
  const metrics = summarizeJudgments(records);
  return {
    format: RUN_FORMAT,
    requirementsHash: requirementsHash(requirements),
    started, durationMs: Date.now() - started,
    metrics, signature: judgmentSignature(records), records, traces,
    passed: metrics.passed === metrics.runs && metrics.runs > 0,
  };
}

// 影子运行：同一批候选跑两遍，判定结论必须一致，指标才可信。
export async function shadowRun(options = {}) {
  const first = await runRequirementSet(options);
  const second = await runRequirementSet({ ...options, candidates: options.candidates || {} });
  return {
    format: RUN_FORMAT,
    reproducible: first.signature === second.signature,
    first: { signature: first.signature, metrics: first.metrics },
    second: { signature: second.signature, metrics: second.metrics },
    runs: [first, second],
  };
}

export function judgmentRoot(root) {
  return path.join(root, 'judgment');
}

export function writeJudgment(root, record) {
  const dir = judgmentRoot(root);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date(record.started || Date.now()).toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `${stamp}-${(record.signature || 'run').slice(0, 24).replace(/[^a-z0-9-]/gi, '')}.json`);
  atomicJSON(file, record);
  return file;
}

export function readJudgments(root) {
  const dir = judgmentRoot(root);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(name => name.endsWith('.json')).sort()
    .map(name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));
}

export function judgmentReport(requirements = REQUIREMENTS) {
  return {
    format: 'craftmine.judgment-report/1',
    requirementsHash: requirementsHash(requirements),
    requirements: requirements.map(requirement => ({
      id: requirement.id, index: requirement.index, said: requirement.said, shape: requirement.shape,
      scenario: requirement.scenario, acceptance: requirement.acceptance,
      assertions: requirement.assertions.map(assertion => ({ id: assertion.id, kind: assertion.kind, why: assertion.why, red: assertion.red })),
      reds: requirement.reds || [],
    })),
    inventory: assertionInventory(requirements),
  };
}

export { verifyRedness };
export function requirement(id) { return requirementById(id); }
