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
import {creationPackFixture,creationProjectBinary} from '../../helpers/creation-pack-fixture.mjs';

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
  process.env.CRAFTMINE_GODOT_BROKER_SHA256 = sha256(fs.readFileSync(broker));
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
        case 'godotBuild.read': return {jobId:params.jobId, worldId, buildId, status:state.status};
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

function makeExecutor({env, core = fakeCore({projectRoot:env.projectRoot, artifactsRoot:env.artifactsRoot, files:env.files}), verifier = {godotCheck: async () => passingEvidence()}, jobTimeoutMs = 30000, runRecovery, logger}) {
  return createGodotExecutor(core, {
    dataPath:env.dataPath, verifier, jobTimeoutMs, runRecovery, logger:logger ?? {log(){}, warn(){}, error(){}},
    spawnBroker: (binary, args, settings) => spawn(process.execPath, [fixtureBroker, ...args], settings),
  });
}

test('stop drains a real pending broker preflight and prevents obsolete registration', async t => {
  const env=environment();t.after(restoreEnv);setScenario(env,{delayMs:250});
  const core=fakeCore(env),calls=[];const call=core.call.bind(core);
  core.call=async(method,params)=>{calls.push(method);return call(method,params);};
  let spawned;const reached=new Promise(resolve=>{spawned=resolve;});let child;
  const executor=createGodotExecutor(core,{dataPath:env.dataPath,logger:{log(){},warn(){}},
    spawnBroker:(_binary,args,settings)=>{child=spawn(process.execPath,[fixtureBroker,...args],settings);spawned();return child;}});
  const startup=executor.start();await reached;
  const stopping=executor.stop();
  await Promise.all([startup,stopping]);
  assert.notEqual(child.exitCode,null,'stop must drain the broker process');
  assert.equal(calls.includes('godotExecutor.register'),false);
  assert.equal(executor.status().state,'stopped');assert.equal(executor.registered,false);
});

test('stop drains an in-flight registration, revokes it, then admits one fresh restart', async t => {
  const env=environment();t.after(restoreEnv);const core=fakeCore(env),calls=[];
  let releaseRegister,reachedRegister;const barrier=new Promise(resolve=>{releaseRegister=resolve;});
  const reached=new Promise(resolve=>{reachedRegister=resolve;});const call=core.call.bind(core);let first=true;
  core.call=async(method,params)=>{calls.push(method);if(method==='godotExecutor.register'&&first){first=false;reachedRegister();await barrier;}return call(method,params);};
  const executor=makeExecutor({env,core});const initial=executor.start();await reached;
  let stopped=false;const stop=executor.stop().then(value=>{stopped=true;return value;});
  const restart=executor.start();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(stopped,false);assert.equal(calls.filter(x=>x==='godotExecutor.register').length,1);
  releaseRegister();await Promise.all([initial,stop]);await restart;
  const lifecycle=calls.filter(x=>['godotExecutor.register','godotExecutor.revoke'].includes(x));
  assert.deepEqual(lifecycle,['godotExecutor.register','godotExecutor.revoke','godotExecutor.register']);
  assert.equal(executor.registered,true);await executor.stop();assert.equal(core.state.executor,null);
});

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

test('new bin retirement waits for core acknowledgment; preflight/import/export preserve diagnostics', async t => {
  const env = environment(); t.after(restoreEnv); setScenario(env, {retireBin:true});
  const core = fakeCore(env), originalCall = core.call.bind(core);
  const tasks = path.join(env.dataPath, 'godot', 'tasks');
  core.call = async (method, params) => {
    if (method === 'godotJob.finish') {
      const buildTasks = fs.readdirSync(tasks).filter(name => /^(im|ex)-/.test(name));
      assert.equal(buildTasks.length, 2);
      for (const task of buildTasks) {
        assert.equal(fs.readdirSync(path.join(tasks, task, 'bin')).length, 2, 'no deletion before core acknowledgment');
        assert.equal(fs.existsSync(path.join(tasks, task, 'bin-retirement-ack.json')), false);
      }
    }
    return originalCall(method, params);
  };
  const executor = makeExecutor({env, core});
  assert.equal((await executor.start()).available, true);
  const jobId = 'gjob-' + 'd'.repeat(64);
  executor.enqueue({jobId, worldId:'world-c', mode:'check'}); await settle(executor, jobId); await executor.stop();
  assert.equal(core.state.status, 'passed');
  const roots = fs.readdirSync(tasks).filter(name => /^(pf|im|ex)-/.test(name));
  assert.equal(roots.length, 3);
  for (const task of roots) {
    const root = path.join(tasks, task);
    assert.deepEqual(fs.readdirSync(path.join(root, 'bin')), []);
    const ack = JSON.parse(fs.readFileSync(path.join(root, 'bin-retirement-ack.json')));
    assert.equal(ack.brokerReceipt.taskId, task);
    assert.equal(fs.existsSync(path.join(root, 'logs', 'task.log')), true);
    if (task.startsWith('ex-')) assert.equal(fs.existsSync(path.join(root, 'artifacts', 'index.html')), true);
  }
});

