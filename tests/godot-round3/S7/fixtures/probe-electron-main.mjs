// S7 Electron-host product probe.
//
// Runs inside a hidden, offscreen Electron main process so the real
// `GodotBuildVerifier` can be injected into the real `PluginRuntime`. That is
// the one service the plain-Node S7 probe cannot supply, and it is what turns a
// managed build job from "queued and rejected" into a real isolated check.
//
// Everything below is product code: the real plugin host process, the real
// `craftmine-core.exe`, the real plugin bundle, the real isolated check window.
// No window is shown, nothing takes focus, and no input is ever sent.
import {app} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {fork} from 'node:child_process';
import {createHash} from 'node:crypto';
import {PluginRuntime, pluginProcessEnv} from '../../../../vendor/pi-desktop/apps/desktop/electron/main/plugin-runtime';
import {GodotBuildVerifier} from '../../../../vendor/pi-desktop/apps/desktop/electron/main/godot-build-verifier';

const arg = name => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
};
const repo = path.resolve(arg('repo') ?? process.cwd());
const dataDir = path.resolve(arg('data-dir') ?? path.join(repo, 'test-results', 's7-electron-data'));
const outDir = path.resolve(arg('out') ?? path.join(repo, 'test-results', 's7-electron-out'));
const pluginDir = path.join(repo, 'desktop', 'build', 'craftmine.world');
const coreBin = process.env.CRAFTMINE_CORE_BIN ?? path.join(repo, 'vendor', 'pi-desktop', 'target', 'release', 'craftmine-core.exe');
const engineCache = process.env.CRAFTMINE_GODOT_CACHE_DIR ?? null;
const brokerSource = process.env.CRAFTMINE_GODOT_BROKER_BIN ?? path.join(repo, 'desktop', 'godot', 'sandbox', 'target', 'debug', 'godot-host-broker.exe');
const PERMISSIONS = ['ui.view', 'agent.tool.register', 'background.service', 'fs.read'];

fs.mkdirSync(outDir, {recursive: true});
fs.mkdirSync(path.join(dataDir, 'profile'), {recursive: true});
app.setPath('userData', path.join(dataDir, 'electron-profile'));
app.disableHardwareAcceleration();

const log = (...parts) => {
  const line = parts.join(' ');
  fs.appendFileSync(path.join(outDir, 'console.log'), `${line}\n`);
  process.stdout.write(`${line}\n`);
};
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');

const report = {
  kind: 'craftmine.godot.round3.s7.electron-probe/1',
  startedAt: new Date().toISOString(),
  electron: process.versions.electron,
  source: {plugin: pluginDir, core: coreBin, coreSha256: fs.existsSync(coreBin) ? sha256(fs.readFileSync(coreBin)) : null},
  provisioning: null,
  steps: [],
  toolCalls: [],
  limits: [
    'Proves the isolated check and the candidate path inside the real Electron host; it does not apply an application or run the game window.',
    'The world is created through the product panel bridge and the source is written with the product tools; nothing is written by hand.',
  ],
};
const step = async (name, body) => {
  const started = Date.now();
  try {
    const detail = await body();
    report.steps.push({name, passed: true, ms: Date.now() - started, detail: detail ?? null});
    log(`PASS ${name} (${Date.now() - started}ms)`);
    return {ok: true, detail};
  } catch (error) {
    report.steps.push({name, passed: false, ms: Date.now() - started, error: String(error?.message ?? error), code: error?.code ?? error?.errorCode ?? null});
    log(`FAIL ${name}: ${String(error?.message ?? error)}`);
    return {ok: false};
  }
};

