import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createStopControl } from './stop-control.mjs';

// P0 calls a normal stop without reading a turn id first, so the run-scoped file
// names this run and its case. The identity still comes from the driver's own
// live binding: the file can never select a session, method, path or script, and
// a request for another run or case is refused without aborting anything.
const root = fileURLToPath(new URL('../../../', import.meta.url));
fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
const out = fs.mkdtempSync(path.join(root, 'test-results/p8-run-stop-'));
const runId = '44444444-4444-4444-8444-444444444444';
const binding = { caseId: 'hammer', turnId: '11111111-1111-4111-8111-111111111111', sessionId: '22222222-2222-4222-8222-222222222222' };
const request = { format: 'craftmine.p8-run-stop/1', action: 'abort', caseId: binding.caseId, runId };

function fixture(options = {}, configured = runId) {
  const directory = fs.mkdtempSync(path.join(out, 'case-')); let calls = 0, active = true;
  const events = [];
  const sample = () => ({ ...binding, active, metrics: { ...binding, status: active ? 'running' : 'aborted', calls: { pending: active ? 1 : 0 } } });
  const controller = createStopControl({ out: directory, runId: configured, abort: async id => { assert.equal(id, 'hammer'); calls++; active = false; return { ok: true }; }, snapshot: async () => sample(), record: event => events.push(event), abortMs: 30, terminalMs: 40, pollMs: 1, ...options });
  return { controller, events, calls: () => calls, setActive: value => { active = value; }, write: (value = request) => fs.writeFileSync(controller.runFile, JSON.stringify(value)), writeRaw: value => fs.writeFileSync(controller.runFile, value) };
}

test('a run-scoped stop aborts the live turn of this run without naming the turn', async () => {
  const f = fixture(); f.write();
  const result = await f.controller.check(binding);
  assert.equal(f.calls(), 1); assert.equal(result.status, 'stopped'); assert.equal(result.cleanAbort, true);
  assert.deepEqual(result.caseId, 'hammer'); assert.equal(result.turnId, binding.turnId);
  assert.equal(f.events[0].status, 'run-stop-accepted'); assert.equal(f.events.at(-1).status, 'stopped');
  assert.equal(f.controller.requested, true);
  assert.equal(await f.controller.check(binding), result, 'a repeated check shares the one stop');
  assert.equal(f.calls(), 1);
});

test('a run-scoped stop for another run, case or action aborts nothing', async () => {
  const f = fixture();
  for (const value of [
    { ...request, runId: '55555555-5555-4555-8555-555555555555' },
    { ...request, caseId: 'dog' },
    { ...request, action: 'submit' },
    { ...request, method: 'agentPrompt' },
    { format: 'craftmine.p8-stop/1', action: 'abort', caseId: 'hammer', runId },
  ]) { f.write(value); assert.equal(await f.controller.check(binding), null, JSON.stringify(value)); }
  assert.equal(f.calls(), 0);
  assert.ok(f.events.every(event => event.status === 'rejected'));
  f.write(); await f.controller.check(binding); assert.equal(f.calls(), 1, 'a corrected request may still proceed');
});

test('an oversize, linked or non-JSON run-stop file is refused without following it', async () => {
  const f = fixture(); f.writeRaw('x'.repeat(1025));
  assert.equal(await f.controller.check(binding), null); assert.equal(f.calls(), 0);
  assert.equal(f.events.at(-1).reason, 'P8_RUN_STOP_FILE_REJECTED');
  const g = fixture(); g.writeRaw('{ not json');
  assert.equal(await g.controller.check(binding), null); assert.equal(g.calls(), 0);
  const owned = path.join(out, 'owned-run-stop.json'); fs.writeFileSync(owned, JSON.stringify(request));
  const h = fixture(); fs.linkSync(owned, h.controller.runFile);
  assert.equal(await h.controller.check(binding), null); assert.equal(h.calls(), 0);
  assert.equal(fs.readFileSync(owned, 'utf8'), JSON.stringify(request));
});

test('no run-scoped stop exists when the driver owns no run id', async () => {
  const f = fixture({}, null); f.write();
  assert.equal(await f.controller.check(binding), null); assert.equal(f.calls(), 0);
  const turn = path.join(path.dirname(f.controller.file), 'stop-request.json');
  fs.writeFileSync(turn, JSON.stringify({ format: 'craftmine.p8-stop/1', action: 'abort', caseId: binding.caseId, turnId: binding.turnId }));
  const result = await f.controller.check(binding);
  assert.equal(result.status, 'stopped'); assert.equal(f.calls(), 1, 'the turn-scoped protocol still works');
});

test('a run-scoped stop cannot rebind the session or turn the file names', async () => {
  const f = fixture(); f.write();
  await f.controller.check(binding);
  const other = { caseId: 'hammer', turnId: '99999999-9999-4999-8999-999999999999', sessionId: '88888888-8888-4888-8888-888888888888' };
  assert.throws(() => f.controller.check(other), /P8_STOP_ALREADY_BOUND/);
  assert.equal(f.calls(), 1, 'the already accepted stop is never re-sent for another turn');
  const g = fixture(); g.write({ ...request, turnId: binding.turnId, sessionId: binding.sessionId });
  assert.equal(await g.controller.check(binding), null, 'unknown fields are still refused');
  assert.equal(g.calls(), 0);
});
