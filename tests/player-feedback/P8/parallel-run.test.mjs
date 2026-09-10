import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { p8Authorization, p8Cases, p8CaseSelection, stripCaseArgument, P8_CASE_IDS } from './authorization.mjs';
import { readLedgerSummary, admissionAccounting, JOURNAL_FILE, JOURNAL_ENV, LEGACY_JOURNAL_ENV, PHASE_ONE_ADMISSIONS } from './ledger.mjs';
import { openRequestJournal } from './evidence.mjs';
import { MODEL, ENDPOINT } from './relay.mjs';
import { summarizeRun, summarizeCase, CASE_PIPELINE_COMPLETE } from './run-outcome.mjs';
import { evaluateGameplay } from './gameplay-criteria.mjs';
import { mergeReview, REVIEW_FORMAT } from './review-merge.mjs';
import { dogExercise, dogSource } from './gameplay-fixtures.mjs';

// Offline verification for the parallel acceptance driver: explicit case
// selection over argv and environment, one journal per run with a single owner,
// refusal of any journal path outside this checkout's own output, honest
// cumulative accounting that leaves the history byte-identical, and the real
// loop-exit predicate.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const source = fs.readFileSync(new URL('./client-native.mjs', import.meta.url), 'utf8');
fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
const out = fs.mkdtempSync(path.join(root, 'test-results/p8-parallel-'));
const parallel = { CRAFTMINE_P8_AUTHORIZATION_PHASE: 'parallel-20260910' };
const runDir = () => fs.mkdtempSync(path.join(out, 'run-'));
const attempt = id => ({ id, endpoint: ENDPOINT, requestedModel: MODEL });
const historicalPath = path.join(path.dirname(root), 'p8-unlimited-20260910.ndjson');
const inside = name => { const directory = path.join(root, 'test-results', name); fs.mkdirSync(directory, { recursive: true }); return directory; };
test('case selection is explicit on argv and in the environment, and refuses a mixed request', () => {
  assert.deepEqual(p8Cases({}), ['hammer', 'dog']);
  assert.deepEqual(p8Cases({ CRAFTMINE_P8_CASES: 'hammer' }), ['hammer']);
  assert.deepEqual(p8Cases({ CRAFTMINE_P8_CASE: 'hammer' }), ['hammer']);
  assert.deepEqual(p8Cases({ CRAFTMINE_P8_CASES: ' hammer , dog ' }), ['hammer', 'dog']);
  assert.deepEqual(p8CaseSelection({ argv: ['--case', 'dog'] }).cases, ['dog']);
  assert.deepEqual(p8CaseSelection({ argv: ['--case=dog', '--source-root', 'x'] }).cases, ['dog']);
  assert.equal(p8CaseSelection({ argv: ['--case', 'dog'] }).source, '--case');
  for (const bad of ['', ' ', 'cat', 'hammer,hammer', 'hammer,dog,cat', 'hammer,', 7, ['hammer']]) assert.throws(() => p8Cases({ CRAFTMINE_P8_CASES: bad }), /P8_INVALID_CASE_SELECTION/);
  assert.throws(() => p8CaseSelection({ argv: ['--case', 'hammer'], env: { CRAFTMINE_P8_CASE: 'dog' } }), /P8_AMBIGUOUS_CASE_SELECTION/);
  assert.throws(() => p8CaseSelection({ argv: ['--case', 'hammer'], env: { CRAFTMINE_P8_CASES: 'dog' } }), /P8_AMBIGUOUS_CASE_SELECTION/);
  assert.throws(() => p8CaseSelection({ argv: ['--case', 'hammer', '--case', 'dog'] }), /P8_AMBIGUOUS_CASE_SELECTION/);
  assert.throws(() => p8CaseSelection({ argv: ['--case'] }), /P8_INVALID_CASE_SELECTION/);
});

