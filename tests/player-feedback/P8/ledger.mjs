import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { MODEL, ENDPOINT } from './relay.mjs';
import { ordinaryParents } from './evidence.mjs';

// Parallel acceptance drivers must never share one admission journal: the journal
// carries an exclusive lock, so two cases running side by side need two files.
// This module resolves where a run's own journal lives, proves it owns that path,
// and reads the earlier journals strictly read-only for honest cumulative
// accounting. It never creates, truncates, resets or rewrites a historical file.

export const ADMISSION_FORMAT = 'craftmine.p8-admission/1';
export const JOURNAL_FILE = 'requests.ndjson';
export const JOURNAL_ENV = 'CRAFTMINE_P8_JOURNAL';
/** The retired spelling. It is refused instead of silently honoured, so two
 * groups cannot believe they configured the same interface differently. */
export const LEGACY_JOURNAL_ENV = 'CRAFTMINE_P8_LEDGER';
/** Admissions of the phases before the dated unlimited phase, declared once. */
export const PHASE_ONE_ADMISSIONS = 50;
const JOURNAL_ENTRY_LIMIT = 200000;

/** Read-only summary of one admission journal. Never opens the file for writing,
 * never touches its lock, and never creates a missing file. */
export function readLedgerSummary(file) {
  assert.ok(path.isAbsolute(file), 'P8_ABSOLUTE_JOURNAL_REQUIRED');
  if (!fs.existsSync(file)) return { path: file, exists: false, entries: 0, cases: { hammer: 0, dog: 0 }, bytes: 0, sha256: null };
  const stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'P8_INVALID_JOURNAL_FILE');
  const bytes = fs.readFileSync(file);
  const text = bytes.toString('utf8');
  assert.ok(!text || text.endsWith('\n'), 'P8_INCOMPLETE_JOURNAL');
  const lines = text.trim() ? text.trimEnd().split('\n') : [];
  assert.ok(lines.length <= JOURNAL_ENTRY_LIMIT, 'P8_JOURNAL_TOO_LARGE');
  const cases = { hammer: 0, dog: 0 };
  for (const [index, line] of lines.entries()) {
    let row;
    try { row = JSON.parse(line); } catch { throw Error('P8_JOURNAL_INVALID_JSON'); }
    assert.ok(row && typeof row === 'object' && !Array.isArray(row), 'P8_JOURNAL_INVALID_ENTRY');
    assert.ok(row.format === ADMISSION_FORMAT, 'P8_JOURNAL_IDENTITY_MISMATCH');
    assert.ok(row.attempt?.id === index + 1, 'P8_JOURNAL_ADMISSION_ORDER');
    assert.ok(row.attempt.requestedModel === MODEL && row.attempt.endpoint === ENDPOINT, 'P8_JOURNAL_IDENTITY_MISMATCH');
    assert.ok(['hammer', 'dog'].includes(row.caseId), 'P8_JOURNAL_IDENTITY_MISMATCH');
    cases[row.caseId] += 1;
  }
  return { path: file, exists: true, entries: lines.length, cases, bytes: stat.size, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** The journals that already recorded real requests before this phase. They are
 * references only: a run reports their totals and never appends to them. */
export function historicalJournals(root) {
  return [
    readLedgerSummary(path.join(root, 'test-results/p8-authorized-20260910.ndjson')),
    readLedgerSummary(path.join(path.dirname(root), 'p8-unlimited-20260910.ndjson')),
  ];
}

const historicalPaths = root => new Set(historicalJournals(root).map(item => path.resolve(item.path)));

function insideTestResults(candidate, root) {
  const actual = fs.realpathSync(candidate);
  const testRoot = path.join(fs.realpathSync(root), 'test-results');
  // Strictly inside: the shared test-results root itself is not one run's range.
  assert.ok(actual.startsWith(testRoot + path.sep), 'P8_JOURNAL_PATH_REJECTED');
  return actual;
}

/** A caller-named journal is an absolute path to a file or a directory. Only
 * paths inside *this* checkout's own test output are accepted, so one agent can
 * never record requests into another agent's evidence range or into the shared
 * history. An existing file is appended to; an already held lock fails closed. */
function resolveNamedJournal(requested, root) {
  assert.ok(path.isAbsolute(requested), 'P8_JOURNAL_ABSOLUTE_PATH_REQUIRED');
  assert.ok(!historicalPaths(root).has(path.resolve(requested)), 'P8_JOURNAL_IS_HISTORICAL');
  let stat;
  try { stat = fs.statSync(requested); } catch { throw Error('P8_JOURNAL_PATH_MISSING'); }
  const resolved = insideTestResults(requested, root);
  if (stat.isDirectory()) {
    const file = path.join(resolved, JOURNAL_FILE);
    ordinaryParents(file);
    return { journalPath: file, mode: 'journal-directory' };
  }
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'P8_JOURNAL_FILE_REQUIRED');
  assert.ok(path.extname(resolved).toLowerCase() === '.ndjson', 'P8_JOURNAL_FILE_REQUIRED');
  ordinaryParents(resolved);
  if (fs.existsSync(resolved)) readLedgerSummary(resolved);
  return { journalPath: resolved, mode: 'journal-file' };
}

