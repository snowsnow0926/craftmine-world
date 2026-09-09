// Protocol-level tests for the managed executor.
//
// These drive the real supervisor (`plugins/craftmine-world/godot-executor.cjs`)
// against a scripted broker stand-in and an in-memory core. They prove the
// supervisor's own validation, digest comparison, cancellation and tamper
// handling. They are NOT the product acceptance: `executor-real-e2e.mjs` runs
// the pinned broker and engine against the real Rust core.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {createGodotExecutor, classifyLog, sourceSnapshotDigest} = require('../../../plugins/craftmine-world/godot-executor.cjs');
const fixtureBroker = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fixture-broker.cjs');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const MANAGED_ENV = ['CRAFTMINE_GODOT_BROKER_BIN','CRAFTMINE_GODOT_ENGINE_ROOT','CRAFTMINE_GODOT_CACHE_DIR',
  'CRAFTMINE_GODOT_TOOLCHAIN_LOCK','CRAFTMINE_GODOT_BRIDGE_PATH','CRAFTMINE_GODOT_BROKER_SHA256','CRAFTMINE_FIXTURE_BROKER_FILE'];
const ORIGINAL_ENV = Object.fromEntries(MANAGED_ENV.map(key => [key, process.env[key]]));

function restoreEnv() {
  for (const key of MANAGED_ENV) {
    if (ORIGINAL_ENV[key] === undefined) delete process.env[key]; else process.env[key] = ORIGINAL_ENV[key];
  }
}

function listFiles(root, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, prefix), {withFileTypes:true})) {
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(root, relative));
    else out.push({path:relative, bytes:fs.statSync(path.join(root, relative)).size, sha256:sha256(fs.readFileSync(path.join(root, relative)))});
  }
  return out.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

/** Host-owned files: a pinned engine/broker/bridge layout plus a project copy. */
function environment({projectFiles = {'project.godot':'config_version=5\n', 'main.gd':'extends Node\n'}} = {}) {
  restoreEnv();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'craftmine-c-executor-'));
  const broker = path.join(root, 'godot-host-broker.exe');
  fs.writeFileSync(broker, 'fixture-broker-placeholder');
  const engineRoot = path.join(root, 'engine');
  const templates = path.join(engineRoot, 'templates');
  fs.mkdirSync(path.join(engineRoot, 'editor'), {recursive:true});
  fs.mkdirSync(templates, {recursive:true});
  fs.writeFileSync(path.join(engineRoot, 'editor', 'Godot_v4.7.2-stable_win64.exe'), 'editor');
  fs.writeFileSync(path.join(templates, 'web_release.zip'), 'threaded');
  fs.writeFileSync(path.join(templates, 'web_nothreads_release.zip'), 'single');
  fs.writeFileSync(path.join(templates, 'version.txt'), '4.7.2.stable');
  const lock = path.join(root, 'toolchain.lock.json');
  fs.writeFileSync(lock, JSON.stringify({version:'4.7.2-stable',
    editor:{executable:'Godot_v4.7.2-stable_win64.exe', executableSha256:sha256('editor')},
    exportTemplates:{webThreadedRelease:{file:'web_release.zip', bytes:8, sha256:sha256('threaded')},
      webRelease:{file:'web_nothreads_release.zip', bytes:6, sha256:sha256('single')}}}));
  const bridge = path.join(root, 'bridge.js');
  fs.writeFileSync(bridge, '// host pinned bridge\n');
  const projectRoot = path.join(root, 'project');
  fs.mkdirSync(projectRoot, {recursive:true});
  for (const [relative, body] of Object.entries(projectFiles)) {
    const target = path.join(projectRoot, ...relative.split('/'));
    fs.mkdirSync(path.dirname(target), {recursive:true});
    fs.writeFileSync(target, body);
  }
  const artifactsRoot = path.join(root, 'artifacts');
  fs.mkdirSync(artifactsRoot, {recursive:true});
  const dataPath = path.join(root, 'data');
  fs.mkdirSync(dataPath, {recursive:true});
  const scenarioFile = path.join(root, 'scenario.json');
  fs.writeFileSync(scenarioFile, '{}');
  process.env.CRAFTMINE_GODOT_BROKER_BIN = broker;
  process.env.CRAFTMINE_GODOT_ENGINE_ROOT = engineRoot;
  process.env.CRAFTMINE_GODOT_TOOLCHAIN_LOCK = lock;
  process.env.CRAFTMINE_GODOT_BRIDGE_PATH = bridge;
  process.env.CRAFTMINE_FIXTURE_BROKER_FILE = scenarioFile;
  delete process.env.CRAFTMINE_GODOT_BROKER_SHA256;
  return {root, broker, engineRoot, bridge, projectRoot, artifactsRoot, dataPath, scenarioFile, files:listFiles(projectRoot)};
}