test('a completed single case is a single-case pass and never a two-case pass', () => {
  const verdict = over => ({ format: 'craftmine.p8-gameplay-verdict/1', criteria: [], machineVerified: true, failed: [], insufficient: [], reviewRequired: [], verified: true, ...over });
  const complete = { caseId: 'hammer', outcome: CASE_PIPELINE_COMPLETE, restart: { passed: true }, gameplay: { verdict: verdict({}) } };
  const failedVerdict = { caseId: 'hammer', outcome: CASE_PIPELINE_COMPLETE, restart: { passed: true }, gameplay: { verdict: verdict({ machineVerified: false, verified: false, failed: ['pickup-actual'] }) } };
  const one = summarizeRun({ requestedCases: ['hammer'], executedCases: ['hammer'], cases: [complete] });
  assert.equal(one.pipelinePassed, true); assert.equal(one.behaviorVerified, true);
  assert.equal(one.singleCasePassed, true); assert.equal(one.combinedTwoCasePassed, false);
  assert.equal(one.passed, false); assert.equal(one.reviewRequired, true);
  const missing = summarizeRun({ requestedCases: ['hammer', 'dog'], executedCases: ['hammer'], cases: [complete] });
  assert.equal(missing.pipelinePassed, false); assert.equal(missing.singleCasePassed, false); assert.equal(missing.combinedTwoCasePassed, false);
  const stopped = summarizeRun({ requestedCases: ['hammer'], executedCases: ['hammer'], cases: [complete], stopped: true });
  assert.equal(stopped.pipelinePassed, false); assert.equal(stopped.singleCasePassed, false);
  const unverified = summarizeRun({ requestedCases: ['hammer'], executedCases: ['hammer'], cases: [failedVerdict] });
  assert.equal(unverified.pipelinePassed, true, 'the pipeline is reported separately from the behaviour');
  assert.equal(unverified.behaviorVerified, false); assert.equal(unverified.singleCasePassed, false);
  assert.deepEqual(unverified.gameplayFailed, ['hammer:pickup-actual'], 'the real failure is kept in the summary');
  const both = summarizeRun({ requestedCases: ['hammer', 'dog'], executedCases: ['hammer', 'dog'], cases: [complete, { ...complete, caseId: 'dog' }] });
  assert.equal(both.combinedTwoCasePassed, true); assert.equal(both.singleCasePassed, false); assert.equal(both.passed, false);
});

test('the summary reads the gameplay verdict the driver really writes', () => {
  // The real evaluateGameplay output, not a hand-written shape: the old bug was
  // that summarizeCase read item.gameplay.* while the driver writes
  // item.gameplay.verdict.*, so every failure silently became an empty list.
  const real = evaluateGameplay({ caseId: 'dog', exercise: { actions: [] }, source: [] });
  assert.ok(real.failed.length > 0 && real.criterion === undefined, 'the fixture must be a real verdict');
  assert.ok(Array.isArray(real.criteria) && real.criteria.length > 0);
  const item = verdict => ({ caseId: 'dog', worldId: 'world-dog', outcome: CASE_PIPELINE_COMPLETE, restart: { passed: true }, gameplay: { verdict } });
  const summary = summarizeRun({ requestedCases: ['dog'], executedCases: ['dog'], cases: [item(real)] });
  assert.deepEqual(summary.perCase[0].gameplayFailed, real.failed, 'real failures must survive the summary');
  assert.deepEqual(summary.perCase[0].gameplayInsufficient, real.insufficient);
  assert.deepEqual(summary.perCase[0].gameplayReviewRequired, real.reviewRequired);
  assert.deepEqual(summary.gameplayFailed, real.failed.map(id => 'dog:' + id));
  assert.deepEqual(summary.reviewRequiredItems, real.reviewRequired.map(id => 'dog:' + id));
  assert.equal(summary.pendingReview, real.reviewRequired.length > 0);
  assert.equal(summary.perCase[0].behaviorVerified, false);
  // The pipeline and the behaviour are separate statements, and the note says so.
  assert.equal(summary.pipelinePassed, true);
  assert.equal(summary.behaviorVerified, false);
  assert.equal(summary.singleCasePassed, false);
  assert.match(summary.note, /never the gameplay verdict/);
  assert.match(summary.note, /behaviorVerified requires pipelinePassed/);
  assert.equal(summarizeCase({ caseId: 'dog', outcome: 'running' }).behaviorVerified, false);
});

