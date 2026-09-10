// Directional tests for the authorized unlimited request budget.
//
// The recorded P8 run stopped at the hidden product default of 80 native
// requests while the outer driver already admitted unlimited ones. These tests
// prove the propagation that actually runs: trusted process configuration is
// turned into a durable task budget, the real `DesktopAgentRuntime` constructor
// hands it to the crafting hooks, and those hooks carry it into the reservation
// the core admits. No real model request is sent and no core, engine or packaged
// app is started.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const deps = process.env.CRAFTMINE_P8_TEST_DEPS ?? path.join(root, 'vendor/pi-desktop/packages/agent-runtime');
const require = createRequire(path.join(deps, 'package.json'));
await mkdir(path.join(root, 'test-results'), { recursive: true });
const out = await mkdtemp(path.join(root, 'test-results/p8-authorized-limits-'));
const nodePaths = [path.join(root, 'vendor/pi-desktop/apps/desktop/node_modules'), path.join(root, 'vendor/pi-desktop/node_modules')].filter(existsSync);
const bundle = async (name, source) => {
  const file = path.join(out, name + '.mjs');
  await require('esbuild').build({
    entryPoints: [path.join(root, source)],
    outfile: file,
    platform: 'node',
    format: 'esm',
    bundle: true,
    banner: {js: `import {createRequire as testCreateRequire} from 'node:module'; const require = testCreateRequire(${JSON.stringify(path.join(deps, 'package.json'))});`},
    ...(nodePaths.length ? { nodePaths } : {}),
  });
  return import(pathToFileURL(file).href);
};
// Source-level guards are read as text: the runtime file carries NUL bytes, so
// a NUL-tolerant read is required instead of a plain text scan.
const sourceText = async relative => (await readFile(path.join(root, relative), 'utf8')).replace(/\0/g, '');

const acceptance = await bundle('p8', 'vendor/pi-desktop/apps/desktop/electron/main/craftmine-acceptance-p8.ts');
const context = await bundle('context', 'vendor/pi-desktop/packages/agent-runtime/src/craftmine-context.ts');
const runtimeModule = await bundle('runtime', 'vendor/pi-desktop/packages/agent-runtime/src/runtime.ts');

