import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { pollWorldInitialization, isTransientReadTimeout, terminalState, INITIALIZATION_DEADLINE_MS, TRANSIENT_READ_TIMEOUT } from './initialization-poll.mjs';

// The failure this guards against: a real run created its dog world successfully,
// then the very next read of the world list hit the plugin core client's 5 s read
// timeout while the first build was still running, and the whole case was thrown
// away as "initialization failed". A retried read must fix that without ever
// retrying the creation, without hiding a terminal world state, and without
// extending the step's overall deadline.
const driver = fs.readFileSync(new URL('./client-native.mjs', import.meta.url), 'utf8');
const helper = fs.readFileSync(new URL('./initialization-poll.mjs', import.meta.url), 'utf8');

/** A deterministic clock: sleeping never really waits, it only moves time. */
function clock(start = 1_000_000) {
  const state = { t: start, sleeps: [] };
  return {
    state,
    now: () => state.t,
    async sleep(ms) { state.sleeps.push(ms); state.t += ms; },
  };
}
const timeout = () => { const error = new Error('Craftmine Rust request timed out'); return error; };
const rows = (...entries) => ({ worlds: entries });
const row = (id, state) => ({ id, state });

test('a precisely identified transient read timeout is retried, and ready still wins', async () => {
  const time = clock();
  const script = [timeout(), timeout(), rows(row('world-1', 'building')), rows(row('world-other', 'ready')), rows(row('world-1', 'ready'))];
  const retries = [];
  const result = await pollWorldInitialization({
    read: async () => { const next = script.shift(); if (next instanceof Error) throw next; return next; },
    worldId: 'world-1', deadline: time.state.t + 900000, now: time.now, sleep: time.sleep, onRetry: event => retries.push(event),
  });
  assert.equal(result.row.state, 'ready');
  assert.equal(result.row.id, 'world-1');
  assert.equal(result.retries, 2);
  assert.equal(result.reads, 5);
  assert.deepEqual(retries.map(event => event.attempt), [1, 2]);
  assert.match(retries[0].message, /Craftmine Rust request timed out/);
  assert.equal(script.length, 0, 'every scripted read must have been consumed');
});

test('the host-prefixed form of the same timeout is the same transient error', () => {
  assert.equal(isTransientReadTimeout(new Error('Error: Craftmine Rust request timed out')), true);
  assert.equal(isTransientReadTimeout(new Error('Craftmine Rust request timed out')), true);
});

test('a timeout that is not exactly the product read timeout is never retried', async () => {
  const errors = [
    new Error('Rust request timed out'),
    new Error('Craftmine Rust request timed out unexpectedly'),
    new Error('Craftmine Rust request timed out: cancelled'),
    new Error('P8_RPC_TIMEOUT:worldNavigation'),
    new Error('Error: Window is not ready'),
    new Error('P8_CLIENT_EXITED:initialization'),
  ];
  for (const error of errors) {
    const time = clock();
    let reads = 0;
    await assert.rejects(pollWorldInitialization({
      read: async () => { reads += 1; throw error; },
      worldId: 'world-1', deadline: time.state.t + 900000, now: time.now, sleep: time.sleep,
    }), thrown => String(thrown.message) === String(error.message));
    assert.equal(reads, 1, 'a non-transient error must fail on the first read: ' + error);
  }
  // A thrown non-Error is not the product read timeout either.
  const time = clock();
  await assert.rejects(pollWorldInitialization({
    read: async () => { throw 'Craftmine Rust request timed out'; },
    worldId: 'world-1', deadline: time.state.t + 900000, now: time.now, sleep: time.sleep,
  }), /Craftmine Rust request timed out/);
  assert.equal(TRANSIENT_READ_TIMEOUT.test('Craftmine Rust request timed out'), true);
  assert.equal(TRANSIENT_READ_TIMEOUT.test('Error: Craftmine Rust request timed out'), true);
  assert.equal(TRANSIENT_READ_TIMEOUT.test('Craftmine Rust request timed out unexpectedly'), false);
});

test('a terminal world state is rejected at once and never retried', async () => {
  for (const state of ['failed', 'cancelled', 'interrupted']) {
    const time = clock();
    let reads = 0;
    const script = [rows(row('world-1', state)), rows(row('world-1', 'ready'))];
    await assert.rejects(pollWorldInitialization({
      read: async () => { reads += 1; return script.shift(); },
      worldId: 'world-1', deadline: time.state.t + 900000, now: time.now, sleep: time.sleep,
    }), new RegExp('P8_INITIALIZATION_TERMINAL:' + state));
    assert.equal(reads, 1, 'a terminal state must not be retried: ' + state);
    assert.equal(script.length, 1, 'the run must stop before the later ready read');
    assert.equal(terminalState(row('world-1', state)), state);
    assert.equal(terminalState(row('world-1', 'building')), null);
    assert.equal(terminalState(null), null);
  }
});