test('a reviewed real verdict reaches the summary without raising the pipeline', () => {
  const verdict = evaluateGameplay({ caseId: 'dog', exercise: dogExercise(), source: dogSource });
  assert.deepEqual(verdict.failed, []);
  assert.equal(verdict.verified, false, 'the deferred visual claims keep it unverified on its own');
  const frames = verdict.criteria.find(row => row.id === 'dog-visible-in-frames').evidence.evidence;
  const cited = frames[0].file;
  const report = {
    format: 'craftmine.p8-client/1', runId: 'run-1', passed: false, error: null, shutdownError: null, stopped: false, launches: [], steps: [], cases: [
      { caseId: 'dog', worldId: 'world-dog', outcome: CASE_PIPELINE_COMPLETE, restart: { passed: true }, error: null, gameplay: { verdict } },
    ],
    summary: { caseSelection: { requested: ['dog'], executed: ['dog'], requestedCount: 1, executedCount: 1 }, pipelinePassed: true, behaviorVerified: false },
  };
  const review = { format: REVIEW_FORMAT, reviewer: 'P6', runId: 'run-1', cases: [{ caseId: 'dog', verdicts: [
    { id: 'dog-visible-in-frames', verdict: 'confirmed', evidence: [cited] },
    { id: 'dog-stop-not-continuing', verdict: 'confirmed', evidence: [verdict.criteria.find(row => row.id === 'dog-stop-not-continuing').evidence.frames[0].sha256] },
  ] }] };
  const merged = mergeReview({ report, review, reviewSha256: 'c'.repeat(64) });
  assert.equal(merged.passed, false);
  assert.equal(merged.summary.pipelinePassed, true, 'a merge never raises or lowers the pipeline verdict');
  assert.equal(merged.summary.verifiedAfterReview, true);
  const after = summarizeRun({ requestedCases: ['dog'], executedCases: ['dog'], cases: merged.cases });
  assert.equal(after.behaviorVerified, true);
  assert.equal(after.singleCasePassed, true);
  assert.equal(after.passed, false, 'even a fully reviewed case is not a product acceptance');
  assert.deepEqual(after.gameplayFailed, []);
});

test('the driver owns --case and leaves the generic argument parser untouched', () => {
  const { argv, value } = stripCaseArgument(['--source-root', 'D:/x', '--case', 'dog', '--deps-app', 'D:/y']);
  assert.equal(value, 'dog'); assert.deepEqual(argv, ['--source-root', 'D:/x', '--deps-app', 'D:/y']);
  assert.deepEqual(stripCaseArgument(['--source-root', 'D:/x']), { argv: ['--source-root', 'D:/x'], value: undefined });
  assert.ok(source.includes('const driverArgv = process.argv.slice(2), { argv: parameterArgv } = stripCaseArgument(driverArgv);'));
  assert.ok(source.includes('parameterClientArguments(parameterArgv)'), 'the generic parser must receive only its own flags');
  const parser = fs.readFileSync(path.join(root, 'tests/plan-loop/parameter-client-package.mjs'), 'utf8');
  assert.ok(!parser.includes('--case'), 'the generic parser must not learn this driver flag');
});


test('two parallel runs own one fresh journal each and a journal has a single owner', () => {
  const a = p8Authorization(parallel, root, { out: runDir() }), b = p8Authorization(parallel, root, { out: runDir() });
  assert.equal(a.requestLimit, null); assert.equal(b.requestLimit, null); assert.equal(a.mode, 'run');
  assert.notEqual(a.journalPath, b.journalPath);
  assert.ok(a.journalPath.endsWith(path.join('journal', JOURNAL_FILE)));
  assert.equal(a.ownership.lockFile, a.journalPath + '.lock');
  const first = openRequestJournal(a.journalPath, { requestLimit: null }), second = openRequestJournal(b.journalPath, { requestLimit: null });
  try {
    assert.throws(() => openRequestJournal(a.journalPath, { requestLimit: null }), /EEXIST/);
    first.reserve(attempt(1), 'hammer', out); second.reserve(attempt(1), 'dog', out);
    assert.deepEqual(readLedgerSummary(a.journalPath).cases, { hammer: 1, dog: 0 });
    assert.deepEqual(readLedgerSummary(b.journalPath).cases, { hammer: 0, dog: 1 });
  } finally { first.close(); second.close(); }
  const reopened = openRequestJournal(b.journalPath, { requestLimit: null });
  try { assert.equal(reopened.initialAttempts.length, 1); reopened.reserve(attempt(2), 'dog', out); assert.equal(reopened.entries.length, 2); }
  finally { reopened.close(); }
});

