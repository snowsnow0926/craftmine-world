// S2 protocol tests: host-owned recovery, restart reconciliation and the
// "reclaimed is not success" rule.
//
// These drive the real supervisor (`plugins/craftmine-world/godot-executor.cjs`)
// against a scripted broker stand-in and an in-memory core. The recovery pass
// itself is a seam here; `recovery-real-broker.mjs` runs the pinned broker's own
// `recover` CLI so the report the supervisor consumes is proven against the real
// binary as well.
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
const {createGodotExecutor, summarizeRecovery, BROKER_TASK_ID_MAX} =
  require('../../../plugins/craftmine-world/godot-executor.cjs');

const here = path.dirname(fileURLToPath(import.meta.url));
const stubBroker = path.join(here, 'fixtures', 'broker-stub.cjs');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const RECOVERY_POLICY = 'craftmine.windows.recovery-journal.v1';

const MANAGED_ENV = ['CRAFTMINE_GODOT_BROKER_BIN','CRAFTMINE_GODOT_ENGINE_ROOT','CRAFTMINE_GODOT_CACHE_DIR',
  'CRAFTMINE_GODOT_TOOLCHAIN_LOCK','CRAFTMINE_GODOT_BRIDGE_PATH','CRAFTMINE_GODOT_BROKER_SHA256',
  'CRAFTMINE_GODOT_BROKER_IDENTITY','CRAFTMINE_S2_FIXTURE_FILE'];
const ORIGINAL_ENV = Object.fromEntries(MANAGED_ENV.map(key => [key, process.env[key]]));

function restoreEnv() {
  for (const key of MANAGED_ENV) {
    if (ORIGINAL_ENV[key] === undefined) delete process.env[key]; else process.env[key] = ORIGINAL_ENV[key];
  }
}

/** Host-owned toolchain layout plus a project copy, mirroring the product paths. */
function environment({projectFiles = {'project.godot':'config_version=5\n', 'main.gd':'extends Node\n'}} = {}) {
  restoreEnv();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'craftmine-s2-executor-'));
  const broker = path.join(root, 'godot-host-broker.exe');
  fs.writeFileSync(broker, 'fixture-broker-placeholder');
  const engineRoot = path.join(root, 'engine');
  fs.mkdirSync(path.join(engineRoot, 'editor'), {recursive:true});
  fs.mkdirSync(path.join(engineRoot, 'templates'), {recursive:true});
  fs.writeFileSync(path.join(engineRoot, 'editor', 'Godot_v4.7.2-stable_win64.exe'), 'editor');
  fs.writeFileSync(path.join(engineRoot, 'templates', 'web_release.zip'), 'threaded');
  fs.writeFileSync(path.join(engineRoot, 'templates', 'web_nothreads_release.zip'), 'single');
  fs.writeFileSync(path.join(engineRoot, 'templates', 'version.txt'), '4.7.2.stable');
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
  process.env.CRAFTMINE_S2_FIXTURE_FILE = scenarioFile;
  process.env.CRAFTMINE_GODOT_BROKER_SHA256 = sha256(fs.readFileSync(broker));
  delete process.env.CRAFTMINE_GODOT_BROKER_IDENTITY;
  return {root, broker, engineRoot, bridge, projectRoot, artifactsRoot, dataPath, scenarioFile};
}

function setScenario(env, scenario) { fs.writeFileSync(env.scenarioFile, JSON.stringify(scenario ?? {})); }

function projectFiles(projectRoot) {
  const out = [];
  const visit = (prefix = '') => {
    for (const entry of fs.readdirSync(path.join(projectRoot, prefix), {withFileTypes:true})) {
      const relative = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.isDirectory()) visit(relative);
      else out.push({path:relative, bytes:fs.statSync(path.join(projectRoot, relative)).size,
        sha256:sha256(fs.readFileSync(path.join(projectRoot, relative)))});
    }
  };
  visit();
  return out.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

