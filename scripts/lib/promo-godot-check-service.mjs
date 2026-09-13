import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';

const root = path.resolve(import.meta.dirname, '../..');

// Reuse the product's actual GodotBuildVerifier in an isolated Electron process.
// This service verifies a candidate; it never adopts it or claims gameplay.
export async function startPromoGodotCheckService({directory}) {
  if (!path.isAbsolute(directory)) throw Error('ABSOLUTE_CHECK_DIRECTORY_REQUIRED');
  await fs.mkdir(directory, {recursive: true});
  const run = await fs.mkdtemp(path.join(directory, 'check-host-'));
  const appRoot = path.join(run, 'app');
  const require = createRequire(path.join(root, 'vendor/pi-desktop/apps/desktop/package.json'));
  const buildRequire = createRequire(path.join(root, 'vendor/pi-desktop/packages/agent-runtime/package.json'));
  const {build} = buildRequire('esbuild');
  for (const [entry, output] of [
    ['scripts/lib/promo-godot-check-main.ts', 'main/index.cjs'],
    ['vendor/pi-desktop/apps/desktop/electron/preload/godot-check.ts', 'preload/godot-check.cjs'],
  ]) await build({entryPoints: [path.join(root, entry)], outfile: path.join(appRoot, output),
    bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], logLevel: 'warning'});
  await fs.writeFile(path.join(appRoot, 'package.json'), JSON.stringify({main: 'main/index.cjs'}));
  const env = {CRAFTMINE_PROMO_CHECK_ROOT: run};
  for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATH']) if (process.env[key]) env[key] = process.env[key];
  for (const key of ['APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'TEMP', 'TMP']) {
    env[key] = path.join(run, key.toLowerCase()); await fs.mkdir(env[key], {recursive: true});
  }
  const child = spawn(require('electron'), [appRoot, '--user-data-dir=' + path.join(run, 'chromium')],
    {cwd: run, env, windowsHide: true, shell: false, stdio: ['ignore', 'ignore', 'ignore', 'ipc']});
  const pending = new Map(), captures = new Map();
  let resolveReady, rejectReady, ended = false;
  const ready = new Promise((resolve, reject) => {resolveReady = resolve; rejectReady = reject;});
  const startup = setTimeout(() => {rejectReady(Error('CHECK_HOST_STARTUP_FAILED')); child.kill();}, 30000);
  const exited = new Promise(resolve => child.once('close', code => {
    ended = true; clearTimeout(startup); rejectReady(Error('CHECK_HOST_EXITED:' + code));
    for (const call of pending.values()) call.reject(Error('CHECK_HOST_EXITED:' + code));
    pending.clear(); resolve();
  }));
  child.on('error', error => {clearTimeout(startup); rejectReady(error);});
  child.on('message', message => {
    if (message.kind === 'craftmine-promo-check-ready') {clearTimeout(startup); resolveReady(); return;}
    const call = pending.get(message.id); if (!call) return;
    pending.delete(message.id);
    if (message.error) call.reject(Error(message.error));
    else {
      if (message.frame) captures.set(call.jobId, message.frame);
      call.resolve(message.result);
    }
  });
  try { await ready; }
  catch (error) { child.kill(); await exited; throw error; }
  function call(method, descriptor) {
    if (ended) return Promise.reject(Error('CHECK_HOST_EXITED'));
    return new Promise((resolve, reject) => {
      const id = randomUUID(); pending.set(id, {resolve, reject, jobId: descriptor?.jobId});
      child.send({kind: 'craftmine-promo-check', id, method, descriptor}, error => {
        if (error) {pending.delete(id); reject(error);}
      });
    });
  }
  return {
    directory: run,
    verifier: {godotCheck: descriptor => call('check', descriptor)},
    capture: jobId => captures.get(jobId) ?? null,
    cancel: () => call('cancel'),
    async close() {
      if (ended) return;
      child.send({kind: 'craftmine-promo-check', method: 'close'});
      // Shutdown grace applies only after explicit close, never to a model turn.
      const cleanup = setTimeout(() => child.kill(), 10000);
      await exited; clearTimeout(cleanup);
    },
  };
}
