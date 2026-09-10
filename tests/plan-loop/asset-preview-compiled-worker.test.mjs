import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import test from 'node:test';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const app = path.join(root, 'vendor/pi-desktop/apps/desktop');
const deps = createRequire(path.join(process.env.CRAFTMINE_NATIVE_DEPENDENCY_ROOT, 'vendor/pi-desktop/apps/desktop/package.json'));
const { rollup } = createRequire(deps.resolve('vite/package.json'))('rollup');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('compiled standalone asset worker decodes PNG, exits normally, and keeps cancellation/timeout', async () => {
  const out = fs.mkdtempSync(path.join(root, 'test-results/asset-compiled-worker-'));
  const output = path.join(out, 'compiled'); fs.mkdirSync(output);
  fs.writeFileSync(path.join(output, 'package.json'), '{"type":"module"}');
  const report = { format: 'craftmine.asset-compiled-worker/1', passed: false, out, checks: [], limits: ['Actual Rollup output and real Node worker threads; not Electron ASAR/package acceptance.', 'No visible window, input, Pointer Lock, model or engine.'] };
  try {
    const config = fs.readFileSync(path.join(app, 'electron.vite.config.ts'), 'utf8');
    assert.match(config, /"asset-preview-worker": resolve\(__dirname, "electron\/craftmine-assets\/asset-preview-worker.js"\)/);
    const bundle = await rollup({ input: {
      index: path.join(app, 'electron/craftmine-assets/preview-worker.mjs'),
      'asset-preview-worker': path.join(app, 'electron/craftmine-assets/asset-preview-worker.js'),
    }, external: id => id.startsWith('node:') });
    try {
      const generated = await bundle.write({ dir: output, format: 'es', entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js' });
      report.files = generated.output.filter(x => x.type === 'chunk').map(x => ({ path: x.fileName, sha256: sha(x.code), bytes: Buffer.byteLength(x.code), modules: Object.keys(x.modules) }));
      for (const file of report.files) {
        assert.ok(file.modules.every(x => !x.endsWith('/electron/main/index.ts')));
        assert.doesNotMatch(fs.readFileSync(path.join(output, file.path), 'utf8'), /from\s*['"]electron['"]|BrowserWindow/);
      }
    } finally { await bundle.close(); }
    report.checks.push('fixed separate build entry, no Main/Electron dependency');
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
    const request = { assetId: 'fixed-pixel', version: 1, contentHash: sha(bytes), mediaType: 'image/png', bytes, engineVersion: '4.7.2-stable' };
    report.direct = await new Promise((resolve, reject) => {
      const worker = new Worker(path.join(output, 'asset-preview-worker.js'), { workerData: { previewRequest: request } });
      let message; const timer = setTimeout(() => { void worker.terminate(); reject(Error('WORKER_EXIT_TIMEOUT')); }, 5000);
      worker.on('message', value => { message = value; });
      worker.once('error', error => { clearTimeout(timer); reject(error); });
      worker.once('exit', code => { clearTimeout(timer); resolve({ code, message }); });
    });
    assert.equal(report.direct.code, 0); assert.equal(report.direct.message.ok, true);
    assert.equal(report.direct.message.result.status, 'ok'); assert.equal(report.direct.message.result.facts.picture, true);
    assert.equal(report.direct.message.result.facts.width, 1); assert.equal(report.direct.message.result.facts.height, 1);
    report.checks.push('compiled worker actually decoded 1x1 PNG and exited zero');
    const { runPreviewInWorker } = await import(pathToFileURL(path.join(output, 'index.js')));
    report.runner = await runPreviewInWorker(request);
    assert.deepEqual(report.runner, report.direct.message.result);
    report.checks.push('bundled Main-side runner locates the fixed worker and returns identical evidence');
    report.timeout = await runPreviewInWorker(request, { timeoutMs: 0 }); assert.equal(report.timeout.status, 'timeout');
    report.checks.push('compiled runner enforces timeout');
    const controller = new AbortController(); const pending = runPreviewInWorker(request, { signal: controller.signal }); controller.abort();
    report.cancelled = await pending; assert.equal(report.cancelled.status, 'cancelled');
    report.checks.push('compiled runner honours live cancellation');
    report.passed = true;
  } catch (error) { report.error = String(error); throw error; }
  finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ out, passed: report.passed, checks: report.checks.length })); }
});