for (const fault of ['lost-finish', 'failed-check', 'refused-registration']) {
  test(`new bin retirement preserves copies after ${fault}`, async t => {
    const env=environment(); t.after(restoreEnv); setScenario(env,{retireBin:true});
    const core=fakeCore(env), originalCall=core.call.bind(core);
    core.call=async(method,params)=>{
      if (method==='godotExecutor.register' && fault==='refused-registration') throw Error('authored registration refusal');
      const result=await originalCall(method,params);
      if (method==='godotJob.finish' && fault==='lost-finish') throw Error('authored reply lost after core commit');
      return result;
    };
    const executor=makeExecutor({env,core,verifier:fault==='failed-check'?{godotCheck:async()=>passingEvidence({passed:false,error:'authored runtime failure'})}:undefined});
    await executor.start();
    const jobId='gjob-'+'e'.repeat(64);
    if(fault!=='refused-registration'){executor.enqueue({jobId,worldId:'world-c',mode:'check'});await settle(executor,jobId);}
    await executor.stop();
    const tasks=path.join(env.dataPath,'godot','tasks');
    const roots=fs.readdirSync(tasks).filter(name=>fault==='refused-registration'?name.startsWith('pf-'):/^(im|ex)-/.test(name));
    assert.equal(roots.length,fault==='refused-registration'?1:2);
    for(const task of roots){
      assert.equal(fs.readdirSync(path.join(tasks,task,'bin')).length,2);
      assert.equal(fs.existsSync(path.join(tasks,task,'bin-retirement-ack.json')),false);
    }
    if(fault==='lost-finish')assert.equal(core.state.status,'passed','actual stand-in core committed before its reply was lost');
  });
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

test('task path preparation rejection retains its reason and never reaches export/check', async t => {
  let checks = 0;
  const {core, started, env, jobId} = await runJob(t, {
    verifier:{godotCheck:async()=>{ checks++; return passingEvidence(); }},
    beforeJob:async env=>setScenario(env,{omitRequestId:true,state:'failed',
      error:'GODOT_TASK_PATH_TOO_LONG: prepare editor-cache path uses 266 UTF-16 units; limit 245'}),
  });
  assert.equal(started.available,true);
  assert.equal(core.state.output.passed,false);
  const ledger=JSON.parse(fs.readFileSync(path.join(env.dataPath,'godot/executor-ledger.json'),'utf8'));
  assert.equal(ledger.jobs[jobId].reason,'GODOT_TASK_PATH_TOO_LONG');
  assert.deepEqual(core.state.output.compile.errors,['GODOT_TASK_PATH_TOO_LONG']);
  assert.equal(core.state.progress.some(row=>row.stage==='export'),false);
  assert.equal(checks,0);
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

test('a bound verifier failure survives native assertion projection and build-read diagnostics',async t=>{
  const {core,jobId}=await runJob(t,{verifier:{godotCheck:async descriptor=>passingEvidence({
    jobId:descriptor.jobId,worldId:descriptor.worldId,buildId:descriptor.buildId,inputHash:descriptor.inputHash,
    passed:false,error:'MIGRATION_CREATION_STATE_INVALID',snapshot:{ok:false,equal:false},render:{ok:false,frames:0,distinctFrames:0},
  })}});
  const output=core.state.output;
  assert.equal(output.passed,false);assert.equal(output.check.passed,false);
  assert.deepEqual(output.check.assertions.find(a=>a.id==='runtime.verifier-error'),{id:'runtime.verifier-error',passed:false,detail:'MIGRATION_CREATION_STATE_INVALID'});
  const {diagnoseGodotBuildRead}=require('../../../plugins/craftmine-world/godot-diagnostics.cjs');
  const record={jobId,worldId:'world-c',buildId:'gbd-'+'a'.repeat(64),status:'failed',output,outputHash:sha256(JSON.stringify(output))};
  const before=JSON.stringify(record),diagnostic=diagnoseGodotBuildRead(record).diagnostics.find(d=>d.errorCode==='MIGRATION_CREATION_STATE_INVALID');
  assert(diagnostic);assert.equal(diagnostic.trust,'untrusted-data');assert.equal(diagnostic.source.outputHash,record.outputHash);
  assert.equal(diagnostic.assertionRef.id,'runtime.verifier-error');assert.equal(JSON.stringify(record),before);
});

test('verifier diagnostic text is bounded and foreign or successful evidence cannot add a failure',async t=>{
  for(const variant of ['long','unicode','worldId','jobId','buildId','inputHash','scope','format','success']){
    const {core}=await runJob(t,{verifier:{godotCheck:async descriptor=>passingEvidence({
      jobId:descriptor.jobId,worldId:descriptor.worldId,buildId:descriptor.buildId,inputHash:descriptor.inputHash,
      ...(['worldId','jobId','buildId','inputHash','scope','format'].includes(variant)?{[variant]:'foreign'}:{}),
      passed:variant==='success',error:variant==='unicode'?'x'.repeat(511)+'🐶more':'MIGRATION_FAILURE\n'+('untrusted diagnostic '.repeat(100)),
    })}});
    const output=core.state.output,reason=output.check.assertions.find(a=>a.id==='runtime.verifier-error');
    assert.equal(output.passed,variant==='success');
    if(variant==='long'){assert(reason.detail.length<=524);assert(reason.detail.endsWith(' [truncated]'));assert(!/[\u0000-\u001f\u007f]/.test(reason.detail));}
    else if(variant==='unicode'){assert.equal(reason.detail,'x'.repeat(511)+'🐶 [truncated]');assert(reason.detail.isWellFormed());}
    else assert.equal(reason,undefined);
  }
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

test('actual two-log shape permits one verified native import recovery and preserves its full check',async t=>{
  const env=environment();t.after(restoreEnv);
  const nativeLog=fs.readFileSync(new URL('./fixtures/native-import-task.log',import.meta.url),'utf8');
  assert.equal(sha256(nativeLog),'a6fd727c7e52d069d76b57208e07faea3d84389dc449c2e497ee1316dfb95dbc');
  setScenario(env,{importCrash:true,log:nativeLog});
  const core=fakeCore(env),runRecovery=async(_binary,args)=>({exitCode:0,stdout:JSON.stringify({policyVersion:'craftmine.windows.recovery-journal.v1',tasksRoot:args[1],journalRoot:args[1],entries:[],unreadable:[]}),stderr:''});
  const executor=makeExecutor({env,core,runRecovery});assert.equal((await executor.start()).available,true);
  const jobId='gjob-'+'d'.repeat(64);executor.enqueue({jobId,worldId:'world-c',mode:'check'});await settle(executor,jobId);
  await executor.stop();assert.equal(core.state.status,'passed');
  const saved=JSON.parse(fs.readFileSync(path.join(env.dataPath,'godot/executor-ledger.json'),'utf8')).jobs[jobId];
  assert.equal(saved.importCrashRetries,1);assert.equal(saved.attempts.length,3);
  assert.equal(saved.attempts[0].failure.engineExitCode,0xc0000005);assert.equal(saved.attempts[0].retryDecision.reason,'VERIFIED_NATIVE_IMPORT_CRASH');
  assert.equal(saved.attempts[0].retryDecision.logSha256,sha256(nativeLog));
  assert.notEqual(saved.attempts[0].requestId,saved.attempts[1].requestId);assert.equal(saved.attempts[1].outcome,'succeeded');assert.equal(saved.attempts[2].operation,'exportWeb');
  assert.ok(core.state.output.check.assertions.every(x=>x.passed));
  await executor.start();assert.equal(executor.ledger.jobs[jobId].importCrashRetries,1);await executor.stop();
});

test('a linked declared preflight cannot authorize native import recovery',async t=>{
  const env=environment();t.after(restoreEnv);
  const target=path.join(env.root,'link-target'),link=path.join(env.root,'link-probe');
  fs.writeFileSync(target,'test');
  try{fs.symlinkSync(target,link);}catch(error){if(['EPERM','EACCES'].includes(error.code)){t.skip('host does not permit file symlinks');return;}throw error;}
  setScenario(env,{importCrash:true,crashTamper:'log-link'});
  const core=fakeCore(env),runRecovery=async(_binary,args)=>({exitCode:0,stdout:JSON.stringify({policyVersion:'craftmine.windows.recovery-journal.v1',tasksRoot:args[1],journalRoot:args[1],entries:[],unreadable:[]}),stderr:''});
  const executor=makeExecutor({env,core,runRecovery});assert.equal((await executor.start()).available,true);
  const jobId='gjob-'+'f'.repeat(64);executor.enqueue({jobId,worldId:'world-c',mode:'check'});await settle(executor,jobId);await executor.stop();
  assert.equal(core.state.status,'failed');assert.equal(executor.ledger.jobs[jobId].attempts.length,1);
  assert.ok(!executor.ledger.jobs[jobId].importCrashRetries);
});

test('script errors, changed inputs, unknown cleanup and repeated crashes never become successful retries',async t=>{
  for(const crashTamper of ['cleanup','journal','resource','source','input','exit','log-hash','preflight-hash',
    'preflight-missing','duplicate-log','unknown-log','preflight-mismatch','preflight-invalid','log-directory','script','second-crash']){
    const env=environment();t.after(restoreEnv);setScenario(env,{importCrash:true,crashTamper,crashCount:crashTamper==='second-crash'?2:1});
    const core=fakeCore(env),runRecovery=async(_binary,args)=>({exitCode:0,stdout:JSON.stringify({policyVersion:'craftmine.windows.recovery-journal.v1',tasksRoot:args[1],journalRoot:args[1],entries:[],unreadable:[]}),stderr:''});
    const executor=makeExecutor({env,core,runRecovery});assert.equal((await executor.start()).available,true);
    const jobId='gjob-'+'e'.repeat(64);executor.enqueue({jobId,worldId:'world-c',mode:'check'});await settle(executor,jobId);await executor.stop();
    assert.equal(core.state.status,'failed',crashTamper);const attempts=executor.ledger.jobs[jobId].attempts;
    assert.equal(attempts.length,crashTamper==='second-crash'?2:1,crashTamper);assert.ok(attempts.every(x=>x.operation==='import'));
  }
});

// The broker/core here are protocol fixtures; these are not native engine evidence.
for (const variant of ['matched','descriptor-missing','descriptor-dropped','descriptor-mixed','assertion-missing','assertion-false','assertion-duplicate']) {
  test('finite runtime expectation: ' + variant, async t => {
    const env=environment();t.after(restoreEnv);setScenario(env,{});
    const core=fakeCore(env), original=core.call.bind(core);
    const required={format:'craftmine.godot-check-requirements/1',targetFeedback:{targetId:'target_a',hitFlashMilliseconds:500}};
    const hash=sha256('craftmine.godot-check-requirements/1\ntarget_a\n500\n');
    let claimed, seen, descriptorCalls=0, fallbackReads=0;
    core.call=async(method,args)=>{
      if(method==='godotJob.claim') return claimed={...await original(method,args),checkRequirements:required,checkRequirementsHash:hash};
      if(method==='world.read') fallbackReads++;
      if(method==='godotJob.checkDescriptor') {
        descriptorCalls++;
        if(variant==='descriptor-missing') throw Error('UNSUPPORTED');
        const descriptor={format:'craftmine.godot-check-descriptor/1',phase:'check',jobId:args.jobId,
          worldId:claimed.worldId,buildId:claimed.buildId,inputHash:claimed.inputHash,baseId:'first-person',
          root:env.artifactsRoot,entry:'web/index.html',threads:true,artifacts:args.artifacts,snapshot:null};
        if(variant!=='descriptor-dropped') Object.assign(descriptor,{checkRequirements:required,checkRequirementsHash:hash});
        if(variant==='descriptor-mixed') descriptor.worldId='other-world';
        return descriptor;
      }
      return original(method,args);
    };
    const evidence={format:'craftmine.godot-check-requirements-evidence/1',requirementsHash:hash,
      jobId:'gjob-'+ '7'.repeat(64),worldId:'world-c',buildId:'gbd-'+ 'a'.repeat(64),instanceId:'runtime-one',
      observations:[{phase:'loaded',targetId:'target_a',hitFlashMilliseconds:500},
        {phase:'running',targetId:'target_a',hitFlashMilliseconds:500}]};
    const verifier={godotCheck:async descriptor=>{
      seen=descriptor;
      const assertion={id:'runtime.target-feedback',passed:variant!=='assertion-false',detail:'actual observations'};
      const assertions=variant==='assertion-missing'?[]:variant==='assertion-duplicate'?[assertion,assertion]:[assertion];
      return passingEvidence({requirementsEvidence:evidence,assertions});
    }};
    const executor=makeExecutor({env,core,verifier});
    assert.equal((await executor.start()).available,true);
    executor.enqueue({jobId:evidence.jobId,worldId:'world-c',mode:'check'});
    await settle(executor,evidence.jobId);await executor.stop();
    assert.equal(descriptorCalls,1);assert.equal(fallbackReads,0,'required checks must never use legacy descriptor fallback');
    assert.equal(core.state.status,variant==='matched'?'passed':'failed',JSON.stringify(core.state.output));
    if(variant.startsWith('descriptor-')) assert.equal(seen,undefined);
    else {
      assert.deepEqual(seen.checkRequirements,required);
      assert.deepEqual(core.state.output.check.requirementsEvidence,evidence);
      assert.equal(core.state.output.check.assertions.find(a=>a.id==='runtime.target-feedback').passed,variant==='matched');
    }
  });
}

// ---------------------------------------------------------------------------
// Failure settlement and immutable build evidence.
//
// Unlike the single-job `fakeCore` above, these paths need one status per job
// and a scriptable refusal, so they drive a stand-in that behaves like the real
// core where the assertions depend on it: a claim is bound to its token, a
// terminal job rejects a late result, and a refused result leaves the job's
// lease active until an explicit settlement is submitted. The real Rust core is
// exercised separately by the `craftmine-core` job tests; nothing here is
// native engine evidence.

const SAME_SOURCE_ARTIFACTS = {'index.html':'<!doctype html><canvas id="canvas"></canvas>',
  'index.js':'// game', 'bridge.js':'// authored bridge'};

/** Evidence is compared by identity and timestamp, not only by size. */
function evidenceFingerprint(file) {
  const info = fs.statSync(file);
  return {path:path.basename(file), bytes:info.size, mtimeMs:info.mtimeMs, ino:info.ino || 0};
}

function assertEvidenceUnchanged(before, files, why) {
  files.forEach((file, index) => {
    const after = evidenceFingerprint(file);
    assert.equal(after.bytes, before[index].bytes, why + ': ' + after.path + ' length changed');
    assert.equal(after.mtimeMs, before[index].mtimeMs, why + ': ' + after.path + ' was rewritten');
    if (before[index].ino && after.ino) assert.equal(after.ino, before[index].ino, why + ': ' + after.path + ' was replaced');
  });
}

/**
 * A per-job core stand-in with a call log and refusing hooks. A hook that
 * throws refuses the call exactly like the core; returning undefined keeps the
 * default behaviour, and `commit` performs the core's own commit.
 */
function scriptedCore({worldId = 'world-c', buildId = 'gbd-' + 'a'.repeat(64), baseId = 'first-person', allowPending = false, projectRoot, artifactsRoot,
  files, inputHash = sha256('input')} = {}) {
  const jobs = new Map();
  const core = {jobs, calls:[], stages:[], hooks:{}, worldId, buildId};
  core.attempts = (jobId, method) => core.calls.filter(call => call.method === method && call.params?.jobId === jobId);
  core.addJob = id => {
    jobs.set(id, {jobId:id, worldId, buildId, kind:'check', mode:'check', status:'queued', token:null,
      inputHash, output:null, outputHash:null, candidateId:null, stage:'queued', evidenceHash:null});
    return jobs.get(id);
  };
  const lease = job => ['claimed', 'running'].includes(job.status) ? Date.now() + 60000 : null;
  core.record = id => {
    const job = jobs.get(id);
    if (!job) throw Error('GODOT_JOB_NOT_FOUND');
    return {jobId:job.jobId, worldId:job.worldId, buildId:job.buildId, baseId, kind:job.kind, status:job.status,
      stage:job.stage, output:job.output, outputHash:job.outputHash, candidateId:job.candidateId, leaseExpiresAt:lease(job)};
  };
  function commit({jobId, token, output}) {
    const job = jobs.get(jobId);
    if (!job) throw Error('GODOT_JOB_NOT_FOUND');
    if (job.token !== token) throw Error('GODOT_JOB_OWNER_MISMATCH');
    if (['cancelled', 'interrupted'].includes(job.status)) throw Error('GODOT_JOB_INACTIVE');
    const body = JSON.stringify(output);
    if (['passed', 'failed'].includes(job.status)) {
      if (job.outputHash !== sha256(body)) throw Error('REPLAY_MISMATCH');
      return {jobId, status:job.status, candidateId:job.candidateId};
    }
    if (!['claimed', 'running'].includes(job.status)) throw Error('GODOT_JOB_INACTIVE');
    if (output.inputHash !== job.inputHash) throw Error('GODOT_JOB_INPUT_MISMATCH');
    if (output.engine?.version !== '4.7.2-stable') throw Error('GODOT_EXECUTOR_MISMATCH');
    if (job.evidenceHash && output.engine?.evidenceHash !== job.evidenceHash) throw Error('GODOT_EXECUTOR_MISMATCH');
    if (job.kind === 'check' && !(output.check?.assertions ?? []).length) throw Error('GODOT_CHECK_ASSERTIONS_REQUIRED');
    job.evidenceHash = output.engine.evidenceHash;
    job.status = output.passed ? 'passed' : 'failed';
    job.stage = job.status;
    job.output = output;
    job.outputHash = sha256(body);
    job.candidateId = output.passed ? 'gcan-' + 'b'.repeat(64) : null;
    return {jobId, status:job.status, candidateId:job.candidateId};
  }
  core.call = async (method, params = {}) => {
    core.calls.push({method, params});
    switch (method) {
      case 'godotExecutor.register': return {executorId:params.executorId, registered:true, executionAvailable:true,
        attestationHash:sha256(JSON.stringify(params.attestation)), promotedJobs:0};
      case 'godotExecutor.revoke': return {executorId:params.executorId, revoked:true, interrupted:0};
      case 'godotBuild.read': {
        if (core.hooks.read) { const forced = await core.hooks.read(params); if (forced !== undefined) return forced; }
        return core.record(params.jobId);
      }
      case 'godotJob.claim': {
        const job = jobs.get(params.jobId);
        if (!job) throw Error('GODOT_JOB_NOT_FOUND');
        if (job.status !== 'queued') throw Error(job.status === 'blocked' ? 'GODOT_EXECUTION_UNAVAILABLE' : 'GODOT_JOB_INACTIVE');
        job.token = params.token; job.status = 'claimed'; job.stage = 'claimed';
        return {...core.record(params.jobId), baseId, sourceRevision:3, manifestHash:sha256('manifest'),
          assetManifestHash:sha256('assets'), inputHash:job.inputHash, projectRoot, artifactsRoot,
          cacheRoot:path.join(artifactsRoot, '..', 'cache'), files:{source:files, asset:[]}};
      }
      case 'godotJob.progress': {
        const job = jobs.get(params.jobId);
        if (!job || !['claimed', 'running'].includes(job.status)) throw Error('GODOT_JOB_INACTIVE');
        job.status = 'running'; job.stage = params.stage; core.stages.push(params.stage);
        return {jobId:params.jobId, status:'running', stage:params.stage, progress:params.percent};
      }
      case 'godotJob.heartbeat': return {jobId:params.jobId, status:'running'};
      case 'godotJob.finish': {
        if (core.hooks.finish) {
          const forced = await core.hooks.finish(params, jobs.get(params.jobId), commit);
          if (forced !== undefined) return forced;
        }
        return commit(params);
      }
      case 'godotBuild.cancel': {
        const job = jobs.get(params.jobId);
        if (job) { job.status = 'cancelled'; job.stage = 'cancelled'; }
        return {jobId:params.jobId, status:'cancelled'};
      }
      case 'world.read': return {id:worldId, world:{build:{id:'base-a', scene:{format:'craftmine.godot-scene/1', baseId}, godot:{}},
        snapshot:{format:'craftmine.godot-progress/1', worldId, baseId, baseVersion:'1.0.0', stateVersion:1, body:{coins:7}}, extensions:[]}};
      case 'godotJob.checkDescriptor': throw Error('UNSUPPORTED');
      case 'godotJob.pending': if(allowPending)return {items:[...jobs.keys()].map(core.record).filter(job=>job.status==='queued')};throw Error('UNSUPPORTED');
      default: throw Error('UNSUPPORTED_METHOD:' + method);
    }
  };
  return core;
}

function scriptedEnvironment(t, scenario = {}) {
  const env = environment();
  t.after(restoreEnv);
  setScenario(env, scenario);
  const core = scriptedCore({projectRoot:env.projectRoot, artifactsRoot:env.artifactsRoot, files:env.files});
  return {env, core, executor:makeExecutor({env, core})};
}

const stagedFiles = env => Object.keys(SAME_SOURCE_ARTIFACTS).map(name => path.join(env.artifactsRoot, 'web', name));

const applicationContext={projectId:'creation-project',sessionId:'creation-session',turnId:'creation-turn'};
function creationApplicationFixture(t,{allowPending=false,complete}={}){
  const {PROTECTED_CREATION_FILES}=require('../../../plugins/craftmine-world/godot-creation-pack.cjs');
  const projectFiles=Object.fromEntries(PROTECTED_CREATION_FILES.map(name=>[name,'extends RefCounted\n# protocol fixture '+name+'\n']));
  projectFiles['project.godot']='config_version=5\n[autoload]\nCraftmineRuntime="*res://craftmine_shared/runtime_bridge.gd"\n[craftmine]\nruntime/adapter="res://craftmine_shared/base_adapter.gd"\n';
  const env=environment({projectFiles});t.after(restoreEnv);
  const pack=creationPackFixture([...Object.entries(projectFiles).filter(([name])=>name.endsWith('.gd')).map(([path,data])=>({path,data})),{path:'project.binary',data:creationProjectBinary()}]);
  setScenario(env,{binaryArtifacts:{'index.pck':pack.toString('base64')}});
  const core=scriptedCore({...env,baseId:'creation-sandbox',allowPending});
  const jobId='gjob-'+'7'.repeat(64),binding={jobId,worldId:core.worldId,context:applicationContext};core.addJob(jobId);
  const calls=[];
  const verifier={godotCheck:async descriptor=>{assert.equal(descriptor.baseId,'creation-sandbox');return passingEvidence();},creationCheckCompleted:async input=>{
    calls.push(structuredClone(input));return complete?complete(input):{status:'applied',worldId:core.worldId,candidateId:core.record(jobId).candidateId};
  }};
  const executor=makeExecutor({env,core,verifier});
  t.after(async()=>{await executor.stop();});
  return {env,core,executor,jobId,binding,calls,verifier,protectedFiles:PROTECTED_CREATION_FILES,ledgerPath:path.join(env.dataPath,'godot','executor-ledger.json')};
}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
async function within(promise,ms=15000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('protocol barrier not reached')),ms);})]);}finally{clearTimeout(timer);}}
function pauseApplicationPersistence(t,fixture){
  const fsp=require('node:fs/promises'),rename=fsp.rename,reached=deferred(),release=deferred();let once=false;
  fsp.rename=async(source,target)=>{
    if(!once&&path.resolve(target)===path.resolve(fixture.ledgerPath)){
      const pending=JSON.parse(fs.readFileSync(source,'utf8'));
      if(pending.jobs[fixture.jobId]?.creationApplication?.status==='applying'){once=true;reached.resolve();await release.promise;}
    }
    return rename(source,target);
  };
  t.after(()=>{release.resolve();fsp.rename=rename;});
  return {reached:reached.promise,release:()=>release.resolve(),restore:()=>{fsp.rename=rename;}};
}

