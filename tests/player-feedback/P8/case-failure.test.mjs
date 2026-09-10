import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

// Execute the checked-in driver's actual catch/finally/loop-exit and first
// strict-shutdown call. There is no alternate copy of the decision predicate.
const source = fs.readFileSync(new URL('./client-native.mjs', import.meta.url), 'utf8');
const begin = source.indexOf("catch (error) { item.outcome = 'failed';");
const finish = source.indexOf('  const savedCases =', begin);
assert.ok(begin > 0 && finish > begin);
const actual = source.slice(begin, finish);
assert.ok(actual.includes("await step('first strict owned shutdown', auditStop)"));

async function run({ bound = true, fail = true, abortFails = false, stopRequested = false, shutdownFails = false } = {}) {
  const visited = [], items = [], saved = []; let aborts = 0, audits = 0;
  const context = {
    ended: false, stopControl: { requested: stopRequested }, authorization: { requestLimit: null },
    relay: { snapshot: () => ({ attempts: [] }) }, report: {}, process: { exitCode: undefined },
    save: () => saved.push(items.map(item => ({ ...item }))),
    p8: async (method, caseId) => { assert.equal(method, 'abort'); assert.equal(caseId, 'hammer'); aborts++; if (abortFails) throw Error('P8_ABORT_LOST_REPLY'); return { ok: true }; },
    step: async (_name, fn) => fn(),
    auditStop: async () => { audits++; if (shutdownFails) throw Error('P8_STRICT_SHUTDOWN_FAILED'); },
    enter: caseId => { const item = { caseId, outcome: 'running', ...(bound ? { binding: { sessionId: 'owned' } } : {}) }; visited.push(caseId); items.push(item); return item; },
    action: async item => { if (fail && item.caseId === 'hammer') throw Error('P8_CASE_FAILED'); item.outcome = 'source-check-apply-save-completed'; },
  };
  const code = `(async () => { for (const caseId of ['hammer', 'dog']) { const item = enter(caseId); try { await action(item); } ${actual} })()`;
  let failure;
  try { await vm.runInNewContext(code, context); } catch (error) { failure = String(error); }
  return { visited, items, saved, aborts, audits, failure, exitCode: context.process.exitCode };
}

test('bound failed case with a lost abort reply cannot start dog and still audits shutdown', async () => {
  const result = await run({ abortFails: true });
  assert.deepEqual(result.visited, ['hammer']); assert.equal(result.aborts, 1); assert.equal(result.audits, 1); assert.equal(result.exitCode, 1);
  assert.match(result.items[0].abortError, /P8_ABORT_LOST_REPLY/); assert.match(result.items[0].error, /P8_CASE_FAILED/);
  assert.ok(result.items[0].finishedAt); assert.equal(result.saved.at(-1)[0].outcome, 'failed');
});
test('a successful abort does not turn a failed bound case into permission to continue', async () => {
  const result = await run(); assert.deepEqual(result.visited, ['hammer']); assert.equal(result.aborts, 1); assert.equal(result.audits, 1); assert.equal(result.exitCode, 1);
});
test('unbound failure cannot start dog or invoke a session abort', async () => {
  const result = await run({ bound: false }); assert.deepEqual(result.visited, ['hammer']); assert.equal(result.aborts, 0); assert.equal(result.audits, 1);
});
test('an already requested stop is not retried by failure cleanup', async () => {
  const result = await run({ stopRequested: true }); assert.deepEqual(result.visited, ['hammer']); assert.equal(result.aborts, 0); assert.equal(result.audits, 1);
});
test('strict-shutdown rejection remains observable after the failed case is retained', async () => {
  const result = await run({ abortFails: true, shutdownFails: true }); assert.deepEqual(result.visited, ['hammer']); assert.match(result.failure, /P8_STRICT_SHUTDOWN_FAILED/); assert.equal(result.items[0].outcome, 'failed');
});
test('successful case retains the normal next-case path', async () => {
  const result = await run({ fail: false }); assert.deepEqual(result.visited, ['hammer', 'dog']); assert.equal(result.aborts, 0); assert.equal(result.audits, 1); assert.equal(result.failure, undefined);
});

test('accepted stop with a terminal timeout suppresses restart of an earlier saved case', async () => {
  const from = source.indexOf('  const savedCases =');
  const to = source.indexOf('  // Behavioral assertions require', from);
  assert.ok(from > 0 && to > from);
  const restart = source.slice(from, to);
  for (const [requested, stopped, expectedStarts] of [[true, false, 0], [true, true, 0], [false, false, 1]]) {
    let starts = 0;
    const context = { report: { stopped, cases: [{ caseId: 'hammer', saved: { complete: true } }, { caseId: 'dog', outcome: 'failed', error: 'P8_STOP_TERMINAL_TIMEOUT' }] }, stopControl: { requested }, start: async () => { starts++; throw Error('TEST_RESTART_REACHED'); } };
    try { await vm.runInNewContext(`(async () => { ${restart} })()`, context); }
    catch (error) { assert.equal(error.message, 'TEST_RESTART_REACHED'); }
    assert.equal(starts, expectedStarts);
  }
});
