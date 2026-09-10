// P3 offscreen regression: the real Godot Web build must exit cleanly through the
// isolated check window, with no AudioWorklet teardown error and no unhandled
// page error, and a page that really fails must still be reported.
//
// This is the entry P8 reruns against a frozen package build.
//
// Bridge binding (P8 review, item 1)
//   The served build is bound to a declared `web/bridge.js` before Electron is
//   started:
//     * default (`CRAFTMINE_P3_BIND` unset or `source`): the build's bridge must
//       be byte-identical to this source tree's `desktop/godot/web/bridge.js`.
//       A mismatch fails here, before any Electron process exists, and the
//       fixture refuses again before it creates a session or a window.
//     * `CRAFTMINE_P3_BIND=external` with `CRAFTMINE_P3_EXPECTED_BRIDGE=<file>`:
//       an explicitly named bridge, e.g. a copy of an old export. This is the
//       counterexample path only: the candidate tests are skipped and every
//       report still records both digests. It never counts as candidate
//       verification, and it never modifies an existing export.
//   Every fixture report carries `binding` (build root, both bridge paths and
//   SHA-256 digests, the entry SHA-256) and `scope`.
//
// Requirements (skipped, never faked, when absent):
//   CRAFTMINE_GODOT_WEB_BUILD  build root containing web/index.html (a real
//                              managed export, e.g. a candidate build directory)
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
import {createHash} from 'node:crypto';
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
const sourceBridgePath = path.join(worktree, 'desktop', 'godot', 'web', 'bridge.js');
const BIND_MODES = ['source', 'external'];
const REFUSED_EXIT_CODE = 3;

const bindMode = process.env.CRAFTMINE_P3_BIND ?? 'source';
const expectedBridgeArgument = process.env.CRAFTMINE_P3_EXPECTED_BRIDGE ?? null;
const expectedBridgePath = expectedBridgeArgument ?? sourceBridgePath;

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