test('a named journal may be a file or a directory, inside this checkout only', () => {
  const run = runDir();
  const directory = inside('p8-journal-dir-' + path.basename(run));
  const byDirectory = p8Authorization({ ...parallel, [JOURNAL_ENV]: directory }, root, { out: run });
  assert.equal(byDirectory.mode, 'journal-directory');
  assert.equal(byDirectory.journalPath, path.join(fs.realpathSync(directory), JOURNAL_FILE));
  const file = path.join(inside('p8-journal-file-' + path.basename(run)), 'p5-hammer.ndjson');
  fs.writeFileSync(file, '');
  const byFile = p8Authorization({ ...parallel, [JOURNAL_ENV]: file }, root, { out: run });
  assert.equal(byFile.mode, 'journal-file'); assert.equal(byFile.journalPath, fs.realpathSync(file));
  // A named journal is appendable: a second run continues it instead of resetting it.
  const journal = openRequestJournal(byFile.journalPath, { requestLimit: null });
  try { journal.reserve(attempt(1), 'hammer', out); } finally { journal.close(); }
  const again = p8Authorization({ ...parallel, [JOURNAL_ENV]: file }, root, { out: run });
  assert.equal(readLedgerSummary(again.journalPath).entries, 1);
  for (const bad of [path.dirname(root), path.join(root, 'vendor'), 'relative-journal.ndjson', path.join(root, 'test-results', 'p8-absent-journal-dir')]) {
    assert.throws(() => p8Authorization({ ...parallel, [JOURNAL_ENV]: bad }, root, { out: run }), /P8_JOURNAL_(PATH|ABSOLUTE)/, String(bad));
  }
  const plainFile = path.join(inside('p8-journal-not-ndjson-' + path.basename(run)), 'notes.txt');
  fs.writeFileSync(plainFile, '');
  assert.throws(() => p8Authorization({ ...parallel, [JOURNAL_ENV]: plainFile }, root, { out: run }), /P8_JOURNAL_FILE_REQUIRED/);
});

test('the historical journal and a held lock are both refused', () => {
  const run = runDir();
  assert.throws(() => p8Authorization({ ...parallel, [JOURNAL_ENV]: historicalPath }, root, { out: run }), /P8_JOURNAL_IS_HISTORICAL/);
  const locked = path.join(inside('p8-journal-locked-' + path.basename(run)), 'journal.ndjson');
  fs.writeFileSync(locked, ''); fs.writeFileSync(locked + '.lock', '{}');
  assert.throws(() => p8Authorization({ ...parallel, [JOURNAL_ENV]: locked }, root, { out: run }), /P8_JOURNAL_LOCK_HELD/);
  fs.unlinkSync(locked + '.lock');
  assert.equal(p8Authorization({ ...parallel, [JOURNAL_ENV]: locked }, root, { out: run }).mode, 'journal-file');
});

test('the retired journal variable is refused instead of silently honoured', () => {
  assert.throws(() => p8Authorization({ ...parallel, [LEGACY_JOURNAL_ENV]: 'run' }, root, { out: runDir() }), new RegExp(LEGACY_JOURNAL_ENV + ' was renamed to ' + JOURNAL_ENV));
  assert.equal(LEGACY_JOURNAL_ENV, 'CRAFTMINE_P8_LEDGER'); assert.equal(JOURNAL_ENV, 'CRAFTMINE_P8_JOURNAL');
});

