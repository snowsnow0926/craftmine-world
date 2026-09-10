import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { p8Authorization, p8Cases } from './authorization.mjs';
import { readLedgerSummary, admissionAccounting, LEDGER_FILE } from './ledger.mjs';
import { openRequestJournal } from './evidence.mjs';
import { MODEL, ENDPOINT } from './relay.mjs';
import { summarizeRun, summarizeCase, CASE_PIPELINE_COMPLETE } from './run-outcome.mjs';

// Offline verification for the parallel acceptance driver: explicit case
// selection, per-run ledgers with one owner, refusal of any ledger directory
// outside this checkout's own output, honest cumulative accounting that leaves
// the historical ledger byte-identical, and the real loop-exit predicate.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const source = fs.readFileSync(new URL('./client-native.mjs', import.meta.url), 'utf8');
fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
const out = fs.mkdtempSync(path.join(root, 'test-results/p8-parallel-'));
const parallel = { CRAFTMINE_P8_AUTHORIZATION_PHASE: 'parallel-20260910' };
const runDir = () => fs.mkdtempSync(path.join(out, 'run-'));
const attempt = id => ({ id, endpoint: ENDPOINT, requestedModel: MODEL });
const historicalPath = path.join(path.dirname(root), 'p8-unlimited-20260910.ndjson');

test('case selection is explicit and refuses anything but the fixed case ids', () => {
  assert.deepEqual(p8Cases({}), ['hammer', 'dog']);
  assert.deepEqual(p8Cases({ CRAFTMINE_P8_CASES: 'hammer' }), ['hammer']);
  assert.deepEqual(p8Cases({ CRAFTMINE_P8_CASES: 'dog' }), ['dog']);
  assert.deepEqual(p8Cases({ CRAFTMINE_P8_CASES: ' hammer , dog ' }), ['hammer', 'dog']);
  for (const bad of ['', ' ', 'cat', 'hammer,hammer', 'hammer,dog,cat', 'hammer,', 7, ['hammer']]) assert.throws(() => p8Cases({ CRAFTMINE_P8_CASES: bad }), /P8_INVALID_CASE_SELECTION/);
  assert.deepEqual(p8Authorization(parallel, root, { out: runDir() }).cases, ['hammer', 'dog']);
  assert.deepEqual(p8Authorization({ ...parallel, CRAFTMINE_P8_CASES: 'dog' }, root, { out: runDir() }).cases, ['dog']);
});

test('a completed single case is a single-case pass and never a two-case pass', () => {
  const complete = { caseId: 'hammer', outcome: CASE_PIPELINE_COMPLETE, restart: { passed: true }, gameplay: { verified: true, failed: [], insufficient: [] } };
  const one = summarizeRun({ requestedCases: ['hammer'], executedCases: ['hammer'], cases: [complete] });
  assert.equal(one.pipelinePassed, true); assert.equal(one.behaviorVerified, true);
  assert.equal(one.singleCasePassed, true); assert.equal(one.combinedTwoCasePassed, false);
  assert.equal(one.passed, false); assert.equal(one.reviewRequired, true);
  assert.deepEqual(one.caseSelection, { requested: ['hammer'], executed: ['hammer'], requestedCount: 1, executedCount: 1 });
  const missing = summarizeRun({ requestedCases: ['hammer', 'dog'], executedCases: ['hammer'], cases: [complete] });
  assert.equal(missing.allRequestedExecuted, false); assert.equal(missing.pipelinePassed, false);
  assert.equal(missing.singleCasePassed, false); assert.equal(missing.combinedTwoCasePassed, false);
  const stopped = summarizeRun({ requestedCases: ['hammer'], executedCases: ['hammer'], cases: [complete], stopped: true });
  assert.equal(stopped.pipelinePassed, false); assert.equal(stopped.singleCasePassed, false);
  const failed = summarizeRun({ requestedCases: ['hammer'], executedCases: ['hammer'], cases: [{ ...complete, outcome: 'failed', error: 'P8_TIMEOUT' }] });
  assert.equal(failed.pipelinePassed, false); assert.equal(failed.singleCasePassed, false);
  const unverified = summarizeRun({ requestedCases: ['hammer'], executedCases: ['hammer'], cases: [{ ...complete, gameplay: { verified: false, failed: ['cooldown-enforced-live'], insufficient: [] } }] });
  assert.equal(unverified.pipelinePassed, true); assert.equal(unverified.behaviorVerified, false); assert.equal(unverified.singleCasePassed, false);
  const both = summarizeRun({ requestedCases: ['hammer', 'dog'], executedCases: ['hammer', 'dog'], cases: [complete, { ...complete, caseId: 'dog' }] });
  assert.equal(both.combinedTwoCasePassed, true); assert.equal(both.singleCasePassed, false); assert.equal(both.passed, false);
  assert.deepEqual(summarizeCase({ caseId: 'dog', outcome: 'running' }).gameplayFailed, []);
});

