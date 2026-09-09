// S7 round-three product probe. No model calls, no browser, no OS input.
//
// Drives the real product path only: the pinned PI plugin runtime loads the
// built `craftmine.world` plugin in a separate host process, which owns the real
// `craftmine-core.exe` stdio broker. Every world mutation goes through the
// product's own agent tools or panel bridge; this driver never writes a world
// record, build, candidate or progress itself.
//
// Purpose: prove (a) the product starts from the integrated source, (b) the
// managed Godot executor registers and its gate can be read, and (c) one
// complete engineering build/check/candidate probe runs end to end. It is a
// probe, not acceptance: the frozen runtime assertions are run by the I verifier
// and the real-model requirement is run by run-real-model.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {probePiPlugin, createPiPluginSession, piPluginConfig} from '../../godot-remaining/I/lib/transport/pi-plugin.mjs';

const REPO = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const value = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.resolve(REPO, value('out', `test-results/s7-probe-${stamp}`));
fs.mkdirSync(outDir, {recursive: true});
const log = (...parts) => {
  const line = parts.join(' ');
  fs.appendFileSync(path.join(outDir, 'console.log'), `${line}\n`);
  process.stdout.write(`${line}\n`);
};
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');

const report = {
  kind: 'craftmine.godot.round3.s7.product-probe/1',
  startedAt: new Date().toISOString(),
  source: {commit: null, tree: null, worktree: REPO},
  prerequisites: null,
  identity: null,
  tools: null,
  executor: null,
  steps: [],
  toolCalls: [],
  limits: [
    'No model request is made by this probe; it only exercises product startup and the managed executor path.',
    'A passing build/check here is not acceptance: the frozen runtime assertions and the real-model requirement are separate ledgers.',
  ],
};

const step = async (name, body) => {
  const startedAt = Date.now();
  try {
    const detail = await body();
    const record = {name, passed: true, ms: Date.now() - startedAt, detail: detail ?? null};
    report.steps.push(record);
    log(`PASS ${name} (${record.ms}ms)`);
    return {ok: true, detail};
  } catch (error) {
    const record = {name, passed: false, ms: Date.now() - startedAt, error: String(error?.message ?? error), code: error?.code ?? error?.errorCode ?? null};
    report.steps.push(record);
    log(`FAIL ${name}: ${record.error}`);
    return {ok: false, error: record.error, code: record.code};
  }
};

const {execFileSync} = await import('node:child_process');
try {
  report.source.commit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: REPO, encoding: 'utf8'}).trim();
  report.source.tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {cwd: REPO, encoding: 'utf8'}).trim();
} catch { /* identity stays null rather than guessed */ }

// Isolated product data: never the user's profile and never a shared cache write.
const dataDir = path.resolve(REPO, value('data-dir', path.join(outDir, 'product-data')));
fs.mkdirSync(dataDir, {recursive: true});
process.env.CRAFTMINE_I_DATA_DIR = dataDir;
process.env.CRAFTMINE_GODOT_BROKER_BIN = process.env.CRAFTMINE_GODOT_BROKER_BIN
  || path.join(REPO, 'desktop/godot/sandbox/target/debug/godot-host-broker.exe');
if (!process.env.CRAFTMINE_GODOT_CACHE_DIR) {
  const localCache = path.join(REPO, 'desktop/build/godot/4.7.2-stable');
  if (fs.existsSync(localCache)) process.env.CRAFTMINE_GODOT_CACHE_DIR = localCache;
}

const config = piPluginConfig(process.env, REPO);
report.prerequisites = {
  coreBin: config.coreBin,
  coreSha256: fs.existsSync(config.coreBin) ? sha256(fs.readFileSync(config.coreBin)) : null,
  plugin: config.plugin,
  broker: process.env.CRAFTMINE_GODOT_BROKER_BIN ?? null,
  brokerSha256: fs.existsSync(process.env.CRAFTMINE_GODOT_BROKER_BIN ?? '') ? sha256(fs.readFileSync(process.env.CRAFTMINE_GODOT_BROKER_BIN)) : null,
  engineRoot: process.env.CRAFTMINE_GODOT_CACHE_DIR ?? null,
  secretsConfigured: Boolean(config.secretsFile && fs.existsSync(config.secretsFile)),
  dataDir,
};

