// S1 round-three: prove the formally registered core RPC surface.
//
// This spawns the *built* craftmine-core binary over its real stdio JSON
// protocol in an isolated data directory. No window, no input, no audio.
//
// It exists because "the handler compiles" and "a module unit test passed" do
// not prove the product entry: before this commit asset.*, package.*,
// backup.*Portable and legacy.convert were implemented but unreachable from
// main.rs, so every consumer got UNKNOWN_METHOD.
//
// Checks:
//   1. hello advertises the newly wired capabilities.
//   2. An unknown method still answers UNKNOWN_METHOD (control).
//   3. Every registered method reaches a real handler: the error code is a
//      domain validation code, never UNKNOWN_METHOD.
//   4. Three handlers answer a real positive result with no fixture.
//
// Usage: node tests/godot-round3/S1/core-rpc-registration.mjs
// Env:   CRAFTMINE_CORE_BIN overrides the binary path.
// Exit:  0 all checks passed, 1 a check failed, 3 the binary is missing.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const binary =
  process.env.CRAFTMINE_CORE_BIN ??
  path.join(root, 'vendor', 'pi-desktop', 'target', 'debug', process.platform === 'win32' ? 'craftmine-core.exe' : 'craftmine-core');

if (!fs.existsSync(binary)) {
  console.error(`CORE_BINARY_MISSING: ${binary}\nBuild it with: cargo build --manifest-path vendor/pi-desktop/Cargo.toml -p craftmine-core`);
  process.exit(3);
}

// Every method this commit registers in main.rs. `assets` are also covered
// end-to-end by tests/godot-round2/R6/core-rpc-smoke.mjs; the list here is the
// registration contract itself.
const REGISTERED = {
  'asset.': [
    'asset.import', 'asset.read', 'asset.versions', 'asset.bodyPath', 'asset.search',
    'asset.scan', 'asset.annotate', 'asset.recordUsage', 'asset.usage',
    'asset.previewBegin', 'asset.previewFinish', 'asset.previewRead', 'asset.probe',
    'asset.recordCheck', 'asset.mapLegacy', 'asset.resolveLegacy',
  ],
  'package.': [
    'package.formatCheck', 'package.planInstall', 'package.register', 'package.check',
    'package.install', 'package.list', 'package.read', 'package.progress',
    'package.grant', 'package.upgrade', 'package.uninstall', 'package.restore',
    'package.export', 'package.import', 'package.usage',
  ],
  'backup.': [
    'backup.exportPortable', 'backup.inspectPortable', 'backup.verifyPortable',
    'backup.restorePortable', 'backup.protectedRefs', 'backup.releasePortable',
    'backup.export-full', 'backup.verify', 'backup.restore-full', 'backup.contentUsage',
  ],
  'legacy.': ['legacy.convert'],
};
const METHODS = Object.values(REGISTERED).flat();

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 's1-rpc-registration-'));
const child = spawn(binary, ['--data-dir', dataDir], { stdio: ['pipe', 'pipe', 'pipe'] });

let buffer = '';
let nextId = 1;
const pending = new Map();
let stderr = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', text => { stderr += text; });
child.stdout.setEncoding('utf8');
child.stdout.on('data', text => {
  buffer += text;
  let index = buffer.indexOf('\n');
  while (index >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    index = buffer.indexOf('\n');
    if (!line.trim()) continue;
    let response;
    try {
      response = JSON.parse(line);
    } catch (error) {
      for (const job of pending.values()) job.reject(new Error(`INVALID_RESPONSE: ${line.slice(0, 200)}`));
      pending.clear();
      continue;
    }
    const job = pending.get(response.id);
    if (!job) continue;
    pending.delete(response.id);
    if (response.error) job.reject(Object.assign(new Error(response.error.message ?? response.error.code ?? 'CORE_ERROR'), response.error));
    else job.resolve(response.result);
  }
});

function call(method, params = {}) {
  const id = nextId++;
  const payload = JSON.stringify({ id, method, params });
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(`${payload}\n`, error => { if (error) reject(error); });
  });
}

const results = [];
let failed = 0;
function check(name, condition, detail = '') {
  results.push({ name, passed: Boolean(condition), detail });
  if (!condition) failed += 1;
}

async function codeOf(method, params) {
  try {
    await call(method, params);
    return 'OK';
  } catch (error) {
    return error.code ?? 'NO_CODE';
  }
}

try {
  const hello = await call('hello');
  for (const capability of ['assetCatalog', 'assetPreview', 'creationPackages', 'portableBackup', 'contentHistory']) {
    check(`hello.${capability}`, hello[capability] === true, JSON.stringify(hello[capability]));
  }
  check('hello.format', hello.format === 'craftmine.core/1', String(hello.format));

  const unknown = await codeOf('asset.definitelyNotAMethod');
  check('unknown method stays UNKNOWN_METHOD', unknown === 'UNKNOWN_METHOD', unknown);

  for (const method of METHODS) {
    const code = await codeOf(method, {});
    check(
      `${method} is registered`,
      code !== 'UNKNOWN_METHOD' && code !== 'METHOD_REQUIRED' && code !== 'NO_CODE',
      code,
    );
  }

  // Positive paths that need no fixture: a registered handler must return a
  // real result, not just a validation error.
  const formatCheck = await call('package.formatCheck', { text: '{"b":1,"a":2}' });
  check(
    'package.formatCheck canonicalizes text',
    typeof formatCheck.contentHash === 'string' && /^[a-f0-9]{64}$/.test(formatCheck.contentHash) && formatCheck.canonical === '{"a":2,"b":1}',
    JSON.stringify(formatCheck),
  );

  const protectedRefs = await call('backup.protectedRefs', { worldId: null });
  check(
    'backup.protectedRefs answers an empty pin set',
    Array.isArray(protectedRefs.builds) && protectedRefs.builds.length === 0 && Array.isArray(protectedRefs.assetBlobs),
    JSON.stringify(protectedRefs),
  );

  const usage = await call('backup.contentUsage', {});
  check('backup.contentUsage answers a usage report', usage && typeof usage === 'object' && !Array.isArray(usage), JSON.stringify(usage));

  // The apply confirmation no longer accepts a caller-supplied object id.
  const selfAttested = await codeOf('content.apply.confirm', {
    operationId: 'op-1', appliedOid: 'a'.repeat(40), detail: 'host committed deployment',
  });
  check('content.apply.confirm rejects the self-attested shape', selfAttested !== 'OK' && selfAttested !== 'UNKNOWN_METHOD', selfAttested);
  const noOperation = await codeOf('content.apply.confirm', { operationId: 'op-1', applicationId: 'application-1', detail: 'x' });
  check('content.apply.confirm requires a durable operation', noOperation === 'CONTENT_OPERATION_NOT_FOUND', noOperation);
} catch (error) {
  check('harness completed', false, String(error?.message ?? error));
} finally {
  child.stdin.end();
  await new Promise(resolve => child.once('close', resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
}

for (const result of results) {
  console.log(`[${result.passed ? 'pass' : 'fail'}] ${result.name}${result.detail ? ` -> ${result.detail}` : ''}`);
}
if (stderr.trim()) console.log(`[core stderr] ${stderr.trim()}`);
console.log(`\nSUMMARY: ${results.length - failed} passed, ${failed} failed, ${results.length} checks`);
process.exit(failed === 0 ? 0 : 1);
