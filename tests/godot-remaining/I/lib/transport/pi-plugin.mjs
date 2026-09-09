// Real product adapter for task R8 (was I): drives the actual integrated stack —
// the pinned PI agent runtime, the real craftmine.world plugin subprocess and the
// real craftmine-core binary — instead of a mock tool or the author's own source.
//
// This is a *client-side* adapter. It does not implement a second world database,
// model loop or privileged execution path: every write goes through the product's
// own tools and core RPC, and every observation is read back from the product.
//
// No real input is ever sent: there is no browser, no mouse, no keyboard, no
// pointer lock and no window activation anywhere in this module.
import fs from 'node:fs';
import path from 'node:path';
import {register} from 'node:module';
import {fork} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {randomUUID, createHash} from 'node:crypto';

export const PI_PLUGIN_TRANSPORT = 'pi-plugin';
export const PI_PLUGIN_FORMAT = 'craftmine.i.pi-plugin-adapter/1';

export class PiPluginUnavailable extends Error {
  constructor(reason, detail = null) {
    super(`real product adapter unavailable: ${reason}`);
    this.name = 'PiPluginUnavailable';
    this.reason = reason;
    this.detail = detail;
  }
}

const PLUGIN_PERMISSIONS = ['ui.view', 'agent.tool.register', 'background.service', 'fs.read'];

export function piPluginConfig(env = process.env, root = process.cwd()) {
  return {
    root,
    secretsFile: env.CRAFTMINE_I_LIVE_CONFIG ?? null,
    coreBin: env.CRAFTMINE_CORE_BIN ?? path.join(root, 'vendor/pi-desktop/target/release/craftmine-core.exe'),
    plugin: env.CRAFTMINE_I_PLUGIN_DIR ?? path.join(root, 'desktop/build/craftmine.world'),
    dataDir: env.CRAFTMINE_I_DATA_DIR ?? null,
    toolBudget: Number(env.CRAFTMINE_I_TOOL_BUDGET ?? 40),
    requestBudget: Number(env.CRAFTMINE_I_REQUEST_BUDGET ?? 24),
    maxTokens: Number(env.CRAFTMINE_MAX_TOKENS ?? 32768),
    turnTimeoutMs: Number(env.CRAFTMINE_I_TURN_TIMEOUT_MS ?? 15 * 60 * 1000),
  };
}

// Availability is decided from real prerequisites only; nothing is invented.
export async function probePiPlugin({env = process.env, root = process.cwd()} = {}) {
  const config = piPluginConfig(env, root);
  const problems = [];
  if (!config.secretsFile || !path.isAbsolute(config.secretsFile)) problems.push('CRAFTMINE_I_LIVE_CONFIG must be an absolute path to the authorized project secrets file');
  else if (!fs.existsSync(config.secretsFile)) problems.push(`secrets file not found: ${config.secretsFile}`);
  if (!fs.existsSync(config.coreBin)) problems.push(`craftmine-core binary not found: ${config.coreBin}`);
  if (!fs.existsSync(path.join(config.plugin, 'main.cjs'))) problems.push(`built plugin not found: ${config.plugin}`);
  if (problems.length) return {available: false, reason: 'pi-plugin-prerequisites-missing', detail: problems.join('; '), endpoints: null};
  let identity = null;
  try {
    const {loadLocalConfig} = await import(pathToFileURL(path.join(root, 'app/local-config.mjs')).href);
    const appliedKeys = loadLocalConfig(config.secretsFile);
    const model = await import(pathToFileURL(path.join(root, 'app/agent-model.mjs')).href);
    identity = {
      provider: model.modelProvider(),
      modelId: model.modelId(),
      thinking: model.thinkingEnabled() ? model.reasoningEffort() : 'off',
      credentialPresent: Boolean(model.deepseekKey()),
      appliedKeys,
    };
    if (!identity.credentialPresent) problems.push('no configured credential for the product model provider');
  } catch (error) {
    problems.push(`model configuration unreadable: ${error.message}`);
  }
  return problems.length
    ? {available: false, reason: 'pi-plugin-prerequisites-missing', detail: problems.join('; '), endpoints: null}
    : {available: true, reason: 'ok', identity, endpoints: {tools: 'plugins/craftmine-world', core: 'craftmine-core stdio JSON-lines'}};
}