// Static fact recorded with the probe: does any product packaging script install
// the managed executor broker? If not, a shipped build cannot satisfy the
// executor gate regardless of the engine cache.
{
  const packagingFiles = ['desktop/build-client.ps1', 'desktop/prepare-client.mjs', 'desktop/windows-package-tools.mjs', 'desktop/build-world-plugin.mjs'];
  const hits = [];
  for (const relative of packagingFiles) {
    const file = path.join(REPO, relative);
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes('godot-host-broker')) hits.push(relative);
  }
  report.prerequisites.packaging = {installsBroker: hits.length > 0, referencingFiles: hits,
    checkedFiles: packagingFiles};
}

const availability = await probePiPlugin({env: process.env, root: REPO});
log(`availability available=${availability.available} reason=${availability.reason}`);
if (!availability.available) {
  report.prerequisites.detail = availability.detail;
  fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.exit(3);
}

// Optional probe-time provisioning of the managed executor toolchain.
//
// The shipped product has no code path that installs the broker or engine (see
// report.prerequisites.packaging), and the host strips every CRAFTMINE_GODOT_*
// environment variable before spawning the plugin, so the only discovery paths
// left are inside the plugin data directory. This block copies the broker built
// from the integrated source plus the pinned read-only engine cache into that
// directory so the executor can be exercised. It is recorded as probe
// provisioning, not as a product capability.
if (flag('provision-executor')) {
  const pluginData = path.join(dataDir, 'profile', 'plugins', 'data', 'craftmine.world');
  const engineCache = process.env.CRAFTMINE_GODOT_CACHE_DIR;
  const provisioning = {pluginData, broker: null, engine: null, bridge: null, lock: null, errors: []};
  try {
    fs.mkdirSync(path.join(pluginData, 'bin'), {recursive: true});
    fs.mkdirSync(path.join(pluginData, 'godot', 'web'), {recursive: true});
    fs.mkdirSync(path.join(pluginData, 'godot', 'engine'), {recursive: true});
    const brokerSource = process.env.CRAFTMINE_GODOT_BROKER_BIN;
    const brokerTarget = path.join(pluginData, 'bin', 'godot-host-broker.exe');
    fs.copyFileSync(brokerSource, brokerTarget);
    provisioning.broker = {source: brokerSource, target: brokerTarget, sha256: sha256(fs.readFileSync(brokerTarget))};
    const bridgeSource = path.join(REPO, 'desktop/godot/web/bridge.js');
    fs.copyFileSync(bridgeSource, path.join(pluginData, 'godot', 'web', 'bridge.js'));
    provisioning.bridge = {source: bridgeSource, sha256: sha256(fs.readFileSync(bridgeSource))};
    const lockSource = path.join(REPO, 'desktop/godot/toolchain.lock.json');
    fs.copyFileSync(lockSource, path.join(pluginData, 'godot', 'toolchain.lock.json'));
    provisioning.lock = {source: lockSource, sha256: sha256(fs.readFileSync(lockSource))};
    if (engineCache && fs.existsSync(engineCache)) {
      // A junction is refused by the executor's ordinaryDirectory() guard, so the
      // probe copies the pinned engine cache read-only sources into place. Any
      // stale link from an earlier run is unlinked first: copying through a
      // junction would otherwise target the read-only cache itself.
      const engineRoot = path.join(pluginData, 'godot', 'engine', '4.7.2-stable');
      if (!engineRoot.startsWith(path.resolve(dataDir))) throw new Error('refusing to provision outside the probe data directory');
      if (fs.existsSync(engineRoot)) {
        if (fs.lstatSync(engineRoot).isSymbolicLink()) fs.unlinkSync(engineRoot);
        else fs.rmSync(engineRoot, {recursive: true, force: true});
      }
      fs.cpSync(path.join(engineCache, 'editor'), path.join(engineRoot, 'editor'), {recursive: true});
      fs.cpSync(path.join(engineCache, 'templates'), path.join(engineRoot, 'templates'), {recursive: true});
      provisioning.engine = {root: engineRoot, source: engineCache,
        editorSha256: sha256(fs.readFileSync(path.join(engineRoot, 'editor', 'Godot_v4.7.2-stable_win64.exe')))};
    } else {
      provisioning.errors.push('CRAFTMINE_GODOT_CACHE_DIR is not set to an existing engine cache');
    }
  } catch (error) {
    provisioning.errors.push(String(error?.message ?? error));
  }
  report.provisioning = provisioning;
  log(`provisioning pluginData=${pluginData} errors=${provisioning.errors.length}`);
}

