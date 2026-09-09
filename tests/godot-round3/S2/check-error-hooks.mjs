// S2 isolated-check error hook test.
//
// The isolated Godot check must not call a page "error free" while authored game
// script is throwing. The engine bridge only reports Godot's own print errors,
// so the check preload installs main-world `error` / `unhandledrejection` hooks.
// This runs the packaged preload in a real hidden offscreen Electron window and
// asserts both kinds of failure reach the host.
//
//   node --test tests/godot-round3/S2/check-error-hooks.mjs
//
// No window is shown, none takes focus, and no input is sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const worktree = path.resolve(here, '..', '..', '..');
const desktop = path.join(worktree, 'vendor', 'pi-desktop', 'apps', 'desktop');

function electronBinary() {
  try { return require(path.join(desktop, 'node_modules', 'electron')); }
  catch { return null; }
}

/** Compile the preload the way electron-vite does, so the test uses real output. */
async function buildPreload() {
  const esbuild = require(path.join(worktree, 'vendor', 'pi-desktop', 'packages', 'agent-runtime', 'node_modules', 'esbuild'));
  const outfile = path.join(os.tmpdir(), 'craftmine-s2-godot-check-' + Date.now() + '.cjs');
  await esbuild.build({entryPoints:[path.join(desktop, 'electron', 'preload', 'godot-check.ts')], outfile,
    bundle:true, platform:'node', format:'cjs', target:'node22', external:['electron'], logLevel:'silent'});
  return outfile;
}

function runElectron({electron, preload, page}) {
  return new Promise(resolve => {
    execFile(electron, [path.join(here, 'fixtures', 'check-hook-electron.mjs'), preload, page,
      'craftmine-s2-check-hook-' + Date.now()], {timeout:120000, windowsHide:true},
    (error, stdout, stderr) => resolve({error, stdout:String(stdout ?? ''), stderr:String(stderr ?? '')}));
  });
}

test('the check preload reports uncaught script errors and unhandled rejections to the host', async () => {
  const electron = electronBinary();
  if (!electron) return; // no local Electron runtime; the packaging proof covers the build
  const preload = await buildPreload();
  const pageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'craftmine-s2-hook-page-'));
  const page = path.join(pageDir, 'index.html');
  fs.writeFileSync(page, `<!doctype html><meta charset="utf-8"><title>hook</title><canvas id="canvas" width="64" height="64"></canvas>
<script>setTimeout(function () { throw new Error('S2 in-game boom'); }, 0);</script>
<script>Promise.reject(new Error('S2 unhandled rejection'));</script>
<script>window.__craftminePageRan = true;</script>`);

  const result = await runElectron({electron, preload, page});
  const line = result.stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? '{}';
  let report = null;
  try { report = JSON.parse(line); } catch { report = null; }
  assert.ok(report, 'electron host printed no report: ' + result.stdout + result.stderr);
  assert.equal(report.scope.instanceId, 'instance-s2-hook');
  const errors = report.runtimeErrors ?? [];
  assert.ok(errors.some(entry => /uncaught-error:.*S2 in-game boom/.test(entry)), 'uncaught error not reported: ' + JSON.stringify(errors));
  assert.ok(errors.some(entry => /unhandled-rejection:.*S2 unhandled rejection/.test(entry)), 'unhandled rejection not reported: ' + JSON.stringify(errors));
  fs.rmSync(pageDir, {recursive:true, force:true});
  fs.rmSync(preload, {force:true});
});
