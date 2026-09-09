// Failure, cancellation, process interruption and recovery under real Electron:
// real Rust core -> managed executor -> pinned broker -> pinned Godot -> isolated
// check. Run through `failures.mjs`.
//
// Every scenario asserts the recorded core state, never a hoped-for outcome. A
// failure must be recorded as a failure, a cancelled job must never produce a
// candidate, an interrupted broker must not be reported as a pass, and the next
// job on the same executor must still work.
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { CoreClient } from '../../../plugins/craftmine-world/core-client.cjs';
import { createGodotExecutor } from '../../../plugins/craftmine-world/godot-executor.cjs';
import { GodotBuildVerifier } from '../../../vendor/pi-desktop/apps/desktop/electron/main/godot-build-verifier';

const out = process.env.CRAFTMINE_C_E2E_OUT;
const root = process.env.CRAFTMINE_C_E2E_ROOT ?? process.cwd();
const dataDir = path.join(out, 'core-data');
const context = { projectId:'c-failures', sessionId:'c-failures', turnId:'one' };
const report = { kind:'real-core-broker-godot-failure-cancel-recovery', out, checks:[], evidence:{}, limits:[
  'Test-authored projects and host preset/shell; the real model path is task I',
  'A hard broker kill cannot guarantee AppContainer profile cleanup; the protocol requires a host recovery journal',
] };

function check(name, ok, detail) {
  report.checks.push({ name, passed:!!ok, ...(detail === undefined ? {} : { detail }) });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)));
  if (!ok) throw new Error('CHECK FAILED: ' + name);
}

const fixture = name => fs.readFileSync(path.join(root, 'tests/godot-remaining/C/fixtures/e2e-project', name), 'utf8');
const shell = fs.readFileSync(path.join(root, 'desktop/godot/web/shell.html'), 'utf8');
const exportPreset = ['[preset.0]','name="Web"','platform="Web"','runnable=true','export_filter="all_resources"',
  'include_filter=""','exclude_filter=""','[preset.0.options]','custom_template/release=""','variant/thread_support=true',
  'variant/extensions_support=false','html/custom_html_shell="res://shell.txt"','html/focus_canvas_on_start=false',
  'html/canvas_resize_policy=2','progressive_web_app/enabled=false',''].join('\n');

const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
  : JSON.stringify(value ?? null);

async function settle(core, worldId, jobId, timeoutMs = 300000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await core.call('godotBuild.read', { worldId, jobId });
    if (['passed','failed','cancelled','interrupted'].includes(job.status)) return job;
    if (Date.now() > deadline) throw new Error('job did not finish: ' + job.status);
    await new Promise(resolve => setTimeout(resolve, 400));
  }
}