let session = null;
try {
  await step('product session starts (real plugin host + real core)', async () => {
    session = await createPiPluginSession({config, onEvent: event => {
      if (event.type === 'tool-call') log(`  tool ${event.name}`);
    }});
    report.identity = session.identity;
    report.tools = session.tools;
    return {tools: session.tools.length, dataDir: session.dataDir, core: session.identity.core.sha256.slice(0, 16)};
  });
  if (!session) throw new Error('session unavailable');

  await step('runtime_info reports the connected runtime', async () => {
    const info = await session.runtimeInfo();
    report.executor = {runtimeInfo: info};
    return info;
  });

  await step('godot_jobs status exposes the real executor gate', async () => {
    const status = await session.callTool('godot_jobs', {mode: 'status'});
    report.executor = {...(report.executor ?? {}), gate: status};
    return status;
  });

  await step('godot_capability_report lists advertised tools and host methods', async () => {
    const capabilities = await session.callTool('godot_capability_report', {});
    return capabilities;
  });

  await step('panel bridge creates a world', async () => {
    const world = await session.createWorld('S7 集成探针世界');
    return {worldId: world?.id ?? null, title: world?.title ?? null};
  });

  const projectFiles = [
    {
      path: 'project.godot',
      text: [
        'config_version=5',
        '',
        '[application]',
        'config/name="S7 probe"',
        'run/main_scene="res://main.tscn"',
        '',
        '[rendering]',
        'renderer/rendering_method="gl_compatibility"',
        '',
      ].join('\n'),
    },
    {
      path: 'main.tscn',
      text: [
        '[gd_scene load_steps=2 format=3]',
        '',
        '[ext_resource type="Script" path="res://main.gd" id="1"]',
        '',
        '[node name="Main" type="Node3D"]',
        'script = ExtResource("1")',
        '',
      ].join('\n'),
    },
    {
      path: 'main.gd',
      text: [
        'extends Node3D',
        '',
        'func _ready() -> void:',
        '\tprint("s7 probe world ready")',
        '',
      ].join('\n'),
    },
  ];

  let project = null;
  await step('godot_project_create stores source through the product tool', async () => {
    const created = await session.callTool('godot_project_create', {baseId: 'first-person', files: projectFiles});
    return created;
  });

  await step('godot_project_index reads the stored project back', async () => {
    project = await session.callTool('godot_project_index', {});
    if (!project?.manifestHash) throw new Error('godot_project_index returned no manifest hash');
    return {revision: project?.revision, manifestHash: project?.manifestHash, files: project?.files?.length ?? null};
  });

  await step('godot_file_read reads one stored source file', async () => {
    if (!project) throw new Error('no project revision to read');
    const read = await session.callTool('godot_file_read', {path: 'project.godot', revision: project.revision, manifestHash: project.manifestHash, offset: 0, limit: 16000});
    if (!read?.sha256) throw new Error('godot_file_read returned no hash');
    return {bytes: read?.bytes ?? null, sha256: read?.sha256 ?? null};
  });

  await step('godot_project_patch writes a real source change', async () => {
    if (!project) throw new Error('no project revision to patch');
    const patched = await session.callTool('godot_project_patch', {
      revision: project.revision,
      manifestHash: project.manifestHash,
      operations: [{op: 'put', path: 'probe_note.gd', text: 'extends Node\n\n# written by the S7 product probe\n', expectedHash: null}],
    });
    return patched;
  });

  await step('godot_project_index reflects the patch as the new head', async () => {
    project = await session.callTool('godot_project_index', {});
    const note = (project?.files ?? []).find(entry => entry.path === 'probe_note.gd');
    if (!note) throw new Error('patched file is missing from the project index');
    return {revision: project.revision, manifestHash: project.manifestHash, patchedFile: note.path};
  });

  let jobId = null;
  await step('managed executor registers after a real broker preflight', async () => {
    const deadline = Date.now() + Number(value('executor-timeout-ms', 300000));
    let last = null;
    for (;;) {
      last = await session.runtimeInfo();
      const executor = last?.godotExecutor ?? {};
      log(`  executor ${executor.state} reason=${executor.reason ?? ''} build=${last?.godotBuildAvailable} check=${last?.godotCheckAvailable}`);
      if (executor.state === 'registered') {
        return {state: executor.state, brokerSha256: executor.brokerSha256, bridgeSha256: executor.bridgeSha256,
          evidenceHash: executor.evidenceHash, preflight: executor.preflight};
      }
      if (['unavailable', 'stopped'].includes(String(executor.state))) {
        throw new Error(`executor ${executor.state}: ${executor.reason} ${JSON.stringify(executor.preflight ?? executor.detail ?? {})}`);
      }
      if (Date.now() > deadline) throw new Error(`executor did not register within the timeout (state=${executor.state}, reason=${executor.reason})`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  });

  await step('godot_build_start creates a managed check job', async () => {
    if (!project) throw new Error('no project revision to build');
    const started = await session.callTool('godot_build_start', {revision: project.revision, manifestHash: project.manifestHash, mode: 'check'});
    jobId = started?.jobId ?? started?.id ?? null;
    return {jobId, executionAvailable: started?.executionAvailable ?? null, raw: started};
  });

  if (jobId) {
    await step('godot_build_read reaches a terminal state', async () => {
      const deadline = Date.now() + Number(value('build-timeout-ms', 900000));
      let last = null;
      for (;;) {
        last = await session.callTool('godot_build_read', {jobId});
        const state = last?.status ?? last?.state ?? 'unknown';
        log(`  build ${state} stage=${last?.stage ?? ''} progress=${last?.progress ?? ''}`);
        if (['succeeded', 'failed', 'cancelled', 'blocked', 'error'].includes(String(state))) break;
        if (Date.now() > deadline) throw new Error(`build did not reach a terminal state within the timeout (last=${state})`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      return {state: last?.status ?? last?.state, blockedReason: last?.blockedReason ?? last?.reason ?? null,
        executor: last?.executor ?? null, build: last?.build ?? null, artifacts: last?.artifacts ?? null,
        candidateId: last?.candidateId ?? null, sourceStale: last?.sourceStale ?? null};
    });

    const terminal = report.steps.find(entry => entry.name === 'godot_build_read reaches a terminal state');
    const candidateId = terminal?.detail?.candidateId ?? null;
    if (candidateId) {
      await step('godot_candidate_read reads the produced candidate', async () => {
        const candidate = await session.callTool('godot_candidate_read', {candidateId});
        return candidate;
      });
    } else {
      report.steps.push({name: 'godot_candidate_read reads the produced candidate', passed: false, skipped: true,
        error: 'no candidate id was reported by the terminal job', ms: 0});
      log('SKIP godot_candidate_read: no candidate id reported');
    }
  } else {
    report.steps.push({name: 'godot_build_read reaches a terminal state', passed: false, skipped: true, error: 'no job id returned', ms: 0});
    log('SKIP build polling: no job id returned');
  }

  await step('executor gate is re-read after the job', async () => {
    const status = await session.callTool('godot_jobs', {mode: 'status'});
    return status;
  });
} catch (error) {
  report.fatal = String(error?.stack ?? error);
  log(`FATAL ${report.fatal}`);
} finally {
  report.finishedAt = new Date().toISOString();
  report.toolCalls = session?.calls ?? [];
  report.failedSteps = report.steps.filter(entry => !entry.passed && !entry.skipped).map(entry => entry.name);
  report.skippedSteps = report.steps.filter(entry => entry.skipped).map(entry => entry.name);
  fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (session) {
    fs.writeFileSync(path.join(outDir, 'tool-calls.json'), `${JSON.stringify(session.calls, null, 2)}\n`);
    await session.close().catch(() => {});
  }
  log(`evidence: ${outDir}`);
  log(`steps=${report.steps.length} failed=${report.failedSteps.length} skipped=${report.skippedSteps.length}`);
}
process.exit(report.failedSteps.length ? 1 : 0);
