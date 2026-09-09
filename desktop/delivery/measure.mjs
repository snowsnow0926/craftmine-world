#!/usr/bin/env node
// Craftmine measurement CLI. Read-only evidence producer for the Godot delivery
// performance baseline. See MEASUREMENT.md for every metric definition.
//
// Hard isolation rules honoured here:
//   * every suite runs headless/offscreen with a separate scratch data directory;
//   * no OS input synthesis and no browser input driver are used anywhere;
//   * the packaged client is only ever launched in its offscreen, unfocusable
//     headless acceptance mode and is never brought to the front.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import * as core from './lib/measure-core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_GUESS = path.resolve(HERE, '..', '..');
const SUITES = ['startup', 'waits', 'frame', 'memory', 'size', 'git', 'assets', 'all'];

function parseArgs(argv) {
  const options = { suite: 'all', runs: null, json: false };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--json') options.json = true;
    else if (token === '--root') options.root = argv[++i];
    else if (token === '--package') options.package = argv[++i];
    else if (token === '--cache') options.cache = argv[++i];
    else if (token === '--runs') options.runs = Number(argv[++i]);
    else if (token === '--out') options.out = argv[++i];
    else if (token === '--thresholds') options.thresholds = argv[++i];
    else if (token === '--help' || token === '-h') options.help = true;
    else if (token.startsWith('--')) throw Error(`unknown option: ${token}`);
    else positional.push(token);
  }
  if (positional.length > 1) throw Error(`unexpected arguments: ${positional.slice(1).join(' ')}`);
  if (positional.length === 1) options.suite = positional[0];
  if (!SUITES.includes(options.suite)) throw Error(`suite must be one of ${SUITES.join(', ')}`);
  return options;
}

function usage() {
  return [
    'Usage: node desktop/delivery/measure.mjs <suite> [options]',
    `  suites: ${SUITES.join(', ')}`,
    '  --root <dir>        repository root (default: cwd)',
    '  --package <dir>     packaged client root containing "Craftmine World.exe"',
    '  --cache <dir>       Godot cache dir (default: CRAFTMINE_GODOT_CACHE_DIR or the main tree cache)',
    '  --runs <n>          sample count (default: git 30, others 3, startup 2)',
    '  --out <file>        evidence JSON path (default: $PI_SCRATCH_DIR/k-measurement.json)',
    '  --thresholds <file> frozen thresholds (default: desktop/delivery/MEASUREMENT_THRESHOLDS.json)',
    '  --json              print the evidence JSON instead of the table',
  ].join('\n');
}

function scratchDir() {
  const base = process.env.PI_SCRATCH_DIR || path.join(os.tmpdir(), 'craftmine-measure');
  fs.mkdirSync(base, { recursive: true });
  return base;
}

function defaultPackage() {
  const candidates = [
    process.env.CRAFTMINE_MEASURE_PACKAGE,
    path.join(REPO_GUESS, 'desktop', 'build', 'windows-preview-batch-07'),
    'D:/Craftmine World/desktop/build/windows-preview-batch-07',
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(path.join(candidate, 'Craftmine World.exe'))) ?? null;
}

function defaultCache() {
  const candidates = [
    process.env.CRAFTMINE_GODOT_CACHE_DIR,
    'D:/Craftmine World/desktop/build/godot/4.7.2-stable',
    path.join(REPO_GUESS, 'desktop', 'build', 'godot', '4.7.2-stable'),
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate)) ?? null;
}

function godotExecutable(cache) {
  if (!cache) return null;
  for (const candidate of [
    path.join(cache, 'editor', 'Godot_v4.7.2-stable_win64_console.exe'),
    path.join(cache, 'editor', 'Godot_v4.7.2-stable_win64.exe'),
  ]) if (fs.existsSync(candidate)) return candidate;
  return null;
}

function isolatedEnv(root) {
  const env = { ...process.env };
  const home = path.join(root, 'home');
  const layout = {
    USERPROFILE: home,
    APPDATA: path.join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    TEMP: path.join(home, 'temp'),
    TMP: path.join(home, 'temp'),
  };
  for (const dir of Object.values(layout)) fs.mkdirSync(dir, { recursive: true });
  Object.assign(env, layout);
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function runCommand(file, args, { cwd, env, timeoutMs = 300000, input } = {}) {
  const started = performance.now();
  const result = spawnSync(file, args, {
    cwd,
    env,
    input,
    encoding: 'utf8',
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer: 256 * 1024 * 1024,
  });
  return {
    elapsedMs: performance.now() - started,
    status: result.status,
    signal: result.signal,
    error: result.error ? String(result.error) : null,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function git(root, args, timeoutMs = 120000) {
  return runCommand('git', args, { cwd: root, timeoutMs });
}

function commitOf(root) {
  const result = git(root, ['rev-parse', 'HEAD'], 20000);
  return result.status === 0 ? result.stdout.trim() : null;
}

function environment() {
  const cpus = os.cpus();
  return {
    os: `${os.platform()} ${os.release()} (${os.arch()})`,
    node: process.version,
    cpu: cpus[0]?.model ?? 'unknown',
    logicalCpus: cpus.length,
    totalRamBytes: os.totalmem(),
  };
}

function copyTree(source, target) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
}

function walkFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) files.push({ path: full, bytes: fs.statSync(full).size });
    }
  }
  return files;
}

// --------------------------------------------------------------------- startup

function packageSupportsHeadless(packageDir) {
  const asar = path.join(packageDir, 'resources', 'app.asar');
  if (!fs.existsSync(asar)) return false;
  const needle = Buffer.from('craftmine-headless-ready');
  const data = fs.readFileSync(asar);
  return data.includes(needle) && data.includes(Buffer.from('CRAFTMINE_HEADLESS_TEST'));
}