async function main() {
  const core = new CoreClient(process.env.CRAFTMINE_CORE_BIN, dataDir);
  await core.start();
  const verifier = new GodotBuildVerifier({ deadlineMs:180000 });
  const executorLog = [];
  report.evidence.executorLog = executorLog;
  const logger = { log:(...args) => { const line = new Date().toISOString().slice(11, 23) + ' ' + args.map(String).join(' '); executorLog.push(line); console.log('[executor]', line); },
    warn:(...args) => { const line = new Date().toISOString().slice(11, 23) + ' WARN ' + args.map(String).join(' '); executorLog.push(line); console.warn('[executor]', line); },
    error:(...args) => console.error('[executor]', ...args.map(String)) };
  const executor = createGodotExecutor(core, {
    dataPath:dataDir, logger,
    verifier:{ godotCheck:async input => verifier.check(input), cancelGodotCheck:async id => verifier.cancel(String(id)) },
  });
  const started = await executor.start();
  check('executor registered after a real preflight', started.available === true, started.reason ?? started.state);

  /** Create one world, project and blocked job; returns the job identity. */
  async function prepare(id, { mainSource = fixture('main.gd'), extraFiles = {} } = {}) {
    const snapshot = { format:'craftmine.godot-progress/1', worldId:id, baseId:'first-person', baseVersion:'1.0.0',
      stateVersion:1, body:{ coins:7 } };
    await core.call('world.create', { id, title:id, world:{
      build:{ id:'base-a', scene:{ format:'craftmine.godot-scene/1', baseId:'first-person' }, godot:{} },
      snapshot, extensions:[] } });
    // Each scenario gets its own session: a workspace binding follows the
    // project/session, so reusing one session would refuse a second world.
    const worldContext = { ...context, sessionId:id, turnId:'one' };
    await core.call('workspace.open', { context:worldContext, selectedWorld:id });
    const project = await core.call('godotProject.create', { context:worldContext, worldId:id, toolCallId:'source-' + id,
      baseBuild:'base-a', baseId:'first-person', files:[
        { path:'project.godot', text:fixture('project.godot') },
        { path:'main.tscn', text:fixture('main.tscn') },
        { path:'main.gd', text:mainSource },
        { path:'shell.txt', text:shell },
        { path:'export_presets.cfg', text:exportPreset },
        ...Object.entries(extraFiles).map(([name, text]) => ({ path:name, text })),
      ] });
    const job = await core.call('godotBuild.start', { context:worldContext, worldId:id, toolCallId:'check-' + id,
      revision:project.revision, manifestHash:project.manifestHash, mode:'check' });
    return { worldId:id, worldContext, snapshot, project, job };
  }

  // 1. A real GDScript parse error must be a recorded failure, not a pass.
  const broken = await prepare('c-broken', { mainSource:'extends Node2D\n\nfunc _ready( -> void:\n\tpass\n' });
  check('broken project starts runnable', ['blocked','queued'].includes(broken.job.status), broken.job.status);
  const enqueuedBroken = executor.enqueue({ jobId:broken.job.jobId, worldId:broken.worldId, mode:'check' });
  check('the broken job was accepted by the executor', enqueuedBroken.enqueued === true, enqueuedBroken);
  const brokenJob = await settle(core, broken.worldId, broken.job.jobId);
  report.evidence.brokenJob = { status:brokenJob.status, candidateId:brokenJob.candidateId ?? null,
    compile:brokenJob.output?.compile, import:brokenJob.output?.import?.passed, artifacts:(brokenJob.output?.artifacts ?? []).length };
  check('a real parse error fails the job', brokenJob.status === 'failed', brokenJob.status);
  check('the parse error is recorded, not ignored', (brokenJob.output?.compile?.errors ?? []).length > 0, brokenJob.output?.compile?.errors);
  check('a failed check produces no ready candidate', !brokenJob.candidateId || brokenJob.output?.passed === false, brokenJob.candidateId);
  check('a failed job records no artifacts', (brokenJob.output?.artifacts ?? []).length === 0, brokenJob.output?.artifacts);

  // 2. Cancellation: no candidate, no late result, and the executor stays usable.
  const cancelTarget = await prepare('c-cancel');
  check('cancel target starts runnable', ['blocked','queued'].includes(cancelTarget.job.status), cancelTarget.job.status);
  executor.enqueue({ jobId:cancelTarget.job.jobId, worldId:cancelTarget.worldId, mode:'check' });
  await new Promise(resolve => setTimeout(resolve, 1500));
  const cancelled = await executor.cancel(cancelTarget.job.jobId, 'acceptance cancel');
  check('cancel is accepted for a running job', cancelled.cancelled === true, cancelled);
  const cancelledJob = await settle(core, cancelTarget.worldId, cancelTarget.job.jobId);
  report.evidence.cancelledJob = { status:cancelledJob.status, candidateId:cancelledJob.candidateId ?? null, output:!!cancelledJob.output };
  check('a cancelled job is recorded as cancelled', ['cancelled','interrupted'].includes(cancelledJob.status), cancelledJob.status);
  check('a cancelled job records no result', !cancelledJob.output, cancelledJob.status);

  // 3. Recovery: the same executor must still complete a normal job.
  const recover = await prepare('c-recover');
  executor.enqueue({ jobId:recover.job.jobId, worldId:recover.worldId, mode:'check' });
  const recoveredJob = await settle(core, recover.worldId, recover.job.jobId);
  report.evidence.recoveredJob = { status:recoveredJob.status, candidateId:recoveredJob.candidateId ?? null,
    assertions:(recoveredJob.output?.check?.assertions ?? []).length };
  check('the executor completes a normal job after a failure and a cancellation', recoveredJob.status === 'passed', recoveredJob.output?.compile?.errors);
  check('the recovered job produced a ready candidate', typeof recoveredJob.candidateId === 'string', recoveredJob.candidateId);

  // 4. Broker process interruption: a killed broker must never look like a pass.
  // The project holds the engine inside its import so the kill is deterministic.
  const interrupted = await prepare('c-interrupt', { extraFiles:{
    'slow_resource.gd':'@tool\nextends Resource\n\nfunc _init() -> void:\n\tprint("C_SLOW_IMPORT_READY")\n\tOS.delay_msec(25000)\n',
    'slow_resource.tres':'[gd_resource type="Resource" load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://slow_resource.gd" id="1_slow"]\n\n[resource]\nscript = ExtResource("1_slow")\n',
  } });
  const tasksDir = path.join(dataDir, 'godot', 'tasks');
  const knownTasks = new Set(fs.existsSync(tasksDir) ? fs.readdirSync(tasksDir) : []);
  executor.enqueue({ jobId:interrupted.job.jobId, worldId:interrupted.worldId, mode:'check' });
  // Wait until the pinned engine itself reports the marker, then interrupt.
  let markerTask = null;
  const markerDeadline = Date.now() + 120000;
  while (Date.now() < markerDeadline && markerTask === null) {
    for (const entry of fs.readdirSync(tasksDir)) {
      if (knownTasks.has(entry)) continue;
      const taskLog = path.join(tasksDir, entry, 'logs', 'task.log');
      if (fs.existsSync(taskLog) && fs.readFileSync(taskLog, 'utf8').includes('C_SLOW_IMPORT_READY')) { markerTask = entry; break; }
    }
    if (markerTask === null) await new Promise(resolve => setTimeout(resolve, 200));
  }
  check('the pinned engine reached the fixed import marker', markerTask !== null, markerTask);
  const sidecar = path.join(tasksDir, markerTask, 'logs', 'process-verification.json');
  check('the broker recorded the engine child identity before the interruption', fs.existsSync(sidecar), sidecar);
  const killed = await new Promise(resolve => execFile('taskkill', ['/F','/IM','godot-host-broker.exe'], error => resolve(error ? String(error.message) : 'killed')));
  report.evidence.brokerKill = killed;
  const interruptedJob = await settle(core, interrupted.worldId, interrupted.job.jobId);
  report.evidence.interruptedJob = { status:interruptedJob.status, candidateId:interruptedJob.candidateId ?? null,
    import:interruptedJob.output?.import?.passed, errors:interruptedJob.output?.compile?.errors };
  check('an interrupted broker is recorded as a failure', interruptedJob.status === 'failed', interruptedJob.status);
  check('an interrupted broker never records a passing import', interruptedJob.output?.passed === false, interruptedJob.output?.passed);
  const reaps = executor.status().reaps ?? [];
  report.evidence.reaps = reaps;
  check('the recorded engine child identity is checked after the interruption', reaps.some(entry => entry.checked === true), reaps);
  check('a surviving engine child would be terminated', reaps.every(entry => entry.alive !== true || entry.killed === true), reaps);
  // Only the broker's own recorded child is in scope: other engine processes on
  // the machine belong to other sessions and are never touched.
  const recordedChild = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  const survivorList = await new Promise(resolve => execFile('tasklist', ['/FI', `PID eq ${recordedChild.pid}`, '/FO','CSV','/NH'],
    (_error, stdout) => resolve(String(stdout ?? ''))));
  check('the recorded engine process is gone after the interruption', !survivorList.includes(String(recordedChild.pid)),
    { pid:recordedChild.pid, listing:survivorList.slice(0, 200) });

  // 5. Recovery after the interruption, and the formal world stays untouched.
  const after = await prepare('c-after');
  executor.enqueue({ jobId:after.job.jobId, worldId:after.worldId, mode:'check' });
  const afterJob = await settle(core, after.worldId, after.job.jobId);
  check('the executor completes a normal job after a broker interruption', afterJob.status === 'passed', afterJob.output?.compile?.errors);
  for (const world of [broken, cancelTarget, recover, interrupted, after]) {
    const record = await core.call('world.read', { id:world.worldId });
    check('formal progress of ' + world.worldId + ' is unchanged', canonical(record.world?.snapshot) === canonical(world.snapshot),
      canonical(record.world?.snapshot));
  }

  const revokeSupported = await core.call('godotExecutor.revoke', { executorId:'c-failures-probe' }).then(() => true, () => false);
  const stopped = await executor.stop();
  report.evidence.stop = { ...stopped, revokeSupported };
  check('stopping the executor reports its revocation state honestly',
    revokeSupported ? stopped.revoked === true : stopped.revokeReason === 'GODOT_EXECUTOR_REVOKE_UNSUPPORTED',
    { ...stopped, revokeSupported });
  await core.stop();
}

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.on('window-all-closed', () => {});

const fatal = error => {
  try {
    report.passed = false;
    report.failure = String(error?.stack ?? error);
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.error('FAILURES CHAIN FAILURE', report.failure);
  } finally { app.exit(1); }
};
process.on('uncaughtException', fatal);
process.on('unhandledRejection', fatal);

app.whenReady().then(main).then(() => {
  report.passed = true;
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed:true, checks:report.checks.length, out }));
  app.exit(0);
}).catch(fatal);