test('a journal setting needs the parallel phase and the legacy phases keep theirs', () => {
  assert.throws(() => p8Authorization({ [JOURNAL_ENV]: 'run' }, root, { out: runDir() }), /P8_JOURNAL_PHASE_REQUIRED/);
  assert.throws(() => p8Authorization({ CRAFTMINE_P8_AUTHORIZATION_PHASE: 'unlimited-20260910', [JOURNAL_ENV]: 'run' }, root, { out: runDir() }), /P8_JOURNAL_PHASE_REQUIRED/);
  assert.throws(() => p8Authorization({ CRAFTMINE_P8_AUTHORIZATION_PHASE: 'parallel-20260910' }, root, {}), /P8_JOURNAL_OUTPUT_REQUIRED/);
  assert.throws(() => p8Authorization({ CRAFTMINE_P8_AUTHORIZATION_PHASE: 'invented' }, root, { out: runDir() }), /P8_UNKNOWN_AUTHORIZATION_PHASE/);
  const legacy = p8Authorization({ CRAFTMINE_P8_AUTHORIZATION_PHASE: 'unlimited-20260910' }, root, { out: runDir() });
  assert.equal(legacy.requestLimit, null); assert.equal(legacy.previousPhaseAdmissions, 50); assert.equal(legacy.journalPath, historicalPath);
  assert.equal(p8Authorization({}, root, { out: runDir() }).requestLimit, 16);
});

test('admissions separate this run from history and the history stays byte-identical', () => {
  const before = readLedgerSummary(historicalPath);
  const authorization = p8Authorization(parallel, root, { out: runDir() });
  assert.equal(authorization.historicalTotal, before.exists ? before.entries : 0);
  assert.equal(authorization.historical.some(item => item.path === historicalPath), before.exists);
  assert.equal(authorization.historical.some(item => item.path === authorization.journalPath), false, 'a run never counts its own journal as history');
  const journal = openRequestJournal(authorization.journalPath, { requestLimit: null });
  try {
    for (let index = 0; index < 3; index++) journal.reserve(attempt(index + 1), index === 0 ? 'hammer' : 'dog', out);
    const accounting = admissionAccounting({ authorization, initialInLedger: journal.initialAttempts.length, thisRun: 3 });
    assert.equal(accounting.priorInThisLedger, 0); assert.equal(accounting.thisRun, 3);
    // The vocabulary P5/P6/P0 already agreed on, and it adds up.
    assert.equal(accounting.priorAdmissions, before.exists ? before.entries : 0);
    assert.equal(accounting.newAdmissions, 3);
    assert.equal(accounting.phaseOneAdmissions, PHASE_ONE_ADMISSIONS);
    assert.equal(accounting.cumulativeAdmissions, PHASE_ONE_ADMISSIONS + (before.exists ? before.entries : 0) + 3);
    assert.equal(accounting.total, accounting.cumulativeAdmissions);
    const second = admissionAccounting({ authorization, initialInLedger: readLedgerSummary(authorization.journalPath).entries, thisRun: 1 });
    assert.equal(second.priorInThisLedger, 3); assert.equal(second.newAdmissions, 1);
    assert.equal(second.cumulativeAdmissions, PHASE_ONE_ADMISSIONS + (before.exists ? before.entries : 0) + 4);
  } finally { journal.close(); }
  const after = readLedgerSummary(historicalPath);
  assert.equal(after.entries, before.entries); assert.equal(after.sha256, before.sha256);
});

test('the legacy shared journal keeps positional admissions and is never rewritten', () => {
  const before = readLedgerSummary(historicalPath);
  const legacy = p8Authorization({ CRAFTMINE_P8_AUTHORIZATION_PHASE: 'unlimited-20260910' }, root, { out: runDir() });
  const journal = openRequestJournal(legacy.journalPath, { requestLimit: null });
  try {
    assert.equal(journal.entries.length, before.entries);
    const accounting = admissionAccounting({ authorization: legacy, initialInLedger: journal.initialAttempts.length, thisRun: 0 });
    assert.equal(accounting.declaredEarlierPhases, 50); assert.equal(accounting.priorAdmissions, 50);
    assert.equal(accounting.cumulativeAdmissions, 50 + (before.exists ? before.entries : 0));
  } finally { journal.close(); }
  assert.equal(readLedgerSummary(historicalPath).sha256, before.sha256);
});