function fakeCore({worldId = 'world-s2', buildId = 'gbd-' + 'a'.repeat(64), projectRoot, artifactsRoot, inputHash = sha256('input'), jobStatus = 'queued'} = {}) {
  const state = {status:jobStatus, progress:[], finished:null, cancelled:false, executor:null, output:null};
  return {
    state,
    async call(method, params = {}) {
      switch (method) {
        case 'godotExecutor.register':
          state.executor = params.attestation;
          return {executorId:params.executorId, registered:true, executionAvailable:true,
            attestationHash:sha256(JSON.stringify(params.attestation)), promotedJobs:0};
        case 'godotExecutor.revoke': state.executor = null; return {executorId:params.executorId, revoked:true, interrupted:0};
        case 'godotBuild.read': return {jobId:params.jobId, worldId, status:state.status};
        case 'godotJob.claim':
          if (state.status !== 'queued') throw Error('GODOT_JOB_INACTIVE');
          state.status = 'claimed';
          return {jobId:params.jobId, worldId, buildId, baseId:'first-person', kind:'check', mode:'check',
            sourceRevision:3, manifestHash:sha256('manifest'), assetManifestHash:sha256('assets'), inputHash,
            projectRoot, artifactsRoot, cacheRoot:path.join(artifactsRoot, '..', 'cache'),
            files:{source:projectFiles(projectRoot), asset:[]}};
        case 'godotJob.progress': state.progress.push({stage:params.stage, percent:params.percent}); state.status = 'running'; return {jobId:params.jobId, status:'running'};
        case 'godotJob.heartbeat': return {jobId:params.jobId, status:'running'};
        case 'godotJob.finish':
          state.output = params.output;
          state.status = params.output.passed ? 'passed' : 'failed';
          return {jobId:params.jobId, status:state.status, candidateId:params.output.passed ? 'gcan-' + 'b'.repeat(64) : null};
        case 'godotBuild.cancel': state.cancelled = true; state.status = 'cancelled'; return {jobId:params.jobId, status:'cancelled'};
        case 'world.read':
          return {id:worldId, world:{build:{id:'base-a', scene:{format:'craftmine.godot-scene/1', baseId:'first-person'}, godot:{}},
            snapshot:{format:'craftmine.godot-progress/1', worldId, baseId:'first-person', baseVersion:'1.0.0', stateVersion:1, body:{coins:7}},
            extensions:[]}};
        case 'godotJob.checkDescriptor': throw Error('UNSUPPORTED');
        case 'godotJob.pending': throw Error('UNSUPPORTED');
        default: throw Error('UNSUPPORTED_METHOD:' + method);
      }
    },
  };
}

const passingEvidence = () => ({format:'craftmine.godot-runtime-check/1', scope:'base-startup', passed:true, error:null,
  ready:{ok:true, ops:['snapshot','load']}, render:{ok:true, frames:3, distinctFrames:1, captures:[]},
  errors:{ok:true, runtime:[], console:[]}, snapshot:{ok:true, equal:true},
  isolation:{ok:true, guard:{focus:0, pointerLock:0}}, recovery:{ok:true, gracefulExit:true}});

/**
 * A scripted `recover` pass. It reports every task root it can see, so the
 * supervisor's attempt records can be correlated with real task ids. Entries
 * are only "reclaimed" when the scenario says identity was re-proved.
 */
function recoveryRunner({reclaim = true, entries = null, report = null, unreadable = []} = {}) {
  const calls = [];
  const run = async (binary, args) => {
    const tasksRoot = args[1];
    let discovered = [];
    try {
      discovered = fs.readdirSync(tasksRoot, {withFileTypes:true})
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
        .map(entry => entry.name);
    } catch { discovered = []; }
    const built = entries ?? discovered.map(taskId => ({
      taskId, operation:'import', identityVerified:reclaim, finalReceiptObserved:false,
      brokerPid:1, brokerStillRunning:false, childPid:null, childCreationTimeFiletime:null,
      childProcessState:'gone', profileName:'craftmine.godot.task.' + taskId, profileDeleted:reclaim,
      profileHresult:reclaim ? 0 : null, taskRootRemoved:reclaim, journalRemoved:reclaim,
      reclaimed:reclaim ? ['work','bin','logs','artifacts'] : [],
      skipped:reclaim ? [] : ['identity-marker-mismatch'], notes:[],
    }));
    const value = report ?? {policyVersion:RECOVERY_POLICY, tasksRoot, journalRoot:path.join(tasksRoot, '.recovery-journal'),
      entries:built, unreadable, reconciledCount:built.filter(entry => entry.identityVerified && entry.journalRemoved).length,
      skippedCount:built.filter(entry => !(entry.identityVerified && entry.journalRemoved)).length};
    calls.push({args:[...args], report:value});
    return {error:null, exitCode:0, stdout:JSON.stringify(value), stderr:''};
  };
  return Object.assign(run, {calls});
}

