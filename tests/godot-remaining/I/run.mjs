#!/usr/bin/env node
// Task I acceptance runner.
//
// Modes:
//   audit   — freeze + coverage + ledger status, no round execution
//   replay  — run frozen assertions against recorded observations (proves the runner)
//   live    — drive the real product model through the product interface contract
//
// It never simulates input, never writes a world itself, and never turns a
// missing dependency into a pass: a blocked round is recorded as 尚未执行 and the
// process exits 3.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadFrozenSpec, roundsOf, indexAssertions, ROOT } from './lib/frozen.mjs';
import { checkCoverage } from './lib/coverage.mjs';
import { scanSources, createInputLedger, assertNoInput } from './lib/input-guard.mjs';
import { captureIdentity, modelIdentityFromEnv } from './lib/identity.mjs';
import { createEvidenceBundle } from './lib/evidence.mjs';
import { evaluateRound, blockedRound } from './lib/verdict.mjs';
import { initialState, refresh, ledgerRows } from './lib/ledger.mjs';
import { buildReport, writeReport } from './lib/report.mjs';
import { loadFixture, replayRound, listFixtures } from './lib/transport/replay.mjs';
import { probeProductInterface, createProductTransport, ProductInterfaceUnavailable, LIVE_COMMAND } from './lib/transport/product-interface.mjs';

const EXIT = { OK: 0, HARD_FAILURE: 1, REFUSED: 2, BLOCKED: 3 };

export function parseArgs(argv) {
  const args = { mode: 'audit', out: null, rounds: [], categories: [], confirmLive: false, fixtures: null, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--mode') args.mode = argv[++index];
    else if (token === '--out') args.out = argv[++index];
    else if (token === '--round') args.rounds.push(argv[++index]);
    else if (token === '--category') args.categories.push(argv[++index]);
    else if (token === '--fixtures') args.fixtures = argv[++index];
    else if (token === '--confirm-live') args.confirmLive = true;
    else if (token === '--json') args.json = true;
    else throw new Error(`unknown argument ${token}`);
  }
  if (!['audit', 'replay', 'live'].includes(args.mode)) throw new Error(`unknown mode ${args.mode}`);
  return args;
}

function selectRounds(rounds, args) {
  return rounds.filter(round =>
    (args.rounds.length === 0 || args.rounds.includes(round.id)) &&
    (args.categories.length === 0 || args.categories.includes(round.categoryId)));
}

