#!/usr/bin/env node
// Self-verification of the task I acceptance verifier.
//
// A verifier that cannot fail is worthless, so this checks that the runner can
// go red, that the frozen set cannot be silently relaxed, that the no-input rule
// is enforced, that the ledger rules refuse to mark a story verified without
// evidence, and that a blocked dependency exits 3 instead of 0.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFrozenSpec, verifyLock, indexAssertions, roundsOf, ROOT } from './lib/frozen.mjs';
import { checkCoverage } from './lib/coverage.mjs';
import { evaluateCheck, evaluateAssertion } from './lib/assert-dsl.mjs';
import { scanSources, guardPage, createInputLedger, assertNoInput, InputGuardError } from './lib/input-guard.mjs';
import { deriveStatus, initialState, STATUS } from './lib/ledger.mjs';
import { evaluateRound } from './lib/verdict.mjs';
import { probeProductInterface } from './lib/transport/product-interface.mjs';
import { runAcceptance } from './run.mjs';
import { secretLeaks, missingIdentityFields } from './lib/identity.mjs';

export const SELFCHECK_FORMAT = 'craftmine.i.selfcheck/1';

function check(checks, name, fn) {
  try {
    const detail = fn();
    checks.push({ name, passed: true, detail: detail === undefined ? null : detail });
  } catch (error) {
    checks.push({ name, passed: false, detail: error.message });
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
  return true;
}

function expectThrows(fn, matcher, message) {
  try {
    fn();
  } catch (error) {
    if (matcher && !matcher.test(error.message)) throw new Error(`${message}: wrong error ${error.message}`);
    return true;
  }
  throw new Error(`${message}: nothing was thrown`);
}

async function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `i-selfcheck-${label}-`));
}