function makeExecutor({env, core, verifier = {godotCheck:async () => passingEvidence()}, runRecovery, jobTimeoutMs = 30000, toolchain}) {
  return createGodotExecutor(core ?? fakeCore({projectRoot:env.projectRoot, artifactsRoot:env.artifactsRoot}), {
    dataPath:env.dataPath, verifier, jobTimeoutMs, logger:{log(){}, warn(){}, error(){}},
    spawnBroker:(binary, args, settings) => spawn(process.execPath, [stubBroker, ...args], settings),
    runRecovery, toolchain,
  });
}

async function waitFor(predicate, timeoutMs = 20000, label = 'condition') {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() > deadline) throw Error('timed out waiting for ' + label);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

const triggers = executor => (executor.status().recoveries ?? []).map(entry => entry.trigger);

test('an unpinned broker and its self-nominated adjacent manifest never execute recovery',async()=>{
  const env=environment();
  delete process.env.CRAFTMINE_GODOT_BROKER_SHA256;
  fs.writeFileSync(path.join(path.dirname(env.broker),'broker-identity.json'),JSON.stringify({
    format:'craftmine.godot-broker-identity/1',sha256:sha256(fs.readFileSync(env.broker)),bytes:fs.statSync(env.broker).size}));
  const recovery=recoveryRunner({entries:[]});
  const executor=makeExecutor({env,runRecovery:recovery});
  assert.equal((await executor.start()).reason,'GODOT_BROKER_PIN_REQUIRED');
  assert.equal(recovery.calls.length,0);
  await executor.stop();
});

test('private host configuration pins the broker independently of child environment',async()=>{
  const env=environment();
  const identity=path.join(env.root,'release-identity.json');
  fs.writeFileSync(identity,JSON.stringify({format:'craftmine.godot-broker-identity/1',
    sha256:sha256(fs.readFileSync(env.broker)),bytes:fs.statSync(env.broker).size}));
  process.env.CRAFTMINE_GODOT_BROKER_SHA256='0'.repeat(64);
  const toolchain={broker:env.broker,brokerIdentity:identity,engineRoot:env.engineRoot,
    toolchainLock:process.env.CRAFTMINE_GODOT_TOOLCHAIN_LOCK,bridgePath:env.bridge};
  const recovery=recoveryRunner({entries:[]});
  const executor=makeExecutor({env,runRecovery:recovery,toolchain});
  assert.equal((await executor.start()).available,true);
  await executor.stop();
  fs.writeFileSync(identity,'{bad');
  const rejected=makeExecutor({env,runRecovery:recovery,toolchain});
  const before=recovery.calls.length;
  assert.equal((await rejected.start()).reason,'GODOT_BROKER_PIN_REQUIRED');
  assert.equal(recovery.calls.length,before);
  await rejected.stop();
});

test('a recovery entry counts as reclaimed only when identity and journal retirement are both proven', () => {
  const report = {policyVersion:RECOVERY_POLICY, tasksRoot:'D:\\tasks', journalRoot:'D:\\tasks\\.recovery-journal',
    reconciledCount:1, skippedCount:2,
    entries:[
      {taskId:'im-1', operation:'import', identityVerified:true, journalRemoved:true, finalReceiptObserved:false,
        childProcessState:'gone', childPid:4242, taskRootRemoved:true, profileDeleted:true, reclaimed:['work'], skipped:[]},
      {taskId:'im-2', operation:'import', identityVerified:true, journalRemoved:false, finalReceiptObserved:false,
        childProcessState:'pid-reused', taskRootRemoved:false, profileDeleted:false, reclaimed:[], skipped:['pid-reused']},
      {taskId:'im-3', operation:'import', identityVerified:false, journalRemoved:false, finalReceiptObserved:false,
        brokerStillRunning:true, childProcessState:'unknown', taskRootRemoved:false, profileDeleted:false, reclaimed:[],
        skipped:['broker-still-running']},
    ],
    unreadable:[{file:'broken.json', error:'truncated'}]};
  const summary = summarizeRecovery(report, {trigger:'startup', exitCode:1});
  assert.equal(summary.ok, true);
  assert.equal(summary.trigger, 'startup');
  assert.equal(summary.reclaimed.length, 1);
  assert.equal(summary.reclaimed[0].taskId, 'im-1');
  // A recovery pass is by definition a run without a final response.
  assert.equal(summary.reclaimed[0].finalReceiptObserved, false);
  assert.equal(summary.skipped.length, 2);
  assert.deepEqual(summary.skipped.map(entry => entry.reasons[0]), ['pid-reused', 'broker-still-running']);
  assert.equal(summary.unreadable.length, 1);
  assert.equal(summary.finalReceiptClaimed, false);
});