test('two parallel runs own one fresh ledger each and a ledger has a single owner', () => {
  const a = p8Authorization(parallel, root, { out: runDir() }), b = p8Authorization(parallel, root, { out: runDir() });
  assert.equal(a.requestLimit, null); assert.equal(b.requestLimit, null);
  assert.equal(a.mode, 'run'); assert.notEqual(a.journalPath, b.journalPath);
  assert.ok(a.journalPath.endsWith(path.join('ledger', LEDGER_FILE)));
  assert.equal(a.ownership.lockFile, a.journalPath + '.lock');
  const first = openRequestJournal(a.journalPath, { requestLimit: null }), second = openRequestJournal(b.journalPath, { requestLimit: null });
  try {
    assert.throws(() => openRequestJournal(a.journalPath, { requestLimit: null }), /EEXIST/);
    first.reserve(attempt(1), 'hammer', out); second.reserve(attempt(1), 'dog', out);
    assert.equal(first.entries.length, 1); assert.equal(second.entries.length, 1);
    assert.deepEqual(readLedgerSummary(a.journalPath).cases, { hammer: 1, dog: 0 });
    assert.deepEqual(readLedgerSummary(b.journalPath).cases, { hammer: 0, dog: 1 });
    assert.equal(readLedgerSummary(a.journalPath).sha256 === readLedgerSummary(b.journalPath).sha256, false);
  } finally { first.close(); second.close(); }
  // Reopening keeps the entries and does not hand them to a second live owner.
  const reopened = openRequestJournal(b.journalPath, { requestLimit: null });
  try { assert.equal(reopened.initialAttempts.length, 1); reopened.reserve(attempt(2), 'dog', out); assert.equal(reopened.entries.length, 2); }
  finally { reopened.close(); }
});

test('a ledger directory outside this checkout output is refused before any write', () => {
  const run = runDir();
  const inside = path.join(root, 'test-results', 'p8-ledger-' + path.basename(run)); fs.mkdirSync(inside, { recursive: true });
  const accepted = p8Authorization({ ...parallel, CRAFTMINE_P8_LEDGER: inside }, root, { out: run });
  assert.equal(accepted.mode, 'directory'); assert.equal(accepted.journalPath, path.join(fs.realpathSync(inside), LEDGER_FILE));
  for (const bad of [path.dirname(root), path.join(root, 'vendor'), path.join(out, 'relative', '..', '..'), 'relative-ledger', path.join(root, 'test-results', 'p8-absent-ledger-dir')]) {
    assert.throws(() => p8Authorization({ ...parallel, CRAFTMINE_P8_LEDGER: bad }, root, { out: run }), /P8_LEDGER_DIRECTORY_(REJECTED|REQUIRED|MISSING)/, String(bad));
  }
  const file = path.join(root, 'test-results', 'p8-ledger-file-' + path.basename(run)); fs.writeFileSync(file, '');
  assert.throws(() => p8Authorization({ ...parallel, CRAFTMINE_P8_LEDGER: file }, root, { out: run }), /P8_LEDGER_DIRECTORY_REQUIRED/);
  assert.equal(fs.readdirSync(inside).length, 0, 'resolution must not create the ledger');
});