function launchPackagedClient(packageDir, ctx) {
  const exe = path.join(packageDir, 'Craftmine World.exe');
  const resources = path.join(packageDir, 'resources');
  const rootBase = path.join(ctx.scratch, 'k-measure', 'test-results');
  fs.mkdirSync(rootBase, { recursive: true });
  const root = fs.mkdtempSync(path.join(rootBase, 'desktop-native-measure-'));
  const profile = path.join(root, 'profile');
  const legacySource = path.join(root, 'legacy');
  fs.mkdirSync(profile, { recursive: true });
  fs.mkdirSync(legacySource, { recursive: true });
  const token = randomUUID();
  fs.writeFileSync(path.join(profile, 'headless-profile.json'), JSON.stringify({ format: 'craftmine.headless-profile/1', token, legacySource }));
  const env = isolatedEnv(root);
  Object.assign(env, {
    CRAFTMINE_HEADLESS_TEST: '1',
    CRAFTMINE_HEADLESS_ROOT: root,
    CRAFTMINE_DATA_DIR: profile,
    CRAFTMINE_HEADLESS_TOKEN: token,
    CRAFTMINE_CORE_BIN: path.join(resources, 'bin', 'craftmine-core.exe'),
    PI_DESKTOP_HOST_BIN: path.join(resources, 'bin', 'pi-desktop-host-core.exe'),
  });
  const started = performance.now();
  const child = spawn(exe, [], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const state = { ready: false, readyMs: null, renderMs: null, exit: null, error: null, stdout: '' };
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode) return;
    try { child.kill(); } catch { /* already gone */ }
    const deadline = performance.now() + 4000;
    while (child.exitCode === null && child.signalCode === null && performance.now() < deadline) await delay(100);
    if (child.exitCode === null && child.signalCode === null) {
      runCommand('taskkill', ['/PID', String(child.pid), '/T', '/F'], { timeoutMs: 20000 });
    }
  };
  child.stdout.on('data', chunk => {
    state.stdout += String(chunk);
    const match = /phase=window-rendered-offscreen elapsedMs=(\d+)/.exec(state.stdout);
    if (match && state.renderMs === null) state.renderMs = Number(match[1]);
  });
  child.stderr.on('data', () => {});
  child.on('error', error => { state.error = String(error); });
  child.on('exit', (code, signal) => { state.exit = { code, signal }; });
  child.on('message', message => {
    if (message?.type === 'craftmine-headless-ready' && !state.ready) {
      state.ready = true;
      state.readyMs = performance.now() - started;
    }
  });
  const waitUntil = performance.now() + ctx.startupTimeoutMs;
  const settle = async () => {
    while (!state.ready && state.exit === null && performance.now() < waitUntil) await delay(50);
    return state;
  };
  return { child, state, stop, settle, profile };
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function suiteStartup(ctx) {
  const metrics = [];
  const skipped = [];
  const thresholds = ctx.thresholds;
  const packageDir = ctx.packageDir;
  const humanCommand = `node desktop/delivery/measure.mjs startup --package "<package dir containing Craftmine World.exe>" --out <evidence.json>`;
  if (!packageDir) {
    for (const name of ['startup.cold.ms', 'startup.warm.ms']) {
      skipped.push(core.skippedMetric(name, 'no packaged client found', humanCommand));
    }
    return { id: 'startup', metrics, skipped };
  }
  if (!packageSupportsHeadless(packageDir)) {
    for (const name of ['startup.cold.ms', 'startup.warm.ms']) {
      skipped.push(core.skippedMetric(name, 'packaged client has no offscreen headless readiness channel; refusing to open a visible window', humanCommand));
    }
    return { id: 'startup', metrics, skipped };
  }
  const runs = Math.max(2, ctx.runs ?? 2);
  const cold = [];
  const warm = [];
  const rendered = [];
  let failure = null;
  for (let index = 0; index < runs; index += 1) {
    const launch = launchPackagedClient(packageDir, ctx);
    const state = await launch.settle();
    if (!state.ready) {
      failure = state.error ?? `no readiness signal (exit ${JSON.stringify(state.exit)})`;
      await launch.stop();
      break;
    }
    if (index === 0) cold.push(state.readyMs);
    else warm.push(state.readyMs);
    for (let waitIndex = 0; waitIndex < 40 && state.renderMs === null && state.exit === null; waitIndex += 1) await delay(100);
    if (typeof state.renderMs === 'number') rendered.push(state.renderMs);
    await launch.stop();
  }
  if (cold.length === 0) {
    skipped.push(core.skippedMetric('startup.cold.ms', `packaged client did not report readiness: ${failure}`, humanCommand));
    skipped.push(core.skippedMetric('startup.warm.ms', 'cold sample failed', humanCommand));
    return { id: 'startup', metrics, skipped };
  }
  metrics.push(core.metric({
    name: 'startup.cold.ms', unit: 'ms', samples: cold, source: 'real-client',
    process: 'Craftmine World.exe (Electron, offscreen unfocusable)',
    threshold: core.thresholdFor(thresholds, 'startup.cold.ms'),
    notes: `${core.COLD_WARM_RULE}; signal = IPC {type:'craftmine-headless-ready'}`,
  }));
  metrics.push(core.metric({
    name: 'startup.warm.ms', unit: 'ms', samples: warm, source: 'real-client',
    process: 'Craftmine World.exe (Electron, offscreen unfocusable)',
    threshold: core.thresholdFor(thresholds, 'startup.warm.ms'),
    notes: `${core.COLD_WARM_RULE}; signal = IPC {type:'craftmine-headless-ready'}`,
  }));
  if (rendered.length) {
    metrics.push(core.metric({
      name: 'startup.offscreenRendered.ms', unit: 'ms', samples: rendered, source: 'real-client',
      process: 'Craftmine World.exe (Electron, offscreen unfocusable)',
      threshold: core.thresholdFor(thresholds, 'startup.offscreenRendered.ms'),
      notes: 'stdout [timing] kind=boot phase=window-rendered-offscreen elapsedMs',
    }));
  }
  return { id: 'startup', metrics, skipped };
}