test('a report that claims a final receipt is surfaced as a contradiction', () => {
  const summary = summarizeRecovery({policyVersion:RECOVERY_POLICY, tasksRoot:'D:\\tasks',
    entries:[{taskId:'im-1', identityVerified:true, journalRemoved:true, finalReceiptObserved:true, reclaimed:[], skipped:[]}],
    unreadable:[]}, {trigger:'startup'});
  assert.equal(summary.finalReceiptClaimed, true);
});

test('an unparseable recovery output is reported, never treated as a clean pass', () => {
  const summary = summarizeRecovery(null, {trigger:'broker-exit', parseError:'Unexpected token', exitCode:3});
  assert.equal(summary.ok, false);
  assert.equal(summary.parseError, 'Unexpected token');
  assert.deepEqual(summary.reclaimed, []);
});

test('startup runs a recovery pass over the executor tasks root before preflight', async () => {
  const env = environment();
  const recovery = recoveryRunner({entries:[]});
  const executor = makeExecutor({env, runRecovery:recovery});
  const status = await executor.start();
  assert.equal(status.available, true);
  assert.ok(recovery.calls.length >= 1);
  assert.deepEqual(recovery.calls[0].args, ['recover', status.tasksRoot]);
  assert.equal(triggers(executor)[0], 'startup');
  assert.equal(status.startupRecovery.ok, true);
  await executor.stop();
});

test('a broker that dies without a final response is reclaimed, never counted as success', async () => {
  const env = environment();
  setScenario(env, {exitWithoutResponseOperation:'import'});
  const recovery = recoveryRunner({});
  const core = fakeCore({projectRoot:env.projectRoot, artifactsRoot:env.artifactsRoot});
  const executor = makeExecutor({env, core, runRecovery:recovery});
  await executor.start();
  assert.equal(executor.enqueue({jobId:'gjob-' + 'c'.repeat(64), worldId:'world-s2', mode:'check'}).enqueued, true);
  await waitFor(() => core.state.output !== null, 20000, 'job failure');
  const status = executor.status();
  assert.ok(triggers(executor).includes('broker-exit'),
    'the abnormal exit must trigger a recovery pass; triggers=' + JSON.stringify(triggers(executor)) + ' state=' + JSON.stringify(status.state) + ' reason=' + JSON.stringify(status.reason) + ' jobs=' + JSON.stringify(status.jobs));
  const durable = executor.ledger.jobs['gjob-' + 'c'.repeat(64)];
  assert.equal(durable.state, 'failed');
  assert.equal(durable.attempts.length, 1);
  assert.equal(durable.attempts[0].outcome, 'reclaimed-without-final-receipt');
  assert.equal(durable.attempts[0].transport, null);
  // The reclaimed task never becomes a passed job.
  assert.notEqual(core.state.output?.passed, true);
  await executor.stop();
});

test('a broker success that did not retire its journal entry still triggers recovery', async () => {
  const env = environment();
  setScenario(env, {journalCleared:false});
  const recovery = recoveryRunner({});
  const core = fakeCore({projectRoot:env.projectRoot, artifactsRoot:env.artifactsRoot});
  const executor = makeExecutor({env, core, runRecovery:recovery});
  await executor.start();
  assert.equal(executor.enqueue({jobId:'gjob-' + 'd'.repeat(64), worldId:'world-s2', mode:'check'}).enqueued, true);
  try {
    await waitFor(() => executor.ledger.jobs['gjob-' + 'd'.repeat(64)]?.state === 'finished', 20000, 'job finish');
  } catch (error) {
    throw Error(error.message + ' entry=' + JSON.stringify(executor.ledger.jobs['gjob-' + 'd'.repeat(64)])
      + ' core=' + JSON.stringify(core.state) + ' status=' + JSON.stringify(executor.status().reason));
  }
  // A valid build is not failed for a leftover journal entry, but the host must
  // say so: the attempt records the missing retirement and a recovery pass runs.
  assert.equal(core.state.output?.passed, true);
  assert.ok(triggers(executor).includes('broker-exit'));
  const attempts = executor.ledger.jobs['gjob-' + 'd'.repeat(64)].attempts;
  assert.deepEqual(attempts.map(attempt => attempt.outcome), ['succeeded', 'succeeded']);
  assert.deepEqual(attempts.map(attempt => attempt.journalRetired), [false, false]);
  await executor.stop();
});

