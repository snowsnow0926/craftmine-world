import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dependencyRoot = process.env.CRAFTMINE_NATIVE_DEPENDENCY_ROOT || root;
const require = createRequire(path.join(dependencyRoot, 'vendor/pi-desktop/apps/desktop/package.json'));
const { transformSync } = require('esbuild');
const source = readFileSync(path.join(root, 'vendor/pi-desktop/apps/desktop/electron/main/index.ts'), 'utf8');
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const extracted = slice('function finishTurn(', 'async function finishApprovedExecution(') + '\n' +
  slice('function persistAgentEvent(', 'function superviseRestart(');
const code = transformSync(extracted, { loader: 'ts', format: 'cjs', target: 'es2022' }).code;

function fixture() {
  const calls = [], rows = [], checkpoints = [], usages = [], executions = [];
  const activeTurns = new Map([['session', 'current']]);
  const activeTurnUsages = new Map();
  const turnFinalizations = new Map();
  const dependencies = {
    activeTurns, activeTurnUsages, turnFinalizations,
    approvedExecutionIdsBySession: new Map([['session', 'execution']]),
    approvedExecutionTurns: new Map([['execution', { turnId: 'current' }]]),
    pendingExecutionFinishes: new Map(), planSubmissionTurnIds: new Set(),
    planSubmissionTurnKey: (s, t) => `${s}:${t}`, activeToolCallKey: (s, t) => `${s}:${t}`,
    activeToolCalls: new Map(), scheduledRunsBySession: new Map(), turnSettlements: new Map(),
    logger: { app() {} }, craftmineTelemetry: { finishAgentJob() {} }, craftmineGateway: { end() {} },
    craftmineMaintenanceContexts: { has: () => false }, plugins: { endCraftmineTurn: async () => {} },
    shouldCreateTaskNotification: () => false,
    host: { call: async (method, args) => { calls.push({ method, args }); return {}; } },
    persistenceOutbox: { size: () => 0, flush: async () => {}, enqueue: async row => { rows.push(row); } },
    inflightCheckpointer: { observe: value => checkpoints.push(value), flush: async () => {}, settleIf() {} },
    addActiveTurnUsage: (sessionId, usage) => { usages.push({ sessionId, usage }); activeTurnUsages.set(sessionId, usage); },
    subagentTagged: (message, envelope) => ({ ...message, ...(envelope.parentToolCallId ? { parentToolCallId: envelope.parentToolCallId } : {}) }),
    finishApprovedExecution: async (...args) => { executions.push(args); },
    sendToRenderer() {}, IPC: { event: {} }, setImmediate,
    setTimeout: () => ({ unref() {} }),
    taskMetricsAdmissionFailures: new Set(),
    taskMetricsRecorder: { drain: async identity => { calls.push({ method: 'metrics.drain', args: identity }); return { complete: true }; }, release: identity => calls.push({ method: 'metrics.release', args: identity }) },
  };
  const api = new Function(...Object.keys(dependencies), `${code}\nreturn {persistAgentEvent,finishTurn};`)(...Object.values(dependencies));
  return { ...api, dependencies, calls, rows, checkpoints, usages, executions, activeTurns, turnFinalizations };
}
const envelope = (event, turnId = 'current', extra = {}) => ({ sessionId: 'session', turnId, ts: 1234, event, ...extra });
const error = { type: 'error', error: { code: 'PROVIDER_FAILED', message: 'late provider failure', retriable: false } };
const assistant = (id = 'answer') => ({ type: 'message_end', message: { id, role: 'assistant', content: 'original reply', status: 'complete', usage: { inputTokens: 11, outputTokens: 7 } } });
async function settle(f) { await Promise.all([...f.turnFinalizations.values()]); await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); }