test('creation completion publishes pending before finish and preserves applied proof after restart',async t=>{
  const entered=deferred(),release=deferred();t.after(()=>release.resolve());
  const f=creationApplicationFixture(t,{complete:async()=>{entered.resolve();await release.promise;return {status:'applied',worldId:f.core.worldId,candidateId:f.core.record(f.jobId).candidateId};}});
  f.core.hooks.finish=()=>{const persisted=JSON.parse(fs.readFileSync(f.ledgerPath,'utf8'));assert.equal(persisted.jobs[f.jobId].creationApplication.status,'pending');};
  assert.equal((await f.executor.start()).available,true);f.executor.enqueue({jobId:f.jobId,worldId:f.core.worldId,mode:'check'},applicationContext);
  await within(entered.promise);
  assert.equal(f.core.record(f.jobId).status,'passed');assert.equal(f.executor.creationCompletion(f.binding).status,'applying');
  assert.equal(JSON.parse(fs.readFileSync(f.ledgerPath,'utf8')).jobs[f.jobId].creationApplication.status,'applying');
  release.resolve();await settle(f.executor,f.jobId);await f.executor.stop();
  assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0],{jobId:f.jobId,context:applicationContext});
  const completed=f.executor.creationCompletion(f.binding);assert.equal(completed.status,'applied');assert.equal(completed.candidateId,f.core.record(f.jobId).candidateId);
  assert.deepEqual(f.executor.ledger.jobs[f.jobId].creationPackProof.files.map(file=>file.path).sort(),[...f.protectedFiles].sort(),'the creation pack verifier measured every supplied protected file');
  const restarted=makeExecutor({env:f.env,core:f.core,verifier:f.verifier});t.after(async()=>{await restarted.stop();});
  await restarted.start();assert.deepEqual(restarted.creationCompletion(f.binding),completed);assert.equal(f.calls.length,1,'restored diagnostics cannot invoke adoption');await restarted.stop();
});

