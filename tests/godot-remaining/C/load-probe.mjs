// Runner for the fast load probe. Usage:
//   node tests/godot-remaining/C/load-probe.mjs <artifacts-directory>
// The directory must contain `web/index.html` and the rest of the export.
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

const artifacts = process.argv[2] ? path.resolve(process.argv[2]) : process.env.CRAFTMINE_C_PROBE_ARTIFACTS;
if (!artifacts || !fs.existsSync(path.join(artifacts, 'web', 'index.html'))) {
  console.error('usage: node tests/godot-remaining/C/load-probe.mjs <artifacts-dir-with-web/index.html>');
  process.exit(2);
}
const out = fs.mkdtempSync(path.join(root, 'test-results', 'godot-remaining-c-load-probe-'));
const appDir = path.join(out, 'app');
fs.mkdirSync(path.join(appDir, 'main'), { recursive:true });
fs.mkdirSync(path.join(appDir, 'preload'), { recursive:true });
fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name:'c-load-probe', main:'main/index.cjs' }));
for (const [entry, destination] of [
  ['tests/godot-remaining/C/fixtures/load-probe-electron.mjs', 'main/index.cjs'],
  ['vendor/pi-desktop/apps/desktop/electron/preload/godot-check.ts', 'preload/godot-check.cjs'],
]) await build({ entryPoints:[path.join(root, entry)], outfile:path.join(appDir, destination), bundle:true, platform:'node',
  format:'cjs', target:'node22', external:['electron'], logLevel:'warning' });

const child = spawn(electron, [appDir, '--user-data-dir=' + path.join(out, 'profile')], {
  cwd:root, windowsHide:true, stdio:['ignore', 'pipe', 'pipe'],
  env:{ ...process.env, CRAFTMINE_C_PROBE_OUT:out, CRAFTMINE_C_PROBE_ARTIFACTS:artifacts },
});
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
const watchdog = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 180000);
const code = await new Promise(resolve => child.once('exit', value => resolve(value)));
clearTimeout(watchdog);
console.log(JSON.stringify({ out, exitCode:code }));
process.exitCode = code ?? 1;
