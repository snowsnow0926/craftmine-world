// Round-two R9 checks: content boundaries, the pinned Git bundle and the product RPC suite.
//
// Synthetic fixtures only; nothing here launches a window, sends input or touches the
// user profile. The real package checks live in the evidence directory.
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const CHECKER = path.join(ROOT, 'desktop/delivery/content-boundary-check.mjs');
const GIT_TOOL = path.join(ROOT, 'desktop/delivery/tools/git-bundle.mjs');
const MEASURE = path.join(ROOT, 'desktop/delivery/measure.mjs');

const run = (file, args) => {
  try {
    return {status: 0, stdout: execFileSync(process.execPath, [file, ...args], {cwd: ROOT, encoding: 'utf8', windowsHide: true})};
  } catch (error) {
    return {status: error.status ?? 1, stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? '')};
  }
};

test('the boundary declaration covers all four artefacts and keeps the standalone game pending', () => {
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop/delivery/content-boundaries.json'), 'utf8'));
  assert.deepEqual(Object.keys(spec.boundaries).sort(), ['client', 'portable-backup', 'share-package', 'standalone-game']);
  assert.equal(spec.boundaries['standalone-game'].status, 'pending');
  for (const id of ['client', 'share-package', 'portable-backup']) {
    assert.equal(spec.boundaries[id].status, 'verified', id + ' should be verified as a declaration');
    assert.ok(spec.boundaries[id].mustNotContain.length, id + ' must declare what cannot cross it');
  }
});

test('a clean synthetic client directory passes and a credential file fails', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'r9-boundary-'));
  try {
    for (const notice of ['resources/licenses/PI-Desktop-LICENSE.txt', 'resources/licenses/CRAFTMINE-NOTICES.md', 'resources/licenses/UPSTREAM.json', 'resources/git/LICENSE.txt', 'resources/git/GIT-BUNDLE.json']) {
      fs.mkdirSync(path.dirname(path.join(directory, notice)), {recursive: true});
      fs.writeFileSync(path.join(directory, notice), 'text');
    }
    const clean = run(CHECKER, ['--boundary', 'client', '--path', directory]);
    assert.equal(clean.status, 0, clean.stdout + (clean.stderr ?? ''));
    fs.writeFileSync(path.join(directory, 'resources/credentials.json'), '{}');
    const dirty = run(CHECKER, ['--boundary', 'client', '--path', directory]);
    assert.equal(dirty.status, 1);
    assert.match(dirty.stdout, /FORBIDDEN_PATH/);
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

test('the standalone-game boundary exits 3 even when its notices are present', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'r9-export-'));
  try {
    for (const notice of ['licenses/GODOT_LICENSE.txt', 'licenses/GODOT_COPYRIGHT.txt', 'licenses/EXPORT-NOTICES.md']) {
      fs.mkdirSync(path.dirname(path.join(directory, notice)), {recursive: true});
      fs.writeFileSync(path.join(directory, notice), 'text');
    }
    const result = run(CHECKER, ['--boundary', 'standalone-game', '--path', directory]);
    assert.equal(result.status, 3, result.stdout);
    assert.match(result.stdout, /NOT A PASS/);
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

test('the Git pin is complete and a wrong archive is refused', () => {
  const pin = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop/delivery/git-bundle.json'), 'utf8'));
  assert.equal(pin.id, 'mingit');
  assert.match(pin.archive.sha256, /^[a-f0-9]{64}$/);
  assert.match(pin.archive.url, /^https:\/\/github\.com\/git-for-windows\/git\/releases\//);
  assert.deepEqual(pin.contract.minimum, [2, 38]);
  assert.equal(pin.layout.entry, 'bin/git.exe');
  assert.ok(pin.layout.r1Candidates.some(candidate => candidate.includes('CRAFTMINE_BUNDLED_GIT')));

  const bogus = path.join(os.tmpdir(), 'r9-bogus-' + Date.now() + '.zip');
  fs.writeFileSync(bogus, 'not a zip');
  try {
    const result = run(GIT_TOOL, ['verify', '--zip', bogus]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /ARCHIVE_BYTES|ARCHIVE_HASH/);
  } finally {
    fs.rmSync(bogus, {force: true});
  }
});

test('the product suite reports skipped metrics when no core is supplied and never passes them', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'r9-product-'));
  try {
    const out = path.join(directory, 'evidence.json');
    const result = spawnSync(process.execPath, [MEASURE, 'product', '--core', path.join(directory, 'absent.exe'), '--package', directory, '--out', out], {
      cwd: ROOT, encoding: 'utf8', windowsHide: true, env: {...process.env, PI_SCRATCH_DIR: directory}
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const record = JSON.parse(fs.readFileSync(out, 'utf8'));
    const suite = record.suites.find(item => item.id === 'product');
    assert.equal(suite.metrics.length, 0);
    assert.deepEqual(suite.skipped.map(item => item.metric).sort(), ['product.assetSearch.ms', 'product.gitInfo.ms', 'product.hello.ms']);
    assert.ok(suite.skipped.every(item => item.howToEnable.includes('--core')));
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

test('every product metric named by the suite has a threshold entry', () => {
  const thresholds = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop/delivery/MEASUREMENT_THRESHOLDS.json'), 'utf8'));
  for (const name of ['product.hello.ms', 'product.gitInfo.ms', 'product.assetSearch.ms']) {
    assert.ok(thresholds.metrics[name], name + ' has no threshold entry');
    assert.equal(thresholds.metrics[name].status, 'pending-real-sample');
  }
  assert.ok(thresholds.metrics['size.resources.git.mb'], 'the Git size bucket needs a threshold');
  assert.equal(thresholds.metrics['size.fileCount'].changeLog[0].to, 1400);
});