const AUTHORIZED_ENV = { CRAFTMINE_HEADLESS_TEST: '1', CRAFTMINE_P8_NATIVE: '1', CRAFTMINE_P8_AUTHORIZATION_PHASE: 'parallel-20260910' };
const LIMITS = { maxRequests: null, maxTokens: null, maxCompactions: 8 };
const model = { id: 'fixture', name: 'fixture', api: 'openai-completions', provider: 'fixture', baseUrl: 'http://127.0.0.1:1', reasoning: false, input: ['text'], contextWindow: 256000, maxTokens: 4000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const snapshot = () => ({ binding: { projectId: 'project', sessionId: 'session', turnId: 'turn', taskId: 'task', baseBuild: 'v1' }, generation: 1, status: 'running', world: { id: 'world', revision: 1, buildId: 'v1', hash: 'a'.repeat(64) }, draft: { revision: 4, hash: 'b'.repeat(64) }, requirements: [], modifiedResources: [], receipts: [], jobs: [], lease: { owned: true }, budget: { requestCount: 2 } });
const input = { requestId: 'r1', purpose: 'creation', model, context: { systemPrompt: 'stable', messages: [{ role: 'user', content: 'authorized fixture', timestamp: 1 }], tools: [] }, maxOutputTokens: 4000 };

test('only a headless P8 run with a known dated phase is authorized', () => {
  assert.deepEqual(context.craftmineAuthorizedBudget(AUTHORIZED_ENV), {
    limits: LIMITS,
    authorization: { kind: 'p8-native-unlimited', phase: 'parallel-20260910' },
  });
  assert.deepEqual(context.craftmineAuthorizedBudget({ ...AUTHORIZED_ENV, CRAFTMINE_P8_AUTHORIZATION_PHASE: 'unlimited-20260910' }).limits, LIMITS);
  // The acceptance module and the runtime hooks must agree on the same decision.
  assert.deepEqual(acceptance.p8AuthorizedBudget(AUTHORIZED_ENV), context.craftmineAuthorizedBudget(AUTHORIZED_ENV));
  // Default, initial-16, unknown, incomplete and forged configurations stay at
  // the product default because no budget is produced at all.
  const refused = [
    {}, { CRAFTMINE_P8_NATIVE: '1' }, { CRAFTMINE_HEADLESS_TEST: '1' },
    { ...AUTHORIZED_ENV, CRAFTMINE_HEADLESS_TEST: '0' },
    { ...AUTHORIZED_ENV, CRAFTMINE_P8_NATIVE: undefined },
    { ...AUTHORIZED_ENV, CRAFTMINE_P8_AUTHORIZATION_PHASE: undefined },
    { ...AUTHORIZED_ENV, CRAFTMINE_P8_AUTHORIZATION_PHASE: 'initial-16' },
    { ...AUTHORIZED_ENV, CRAFTMINE_P8_AUTHORIZATION_PHASE: 'unlimited-20260909' },
    { ...AUTHORIZED_ENV, CRAFTMINE_P8_AUTHORIZATION_PHASE: 'PARALLEL-20260910' },
    { ...AUTHORIZED_ENV, CRAFTMINE_P8_AUTHORIZATION_PHASE: 'parallel-20260910 ' },
    { ...AUTHORIZED_ENV, CRAFTMINE_P8_AUTHORIZATION_PHASE: true },
    { ...AUTHORIZED_ENV, CRAFTMINE_P8_AUTHORIZATION_PHASE: 'unlimited' },
  ];
  for (const env of refused) {
    assert.equal(context.craftmineAuthorizedBudget(env), undefined, JSON.stringify(env));
    assert.equal(acceptance.p8AuthorizedBudget(env), undefined, JSON.stringify(env));
  }
});

test('the boundary removal needs its authorization, but token-null keeps working', async () => {
  const calls = [];
  const call = async (method, params) => { calls.push({ method, params }); return method === 'craftmine.context' ? snapshot() : { status: 'reserved' }; };
  const identity = () => ({ sessionId: 'session', turnId: 'turn' });
  const reserves = () => calls.filter(entry => entry.method === 'craftmine.budget.reserve');

  // An unlimited request boundary without an authorization is refused, and a
  // forged phase is refused even when the shape looks right.
  for (const budget of [{ limits: { maxRequests: null } },
    { limits: { maxRequests: null }, authorization: { kind: 'p8-native-unlimited' } },
    { limits: { maxRequests: null }, authorization: { kind: 'p8-native-unlimited', phase: 'initial-16' } },
    { limits: { maxRequests: null }, authorization: { kind: 'another' , phase: 'parallel-20260910' } }]) {
    assert.throws(() => context.createCraftmineProxyHooks(call, identity, budget), /CRAFTMINE_BUDGET_AUTHORIZATION_(REQUIRED|PHASE)/, JSON.stringify(budget));
  }
  // `maxTokens: null` is an existing legal value (it is even the product
  // default) and must not be gated by the new request-boundary authorization.
  for (const limits of [{ maxTokens: null }, { maxRequests: 80, maxTokens: null }, { maxRequests: 20, maxTokens: null, maxCompactions: 8 }]) {
    const hooks = context.createCraftmineProxyHooks(call, identity, { limits });
    await hooks.beforeRequest(input);
    assert.deepEqual(reserves().at(-1).params.limits, limits, JSON.stringify(limits));
  }
  // No budget at all: the reservation carries no limits, so the core keeps its
  // default of 80 requests.
  await context.createCraftmineProxyHooks(call, identity).beforeRequest(input);
  assert.equal('limits' in reserves().at(-1).params, false);
});

test('the authorized budget reaches the reservation through the real hooks', async () => {
  const calls = [];
  const call = async (method, params) => { calls.push({ method, params }); return method === 'craftmine.context' ? snapshot() : { status: 'reserved' }; };
  const hooks = context.createCraftmineProxyHooks(call, () => ({ sessionId: 'session', turnId: 'turn' }),
    context.craftmineAuthorizedBudget(AUTHORIZED_ENV));
  await hooks.beforeRequest(input);
  const reserve = calls.find(entry => entry.method === 'craftmine.budget.reserve');
  assert.deepEqual(reserve.params.limits, LIMITS);
  assert.deepEqual(reserve.params.binding, snapshot().binding);
  // The prepare path really ran: the host snapshot was requested first.
  assert.equal(calls[0].method, 'craftmine.context');
  assert.equal(acceptance.p8ObservedLimits({ context: { budget: { limits: { maxRequests: null, maxTokens: null } } } }).maxRequests, null);
  assert.doesNotThrow(() => acceptance.assertP8UnlimitedRequests({ maxRequests: null }));
  assert.throws(() => acceptance.assertP8UnlimitedRequests({ maxRequests: 80 }), /P8_NATIVE_REQUEST_LIMIT/);
  assert.throws(() => acceptance.assertP8UnlimitedRequests(null), /P8_NATIVE_BUDGET_UNVERIFIED/);
});

test('the real runtime constructor wires the authorized budget into its hooks', async () => {
  const hostCalls = [];
  const maybeRuntime = async budgetEnv => {
    const runtime = new runtimeModule.DesktopAgentRuntime({
      craftmineWorld: true,
      ...(budgetEnv === undefined ? {} : { craftmineBudgetEnv: budgetEnv }),
      history: [], sessionId: 'session', turnId: 'turn', mode: 'agent', thinkingLevel: 'off',
      commandShell: { id: 'bash', label: 'Bash', dialect: 'posix', available: true, isDefault: true },
      provider: { id: 'fixture', name: 'Fixture', modelId: 'fixture', baseUrl: 'http://127.0.0.1:1', apiKey: '', authKind: 'none', supportsReasoning: false, supportedThinkingLevels: ['off'], modelConfig: { source: 'generic', name: 'Fixture', baseUrl: 'http://127.0.0.1:1', input: ['text'], reasoning: false, cost: model.cost, contextWindow: 256000, maxTokens: 4000 } },
      pluginTools: [],
      host: { call: async (method, params) => { hostCalls.push({ method, params }); return method === 'craftmine.context' ? snapshot() : { status: 'reserved' }; }, onNotification: () => () => {} },
      onEvent: () => {},
    });
    // The hooks inspected here are the ones the constructor created itself, not
    // an injected fixture.
    assert.ok(runtime.craftmineHooks, 'the runtime must create craftmine hooks for a world task');
    await runtime.craftmineHooks.beforeRequest(input);
    await runtime.dispose();
  };

  await maybeRuntime(AUTHORIZED_ENV);
  const authorized = hostCalls.filter(entry => entry.method === 'craftmine.budget.reserve').at(-1);
  assert.deepEqual(authorized.params.limits, LIMITS, 'an authorized runtime must fix the unlimited budget');

  hostCalls.length = 0;
  await maybeRuntime({ ...AUTHORIZED_ENV, CRAFTMINE_P8_AUTHORIZATION_PHASE: 'initial-16' });
  assert.equal('limits' in hostCalls.filter(entry => entry.method === 'craftmine.budget.reserve').at(-1).params, false,
    'the default authorized phase must keep the product request default');

  hostCalls.length = 0;
  await maybeRuntime({});
  assert.equal('limits' in hostCalls.filter(entry => entry.method === 'craftmine.budget.reserve').at(-1).params, false,
    'an environment without the authorization must not widen the task');

  // The process environment is the option's default source, so a trusted host
  // that passes nothing still gets the authorized budget when its own process is
  // the authorized one.
  const saved = Object.fromEntries(Object.keys(AUTHORIZED_ENV).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, AUTHORIZED_ENV);
    hostCalls.length = 0;
    await maybeRuntime(undefined);
    assert.deepEqual(hostCalls.filter(entry => entry.method === 'craftmine.budget.reserve').at(-1).params.limits, LIMITS);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('the wired call sites are present in the real sources', async () => {
  // The runtime file carries NUL bytes, so it is read NUL-stripped.
  const runtime = await sourceText('vendor/pi-desktop/packages/agent-runtime/src/runtime.ts');
  assert.match(runtime, /createCraftmineProxyHooks\(/, 'the runtime must still create the proxy hooks');
  assert.match(runtime, /craftmineAuthorizedBudget\(opts\.craftmineBudgetEnv \?\? process\.env\)/,
    'the runtime must pass the authorized budget into its own hooks');
  const hooks = await sourceText('vendor/pi-desktop/packages/agent-runtime/src/craftmine-context.ts');
  assert.match(hooks, /CRAFTMINE_UNLIMITED_REQUEST_PHASES = \["parallel-20260910", "unlimited-20260910"\]/);
  assert.match(hooks, /authorization: budget\.authorization/, 'the proxy hooks must forward the authorization');
  const driver = await sourceText('tests/player-feedback/P8/client-native.mjs');
  assert.match(driver, /CRAFTMINE_P8_AUTHORIZATION_PHASE: authorization\.phase/,
    'the trusted parent must pass the verified phase to the child it launches');
});