test('creation reconcile without a live context completes its check without adoption authority',async t=>{
  const f=creationApplicationFixture(t,{allowPending:true});f.core.jobs.delete(f.jobId);assert.equal((await f.executor.start()).available,true);f.core.addJob(f.jobId);
  const recovered=await f.executor.reconcile();assert.equal(recovered.enqueued,1);await settle(f.executor,f.jobId);
  assert.equal(f.core.record(f.jobId).status,'passed');assert.ok(f.core.record(f.jobId).candidateId);assert.equal(f.calls.length,0);
  assert.equal(f.core.attempts(f.jobId,'godotJob.finish').length,1);assert.equal(f.executor.creationCompletion(f.binding),null);
  assert.deepEqual(f.executor.ledger.jobs[f.jobId].creationPackProof.files.map(file=>file.path).sort(),[...f.protectedFiles].sort());
});

for(const action of ['cancel','stop'])test('creation '+action+' during applying persistence prevents the host callback',async t=>{
  const f=creationApplicationFixture(t),gate=pauseApplicationPersistence(t,f);let stopping;
  try{
    assert.equal((await f.executor.start()).available,true);f.executor.enqueue({jobId:f.jobId,worldId:f.core.worldId,mode:'check'},applicationContext);
    await within(gate.reached);assert.equal(f.core.record(f.jobId).status,'passed');
    if(action==='cancel')await f.executor.cancel(f.jobId);else stopping=f.executor.stop();
    gate.release();await settle(f.executor,f.jobId);await stopping;
    assert.equal(f.calls.length,0);assert.equal(f.core.record(f.jobId).status,'passed');assert.ok(f.core.record(f.jobId).candidateId);
    // stop deliberately cancels every live job before draining its worker.
    assert.equal(f.executor.creationCompletion(f.binding).status,'cancelled');
    assert.equal(JSON.parse(fs.readFileSync(f.ledgerPath,'utf8')).jobs[f.jobId].creationApplication.status,'cancelled');
  }finally{gate.release();gate.restore();}
});

