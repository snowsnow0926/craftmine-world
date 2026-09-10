// Offscreen Electron host for the P3 audio-worklet / exit lifecycle regression.
//
// It owns exactly one hidden, non-focusable, offscreen window on its own
// ephemeral session partition, with its own user-data directory, and it drives
// the real product runtime host (`desktop/godot/web/runtime.mjs`) with the real
// `godot-check` preload. It never shows a window, never focuses anything and
// never sends input, mouse or keyboard events.
//
// Modes:
//   exit-ready    - wait for the engine, then request the graceful exit the check
//                   window performs when its body stops right after ready.
//   destroy-ready - destroy the window right after the engine is ready.
//   page-failure  - load a page whose script throws and leaves a rejected promise,
//                   to prove the check preload still reports page failures.
import {app, BrowserWindow, ipcMain, session} from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const CHANNEL = 'pi-desktop/godot-world/message';
const SCOPE_PREFIX = '--craftmine-godot-scope=';

const argv = new Map();
for (const raw of process.argv.slice(1)) {
  const match = /^--([a-z-]+)=(.*)$/.exec(raw);
  if (match) argv.set(match[1], match[2]);
}
const worktree = argv.get('worktree');
const buildRoot = argv.get('build');
const preload = argv.get('preload');
const reportFile = argv.get('report');
const mode = argv.get('mode') ?? 'exit-ready';

// The profile is chosen before the app is ready, and it is never the user's.
app.setPath('userData', argv.get('profile') ?? path.join(os.tmpdir(), `craftmine-p3-audio-${process.pid}`));
app.disableHardwareAcceleration();
// This script owns the process: closing the only window must not end it early.
app.on('window-all-closed', () => {});

const started = Date.now();
const trace = (event, detail = '') => process.stderr.write(`[p3-audio] +${Date.now() - started}ms ${event} ${detail}\n`);
const consoleMessages = [];
const runtimeErrors = [];
let runtimeHost = null;

const report = {
  mode, preloadErrors: [], rendererGone: [], loadFailures: [], consoleMessages, runtimeErrors,
  windowVisible: null, windowFocusable: null, windowOffscreen: null, documentHasFocus: null,
  exit: null, readyMs: null, runtimeState: null, windowDestroyed: null,
  pageErrors: [], audioWorkletFailures: [],
};

function writeReport() {
  const line = 'P3AUDIO ' + JSON.stringify(report);
  try { if (reportFile) fs.writeFileSync(reportFile, line); } catch { /* the caller may read the console line */ }
  try { process.stdout.write(line + '\n'); } catch { /* piped stdout is dropped on Windows */ }
  try { process.stderr.write(line + '\n'); } catch { /* stderr may be gone too */ }
}

function artifactsFor(webDir) {
  return fs.readdirSync(webDir).sort().map(name => {
    const file = path.join(webDir, name);
    return {path: `web/${name}`, bytes: fs.statSync(file).size,
      sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex')};
  });
}

ipcMain.on(CHANNEL, (_event, message) => {
  if (message?.type === 'runtime-error') runtimeErrors.push(String(message.error).slice(0, 400));
  if (runtimeHost) runtimeHost.receive(message);
});

function watch(contents) {
  contents.on('console-message', details => consoleMessages.push({at: Date.now() - started, level: details.level, message: String(details.message).slice(0, 400)}));
  contents.on('preload-error', (_event, file, error) => report.preloadErrors.push(`${file}: ${error?.message}`));
  contents.on('render-process-gone', (_event, details) => report.rendererGone.push(details.reason));
  contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame) report.loadFailures.push(`${code} ${description} ${url}`);
  });
}

function checkWindow({isolated, scope}) {
  const window = new BrowserWindow({
    width: 960, height: 640, show: false, focusable: false,
    webPreferences: {
      session: isolated, offscreen: true, sandbox: true, contextIsolation: true,
      nodeIntegration: false, webviewTag: false, webSecurity: true,
      backgroundThrottling: false, spellcheck: false, preload,
      additionalArguments: [SCOPE_PREFIX + encodeURIComponent(JSON.stringify(scope))],
    },
  });
  report.windowVisible = window.isVisible();
  report.windowFocusable = window.isFocusable();
  report.windowOffscreen = window.webContents.isOffscreen();
  watch(window.webContents);
  return window;
}