async function waitTask(transport, sessionId, taskId, { timeoutMs = 15 * 60 * 1000, intervalMs = 1500 } = {}) {
  const start = Date.now();
  const terminal = ['ready', 'failed', 'cancelled', 'interrupted', 'unchanged', 'discussed'];
  for (;;) {
    const task = await transport.task(sessionId, taskId);
    if (terminal.includes(task.status)) return task;
    if (Date.now() - start > timeoutMs) return { ...task, status: 'timeout' };
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}

async function runLiveRound({ round, transport, evidence, identity }) {
  const session = await transport.openSession(round);
  const started = Date.now();
  const request = await transport.request(session.sessionId, round.prompt);
  const modelCalls = 1;
  const task = await waitTask(transport, session.sessionId, request.taskId);
  evidence.writeJson('task.json', task);
  evidence.usage({ stage: 'creation', source: 'product-interface', ...(task.usage ?? {}) });
  if (task.status !== 'ready') {
    evidence.failure({ stage: 'model-request', message: `task status ${task.status}: ${task.error ?? ''}` });
    return { observation: null, blocked: false, reasons: [`task status ${task.status}`], modelCalls };
  }
  const applied = await transport.apply(session.sessionId, request.taskId);
  evidence.writeJson('apply.json', applied);
  const observation = await transport.observe(session.sessionId, [{ op: 'round-observation', roundId: round.id }]);
  const usage = await transport.usage(session.sessionId).catch(() => null);
  if (usage) {
    evidence.usage({ stage: 'compaction', source: 'product-interface', ...(usage.compaction ?? {}) });
    evidence.usage({ stage: 'review', source: 'product-interface', ...(usage.review ?? {}) });
  }
  evidence.writeJson('observation.json', observation);
  evidence.writeJson('timing.json', { modelAndApplyMs: Date.now() - started });
  await transport.close(session.sessionId).catch(() => null);
  return { observation, blocked: false, reasons: [], modelCalls };
}

export async function runAcceptance({ argv = process.argv.slice(2), env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const args = parseArgs(argv);
  const spec = loadFrozenSpec({ root: ROOT });
  const coverage = checkCoverage(spec);
  const sourceFindings = scanSources(ROOT);
  const inputLedger = createInputLedger();
  const rounds = roundsOf(spec.set);
  const byId = indexAssertions(spec.assertions);
  const selected = selectRounds(rounds, args);

  const outRoot = args.out ? path.resolve(args.out) : path.join(ROOT, '..', '..', '..', 'test-results', `i-acceptance-${Date.now()}`);
  fs.mkdirSync(path.join(outRoot, 'evidence'), { recursive: true });

  const hardStop = [];
  if (!coverage.ok) hardStop.push(...coverage.problems.map(problem => `coverage: ${problem}`));
  if (sourceFindings.length) hardStop.push(...sourceFindings.map(finding => `input-guard: ${finding.file} uses ${finding.rule} (${finding.why})`));
  if (hardStop.length) {
    const report = { format: 'craftmine.i.report/1', generatedAt: new Date().toISOString(), mode: args.mode, refused: true, reasons: hardStop };
    const written = writeReport(outRoot, report);
    return { exitCode: EXIT.REFUSED, report, written };
  }

  let transport = null;
  let probe = { available: false, reason: 'not-probed' };
  if (args.mode === 'live') {
    if (!args.confirmLive) {
      const report = { format: 'craftmine.i.report/1', generatedAt: new Date().toISOString(), mode: 'live', refused: true, reasons: ['live mode requires --confirm-live; it makes real model calls with the user\'s existing quota'] };
      const written = writeReport(outRoot, report);
      return { exitCode: EXIT.REFUSED, report, written };
    }
    probe = await probeProductInterface({ env, fetchImpl });
    if (probe.available) transport = createProductTransport({ baseUrl: env.CRAFTMINE_I_PRODUCT_INTERFACE, token: env.CRAFTMINE_I_PRODUCT_INTERFACE_TOKEN ?? null, fetchImpl });
  }

  const replay = args.mode === 'replay';
  const identity = captureIdentity({
    mode: args.mode,
    product: { version: probe.identity?.product?.version ?? (replay ? 'replay-fixture' : null), clientVersion: probe.identity?.product?.clientVersion ?? (replay ? 'replay-fixture' : null) },
    engine: probe.identity?.engine ?? (replay ? { version: 'replay-fixture' } : {}),
    base: probe.identity?.base ?? (replay ? { version: 'replay-fixture' } : {}),
    project: { treeHash: replay ? 'replay-fixture' : null },
    model: probe.identity?.model ?? (replay ? { provider: 'replay', modelId: 'replay-fixture' } : modelIdentityFromEnv(env)),
    dataDir: outRoot,
    inputLedger,
  });

  const results = [];
  for (const round of selected) {
    if (args.mode === 'audit') {
      results.push({ ...round, roundId: round.id, mode: 'audit', verdict: 'not-run', reasons: ['audit mode does not execute rounds'], assertions: [], hardFailures: [], missingEvidence: [], identityMissing: [], evidenceDir: null, modelCalls: 0 });
      continue;
    }
    // Evidence is opened lazily: a round that produced nothing must not leave a
    // misleading empty evidence directory behind.
    let evidence = null;
    const openEvidence = () => {
      if (!evidence) {
        evidence = createEvidenceBundle({ root: path.join(outRoot, 'evidence'), roundId: round.id, mode: args.mode, identity });
        evidence.writeJson('round.json', { id: round.id, categoryId: round.categoryId, phase: round.phase, prompt: round.prompt, mustObserve: round.mustObserve, blockedBy: round.blockedBy ?? [] });
      }
      return evidence;
    };

    let verdict;
    if (args.mode === 'audit') {
      // handled above
      continue;
    } else if (args.mode === 'replay') {
      const fixturesDir = args.fixtures ?? path.join(ROOT, 'fixtures', 'replay');
      const fixture = loadFixture(fixturesDir, round.id);
      const replayed = replayRound(fixture);
      if (!replayed.observation) {
        verdict = { roundId: round.id, mode: 'replay', verdict: 'not-run', reasons: [`no replay fixture at ${path.join(fixturesDir, `${round.id}.json`)}`], assertions: [], hardFailures: [], missingEvidence: [], identityMissing: [] };
      } else {
        openEvidence();
        const observation = { ...replayed.observation };
        observation.evidence = { screenshots: [], human: [], ...(observation.evidence ?? {}) };
        for (const shot of fixture.screenshots ?? []) {
          const buffer = Buffer.from(shot.base64, 'base64');
          evidence.screenshot(shot.name, buffer);
          observation.evidence.screenshots.push({ assertionId: shot.assertionId, name: shot.name, sha256: crypto.createHash('sha256').update(buffer).digest('hex'), bytes: buffer.length });
        }
        for (const review of fixture.humanReviews ?? []) observation.evidence.human.push(review);
        openEvidence().before(observation.before ?? null);
        evidence.after(observation.after ?? observation);
        evidence.writeJson('observation.json', observation);
        for (const usage of observation.usage ? [observation.usage] : []) evidence.usage({ stage: 'creation', source: 'replay-fixture', ...usage });
        for (const failure of replayed.failures) evidence.failure(failure);
        for (const intervention of replayed.interventions ?? []) evidence.intervention(intervention);
        verdict = evaluateRound({ round, assertions: round.assertions.map(id => byId.get(id)), observation, identity, mode: 'replay' });
      }
    } else {
      if (!transport) {
        verdict = blockedRound({ round, reason: `product interface unavailable: ${probe.reason}`, detail: probe.detail });
        openEvidence().writeJson('blocked.json', { reason: probe.reason, detail: probe.detail ?? null, blockedBy: round.blockedBy ?? [], command: LIVE_COMMAND });
      } else {
        try {
          const live = await runLiveRound({ round, transport, evidence: openEvidence(), identity });
          verdict = live.observation
            ? { ...evaluateRound({ round, assertions: round.assertions.map(id => byId.get(id)), observation: live.observation, identity, mode: 'live' }), modelCalls: live.modelCalls }
            : { roundId: round.id, mode: 'live', verdict: 'failed', reasons: live.reasons, assertions: [], hardFailures: [], missingEvidence: [], identityMissing: [], modelCalls: live.modelCalls };
        } catch (error) {
          const blocked = error instanceof ProductInterfaceUnavailable;
          openEvidence().failure({ stage: 'live-round', message: error.message, class: blocked ? 'product-interface-unavailable' : undefined });
          verdict = blocked
            ? blockedRound({ round, reason: error.message })
            : { roundId: round.id, mode: 'live', verdict: 'failed', reasons: [error.message], assertions: [], hardFailures: [{ class: 'harness-bug', message: error.message }], missingEvidence: [], identityMissing: [] };
        }
      }
    }

    const sealed = evidence ? evidence.finalize({ verdict: verdict.verdict, reasons: verdict.reasons ?? [] }) : null;
    results.push({ ...round, ...verdict, evidenceDir: sealed ? path.relative(outRoot, sealed.dir).split(path.sep).join('/') : null });
  }

  assertNoInput(inputLedger);
  const ledger = initialState(spec.ledgers);
  refresh(ledger, { rounds: results, ledgers: spec.ledgers });

  const metrics = {
    modelCalls: results.reduce((sum, round) => sum + (round.modelCalls ?? 0), 0),
    unknownUsageCalls: results.reduce((sum, round) => sum + (round.unknownUsageCalls ?? 0), 0),
    humanInterventions: results.reduce((sum, round) => sum + (round.failures ?? []).filter(failure => failure.class === 'human-intervention').length, 0),
    replayFixtures: listFixtures(args.fixtures ?? path.join(ROOT, 'fixtures', 'replay')).length,
  };

  const report = buildReport({
    mode: args.mode,
    identity,
    freeze: spec.verdict,
    rounds: results,
    ledger,
    metrics,
    notes: [
      `冻结校验：${spec.verdict.ok ? '通过' : '失败'}；来源文档漂移 ${spec.verdict.changedSources.length} 项。`,
      `覆盖检查：${coverage.categories} 类 / ${coverage.rounds} 轮 / ${coverage.assertions} 条断言。`,
      args.mode === 'replay' ? 'replay 只证明验收器本身；它不构成任何真实模型结论。' : null,
      args.mode === 'live' && !transport ? `产品接口未接通，全部轮次记为尚未执行。待执行命令：${LIVE_COMMAND}` : null,
    ].filter(Boolean),
  });
  const written = writeReport(outRoot, report);
  fs.writeFileSync(path.join(outRoot, 'ledger-state.json'), `${JSON.stringify({ format: 'craftmine.i.ledger-state/1', generatedAt: report.generatedAt, mode: args.mode, freeze: report.freeze, items: ledgerRows(ledger) }, null, 2)}\n`);

  const hardFailed = results.filter(round => round.verdict === 'failed').length;
  const blocked = results.filter(round => round.verdict === 'blocked' || round.verdict === 'not-run').length;
  let exitCode = EXIT.OK;
  if (hardFailed) exitCode = EXIT.HARD_FAILURE;
  else if (args.mode === 'live' && blocked === results.length && results.length) exitCode = EXIT.BLOCKED;

  return { exitCode, report, written, ledgerRows: ledgerRows(ledger), outRoot };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runAcceptance()
    .then(result => {
      const { report } = result;
      if (result.report.refused) console.error(`refused: ${report.reasons.join('; ')}`);
      else {
        const h = report.headline;
        console.log(`mode=${report.mode} rounds=${h.rounds} passed=${h.passed} failed=${h.failed} insufficient=${h.insufficient} notRun=${h.notRun}`);
        console.log(`report: ${result.written.md}`);
        console.log(`json:   ${result.written.json}`);
      }
      process.exitCode = result.exitCode;
    })
    .catch(error => { console.error(error.stack); process.exitCode = EXIT.HARD_FAILURE; });
}