// ----------------------------------------------------------------------- waits

function baseProjectPath(root, base) {
  if (base === 'top-down') return path.join(root, 'desktop', 'godot', 'bases', 'top-down', 'worlds', 'blank');
  return path.join(root, 'desktop', 'godot', 'bases', base);
}

function measureImport(ctx, sourceProject, label) {
  const target = path.join(ctx.work, `import-${label}-${randomUUID().slice(0, 8)}`);
  copyTree(sourceProject, target);
  const env = isolatedEnv(target);
  const result = runCommand(ctx.godot, ['--headless', '--path', target, '--import'], { env, timeoutMs: 600000 });
  fs.rmSync(target, { recursive: true, force: true });
  if (result.status !== 0) return { error: `import exited ${result.status}: ${(result.stderr || result.stdout).slice(0, 400)}` };
  return { ms: result.elapsedMs };
}

async function suiteWaits(ctx) {
  const metrics = [];
  const skipped = [];
  const thresholds = ctx.thresholds;
  const runs = Math.max(1, ctx.runs ?? 3);
  if (!ctx.godot) {
    skipped.push(core.skippedMetric('waits.engine-import.ms', 'pinned Godot executable not found', 'set CRAFTMINE_GODOT_CACHE_DIR or pass --cache <dir>'));
    skipped.push(core.skippedMetric('waits.project-build.ms', 'pinned Godot executable not found', 'set CRAFTMINE_GODOT_CACHE_DIR or pass --cache <dir>'));
    skipped.push(core.skippedMetric('waits.probe-check.ms', 'pinned Godot executable not found', 'set CRAFTMINE_GODOT_CACHE_DIR or pass --cache <dir>'));
  } else {
    const source = baseProjectPath(ctx.root, 'top-down');
    const importSamples = [];
    for (let index = 0; index < runs; index += 1) {
      const outcome = measureImport(ctx, source, 'base');
      if (outcome.error) { skipped.push(core.skippedMetric('waits.engine-import.ms', outcome.error, 'node desktop/delivery/measure.mjs waits --cache <dir>')); break; }
      importSamples.push(outcome.ms);
    }
    if (importSamples.length) {
      metrics.push(core.metric({
        name: 'waits.engine-import.ms', unit: 'ms', samples: importSamples, source: 'real-engine',
        process: 'Godot_v4.7.2-stable_win64_console.exe --headless --import',
        threshold: core.thresholdFor(thresholds, 'waits.engine-import.ms'),
        notes: `fresh scratch copy per sample; ${core.COLD_WARM_RULE}`,
      }));
    }
    const buildSamples = [];
    for (let index = 0; index < runs; index += 1) {
      const out = path.join(ctx.work, `build-${randomUUID().slice(0, 8)}`);
      const materialize = runCommand(process.execPath, [
        path.join(ctx.root, 'desktop', 'godot', 'bases', 'top-down', 'tools', 'new-world.mjs'),
        '--template', 'blank', '--world-id', `measure-${randomUUID().slice(0, 8)}`, '--name', 'measure', '--out', out,
      ], { cwd: ctx.root, timeoutMs: 120000 });
      if (materialize.status !== 0) {
        skipped.push(core.skippedMetric('waits.project-build.ms', `new-world.mjs exited ${materialize.status}: ${(materialize.stderr || materialize.stdout).slice(0, 400)}`, 'node desktop/delivery/measure.mjs waits'));
        break;
      }
      const imported = runCommand(ctx.godot, ['--headless', '--path', out, '--import'], { env: isolatedEnv(out), timeoutMs: 600000 });
      buildSamples.push(materialize.elapsedMs + imported.elapsedMs);
      fs.rmSync(out, { recursive: true, force: true });
      if (imported.status !== 0) break;
    }
    if (buildSamples.length) {
      metrics.push(core.metric({
        name: 'waits.project-build.ms', unit: 'ms', samples: buildSamples, source: 'real-engine',
        process: 'node tools/new-world.mjs + Godot --headless --import',
        threshold: core.thresholdFor(thresholds, 'waits.project-build.ms'),
        notes: 'materialise a blank world project into scratch, then engine import; both wall times summed',
      }));
    }
    const verifySamples = [];
    const verifyScript = path.join(ctx.root, 'desktop', 'godot', 'bases', 'top-down', 'tools', 'verify.mjs');
    for (let index = 0; index < Math.max(1, Math.min(runs, 2)); index += 1) {
      const work = path.join(ctx.work, `verify-${randomUUID().slice(0, 8)}`);
      fs.mkdirSync(work, { recursive: true });
      const result = runCommand(process.execPath, [verifyScript, '--godot', ctx.godot, '--work', work, '--out', path.join(work, 'report')], {
        cwd: ctx.root, env: isolatedEnv(work), timeoutMs: 1800000,
      });
      verifySamples.push(result.elapsedMs);
      if (result.status === null) { skipped.push(core.skippedMetric('waits.probe-check.ms', 'base verify script timed out', `node "${verifyScript}" --godot "<godot exe>" --work <scratch> --out <scratch/report>`)); verifySamples.pop(); break; }
    }
    if (verifySamples.length) {
      metrics.push(core.metric({
        name: 'waits.probe-check.ms', unit: 'ms', samples: verifySamples, source: 'real-engine',
        process: 'node desktop/godot/bases/top-down/tools/verify.mjs (headless probes)',
        threshold: core.thresholdFor(thresholds, 'waits.probe-check.ms'),
        notes: 'full base acceptance script wall time; exit status is not part of the wait metric',
      }));
    }
  }
  skipped.push(core.skippedMetric(
    'waits.candidate-apply.ms',
    'no real broker/apply timing is exposed in the current tree; no product apply path was run',
    'Run a real candidate apply through the product host, capture its [timing] phase=apply line, then re-run: node desktop/delivery/measure.mjs waits --out <evidence.json>',
  ));
  skipped.push(core.skippedMetric(
    'waits.install.ms',
    'running the NSIS installer changes the machine and was not executed',
    'On a disposable clean Windows VM: powershell -File desktop/delivery/windows-lifecycle-acceptance.ps1 -Installer "<package>\\Craftmine-World-Setup-0.14.3.exe"',
  ));
  return { id: 'waits', metrics, skipped };
}

