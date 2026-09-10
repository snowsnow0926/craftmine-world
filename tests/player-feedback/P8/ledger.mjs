import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { MODEL, ENDPOINT } from './relay.mjs';
import { ordinaryParents } from './evidence.mjs';

// Parallel acceptance drivers must never share one admission ledger: the ledger
// carries an exclusive lock, so two cases running side by side need two files.
// This module resolves where a run's own ledger lives, proves it owns that path,
// and reads the earlier ledgers strictly read-only for honest cumulative
// accounting. It never creates, truncates, resets or rewrites a historical file.

export const ADMISSION_FORMAT = 'craftmine.p8-admission/1';
export const LEDGER_FILE = 'requests.ndjson';
const LEDGER_ENTRY_LIMIT = 200000;

/** Read-only summary of one admission ledger. Never opens the file for writing,
 * never touches its lock, and never creates a missing file. */
export function readLedgerSummary(file) {
  assert.ok(path.isAbsolute(file), 'P8_ABSOLUTE_LEDGER_REQUIRED');
  if (!fs.existsSync(file)) return { path: file, exists: false, entries: 0, cases: { hammer: 0, dog: 0 }, bytes: 0, sha256: null };
  const stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'P8_INVALID_LEDGER_FILE');
  const bytes = fs.readFileSync(file);
  const text = bytes.toString('utf8');
  assert.ok(!text || text.endsWith('\n'), 'P8_INCOMPLETE_LEDGER');
  const lines = text.trim() ? text.trimEnd().split('\n') : [];
  assert.ok(lines.length <= LEDGER_ENTRY_LIMIT, 'P8_LEDGER_TOO_LARGE');
  const cases = { hammer: 0, dog: 0 };
  for (const [index, line] of lines.entries()) {
    let row;
    try { row = JSON.parse(line); } catch { throw Error('P8_LEDGER_INVALID_JSON'); }
    assert.ok(row && typeof row === 'object' && !Array.isArray(row), 'P8_LEDGER_INVALID_ENTRY');
    assert.ok(row.format === ADMISSION_FORMAT, 'P8_LEDGER_IDENTITY_MISMATCH');
    assert.ok(row.attempt?.id === index + 1, 'P8_LEDGER_ADMISSION_ORDER');
    assert.ok(row.attempt.requestedModel === MODEL && row.attempt.endpoint === ENDPOINT, 'P8_LEDGER_IDENTITY_MISMATCH');
    assert.ok(['hammer', 'dog'].includes(row.caseId), 'P8_LEDGER_IDENTITY_MISMATCH');
    cases[row.caseId] += 1;
  }
  return { path: file, exists: true, entries: lines.length, cases, bytes: stat.size, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** The two ledgers that already recorded real requests before this phase. Both
 * are references only: a parallel run reports their totals and never appends. */
export function historicalLedgers(root) {
  return [
    readLedgerSummary(path.join(root, 'test-results/p8-authorized-20260910.ndjson')),
    readLedgerSummary(path.join(path.dirname(root), 'p8-unlimited-20260910.ndjson')),
  ];
}

function freshness(directory) {
  const ledger = path.join(directory, LEDGER_FILE);
  const lock = ledger + '.lock';
  assert.ok(!fs.existsSync(ledger), 'P8_LEDGER_NOT_FRESH');
  assert.ok(!fs.existsSync(lock), 'P8_LEDGER_LOCK_HELD');
  return ledger;
}

/** A caller-named ledger directory must be a real, empty-of-this-run directory
 * inside *this* checkout's test output. Any other location is refused so one
 * agent can never record requests into another agent's evidence range. */
function resolveDirectory(requested, root) {
  assert.ok(path.isAbsolute(requested), 'P8_LEDGER_DIRECTORY_REQUIRED');
  let stat;
  try { stat = fs.statSync(requested); } catch { throw Error('P8_LEDGER_DIRECTORY_MISSING'); }
  assert.ok(stat.isDirectory(), 'P8_LEDGER_DIRECTORY_REQUIRED');
  ordinaryParents(path.join(requested, LEDGER_FILE));
  const actual = fs.realpathSync(requested);
  const canonicalRoot = fs.realpathSync(root);
  const testRoot = path.join(canonicalRoot, 'test-results');
  // Strictly inside: the shared test-results root itself is not one run's range.
  assert.ok(actual.startsWith(testRoot + path.sep), 'P8_LEDGER_DIRECTORY_REJECTED');
  return freshness(actual);
}

function ownership(journalPath, mode) {
  return { journalPath, mode, lockFile: journalPath + '.lock', exclusiveLock: 'openRequestJournal uses an exclusive wx lock; a second owner fails closed', historicalReadOnly: true };
}

/** Resolve this run's ledger. `shared` keeps the dated one-ledger-per-phase
 * behaviour byte-for-byte; `parallel-20260910` gives each concurrent case its
 * own fresh ledger. */
export function resolveLedger({ env, root, out }) {
  assert.ok(typeof root === 'string' && path.isAbsolute(root) && path.dirname(root) !== root, 'P8_SOURCE_ROOT_REQUIRED');
  const requested = env.CRAFTMINE_P8_LEDGER;
  if (requested !== undefined && typeof requested !== 'string') throw Error('P8_LEDGER_VALUE_REQUIRED');
  const phase = env.CRAFTMINE_P8_AUTHORIZATION_PHASE;
  if (phase === undefined) {
    if (requested !== undefined) throw Error('P8_LEDGER_PHASE_REQUIRED');
    return { phase: 'initial-16', mode: 'shared', requestLimit: 16, journalPath: path.join(root, 'test-results/p8-authorized-20260910.ndjson'), previousPhaseAdmissions: 0, declaredEarlierPhases: 0, historical: [], historicalTotal: 0, ownership: ownership(path.join(root, 'test-results/p8-authorized-20260910.ndjson'), 'shared') };
  }
  if (phase === 'unlimited-20260910') {
    // The dated unlimited phase keeps one shared ledger and its previously
    // declared 50 earlier admissions; the parallel phase must be named instead.
    if (requested !== undefined) throw Error('P8_LEDGER_PHASE_REQUIRED');
    const shared = path.join(path.dirname(root), 'p8-unlimited-20260910.ndjson');
    return { phase, mode: 'shared', requestLimit: null, journalPath: shared, previousPhaseAdmissions: 50, declaredEarlierPhases: 50, historical: [readLedgerSummary(shared)], historicalTotal: 50, ownership: ownership(shared, 'shared') };
  }
  if (phase !== 'parallel-20260910') throw Error('P8_UNKNOWN_AUTHORIZATION_PHASE');
  assert.ok(typeof out === 'string' && path.isAbsolute(out), 'P8_LEDGER_OUTPUT_REQUIRED');
  let mode, journalPath;
  if (requested === undefined || requested === 'run') { const directory = path.join(out, 'ledger'); fs.mkdirSync(directory, { recursive: true }); mode = 'run'; journalPath = freshness(directory); }
  else { mode = 'directory'; journalPath = resolveDirectory(requested, root); }
  const historical = historicalLedgers(root).filter(item => item.path !== journalPath);
  const historicalTotal = historical.reduce((sum, item) => sum + item.entries, 0);
  return { phase, mode, requestLimit: null, journalPath, previousPhaseAdmissions: historicalTotal, declaredEarlierPhases: null, historical, historicalTotal, ownership: ownership(journalPath, mode) };
}
/** One accounting record: how many admissions existed before, how many this
 * exact run added, and the same total expressed both ways. Existing entries in
 * a historical ledger are never reported as new requests. */
export function admissionAccounting({ authorization, initialInLedger, thisRun }) {
  const historicalTotal = authorization.historicalTotal ?? 0;
  return {
    phase: authorization.phase,
    derivedFromLedgers: authorization.phase === 'parallel-20260910',
    journalPath: authorization.journalPath,
    declaredEarlierPhases: authorization.declaredEarlierPhases ?? null,
    historical: authorization.historical ?? [],
    historicalTotal,
    priorInThisLedger: initialInLedger,
    thisRun,
    total: historicalTotal + initialInLedger + thisRun,
    note: 'thisRun counts only admissions written by this run; priorInThisLedger are entries already in this run\'s own ledger; historicalTotal is other earlier ledgers, read only.',
  };
}
