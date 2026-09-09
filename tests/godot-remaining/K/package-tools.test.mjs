// Package staging and pinning behaviour for desktop/windows-package-tools.mjs.
//
// These cases build synthetic packages in a scratch directory. They prove the tool
// refuses to report an incomplete directory as a package, that pinning is read-only,
// and that the required-file list has exactly one source of truth.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {PACKAGE_REQUIRED_FILES} from '../../../desktop/delivery/lib/preflight-core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const TOOL = path.join(ROOT, 'desktop/windows-package-tools.mjs');

const run = args => {
  try {
    const stdout = execFileSync(process.execPath, [TOOL, ...args], {cwd: ROOT, encoding: 'utf8', windowsHide: true});
    return {status: 0, stdout, stderr: ''};
  } catch (error) {
    return {status: error.status ?? 1, stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? '')};
  }
};

function scratch(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'k-pkg-' + name + '-'));
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, content);
}

function completePackage(directory) {
  for (const relative of PACKAGE_REQUIRED_FILES) writeFile(path.join(directory, relative), 'bytes of ' + relative);
}

test('the required-file list is shared with the delivery preflight', () => {
  assert.equal(new Set(PACKAGE_REQUIRED_FILES).size, PACKAGE_REQUIRED_FILES.length);
  assert.ok(PACKAGE_REQUIRED_FILES.includes('resources/licenses/gpl/GPL-3.0.txt'));
  assert.ok(PACKAGE_REQUIRED_FILES.includes('Craftmine World.exe'));
  assert.ok(PACKAGE_REQUIRED_FILES.includes('resources/source/build-manifest.json'));
  assert.ok(PACKAGE_REQUIRED_FILES.includes('resources/source/USER_GUIDE.zh-CN.md'));
  assert.ok(PACKAGE_REQUIRED_FILES.includes('resources/git/bin/git.exe'));
  const source = fs.readFileSync(path.join(ROOT, 'desktop/windows-package-tools.mjs'), 'utf8');
  assert.match(source, /PACKAGE_REQUIRED_FILES\s*\}?\s*=\s*await import/);
  const core = fs.readFileSync(path.join(ROOT, 'desktop/delivery/lib/preflight-core.mjs'), 'utf8');
  assert.match(core, /export const PACKAGE_REQUIRED_FILES/);
  assert.match(core, /const required = PACKAGE_REQUIRED_FILES;/);
});

test('staging an incomplete directory fails and records every missing required file', () => {
  const directory = scratch('stage');
  try {
    writeFile(path.join(directory, 'in/Craftmine World.exe'), 'fake');
    const result = run(['stage', '--from', path.join(directory, 'in'), '--out', path.join(directory, 'out')]);
    assert.equal(result.status, 1, 'an incomplete package must not exit zero');
    const report = JSON.parse(result.stdout.trim().split('\n').at(-1));
    assert.equal(report.missingRequired.length, PACKAGE_REQUIRED_FILES.length - 1);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'out/resources/source/package-manifest.json'), 'utf8'));
    assert.equal(manifest.format, 'craftmine.package-manifest/1');
    assert.equal(manifest.verification.verified, false);
    assert.match(manifest.verification.note, /preflight|release-manifest/);
    assert.ok(fs.existsSync(path.join(directory, 'out/SHA256SUMS.txt')));
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

test('staging refuses a non-empty output directory unless forced', () => {
  const directory = scratch('force');
  try {
    writeFile(path.join(directory, 'in/Craftmine World.exe'), 'fake');
    writeFile(path.join(directory, 'out/keep.txt'), 'existing');
    const refused = run(['stage', '--from', path.join(directory, 'in'), '--out', path.join(directory, 'out')]);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /STAGE_OUTPUT_NOT_EMPTY/);
    assert.ok(fs.existsSync(path.join(directory, 'out/keep.txt')), 'the existing directory must be untouched');
    const forced = run(['stage', '--from', path.join(directory, 'in'), '--out', path.join(directory, 'out'), '--force']);
    assert.equal(forced.status, 1, 'still incomplete after forcing');
    assert.equal(fs.existsSync(path.join(directory, 'out/keep.txt')), false);
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

test('pinning a complete synthetic package passes and a missing file fails', () => {
  const directory = scratch('pin');
  try {
    const full = path.join(directory, 'full');
    completePackage(full);
    const pinned = run(['pin', '--package', full, '--out', path.join(directory, 'pin.json')]);
    assert.equal(pinned.status, 0, pinned.stderr);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'pin.json'), 'utf8'));
    assert.equal(manifest.package.fileCount, PACKAGE_REQUIRED_FILES.length);
    assert.deepEqual(manifest.missingRequired, []);
    assert.ok(manifest.package.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256)));

    const partial = path.join(directory, 'partial');
    completePackage(partial);
    fs.rmSync(path.join(partial, 'resources/app.asar'));
    const failed = run(['pin', '--package', partial, '--out', path.join(directory, 'partial.json')]);
    assert.equal(failed.status, 1);
    const partialManifest = JSON.parse(fs.readFileSync(path.join(directory, 'partial.json'), 'utf8'));
    assert.deepEqual(partialManifest.missingRequired, ['resources/app.asar']);
    const allowed = run(['pin', '--package', partial, '--out', path.join(directory, 'allowed.json'), '--allow-missing']);
    assert.equal(allowed.status, 0);
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

test('diff reports added, removed and changed files', () => {
  const directory = scratch('diff');
  try {
    const first = path.join(directory, 'a'), second = path.join(directory, 'b');
    writeFile(path.join(first, 'keep.txt'), 'same');
    writeFile(path.join(first, 'change.txt'), 'before');
    writeFile(path.join(first, 'remove.txt'), 'gone');
    writeFile(path.join(second, 'keep.txt'), 'same');
    writeFile(path.join(second, 'change.txt'), 'after');
    writeFile(path.join(second, 'add.txt'), 'new');
    const a = run(['pin', '--package', first, '--out', path.join(directory, 'a.json'), '--allow-missing']);
    const b = run(['pin', '--package', second, '--out', path.join(directory, 'b.json'), '--allow-missing']);
    assert.equal(a.status, 0);
    assert.equal(b.status, 0);
    const diff = run(['diff', '--a', path.join(directory, 'a.json'), '--b', path.join(directory, 'b.json')]);
    assert.equal(diff.status, 0);
    const report = JSON.parse(diff.stdout);
    assert.deepEqual(report.added, ['add.txt']);
    assert.deepEqual(report.removed, ['remove.txt']);
    assert.deepEqual(report.changed.map(item => item.path), ['change.txt']);
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

test('a symbolic link inside a package is refused', t => {
  const directory = scratch('link');
  try {
    const source = path.join(directory, 'package');
    writeFile(path.join(source, 'real.txt'), 'real');
    try {
      fs.symlinkSync(path.join(source, 'real.txt'), path.join(source, 'link.txt'));
    } catch {
      t.skip('symbolic links are not permitted for this user');
      return;
    }
    const result = run(['pin', '--package', source, '--out', path.join(directory, 'pin.json')]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /PACKAGE_LINK_DENIED/);
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});