// ----------------------------------------------------------------------- frame

const FRAME_AUTOLOAD = `extends Node
var frames := 0
var last := 0
func _ready() -> void:
	last = Time.get_ticks_usec()
func _process(_delta: float) -> void:
	var now := Time.get_ticks_usec()
	print("FRAME %d %d" % [frames, now - last])
	last = now
	frames += 1
	if frames >= 300:
		get_tree().quit()
`;

async function suiteFrame(ctx) {
  const metrics = [];
  const skipped = [];
  const humanCommand = `node desktop/delivery/measure.mjs frame --cache "<godot cache>" --out <evidence.json>`;
  if (!ctx.godot) {
    skipped.push(core.skippedMetric('frame.time.ms', 'pinned Godot executable not found', humanCommand));
    return { id: 'frame', metrics, skipped };
  }
  const source = baseProjectPath(ctx.root, 'top-down');
  if (!fs.existsSync(source)) {
    skipped.push(core.skippedMetric('frame.time.ms', `base project not found: ${source}`, humanCommand));
    return { id: 'frame', metrics, skipped };
  }
  const project = path.join(ctx.work, 'frame-project');
  copyTree(source, project);
  fs.writeFileSync(path.join(project, 'measure_frame_probe.gd'), FRAME_AUTOLOAD);
  const projectFile = path.join(project, 'project.godot');
  let config = fs.readFileSync(projectFile, 'utf8');
  if (!config.includes('MeasureFrameProbe=')) {
    config = config.replace(/\[autoload\]\r?\n\r?\n/, `[autoload]\n\nMeasureFrameProbe="*res://measure_frame_probe.gd"\n`);
    fs.writeFileSync(projectFile, config);
  }
  const env = isolatedEnv(project);
  const importRun = runCommand(ctx.godot, ['--headless', '--path', project, '--import'], { env, timeoutMs: 600000 });
  if (importRun.status !== 0) {
    skipped.push(core.skippedMetric('frame.time.ms', `scratch project import failed: ${(importRun.stderr || importRun.stdout).slice(0, 400)}`, humanCommand));
    return { id: 'frame', metrics, skipped };
  }
  const samples = [];
  const runs = Math.max(1, ctx.runs ?? 3);
  let failure = null;
  for (let index = 0; index < runs; index += 1) {
    const run = runCommand(ctx.godot, ['--headless', '--path', project, '--quit-after', '500'], { env, timeoutMs: 600000 });
    const deltas = [...run.stdout.matchAll(/^FRAME \d+ (\d+)$/gm)].map(match => Number(match[1]) / 1000);
    if (deltas.length === 0) { failure = `no FRAME lines (exit ${run.status})`; break; }
    samples.push(...deltas);
  }
  if (samples.length === 0) {
    skipped.push(core.skippedMetric('frame.time.ms', `headless engine run produced no frame timings: ${failure}`, humanCommand));
    return { id: 'frame', metrics, skipped };
  }
  metrics.push(core.metric({
    name: 'frame.time.ms', unit: 'ms', samples, source: 'real-engine',
    process: 'Godot_v4.7.2-stable_win64_console.exe --headless (base main scene + measurement autoload)',
    threshold: core.thresholdFor(ctx.thresholds, 'frame.time.ms'),
    notes: 'per-frame Time.get_ticks_usec delta from a scratch copy of the top-down blank world main scene; frame 0 is the initialization frame',
  }));
  return { id: 'frame', metrics, skipped };
}

// ---------------------------------------------------------------------- memory

