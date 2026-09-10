// P3 offscreen regression: the real Godot Web build must exit cleanly through the
// isolated check window, with no AudioWorklet teardown error and no unhandled
// page error, and a page that really fails must still be reported.
//
// This is the entry P8 reruns against a frozen package build.
//
// Requirements (skipped, never faked, when absent):
//   CRAFTMINE_GODOT_WEB_BUILD  build root containing web/index.html (a real
//                              managed export, e.g. the artifacts directory of a
//                              Godot build job)
//   CRAFTMINE_ELECTRON_BINARY  electron executable (defaults to the workspace's
//                              apps/desktop/node_modules/electron)
//   CRAFTMINE_P3_PROFILE       optional user-data directory on the evidence drive
//   CRAFTMINE_P3_RAW           optional directory for the raw fixture reports
//
//   node --test tests/godot-remaining/P3/audio-worklet-exit-offscreen.mjs
//
// Everything runs offscreen with a hidden, non-focusable window on its own
// ephemeral session partition: no visible window, no focus, no input.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile, spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const worktree = path.resolve(here, '..', '..', '..');
const desktop = path.join(worktree, 'vendor', 'pi-desktop', 'apps', 'desktop');
const fixture = path.join(here, 'fixtures', 'audio-exit-electron.mjs');
const rawDir = process.env.CRAFTMINE_P3_RAW ?? null;

function electronBinary() {
  if (process.env.CRAFTMINE_ELECTRON_BINARY) return process.env.CRAFTMINE_ELECTRON_BINARY;
  try {
    const bin = require(path.join(desktop, 'node_modules', 'electron'));
    return typeof bin === 'string' && fs.existsSync(bin) ? bin : null;
  } catch { return null; }
}

/**
 * A main-process syntax error would make Electron open its own error dialog, so
 * every script is parsed before any Electron process is started.
 */
function requireParses(file) {
  const check = spawnSync(process.execPath, ['--check', file], {encoding: 'utf8'});
  assert.equal(check.status, 0, `${path.basename(file)} does not parse:\n${check.stderr}`);
}

async function buildPreload() {
  const esbuild = require(path.join(worktree, 'vendor', 'pi-desktop', 'packages', 'agent-runtime', 'node_modules', 'esbuild'));
  const outfile = path.join(os.tmpdir(), `craftmine-p3-godot-check-${Date.now()}.cjs`);
  await esbuild.build({
    entryPoints: [path.join(desktop, 'electron', 'preload', 'godot-check.ts')],
    outfile, bundle: true, platform: 'node', format: 'cjs', target: 'node22',
    external: ['electron'], logLevel: 'silent',
  });
  return outfile;
}

async function archive(name, {report, stdout, stderr, status}) {
  if (!rawDir) return;
  await fs.promises.mkdir(rawDir, {recursive: true});
  await fs.promises.writeFile(path.join(rawDir, `${name}.report.json`), JSON.stringify({status, report}, null, 2));
  await fs.promises.writeFile(path.join(rawDir, `${name}.stdout.log`), String(stdout ?? ''));
  await fs.promises.writeFile(path.join(rawDir, `${name}.stderr.log`), String(stderr ?? ''));
}

/**
 * Runs one fixture process and returns both the fixture's own report and the
 * real Electron process outcome. A run only counts as a pass when the process
 * really exited by itself: not by our timeout, not by a signal.
 */
function runFixture({electron, preload, mode, buildRoot, name}) {
  requireParses(fixture);
  const reportFile = path.join(os.tmpdir(), `craftmine-p3-report-${Date.now()}-${mode}.json`);
  const args = [fixture, `--worktree=${worktree}`,
    `--preload=${preload}`, `--report=${reportFile}`, `--mode=${mode}`];
  if (buildRoot) args.push(`--build=${buildRoot}`);
  if (process.env.CRAFTMINE_P3_PROFILE) args.push(`--profile=${process.env.CRAFTMINE_P3_PROFILE}`);
  return new Promise(resolve => {
    execFile(electron, args, {timeout: 180000, windowsHide: true}, (error, stdout, stderr) => {
      let report = null;
      try { if (fs.existsSync(reportFile)) report = JSON.parse(fs.readFileSync(reportFile, 'utf8').slice('P3AUDIO '.length)); } catch { report = null; }
      const status = {
        name, mode,
        exitCode: error ? (error.code ?? null) : 0,
        signal: error ? (error.signal ?? null) : null,
        timedOut: !!(error && (error.killed || error.signal === 'SIGTERM')),
        error: error ? String(error.message) : null,
        reportFile,
      };
      // The raw evidence is archived, never deleted: the fixture may have failed
      // precisely because its process did not end by itself.
      void archive(name, {report, stdout, stderr, status});
      resolve({report, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), status});
    });
  });
}

/** Asserts the Electron process ended by itself, with exit code 0. */
function assertProcessExited(status) {
  assert.equal(status.timedOut, false, `${status.name}: Electron was still running at the deadline: ${status.error}`);
  assert.equal(status.signal, null, `${status.name}: Electron was killed by ${status.signal}`);
  assert.equal(status.exitCode, 0, `${status.name}: Electron exited ${status.exitCode}: ${status.error}`);
  assert.equal(status.error, null, `${status.name}: ${status.error}`);
}

