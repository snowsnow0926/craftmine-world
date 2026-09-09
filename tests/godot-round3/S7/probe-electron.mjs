// S7 launcher for the Electron-host product probe.
//
// Bundles the real product main-process modules together with the probe entry
// into the built desktop output directory (so `GodotBuildVerifier` finds the
// packaged `out/preload/godot-check.cjs` next to it), then runs it in a hidden,
// offscreen Electron process with an isolated profile and data directory.
//
//   node tests/godot-round3/S7/probe-electron.mjs --out test-results/s7-electron-1
//
// No window is shown, nothing takes focus, no input is sent.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const REPO = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const argv = process.argv.slice(2);
const value = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.resolve(REPO, value('out', `test-results/s7-electron-${stamp}`));
const dataDir = path.resolve(REPO, value('data-dir', path.join(outDir, 'product-data')));
fs.mkdirSync(outDir, {recursive: true});
fs.mkdirSync(path.join(dataDir, 'profile'), {recursive: true});

const desktop = path.join(REPO, 'vendor', 'pi-desktop', 'apps', 'desktop');
const requireDesktop = createRequire(path.join(desktop, 'package.json'));
const esbuild = createRequire(path.join(REPO, 'vendor', 'pi-desktop', 'packages', 'agent-runtime', 'package.json'))('esbuild');
const electronBin = process.env.CRAFTMINE_ELECTRON_BIN || requireDesktop('electron');

const bundle = path.join(desktop, 'out', 'main', 's7-probe.cjs');
await esbuild.build({
  entryPoints: [path.join(REPO, 'tests', 'godot-round3', 'S7', 'fixtures', 'probe-electron-main.mjs')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  logLevel: 'warning',
});

const env = {
  ...process.env,
  CRAFTMINE_CORE_BIN: process.env.CRAFTMINE_CORE_BIN ?? path.join(REPO, 'vendor', 'pi-desktop', 'target', 'release', 'craftmine-core.exe'),
  CRAFTMINE_GODOT_BROKER_BIN: process.env.CRAFTMINE_GODOT_BROKER_BIN ?? path.join(REPO, 'desktop', 'godot', 'sandbox', 'target', 'debug', 'godot-host-broker.exe'),
  CRAFTMINE_GODOT_CACHE_DIR: process.env.CRAFTMINE_GODOT_CACHE_DIR ?? 'D:\\Craftmine World\\desktop\\build\\godot\\4.7.2-stable',
};
const child = spawn(electronBin, [
  bundle,
  `--repo=${REPO}`,
  `--data-dir=${dataDir}`,
  `--out=${outDir}`,
  `--user-data-dir=${path.join(dataDir, 'electron-profile')}`,
], {cwd: REPO, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env});

child.stdout.on('data', chunk => process.stdout.write(chunk));
child.stderr.on('data', chunk => process.stderr.write(chunk));
const code = await new Promise(resolve => child.on('exit', resolve));

const reportPath = path.join(outDir, 'report.json');
const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null;
if (report) {
  process.stdout.write(`\n--- ${report.kind} ---\n`);
  for (const entry of report.steps ?? []) {
    process.stdout.write(`${entry.passed ? 'PASS' : 'FAIL'} ${entry.name} (${entry.ms}ms)${entry.error ? ' :: ' + entry.error : ''}\n`);
  }
  if (report.fatal) process.stdout.write(`FATAL ${report.fatal}\n`);
  process.stdout.write(`evidence: ${outDir}\n`);
}
process.exit(code ?? (report?.failedSteps?.length ? 1 : 0));
