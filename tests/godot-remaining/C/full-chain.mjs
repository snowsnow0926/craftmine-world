// Runner for the C full-chain acceptance: bundles the Electron harness plus the
// `godot-check` preload, then starts a private offscreen Electron process.
//
// Requires the pinned Godot engine cache and the broker binary to exist. The
// broker path and engine root can be overridden with CRAFTMINE_GODOT_BROKER_BIN
// and CRAFTMINE_GODOT_ENGINE_ROOT. No input, focus or window activation is used.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const dependencies = process.env.CRAFTMINE_TYPECHECK_DEPENDENCY_ROOT ?? root;
const require = createRequire(path.join(dependencies, 'vendor/pi-desktop/apps/desktop/package.json'));
const { build } = createRequire(path.join(dependencies, 'vendor/pi-desktop/packages/agent-runtime/package.json'))('esbuild');
const electron = require('electron');

const coreBin = process.env.CRAFTMINE_CORE_BIN ?? path.join(root, 'vendor/pi-desktop/target/release/craftmine-core.exe');
const broker = process.env.CRAFTMINE_GODOT_BROKER_BIN ?? path.join(root, 'desktop/godot/sandbox/target/debug/godot-host-broker.exe');
const engineRoot = process.env.CRAFTMINE_GODOT_ENGINE_ROOT ?? path.join(root, 'desktop/build/godot/4.7.2-stable');
const bridge = process.env.CRAFTMINE_GODOT_BRIDGE_PATH ?? path.join(root, 'desktop/godot/web/bridge.js');
const lock = process.env.CRAFTMINE_GODOT_TOOLCHAIN_LOCK ?? path.join(root, 'desktop/godot/toolchain.lock.json');

for (const [label, file] of [['core binary', coreBin], ['broker binary', broker], ['engine root', engineRoot], ['bridge', bridge], ['toolchain lock', lock]]) {
  if (!fs.existsSync(file)) {
    console.error(`SKIPPED: ${label} is not available: ${file}`);
    process.exit(2);
  }
}

const resultsRoot = path.join(root, 'test-results');
fs.mkdirSync(resultsRoot, { recursive:true });
const out = fs.mkdtempSync(path.join(resultsRoot, 'godot-remaining-c-full-chain-'));
const appDir = path.join(out, 'app');
fs.mkdirSync(path.join(appDir, 'main'), { recursive:true });
fs.mkdirSync(path.join(appDir, 'preload'), { recursive:true });
fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name:'c-full-chain', main:'main/index.cjs' }));

const bundles = [
  ['tests/godot-remaining/C/full-chain-electron.mjs', 'main/index.cjs'],
  ['vendor/pi-desktop/apps/desktop/electron/preload/godot-check.ts', 'preload/godot-check.cjs'],
];
for (const [entry, destination] of bundles) {
  await build({ entryPoints:[path.join(root, entry)], outfile:path.join(appDir, destination), bundle:true, platform:'node',
    format:'cjs', target:'node22', external:['electron'], logLevel:'warning' });
}

const log = fs.createWriteStream(path.join(out, 'electron.log'));
const child = spawn(electron, [appDir, '--user-data-dir=' + path.join(out, 'electron-profile')], {
  cwd:root, windowsHide:true, stdio:['ignore', 'pipe', 'pipe', 'ipc'],
  env:{ ...process.env, CRAFTMINE_HEADLESS_TEST:'1', CRAFTMINE_C_E2E_OUT:out, CRAFTMINE_C_E2E_ROOT:root,
    CRAFTMINE_CORE_BIN:coreBin, CRAFTMINE_GODOT_BROKER_BIN:broker, CRAFTMINE_GODOT_ENGINE_ROOT:engineRoot,
    CRAFTMINE_GODOT_BRIDGE_PATH:bridge, CRAFTMINE_GODOT_TOOLCHAIN_LOCK:lock },
});
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.stdout.pipe(log, { end:false });
child.stderr.pipe(log, { end:false });
// A wedged renderer must not leave an invisible Electron process behind.
const watchdog = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, Number(process.env.CRAFTMINE_C_E2E_TIMEOUT_MS ?? 900000));
const code = await new Promise(resolve => child.once('exit', (value, signal) => resolve(value === null ? `signal:${signal}` : value)));
clearTimeout(watchdog);
log.end();
const reportPath = path.join(out, 'report.json');
const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null;
console.log(JSON.stringify({ out, exitCode:code, passed:report?.passed === true,
  checks:(report?.checks ?? []).filter(entry => entry.passed).length, total:(report?.checks ?? []).length,
  failure:report?.failure ?? null }));
process.exitCode = code === 0 && report?.passed === true ? 0 : 1;
