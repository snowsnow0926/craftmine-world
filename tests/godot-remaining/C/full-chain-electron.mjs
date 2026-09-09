// Full chain under real Electron: real Rust core -> managed executor -> pinned
// broker -> pinned Godot import/exportWeb -> isolated Electron runtime check ->
// core candidate.
//
// Run through `tests/godot-remaining/C/full-chain.mjs`, which bundles this file
// and the `godot-check` preload, then starts Electron with
// CRAFTMINE_HEADLESS_TEST=1 (offscreen, unfocusable, input blocked).
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CoreClient } from '../../../plugins/craftmine-world/core-client.cjs';
import { createGodotExecutor } from '../../../plugins/craftmine-world/godot-executor.cjs';
import { GodotBuildVerifier } from '../../../vendor/pi-desktop/apps/desktop/electron/main/godot-build-verifier';

const out = process.env.CRAFTMINE_C_E2E_OUT;
const root = process.env.CRAFTMINE_C_E2E_ROOT ?? process.cwd();
const dataDir = path.join(out, 'core-data');
const context = { projectId:'c-e2e', sessionId:'c-e2e', turnId:'one' };
const worldId = 'c-e2e-world';
const report = {
  kind:'real-core-broker-godot-electron-candidate-chain',
  out, checks:[], evidence:{}, limits:[
    'Test-authored Godot project and host preset/shell; the real model path is task I',
    'The Electron harness constructs the same classes as production main but does not fork the plugin utility process',
    'Offscreen software rendering; no player input or feel acceptance',
  ],
};

function check(name, ok, detail) {
  report.checks.push({ name, passed:!!ok, ...(detail === undefined ? {} : { detail }) });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)));
  if (!ok) throw new Error('CHECK FAILED: ' + name);
}

// Never let a main-process failure open a dialog window or hang the run.
const fatal = error => {
  try {
    report.passed = false;
    report.failure = String(error?.stack ?? error);
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.error('CHAIN FAILURE', report.failure);
  } finally { app.exit(1); }
};
process.on('uncaughtException', fatal);
process.on('unhandledRejection', fatal);

const fixture = name => fs.readFileSync(path.join(root, 'tests/godot-remaining/C/fixtures/e2e-project', name), 'utf8');
/** Rust's serde round-trip sorts object keys, so compare canonical JSON. */
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
  : JSON.stringify(value ?? null);
const shell = fs.readFileSync(path.join(root, 'desktop/godot/web/shell.html'), 'utf8');
const exportPreset = [
  '[preset.0]', 'name="Web"', 'platform="Web"', 'runnable=true', 'export_filter="all_resources"',
  'include_filter=""', 'exclude_filter=""', '[preset.0.options]',
  'custom_template/release=""', 'variant/thread_support=true', 'variant/extensions_support=false',
  // Master's core has no host-resource path yet, and `.html` is not an
  // accepted project extension. The pinned host shell is therefore supplied as
  // `shell.txt`; Godot uses its content verbatim as the exported index.html.
  'html/custom_html_shell="res://shell.txt"', 'html/focus_canvas_on_start=false',
  'html/canvas_resize_policy=2', 'progressive_web_app/enabled=false', '',
].join('\n');

