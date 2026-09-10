import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const runtime = process.env.CRAFTMINE_METRICS_TEST_RUNTIME ?? path.join(root, 'vendor/pi-desktop/packages/agent-runtime');
const require = createRequire(path.join(runtime, 'package.json'));
const { build } = require('esbuild');
await mkdir(path.join(root, 'test-results'), { recursive: true });
const out = await mkdtemp(path.join(root, 'test-results/task-metrics-js-'));
await build({ entryPoints: [path.join(root, 'vendor/pi-desktop/apps/desktop/electron/main/task-metrics-recorder.ts')], outfile: path.join(out, 'recorder.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { createTaskMetricsRecorder } = await import(pathToFileURL(path.join(out, 'recorder.mjs')));
const { observeModelStream } = await import(pathToFileURL(path.join(runtime, 'dist/task-metrics-stream.js')));
const { DesktopAgentRuntime } = await import(pathToFileURL(path.join(runtime, 'dist/runtime.js')));
const { createAssistantMessageEventStream } = await import(pathToFileURL(path.join(runtime, 'node_modules/@earendil-works/pi-ai/dist/index.js')));
const identity = { sessionId: 'session-a', turnId: 'turn-a' };
const call = { callId: 'call-a', providerId: 'provider-a', modelId: 'model-a', source: 'agent', startedAtMs: 1000, generationStartedAtMs: null, endedAtMs: null, outcome: 'running', usage: null };
const envelope = (value = call, owner = identity) => ({ ...owner, ts: 1000, event: { type: 'model_call', call: value } });
const done = { ...call, generationStartedAtMs: 1100, endedAtMs: 3100, outcome: 'completed', usage: { inputTokens: 100, outputTokens: 200, totalTokens: 900, cacheReadTokens: 600 } };
const message = { role: 'assistant', content: [{ type: 'text', text: 'fixture' }], api: 'openai-completions', provider: 'binding', model: 'model-a', timestamp: 1000, stopReason: 'stop', usage: { input: 100, output: 200, cacheRead: 600, cacheWrite: 0, totalTokens: 900, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
const model = { id: 'model-a', api: 'openai-completions', provider: 'binding' };

test('provider stream forwards exact output and records first delta to terminal before forwarding', async () => {
  const inner = createAssistantMessageEventStream(); const observations = []; let time = 1000;
  const wrapped = observeModelStream({ model, providerId: 'runtime-provider', source: 'agent', create: () => inner, emit: item => observations.push(item), clock: () => time, id: () => 'attempt-a' });
  time = 1100; const delta = { type: 'text_delta', contentIndex: 0, delta: 'fixture', partial: message };
  inner.push(delta); await new Promise(resolve => setImmediate(resolve));
  time = 3100; const terminal = { type: 'done', reason: 'stop', message }; inner.push(terminal); inner.end(message);
  const forwarded = []; for await (const event of wrapped) { forwarded.push(event); if (event.type === 'done') assert.equal(observations.length, 2); }
  assert.deepEqual(forwarded, [delta, terminal]); assert.deepEqual(await wrapped.result(), message);
  assert.deepEqual(observations[1], { ...done, callId: 'attempt-a', providerId: 'runtime-provider' });
});

test('result-only compaction and separate retries retain independent attempt identities', async () => {
  const observations = [];
  for (const source of ['agent', 'agent', 'subagent', 'compaction']) {
    const inner = createAssistantMessageEventStream();
    const stream = observeModelStream({ model, providerId: 'p', source, create: () => inner, emit: item => observations.push(item) });
    inner.push({ type: 'done', reason: 'stop', message }); inner.end(message);
    assert.deepEqual(await stream.result(), message);
  }
  assert.equal(observations.length, 8); assert.equal(new Set(observations.map(c => c.callId)).size, 4);
  assert.ok(observations.filter(c => c.outcome === 'completed').every(c => c.generationStartedAtMs === null && c.usage.totalTokens === 900));
});

test('actual runtime capture keeps old turn and provider binding across a late terminal event', async () => {
  const events = []; const inner = createAssistantMessageEventStream();
  const receiver = { sessionId: 'session-a', turnId: 'old-turn', provider: { id: 'old-provider' }, onEvent: item => events.push(item), emit: DesktopAgentRuntime.prototype.emit };
  const wrapped = DesktopAgentRuntime.prototype.trackedModelStream.call(receiver, model, 'agent', () => inner);
  receiver.turnId = 'new-turn'; receiver.provider.id = 'new-provider';
  inner.push({ type: 'done', reason: 'stop', message }); inner.end(message); await wrapped.result();
  assert.equal(events.length, 2); assert.ok(events.every(event => event.sessionId === 'session-a' && event.turnId === 'old-turn' && event.event.call.providerId === 'old-provider'));
});

test('setup failure and aborted placeholder usage remain unknown, without character estimates', async () => {
  const observations = [];
  const failure = observeModelStream({ model, providerId: 'p', source: 'agent', create: () => { throw Error('fixed setup error'); }, emit: item => observations.push(item) });
  assert.equal((await failure.result()).stopReason, 'error'); assert.equal(observations[1].usage, null);
  const inner = createAssistantMessageEventStream();
  const stopped = { ...message, stopReason: 'aborted', usage: undefined };
  const stream = observeModelStream({ model, providerId: 'p', source: 'agent', create: () => inner, emit: item => observations.push(item) });
  inner.push({ type: 'error', reason: 'aborted', error: stopped }); inner.end(stopped);
  await stream.result(); assert.equal(observations[3].outcome, 'aborted'); assert.equal(observations[3].usage, null);
});

test('queue drains exact start/end, clones facts and includes delegated envelopes', async () => {
  const writes = []; let release;
  const wait = new Promise(resolve => { release = resolve; });
  const recorder = createTaskMetricsRecorder({ isCurrent: () => true, call: async (method, params) => { writes.push({ method, params }); await wait; return { ok: true }; } });
  const input = envelope(structuredClone(call)); recorder.observe(input); input.event.call.modelId = 'changed-after-event';
  const settled = recorder.drain(identity);
  recorder.observe({ ...envelope(done), parentToolCallId: 'task-child' });
  release(); assert.deepEqual(await settled, { complete: true, errors: [] });
  assert.deepEqual(writes.map(w => w.params.call), [call, done]); recorder.release(identity);
});

test('lost reply retries same immutable payload and never changes owner to active session', async () => {
  const writes = []; let first = true;
  const recorder = createTaskMetricsRecorder({ isCurrent: () => true, call: async (method, params) => { writes.push({ method, params }); if (first) { first = false; throw Error('lost reply'); } return { ok: true }; } });
  recorder.observe(envelope(done)); recorder.observe(envelope({ ...done, callId: 'call-b' }, { sessionId: 'session-b', turnId: 'turn-b' }));
  assert.equal((await recorder.drain(identity)).complete, true);
  await recorder.drain({ sessionId: 'session-b', turnId: 'turn-b' });
  const original = writes.filter(w => w.params.turnId === 'turn-a'); assert.equal(original.length, 2); assert.deepEqual(original[0], original[1]);
  assert.throws(() => recorder.observe(envelope(done, { sessionId: 'session-a' })), /IDENTITY_REQUIRED/);
});

test('permanent refusal or invalid receipt persists explicit gap; gap failure rejects drain', async () => {
  for (const invalid of [false, true]) {
    const writes = [];
    const recorder = createTaskMetricsRecorder({ isCurrent: () => true, call: async (method, params) => { writes.push({ method, params }); if (method === 'session.metricsUnavailable') return { ok: true }; if (invalid) return { ok: false }; throw Error('disk write failed'); } });
    recorder.observe(envelope(done)); assert.equal((await recorder.drain(identity)).complete, false);
    assert.deepEqual(writes.map(w => w.method), ['session.observeModelCall', 'session.observeModelCall', 'session.metricsUnavailable']);
    assert.deepEqual(writes[2].params, identity);
  }
  const failed = createTaskMetricsRecorder({ isCurrent: () => true, call: async () => { throw Error('storage unavailable'); } });
  failed.observe(envelope(done)); await assert.rejects(failed.drain(identity), /storage unavailable/);
});

test('bounded observation capacity records durable gap once instead of silently dropping facts', async () => {
  let gaps = 0, writes = 0;
  const recorder = createTaskMetricsRecorder({ isCurrent: () => true, call: async method => { if (method === 'session.metricsUnavailable') gaps++; else writes++; return { ok: true }; } });
  for (let i = 0; i < 8200; i++) recorder.observe(envelope({ ...call, callId: `call-${i}` }));
  const result = await recorder.drain(identity); assert.equal(result.complete, false); assert.equal(writes, 8192); assert.equal(gaps, 1);
});

test('gap write rejection never poisons later healthy calls and drain preserves the failed gap latch', async () => {
  const writes = []; let blocked = true;
  const recorder = createTaskMetricsRecorder({ isCurrent: () => true, call: async (method, params) => {
    writes.push({ method, params }); if (blocked) throw Error('fixed unavailable storage'); return { ok: true };
  } });
  recorder.observe(envelope(done)); await assert.rejects(recorder.drain(identity), /fixed unavailable storage/);
  blocked = false; recorder.observe(envelope({ ...done, callId: 'healthy-after-gap' }));
  await assert.rejects(recorder.drain(identity), /fixed unavailable storage/);
  assert.equal(writes.length, 4); assert.equal(writes.at(-1).params.call.callId, 'healthy-after-gap');
  assert.equal(writes.at(-1).method, 'session.observeModelCall');
});

test('drain waits for healthy events appended while the failed gap write is in flight', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; }); const writes = [];
  const recorder = createTaskMetricsRecorder({ isCurrent: () => true, call: async (method, params) => {
    writes.push({ method, params }); if (method === 'session.metricsUnavailable') { await gate; throw Error('fixed failed gap'); }
    if (params.call.callId === 'call-a') throw Error('fixed failed call'); return { ok: true };
  } });
  recorder.observe(envelope(done)); const drained = recorder.drain(identity); const rejection = assert.rejects(drained, /fixed failed gap/);
  await new Promise(resolve => setImmediate(resolve));
  recorder.observe(envelope({ ...done, callId: 'healthy-during-drain' })); release(); await rejection;
  assert.equal(writes.at(-1).params.call.callId, 'healthy-during-drain');
});

test('late released owners never recreate queues; current delegated calls remain admitted by root identity', async () => {
  const active = new Map(); const writes = [];
  const recorder = createTaskMetricsRecorder({ isCurrent: owner => active.get(owner.sessionId) === owner.turnId, call: async (method, params) => { writes.push({ method, params }); return { ok: true }; } });
  const old = [];
  for (let i = 0; i < 140; i++) {
    const owner = { sessionId: `session-${i}`, turnId: `turn-${i}` }; old.push(owner); active.set(owner.sessionId, owner.turnId);
    recorder.observe(envelope(done, owner)); await recorder.drain(owner); recorder.release(owner); active.delete(owner.sessionId);
  }
  for (const owner of old) recorder.observe(envelope(done, owner));
  active.set(identity.sessionId, 'current-turn');
  recorder.observe(envelope(done, { ...identity, turnId: 'old-turn' }));
  const owner = { ...identity, turnId: 'current-turn' };
  recorder.observe({ ...envelope({ ...done, callId: 'delegated', source: 'subagent' }, owner), parentToolCallId: 'child-tool' });
  assert.equal((await recorder.drain(owner)).complete, true);
  assert.equal(writes.length, 141); assert.equal(writes.at(-1).params.call.source, 'subagent'); assert.equal(writes.at(-1).params.turnId, 'current-turn');
});

await writeFile(path.join(out, 'scope.json'), JSON.stringify({ scope: 'Production stream/recorder with deterministic provider event fixtures; no model, Electron or UI execution.', output: out }, null, 2));