test('a transient timeout before a terminal state still reports the terminal state', async () => {
  const time = clock();
  let reads = 0;
  const script = [timeout(), rows(row('world-1', 'failed'))];
  await assert.rejects(pollWorldInitialization({
    read: async () => { reads += 1; const next = script.shift(); if (next instanceof Error) throw next; return next; },
    worldId: 'world-1', deadline: time.state.t + 900000, now: time.now, sleep: time.sleep,
  }), /P8_INITIALIZATION_TERMINAL:failed/);
  assert.equal(reads, 2, 'the retried read is what discovers the terminal state');
  assert.deepEqual(time.state.sleeps, [1000], 'exactly one retry delay was taken');
});

test('the overall initialization deadline bounds the retries', async () => {
  const time = clock();
  assert.equal(INITIALIZATION_DEADLINE_MS, 900000, 'the existing initialization budget is unchanged');
  let reads = 0;
  await assert.rejects(pollWorldInitialization({
    read: async () => { reads += 1; throw timeout(); },
    worldId: 'world-1', deadline: time.state.t + 10000, retryDelayMs: 1000, now: time.now, sleep: time.sleep,
  }), error => {
    assert.match(error.message, /^P8_INITIALIZATION_TIMEOUT:/);
    const detail = JSON.parse(error.message.slice('P8_INITIALIZATION_TIMEOUT:'.length));
    assert.equal(detail.worldId, 'world-1');
    assert.equal(detail.retries, reads, 'every read was a retry');
    assert.match(detail.lastError, /Craftmine Rust request timed out/);
    return true;
  });
  // Ten seconds at one second per retry: the deadline decides, not an unbounded loop.
  assert.ok(reads >= 9 && reads <= 11, 'reads must be bounded by the deadline: ' + reads);
  assert.ok(time.state.t <= 1_000_000 + 10000 + 1000, 'the clock must not run far past the deadline: ' + time.state.t);
});

test('a retry that cannot fit inside the deadline is refused instead of extending it', async () => {
  const time = clock();
  let reads = 0;
  await assert.rejects(pollWorldInitialization({
    read: async () => { reads += 1; throw timeout(); },
    worldId: 'world-1', deadline: time.state.t + 500, retryDelayMs: 1000, now: time.now, sleep: time.sleep,
  }), /P8_INITIALIZATION_TIMEOUT/);
  assert.equal(reads, 1);
  assert.deepEqual(time.state.sleeps, [], 'no sleep may be taken that would pass the deadline');
});

test('an incomplete world list is polled, not failed', async () => {
  const time = clock();
  const script = [rows(), rows(row('world-1', 'building')), rows(row('world-1', 'ready'))];
  const result = await pollWorldInitialization({
    read: async () => script.shift(), worldId: 'world-1', deadline: time.state.t + 900000, now: time.now, sleep: time.sleep,
  });
  assert.equal(result.row.state, 'ready'); assert.equal(result.retries, 0); assert.equal(result.reads, 3);
});

test('the driver retries only the world list read, and keeps every timeout as it was', () => {
  // The retried call is the read-only list. Creation is never inside the poll.
  assert.ok(driver.includes("read: () => nav('world.list'), worldId: world.id"), 'the poll must read the world list');
  assert.ok(!/pollWorldInitialization\([^)]*world\.create/s.test(driver), 'world.create must never be inside the poll');
  const call = driver.slice(driver.indexOf('pollWorldInitialization({'), driver.indexOf('item.initialization ='));
  assert.ok(!/world\.create|world\.open|world\.delete|panel\(/.test(call), 'the poll may only call the list read');
  assert.ok(call.includes('deadline: Date.now() + INITIALIZATION_DEADLINE_MS'));
  assert.equal(INITIALIZATION_DEADLINE_MS, 900000, 'the existing initialization budget is unchanged');
  // No call timeout anywhere was enlarged, and the helper adds none of its own.
  assert.ok(driver.includes("reject(Error('P8_RPC_TIMEOUT:' + method)); }, timeout);"), 'the per-call rpc timeout is untouched');
  assert.ok(driver.includes('function rpc(method, payload = {}, timeout = 30000, type'));
  assert.ok(driver.includes("rpc('quit', {}, 10000)"));
  assert.ok(driver.includes("rpc('worldPanel', { channel, payload: { worldId, ...payload } }, 180000)"));
  assert.ok(!/rpc\([^)]*,\s*(?:[2-9]\d{5,}|\d{7,})\)/.test(driver), 'no rpc call may use a timeout above the existing 180000');
  assert.ok(!/timeoutMs|setTimeout\(.*,\s*\d{5,}/.test(helper), 'the helper must not add or enlarge a call timeout');
  // The helper itself only knows about a read callback.
  assert.ok(!/world\.create|world\.open|panel\(|rpc\(/.test(helper), 'the helper must not know any product command');
  assert.ok(helper.includes("TERMINAL_STATES = Object.freeze(['failed', 'cancelled', 'interrupted'])"));
});