// The host strips every CRAFTMINE_GODOT_* variable before spawning the plugin,
// so the toolchain must exist inside the plugin data directory. This mirrors the
// packaged layout an installer would create.
function provisionToolchain() {
  const pluginData = path.join(dataDir, 'profile', 'plugins', 'data', 'craftmine.world');
  const result = {pluginData, broker: null, engine: null, bridge: null, lock: null, errors: []};
  try {
    fs.mkdirSync(path.join(pluginData, 'bin'), {recursive: true});
    fs.mkdirSync(path.join(pluginData, 'godot', 'web'), {recursive: true});
    fs.mkdirSync(path.join(pluginData, 'godot', 'engine'), {recursive: true});
    const brokerTarget = path.join(pluginData, 'bin', 'godot-host-broker.exe');
    fs.copyFileSync(brokerSource, brokerTarget);
    result.broker = {sha256: sha256(fs.readFileSync(brokerTarget))};
    const bridgeSource = path.join(repo, 'desktop', 'godot', 'web', 'bridge.js');
    fs.copyFileSync(bridgeSource, path.join(pluginData, 'godot', 'web', 'bridge.js'));
    result.bridge = {sha256: sha256(fs.readFileSync(bridgeSource))};
    const lockSource = path.join(repo, 'desktop', 'godot', 'toolchain.lock.json');
    fs.copyFileSync(lockSource, path.join(pluginData, 'godot', 'toolchain.lock.json'));
    result.lock = {sha256: sha256(fs.readFileSync(lockSource))};
    if (!engineCache || !fs.existsSync(engineCache)) throw new Error('CRAFTMINE_GODOT_CACHE_DIR must point at the pinned engine cache');
    const engineRoot = path.join(pluginData, 'godot', 'engine', '4.7.2-stable');
    if (fs.existsSync(engineRoot)) {
      if (fs.lstatSync(engineRoot).isSymbolicLink()) fs.unlinkSync(engineRoot);
      else fs.rmSync(engineRoot, {recursive: true, force: true});
    }
    fs.cpSync(path.join(engineCache, 'editor'), path.join(engineRoot, 'editor'), {recursive: true});
    fs.cpSync(path.join(engineCache, 'templates'), path.join(engineRoot, 'templates'), {recursive: true});
    result.engine = {root: engineRoot, editorSha256: sha256(fs.readFileSync(path.join(engineRoot, 'editor', 'Godot_v4.7.2-stable_win64.exe')))};
  } catch (error) {
    result.errors.push(String(error?.message ?? error));
  }
  return result;
}

const PROJECT_FILES = [
  {path: 'project.godot', text: ['config_version=5', '', '[application]', 'config/name="S7 electron probe"', 'run/main_scene="res://main.tscn"', '', '[rendering]', 'renderer/rendering_method="gl_compatibility"', ''].join('\n')},
  {path: 'main.tscn', text: ['[gd_scene load_steps=2 format=3]', '', '[ext_resource type="Script" path="res://main.gd" id="1"]', '', '[node name="Main" type="Node3D"]', 'script = ExtResource("1")', ''].join('\n')},
  {path: 'main.gd', text: ['extends Node3D', '', 'func _ready() -> void:', '\tprint("s7 electron probe ready")', ''].join('\n')},
];