test('a failing recovery pass cannot change a job result', async () => {
  const env = environment();
  setScenario(env, {delayMs:1500});
  const recovery = async () => { throw Error('recovery runner exploded'); };
  const core = fakeCore({projectRoot:env.projectRoot, artifactsRoot:env.artifactsRoot});
  const executor = makeExecutor({env, core, runRecovery:recovery});
  await executor.start();
  const jobId = 'gjob-' + '2'.repeat(64);
  executor.enqueue({jobId, worldId:'world-s2', mode:'check'});
  await waitFor(() => core.state.status === 'running', 20000, 'claim');
  await executor.cancel(jobId, 'test cancel');
  await waitFor(() => !executor.status().jobs.includes(jobId), 20000, 'cancel settle');
  const status = executor.status();
  assert.equal(status.state, 'registered');
  assert.ok((status.recoveries ?? []).every(entry => entry.ok === false), 'a failed pass must be reported as not ok');
  assert.equal(executor.ledger.jobs[jobId].outcome, 'cancelled');
  await executor.stop();
});

test('a damaged ledger entry cannot stop the executor from starting', async () => {
  const env = environment();
  const jobId = 'gjob-' + '3'.repeat(64);
  fs.mkdirSync(path.join(env.dataPath, 'godot'), {recursive:true});
  fs.writeFileSync(path.join(env.dataPath, 'godot', 'executor-ledger.json'), JSON.stringify({
    format:'craftmine.godot-executor-ledger/1', updatedAt:null,
    // No `attempts` array and an unknown state, as an older version could write.
    jobs:{[jobId]:{jobId, worldId:'world-s2', mode:'check', state:'running'}},
  }));
  const recovery = recoveryRunner({entries:[]});
  const core = fakeCore({projectRoot:env.projectRoot, artifactsRoot:env.artifactsRoot});
  const executor = makeExecutor({env, core, runRecovery:recovery});
  const status = await executor.start();
  assert.equal(status.available, true);
  assert.deepEqual(executor.ledger.jobs[jobId].attempts, []);
  // Nothing was ever started for this entry, so re-enqueueing it is safe.
  assert.equal(executor.ledger.jobs[jobId].state, 'enqueued');
  assert.ok(status.restartReconciliation.requeued.includes(jobId));
  await executor.stop();
});

test('cancel runs a recovery pass of its own', async () => {
  const env = environment();
  setScenario(env, {delayMs:1500});
  const recovery = recoveryRunner({});
  const core = fakeCore({projectRoot:env.projectRoot, artifactsRoot:env.artifactsRoot});
  const executor = makeExecutor({env, core, runRecovery:recovery});
  await executor.start();
  const jobId = 'gjob-' + 'e'.repeat(64);
  executor.enqueue({jobId, worldId:'world-s2', mode:'check'});
  await waitFor(() => core.state.status === 'running', 20000, 'claim');
  await executor.cancel(jobId, 'test cancel');
  await waitFor(() => !executor.status().jobs.includes(jobId), 20000, 'cancel settle');
  assert.ok(triggers(executor).includes('cancel'), 'cancel must run its own recovery pass');
  assert.equal(core.state.cancelled, true);
  await executor.stop();
});

test('stop runs a recovery pass after every job has settled', async () => {
  const env = environment();
  const recovery = recoveryRunner({entries:[]});
  const executor = makeExecutor({env, runRecovery:recovery});
  await executor.start();
  await executor.stop();
  assert.ok(triggers(executor).includes('stop'));
  assert.equal(executor.status().stopRecovery.ok, true);
});