async function main() {
  fs.mkdirSync(dataDir, { recursive:true });
  const coreBin = process.env.CRAFTMINE_CORE_BIN;
  check('core binary configured', typeof coreBin === 'string' && fs.existsSync(coreBin), coreBin ?? null);
  const core = new CoreClient(coreBin, dataDir);
  const hello = await core.start();
  check('real Rust core started', hello.godotBuildJobs === true && hello.godotExecutorGate === true, hello);

  const snapshot = { format:'craftmine.godot-progress/1', worldId, baseId:'first-person', baseVersion:'1.0.0', stateVersion:1,
    body:{ coins:7, hp:3, quests:['range_basic'] } };
  await core.call('world.create', { id:worldId, title:'C full chain', world:{
    build:{ id:'base-a', scene:{ format:'craftmine.godot-scene/1', baseId:'first-person' }, godot:{} },
    snapshot, extensions:[] } });
  await core.call('workspace.open', { context, selectedWorld:worldId });
  const project = await core.call('godotProject.create', { context, worldId, toolCallId:'c-source', baseBuild:'base-a', baseId:'first-person',
    files:[
      { path:'project.godot', text:fixture('project.godot') },
      { path:'main.tscn', text:fixture('main.tscn') },
      { path:'main.gd', text:fixture('main.gd') },
      { path:'shell.txt', text:shell },
      { path:'export_presets.cfg', text:exportPreset },
    ] });
  check('source project stored', typeof project.revision === 'number' && /^[0-9a-f]{64}$/.test(project.manifestHash), { revision:project.revision });

  const blocked = await core.call('godotBuild.start', { context, worldId, toolCallId:'c-check',
    revision:project.revision, manifestHash:project.manifestHash, mode:'check' });
  check('build job blocked without a registered executor', blocked.status === 'blocked' && blocked.executionAvailable === false, blocked.blockedReason);

  const verifier = new GodotBuildVerifier({ deadlineMs:180000 });
  let evidence = null;
  const executorLog = [];
  const logger = { log:(...args) => { const line = args.map(String).join(' '); executorLog.push(line); console.log('[executor]', line); },
    warn:(...args) => { const line = args.map(String).join(' '); executorLog.push('WARN ' + line); console.warn('[executor]', line); },
    error:(...args) => console.error('[executor]', ...args.map(String)) };
  report.evidence.executorLog = executorLog;
  const executor = createGodotExecutor(core, {
    dataPath:dataDir, logger,
    verifier:{ godotCheck:async input => { evidence = await verifier.check(input); report.evidence.runtimeCheck = evidence; return evidence; },
      cancelGodotCheck:async id => verifier.cancel(String(id)) },
  });
  const started = await executor.start();
  check('executor registered after real preflight', started.available === true && started.checkAvailable === true, started.reason ?? started.state);
  check('preflight proves process, network and cleanup', started.preflight?.processVerified === true && started.preflight?.networkVerified === true && started.preflight?.cleanupVerified === true, started.preflight);
  const networkChecks = started.preflight?.networkChecks ?? [];
  check('restricted network is denied with real OS errors', networkChecks.length >= 4 && networkChecks.every(entry => entry.ok === false), networkChecks.slice(0, 6));

  const enqueued = executor.enqueue({ jobId:blocked.jobId, worldId, mode:'check' });
  check('job enqueued to the executor', enqueued.enqueued === true, enqueued.reason ?? null);

  const deadline = Date.now() + 300000;
  let job = null;
  for (;;) {
    job = await core.call('godotBuild.read', { worldId, jobId:blocked.jobId });
    if (['passed', 'failed', 'cancelled', 'interrupted'].includes(job.status)) break;
    if (Date.now() > deadline) throw new Error('job did not finish: ' + job.status);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  report.evidence.job = { status:job.status, candidateId:job.candidateId ?? null, stage:job.stage,
    artifacts:(job.output?.artifacts ?? []).map(item => ({ path:item.path, bytes:item.bytes, sha256:item.sha256 })),
    compile:job.output?.compile, assertions:job.output?.check?.assertions ?? [] };
  const stagedSearch = [];
  const collect = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes:true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(full);
      else if (entry.isFile() && entry.name === 'index.wasm') stagedSearch.push({ file:full, bytes:fs.statSync(full).size });
    }
  };
  collect(dataDir);
  report.evidence.stagedWasm = stagedSearch;

  check('real Godot import and export produced a passing job', job.status === 'passed', job.output?.compile?.errors ?? job.status);
  check('export staged the web entry under the core artifacts root',
    (job.output?.artifacts ?? []).some(item => item.path === 'web/index.html'), report.evidence.job.artifacts.map(item => item.path));
  check('host-pinned bridge replaced the authored copy',
    (job.output?.artifacts ?? []).some(item => item.path === 'web/bridge.js'), null);
  check('isolated Electron check ran and passed', evidence?.passed === true && evidence?.scope === 'base-startup', evidence?.error ?? null);
  check('isolated check observed real rendered frames', (evidence?.render?.frames ?? 0) >= 3 &&
    (evidence?.render?.captures ?? []).length >= 3 &&
    (evidence?.render?.captures ?? []).every(capture => capture.width > 0 && capture.height > 0 && capture.coloredSamples === capture.samples),
    evidence?.render);
  check('isolated check proved the input guard and no Node bridge',
    evidence?.isolation?.guard !== null && evidence?.isolation?.guard?.pointerLock === 0 && evidence?.isolation?.guard?.focus === 0, evidence?.isolation);
  check('isolated check matched the formal progress snapshot', evidence?.snapshot?.equal === true, evidence?.snapshot);
  check('isolated check cleaned up', evidence?.recovery?.ok === true, evidence?.recovery);
  check('runtime assertions are recorded separately from gameplay acceptance',
    (job.output?.check?.assertions ?? []).length === 6 && job.output.check.assertions.every(item => item.passed === true),
    job.output?.check?.assertions);

  const candidateId = job.candidateId;
  check('passing check created a candidate', typeof candidateId === 'string' && candidateId.startsWith('gcan-'), candidateId);
  const candidate = await core.call('godotCandidate.read', { worldId, candidateId });
  report.evidence.candidate = candidate;
  check('candidate is ready with real check evidence',
    candidate.candidate?.status === 'ready' && candidate.checkStatus === 'passed' && (candidate.check?.assertions ?? []).length === 6,
    { status:candidate.candidate?.status, checkStatus:candidate.checkStatus, assertions:(candidate.check?.assertions ?? []).length });
  const staged = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes:true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && full.endsWith(path.join('artifacts', 'web', 'index.html'))) staged.push(full);
    }
  };
  walk(dataDir);
  check('staged export exists on disk under the core data directory', staged.length === 1, staged);
  const onDisk = createHash('sha256').update(fs.readFileSync(staged[0])).digest('hex');
  check('staged entry hash equals the recorded artifact hash',
    onDisk === (job.output.artifacts.find(item => item.path === 'web/index.html') ?? {}).sha256, onDisk);

  // The formal world must be untouched by a check.
  const world = await core.call('world.read', { id:worldId });
  check('formal progress was not written by the check', canonical(world.world?.snapshot) === canonical(snapshot),
    { expected:canonical(snapshot), actual:canonical(world.world?.snapshot) });

  await executor.stop();
  const revoked = await core.call('godotBuild.read', { worldId, jobId:blocked.jobId });
  check('stopping the executor keeps the recorded result', revoked.status === 'passed', revoked.status);
  await core.stop();
}

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
// The isolated check window is the only window; destroying it must not end the
// harness before the chain has recorded its evidence.
app.on('window-all-closed', () => {});

app.whenReady().then(main).then(() => {
  report.passed = true;
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed:true, checks:report.checks.length, out }));
  app.exit(0);
}).catch(fatal);