test('creation lost finish reply keeps the confirmed candidate and manual reason without replaying adoption',async t=>{
  const f=creationApplicationFixture(t);f.core.hooks.finish=(params,_job,commit)=>{commit(params);throw Error('authored reply lost after commit');};
  assert.equal((await f.executor.start()).available,true);f.executor.enqueue({jobId:f.jobId,worldId:f.core.worldId,mode:'check'},applicationContext);await settle(f.executor,f.jobId);
  assert.equal(f.core.record(f.jobId).status,'passed');assert.equal(f.core.attempts(f.jobId,'godotJob.finish').length,1);assert.equal(f.calls.length,0);
  const completion=f.executor.creationCompletion(f.binding);assert.equal(completion.status,'manual');assert.equal(completion.candidateId,f.core.record(f.jobId).candidateId);
  assert.match(completion.reason,/CREATION_APPLICATION_FINISH_REPLY_UNCONFIRMED: authored reply lost after commit/);assert.doesNotMatch(completion.reason,/RESTARTED/);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.ledgerPath,'utf8')).jobs[f.jobId].creationApplication.context,applicationContext);
});

test('creation applied response with failed ledger writes remains unconfirmed until recovery',async t=>{
  const f=creationApplicationFixture(t),fsp=require('node:fs/promises'),rename=fsp.rename;let failures=0;
  fsp.rename=async(source,target)=>{
    if(path.resolve(target)===path.resolve(f.ledgerPath)){
      const state=JSON.parse(fs.readFileSync(source,'utf8'));
      if(state.jobs[f.jobId]?.creationApplication?.status==='applied'){failures++;throw Error('authored disk-full after host applied');}
    }
    return rename(source,target);
  };
  t.after(()=>{fsp.rename=rename;});
  try{
    await f.executor.start();f.executor.enqueue({jobId:f.jobId,worldId:f.core.worldId,mode:'check'},applicationContext);await settle(f.executor,f.jobId);
    assert.ok(failures>=1);assert.equal(f.calls.length,1);assert.equal(f.core.record(f.jobId).status,'passed');
    const receipt=f.executor.creationCompletion(f.binding);assert.equal(receipt.status,'interrupted');assert.equal(receipt.reason,'CREATION_APPLICATION_LEDGER_UNCONFIRMED');
    assert.equal(JSON.parse(fs.readFileSync(f.ledgerPath,'utf8')).jobs[f.jobId].creationApplication.status,'applying','failed writes do not pretend to persist the final response');
  }finally{fsp.rename=rename;}
  // A fresh supervisor sees an interrupted receipt and cannot replay the host transaction.
  const restarted=makeExecutor({env:f.env,core:f.core,verifier:f.verifier});t.after(async()=>{await restarted.stop();});
  await restarted.start();assert.equal(restarted.creationCompletion(f.binding).status,'interrupted');assert.equal(f.calls.length,1);await restarted.stop();
});