function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Everything the binding decision needs, read without touching the export. */
function bindingPreflight() {
  const webDir = buildRoot ? path.join(buildRoot, 'web') : null;
  const bridgePath = webDir ? path.join(webDir, 'bridge.js') : null;
  const entryPath = webDir ? path.join(webDir, 'index.html') : null;
  const read = file => (file && fs.existsSync(file) ? sha256File(file) : null);
  const bridgeSha256 = read(bridgePath);
  const expectedSha256 = read(expectedBridgePath);
  const sourceSha256 = read(sourceBridgePath);
  return {
    bindMode, buildRoot, webDir, bridgePath, bridgeSha256,
    expectedBridgePath, expectedBridgeArgument, expectedSha256,
    sourceBridgePath, sourceSha256,
    matchesExpected: bridgeSha256 !== null && bridgeSha256 === expectedSha256,
    expectedMatchesSource: expectedSha256 !== null && expectedSha256 === sourceSha256,
    indexHtmlPath: entryPath, indexHtmlSha256: read(entryPath),
  };
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

/** Archival failures are never swallowed: the run that owns the evidence fails. */
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
 * really exited by itself: not by our timeout, not by a signal. The raw evidence
 * is archived before this resolves, and an archival failure rejects the run.
 */
function runFixture({electron, preload, mode, buildRoot: root, name}) {
  requireParses(fixture);
  const reportFile = path.join(os.tmpdir(), `craftmine-p3-report-${Date.now()}-${mode}.json`);
  const args = [fixture, `--worktree=${worktree}`,
    `--preload=${preload}`, `--report=${reportFile}`, `--mode=${mode}`,
    `--bind=${bindMode}`, `--expected-bridge=${expectedBridgePath}`];
  if (root) args.push(`--build=${root}`);
  if (process.env.CRAFTMINE_P3_PROFILE) args.push(`--profile=${process.env.CRAFTMINE_P3_PROFILE}`);
  return new Promise((resolve, reject) => {
    execFile(electron, args, {timeout: 180000, windowsHide: true}, (error, stdout, stderr) => {
      void (async () => {
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
        // Archived, not deleted: this fixture may have failed precisely because
        // its process did not end by itself.
        await archive(name, {report, stdout, stderr, status});
        resolve({report, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), status});
      })().catch(reject);
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

/** A refused binding must be refused by the fixture itself, before any window. */
function assertBindingAccepted(report, where) {
  assert.ok(report, `${where}: no fixture report`);
  assert.equal(report.bindingRefused ?? null, null, `${where}: the fixture refused the binding: ${JSON.stringify(report.bindingRefused)}`);
  assertBindingRecorded(report, where);
}

/** Every report must carry the binding and the scope it ran under. */
function assertBindingRecorded(report, where) {
  const binding = report.binding;
  assert.ok(binding, `${where}: report does not record the bridge binding`);
  assert.equal(binding.mode, bindMode, `${where}: binding mode ${binding.mode}`);
  assert.equal(binding.buildRoot, buildRoot, `${where}: binding build root ${binding.buildRoot}`);
  assert.equal(binding.bridgePath, path.join(buildRoot, 'web', 'bridge.js'), `${where}: binding bridge path`);
  assert.match(String(binding.bridgeSha256), /^[a-f0-9]{64}$/, `${where}: build bridge sha256`);
  assert.equal(binding.expectedBridgePath, expectedBridgePath, `${where}: expected bridge path`);
  assert.match(String(binding.expectedBridgeSha256), /^[a-f0-9]{64}$/, `${where}: expected bridge sha256`);
  assert.match(String(binding.indexHtmlSha256), /^[a-f0-9]{64}$/, `${where}: entry sha256`);
  assert.ok(report.scope && typeof report.scope.instanceId === 'string', `${where}: report does not record the runtime scope`);
  if (bindMode === 'source') {
    assert.equal(binding.bridgeMatchesExpected, true,
      `${where}: the build bridge is not the source bridge (build=${binding.bridgeSha256} expected=${binding.expectedBridgeSha256})`);
  } else {
    assert.equal(binding.expectedBridgeExplicit, true, `${where}: external binding must name its expected bridge`);
  }
}

function assertIsolated(report, where) {
  assert.equal(report.windowVisible, false, `${where}: window visible`);
  assert.equal(report.windowFocusable, false, `${where}: window focusable`);
  assert.equal(report.windowOffscreen, true, `${where}: window not offscreen`);
  assert.equal(report.documentHasFocus, false, `${where}: document held focus`);
  assert.deepEqual(report.preloadErrors, [], `${where}: preload error`);
  assert.deepEqual(report.loadFailures, [], `${where}: load failure`);
}

const electron = electronBinary();
const buildRoot = process.env.CRAFTMINE_GODOT_WEB_BUILD ?? null;
const hasBuild = !!buildRoot && fs.existsSync(path.join(buildRoot, 'web', 'index.html'));
const reason = !electron ? 'no local Electron runtime (set CRAFTMINE_ELECTRON_BINARY)'
  : !hasBuild ? 'no managed Godot Web build (set CRAFTMINE_GODOT_WEB_BUILD)' : null;
// `{skip: null}` still marks a test skipped in node:test, so a gate is only
// present when there really is a reason to skip.
const skipGate = reason ? {skip: reason} : {};
const electronGate = electron ? {} : {skip: reason};
const externalSkip = bindMode === 'external'
  ? {skip: 'external bridge binding is a counterexample run, not candidate verification'} : null;
const candidateGate = externalSkip ?? skipGate;

let currentPreload = null;
let runCounter = 0;

function nextName(mode) {
  runCounter += 1;
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${mode}-${runCounter}`;
}

/**
 * The failure this covers is a microtask race, so a single boot is a weak sample
 * and the deterministic ordering proof lives in `audio-worklet-quit-barrier.mjs`.
 * Two real boots keep the end-to-end witness honest without a soak test.
 */
async function runExitReady(iterations = 2) {
  const results = [];
  for (let index = 0; index < iterations; index += 1) {
    const result = await runFixture({electron, preload: currentPreload, mode: 'exit-ready',
      buildRoot, name: nextName('exit-ready')});
    assertProcessExited(result.status);
    assert.ok(result.report, `run ${index + 1}: no fixture report: ${result.status.error}`);
    results.push(result.report);
  }
  return results;
}

test('the offscreen fixture and its preload build parse before Electron starts', () => {
  requireParses(fixture);
  requireParses(path.join(here, 'audio-worklet-quit-barrier.mjs'));
  requireParses(fileURLToPath(import.meta.url));
});

test('the served build is bound to a declared bridge before Electron starts', skipGate, () => {
  const preflight = bindingPreflight();
  assert.ok(BIND_MODES.includes(bindMode), `unknown CRAFTMINE_P3_BIND: ${bindMode}`);
  assert.match(String(preflight.bridgeSha256), /^[a-f0-9]{64}$/, `build web/bridge.js is missing: ${preflight.bridgePath}`);
  assert.match(String(preflight.expectedSha256), /^[a-f0-9]{64}$/, `expected bridge is missing: ${expectedBridgePath}`);
  assert.match(String(preflight.indexHtmlSha256), /^[a-f0-9]{64}$/, `build web/index.html is missing: ${preflight.indexHtmlPath}`);
  if (bindMode === 'source') {
    // The candidate export must carry this source tree's bridge. A mismatch stops
    // here, so no Electron process is ever started for the wrong build.
    assert.equal(preflight.matchesExpected, true,
      `build bridge ${preflight.bridgeSha256} is not the source bridge ${preflight.expectedSha256}. ` +
      'Rebuild the export from this source, or make an old-version comparison explicit with ' +
      'CRAFTMINE_P3_BIND=external and CRAFTMINE_P3_EXPECTED_BRIDGE.');
  } else {
    assert.ok(preflight.expectedBridgeArgument, 'CRAFTMINE_P3_BIND=external requires CRAFTMINE_P3_EXPECTED_BRIDGE');
    assert.equal(preflight.expectedMatchesSource, false,
      'an external counterexample must bind a bridge that differs from this source tree');
  }
  // Recorded for the run log and for the report: source, both digests, entry.
  console.log('P3BIND ' + JSON.stringify({
    bindMode, buildRoot, bridgePath: preflight.bridgePath, bridgeSha256: preflight.bridgeSha256,
    expectedBridgePath, expectedSha256: preflight.expectedSha256, sourceBridgePath,
    sourceSha256: preflight.sourceSha256, indexHtmlSha256: preflight.indexHtmlSha256,
  }));
});

test('the isolated check window exits gracefully with no AudioWorklet page error', candidateGate, async () => {
  currentPreload = await buildPreload();
  try {
    const reports = await runExitReady(2);
    for (const [index, report] of reports.entries()) {
      const where = `run ${index + 1}`;
      assert.equal(report.fatal, undefined, `${where}: ${String(report.fatal)}`);
      assertBindingAccepted(report, where);
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

test('destroying the check window right after ready produces no page error', candidateGate, async () => {
  currentPreload = await buildPreload();
  try {
    const result = await runFixture({electron, preload: currentPreload, mode: 'destroy-ready', buildRoot, name: nextName('destroy-ready')});
    assertProcessExited(result.status);
    assertBindingAccepted(result.report, 'destroy-ready');
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
  try {
    const result = await runFixture({electron, preload: currentPreload, mode: 'page-failure', buildRoot: null, name: nextName('page-failure')});
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

test('counterexample run: an explicitly bound old export is measured, not verified',
  bindMode === 'external' && electron ? {} : {skip: 'set CRAFTMINE_P3_BIND=external with CRAFTMINE_P3_EXPECTED_BRIDGE for the counterexample run'},
  async t => {
    assert.ok(buildRoot, 'the counterexample run needs CRAFTMINE_GODOT_WEB_BUILD');
    currentPreload = await buildPreload();
    try {
      const result = await runFixture({electron, preload: currentPreload, mode: 'exit-ready', buildRoot, name: nextName('counterexample-exit-ready')});
      assertProcessExited(result.status);
      assertBindingRecorded(result.report, 'counterexample');
      const binding = result.report.binding;
      // The served build is the declared external bridge, and that bridge is not
      // this source tree's: that is what makes it a counterexample. Its outcome is
      // recorded as a diagnostic only, and it never counts as verification of the
      // candidate build.
      assert.equal(binding.bridgeMatchesExpected, true, 'the served build must be the declared external bridge');
      assert.equal(binding.expectedMatchesSource, false, 'an external counterexample must differ from the source bridge');
      t.diagnostic(`counterexample bridge expected=${binding.expectedBridgeSha256} source=${binding.sourceBridgeSha256}`);
      t.diagnostic(`counterexample AudioWorklet page errors: ${JSON.stringify(result.report.audioWorkletFailures)}`);
      t.diagnostic(`counterexample exit: ${JSON.stringify(result.report.exit)}`);
    } finally {
      fs.rmSync(currentPreload, {force: true});
      currentPreload = null;
    }
  });

test('a build whose bridge is not the declared one is refused before any window exists',
  bindMode === 'source' && electron && buildRoot ? {} : {skip: 'needs CRAFTMINE_P3_BIND=source, Electron and a build root'},
  async () => {
    // The refusal is exercised on a fixture-local copy, never on a real export:
    // the declared-bridge check runs before any session, origin or window.
    const copyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craftmine-p3-refuse-'));
    const copyWeb = path.join(copyRoot, 'web');
    fs.mkdirSync(copyWeb);
    fs.copyFileSync(path.join(buildRoot, 'web', 'index.html'), path.join(copyWeb, 'index.html'));
    fs.writeFileSync(path.join(copyWeb, 'bridge.js'), '// not the declared bridge\n');
    currentPreload = await buildPreload();
    try {
      const refusal = await runFixture({electron, preload: currentPreload, mode: 'exit-ready',
        buildRoot: copyRoot, name: nextName('refused-binding')});
      assert.equal(refusal.status.timedOut, false, 'the refusal must not hang');
      assert.equal(refusal.status.signal, null, `refusal signal ${refusal.status.signal}`);
      assert.equal(refusal.status.exitCode, REFUSED_EXIT_CODE,
        `expected refusal exit ${REFUSED_EXIT_CODE}, got ${refusal.status.exitCode}: ${refusal.status.error}`);
      assert.ok(refusal.report, 'the refusal must still write a report');
      assert.ok(refusal.report.bindingRefused, 'the refusal must be recorded');
      assert.equal(refusal.report.bindingRefused.mode, 'source');
      assert.equal(refusal.report.binding.bridgeMatchesExpected, false);
      assert.equal(refusal.report.windowOffscreen, null, 'no window may be created for a refused build');
      assert.equal(refusal.report.scope, null, 'no runtime scope may exist for a refused build');
      assert.deepEqual(refusal.report.consoleMessages, [], 'no renderer may run for a refused build');
    } finally {
      fs.rmSync(copyRoot, {recursive: true, force: true});
      fs.rmSync(currentPreload, {force: true});
      currentPreload = null;
    }
  });