test('restart reconciliation never restarts a job whose old task identity was not re-proved', async () => {
  const env = environment();
  const jobId = 'gjob-' + 'f'.repeat(64);
  fs.mkdirSync(path.join(env.dataPath, 'godot'), {recursive:true});
  fs.writeFileSync(path.join(env.dataPath, 'godot', 'executor-ledger.json'), JSON.stringify({
    format:'craftmine.godot-executor-ledger/1', executorId:'craftmine-windows-broker-v1', updatedAt:null,
    jobs:{[jobId]:{jobId, worldId:'world-s2', mode:'check', state:'running', startedAt:'2026-09-10T00:00:00.000Z',
      finishedAt:null, outcome:null, reason:null,
      attempts:[{requestId:'im-0123456789abcdef01234567', operation:'import', startedAt:'2026-09-10T00:00:00.000Z', outcome:null}]}},
  }));
  // No task root exists, so the recovery pass cannot re-prove the identity.
  const recovery = recoveryRunner({entries:[]});
  const core = fakeCore({projectRoot:env.projectRoot, artifactsRoot:env.artifactsRoot});
  const executor = makeExecutor({env, core, runRecovery:recovery});
  const status = await executor.start();
  assert.deepEqual(status.jobs, [], 'an unverified leftover must not be started again');
  assert.equal(status.restartReconciliation.unverifiable.length, 1);
  assert.equal(status.restartReconciliation.unverifiable[0].jobId, jobId);
  assert.equal(executor.ledger.jobs[jobId].state, 'interrupted');
  assert.equal(executor.ledger.jobs[jobId].reason, 'GODOT_RESTART_IDENTITY_UNVERIFIED');
  assert.equal(executor.ledger.jobs[jobId].attempts[0].outcome, 'unknown-at-restart');
  await executor.stop();
});

test('restart reconciliation requeues only after the recovery pass re-proved the old task', async () => {
  const env = environment();
  const jobId = 'gjob-' + '1'.repeat(64);
  const requestId = 'im-0123456789abcdef01234567';
  fs.mkdirSync(path.join(env.dataPath, 'godot'), {recursive:true});
  fs.writeFileSync(path.join(env.dataPath, 'godot', 'executor-ledger.json'), JSON.stringify({
    format:'craftmine.godot-executor-ledger/1', executorId:'craftmine-windows-broker-v1', updatedAt:null,
    jobs:{[jobId]:{jobId, worldId:'world-s2', mode:'check', state:'running', startedAt:'2026-09-10T00:00:00.000Z',
      finishedAt:null, outcome:null, reason:null,
      attempts:[{requestId, operation:'import', startedAt:'2026-09-10T00:00:00.000Z', outcome:null}]}},
  }));
  const recovery = recoveryRunner({entries:[{taskId:requestId, operation:'import', identityVerified:true,
    finalReceiptObserved:false, brokerStillRunning:false, childProcessState:'gone', taskRootRemoved:true,
    profileDeleted:true, journalRemoved:true, reclaimed:['work','bin','logs','artifacts'], skipped:[], notes:[]}]});
  const core = fakeCore({projectRoot:env.projectRoot, artifactsRoot:env.artifactsRoot});
  const executor = makeExecutor({env, core, runRecovery:recovery});
  const status = await executor.start();
  assert.ok(status.restartReconciliation.requeued.includes(jobId));
  assert.equal(executor.ledger.jobs[jobId].attempts[0].outcome, 'reclaimed-without-final-receipt');
  await waitFor(() => executor.ledger.jobs[jobId].state === 'finished', 20000, 'requeued job finish');
  await executor.stop();
});

test('the executor source contains no pid or image-name process cleanup', () => {
  const source = fs.readFileSync(path.join(here, '..', '..', '..', 'plugins', 'craftmine-world', 'godot-executor.cjs'), 'utf8');
  assert.equal(/tasklist|taskkill/i.test(source), false, 'process cleanup must go through the broker recovery pass');
  assert.match(source, /'recover', tasksRoot/);
});

test('the generated broker task id stays inside the Windows profile-name limit', () => {
  // `craftmine.godot.task.<taskId>` must fit in 64 characters.
  assert.equal(BROKER_TASK_ID_MAX, 64 - 'craftmine.godot.task.'.length);
  assert.equal('craftmine.godot.task.'.length + BROKER_TASK_ID_MAX, 64);
});