test('creation manual authorization result leaves a passed candidate without claiming adoption',async t=>{
  const f=creationApplicationFixture(t,{complete:()=>({status:'manual',reason:'CREATION_AUTO_APPLY_NOT_AUTHORIZED'})});
  await f.executor.start();f.executor.enqueue({jobId:f.jobId,worldId:f.core.worldId,mode:'check'},applicationContext);await settle(f.executor,f.jobId);
  assert.equal(f.core.record(f.jobId).status,'passed');assert.equal(f.calls.length,1);const receipt=f.executor.creationCompletion(f.binding);
  assert.equal(receipt.status,'manual');assert.equal(receipt.reason,'CREATION_AUTO_APPLY_NOT_AUTHORIZED');assert.equal(receipt.candidateId,f.core.record(f.jobId).candidateId);
});

test('a refused finish results in a core-confirmed failure that keeps the original identity', async t => {
  const {env, core, executor} = scriptedEnvironment(t);
  const jobId = 'gjob-' + '1'.repeat(64);
  core.addJob(jobId);
  // The core refuses the real result exactly like the recorded GODOT_ARTIFACT_CONFLICT.
  core.hooks.finish = params => { if (params.output.passed) throw Error('GODOT_ARTIFACT_CONFLICT'); };
  assert.equal((await executor.start()).available, true);
  assert.equal(executor.enqueue({jobId, worldId:'world-c', mode:'check'}).enqueued, true);
  await settle(executor, jobId);
  const ledger = executor.ledger.jobs[jobId];
  const attempts = core.attempts(jobId, 'godotJob.finish');
  await executor.stop();

  assert.equal(attempts.length, 2, 'one real result, then exactly one failure settlement');
  const [refused, settled] = attempts;
  assert.equal(refused.params.output.passed, true);
  assert.equal(settled.params.jobId, jobId, 'the settlement names the same job');
  assert.equal(settled.params.token, refused.params.token, 'the original claim token is retained');
  assert.equal(settled.params.output.inputHash, refused.params.output.inputHash, 'the original input hash is retained');
  assert.equal(settled.params.output.engine.evidenceHash, refused.params.output.engine.evidenceHash);
  assert.equal(settled.params.output.passed, false);
  assert.deepEqual(settled.params.output.artifacts, [], 'a refused result claims no artifacts');
  assert.equal(core.stages.filter(stage => stage === 'export').length, 1, 'the engine is never run twice');
  // The core is terminal and the model can read why.
  const job = core.jobs.get(jobId);
  assert.equal(job.status, 'failed');
  assert.match(job.output.compile.errors.join(' '), /GODOT_ARTIFACT_CONFLICT/);
  assert.equal(job.output.check.assertions.length, 1);
  assert.equal(job.output.check.assertions[0].id, 'executor.finish-refused');
  assert.match(job.output.check.assertions[0].detail, /GODOT_ARTIFACT_CONFLICT/);
  assert.equal(core.record(jobId).leaseExpiresAt, null, 'a terminal job holds no lease');
  assert.equal(core.attempts(jobId, 'godotBuild.read').some(call => call.params.worldId === 'world-c'), true,
    'the refused finish is resolved against the core record first');
  // The ledger reports the core's own terminal state, not a hopeful one.
  assert.equal(ledger.state, 'failed');
  assert.equal(ledger.outcome, 'failed');
  assert.match(ledger.reason, /GODOT_ARTIFACT_CONFLICT/);
  assert.match(ledger.failureSettlement.originalReason, /GODOT_ARTIFACT_CONFLICT/);
  const persisted = JSON.parse(fs.readFileSync(path.join(env.dataPath, 'godot', 'executor-ledger.json'), 'utf8'));
  assert.match(persisted.jobs[jobId].failureSettlement.originalReason, /GODOT_ARTIFACT_CONFLICT/,
    'the refusal stays as durable evidence');
  // Already staged bytes belong to the refused job and are never deleted.
  for (const name of Object.keys(SAME_SOURCE_ARTIFACTS)) {
    const body = name === 'bridge.js' ? '// host pinned bridge\n' : SAME_SOURCE_ARTIFACTS[name];
    assert.equal(fs.readFileSync(path.join(env.artifactsRoot, 'web', name), 'utf8'), body);
  }
});

test('a lost terminal reply is read back from the core, never re-submitted or faked', async t => {
  const {env, core, executor} = scriptedEnvironment(t);
  const jobId = 'gjob-' + '2'.repeat(64);
  core.addJob(jobId);
  core.hooks.finish = (params, job, commit) => { commit(params); throw Error('authored reply lost after the core commit'); };
  assert.equal((await executor.start()).available, true);
  executor.enqueue({jobId, worldId:'world-c', mode:'check'});
  await settle(executor, jobId);
  const ledger = executor.ledger.jobs[jobId];
  await executor.stop();

  assert.equal(core.attempts(jobId, 'godotJob.finish').length, 1, 'a lost reply must not be re-submitted');
  assert.equal(core.jobs.get(jobId).status, 'passed');
  assert.equal(ledger.state, 'finished', 'the committed pass is the ledger state');
  assert.equal(ledger.outcome, 'passed');
  // The lost transport is still recorded as the reason, but nothing claims the
  // pass failed: no settlement status and no settlement error exist.
  assert.match(ledger.reason, /authored reply lost after the core commit/);
  assert.match(ledger.failureSettlement.originalReason, /authored reply lost after the core commit/);
  assert.equal(ledger.failureSettlement.status, undefined, 'a committed pass is never settled as a failure');
  assert.equal(ledger.failureSettlement.settlementError, undefined);
  assert.equal(ledger.failureSettlement.terminalStatus, undefined);
  const tasks = fs.readdirSync(path.join(env.dataPath, 'godot', 'tasks'));
  assert.equal(tasks.filter(name => name.startsWith('im-')).length, 1, 'the import ran once');
  assert.equal(tasks.filter(name => name.startsWith('ex-')).length, 1, 'the export ran once');
  assert.deepEqual(stagedFiles(env).map(name => fs.existsSync(name)), [true, true, true]);
});