async function main() {
  log(`electron ${process.versions.electron} ready`);
  report.provisioning = provisionToolchain();
  log(`provisioning errors=${report.provisioning.errors.length}`);

  const runtime = new PluginRuntime({
    hostEntry: path.join(repo, 'vendor', 'pi-desktop', 'apps', 'desktop', 'electron', 'main', 'plugin-host-process.mjs'),
    spawnProcess: ({entry, pluginId}) => {
      const child = fork(entry, [], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: pluginProcessEnv(pluginId, {...process.env, CRAFTMINE_CORE_BIN: coreBin}),
      });
      const stderr = [];
      child.stderr?.on('data', chunk => { stderr.push(chunk.toString()); });
      child.on('message', message => { if (message?.t === 'log' || message?.t === 'error') log('[plugin]', JSON.stringify(message).slice(0, 400)); });
      return {
        postMessage: value => { if (child.connected) child.send(value); },
        onMessage: handler => child.on('message', handler),
        onExit: handler => child.on('exit', code => handler(code ?? 0)),
        kill: () => child.kill(),
        stderr,
      };
    },
  });

  const verifier = new GodotBuildVerifier();
  runtime.setServices({
    godotVerification: {check: descriptor => verifier.check(descriptor), cancel: id => verifier.cancel(id)},
  });

  const session = {
    sessionId: 's7-electron-session',
    turnId: 's7-electron-turn',
    projectId: 's7-electron',
    calls: [],
  };
  const context = () => ({projectId: session.projectId, sessionId: session.sessionId, turnId: session.turnId});
  const callTool = async (name, args = {}) => {
    const entry = runtime.getTools().find(tool => tool.name === name);
    if (!entry) throw new Error(`PRODUCT_TOOL_MISSING: ${name}`);
    const record = {name, args, at: new Date().toISOString(), toolCallId: `s7-${session.calls.length + 1}`};
    session.calls.push(record);
    try {
      const result = await entry.execute(args, {...context(), toolCallId: record.toolCallId, executionId: record.toolCallId});
      record.ok = true;
      record.result = result;
      return result;
    } catch (error) {
      record.ok = false;
      record.error = String(error?.message ?? error);
      record.code = error?.errorCode ?? error?.code ?? null;
      throw error;
    }
  };

  await step('real plugin bundle loads in the Electron host', async () => {
    await runtime.loadFromPath(pluginDir, PERMISSIONS);
    report.tools = runtime.getTools().map(tool => tool.name);
    return {tools: report.tools.length};
  });

  await step('executor registers with the real isolated verifier present', async () => {
    const deadline = Date.now() + 300000;
    for (;;) {
      const status = await callTool('godot_jobs', {mode: 'status'});
      const executor = status?.status ?? {};
      log(`  executor build=${executor.build} check=${executor.check} reason=${executor.buildBlockedReason ?? ''}`);
      if (executor.build === true && executor.check === true) return {executors: executor.executors ?? []};
      if (Date.now() > deadline) throw new Error(`executor did not become ready: ${JSON.stringify(executor).slice(0, 400)}`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  });

  await step('panel bridge creates a world', async () => {
    const world = await runtime.invokePanelBridge('craftmine.world', 'world.create', {title: 'S7 Electron 探针世界'});
    return {worldId: world?.id ?? null};
  });

  let project = null;
  await step('product tools store the Godot source', async () => {
    await callTool('godot_project_create', {baseId: 'first-person', files: PROJECT_FILES});
    project = await callTool('godot_project_index', {});
    await callTool('godot_project_patch', {
      revision: project.revision, manifestHash: project.manifestHash,
      operations: [{op: 'put', path: 'probe_note.gd', text: 'extends Node\n\n# S7 electron probe\n', expectedHash: null}],
    });
    project = await callTool('godot_project_index', {});
    return {revision: project.revision, manifestHash: project.manifestHash, files: project.files?.length ?? null};
  });

  let jobId = null;
  await step('godot_build_start queues a managed check job', async () => {
    const started = await callTool('godot_build_start', {revision: project.revision, manifestHash: project.manifestHash, mode: 'check'});
    jobId = started?.jobId ?? null;
    return {jobId, executionAvailable: started?.executionAvailable ?? null, status: started?.status ?? null};
  });

  await step('the job reaches a terminal state through the real executor', async () => {
    const deadline = Date.now() + 900000;
    let last = null;
    for (;;) {
      last = await callTool('godot_build_read', {jobId});
      log(`  build ${last?.status ?? '?'} stage=${last?.stage ?? ''} progress=${last?.progress ?? ''}`);
      if (['passed', 'failed', 'cancelled', 'blocked', 'interrupted'].includes(String(last?.status))) break;
      if (Date.now() > deadline) throw new Error(`job did not terminate: ${last?.status}`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    report.job = last;
    if (last?.status !== 'passed') throw new Error(`job ${last?.status}: ${JSON.stringify(last?.check ?? last?.blockedReason ?? last).slice(0, 1200)}`);
    return {status: last.status, candidateId: last.candidateId ?? null, build: last.build ?? null};
  });

  await step('candidate is readable with real check evidence', async () => {
    const candidateId = report.job?.candidateId ?? null;
    if (!candidateId) throw new Error('no candidate id on the terminal job');
    const candidate = await callTool('godot_candidate_read', {candidateId});
    if (candidate?.status !== 'available' && candidate?.candidate?.status !== 'available') {
      throw new Error(`candidate not available: ${JSON.stringify(candidate).slice(0, 800)}`);
    }
    return {candidateId, check: candidate.check ?? candidate.candidate?.check ?? null};
  });
}

app.whenReady().then(async () => {
  let code = 0;
  try {
    await main();
  } catch (error) {
    report.fatal = String(error?.stack ?? error);
    log(`FATAL ${report.fatal}`);
    code = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    report.failedSteps = report.steps.filter(entry => !entry.passed).map(entry => entry.name);
    report.toolCalls = [];
    fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    log(`steps=${report.steps.length} failed=${report.failedSteps.length}`);
  }
  app.exit(code);
}).catch(error => {
  fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify({...report, fatal: String(error?.stack ?? error)}, null, 2)}\n`);
  app.exit(2);
});