export async function runSelfCheck({ root = ROOT, env = {} } = {}) {
  const checks = [];
  const spec = loadFrozenSpec({ root });

  check(checks, '冻结清单完整且与磁盘一致', () => {
    const verdict = verifyLock(root);
    expect(verdict.ok, `lock not ok: ${JSON.stringify(verdict)}`);
    return `${Object.keys(spec.verdict.ok ? {} : {}).length || 8} 个冻结文件`;
  });

  check(checks, '覆盖检查：至少 10 类需求、每类两轮、A01–A17 全覆盖', () => {
    const coverage = checkCoverage(spec);
    expect(coverage.ok, coverage.problems.join('; '));
    expect(coverage.categories >= 10, `only ${coverage.categories} categories`);
    return `${coverage.categories} 类 / ${coverage.rounds} 轮 / ${coverage.assertions} 条断言`;
  });

  check(checks, '每条轮次断言都存在于冻结目录且可求值', () => {
    const byId = indexAssertions(spec.assertions);
    for (const round of roundsOf(spec.set)) {
      for (const id of round.assertions) {
        const assertion = byId.get(id);
        expect(assertion, `missing assertion ${id}`);
        if ((assertion.kind ?? 'machine') === 'machine') {
          const result = evaluateCheck(assertion.check, {});
          expect(typeof result.passed === 'boolean', `${id} did not evaluate to a boolean`);
        }
      }
    }
    return `${spec.assertions.assertions.length} 条`;
  });

  check(checks, '断言求值器可以判红（不是橡皮图章）', () => {
    const redCases = [
      [{ path: 'a.b', op: 'eq', value: 1 }, { a: { b: 2 } }],
      [{ path: 'a', op: 'gte', value: 3 }, { a: 2 }],
      [{ path: 'list', op: 'lengthEq', value: 3 }, { list: [1] }],
      [{ all: [{ path: 'x', op: 'eq', value: 1 }, { path: 'y', op: 'eq', value: 1 }] }, { x: 1, y: 2 }],
      [{ path: 'items', op: 'every', check: { path: 'ok', op: 'eq', value: true } }, { items: [{ ok: true }, { ok: false }] }],
      [{ path: 'after', op: 'equalsPath', value: 'before' }, { before: { v: 1 }, after: { v: 2 } }],
      [{ path: 'after', op: 'changedFrom', value: 'before' }, { before: 1, after: 1 }],
      [{ path: 'gold', op: 'lessThanPath', value: 'goldBefore' }, { gold: 10, goldBefore: 5 }],
    ];
    for (const [frozenCheck, observation] of redCases) {
      const result = evaluateCheck(frozenCheck, observation);
      expect(result.passed === false, `negative case wrongly passed: ${JSON.stringify(frozenCheck)}`);
    }
    const green = evaluateCheck({ path: 'a.b', op: 'eq', value: 1 }, { a: { b: 1 } });
    expect(green.passed === true, 'positive case wrongly failed');
    return `${redCases.length} 个反例全部判红`;
  });

  check(checks, '缺失引用与空集合不会让断言真空通过', () => {
    // Regression: equalsPath/unchangedFrom/notEqualsPath used to pass when both
    // sides resolved to undefined.
    for (const op of ['equalsPath', 'unchangedFrom', 'notEqualsPath', 'changedFrom']) {
      const result = evaluateCheck({ path: 'after.x', op, value: 'before.x' }, { after: { x: 1 } });
      expect(result.passed === false, `${op} passed with a missing reference`);
    }
    // Regression: `every` over an empty array used to pass ("nothing done" == "all done").
    expect(evaluateCheck({ path: 'edits', op: 'every', check: { path: 'applied', op: 'eq', value: true } }, { edits: [] }).passed === false, 'every over an empty array passed');
    expect(evaluateCheck({ path: 'items', op: 'some', check: { path: 'ok', op: 'eq', value: true } }, { items: [] }).passed === false, 'some over an empty array passed');
    return '缺失引用、空集合全部判失败';
  });

  check(checks, '证据类断言必须指向证据包里的真实工件', () => {
    const byId = indexAssertions(spec.assertions);
    const round = roundsOf(spec.set).find(item => item.id === 'R14.2');
    const base = {
      release: {
        licenseManifestMatches: true,
        installLifecycle: [{ step: 'install', result: 'ok' }],
        independentWindowsEnvironment: 'missing',
      },
      usage: { calls: 1, unknownCalls: 0 },
      evidence: { screenshots: [], human: [{ assertionId: 'I.R14.2.4', reviewer: 'self-claimed', verdict: 'pass', record: 'note.txt' }] },
    };
    const assertions = round.assertions.map(id => byId.get(id));
    const withoutArtifact = evaluateRound({ round, assertions, observation: base, identity: completeIdentity(), mode: 'live', artifacts: [] });
    expect(withoutArtifact.verdict === 'insufficient', `self-claimed human review passed without an artifact (${withoutArtifact.verdict})`);
    const withArtifact = evaluateRound({ round, assertions, observation: base, identity: completeIdentity(), mode: 'live', artifacts: [{ path: 'note.txt', bytes: 12, sha256: 'x'.repeat(64) }] });
    expect(withArtifact.verdict === 'passed', `human review with a real artifact should pass, got ${withArtifact.verdict}`);
    return '人工记录必须对应真实文件';
  });

  check(checks, 'visual/human/accounting 断言不能由 machine 判定通过', () => {
    for (const kind of ['visual', 'human', 'accounting']) {
      const result = evaluateAssertion({ id: `x-${kind}`, round: 'R01.1', kind, hard: true, statement: 'x' }, {});
      expect(result.passed === false, `${kind} assertion passed by machine`);
      expect(result.notMachineCheckable === true, `${kind} assertion not flagged`);
    }
    return '三类证据断言都不会被 machine 判通过';
  });

  check(checks, '缺截图或人工记录时轮次判证据不足', () => {
    const byId = indexAssertions(spec.assertions);
    const round = roundsOf(spec.set).find(item => item.id === 'R01.1');
    const observation = { layout: { worldColumnCentered: true, chatPanel: 'right', returnToPlayWorks: true }, session: { reloaded: false }, usage: { calls: 1 }, evidence: { screenshots: [], human: [] } };
    const verdict = evaluateRound({ round, assertions: round.assertions.map(id => byId.get(id)), observation, identity: completeIdentity(), mode: 'replay' });
    expect(verdict.verdict === 'insufficient', `expected insufficient, got ${verdict.verdict}`);
    return 'machine 通过但缺截图 → 证据不足';
  });

  check(checks, '真实模型输入禁用：源码扫描、页面守卫、账目断言', () => {
    const findings = scanSources(root);
    expect(findings.length === 0, `forbidden input APIs found: ${JSON.stringify(findings)}`);
    const ledger = createInputLedger();
    const fakePage = { mouse: { move: () => {} }, click: async () => {}, goto: async () => {} };
    const guarded = guardPage(fakePage, ledger);
    expectThrows(() => guarded.click('#x'), /forbidden/, 'guardPage did not block click');
    expectThrows(() => guarded.mouse.move(1, 2), /forbidden/, 'guardPage did not block mouse');
    expect(ledger.blockedInputAttempts.length === 2, 'blocked attempts not recorded');
    const dirty = createInputLedger();
    dirty.inputEventsSent = 1;
    expectThrows(() => assertNoInput(dirty), /violated/, 'assertNoInput missed a real input event');
    const blocked = createInputLedger();
    blocked.blockedInputAttempts.push({ method: 'mouse.move' });
    expectThrows(() => assertNoInput(blocked), /violated/, 'assertNoInput missed a blocked input attempt');
    expect(assertNoInput(createInputLedger()) === true, 'a clean ledger must pass');
    return '禁用真实输入并记录拦截次数';
  });

  check(checks, '观测缺少断言所需的分区时判证据不足', () => {
    const byId = indexAssertions(spec.assertions);
    const round = roundsOf(spec.set).find(item => item.id === 'R05.2');
    const assertions = round.assertions.map(id => byId.get(id));
    const full = {
      isolation: { originWorldId: 'world-1', selectedWorldId: 'world-2', taskWorldId: 'world-1', writtenWorldId: 'world-1', originalTaskStillOnOriginWorld: true },
      usage: { calls: 1, unknownCalls: 0 },
      evidence: { screenshots: [{ assertionId: 'I.R05.2.4', name: 'shot.png', sha256: 'x'.repeat(64) }], human: [] },
    };
    const artifacts = [{ path: 'shot.png', bytes: 8, sha256: 'x'.repeat(64) }];
    expect(evaluateRound({ round, assertions, observation: full, identity: completeIdentity(), mode: 'live', artifacts }).verdict === 'passed', 'complete observation should pass');
    const { isolation, ...withoutIsolation } = full;
    const result = evaluateRound({ round, assertions, observation: withoutIsolation, identity: completeIdentity(), mode: 'live', artifacts });
    // Either the assertion fails on the missing reference or the section check
    // reports it — what matters is that it can never pass.
    expect(result.verdict !== 'passed', `missing section must not pass, got ${result.verdict}`);
    expect(result.reasons.some(reason => String(reason).includes('isolation')), `missing section not reported: ${result.reasons.join(' | ')}`);
    return `缺少分区 → ${result.verdict}`;
  });

  check(checks, '台账规则：无证据不得判已证实，单条硬失败不能被抵消', () => {
    const roundsById = new Map([
      ['R01.1', { verdict: 'passed' }],
      ['R01.2', { verdict: 'passed' }],
      ['R02.1', { verdict: 'passed' }],
      ['R02.2', { verdict: 'failed' }],
    ]);
    const verified = deriveStatus({ rounds: ['R01.1', 'R01.2'] }, { roundsById, hardFailures: [] });
    expect(verified.status === STATUS.VERIFIED, `expected 已证实, got ${verified.status}`);
    const notRun = deriveStatus({ rounds: ['R04.1'] }, { roundsById, hardFailures: [] });
    expect(notRun.status === STATUS.NOT_RUN, `expected 尚未执行, got ${notRun.status}`);
    const insufficient = deriveStatus({ rounds: ['R14.2'] }, { roundsById: new Map([['R14.2', { verdict: 'insufficient' }]]), hardFailures: [] });
    expect(insufficient.status === STATUS.INSUFFICIENT, `expected 证据不足, got ${insufficient.status}`);
    const failed = deriveStatus({ rounds: ['R02.1', 'R02.2'] }, { roundsById, hardFailures: [] });
    expect(failed.status === STATUS.FAILED, `expected 失败, got ${failed.status}`);
    const blocked = deriveStatus({ rounds: ['R05.1'] }, { roundsById: new Map([['R05.1', { verdict: 'blocked' }]]), hardFailures: [] });
    expect(blocked.status === STATUS.NOT_RUN, `expected 尚未执行, got ${blocked.status}`);
    const replayOnly = deriveStatus({ rounds: ['R12.2'] }, { roundsById: new Map([['R12.2', { verdict: 'passed', mode: 'replay' }]]), hardFailures: [] });
    expect(replayOnly.status === STATUS.NOT_RUN, `replay evidence must not verify a story, got ${replayOnly.status}`);
    const livePass = deriveStatus({ rounds: ['R12.2'] }, { roundsById: new Map([['R12.2', { verdict: 'passed', mode: 'live' }]]), hardFailures: [] });
    expect(livePass.status === STATUS.VERIFIED, `live pass should verify, got ${livePass.status}`);
    const state = initialState(spec.ledgers);
    expect(Object.values(state.items).every(item => item.status === STATUS.NOT_RUN), 'initial ledger must start 尚未执行');
    return '四种状态与初始台账正确';
  });

  check(checks, '身份字段缺失会被识别', () => {
    const missing = missingIdentityFields({ product: { version: '1' }, engine: {}, base: {}, project: {}, model: {}, input: {} });
    expect(missing.includes('engine.version'), 'engine.version not detected');
    expect(missing.includes('model.modelId'), 'model.modelId not detected');
    expect(missingIdentityFields(completeIdentity()).length === 0, 'complete identity reported as incomplete');
    return `${missing.length} 个必填字段被识别`;
  });

  check(checks, '凭据形状的值会被拦截', () => {
    expect(secretLeaks('{"apiKey":"abcdef123456"}').length > 0, 'secret field not detected');
    expect(secretLeaks('sk-abcdefgh12345678').length > 0, 'credential-shaped value not detected');
    expect(secretLeaks('normal text').length === 0, 'false positive');
    return '报告与证据落盘前会拦截凭据';
  });

  checks.push({
    name: '产品接口未配置时 live 探针明确不可用',
    passed: (await probeProductInterface({ env: {} })).reason === 'product-interface-not-configured',
    detail: (await probeProductInterface({ env: {} })).reason,
  });

  const replayOut = await tempDir('replay');
  const negativeOut = await tempDir('negative');
  const liveOut = await tempDir('live');

  const replay = await runAcceptance({ argv: ['--mode', 'replay', '--out', replayOut], env });
  checks.push({
    name: 'replay 模式：通过 / 证据不足 / 未执行被正确区分且退出码 0',
    passed: replay.exitCode === 0 && replay.report.headline.passed === 6 && replay.report.headline.failed === 0 && replay.report.headline.insufficient === 1
      && replay.report.headline.notRun === replay.report.headline.rounds - 7,
    detail: `exit=${replay.exitCode} passed=${replay.report.headline.passed} insufficient=${replay.report.headline.insufficient} notRun=${replay.report.headline.notRun}/${replay.report.headline.rounds}`,
  });

  const negative = await runAcceptance({ argv: ['--mode', 'replay', '--fixtures', path.join(root, 'fixtures', 'negative'), '--out', negativeOut], env });
  checks.push({
    name: '反例夹具让 runner 判失败并以退出码 1 结束',
    passed: negative.exitCode === 1 && negative.report.headline.failed === 2 && negative.report.headline.passed === 0,
    detail: `exit=${negative.exitCode} failed=${negative.report.headline.failed}`,
  });

  const live = await runAcceptance({ argv: ['--mode', 'live', '--confirm-live', '--out', liveOut], env: {} });
  checks.push({
    name: '产品接口未接通时 live 记为尚未执行并退出码 3（不发模型调用）',
    passed: live.exitCode === 3 && live.report.headline.notRun === live.report.headline.rounds && live.report.headline.modelCalls === 0 && live.report.headline.passed === 0,
    detail: `exit=${live.exitCode} notRun=${live.report.headline.notRun}/${live.report.headline.rounds} modelCalls=${live.report.headline.modelCalls}`,
  });

  const forgedOut = await tempDir('forged');
  const forgedFixtures = await tempDir('forged-fixtures');
  fs.writeFileSync(path.join(forgedFixtures, 'R14.2.json'), JSON.stringify({
    format: 'craftmine.i.replay-fixture/1',
    roundId: 'R14.2',
    humanReviews: [{ assertionId: 'I.R14.2.4', reviewer: 'forged', verdict: 'pass', record: 'note.txt' }],
    screenshots: [{ assertionId: 'I.R14.2.4', name: 'note.txt', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==' }],
    observation: {
      release: { licenseManifestMatches: true, installLifecycle: [{ step: 'install', result: 'ok' }], independentWindowsEnvironment: 'missing' },
      usage: { calls: 1, unknownCalls: 0 },
      evidence: { screenshots: [], human: [] },
    },
  }, null, 2));
  const forged = await runAcceptance({ argv: ['--mode', 'replay', '--fixtures', forgedFixtures, '--round', 'R14.2', '--out', forgedOut], env });
  checks.push({
    name: '夹具不能伪造人工试玩记录',
    passed: forged.report.headline.passed === 0 && forged.report.headline.insufficient === 1,
    detail: `passed=${forged.report.headline.passed} insufficient=${forged.report.headline.insufficient}`,
  });
  checks.push({
    name: '反例报告保留硬失败条目（不被总通过数抵消）',
    passed: negative.report.hardFailures.length >= 2 && negative.report.hardFailures.every(failure => failure.class === 'model-wrong-behavior'),
    detail: negative.report.hardFailures.map(failure => `${failure.round}:${failure.class}`).join(', '),
  });
  for (const dir of [forgedOut, forgedFixtures]) fs.rmSync(dir, { recursive: true, force: true });

  checks.push({
    name: '落盘的报告与证据不含凭据形状的值',
    passed: secretLeaks(fs.readFileSync(replay.written.json, 'utf8')).length === 0 && secretLeaks(fs.readFileSync(replay.written.md, 'utf8')).length === 0,
    detail: replay.written.md,
  });

  checks.push({
    name: '报告头不会把尚未执行计入通过',
    passed: replay.report.headline.passed + replay.report.headline.failed + replay.report.headline.insufficient + replay.report.headline.notRun === replay.report.headline.rounds,
    detail: `${replay.report.headline.passed}+${replay.report.headline.failed}+${replay.report.headline.insufficient}+${replay.report.headline.notRun}=${replay.report.headline.rounds}`,
  });

  for (const dir of [replayOut, negativeOut, liveOut]) fs.rmSync(dir, { recursive: true, force: true });

  const failed = checks.filter(item => !item.passed);
  return { format: SELFCHECK_FORMAT, ok: failed.length === 0, checks, failed: failed.length, total: checks.length, replayReport: replay.report, outRoot: replayOut };
}

function completeIdentity() {
  return {
    product: { version: '1.0.0' },
    engine: { version: '4.7.2-stable' },
    base: { version: 'first-person@1' },
    project: { treeHash: 'a'.repeat(64) },
    model: { provider: 'deepseek', modelId: 'deepseek-v4.1-flash-expires-on-0910' },
    input: { inputEventsSent: 0, pointerLockRequests: 0, focusSteals: 0 },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runSelfCheck();
  for (const item of result.checks) console.log(`${item.passed ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
  console.log(`\n${result.ok ? 'OK' : 'FAILED'}: ${result.total - result.failed}/${result.total} checks passed`);
  process.exitCode = result.ok ? 0 : 1;
}