test('a conflicting artifact is refused without overwriting or deleting the old evidence', async t => {
  const {env, core, executor} = scriptedEnvironment(t, {artifacts:SAME_SOURCE_ARTIFACTS});
  const web = path.join(env.artifactsRoot, 'web');
  fs.mkdirSync(web, {recursive:true});
  const previous = '// previous job evidence\n';
  fs.writeFileSync(path.join(web, 'index.js'), previous);
  const before = evidenceFingerprint(path.join(web, 'index.js'));
  const jobId = 'gjob-' + '3'.repeat(64);
  core.addJob(jobId);
  assert.equal((await executor.start()).available, true);
  executor.enqueue({jobId, worldId:'world-c', mode:'check'});
  await settle(executor, jobId);
  const ledger = executor.ledger.jobs[jobId];
  await executor.stop();

  const attempts = core.attempts(jobId, 'godotJob.finish');
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].params.output.passed, false);
  assert.match(attempts[0].params.output.compile.errors.join(' '), /GODOT_ARTIFACT_CONFLICT/);
  assert.equal(core.jobs.get(jobId).status, 'failed', 'a conflict is never a success');
  assert.equal(ledger.state, 'failed');
  assert.match(ledger.reason, /GODOT_ARTIFACT_CONFLICT/);
  // Every conflict is checked before the first write, so no new file exists.
  assert.deepEqual(listFiles(env.artifactsRoot).map(item => item.path), ['web/index.js']);
  assert.equal(fs.readFileSync(path.join(web, 'index.js'), 'utf8'), previous);
  assertEvidenceUnchanged([before], [path.join(web, 'index.js')], 'a conflict may not touch the old file');
});

test('a same-source recheck reuses verified bytes and can never replace them', async t => {
  const {env, core, executor} = scriptedEnvironment(t, {artifacts:SAME_SOURCE_ARTIFACTS});
  const jobs = ['4', '5', '6'].map(digit => 'gjob-' + digit.repeat(64));
  for (const jobId of jobs) core.addJob(jobId);
  assert.equal((await executor.start()).available, true);

  executor.enqueue({jobId:jobs[0], worldId:'world-c', mode:'check'});
  await settle(executor, jobs[0]);
  assert.equal(core.jobs.get(jobs[0]).status, 'passed');
  const files = stagedFiles(env);
  const before = files.map(evidenceFingerprint);
  assert.deepEqual(listFiles(env.artifactsRoot).map(item => item.path), ['web/bridge.js', 'web/index.html', 'web/index.js']);

  // The identical source produces the identical bytes: reuse, never rewrite.
  executor.enqueue({jobId:jobs[1], worldId:'world-c', mode:'check'});
  await settle(executor, jobs[1]);
  assert.equal(core.jobs.get(jobs[1]).status, 'passed', 'an identical recheck is a real pass');
  assert.equal(executor.ledger.jobs[jobs[1]].state, 'finished');
  assertEvidenceUnchanged(before, files, 'identical bytes are reused');

  // A different export for the same build and path is a conflict, not a rewrite.
  setScenario(env, {artifacts:{...SAME_SOURCE_ARTIFACTS, 'index.html':'<!doctype html>a different build produced this'}});
  executor.enqueue({jobId:jobs[2], worldId:'world-c', mode:'check'});
  await settle(executor, jobs[2]);
  await executor.stop();
  assert.equal(core.jobs.get(jobs[2]).status, 'failed');
  assert.match(core.jobs.get(jobs[2]).output.compile.errors.join(' '), /GODOT_ARTIFACT_CONFLICT/);
  assert.equal(fs.readFileSync(path.join(env.artifactsRoot, 'web', 'index.html'), 'utf8'), SAME_SOURCE_ARTIFACTS['index.html'],
    'the first verified artifact still stands');
  assertEvidenceUnchanged(before, files, 'a refusal may not replace the old evidence');
  assert.deepEqual(listFiles(env.artifactsRoot).map(item => item.path), ['web/bridge.js', 'web/index.html', 'web/index.js'],
    'a refusal may not clear or add files');
});

test('a cancelled job reports the core cancel and submits no result', async t => {
  const {env, core, executor} = scriptedEnvironment(t, {delayMs:400, artifacts:SAME_SOURCE_ARTIFACTS});
  const jobId = 'gjob-' + '7'.repeat(64);
  core.addJob(jobId);
  assert.equal((await executor.start()).available, true);
  executor.enqueue({jobId, worldId:'world-c', mode:'check'});
  await new Promise(resolve => setTimeout(resolve, 120));
  await executor.cancel(jobId, 'user stop');
  await settle(executor, jobId);
  await executor.stop();

  assert.equal(core.attempts(jobId, 'godotJob.finish').length, 0, 'a cancelled job has no result to report');
  assert.equal(core.attempts(jobId, 'godotBuild.cancel').length, 1);
  assert.equal(core.jobs.get(jobId).status, 'cancelled');
  const ledger = executor.ledger.jobs[jobId];
  assert.equal(ledger.state, 'cancelled');
  assert.equal(ledger.outcome, 'cancelled');
  assert.equal(fs.existsSync(path.join(env.artifactsRoot, 'web', 'index.html')), false, 'nothing is staged for a cancelled job');
});

test('an interrupted job records the core state instead of a failure it cannot prove', async t => {
  const {env, core, executor} = scriptedEnvironment(t, {artifacts:SAME_SOURCE_ARTIFACTS});
  const jobId = 'gjob-' + '8'.repeat(64);
  core.addJob(jobId);
  let refused = false;
  core.hooks.finish = () => { refused = true; throw Error('GODOT_JOB_INACTIVE'); };
  // The lease expired: the core answers the read with its own terminal state.
  core.hooks.read = params => refused ? {...core.record(params.jobId), status:'interrupted', leaseExpiresAt:null} : undefined;
  assert.equal((await executor.start()).available, true);
  executor.enqueue({jobId, worldId:'world-c', mode:'check'});
  await settle(executor, jobId);
  const ledger = executor.ledger.jobs[jobId];
  await executor.stop();

  assert.equal(core.attempts(jobId, 'godotJob.finish').length, 1, 'a late result is never re-submitted to an interrupted job');
  assert.equal(ledger.state, 'interrupted', 'the core terminal state is recorded as itself');
  assert.equal(ledger.outcome, 'interrupted');
  assert.match(ledger.reason, /GODOT_JOB_INACTIVE/);
  assert.notEqual(ledger.state, 'finished');
  assert.deepEqual(stagedFiles(env).map(name => fs.existsSync(name)), [true, true, true], 'staged diagnostics are not deleted');
});

