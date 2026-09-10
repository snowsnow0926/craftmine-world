import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir, mkdtemp } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { createP8Relay, parseAuthorizedConfiguration, createSecretRedactor, MODEL, ENDPOINT } from './relay.mjs';
import { openRequestJournal, normalizedProviderUsage, reconcileMetrics, unwrapP8ProductReply } from './evidence.mjs';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const deps = process.env.CRAFTMINE_P8_TEST_DEPS ?? 'D:/cm-fb-20260910/vendor/pi-desktop/packages/agent-runtime';
const require = createRequire(path.join(deps, 'package.json'));
await mkdir(path.join(root, 'test-results'), { recursive: true });
const out = await mkdtemp(path.join(root, 'test-results/p8-preflight-'));
await require('esbuild').build({ entryPoints: [path.join(root, 'vendor/pi-desktop/apps/desktop/electron/main/craftmine-acceptance-p8.ts')], outfile: path.join(out, 'p8.mjs'), platform: 'node', format: 'esm', bundle: true,
  banner: {js: `import {createRequire as testCreateRequire} from 'node:module'; const require = testCreateRequire(${JSON.stringify(path.join(deps, 'package.json'))});`} });
const { createP8Acceptance, p8SubmissionContent, P8_PROMPTS } = await import(pathToFileURL(path.join(out, 'p8.mjs')));
const fakeKey = 'sk-fixed-synthetic-fixture';
const configuration = async () => ({ key: fakeKey, endpoint: ENDPOINT, model: MODEL });
const body = { model: MODEL, stream: true, max_tokens: 100, messages: [{ role: 'user', content: 'owned synthetic fixture' }] };
const send = (relay, input = body, options = {}) => fetch(relay.baseUrl + '/chat/completions', { method: 'POST', headers: { authorization: 'Bearer ' + relay.auth, 'content-type': 'application/json' }, body: JSON.stringify(input), ...options });

test('corrective submissions retain the original request and explicit bounded feedback', () => {
  assert.equal(p8SubmissionContent('hammer'), P8_PROMPTS.hammer);
  const text=p8SubmissionContent('hammer','The previous candidate had no visible equipped mesh.');
  assert.ok(text.startsWith(P8_PROMPTS.hammer));
  assert.ok(text.includes('不代表上一轮通过'));
  assert.ok(text.endsWith('The previous candidate had no visible equipped mesh.'));
  for(const input of ['',true,{},'x'.repeat(12001)])assert.throws(()=>p8SubmissionContent('dog',input),/P8_INVALID_FEEDBACK/);
});