/** One offscreen page that really throws and really rejects. */
async function pageFailureCase(isolated) {
  const pageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'craftmine-p3-page-'));
  const page = path.join(pageDir, 'index.html');
  fs.writeFileSync(page, '<!doctype html><meta charset="utf-8"><title>p3</title><canvas id="canvas" width="64" height="64"></canvas>\n' +
    '<script>setTimeout(function () { throw new Error("P3 page boom"); }, 0);</script>\n' +
    '<script>Promise.reject(new Error("P3 page rejection"));</script>\n');
  const scope = {protocol: 'craftmine.godot-runtime/2', worldId: 'world-p3', buildId: 'gbd-p3', instanceId: 'instance-p3'};
  const window = checkWindow({isolated, scope});
  await window.loadFile(page);
  await new Promise(resolve => setTimeout(resolve, 1200));
  report.documentHasFocus = await window.webContents.executeJavaScript('document.hasFocus()', false);
  if (!window.isDestroyed()) window.destroy();
  fs.rmSync(pageDir, {recursive: true, force: true});
}

/** The real managed build, driven exactly like the isolated check window. */
async function engineCase(isolated) {
  const {createWorldRuntime} = await import(pathToFileURL(path.join(worktree, 'desktop', 'godot', 'web', 'runtime.mjs')).href);
  const worldId = 'world-p3-audio';
  const buildId = 'gbd-' + 'c'.repeat(64);
  const runtime = await createWorldRuntime({
    worldId, buildId, root: buildRoot, artifacts: artifactsFor(path.join(buildRoot, 'web')),
    entry: 'web/index.html', threads: true, timeoutMs: 120000,
  });
  runtimeHost = runtime;
  const scope = {protocol: runtime.protocol, worldId, buildId, instanceId: runtime.instanceId};
  const window = checkWindow({isolated, scope});
  runtime.attach(message => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(CHANNEL, message);
  });
  runtime.onEvent(event => {
    if (event.type === 'runtime-error') runtimeErrors.push(String(event.error).slice(0, 400));
  });

  const loadStarted = Date.now();
  await window.loadURL(runtime.url);
  const ready = await runtime.waitReady();
  report.readyMs = Date.now() - loadStarted;
  report.ops = ready.ops;

  if (mode === 'destroy-ready') {
    // The focus reading happens first on this path only, so the exit path keeps
    // its single round trip between ready and the quit request.
    report.documentHasFocus = await window.webContents.executeJavaScript('document.hasFocus()', false);
    window.destroy();
  } else {
    // The check window's own exit path, taken as soon as its body stops needing
    // the engine: this is the window that used to race the audio worklet, so no
    // extra round trip is allowed in between.
    report.exit = await runtime.exit({timeoutMs: 3000});
    try {
      report.documentHasFocus = await window.webContents.executeJavaScript('document.hasFocus()', false);
    } catch {
      report.documentHasFocus = null; // the page is already gone, which is fine
    }
  }
  try { await runtime.dispose({graceful: true}); } catch (error) { report.disposeError = String(error?.message ?? error); }
  if (!window.isDestroyed()) window.destroy();
  report.runtimeState = runtime.state;
  report.windowDestroyed = window.isDestroyed();
}

async function main() {
  const isolated = session.fromPartition(`pi-godot-check-p3-${randomUUID()}`, {cache: false});
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  isolated.registerPreloadScript({type: 'frame', filePath: preload});

  if (mode === 'page-failure') await pageFailureCase(isolated);
  else await engineCase(isolated);

  await new Promise(resolve => setTimeout(resolve, 1500));
  report.pageErrors = consoleMessages.filter(entry => entry.message.startsWith('Uncaught')).map(entry => entry.message);
  report.audioWorkletFailures = consoleMessages.filter(entry => entry.message.includes('AudioWorkletNode')).map(entry => entry.message);
  trace('reporting');
  writeReport();
  // Give the pipe a moment to flush before the process exits.
  setTimeout(() => app.exit(0), 300);
}

app.whenReady().then(main).catch(error => {
  report.fatal = String(error?.stack ?? error);
  writeReport();
  app.exit(9);
});