test('a ledger directory that already holds a ledger or a lock is not reused', () => {
  const directory = path.join(root, 'test-results', 'p8-ledger-stale-' + path.basename(runDir())); fs.mkdirSync(directory, { recursive: true });
  const env = { ...parallel, CRAFTMINE_P8_LEDGER: directory };
  fs.writeFileSync(path.join(directory, LEDGER_FILE), '');
  assert.throws(() => p8Authorization(env, root, { out: runDir() }), /P8_LEDGER_NOT_FRESH/);
  fs.unlinkSync(path.join(directory, LEDGER_FILE)); fs.writeFileSync(path.join(directory, LEDGER_FILE + '.lock'), '{}');
  assert.throws(() => p8Authorization(env, root, { out: runDir() }), /P8_LEDGER_LOCK_HELD/);
  fs.unlinkSync(path.join(directory, LEDGER_FILE + '.lock'));
  assert.equal(p8Authorization(env, root, { out: runDir() }).mode, 'directory');
});

test('a ledger setting needs the parallel phase and the legacy phases keep theirs', () => {
  assert.throws(() => p8Authorization({ CRAFTMINE_P8_LEDGER: 'run' }, root, { out: runDir() }), /P8_LEDGER_PHASE_REQUIRED/);
  assert.throws(() => p8Authorization({ CRAFTMINE_P8_AUTHORIZATION_PHASE: 'unlimited-20260910', CRAFTMINE_P8_LEDGER: 'run' }, root, { out: runDir() }), /P8_LEDGER_PHASE_REQUIRED/);
  assert.throws(() => p8Authorization({ CRAFTMINE_P8_AUTHORIZATION_PHASE: 'parallel-20260910' }, root, {}), /P8_LEDGER_OUTPUT_REQUIRED/);
  assert.throws(() => p8Authorization({ CRAFTMINE_P8_AUTHORIZATION_PHASE: 'invented' }, root, { out: runDir() }), /P8_UNKNOWN_AUTHORIZATION_PHASE/);
  const legacy = p8Authorization({ CRAFTMINE_P8_AUTHORIZATION_PHASE: 'unlimited-20260910' }, root, { out: runDir() });
  assert.equal(legacy.requestLimit, null); assert.equal(legacy.previousPhaseAdmissions, 50); assert.equal(legacy.journalPath, historicalPath);
  assert.equal(p8Authorization({}, root, { out: runDir() }).requestLimit, 16);
});

test('admissions separate this run from history and the historical ledger stays byte-identical', () => {
  const before = readLedgerSummary(historicalPath);
  const authorization = p8Authorization(parallel, root, { out: runDir() });
  assert.equal(authorization.historicalTotal, before.exists ? before.entries : 0);
  assert.equal(authorization.historical.some(item => item.path === historicalPath), before.exists);
  assert.equal(authorization.historical.some(item => item.path === authorization.journalPath), false, 'a run never counts its own ledger as history');
  const journal = openRequestJournal(authorization.journalPath, { requestLimit: null });
  try {
    for (let index = 0; index < 3; index++) journal.reserve(attempt(index + 1), index === 0 ? 'hammer' : 'dog', out);
    const accounting = admissionAccounting({ authorization, initialInLedger: journal.initialAttempts.length, thisRun: 3 });
    assert.equal(accounting.priorInThisLedger, 0); assert.equal(accounting.thisRun, 3);
    assert.equal(accounting.total, (before.exists ? before.entries : 0) + 3);
    assert.equal(accounting.derivedFromLedgers, true); assert.equal(accounting.declaredEarlierPhases, null);
    // A second run against the same ledger counts its earlier entries as prior.
    const second = admissionAccounting({ authorization, initialInLedger: readLedgerSummary(authorization.journalPath).entries, thisRun: 1 });
    assert.equal(second.priorInThisLedger, 3); assert.equal(second.thisRun, 1);
    assert.equal(second.total, (before.exists ? before.entries : 0) + 4);
  } finally { journal.close(); }
  const after = readLedgerSummary(historicalPath);
  assert.equal(after.entries, before.entries); assert.equal(after.sha256, before.sha256);
});