function sampleMemory(pid, durationMs, intervalMs) {
  const script = [
    `$root = ${pid}`,
    `$end = (Get-Date).AddMilliseconds(${durationMs})`,
    'while ((Get-Date) -lt $end) {',
    "  $p = Get-Process -Id $root -ErrorAction SilentlyContinue",
    '  $rootWs = if ($p) { $p.WorkingSet64 } else { 0 }',
    '  $rootPv = if ($p) { $p.PrivateMemorySize64 } else { 0 }',
    "  $rows = @(Get-CimInstance Win32_Process -Filter \"Name='Craftmine World.exe'\" | Select-Object ProcessId,ParentProcessId,WorkingSetSize,PrivatePageCount)",
    '  $byId = @{}',
    '  foreach ($r in $rows) { $byId[[int]$r.ProcessId] = $r }',
    '  $ws = 0; $pv = 0; $n = 0',
    '  foreach ($r in $rows) {',
    '    $cur = $r; $inTree = $false; $guard = 0',
    '    while ($cur -and $guard -lt 8) {',
    '      if ([int]$cur.ProcessId -eq $root) { $inTree = $true; break }',
    '      $cur = $byId[[int]$cur.ParentProcessId]; $guard++',
    '    }',
    '    if ($inTree) { $ws += [int64]$r.WorkingSetSize; $pv += [int64]$r.PrivatePageCount; $n++ }',
    '  }',
    '  "{0}|{1}|{2}|{3}|{4}" -f $rootWs,$rootPv,$ws,$pv,$n',
    `  Start-Sleep -Milliseconds ${intervalMs}`,
    '}',
  ].join('\n');
  const result = runCommand('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { timeoutMs: durationMs + 60000 });
  return result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const [rootWs, rootPv, treeWs, treePv, count] = line.split('|').map(Number);
    return { rootWs, rootPv, treeWs, treePv, count };
  }).filter(sample => Number.isFinite(sample.rootWs));
}

async function suiteMemory(ctx) {
  const metrics = [];
  const skipped = [];
  const packageDir = ctx.packageDir;
  const humanCommand = 'node desktop/delivery/measure.mjs memory --package "<package dir containing Craftmine World.exe>" --out <evidence.json>';
  if (!packageDir || !packageSupportsHeadless(packageDir)) {
    skipped.push(core.skippedMetric('memory.workingSet.peak.mb', 'no headless-capable packaged client found', humanCommand));
    skipped.push(core.skippedMetric('memory.privateBytes.peak.mb', 'no headless-capable packaged client found', humanCommand));
    return { id: 'memory', metrics, skipped };
  }
  const launch = launchPackagedClient(packageDir, ctx);
  const state = await launch.settle();
  if (!state.ready) {
    await launch.stop();
    skipped.push(core.skippedMetric('memory.workingSet.peak.mb', `client did not become ready: ${state.error ?? JSON.stringify(state.exit)}`, humanCommand));
    skipped.push(core.skippedMetric('memory.privateBytes.peak.mb', `client did not become ready: ${state.error ?? JSON.stringify(state.exit)}`, humanCommand));
    return { id: 'memory', metrics, skipped };
  }
  const windowMs = ctx.memoryWindowMs;
  const samples = sampleMemory(launch.child.pid, windowMs, 400);
  await launch.stop();
  if (samples.length === 0) {
    skipped.push(core.skippedMetric('memory.workingSet.peak.mb', 'Get-Process returned no samples', humanCommand));
    skipped.push(core.skippedMetric('memory.privateBytes.peak.mb', 'Get-Process returned no samples', humanCommand));
    return { id: 'memory', metrics, skipped };
  }
  const mb = value => value / (1024 * 1024);
  const steady = values => core.percentile(values.slice(Math.floor(values.length / 2)), 50);
  const rootWs = samples.map(sample => mb(sample.rootWs));
  const rootPv = samples.map(sample => mb(sample.rootPv));
  const treeWs = samples.map(sample => mb(sample.treeWs));
  const treePv = samples.map(sample => mb(sample.treePv));
  const steadyNote = `peak = max over ${samples.length} samples at 400 ms; steady = nearest-rank p50 of the last half of the window (${windowMs} ms) after the readiness signal`;
  const definitions = [
    ['memory.workingSet.peak.mb', rootWs, 'root process WorkingSet64'],
    ['memory.workingSet.steady.mb', [steady(rootWs)], 'root process WorkingSet64'],
    ['memory.privateBytes.peak.mb', rootPv, 'root process PrivateMemorySize64'],
    ['memory.privateBytes.steady.mb', [steady(rootPv)], 'root process PrivateMemorySize64'],
    ['memory.treeWorkingSet.peak.mb', treeWs, 'sum of WorkingSetSize over the client process tree'],
    ['memory.treePrivateBytes.peak.mb', treePv, 'sum of PrivatePageCount over the client process tree'],
  ];
  for (const [name, values, note] of definitions) {
    const chosen = name.endsWith('.peak.mb') ? [Math.max(...values)] : values;
    metrics.push(core.metric({
      name, unit: 'MB', samples: chosen, source: 'real-process',
      process: 'powershell Get-Process / Get-CimInstance Win32_Process',
      threshold: core.thresholdFor(ctx.thresholds, name),
      notes: `${note}; ${steadyNote}`,
    }));
  }
  return { id: 'memory', metrics, skipped };
}

// ------------------------------------------------------------------------ size

function sizeCategory(relative) {
  if (!/[/\\]/.test(relative) && !/Setup[^/]*\.exe$/i.test(relative)) return 'exe-dll';
  const normalized = relative.split(path.sep).join('/');
  if (/Setup[^/]*\.exe$/i.test(normalized)) return 'installer';
  if (normalized.startsWith('resources/bin/')) return 'resources.bin';
  if (normalized.startsWith('resources/agent-runtime/')) return 'resources.agent-runtime';
  if (normalized.startsWith('resources/plugins/')) return 'resources.plugins';
  if (normalized.startsWith('resources/licenses/')) return 'resources.licenses';
  if (normalized.startsWith('resources/source/')) return 'resources.source';
  if (normalized.startsWith('resources/')) return 'resources.other';
  if (normalized.startsWith('locales/')) return 'locales';
  return 'other';
}