export async function createPiPluginSession({config, onEvent = () => {}} = {}) {
  const root = config.root;
  const desktop = path.join(root, 'vendor/pi-desktop/apps/desktop');
  const agentRuntimeModules = path.join(root, 'vendor/pi-desktop/packages/agent-runtime/node_modules/@earendil-works');
  for (const required of [desktop, agentRuntimeModules, config.coreBin, config.plugin]) {
    if (!fs.existsSync(required)) throw new PiPluginUnavailable('pi-plugin-prerequisites-missing', `missing ${required}`);
  }
  if (!config.secretsFile || !fs.existsSync(config.secretsFile)) throw new PiPluginUnavailable('pi-plugin-prerequisites-missing', 'authorized secrets file is required');

  const {loadLocalConfig} = await import(pathToFileURL(path.join(root, 'app/local-config.mjs')).href);
  loadLocalConfig(config.secretsFile);
  const modelModule = await import(pathToFileURL(path.join(root, 'app/agent-model.mjs')).href);
  if (modelModule.modelProvider() !== 'deepseek' || !modelModule.deepseekKey()) {
    throw new PiPluginUnavailable('model-credential-missing', 'the configured product model provider and credential are required; no fallback model is used');
  }

  const {Agent} = await import(pathToFileURL(path.join(agentRuntimeModules, 'pi-agent-core/dist/index.js')).href);
  const {streamSimple} = await import(pathToFileURL(path.join(agentRuntimeModules, 'pi-ai/dist/api/openai-completions.js')).href);

  register(pathToFileURL(path.join(desktop, 'test/helpers/ts-import-hooks.mjs')));
  const {PluginRuntime, pluginProcessEnv} = await import(pathToFileURL(path.join(desktop, 'electron/main/plugin-runtime.ts')).href);
  const hostEntry = path.join(desktop, 'electron/main/plugin-host-process.mjs');

  const dataDir = config.dataDir ?? (fs.mkdirSync(path.join(root, 'test-results'), {recursive: true}), fs.mkdtempSync(path.join(root, 'test-results/r8-real-')));
  fs.mkdirSync(dataDir, {recursive: true});
  const profileDir = path.join(dataDir, 'profile');
  fs.mkdirSync(profileDir, {recursive: true});
  const previousDataDir = process.env.PI_DESKTOP_DATA_DIR;
  process.env.PI_DESKTOP_DATA_DIR = profileDir;

  const stderr = [];
  const runtime = new PluginRuntime({
    hostEntry,
    spawnProcess: ({entry, pluginId}) => {
      const child = fork(entry, [], {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: pluginProcessEnv(pluginId, {...process.env, CRAFTMINE_CORE_BIN: config.coreBin})});
      child.stderr?.on('data', chunk => stderr.push(chunk.toString()));
      return {
        postMessage: value => { if (child.connected) child.send(value); },
        onMessage: handler => child.on('message', handler),
        onExit: handler => child.on('exit', code => handler(code ?? 0)),
        kill: () => child.kill(),
      };
    },
  });

  const session = {
    format: PI_PLUGIN_FORMAT,
    dataDir,
    identity: {
      model: {provider: 'deepseek', modelId: modelModule.modelId(), thinking: modelModule.thinkingEnabled() ? modelModule.reasoningEffort() : 'off'},
      engine: {name: 'godot', version: '4.7.2-stable', renderer: 'gl_compatibility'},
      core: {binary: path.basename(config.coreBin), sha256: sha256File(config.coreBin)},
      plugin: {path: path.relative(root, config.plugin).split(path.sep).join('/')},
      inputPolicy: {kind: 'no-input', inputEventsSent: 0, pointerLockRequests: 0, focusSteals: 0, browserLaunched: false},
    },
    calls: [],
    requests: [],
    errors: [...stderr],
    world: null,
    sessionId: randomUUID(),
    turnId: randomUUID(),
    projectId: 'r8-live',
    runtime,
  };

  const context = () => ({projectId: session.projectId, sessionId: session.sessionId, turnId: session.turnId});
  const tool = name => runtime.getTools().find(entry => entry.name === name);

  session.callTool = async (name, args = {}, {record = true} = {}) => {
    const entry = tool(name);
    if (!entry) throw new Error(`PRODUCT_TOOL_MISSING: ${name}`);
    const recordEntry = {name, args, at: new Date().toISOString(), toolCallId: `r8-${randomUUID()}`, turnId: session.turnId};
    if (record) session.calls.push(recordEntry);
    try {
      const result = await entry.execute(args, {...context(), toolCallId: recordEntry.toolCallId, executionId: randomUUID()});
      recordEntry.ok = true;
      recordEntry.result = result;
      return result;
    } catch (error) {
      recordEntry.ok = false;
      recordEntry.error = String(error?.message ?? error);
      recordEntry.code = error?.errorCode ?? error?.code ?? null;
      throw error;
    }
  };
  session.tryTool = async (name, args = {}, options) => {
    try { return {ok: true, result: await session.callTool(name, args, options)}; }
    catch (error) { return {ok: false, error: String(error?.message ?? error), code: error?.errorCode ?? error?.code ?? null}; }
  };
  session.runtimeInfo = () => session.callTool('runtime_info', {}, {record: false});
  session.readProject = () => session.tryTool('godot_project_index', {}, {record: false});
  session.readFile = (file, {revision, manifestHash} = {}) => session.tryTool('godot_file_read', {path: file, revision, manifestHash, offset: 0, limit: 16000}, {record: false});

  await runtime.loadFromPath(config.plugin, PLUGIN_PERMISSIONS);
  session.tools = runtime.getTools().map(entry => entry.name);
  onEvent({type: 'plugin-loaded', tools: session.tools.length});

  session.createWorld = async title => {
    const world = await runtime.invokePanelBridge('craftmine.world', 'world.create', {title});
    session.world = world;
    return world;
  };

  session.prompt = async (text, {systemPrompt, toolBudget = config.toolBudget, requestBudget = config.requestBudget, beforeEnd = null} = {}) => {
    const bindTools = () => runtime.getTools().filter(entry => entry.name !== 'runtime_info').map(entry => ({
      name: entry.fullName,
      label: entry.name,
      description: entry.description,
      parameters: entry.schema,
      executionMode: 'sequential',
      execute: async (toolCallId, args, signal) => {
        if (signal?.aborted) throw new Error('Aborted before tool execution');
        const record = {name: entry.name, args, toolCallId, turnId: session.turnId, at: new Date().toISOString()};
        session.calls.push(record);
        onEvent({type: 'tool-call', name: entry.name});
        try {
          const result = await entry.execute(args, {...context(), toolCallId, executionId: randomUUID()});
          record.ok = true;
          record.result = result;
          return {content: [{type: 'text', text: JSON.stringify(result)}], details: result};
        } catch (error) {
          record.ok = false;
          record.error = String(error?.message ?? error);
          record.code = error?.errorCode ?? error?.code ?? null;
          throw error;
        }
      },
    }));
    const model = {
      id: modelModule.modelId(), name: modelModule.modelId(), provider: 'deepseek', api: 'openai-completions',
      baseUrl: 'https://api.deepseek.com', reasoning: true, input: ['text'],
      cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
      contextWindow: 1000000, maxTokens: config.maxTokens,
      compat: {thinkingFormat: 'deepseek', supportsDeveloperRole: false, maxTokensField: 'max_tokens'},
    };
    const agent = new Agent({
      initialState: {systemPrompt, model, tools: bindTools(), thinkingLevel: modelModule.thinkingEnabled() ? modelModule.reasoningEffort() : 'off'},
      streamFn: (m, ctx, options) => {
        const request = {turnId: session.turnId, model: m.id, messages: ctx.messages.length, at: new Date().toISOString()};
        session.requests.push(request);
        onEvent({type: 'model-request', index: session.requests.length});
        if (session.requests.length > requestBudget) agent.abort();
        return streamSimple(m, ctx, {...options, maxTokens: config.maxTokens, maxRetries: 1});
      },
      getApiKey: () => modelModule.deepseekKey(),
      toolExecution: 'sequential',
      beforeToolCall: async () => (session.calls.length >= toolBudget ? {block: true, terminate: true, reason: 'R8 acceptance tool budget exhausted'} : undefined),
    });
    agent.subscribe(event => {
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        const {usage, stopReason, errorMessage} = event.message;
        const last = session.requests.at(-1);
        if (last) last.response = {usage, stopReason, ...(errorMessage ? {errorMessage} : {})};
      }
    });
    const timeout = setTimeout(() => agent.abort(), config.turnTimeoutMs);
    session.agent = agent;
    try {
      await agent.prompt(text);
    } finally {
      clearTimeout(timeout);
      await agent.waitForIdle().catch(() => {});
      // Read-only observation must happen while the turn is still open: the
      // product refuses tool calls after the turn ended.
      if (beforeEnd) await beforeEnd().catch(() => {});
      await runtime.endCraftmineTurn({...context(), status: 'completed'}).catch(() => {});
    }
    return {requests: session.requests.length, calls: session.calls.length, messages: agent.state.messages.length};
  };

  session.newTurn = async () => { session.turnId = randomUUID(); };

  session.usage = () => {
    const totals = {calls: 0, promptTokens: 0, cachedReadTokens: 0, nonCachedInputTokens: 0, outputTokens: 0, totalTokens: 0, unknownCalls: 0};
    for (const request of session.requests) {
      const usage = request.response?.usage;
      if (!usage) { totals.unknownCalls += 1; continue; }
      totals.calls += 1;
      totals.promptTokens += usage.input ?? usage.promptTokens ?? 0;
      totals.cachedReadTokens += usage.cacheRead ?? usage.cachedReadTokens ?? 0;
      totals.nonCachedInputTokens += (usage.input ?? 0) - (usage.cacheRead ?? 0);
      totals.outputTokens += usage.output ?? usage.outputTokens ?? 0;
      totals.totalTokens += usage.totalTokens ?? ((usage.input ?? 0) + (usage.output ?? 0));
    }
    return totals;
  };

  session.transcript = () => (session.agent?.state.messages ?? []).map(message => ({
    role: message.role,
    content: Array.isArray(message.content) ? message.content.filter(block => block.type !== 'thinking') : message.content,
  }));

  session.close = async () => {
    try { await session.agent?.waitForIdle?.(); } catch { /* best effort */ }
    for (const entry of runtime.listLoaded()) await runtime.unload(entry.manifest.id).catch(() => {});
    if (previousDataDir === undefined) delete process.env.PI_DESKTOP_DATA_DIR;
    else process.env.PI_DESKTOP_DATA_DIR = previousDataDir;
  };

  return session;
}

function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
