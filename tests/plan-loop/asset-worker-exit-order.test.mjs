import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createAssetPreviewHost } from '../../vendor/pi-desktop/apps/desktop/electron/craftmine-assets/host-service.mjs';
const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const deps = createRequire(path.join(process.env.CRAFTMINE_NATIVE_DEPENDENCY_ROOT, 'vendor/pi-desktop/apps/desktop/package.json'));
const { transformSync } = deps('esbuild');
const filename = path.join(root, 'vendor/pi-desktop/apps/desktop/electron/craftmine-assets/preview-worker.mjs');
const source = fs.readFileSync(filename, 'utf8');
const code = transformSync(source, { loader: 'js', format: 'cjs', define: { 'import.meta.url': JSON.stringify(pathToFileURL(filename).href) } }).code;
const out = fs.mkdtempSync(path.join(root, 'test-results/asset-worker-exit-'));
const report = { format: 'craftmine.asset-worker-exit-order/1', out, sourceSha256: createHash('sha256').update(source).digest('hex'), cases: [], limits: ['Real worker exit ordering for success/cancel/timeout/crash; non-exiting platform failure uses an explicitly labelled finite event fixture.', 'No Electron shutdown or IOCP-causation claim.'] };
const persist = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
function runner(WorkerClass, timers = { setTimeout, clearTimeout }) {
  const module = { exports: {} };
  const require = id => id === 'node:worker_threads' ? { Worker: WorkerClass } : id === 'node:url' ? { fileURLToPath } : { PREVIEW_TIMEOUT_MS: 20000 };
  new Function('module', 'exports', 'require', 'setTimeout', 'clearTimeout', code)(module, module.exports, require, timers.setTimeout, timers.clearTimeout);
  return module.exports.runPreviewInWorker;
}
const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
const request = { assetId: 'exit-pixel', version: 1, contentHash: createHash('sha256').update(bytes).digest('hex'), bytes, mediaType: 'image/png' };
for (const mode of ['success', 'cancel', 'timeout', 'error']) test(`actual ${mode} worker exits before the caller receives its result`, async () => {
  const events = []; let instance;
  const crash = path.join(out, 'fixed-crash.cjs'); fs.writeFileSync(crash, "throw Error('FIXED_DECODER_CRASH');\n");
  class ObservedWorker extends Worker {
    constructor(entry, options) {
      super(mode === 'error' ? crash : entry, options); instance = this;
      this.once('exit', code => events.push({ event: 'exit', code, threadId: this.threadId }));
    }
  }
  const controller = new AbortController();
  const pending = runner(ObservedWorker)(request, { signal: controller.signal, timeoutMs: mode === 'timeout' ? 0 : 5000 });
  if (mode === 'cancel') controller.abort();
  const result = await pending; events.push({ event: 'returned' });
  assert.equal(events[0].event, 'exit'); assert.equal(instance.threadId, -1);
  assert.equal(result.status, mode === 'success' ? 'ok' : mode === 'error' ? 'failed' : mode === 'cancel' ? 'cancelled' : 'timeout');
  if (mode !== 'success') { assert.equal(result.facts.workerTerminated, true); assert.equal(result.facts.workerExitCode, events[0].code); }
  if (mode === 'error') assert.equal(result.detail, 'FIXED_DECODER_CRASH');
  report.cases.push({ mode, passed: true, events, result }); persist();
});
test('finite missing-exit fixture rejects after the explicit bound even if terminate resolves', async () => {
  const timers = [];
  class MissingExit extends EventEmitter { terminate() { return Promise.resolve(1); } }
  const clock = { setTimeout(fn, ms) { const timer = { fn, ms, unref() {} }; timers.push(timer); return timer; }, clearTimeout(timer) { timer.cleared = true; } };
  const controller = new AbortController(); const pending = runner(MissingExit, clock)(request, { signal: controller.signal });
  controller.abort(); let returned = false; void pending.then(() => { returned = true; }, () => {});
  await Promise.resolve(); assert.equal(returned, false);
  const bound = timers.find(x => x.ms === 5000); assert.ok(bound); bound.fn();
  await assert.rejects(pending, /ASSET_PREVIEW_WORKER_STOP_TIMEOUT/);
  report.cases.push({ mode: 'finite-missing-exit', passed: true, stopBoundMs: bound.ms }); persist();
});
const identity = { jobId: 'fixture-preview', assetId: 'exit-pixel', version: 1, path: 'pixel.png', settingsHash: 'fixture', engineVersion: 'fixed', attempt: 1, claimId: 'claim' };
function hostFixture(runPreview) {
  const file = path.join(out, 'pixel.png'); fs.writeFileSync(file, bytes);
  return createAssetPreviewHost({ runPreview, resolveBody: async () => ({ blobPath: file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), mediaType: 'image/png' }) });
}
test('host cancel and dispose wait for the active worker promise rather than only signalling abort', async () => {
  let start, finish, aborted = false;
  const started = new Promise(resolve => { start = resolve; });
  const host = hostFixture((_, { signal }) => new Promise(resolve => { finish = resolve; signal.addEventListener('abort', () => { aborted = true; }); start(); }));
  const preview = host.preview(identity); await started;
  let returned = false; const cancelled = host.cancel({ jobId: identity.jobId }).then(x => { returned = true; return x; });
  let disposed = false; const disposing = host.dispose().then(() => { disposed = true; });
  await Promise.resolve(); assert.equal(aborted, true); assert.equal(returned, false); assert.equal(disposed, false);
  finish({ status: 'cancelled', facts: { workerTerminated: true } });
  await preview; assert.equal((await cancelled).cancelled, true); await disposing; assert.equal(disposed, true);
  report.cases.push({ mode: 'host-cancel-awaits-active-worker', passed: true }); persist();
});
test('host retains unconfirmed termination for dispose and refuses further workers', async () => {
  const host = hostFixture(async () => { throw Error('ASSET_PREVIEW_WORKER_STOP_TIMEOUT'); });
  await assert.rejects(host.preview(identity), /ASSET_PREVIEW_WORKER_STOP_TIMEOUT/);
  assert.throws(() => host.preview({ ...identity, jobId: 'next' }), /ASSET_PREVIEW_WORKER_STOP_TIMEOUT/);
  await assert.rejects(host.dispose(), /ASSET_PREVIEW_WORKER_STOP_TIMEOUT/);
  report.cases.push({ mode: 'host-stop-failure-latched', passed: true }); persist();
});
test.after(() => { report.passed = report.cases.length === 7; persist(); console.log(JSON.stringify({ out, passed: report.passed, cases: report.cases.length })); });