test('an incomplete or foreign journal fails closed instead of being counted', () => {
  const directory = fs.mkdtempSync(path.join(out, 'historical-'));
  const broken = path.join(directory, 'requests.ndjson');
  fs.writeFileSync(broken, JSON.stringify({ format: 'craftmine.p8-admission/1', attempt: attempt(1), caseId: 'hammer' }));
  assert.throws(() => readLedgerSummary(broken), /P8_INCOMPLETE_JOURNAL/);
  fs.writeFileSync(broken, JSON.stringify({ format: 'craftmine.p8-admission/1', attempt: attempt(2), caseId: 'hammer' }) + '\n');
  assert.throws(() => readLedgerSummary(broken), /P8_JOURNAL_ADMISSION_ORDER/);
  fs.writeFileSync(broken, JSON.stringify({ format: 'craftmine.p8-admission/1', attempt: attempt(1), caseId: 'cat' }) + '\n');
  assert.throws(() => readLedgerSummary(broken), /P8_JOURNAL_IDENTITY_MISMATCH/);
  assert.deepEqual(readLedgerSummary(path.join(directory, 'absent.ndjson')), { path: path.join(directory, 'absent.ndjson'), exists: false, entries: 0, cases: { hammer: 0, dog: 0 }, bytes: 0, sha256: null });
});

test('the real loop-exit predicate stops on a stop, a failure or a client exit', async () => {
  const line = source.split('\n').find(entry => entry.includes("if (ended || item.outcome === 'failed'"));
  assert.ok(line, 'the driver must keep one explicit loop-exit predicate');
  const decides = (ended, outcome, requested, attempts, requestLimit) => vm.runInNewContext(`(async () => { while (true) { ${line} return 'continued'; } return 'stopped'; })()`,
    { ended, item: { outcome }, stopControl: { requested }, relay: { snapshot: () => ({ attempts }) }, authorization: { requestLimit } });
  assert.equal(await decides(true, CASE_PIPELINE_COMPLETE, false, [], null), 'stopped');
  assert.equal(await decides(false, 'failed', false, [], null), 'stopped');
  assert.equal(await decides(false, CASE_PIPELINE_COMPLETE, true, [], null), 'stopped');
  assert.equal(await decides(false, CASE_PIPELINE_COMPLETE, false, [{ status: 400 }], null), 'stopped');
  assert.equal(await decides(false, CASE_PIPELINE_COMPLETE, false, [{ status: 200 }], null), 'continued');
  assert.equal(await decides(false, 'stopped', false, [], null), 'continued', 'a stopped case is not a failed case');
  assert.equal(await decides(false, CASE_PIPELINE_COMPLETE, false, [attempt(1), attempt(2)], 2), 'stopped');
  assert.equal(await decides(false, CASE_PIPELINE_COMPLETE, false, [attempt(1)], 2), 'continued');
});

test('the driver runs only the selected cases on its own resolved journal', () => {
  assert.ok(source.includes('for (const caseId of cases) {'), 'the case loop must be driven by the selection');
  assert.ok(source.includes('const authorization = p8Authorization(process.env, root, { out, argv: driverArgv })'));
  assert.ok(!source.includes("['hammer', 'first-person', 'training-range'], ['dog', 'top-down', 'town']"), 'no hardcoded both-case loop may remain');
  assert.ok(source.includes(', cases = authorization.cases'));
  assert.ok(source.includes('report.pipelinePassedForSelectedCase'));
  assert.ok(source.includes('report.reviewItems'));
  assert.ok(source.includes('driverHashes'));
  assert.ok(source.includes('item.initialSource = sourceEvidence(world.id, initial.buildId)'));
  assert.ok(source.includes('CASE_PIPELINE_COMPLETE'), 'the driver must use the shared case-outcome constant');
  // A continuation is only ever requested after the previous turn proved complete.
  const complete = source.indexOf("assert.equal(final.metrics.status, 'completed'");
  const continuation = source.indexOf("const available = await panel(world.id, 'godot.candidateList'");
  assert.ok(complete > 0 && continuation > complete, 'the completion assertion must precede the next continuation request');
  assert.ok(source.includes("const submitted = await step(round ? 'continue unfinished request in the same world'"));
  assert.ok(source.includes("if (!item.gameplay.verdict.verified) process.exitCode = 1;"));
  assert.ok(source.includes('report.historicalAdmissions'));
  assert.deepEqual(P8_CASE_IDS, ['hammer', 'dog']);
});