function assertIsolated(report, where) {
  assert.equal(report.windowVisible, false, `${where}: window visible`);
  assert.equal(report.windowFocusable, false, `${where}: window focusable`);
  assert.equal(report.windowOffscreen, true, `${where}: window not offscreen`);
  assert.equal(report.documentHasFocus, false, `${where}: document held focus`);
  assert.deepEqual(report.preloadErrors, [], `${where}: preload error`);
  assert.deepEqual(report.loadFailures, [], `${where}: load failure`);
}

let currentPreload = null;
let runCounter = 0;

/**
 * The failure this covers is a microtask race, so a single boot is a weak sample
 * and the deterministic ordering proof lives in `audio-worklet-quit-barrier.mjs`.
 * Two real boots keep the end-to-end witness honest without a soak test.
 */
async function runExitReady(iterations = 2) {
  const results = [];
  for (let index = 0; index < iterations; index += 1) {
    runCounter += 1;
    const result = await runFixture({electron: electronBinary(), preload: currentPreload, mode: 'exit-ready',
      buildRoot: buildRoot, name: `${new Date().toISOString().replace(/[:.]/g, '-')}-exit-ready-${runCounter}`});
    assertProcessExited(result.status);
    assert.ok(result.report, `run ${index + 1}: no fixture report: ${result.status.error}`);
    results.push(result.report);
  }
  return results;
}

const electron = electronBinary();
const buildRoot = process.env.CRAFTMINE_GODOT_WEB_BUILD ?? null;
const hasBuild = !!buildRoot && fs.existsSync(path.join(buildRoot, 'web', 'index.html'));
const reason = !electron ? 'no local Electron runtime (set CRAFTMINE_ELECTRON_BINARY)'
  : !hasBuild ? 'no managed Godot Web build (set CRAFTMINE_GODOT_WEB_BUILD)' : null;
// `{skip: null}` still marks a test skipped in node:test, so the gate is only
// present when there really is a reason to skip.
const skipGate = reason ? {skip: reason} : {};
const electronGate = electron ? {} : {skip: reason};

test('the offscreen fixture and its preload build parse before Electron starts', () => {
  requireParses(fixture);
  requireParses(path.join(here, 'audio-worklet-quit-barrier.mjs'));
  requireParses(fileURLToPath(import.meta.url));
});

test('the isolated check window exits gracefully with no AudioWorklet page error', skipGate, async () => {
  currentPreload = await buildPreload();
  try {
    const reports = await runExitReady(2);
    for (const [index, report] of reports.entries()) {
      const where = `run ${index + 1}`;
      assert.equal(report.fatal, undefined, `${where}: ${String(report.fatal)}`);
      assertIsolated(report, where);
      assert.deepEqual(report.rendererGone, [], `${where}: renderer gone`);
      // The engine really ran before it was asked to quit.
      assert.ok(report.readyMs > 0 && Array.isArray(report.ops) && report.ops.includes('exit'), `${where}: ${JSON.stringify(report.ops)}`);
      // The regression: no AudioWorklet teardown error, no unhandled page error.
      assert.deepEqual(report.audioWorkletFailures, [], `${where}: AudioWorklet error`);
      assert.deepEqual(report.pageErrors, [], `${where}: page error`);
      assert.deepEqual(report.runtimeErrors, [], `${where}: runtime error`);
      // And the exit is graceful, not a timeout, with the page gone.
      assert.equal(report.exit?.exitCode, 0, `${where}: ${JSON.stringify(report.exit)}`);
      assert.equal(report.runtimeState, 'disposed', `${where}: runtime not disposed`);
      assert.equal(report.windowDestroyed, true, `${where}: window alive`);
    }
  } finally {
    fs.rmSync(currentPreload, {force: true});
    currentPreload = null;
  }
});

test('destroying the check window right after ready produces no page error', skipGate, async () => {
  currentPreload = await buildPreload();
  runCounter += 1;
  try {
    const result = await runFixture({electron, preload: currentPreload, mode: 'destroy-ready', buildRoot,
      name: `${new Date().toISOString().replace(/[:.]/g, '-')}-destroy-ready-${runCounter}`});
    assertProcessExited(result.status);
    assert.ok(result.report, `no fixture report: ${result.status.error}`);
    const report = result.report;
    assertIsolated(report, 'destroy-ready');
    assert.deepEqual(report.audioWorkletFailures, [], 'destroy-ready: AudioWorklet error');
    assert.deepEqual(report.pageErrors, [], 'destroy-ready: page error');
    assert.deepEqual(report.runtimeErrors, [], 'destroy-ready: runtime error');
    assert.equal(report.windowDestroyed, true, 'destroy-ready: window alive');
  } finally {
    fs.rmSync(currentPreload, {force: true});
    currentPreload = null;
  }
});

test('a failing page is still reported to the host by the check preload', electronGate, async () => {
  currentPreload = await buildPreload();
  runCounter += 1;
  try {
    const result = await runFixture({electron, preload: currentPreload, mode: 'page-failure', buildRoot: null,
      name: `${new Date().toISOString().replace(/[:.]/g, '-')}-page-failure-${runCounter}`});
    assertProcessExited(result.status);
    assert.ok(result.report, `no fixture report: ${result.status.error}`);
    const errors = result.report.runtimeErrors ?? [];
    assert.ok(errors.some(entry => /P3 page boom/.test(entry)), `uncaught error not reported: ${JSON.stringify(errors)}`);
    assert.ok(errors.some(entry => /P3 page rejection/.test(entry)), `unhandled rejection not reported: ${JSON.stringify(errors)}`);
    assertIsolated(result.report, 'page-failure');
  } finally {
    fs.rmSync(currentPreload, {force: true});
    currentPreload = null;
  }
});