test('late old root error and agent_end cannot finish or archive the current turn', async () => {
  const f = fixture();
  for (const event of [error, { type: 'agent_end' }]) f.persistAgentEvent(envelope(event, 'old'));
  await settle(f);
  assert.equal(f.activeTurns.get('session'), 'current');
  assert.deepEqual(f.calls, []); assert.deepEqual(f.executions, []);
});
test('delegate terminal events cannot finish the parent even with the current turn ID', async () => {
  const f = fixture();
  for (const event of [error, { type: 'agent_end' }]) f.persistAgentEvent(envelope(event, 'current', { parentToolCallId: 'Task-1' }));
  await settle(f);
  assert.equal(f.activeTurns.get('session'), 'current'); assert.deepEqual(f.calls, []);
});
test('old, missing and delegate usage cannot be attributed to the current root', () => {
  const f = fixture();
  for (const [turnId, extra] of [['old', {}], [null, {}], ['current', { parentToolCallId: 'Task-1' }]]) {
    f.persistAgentEvent(envelope(assistant(), turnId, extra));
    f.persistAgentEvent(envelope({ type: 'turn_end', subagentUsage: { inputTokens: 3 } }, turnId, extra));
  }
  assert.deepEqual(f.usages, []); assert.deepEqual(f.checkpoints, []);
  assert.equal(f.rows[0].turnId, 'old'); assert.equal(f.rows[1].turnId, null);
  assert.equal(f.rows[2].message.parentToolCallId, 'Task-1');
});
test('late message updates cannot overwrite the current inflight checkpoint', () => {
  const f = fixture();
  f.persistAgentEvent(envelope({ ...assistant(), type: 'message_update' }, 'old'));
  f.persistAgentEvent(envelope({ ...assistant(), type: 'message_update' }));
  assert.equal(f.checkpoints.length, 1); assert.equal(f.checkpoints[0].turnId, 'current');
});
test('current root usage and normal agent_end still persist and finalize once', async () => {
  const f = fixture();
  f.persistAgentEvent(envelope(assistant()));
  f.persistAgentEvent(envelope({ type: 'turn_end', subagentUsage: { inputTokens: 3 } }));
  f.persistAgentEvent(envelope({ type: 'agent_end' }));
  f.persistAgentEvent(envelope({ type: 'agent_end' }));
  await settle(f);
  assert.equal(f.usages.length, 2); assert.equal(f.rows[0].turnId, 'current');
  const ends = f.calls.filter(x => x.method === 'session.endTurn');
  assert.equal(ends.length, 1); assert.equal(ends[0].args.turnId, 'current'); assert.equal(ends[0].args.status, 'completed');
  assert.equal(f.activeTurns.size, 0);
});
test('current root error ends the correct turn with its original failure', async () => {
  const f = fixture(); f.persistAgentEvent(envelope(error)); await settle(f);
  const end = f.calls.find(x => x.method === 'session.endTurn');
  assert.equal(end.args.turnId, 'current'); assert.equal(end.args.status, 'error'); assert.equal(end.args.errorCode, 'PROVIDER_FAILED');
});
test('finishTurn rechecks expected identity before joining an existing finalization', async () => {
  const f = fixture(); const never = new Promise(() => {}); f.turnFinalizations.set('session', never);
  const result = f.finishTurn('session', 'error', 'LATE', { expectedTurnId: 'old' });
  assert.notEqual(result, never); await result; assert.deepEqual(f.calls, []);
  assert.equal(f.finishTurn('session', 'completed', undefined, { expectedTurnId: 'current' }), never);
});
test('unowned terminal envelopes never borrow the current turn identity', async () => {
  const f = fixture(); f.persistAgentEvent(envelope(error, null)); f.persistAgentEvent(envelope({ type: 'agent_end' }, null));
  await settle(f); assert.deepEqual(f.calls, []); assert.equal(f.activeTurns.get('session'), 'current');
});
test('revision archive holds ownership until completion and a late old finish cannot archive the next turn', async () => {
  const f = fixture();
  let releaseArchive, enteredArchive;
  const blocked = new Promise(resolve => { releaseArchive = resolve; });
  const entered = new Promise(resolve => { enteredArchive = resolve; });
  const originalCall = f.dependencies.host.call;
  f.dependencies.host.call = async (method, args) => {
    const result = await originalCall(method, args);
    if (method === 'session.saveActiveRevision') { enteredArchive(); await blocked; }
    return result;
  };
  f.persistAgentEvent(envelope({ type: 'agent_end' }));
  await entered;
  assert.equal(f.activeTurns.get('session'), 'current');
  assert.equal(f.turnFinalizations.has('session'), true);
  assert.equal(f.executions.length, 0);
  f.persistAgentEvent(envelope({ type: 'agent_end' }));
  f.persistAgentEvent(envelope(error, 'old'));
  releaseArchive(); await settle(f);
  assert.equal(f.calls.filter(x => x.method === 'session.saveActiveRevision').length, 1);
  assert.equal(f.calls.filter(x => x.method === 'session.endTurn').length, 1);
  f.activeTurns.set('session', 'next');
  f.persistAgentEvent(envelope({ type: 'agent_end' })); await settle(f);
  assert.equal(f.activeTurns.get('session'), 'next');
  assert.equal(f.calls.filter(x => x.method === 'session.saveActiveRevision').length, 1);
});
