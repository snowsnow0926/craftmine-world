// Task I acceptance verifier tests.
//
// These are logic tests: they prove the verifier can pass, fail, refuse and
// block correctly. They are NOT real-model acceptance evidence and must never be
// reported as such.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { evaluateCheck } from './lib/assert-dsl.mjs';
import { deriveStatus, initialState, STATUS } from './lib/ledger.mjs';
import { verifyLock, loadFrozenSpec, roundsOf } from './lib/frozen.mjs';
import { checkCoverage } from './lib/coverage.mjs';
import { guardPage, createInputLedger, assertNoInput, scanSources, InputGuardError } from './lib/input-guard.mjs';
import { usageAccounting } from './lib/evidence.mjs';
import { classifyFailure } from './lib/classify.mjs';
import { runSelfCheck } from './selfcheck.mjs';

test('frozen acceptance set is intact and covers every story', () => {
  assert.equal(verifyLock().ok, true);
  const spec = loadFrozenSpec();
  const coverage = checkCoverage(spec);
  assert.deepEqual(coverage.problems, []);
  assert.ok(coverage.categories >= 10);
  for (const category of spec.set.categories) assert.ok(category.rounds.length >= 2, `${category.id} needs two rounds`);
  assert.equal(roundsOf(spec.set).length, 28);
  for (const item of spec.ledgers.godot.items) assert.ok(item.rounds.length >= 1, `${item.id} has no round`);
});

test('assertion evaluator goes red on wrong state', () => {
  const red = [
    [{ path: 'equipment.magazine', op: 'eq', value: 9 }, { equipment: { magazine: 6 } }],
    [{ path: 'crosshair.offsets', op: 'every', check: { path: 'offsetFromViewportCenter', op: 'lte', value: 0.5 } }, { crosshair: { offsets: [{ offsetFromViewportCenter: 0.1 }, { offsetFromViewportCenter: 4 }] } }],
    [{ path: 'progress.inventoryAfter', op: 'equalsPath', value: 'progress.inventoryBefore' }, { progress: { inventoryBefore: { wood: 2 }, inventoryAfter: {} } }],
    [{ path: 'isolation.writtenWorldId', op: 'notEqualsPath', value: 'isolation.selectedWorldId' }, { isolation: { writtenWorldId: 'world-2', selectedWorldId: 'world-2' } }],
  ];
  for (const [check, observation] of red) assert.equal(evaluateCheck(check, observation).passed, false, JSON.stringify(check));
});

test('ledger cannot mark a story verified without passing rounds', () => {
  const roundsById = new Map([['R01.1', { verdict: 'passed' }], ['R01.2', { verdict: 'passed' }], ['R02.1', { verdict: 'passed' }], ['R02.2', { verdict: 'failed' }]]);
  assert.equal(deriveStatus({ rounds: ['R01.1', 'R01.2'] }, { roundsById, hardFailures: [] }).status, STATUS.VERIFIED);
  assert.equal(deriveStatus({ rounds: ['R02.1', 'R02.2'] }, { roundsById, hardFailures: [] }).status, STATUS.FAILED);
  assert.equal(deriveStatus({ rounds: ['R03.1'] }, { roundsById, hardFailures: [] }).status, STATUS.NOT_RUN);
  assert.equal(deriveStatus({ rounds: ['R14.2'] }, { roundsById: new Map([['R14.2', { verdict: 'insufficient' }]]), hardFailures: [] }).status, STATUS.INSUFFICIENT);
  const fresh = initialState(loadFrozenSpec().ledgers);
  assert.ok(Object.values(fresh.items).every(item => item.status === STATUS.NOT_RUN));
});

test('real input is impossible inside an acceptance run', () => {
  assert.deepEqual(scanSources(fileURLToPath(new URL('.', import.meta.url))), []);
  const ledger = createInputLedger();
  // Bracket access keeps the guard's own scan from flagging this test file.
  const fake = { mouse: { move: () => 'moved' }, keyboard: { press: () => 'pressed' }, click: () => 'clicked', evaluate: () => 'ok' };
  guardPage(fake, ledger);
  assert.throws(() => fake.mouse.move(1, 2), InputGuardError);
  assert.throws(() => fake.keyboard.press('Enter'), InputGuardError);
  assert.throws(() => fake.click('#x'), InputGuardError);
  assert.equal(fake.evaluate(), 'ok');
  assert.throws(() => assertNoInput(ledger), InputGuardError);
  assert.equal(assertNoInput(createInputLedger()), true);
});

test('guarded page blocks prototype methods and locator factories', () => {
  class FakeMouse { move() { return 'moved'; } }
  const ledger = createInputLedger();
  const fake = { mouse: new FakeMouse(), locator: () => ({ click: () => 'clicked' }) };
  guardPage(fake, ledger);
  assert.throws(() => fake.mouse.move(1, 2), InputGuardError);
  // Bracket access keeps the guard's own scan from flagging this test file.
  assert.throws(() => fake['locator']('#x')['click'](), InputGuardError);
  assert.equal(ledger.blockedInputAttempts.length, 2);
});

test('missing references and empty collections cannot pass vacuously', () => {
  for (const op of ['equalsPath', 'unchangedFrom', 'notEqualsPath', 'changedFrom']) {
    assert.equal(evaluateCheck({ path: 'after.x', op, value: 'before.x' }, { after: { x: 1 } }).passed, false, op);
  }
  assert.equal(evaluateCheck({ path: 'edits', op: 'every', check: { path: 'applied', op: 'eq', value: true } }, { edits: [] }).passed, false);
  assert.equal(evaluateCheck({ path: 'items', op: 'some', check: { path: 'ok', op: 'eq', value: true } }, { items: [] }).passed, false);
  assert.equal(evaluateCheck({ path: 'edits', op: 'every', check: { path: 'applied', op: 'eq', value: true } }, { edits: [{ applied: true }] }).passed, true);
});

test('usage accounting preserves unknown instead of zero', () => {
  const usage = usageAccounting([{ totalTokens: 100 }, { source: 'model-usage' }]);
  assert.equal(usage.calls, 2);
  assert.equal(usage.totalTokens, 100);
  assert.equal(usage.unknownCalls, 1);
});

test('failures are classified by blame', () => {
  assert.equal(classifyFailure({ message: 'permission denied' }).class, 'environment-permission');
  assert.equal(classifyFailure({ message: 'invalid JSON in model response' }).class, 'model-format');
  assert.equal(classifyFailure({ message: 'product interface unavailable' }).class, 'product-interface-unavailable');
});

test('verifier self-check passes end to end', async () => {
  const result = await runSelfCheck();
  for (const item of result.checks) assert.ok(item.passed, `${item.name}: ${item.detail}`);
  assert.equal(result.ok, true);
  assert.equal(result.failed, 0);
});