async function suiteSize(ctx) {
  const metrics = [];
  const skipped = [];
  const packageDir = ctx.packageDir;
  if (!packageDir) {
    skipped.push(core.skippedMetric('size.install.total.mb', 'no packaged client found', 'pass --package <dir containing Craftmine World.exe>', 'MB'));
    return { id: 'size', metrics, skipped };
  }
  const files = walkFiles(packageDir);
  const buckets = new Map();
  let installerBytes = 0;
  for (const file of files) {
    const relative = path.relative(packageDir, file.path);
    const category = sizeCategory(relative);
    const isInstaller = category === 'installer';
    buckets.set(isInstaller ? 'installer' : category, (buckets.get(isInstaller ? 'installer' : category) ?? 0) + file.bytes);
    if (isInstaller) installerBytes += file.bytes;
  }
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const mb = value => value / (1024 * 1024);
  const add = (name, value, unit = 'MB', note = null) => metrics.push(core.metric({
    name, unit, samples: [value], source: 'real-filesystem', process: 'node measure.mjs fs walk',
    threshold: core.thresholdFor(ctx.thresholds, name), notes: note,
  }));
  add('size.install.total.mb', mb(totalBytes), 'MB', `sum of ${files.length} file bytes under ${packageDir}`);
  add('size.fileCount', files.length, 'files', 'regular files under the package root');
  for (const key of ['resources.bin', 'resources.agent-runtime', 'resources.plugins', 'resources.licenses', 'resources.source', 'resources.other', 'exe-dll', 'locales', 'other']) {
    add(`size.${key}.mb`, mb(buckets.get(key) ?? 0), 'MB', key === 'other' ? 'everything not in a named bucket' : null);
  }
  if (installerBytes > 0) add('size.installer.nsis.mb', mb(installerBytes), 'MB', 'largest Setup*.exe present in the package root');
  else skipped.push(core.skippedMetric('size.installer.nsis.mb', 'no Setup*.exe in the package root', 'place the built NSIS installer in the package root and re-run', 'MB'));
  return { id: 'size', metrics, skipped };
}

// ------------------------------------------------------------------------- git

function largestChangedFile(root) {
  const names = git(root, ['diff', '--name-only', 'HEAD~50..HEAD'], 60000);
  const candidates = names.status === 0 ? names.stdout.split(/\r?\n/).filter(Boolean) : [];
  let best = null;
  for (const relative of candidates) {
    const full = path.join(root, relative);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
    const bytes = fs.statSync(full).size;
    if (!best || bytes > best.bytes) best = { relative, bytes };
  }
  if (best) return best;
  const tracked = git(root, ['ls-files', '-z'], 60000);
  for (const relative of (tracked.status === 0 ? tracked.stdout.split('\0') : [])) {
    const full = path.join(root, relative);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
    const bytes = fs.statSync(full).size;
    if (!best || bytes > best.bytes) best = { relative, bytes };
  }
  return best;
}

async function suiteGit(ctx) {
  const metrics = [];
  const skipped = [];
  const runs = Math.max(1, ctx.runs ?? 30);
  const large = largestChangedFile(ctx.root);
  const commands = [
    ['git.log.ms', ['log', '--oneline', '-n', '500'], 'git log --oneline -n 500'],
    ['git.diffStat.ms', ['diff', '--stat', 'HEAD~50..HEAD'], 'git diff --stat HEAD~50..HEAD'],
    ['git.largeFileDiff.ms', large ? ['diff', '--no-color', 'HEAD~50..HEAD', '--', large.relative] : null, large ? `git diff HEAD~50..HEAD -- ${large.relative}` : null],
  ];
  for (const [name, args, label] of commands) {
    if (!args) {
      skipped.push(core.skippedMetric(name, 'no large changed file found for a large-file diff', 'node desktop/delivery/measure.mjs git --out <evidence.json>'));
      continue;
    }
    const samples = [];
    let failure = null;
    for (let index = 0; index < runs; index += 1) {
      const result = git(ctx.root, args, 120000);
      if (result.status !== 0) { failure = `${label} exited ${result.status}`; break; }
      samples.push(result.elapsedMs);
    }
    if (samples.length === 0) {
      skipped.push(core.skippedMetric(name, failure, `git ${args.join(' ')}`));
      continue;
    }
    metrics.push(core.metric({
      name, unit: 'ms', samples, source: 'real-git', process: 'git.exe',
      threshold: core.thresholdFor(ctx.thresholds, name),
      notes: `${core.COLD_WARM_RULE}; command: ${label}`,
    }));
    const cold = samples.slice(0, 1);
    const warm = samples.slice(1);
    if (cold.length) metrics.push(core.metric({
      name: name.replace(/\.ms$/, '.cold.ms'), unit: 'ms', samples: cold, source: 'real-git', process: 'git.exe',
      threshold: core.thresholdFor(ctx.thresholds, name.replace(/\.ms$/, '.cold.ms')),
      notes: `first execution in this process; command: ${label}`,
    }));
    if (warm.length) metrics.push(core.metric({
      name: name.replace(/\.ms$/, '.warm.ms'), unit: 'ms', samples: warm, source: 'real-git', process: 'git.exe',
      threshold: core.thresholdFor(ctx.thresholds, name.replace(/\.ms$/, '.warm.ms')),
      notes: `subsequent executions in this process; command: ${label}`,
    }));
  }
  return { id: 'git', metrics, skipped };
}

// ---------------------------------------------------------------------- assets