function setScenario(env, scenario) { fs.writeFileSync(env.scenarioFile, JSON.stringify(scenario ?? {})); }

/**
 * In-memory stand-in for the Rust core. The real core is exercised by
 * `executor-real-e2e.mjs`; here it only has to answer the documented methods so
 * the supervisor's own behaviour can be asserted.
 */
function fakeCore({worldId = 'world-c', buildId = 'gbd-' + 'a'.repeat(64), projectRoot, artifactsRoot, files, inputHash = sha256('input')} = {}) {
  const state = {status:'queued', finished:null, progress:[], heartbeats:0, cancelled:false, executor:null, output:null};
  return {
    state,
    async call(method, params = {}) {
      switch (method) {
        case 'godotExecutor.register': state.executor = params.attestation; return {executorId:params.executorId, registered:true, executionAvailable:true, attestationHash:sha256(JSON.stringify(params.attestation)), promotedJobs:0};
        case 'godotExecutor.revoke': state.executor = null; return {executorId:params.executorId, revoked:true, interrupted:0};
        case 'godotBuild.read': return {jobId:params.jobId, worldId, status:state.status};
        case 'godotJob.claim':
          if (state.status !== 'queued') throw Error('GODOT_JOB_INACTIVE');
          state.status = 'claimed';
          return {jobId:params.jobId, worldId, buildId, baseId:'first-person', kind:'check', mode:'check', sourceRevision:3,
            manifestHash:sha256('manifest'), assetManifestHash:sha256('assets'), inputHash,
            projectRoot, artifactsRoot, cacheRoot:path.join(artifactsRoot, '..', 'cache'), files:{source:files, asset:[]}};
        case 'godotJob.progress': state.progress.push({stage:params.stage, percent:params.percent}); state.status = 'running'; return {jobId:params.jobId, status:'running'};
        case 'godotJob.heartbeat': state.heartbeats++; return {jobId:params.jobId, status:'running'};
        case 'godotJob.finish':
          state.output = params.output;
          state.status = params.output.passed ? 'passed' : 'failed';
          return {jobId:params.jobId, status:state.status, candidateId:params.output.passed ? 'gcan-' + 'b'.repeat(64) : null};
        case 'godotBuild.cancel': state.cancelled = true; state.status = 'cancelled'; return {jobId:params.jobId, status:'cancelled'};
        case 'world.read': return {id:worldId, world:{build:{id:'base-a', scene:{format:'craftmine.godot-scene/1', baseId:'first-person'}, godot:{}},
          snapshot:{format:'craftmine.godot-progress/1', worldId, baseId:'first-person', baseVersion:'1.0.0', stateVersion:1, body:{coins:7}}, extensions:[]}};
        case 'godotJob.checkDescriptor': throw Error('UNSUPPORTED');
        case 'godotJob.pending': throw Error('UNSUPPORTED');
        default: throw Error('UNSUPPORTED_METHOD:' + method);
      }
    },
  };
}