test('configuration parsing is exact and errors disclose no input content', () => {
  assert.deepEqual(parseAuthorizedConfiguration(`https://api.deepseek.com/\n${MODEL}\n${fakeKey}`), { key: fakeKey, endpoint: ENDPOINT, model: MODEL });
  for (const bad of [`https://example.com\n${MODEL}\n${fakeKey}`, `https://api.deepseek.com/\ndeepseek-chat\n${fakeKey}`, `https://api.deepseek.com/\n${MODEL}\n${fakeKey}\nsk-extra`]) assert.throws(() => parseAuthorizedConfiguration(bad), error => error.message === 'P8_AUTHORIZED_CONFIGURATION_MISMATCH');
});
test('stream redaction keeps a credential crossing chunk boundaries private', () => {
  for (let split = 1; split < fakeKey.length; split++) {
    const redactor = createSecretRedactor([fakeKey]); const result = redactor.push('before ' + fakeKey.slice(0, split)) + redactor.push(fakeKey.slice(split) + ' after') + redactor.push('', true);
    assert.equal(result, 'before [REDACTED] after');
  }
});
test('only exact POST/model/route/auth forwards and the seventeenth request is blocked before upstream', async () => {
  let forwarded = 0, read = 0; const evidence = [];
  const relay = await createP8Relay({ configuration: async () => { read++; return configuration(); }, persist: async record => evidence.push(record), forward: async (url, options) => { forwarded++; assert.equal(url, ENDPOINT); assert.equal(options.redirect, 'error'); assert.equal(options.headers.authorization, `Bearer ${fakeKey}`); return new Response(`data: ${JSON.stringify({ model: MODEL, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } }); } });
  try {
    assert.equal(read, 0); assert.equal((await send(relay, { ...body, model: 'deepseek-chat' })).status, 400);
    assert.equal((await fetch(relay.baseUrl + '/models')).status, 403);
    assert.equal((await send(relay, body, { headers: { 'content-type': 'application/json', authorization: 'Bearer invalid' } })).status, 403);
    assert.equal(forwarded, 0);
    for (let i = 0; i < 15; i++) { const response = await send(relay); assert.equal(response.status, 200); await response.text(); }
    const concurrent = await Promise.all([send(relay), send(relay)]); assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 429]); await Promise.all(concurrent.map(r => r.text()));
    assert.equal(forwarded, 16); assert.equal(relay.snapshot().attempts.length, 16);
    assert.ok(evidence.filter(item => item.kind === 'response').every(item => item.attempt.sse.usageReports[0].total_tokens === 15));
    assert.ok(!JSON.stringify(evidence).includes(fakeKey));
  } finally { await relay.close(); }
});
test('retained admitted requests cannot regain quota after restarting the relay', async () => {
  let forwarded = false;
  const relay = await createP8Relay({ initialAttempts: Array.from({ length: 16 }, (_, i) => ({ id: i + 1, endpoint: ENDPOINT, requestedModel: MODEL })), configuration, persist: async () => {}, forward: async () => { forwarded = true; throw Error('must not forward'); } });
  try { assert.equal((await send(relay)).status, 429); assert.equal(forwarded, false); } finally { await relay.close(); }
});
test('provider error is counted, never retried or substituted, and credentials are redacted before client/evidence', async () => {
  const evidence = []; let forwards = 0;
  const relay = await createP8Relay({ configuration, persist: async item => evidence.push(item), forward: async () => { forwards++; return new Response(`{"error":"${fakeKey} invalid model"}`, { status: 400, headers: { 'content-type': 'application/json' } }); } });
  try { const response = await send(relay); assert.equal(response.status, 400); assert.ok(!(await response.text()).includes(fakeKey)); assert.equal(forwards, 1); assert.equal(relay.snapshot().attempts[0].passedTransport, false); assert.ok(!JSON.stringify(evidence).includes(fakeKey)); } finally { await relay.close(); }
});

function fixture(godot = { observe: async () => ({ format: 'craftmine.godot-observation/1', worldId: 'world-hammer', baseId: 'first-person', buildId: 'formal-build', instanceId: 'formal-instance' }) }) {
  let selected = 'world-hammer'; const calls = [], scripts = []; let active = false, taskStatus = 'completed';
  const sessionId = '11111111-1111-4111-8111-111111111111', providerId = '22222222-2222-4222-8222-222222222222';
  const contents = { isDestroyed: () => false, executeJavaScript: async script => { scripts.push(script); if (script === 'document.body.dataset.worldId') return selected; return { accepted: true, turnId: 'turn-fixture' }; } };
  const run = createP8Acceptance({ enabled: true, window: () => ({ isDestroyed: () => false, webContents: contents }), world: () => contents,
    call: async (method, params) => { calls.push({ method, params }); if (method === 'session.turnMetrics') return {status:taskStatus}; if (method === 'providers.create') return { provider: { id: providerId } }; if (method === 'session.create') return { session: { id: sessionId } }; if (method === 'session.get') return { session: { id: sessionId, providerId, modelId: MODEL, messages: [] } }; return null; }, panel: async () => ({ activeWorldId: selected, worlds: [{ id: selected, baseId: 'first-person', runtimeKind: 'godot' }] }), active: () => active, godot,
  }, { CRAFTMINE_P8_NATIVE: '1', CRAFTMINE_P8_PROXY_BASE: 'http://127.0.0.1:12345/' + 'a'.repeat(48) + '/deepseek.com/v1', CRAFTMINE_P8_PROXY_AUTH: 'b'.repeat(64) });
  return { run, calls, scripts, setSelected: value => { selected = value; }, setActive: value => { active = value; }, setStatus: value => {taskStatus=value;} };
}

test('continuation is fixed, bounded and refuses running, failed or aborted tasks', async () => {
  const f=fixture(); await f.run('initialize',{caseId:'hammer',worldId:'world-hammer'});
  await assert.rejects(f.run('continue',{caseId:'hammer'}),/TERMINAL_REQUIRED/);
  await f.run('submit',{caseId:'hammer'}); f.setActive(true);
  await assert.rejects(f.run('continue',{caseId:'hammer'}),/TERMINAL_REQUIRED/); f.setActive(false);
  for(const status of ['error','aborted']){f.setStatus(status);await assert.rejects(f.run('continue',{caseId:'hammer'}),/COMPLETED_REQUIRED/);}
  f.setStatus('completed');
  await assert.rejects(f.run('continue',{caseId:'hammer',prompt:'arbitrary'}),/INVALID_REQUEST/);
  for(let i=0;i<3;i++)await f.run('continue',{caseId:'hammer'});
  await assert.rejects(f.run('continue',{caseId:'hammer'}),/CONTINUE_LIMIT/);
  const prompts=f.scripts.filter(x=>x.includes('piDesktop.channels.invoke.agentPrompt'));
  assert.equal(prompts.length,4);assert.ok(prompts.slice(1).every(x=>x.includes('thunder_hammer')&&x.includes('不要重建世界')));
});
test('finite helper uses real provider/session configuration and a fixed product prompt only once', async () => {
  const f = fixture(); const result = await f.run('initialize', { caseId: 'hammer', worldId: 'world-hammer' });
  assert.equal(result.modelId, MODEL); assert.equal(f.calls.find(x => x.method === 'providers.create').params.defaultModelId, MODEL);
  assert.ok(f.calls.find(x => x.method === 'providers.create').params.baseUrl.startsWith('http://127.0.0.1:'));
  await f.run('submit', { caseId: 'hammer' }); await assert.rejects(f.run('submit', { caseId: 'hammer' }), /ALREADY_SUBMITTED/);
  assert.equal(f.scripts.filter(x => x.includes('piDesktop.channels.invoke.agentPrompt')).length, 1);
  assert.ok(f.scripts.find(x => x.includes('piDesktop.channels.invoke.agentPrompt')).includes('thunder_hammer'));
  assert.ok(!JSON.stringify(f.calls).includes(fakeKey));
});
test('unknown fields/methods and asynchronous world changes cannot rebind a case or send a prompt', async () => {
  const f = fixture();
  for (const [method, payload] of [['execute', { caseId: 'hammer' }], ['initialize', { caseId: 'hammer', worldId: 'world-hammer', path: 'forbidden' }], ['submit', { caseId: 'hammer', prompt: 'arbitrary' }]]) await assert.rejects(f.run(method, payload), /INVALID_REQUEST/);
  assert.equal(f.calls.length, 0); await f.run('initialize', { caseId: 'hammer', worldId: 'world-hammer' }); f.setSelected('world-other');
  await assert.rejects(f.run('submit', { caseId: 'hammer' }), /WORLD_CHANGED/);
  await assert.rejects(f.run('initialize', { caseId: 'hammer', worldId: 'world-other' }), /BINDING_CONFLICT/);
  assert.equal(f.scripts.filter(x => x.includes('piDesktop.channels.invoke.agentPrompt')).length, 0);
});

test('real file journal retains admissions, excludes a concurrent owner and fails closed on incomplete bytes', () => {
  const file = path.join(out, 'journal.ndjson'); const first = openRequestJournal(file);
  assert.throws(() => openRequestJournal(file), /EEXIST/);
  first.reserve({ id: 1, endpoint: ENDPOINT, requestedModel: MODEL }, 'hammer', out); first.close();
  const second = openRequestJournal(file); assert.equal(second.initialAttempts.length, 1); assert.throws(() => second.reserve({ id: 1 }, 'hammer', out), /ADMISSION_ORDER/); second.close();
  fs.appendFileSync(file, '{'); assert.throws(() => openRequestJournal(file), /INCOMPLETE_JOURNAL/);
});

test('usage reconciliation preserves cache/reasoning semantics and rejects invented tokens or TPS', () => {
  const raw = { prompt_tokens: 100, prompt_cache_hit_tokens: 60, completion_tokens: 20, completion_tokens_details: { reasoning_tokens: 5 } };
  const usage = normalizedProviderUsage(raw); assert.equal(usage.inputTokens, 40); assert.equal(usage.totalTokens, 120);
  const binding = { sessionId: 's', providerId: 'p' }, calls = [{ providerId: 'p', modelId: MODEL, usage, generationStartedAtMs: 1500, endedAtMs: 2500 }];
  const metrics = { format: 'craftmine.task-metrics/1', sessionId: 's', status: 'completed', startedAtMs: 1000, endedAtMs: 3000, wallTimeMs: 2000, calls: { observed: 1, reported: 1, pending: 0 }, usage, tps: { generationMs: 1000, outputTokens: 20, value: 20 }, models: [{ providerId: 'p', modelId: MODEL }], coverage: 'complete' };
  const upstream = [{ passedTransport: true, sse: { usageReports: [raw] } }];
  assert.equal(reconcileMetrics(metrics, calls, upstream, binding).providerUsageReports, 1);
  assert.throws(() => reconcileMetrics({ ...metrics, usage: { ...usage, totalTokens: 125 } }, calls, upstream, binding));
  assert.throws(() => reconcileMetrics({ ...metrics, tps: { ...metrics.tps, value: 25 } }, calls, upstream, binding));
});

test('the upstream receives original JSON bytes without model or protocol translation', async () => {
  const payload = JSON.stringify(body, null, 2) + '\n'; let received;
  const relay = await createP8Relay({ configuration, persist: async () => {}, forward: async (_url, options) => { received = options.body; return new Response('data: [DONE]\n\n'); } });
  try { await (await send(relay, body, { body: payload })).text(); assert.equal(received, payload); } finally { await relay.close(); }
});

test('fixed exercise retains actual failures, rejects extra commands, and aborts on instance change', async () => {
  const operations = []; let instanceId = 'owned-first'; let change = false;
  const f = fixture({ observe: async () => ({ format: 'craftmine.godot-observation/1', worldId: 'world-hammer', baseId: 'first-person', buildId: 'b', instanceId }),
    action: async (op, args) => { operations.push([op, args]); if (change) instanceId = 'foreign'; return { error: 'synthetic missing authored item' }; },
    capture: async (width, height) => ({ width, height, pngBase64: 'iVBORw0KGgo' }),
  });
  await f.run('initialize', { caseId: 'hammer', worldId: 'world-hammer' });
  await assert.rejects(f.run('exercise', { caseId: 'hammer', op: 'arbitrary' }), /INVALID_REQUEST/);
  const result = await f.run('exercise', { caseId: 'hammer' });
  // The plan is fixed: resume, a bounded pickup scan over three headings and eight
  // ground-covering pitches at two distances, equip, then the attack gate and the
  // walk-in. A fixture that always refuses interact must run the whole scan, so the
  // plan shape is fully predictable here.
  const ops = operations.map(entry => entry[0]);
  assert.equal(ops[0], 'resume');
  assert.equal(ops.filter(op => op === 'look').length, 16 * 8 * 2 + 1, 'the scan headings and pitches plus the aim reset');
  assert.equal(ops.filter(op => op === 'interact').length, 16 * 8 * 2, 'one interaction per scan direction and distance');
  assert.ok(operations.some(([op,args]) => op === 'look' && args.yaw < -Math.PI / 2), 'pickups behind the right shoulder must be searched');
  assert.equal(ops.filter(op => op === 'fire').length, 7, 'the gate pair, the reopen and the walk-in shots');
  assert.equal(ops.filter(op => op === 'walk').length, 5, 'the scan advance, its return and three walk-ins');
  assert.equal(result.plan.actions, ops.length);
  assert.ok(result.actions.every(action => action.result.error));
  assert.ok(result.actions.every(action => action.observation && Number.isFinite(action.observedAtMs)));
  const frames = result.actions.filter(action => action.frame);
  assert.ok(frames.length > 0 && frames.length <= result.plan.maxFrames);
  assert.ok(frames.every(action => action.frame.pngBase64.startsWith('iVBORw0KGgo')));
  assert.ok(operations.some(([op, args]) => op === 'equip' && args.value === 'thunder_hammer'));
  assert.equal(result.passed, undefined);
  operations.length = 0; change = true; await assert.rejects(f.run('exercise', { caseId: 'hammer' }), /RUNTIME_CHANGED/); assert.equal(operations.length, 1);
});

test('the fixed dog sequence walks away before its far-range talk', async () => {
  const operations = [], dogWorld = 'world-dog';
  const contents = { isDestroyed: () => false, executeJavaScript: async script => (script === 'document.body.dataset.worldId' ? dogWorld : { accepted: true, turnId: 'turn-fixture' }) };
  const godot = { observe: async () => ({ format: 'craftmine.godot-observation/1', worldId: dogWorld, baseId: 'top-down', buildId: 'formal-build', instanceId: 'owned-dog' }),
    action: async (op, args) => { operations.push([op, args]); return { error: 'synthetic missing authored item' }; },
    capture: async (width, height) => ({ width, height, pngBase64: 'iVBORw0KGgo' }) };
  const run = createP8Acceptance({ enabled: true, window: () => ({ isDestroyed: () => false, webContents: contents }), world: () => contents,
    call: async method => (method === 'providers.create' ? { provider: { id: '22222222-2222-4222-8222-222222222222' } } : method === 'session.create' ? { session: { id: '11111111-1111-4111-8111-111111111111' } } : null),
    panel: async () => ({ activeWorldId: dogWorld, worlds: [{ id: dogWorld, baseId: 'top-down', runtimeKind: 'godot' }] }), active: () => false, godot,
  }, { CRAFTMINE_P8_NATIVE: '1', CRAFTMINE_P8_PROXY_BASE: 'http://127.0.0.1:12345/' + 'a'.repeat(48) + '/deepseek.com/v1', CRAFTMINE_P8_PROXY_AUTH: 'b'.repeat(64) });
  await run('initialize', { caseId: 'dog', worldId: dogWorld });
  const result = await run('exercise', { caseId: 'dog' });
  const ops = operations.map(entry => entry[0]);
  // Near talk, short follow leg, far leg in two directions, then the walk back.
  assert.deepEqual(ops.slice(0, 10), ['resume', 'talk', 'move', 'wait', 'talk', 'move', 'wait', 'move', 'wait', 'talk']);
  assert.ok(ops.length > 10 && ops.at(-1) === 'talk', 'the walk back and its talk are recorded');
  // This fixture reports neither a distance nor an overlap, so the retrace has no
  // measured path to follow: it must record that honestly instead of inventing one.
  assert.equal(result.retrace.southPx, 0);
  assert.equal(result.retrace.complete, false);
  assert.equal(result.retrace.contact, false);
  assert.ok(operations.filter(entry => entry[0] === 'move').every(entry => entry[1].steps <= 600));
  assert.equal(operations[1][1].npcId, 'p8-dog');
  const shortLeg = operations.find(([op, args]) => op === 'move' && args.steps === 200);
  const farLeg = operations.find(([op, args]) => op === 'move' && args.steps === 600);
  assert.ok(shortLeg && farLeg, 'both a short follow leg and a long far leg are issued');
  assert.ok(operations.filter(entry => entry[0] === 'move').every(entry => entry[1].steps <= 600 && Math.abs(entry[1].dx) <= 1 && Math.abs(entry[1].dy) <= 1));
  assert.equal(result.actions.length, ops.length, 'every performed operation must be recorded');
  assert.ok(result.actions.filter(action => action.frame).length <= result.plan.maxFrames);
  assert.ok(result.actions.every(action => action.result.error));
});

test('private list without navigation state requires a real matching loaded runtime before provider creation', async () => {
  const valid = { format: 'craftmine.godot-observation/1', worldId: 'world-hammer', baseId: 'first-person', buildId: 'formal-build', instanceId: 'formal-instance' };
  for (const observed of [null, { ...valid, worldId: 'world-other' }, { ...valid, baseId: 'top-down' }, { ...valid, instanceId: '' }, { ...valid, buildId: null }]) {
    const f = fixture({ observe: async () => observed }); await assert.rejects(f.run('initialize', { caseId: 'hammer', worldId: 'world-hammer' }), /READY_BASE_REQUIRED/); assert.equal(f.calls.length, 0);
  }
  const good = fixture(); assert.equal((await good.run('initialize', { caseId: 'hammer', worldId: 'world-hammer' })).worldId, 'world-hammer');
});

test('product submit and abort envelopes unwrap without weakening accepted/turn identity', () => {
  const accepted = { accepted: true, turnId: 'actual-turn' };
  assert.deepEqual(unwrapP8ProductReply({ ok: true, data: accepted }), accepted);
  assert.deepEqual(unwrapP8ProductReply({ ok: true, data: { aborted: true } }), { aborted: true });
  for (const invalid of [null, [], accepted, { ok: true }, { ok: 1, data: accepted }, { ok: true, data: accepted, extra: true }, { ok: false, error: {} }]) assert.throws(() => unwrapP8ProductReply(invalid));
  assert.throws(() => unwrapP8ProductReply({ ok: false, error: { message: 'TURN_BUSY' } }), /TURN_BUSY/);
  assert.equal(unwrapP8ProductReply({ ok: true, data: { accepted: false } }).accepted, false);
});