const PENDING_INTEGRATION = {
  expectedModule: 'vendor/pi-desktop/crates/craftmine-core/src/asset_catalog/',
  expectedFunctions: [
    'library.search (AL2 catalog search)',
    'library.read (asset version read / source preview)',
    'preview service for PNG/JPEG, static GLB, WAV/OGG and checked Godot scene/script packs (ASSET_LIBRARY_DEVELOPMENT_PLAN.md section 6)',
  ],
  plan: 'docs/ASSET_LIBRARY_DEVELOPMENT_PLAN.md sections 5-7; dispatch task N owns src/asset_catalog/** and the import/scan/index/preview service',
};

function syntheticEntries(count, seed) {
  const kinds = ['image/png', 'image/jpeg', 'model/gltf-binary', 'audio/ogg'];
  const words = ['crate', 'wall', 'tree', 'rock', 'door', 'lamp', 'coin', 'npc', 'tile', 'prop'];
  const entries = [];
  let state = seed >>> 0;
  const next = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0x100000000; };
  for (let index = 0; index < count; index += 1) {
    const a = words[Math.floor(next() * words.length)];
    const b = words[Math.floor(next() * words.length)];
    entries.push({
      assetId: `asset-synthetic-${index.toString(16).padStart(8, '0')}`,
      version: 1 + (index % 3),
      kind: kinds[index % kinds.length],
      name: `${a}-${b}-${index}`,
      tags: [a, b, kinds[index % kinds.length].split('/')[1]],
      bytes: 1024 + Math.floor(next() * 512 * 1024),
    });
  }
  return entries;
}

function measureSyntheticIndex(ctx, count) {
  const dir = path.join(ctx.work, `synthetic-index-${count}`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'index.json');
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ format: 'craftmine.measurement-synthetic-index/1', count, entries: syntheticEntries(count, 0x5eed) }));
  const loaded = JSON.parse(fs.readFileSync(file, 'utf8'));
  const byId = new Map(loaded.entries.map(entry => [entry.assetId, entry]));
  const tagIndex = new Map();
  for (const entry of loaded.entries) for (const tag of entry.tags) {
    if (!tagIndex.has(tag)) tagIndex.set(tag, []);
    tagIndex.get(tag).push(entry.assetId);
  }
  const queries = ['crate', 'wall', 'png', 'tree', 'coin', 'tile', 'prop', 'npc'];
  const searchSamples = [];
  const previewSamples = [];
  const rounds = 40;
  for (let round = 0; round < rounds; round += 1) {
    const query = queries[round % queries.length];
    const searchStart = performance.now();
    const hits = [];
    for (const entry of loaded.entries) {
      if (entry.name.includes(query) || entry.tags.includes(query)) hits.push(entry.assetId);
    }
    searchSamples.push(performance.now() - searchStart);
    const previewStart = performance.now();
    for (const id of hits.slice(0, 8)) {
      const entry = loaded.entries.find(candidate => candidate.assetId === id);
      JSON.stringify({ assetId: entry.assetId, version: entry.version, kind: entry.kind, name: entry.name, bytes: entry.bytes });
    }
    previewSamples.push(performance.now() - previewStart);
  }
  return { searchSamples, previewSamples, entries: loaded.entries.length, file };
}

async function suiteAssets(ctx) {
  const metrics = [];
  const skipped = [];
  const catalog = path.join(ctx.root, 'vendor', 'pi-desktop', 'crates', 'craftmine-core', 'src', 'asset_catalog');
  if (!fs.existsSync(catalog)) {
    for (const name of ['assets.search.ms', 'assets.preview.ms']) {
      skipped.push({
        metric: name,
        unit: 'ms',
        reason: `pending-integration: ${PENDING_INTEGRATION.expectedModule} does not exist in this tree`,
        howToEnable: `implement ${PENDING_INTEGRATION.expectedFunctions.join('; ')} per ${PENDING_INTEGRATION.plan}, then re-run node desktop/delivery/measure.mjs assets`,
      });
    }
  } else {
    skipped.push(core.skippedMetric('assets.search.ms', 'asset_catalog exists but no verified search entry point was wired into measure.mjs', 'extend measure.mjs with the real library.search call'));
    skipped.push(core.skippedMetric('assets.preview.ms', 'asset_catalog exists but no verified preview entry point was wired into measure.mjs', 'extend measure.mjs with the real preview call'));
  }
  for (const count of [1000, 10000]) {
    const result = measureSyntheticIndex(ctx, count);
    const pending = { max: null, min: null, status: 'pending-real-sample' };
    metrics.push(core.metric({
      name: `assets.search.synthetic-${count}.ms`, unit: 'ms', samples: result.searchSamples, source: 'synthetic-index',
      process: 'node measure.mjs in-memory tag index over a scratch JSON index',
      threshold: pending,
      notes: `synthetic-index tier ${count}; 40 queries; NOT product acceptance`,
    }));
    metrics.push(core.metric({
      name: `assets.preview.synthetic-${count}.ms`, unit: 'ms', samples: result.previewSamples, source: 'synthetic-index',
      process: 'node measure.mjs in-memory metadata projection',
      threshold: pending,
      notes: `synthetic-index tier ${count}; 8 projections per query; NOT product acceptance`,
    }));
  }
  return { id: 'assets', metrics, skipped };
}

// ----------------------------------------------------------------------- table