test('the legacy shared ledger keeps positional admissions and is never rewritten', () => {
  const before = readLedgerSummary(historicalPath);
  const legacy = p8Authorization({ CRAFTMINE_P8_AUTHORIZATION_PHASE: 'unlimited-20260910' }, root, { out: runDir() });
  const journal = openRequestJournal(legacy.journalPath, { requestLimit: null });
  try {
    assert.equal(journal.entries.length, before.entries);
    const accounting = admissionAccounting({ authorization: legacy, initialInLedger: journal.initialAttempts.length, thisRun: 0 });
    assert.equal(accounting.declaredEarlierPhases, 50); assert.equal(accounting.historicalTotal, 50);
    assert.equal(accounting.total, 50 + (before.exists ? before.entries : 0));
  } finally { journal.close(); }
  assert.equal(readLedgerSummary(historicalPath).sha256, before.sha256);
});

test('an incomplete or foreign historical ledger fails closed instead of being counted', () => {
  const directory = fs.mkdtempSync(path.join(out, 'historical-'));
  const broken = path.join(directory, 'requests.ndjson');
  fs.writeFileSync(broken, JSON.stringify({ format: 'craftmine.p8-admission/1', attempt: attempt(1), caseId: 'hammer' }));
  assert.throws(() => readLedgerSummary(broken), /P8_INCOMPLETE_LEDGER/);
  fs.writeFileSync(broken, JSON.stringify({ format: 'craftmine.p8-admission/1', attempt: attempt(2), caseId: 'hammer' }) + '\n');
  assert.throws(() => readLedgerSummary(broken), /P8_LEDGER_ADMISSION_ORDER/);
  fs.writeFileSync(broken, JSON.stringify({ format: 'craftmine.p8-admission/1', attempt: attempt(1), caseId: 'cat' }) + '\n');
  assert.throws(() => readLedgerSummary(broken), /P8_LEDGER_IDENTITY_MISMATCH/);
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

test('the driver runs only the selected cases on its own resolved ledger', () => {
  assert.ok(source.includes('for (const caseId of cases) {'), 'the case loop must be driven by the selection');
  assert.ok(source.includes('const authorization = p8Authorization(process.env, root, { out })'));
  assert.ok(!source.includes("['hammer', 'first-person', 'training-range'], ['dog', 'top-down', 'town']"), 'no hardcoded both-case loop may remain');
  assert.ok(source.includes(', cases = authorization.cases'), 'the driver must take the selection from the resolved authorization');
  // A continuation is only ever requested after the previous turn proved complete.
  const complete = source.indexOf("assert.equal(final.metrics.status, 'completed'");
  const continuation = source.indexOf("const available = await panel(world.id, 'godot.candidateList'");
  assert.ok(complete > 0 && continuation > complete, 'the completion assertion must precede the next continuation request');
  assert.ok(source.includes("const submitted = await step(round ? 'continue unfinished request in the same world'"));
  assert.ok(source.includes("if (round + 1 === MAX_ROUNDS) item.continuationExhausted = true;"));
  assert.ok(source.includes("item.turns.push({ round,"));
  assert.ok(source.includes('item.requestTotals = {'));
  assert.ok(source.includes("if (!item.gameplay.verdict.verified) process.exitCode = 1;"));
  assert.ok(source.includes('report.historicalAdmissions'));
});