test('a wrong token leaves the job unconfirmed and never confirmed', async t => {
  const {env, core, executor} = scriptedEnvironment(t);
  const jobId = 'gjob-' + '9'.repeat(64);
  core.addJob(jobId);
  core.hooks.finish = () => { throw Error('GODOT_JOB_OWNER_MISMATCH'); };
  assert.equal((await executor.start()).available, true);
  executor.enqueue({jobId, worldId:'world-c', mode:'check'});
  await settle(executor, jobId);
  const ledger = executor.ledger.jobs[jobId];
  await executor.stop();

  assert.equal(core.attempts(jobId, 'godotJob.finish').length, 2, 'the settlement really was attempted');
  assert.equal(ledger.state, 'unconfirmed');
  assert.equal(ledger.outcome, 'refused');
  assert.match(ledger.reason, /GODOT_JOB_OWNER_MISMATCH/);
  assert.match(ledger.failureSettlement.error, /GODOT_JOB_OWNER_MISMATCH/);
  assert.equal(core.jobs.get(jobId).status, 'running', 'an unowned job is left to the core, never marked done');
});

test('a cross-world record is refused instead of settling a foreign job', async t => {
  const {env, core, executor} = scriptedEnvironment(t);
  const jobId = 'gjob-' + 'c'.repeat(63) + 'd';
  core.addJob(jobId);
  let refused = false;
  core.hooks.finish = () => { refused = true; throw Error('authored refusal'); };
  core.hooks.read = params => refused
    ? {jobId:params.jobId, worldId:'other-world', buildId:'gbd-' + 'a'.repeat(64), status:'running'}
    : undefined;
  assert.equal((await executor.start()).available, true);
  executor.enqueue({jobId, worldId:'world-c', mode:'check'});
  await settle(executor, jobId);
  const ledger = executor.ledger.jobs[jobId];
  await executor.stop();

  assert.equal(core.attempts(jobId, 'godotJob.finish').length, 1, 'a foreign job is never settled');
  assert.equal(ledger.state, 'unconfirmed');
  assert.match(ledger.failureSettlement.error, /GODOT_FINISH_RECOVERY_IDENTITY/);
  assert.notEqual(ledger.state, 'failed');
});

test('a stop during a running job reports no completion and deletes no evidence', async t => {
  const {env, core, executor} = scriptedEnvironment(t, {artifacts:SAME_SOURCE_ARTIFACTS});
  const done = 'gjob-' + 'd'.repeat(64), running = 'gjob-' + 'e'.repeat(64);
  core.addJob(done); core.addJob(running);
  assert.equal((await executor.start()).available, true);
  executor.enqueue({jobId:done, worldId:'world-c', mode:'check'});
  await settle(executor, done);
  const tasksRoot = path.join(env.dataPath, 'godot', 'tasks');
  const tasksBefore = listFiles(tasksRoot);
  const files = stagedFiles(env);
  const before = files.map(evidenceFingerprint);

  setScenario(env, {delayMs:1000, artifacts:SAME_SOURCE_ARTIFACTS});
  executor.enqueue({jobId:running, worldId:'world-c', mode:'check'});
  await new Promise(resolve => setTimeout(resolve, 150));
  await executor.stop();

  assert.equal(core.attempts(running, 'godotJob.finish').length, 0, 'a stopped job reports no result');
  assert.equal(executor.ledger.jobs[running].state, 'cancelled');
  assert.notEqual(executor.ledger.jobs[running].state, 'finished');
  // The stopped job may still add a task directory of its own (the fixture
  // broker writes it when it answers), so the guarantee is that nothing
  // recorded before the stop disappears or changes.
  const after = new Map(listFiles(tasksRoot).map(item => [item.path, item]));
  assert.equal(after.size >= tasksBefore.length, true, 'stop must not drop a recorded task');
  for (const item of tasksBefore) {
    assert.equal(after.get(item.path)?.sha256, item.sha256, item.path + ' was deleted or rewritten');
  }
  assertEvidenceUnchanged(before, files, 'a later stopped job may not touch earlier evidence');
});

test('a refused settlement resolved by a second read keeps the original reason and both errors', async t => {
  const env = environment();
  t.after(restoreEnv);
  setScenario(env, {});
  const jobId = 'gjob-' + 'f'.repeat(64);
  const core = scriptedCore({projectRoot:env.projectRoot, artifactsRoot:env.artifactsRoot, files:env.files});
  core.addJob(jobId);
  const diagnostics = [];
  const executor = makeExecutor({env, core, logger:{log(){}, error(){}, warn:(...args) => diagnostics.push(args.map(String).join(' '))}});
  // The recorded path, step by step: the real result is refused, the job still
  // answers as active, the failure settlement is refused as well, and only the
  // second read resolves the core's real terminal state.
  let finishes = 0;
  core.hooks.finish = () => {
    finishes += 1;
    throw Error(finishes === 1 ? 'GODOT_ARTIFACT_CONFLICT' : 'GODOT_SETTLEMENT_REFUSED');
  };
  core.hooks.read = params => finishes >= 2
    ? {...core.record(params.jobId), status:'failed', stage:'failed', leaseExpiresAt:null}
    : undefined;
  assert.equal((await executor.start()).available, true);
  executor.enqueue({jobId, worldId:'world-c', mode:'check'});
  await settle(executor, jobId);
  const ledger = executor.ledger.jobs[jobId];
  await executor.stop();
  const persisted = JSON.parse(fs.readFileSync(path.join(env.dataPath, 'godot', 'executor-ledger.json'), 'utf8')).jobs[jobId];

  const attempts = core.attempts(jobId, 'godotJob.finish');
  assert.equal(attempts.length, 2, 'exactly one real result and one settlement attempt');
  assert.equal(attempts[0].params.token, attempts[1].params.token, 'the settlement keeps the original claim identity');
  assert.equal(attempts[1].params.jobId, jobId);
  assert.deepEqual(attempts[1].params.output.artifacts, []);
  assert.equal(attempts[1].params.output.check.assertions[0].id, 'executor.finish-refused',
    'the settlement was reached because the first read still reported an active job');
  assert.match(attempts[1].params.output.check.assertions[0].detail, /GODOT_ARTIFACT_CONFLICT/,
    'the submitted failure carries the original refusal');
  assert.equal(core.attempts(jobId, 'godotBuild.read').length >= 2, true, 'the job record is read twice');
  assert.equal(core.stages.filter(stage => stage === 'export').length, 1, 'the engine is never run again');
  // The resolved state is trusted, and it still explains itself.
  for (const view of [ledger, persisted]) {
    assert.equal(view.state, 'failed', 'the second read resolves the real terminal state');
    assert.equal(view.outcome, 'failed');
    assert.equal(view.reason, 'GODOT_ARTIFACT_CONFLICT', 'the original refusal is the durable reason');
    assert.equal(view.failureSettlement.originalReason, 'GODOT_ARTIFACT_CONFLICT');
    assert.equal(view.failureSettlement.error, 'GODOT_SETTLEMENT_REFUSED', 'the recovery error is kept');
    assert.equal(view.failureSettlement.settlementError, 'GODOT_SETTLEMENT_REFUSED', 'the refused settlement step is named');
    assert.equal(view.failureSettlement.status, undefined, 'a refused settlement is not recorded as accepted');
    assert.equal(view.failureSettlement.terminalStatus, 'failed');
  }
  assert.equal(diagnostics.some(line => line.includes('finish refused') && line.includes('GODOT_ARTIFACT_CONFLICT')), true,
    'the refusal is reported before any read-back can fail');
});