function ownership(journalPath, mode) {
  return { journalPath, mode, lockFile: journalPath + '.lock', exclusiveLock: 'openRequestJournal takes an exclusive wx lock; a second live owner fails closed', historicalReadOnly: true, insideCheckoutTestResults: true };
}

/** Resolve this run's journal. The dated phases keep their previous behaviour
 * byte-for-byte; `parallel-20260910` gives each concurrent case its own journal. */
export function resolveLedger({ env, root, out }) {
  assert.ok(typeof root === 'string' && path.isAbsolute(root) && path.dirname(root) !== root, 'P8_SOURCE_ROOT_REQUIRED');
  if (env[LEGACY_JOURNAL_ENV] !== undefined) throw Error(`${LEGACY_JOURNAL_ENV} was renamed to ${JOURNAL_ENV}`);
  const requested = env[JOURNAL_ENV];
  if (requested !== undefined && typeof requested !== 'string') throw Error('P8_JOURNAL_VALUE_REQUIRED');
  const phase = env.CRAFTMINE_P8_AUTHORIZATION_PHASE;
  if (phase === undefined) {
    if (requested !== undefined) throw Error('P8_JOURNAL_PHASE_REQUIRED');
    const shared = path.join(root, 'test-results/p8-authorized-20260910.ndjson');
    return { phase: 'initial-16', mode: 'shared', requestLimit: 16, journalPath: shared, previousPhaseAdmissions: 0, declaredEarlierPhases: 0, phaseOneAdmissions: 0, historical: [], historicalTotal: 0, ownership: ownership(shared, 'shared') };
  }
  if (phase === 'unlimited-20260910') {
    // The dated unlimited phase keeps one shared journal and its previously
    // declared 50 earlier admissions; the parallel phase must be named instead.
    if (requested !== undefined) throw Error('P8_JOURNAL_PHASE_REQUIRED');
    const shared = path.join(path.dirname(root), 'p8-unlimited-20260910.ndjson');
    // The 50 earlier admissions are reported as priorAdmissions here, so they are
    // not added a second time through phaseOneAdmissions.
    return { phase, mode: 'shared', requestLimit: null, journalPath: shared, previousPhaseAdmissions: 50, declaredEarlierPhases: 50, phaseOneAdmissions: 0, historical: [readLedgerSummary(shared)], historicalTotal: 50, ownership: ownership(shared, 'shared') };
  }
  if (phase !== 'parallel-20260910') throw Error('P8_UNKNOWN_AUTHORIZATION_PHASE');
  assert.ok(typeof out === 'string' && path.isAbsolute(out), 'P8_JOURNAL_OUTPUT_REQUIRED');
  let mode, journalPath;
  if (requested === undefined || requested === 'run') {
    // This run's own brand-new output range: a fresh journal every time.
    const directory = path.join(out, 'journal'); fs.mkdirSync(directory, { recursive: true });
    journalPath = path.join(directory, JOURNAL_FILE);
    assert.ok(!fs.existsSync(journalPath), 'P8_JOURNAL_NOT_FRESH');
    assert.ok(!fs.existsSync(journalPath + '.lock'), 'P8_JOURNAL_LOCK_HELD');
    mode = 'run';
  } else ({ journalPath, mode } = resolveNamedJournal(requested, root));
  assert.ok(!fs.existsSync(journalPath + '.lock'), 'P8_JOURNAL_LOCK_HELD');
  const historical = historicalJournals(root).filter(item => path.resolve(item.path) !== path.resolve(journalPath));
  const historicalTotal = historical.reduce((sum, item) => sum + item.entries, 0);
  return { phase, mode, requestLimit: null, journalPath, previousPhaseAdmissions: historicalTotal, declaredEarlierPhases: null, phaseOneAdmissions: PHASE_ONE_ADMISSIONS, historical, historicalTotal, ownership: ownership(journalPath, mode) };
}

/** One accounting record in the vocabulary P5/P6 and P0 already agreed on, with
 * this driver's finer split kept beside it. Entries that already existed are
 * never presented as new requests of this run. */
export function admissionAccounting({ authorization, initialInLedger, thisRun }) {
  const phaseOneAdmissions = authorization.phaseOneAdmissions ?? authorization.declaredEarlierPhases ?? 0;
  const phaseOneIncludedInPriorAdmissions = authorization.declaredEarlierPhases === 50 && phaseOneAdmissions === 0;
  const historicalTotal = authorization.historicalTotal ?? 0;
  const cumulativeAdmissions = phaseOneAdmissions + historicalTotal + initialInLedger + thisRun;
  return {
    phase: authorization.phase,
    journalPath: authorization.journalPath,
    phaseOneIncludedInPriorAdmissions,
    derivedFromJournals: authorization.declaredEarlierPhases === null,
    declaredEarlierPhases: authorization.declaredEarlierPhases ?? null,
    historical: authorization.historical ?? [],
    // P5/P6 vocabulary.
    phaseOneAdmissions,
    priorAdmissions: historicalTotal,
    newAdmissions: thisRun,
    cumulativeAdmissions,
    // Finer split kept for P0's merge.
    historicalTotal,
    priorInThisLedger: initialInLedger,
    thisRun,
    total: cumulativeAdmissions,
    note: 'newAdmissions counts only admissions written by this run; priorInThisLedger are entries already in this run\'s own journal; priorAdmissions is other earlier journals, read only.',
  };
}