function renderTable(record) {
  const lines = [];
  lines.push(`format      ${record.format}`);
  lines.push(`generatedAt ${record.generatedAt}`);
  lines.push(`commit      ${record.commit}`);
  lines.push(`environment ${record.environment.os} | node ${record.environment.node} | ${record.environment.logicalCpus} logical CPUs | ${(record.environment.totalRamBytes / 1024 ** 3).toFixed(1)} GiB RAM`);
  lines.push('');
  lines.push(['metric', 'unit', 'n', 'p50', 'p95', 'min', 'max', 'threshold', 'verdict', 'source'].join('\t'));
  for (const suite of record.suites) {
    for (const item of suite.metrics) {
      const threshold = item.threshold ? `max<=${item.threshold.max ?? '-'}` : '-';
      lines.push([item.name, item.unit, item.count, item.p50 ?? '-', item.p95 ?? '-', item.min ?? '-', item.max ?? '-', threshold, item.verdict, item.source].join('\t'));
    }
    for (const item of suite.skipped) {
      lines.push([item.metric, item.unit, 0, '-', '-', '-', '-', '-', 'skipped', 'skipped'].join('\t'));
    }
  }
  lines.push('');
  const failed = core.failingMetrics(record);
  const unmeasured = core.unmeasuredMetrics(record);
  const skipped = record.suites.flatMap(suite => suite.skipped.map(item => `${suite.id}:${item.metric}`));
  lines.push(`failed=${failed.length} unmeasured=${unmeasured.length} skipped=${skipped.length}`);
  for (const item of failed) lines.push(`FAIL ${item.suite}:${item.metric} p95=${item.p95} threshold=${JSON.stringify(item.threshold)}`);
  for (const item of unmeasured) lines.push(`UNMEASURED ${item.suite}:${item.metric} (threshold ${item.threshold ? item.threshold.status : 'null'})`);
  for (const suite of record.suites) for (const item of suite.skipped) lines.push(`SKIPPED ${suite.id}:${item.metric} :: ${item.reason} :: ${item.howToEnable}`);
  lines.push('');
  for (const limit of record.limits) lines.push(`LIMIT ${limit}`);
  return lines.join('\n');
}

// ------------------------------------------------------------------------ main

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { process.stdout.write(`${usage()}\n`); return 0; }
  const root = path.resolve(options.root ?? process.cwd());
  const scratch = scratchDir();
  const work = path.join(scratch, 'k-measure');
  fs.mkdirSync(work, { recursive: true });
  const thresholdsPath = path.resolve(options.thresholds ?? path.join(HERE, 'MEASUREMENT_THRESHOLDS.json'));
  const thresholds = fs.existsSync(thresholdsPath) ? JSON.parse(fs.readFileSync(thresholdsPath, 'utf8')) : { metrics: {} };
  const cache = options.cache ? path.resolve(options.cache) : defaultCache();
  const ctx = {
    root,
    scratch,
    work,
    thresholds,
    packageDir: options.package ? path.resolve(options.package) : defaultPackage(),
    godot: godotExecutable(cache),
    cache,
    runs: Number.isFinite(options.runs) && options.runs > 0 ? options.runs : null,
    startupTimeoutMs: 120000,
    memoryWindowMs: 12000,
  };
  const suites = options.suite === 'all' ? ['startup', 'waits', 'frame', 'memory', 'size', 'git', 'assets'] : [options.suite];
  const results = [];
  for (const suite of suites) {
    const started = performance.now();
    let result;
    try {
      if (suite === 'startup') result = await suiteStartup(ctx);
      else if (suite === 'waits') result = await suiteWaits(ctx);
      else if (suite === 'frame') result = await suiteFrame(ctx);
      else if (suite === 'memory') result = await suiteMemory(ctx);
      else if (suite === 'size') result = await suiteSize(ctx);
      else if (suite === 'git') result = await suiteGit(ctx);
      else result = await suiteAssets(ctx);
    } catch (error) {
      result = { id: suite, metrics: [], skipped: [core.skippedMetric(`${suite}.<suite>`, `suite error: ${String(error?.message ?? error)}`, `node desktop/delivery/measure.mjs ${suite}`)] };
    }
    results.push({ ...result, durationMs: Math.round(performance.now() - started) });
    process.stderr.write(`[measure] suite ${suite} done in ${Math.round(performance.now() - started)} ms\n`);
  }
  const record = core.buildRecord({
    commit: commitOf(root),
    environment: environment(),
    suites: results.map(result => ({ id: result.id, metrics: result.metrics, skipped: result.skipped, durationMs: result.durationMs })),
    limits: [
      'Every latency percentile uses nearest-rank (no interpolation), rounded half-away-from-zero to 3 decimals at serialization time.',
      'Cold/warm is per measurement process: index 0 = cold, index >= 1 = warm. The OS file cache is never purged.',
      'Frame numbers come from a headless Godot main loop; there is no rendered-frame or GPU number in this report.',
      'Memory numbers are sampled after readiness with Get-Process / Get-CimInstance; the client is never shown or focused.',
      'Synthetic asset-index numbers are NOT product acceptance and their thresholds stay pending-real-sample.',
      'candidate-apply and install waits were not executed; see the skipped records for the exact human command.',
    ],
  });
  const out = path.resolve(options.out ?? path.join(scratch, 'k-measurement.json'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
  const validation = core.validateRecord(record);
  if (!validation.ok) process.stderr.write(`[measure] schema warnings:\n  ${validation.errors.join('\n  ')}\n`);
  if (options.json) process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
  else process.stdout.write(`${renderTable(record)}\n\nevidence: ${out}\n`);
  const failed = core.failingMetrics(record);
  return failed.length === 0 ? 0 : 1;
}

main().then(code => { process.exitCode = code; }).catch(error => {
  process.stderr.write(`measure: ${error?.stack ?? error}\n`);
  process.exitCode = 2;
});
