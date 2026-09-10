import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createStopControl } from './stop-control.mjs';
import { createP8Relay, MODEL, ENDPOINT } from './relay.mjs';
import { openRequestJournal } from './evidence.mjs';
import { p8Authorization } from './authorization.mjs';
const root = fileURLToPath(new URL('../../../', import.meta.url));
fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
const out = fs.mkdtempSync(path.join(root, 'test-results/p8-stop-control-'));
const binding = { caseId: 'hammer', turnId: '11111111-1111-4111-8111-111111111111', sessionId: '22222222-2222-4222-8222-222222222222' };
const request = { format: 'craftmine.p8-stop/1', action: 'abort', caseId: binding.caseId, turnId: binding.turnId };
function fixture(options = {}) {
  const dir = fs.mkdtempSync(path.join(out, 'case-')); let calls = 0, active = true;
  const events = [];
  const sample = () => ({ ...binding, active, metrics: { ...binding, status: active ? 'running' : 'aborted', calls: { pending: active ? 1 : 0 } } });
  const controller = createStopControl({ out: dir, abort: async id => { assert.equal(id, 'hammer'); calls++; active = false; return { ok: true }; }, snapshot: async () => sample(), record: event => events.push(event), abortMs: 30, terminalMs: 40, pollMs: 1, ...options });
  return { controller, events, sample, calls: () => calls, setActive: value => { active = value; }, write: (value = request) => fs.writeFileSync(controller.file, JSON.stringify(value)) };
}
test('one real abort callback followed by same-turn terminal evidence; repeats share result', async () => {
  const f = fixture(); f.write();
  const first = f.controller.check(binding), repeat = f.controller.check(binding);
  assert.equal(first, repeat); const result = await first;
  assert.equal(f.calls(), 1); assert.equal(result.status, 'stopped'); assert.equal(result.cleanAbort, true); assert.equal(result.snapshot.active, false);
  assert.equal(await f.controller.check(binding), result); assert.equal(f.calls(), 1);
  assert.throws(() => f.controller.check({ ...binding, caseId: 'dog' }), /P8_STOP_ALREADY_BOUND/);
});
test('missing, stale, unknown fields and actions cannot call abort; corrected request may proceed', async () => {
  const f = fixture(); assert.equal(await f.controller.check(binding), null);
  for (const value of [{ ...request, turnId: '33333333-3333-4333-8333-333333333333' }, { ...request, caseId: 'dog' }, { ...request, method: 'agentPrompt' }, { ...request, action: 'submit' }]) { f.write(value); assert.equal(await f.controller.check(binding), null); }
  assert.equal(f.calls(), 0); f.write(); await f.controller.check(binding); assert.equal(f.calls(), 1);
});
test('oversize and linked request files are refused without following them', async () => {
  const f = fixture(); fs.writeFileSync(f.controller.file, 'x'.repeat(1025)); assert.equal(await f.controller.check(binding), null);
  const g = fixture(), owned = path.join(out, 'owned-stop.json'); fs.writeFileSync(owned, JSON.stringify(request)); fs.linkSync(owned, g.controller.file);
  assert.equal(await g.controller.check(binding), null); assert.equal(g.calls(), 0); assert.equal(fs.readFileSync(owned, 'utf8'), JSON.stringify(request));
});
test('terminal completion race does not send abort but still stops the run', async () => {
  const f = fixture(); f.setActive(false); f.write(); const result = await f.controller.check(binding);
  assert.equal(f.calls(), 0); assert.equal(result.acknowledged, false); assert.equal(result.status, 'stopped');
});
test('ack waits for delayed inactive state and zero pending metrics', async () => {
  let samples = 0;
  const f = fixture({ snapshot: async () => { samples++; const value = f.sample(); if (samples < 4) return { ...value, active: true, metrics: { ...value.metrics, status: 'running', calls: { pending: 1 } } }; return value; } }); f.write();
  const result = await f.controller.check(binding); assert.equal(result.cleanAbort, true); assert.equal(f.calls(), 1); assert.ok(samples >= 4);
});
test('stop ownership does not depend on retaining diagnostic history', async () => {
  const f = fixture({ record: () => {} }); f.write(); assert.equal(f.controller.requested, false);
  await f.controller.check(binding); assert.equal(f.controller.requested, true); assert.equal(f.calls(), 1);
});
test('acknowledgment alone is not terminal; no duplicate abort on timeout', async () => {
  let calls = 0; const f = fixture({ abort: async () => { calls++; return { ok: true }; } }); f.write();
  await assert.rejects(f.controller.check(binding), /P8_STOP_TERMINAL_TIMEOUT/); assert.equal(calls, 1);
  await assert.rejects(f.controller.check(binding), /P8_STOP_TERMINAL_TIMEOUT/); assert.equal(calls, 1);
  assert.equal(f.events.at(-1).status, 'failed');
});
test('unknown lost abort response is never retried or called a clean abort', async () => {
  let calls = 0; const f = fixture({ abort: async () => { calls++; f.setActive(false); throw Error('lost reply'); } }); f.write();
  const result = await f.controller.check(binding); assert.equal(calls, 1); assert.equal(result.cleanAbort, false); assert.match(result.abortError, /lost reply/);
});
test('only exact pre-dispatch P8_BUSY may retry', async () => {
  let calls = 0; const f = fixture({ abort: async () => { calls++; if (calls === 1) throw Error('Error: P8_BUSY'); f.setActive(false); return { ok: true }; } }); f.write();
  assert.equal((await f.controller.check(binding)).cleanAbort, true); assert.equal(calls, 2);
});
test('changed session/turn cannot abort; a hanging sample is bounded', async () => {
  const f = fixture({ snapshot: async () => ({ ...f.sample(), metrics: { ...f.sample().metrics, turnId: '33333333-3333-4333-8333-333333333333' } }) }); f.write();
  await assert.rejects(f.controller.check(binding), /P8_STOP_TURN_CHANGED/); assert.equal(f.calls(), 0);
  const g = fixture({ snapshot: () => new Promise(() => {}) }); g.write();
  await assert.rejects(g.controller.check(binding), /P8_STOP_TERMINAL_TIMEOUT/); assert.equal(g.calls(), 0);
});
test('hanging abort is bounded and is not repeated', async () => {
  let calls = 0; const f = fixture({ abort: () => { calls++; return new Promise(() => {}); } }); f.write();
  await assert.rejects(f.controller.check(binding), /P8_STOP_TERMINAL_TIMEOUT/); assert.equal(calls, 1);
});
test('dated unlimited phase shares one journal across root checkouts; legacy is unchanged', () => {
  const env = { CRAFTMINE_P8_AUTHORIZATION_PHASE: 'unlimited-20260910' };
  const a = p8Authorization(env, path.join(out, 'root-a')), b = p8Authorization(env, path.join(out, 'root-b'));
  assert.equal(a.journalPath, b.journalPath); assert.equal(a.requestLimit, null); assert.equal(a.previousPhaseAdmissions, 50);
  assert.equal(p8Authorization({}, root).requestLimit, 16);
  assert.throws(() => p8Authorization({ CRAFTMINE_P8_AUTHORIZATION_PHASE: 'unknown' }, root), /P8_UNKNOWN_AUTHORIZATION_PHASE/);
});
test('unlimited admission keeps exclusive durable ordering beyond 16 and after reopen without secret or network', async () => {
  const file = path.join(out, 'synthetic-journal.ndjson'); let journal = openRequestJournal(file, { requestLimit: null });
  assert.throws(() => openRequestJournal(file, { requestLimit: null }), /EEXIST/);
  let forwarded = 0;
  const config = async () => ({ endpoint: ENDPOINT, model: MODEL, key: 'sk-synthetic-test-only' });
  const start = () => createP8Relay({ requestLimit: null, initialAttempts: journal.initialAttempts, configuration: config, persist: async event => { if (event.kind === 'request') journal.reserve(event.attempt, 'hammer', out); }, forward: async () => { forwarded++; return new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }); } });
  let relay = await start();
  const send = async () => { const response = await fetch(relay.baseUrl + '/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + relay.auth }, body: JSON.stringify({ model: MODEL, stream: true, max_tokens: 32, messages: [{ role: 'user', content: 'offline fixture' }] }) }); assert.equal(response.status, 200); await response.text(); };
  try { for (let i = 0; i < 17; i++) await send(); } finally { await relay.close(); journal.close(); }
  journal = openRequestJournal(file, { requestLimit: null }); relay = await start();
  try { await send(); assert.equal(journal.entries.length, 18); assert.equal(forwarded, 18); assert.equal(relay.snapshot().limit, null); }
  finally { await relay.close(); journal.close(); }
  assert.ok(!fs.readFileSync(file, 'utf8').includes('sk-synthetic'));
});