const passingEvidence = (overrides = {}) => ({
  format:'craftmine.godot-runtime-check/1', scope:'base-startup', passed:true, error:null,
  ready:{ok:true, ops:['snapshot','load']}, render:{ok:true, frames:3, distinctFrames:2, captures:[]},
  errors:{ok:true, runtime:[], console:[]}, snapshot:{ok:true, equal:true},
  isolation:{ok:true, guard:{focus:0, pointerLock:0}}, recovery:{ok:true, gracefulExit:true}, ...overrides,
});

function makeExecutor({env, core = fakeCore({projectRoot:env.projectRoot, artifactsRoot:env.artifactsRoot, files:env.files}), verifier = {godotCheck: async () => passingEvidence()}, jobTimeoutMs = 30000}) {
  return createGodotExecutor(core, {
    dataPath:env.dataPath, verifier, jobTimeoutMs, logger:{log(){}, warn(){}, error(){}},
    spawnBroker: (binary, args, settings) => spawn(process.execPath, [fixtureBroker, ...args], settings),
  });
}

/** Wait until a job leaves the executor's live set (finished, failed or abandoned). */
async function settle(executor, jobId, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (executor.status().jobs.includes(jobId)) {
    if (Date.now() > deadline) throw Error('job did not settle: ' + jobId);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

/** Run one job end to end and return the recorded core output. */
async function runJob(t, {scenario, verifier, jobTimeoutMs, mode = 'check', beforeJob} = {}) {
  const env = environment();
  t.after(restoreEnv);
  setScenario(env, scenario ?? {});
  const core = fakeCore({projectRoot:env.projectRoot, artifactsRoot:env.artifactsRoot, files:env.files});
  const executor = makeExecutor({env, core, verifier, jobTimeoutMs});
  const started = await executor.start();
  const jobId = 'gjob-' + 'c'.repeat(64);
  if (started.available) {
    if (beforeJob) await beforeJob(env, executor);
    assert.equal(executor.enqueue({jobId, worldId:'world-c', mode}).enqueued, true);
    await settle(executor, jobId);
  }
  await executor.stop();
  return {core, env, started, jobId};
}

test('happy check job: real import/export receipts, staged web artifacts, passed candidate', async t => {
  const {core, env, started} = await runJob(t, {scenario:{}});
  assert.equal(started.available, true);
  assert.equal(started.checkAvailable, true);
  const output = core.state.output;
  assert.equal(core.state.status, 'passed');
  assert.equal(output.format, 'craftmine.godot-job-result/1');
  assert.equal(output.passed, true);
  assert.equal(output.import.passed, true);
  assert.equal(output.compile.passed, true);
  assert.deepEqual(output.artifacts.map(item => item.path).sort(), ['web/bridge.js','web/index.html','web/index.js']);
  assert.equal(output.check.assertions.length, 6);
  assert.equal(output.check.assertions.every(item => item.passed === true), true);
  // The staged bridge is the host-pinned one, not the authored copy.
  assert.equal(fs.readFileSync(path.join(env.artifactsRoot, 'web', 'bridge.js'), 'utf8'), '// host pinned bridge\n');
  assert.equal(output.artifacts.find(item => item.path === 'web/bridge.js').sha256, sha256('// host pinned bridge\n'));
  assert.equal(core.state.progress.at(-1).percent >= 85, true, 'progress must reach the check stage');
  assert.equal(output.engine.isolation, 'craftmine.windows.lpac-registry.v1');
});

test('the verifier receives the staged descriptor, never a caller-supplied path', async t => {
  let seen = null;
  const env = environment();
  t.after(restoreEnv);
  setScenario(env, {});
  const core = fakeCore({projectRoot:env.projectRoot, artifactsRoot:env.artifactsRoot, files:env.files});
  const executor = makeExecutor({env, core, verifier:{godotCheck: async descriptor => { seen = descriptor; return passingEvidence(); }}});
  assert.equal((await executor.start()).available, true);
  executor.enqueue({jobId:'gjob-' + '9'.repeat(64), worldId:'world-c', mode:'check'});
  await settle(executor, 'gjob-' + '9'.repeat(64));
  await executor.stop();
  assert.equal(seen.format, 'craftmine.godot-check-descriptor/1');
  assert.equal(seen.phase, 'check');
  assert.equal(seen.entry, 'web/index.html');
  assert.equal(seen.root, env.artifactsRoot);
  assert.equal(seen.threads, true);
  assert.deepEqual(seen.artifacts.map(item => item.path).sort(), ['web/bridge.js','web/index.html','web/index.js']);
  assert.equal(seen.snapshot.body.coins, 7, 'the formal progress snapshot is passed to the check');
});

test('check job without a verifier records a failure instead of a false pass', async t => {
  const {core, started} = await runJob(t, {scenario:{}, verifier:null});
  assert.equal(started.available, true);
  assert.equal(started.checkAvailable, false, 'without an Electron verifier the check capability must be reported false');
  assert.equal(core.state.output.passed, false);
  assert.equal(core.state.output.import.passed, true, 'the real import still ran and is recorded');
  assert.equal(core.state.output.check.passed, false);
  assert.equal(core.state.output.check.assertions.every(item => item.passed === false), true);
});

test('a failing runtime check fails the job and its assertions', async t => {
  const failing = {godotCheck: async () => passingEvidence({passed:false, error:'GODOT_CHECK_INPUT_GUARD_MISSING',
    isolation:{ok:false, guard:null}, recovery:{ok:false, gracefulExit:false}}), cancelGodotCheck: async () => {}};
  const {core} = await runJob(t, {scenario:{}, verifier:failing});
  assert.equal(core.state.output.passed, false);
  assert.equal(core.state.output.check.passed, false);
  assert.deepEqual(core.state.output.check.assertions.map(item => [item.id, item.passed]),
    [['runtime.ready',true],['runtime.frame',true],['runtime.no-errors',true],['runtime.snapshot',true],['runtime.isolation',false],['runtime.recovery',false]]);
});

test('forged preflight evidence never registers an executor', async t => {
  for (const [scenario, expected] of [[{processVerified:false}, 'GODOT_BROKER_PROCESS_UNVERIFIED'],
    [{networkVerified:false}, 'GODOT_BROKER_NETWORK_UNVERIFIED'],
    [{cleanupVerified:false}, 'GODOT_BROKER_CLEANUP_UNVERIFIED'],
    [{policyVersion:'craftmine.windows.other.v1'}, 'GODOT_BROKER_POLICY_MISMATCH'],
    [{omitRequestId:true}, 'GODOT_BROKER_PREPARATION_FAILED'],
    [{state:'failed'}, 'GODOT_BROKER_TASK_FAILED']]) {
    const {started, core} = await runJob(t, {scenario});
    assert.equal(started.available, false, expected);
    assert.equal(started.reason, expected);
    assert.equal(core.state.executor, null);
  }
});

test('measured source files must equal the claimed manifest', async t => {
  for (const [scenario, expected] of [[{changeSourceFile:'main.gd'}, 'GODOT_BROKER_SOURCE_CHANGED:main.gd'],
    [{dropSourceFile:'main.gd'}, 'GODOT_BROKER_SOURCE_MISSING:main.gd'],
    [{addSourceFile:'extra.gd'}, 'GODOT_BROKER_SOURCE_EXTRA:extra.gd'],
    [{tamperSourceDigest:true}, 'GODOT_BROKER_SOURCE_DIGEST_INVALID']]) {
    const {core} = await runJob(t, {scenario});
    assert.equal(core.state.output.passed, false, expected);
    assert.match(core.state.output.compile.errors.join(' '), new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('unlisted, tampered and escaping artifacts are refused', async t => {
  const cases = [[{extraArtifact:'secret.txt'}, /GODOT_ARTIFACT_UNLISTED:secret\.txt/],
    [{tamperArtifact:'index.js'}, /GODOT_ARTIFACT_MISMATCH/],
    [{artifacts:{'index.html':'<!doctype html>','../escape.js':'x'}}, /GODOT_ARTIFACT_INVALID|GODOT_ARTIFACT_ESCAPE/]];
  for (const [scenario, pattern] of cases) {
    const {core, env} = await runJob(t, {scenario});
    assert.equal(core.state.output.passed, false, String(pattern));
    assert.match(core.state.output.compile.errors.join(' '), pattern);
    assert.equal(fs.existsSync(path.join(env.root, 'escape.js')), false, 'nothing may be written outside the artifacts root');
  }
});

test('compile failures are fatal, known native isolation diagnostics are not', async t => {
  const native = ['ERROR: Condition "res != ((HRESULT)0x00000000)" is true. Returning: String()',
    '   at: get_system_dir (platform/windows/os_windows.cpp:2502)',
    'ERROR: Call to GetAdaptersAddresses failed with error 5.',
    '   at: get_local_interfaces (drivers/windows/ip_windows.cpp:117)',
    'ERROR: Condition "_sock == (SOCKET)(~0)" is true. Returning: FAILED',
    '   at: open (drivers/windows/net_socket_winsock.cpp:238)', ''].join('\n');
  const script = ['ERROR: Parse Error: Unexpected "(" in class body.',
    '   at: GDScript::reload (res://main.gd:3)',
    'SCRIPT ERROR: Invalid call. Nonexistent function \'foo\'.', ''].join('\n');
  const unknown = ['ERROR: Some new engine condition nobody has classified.', '   at: somewhere (core/thing.cpp:1)', ''].join('\n');
  const mixed = native + script;

  const known = classifyLog(native);
  assert.equal(known.errors.length, 0, 'exact known native diagnostics must not fail a build');
  assert.equal(known.native.length, 3);
  assert.equal(classifyLog(script).errors.length, 2, 'a GDScript backtrace can never be blanket-ignored');
  assert.equal(classifyLog(unknown).errors.length, 1);
  assert.equal(classifyLog(mixed).errors.length, 2);
  // The same message at a different engine location is not the known diagnostic.
  assert.equal(classifyLog('ERROR: Call to GetAdaptersAddresses failed with error 5.\n   at: elsewhere (core/other.cpp:1)\n').errors.length, 1);

  const {core} = await runJob(t, {scenario:{log:mixed}});
  assert.equal(core.state.output.import.passed, false);
  assert.equal(core.state.output.compile.passed, false);
  assert.equal(core.state.output.compile.errors.length, 2);
  const clean = await runJob(t, {scenario:{log:native}});
  assert.equal(clean.core.state.output.passed, true, 'the known native diagnostics alone must not fail a build');
});

test('a broker that never answers or dies is recorded as a failure, never a pass', async t => {
  for (const scenario of [{exitWithoutResponse:true}, {state:'failed', error:'boom'}]) {
    const env = environment();
    t.after(restoreEnv);
    setScenario(env, {});
    const core = fakeCore({projectRoot:env.projectRoot, artifactsRoot:env.artifactsRoot, files:env.files});
    const executor = makeExecutor({env, core});
    assert.equal((await executor.start()).available, true);
    setScenario(env, scenario);
    executor.enqueue({jobId:'gjob-' + '4'.repeat(64), worldId:'world-c', mode:'check'});
    await settle(executor, 'gjob-' + '4'.repeat(64));
    await executor.stop();
    assert.equal(core.state.output.passed, false);
    assert.equal(core.state.output.artifacts.length, 0);
  }
});

test('a job that exceeds its budget is failed, not left running', async t => {
  const env = environment();
  t.after(restoreEnv);
  setScenario(env, {});
  const core = fakeCore({projectRoot:env.projectRoot, artifactsRoot:env.artifactsRoot, files:env.files});
  const executor = makeExecutor({env, core, jobTimeoutMs:1500});
  assert.equal((await executor.start()).available, true);
  setScenario(env, {delayMs:60000});
  executor.enqueue({jobId:'gjob-' + '5'.repeat(64), worldId:'world-c', mode:'check'});
  await settle(executor, 'gjob-' + '5'.repeat(64));
  await executor.stop();
  assert.equal(core.state.output.passed, false);
  assert.equal(core.state.output.import.passed, false);
});

test('cancel kills the broker, records no result and cancels the core job', async t => {
  const env = environment();
  t.after(restoreEnv);
  setScenario(env, {});
  const core = fakeCore({projectRoot:env.projectRoot, artifactsRoot:env.artifactsRoot, files:env.files});
  const executor = makeExecutor({env, core, jobTimeoutMs:60000});
  assert.equal((await executor.start()).available, true);
  const jobId = 'gjob-' + '2'.repeat(64);
  setScenario(env, {hangForever:true});
  executor.enqueue({jobId, worldId:'world-c', mode:'check'});
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.deepEqual(executor.status().jobs, [jobId]);
  await executor.cancel(jobId, 'test cancel');
  await executor.stop();
  assert.equal(core.state.output, null, 'a cancelled job must never record a late result');
  assert.equal(core.state.cancelled, true, 'the core job must be cancelled');
});

test('executor stop revokes registration and rejects new jobs', async t => {
  const env = environment();
  t.after(restoreEnv);
  setScenario(env, {});
  const executor = makeExecutor({env});
  assert.equal((await executor.start()).available, true);
  assert.equal(executor.registered, true);
  const stopped = await executor.stop();
  assert.equal(stopped.revoked, true);
  assert.equal(executor.registered, false);
  assert.equal(executor.status().available, false);
  assert.equal(executor.enqueue({jobId:'gjob-' + '3'.repeat(64), worldId:'world-c', mode:'build'}).enqueued, false);
});

test('sourceSnapshotDigest matches the documented broker digest shape', () => {
  const files = [{path:'b.gd', bytes:2, sha256:sha256('b')}, {path:'a.gd', bytes:1, sha256:sha256('a')}];
  assert.equal(sourceSnapshotDigest(files),
    sha256(JSON.stringify([{path:'a.gd', bytes:1, sha256:sha256('a')}, {path:'b.gd', bytes:2, sha256:sha256('b')}])));
  assert.equal(sourceSnapshotDigest([]), '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945');
});

test('missing or tampered host files report their own reason', async t => {
  const cases = [['editor','GODOT_ENGINE_MISSING'], ['templates','GODOT_TEMPLATES_MISSING'],
    ['bridge','GODOT_BRIDGE_MISSING'], ['broker','GODOT_BROKER_MISSING'], ['engine-hash','GODOT_ENGINE_MISMATCH']];
  for (const [missing, expected] of cases) {
    const env = environment();
    t.after(restoreEnv);
    setScenario(env, {});
    if (missing === 'editor') fs.rmSync(path.join(env.engineRoot, 'editor'), {recursive:true});
    if (missing === 'templates') fs.rmSync(path.join(env.engineRoot, 'templates'), {recursive:true});
    if (missing === 'bridge') fs.rmSync(env.bridge);
    if (missing === 'broker') fs.rmSync(env.broker);
    if (missing === 'engine-hash') fs.writeFileSync(path.join(env.engineRoot, 'editor', 'Godot_v4.7.2-stable_win64.exe'), 'tampered');
    const executor = makeExecutor({env});
    const started = await executor.start();
    assert.equal(started.available, false, missing);
    assert.equal(started.reason, expected);
    await executor.stop();
  }
});

test('a changed broker binary is refused when a pin is configured', async t => {
  const env = environment();
  t.after(restoreEnv);
  setScenario(env, {});
  process.env.CRAFTMINE_GODOT_BROKER_SHA256 = sha256('something-else');
  const executor = makeExecutor({env});
  const started = await executor.start();
  assert.equal(started.available, false);
  assert.equal(started.reason, 'GODOT_BROKER_MISMATCH');
  await executor.stop();
});
