// Containment rules for the P8 evidence sink.
//
// The first group classifies pure paths. The last test drives the real pre-flight
// against a synthetic release tree under the session scratch directory and proves
// a refused run creates nothing and never writes inside the release. No real
// release, client, engine, model or user profile is involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {classifyContainment} from './package-preflight.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const driver = path.join(here, 'package-preflight.mjs');
const isWindows = process.platform === 'win32';
const root = path.parse(process.cwd()).root;
const release = path.resolve(root, 'cm-p8-fixture', 'releases', '2453f9cf2440-63d83089-7310-4ca0-9747-48b7e4e80bc7');
const parent = path.dirname(release);
const ancestor = path.dirname(parent);

test('the release itself and every directory inside it are unsafe', () => {
  assert.equal(classifyContainment(release, release), 'equal');
  assert.equal(classifyContainment(release, release + path.sep), 'equal');
  assert.equal(classifyContainment(release, path.join(release, 'evidence')), 'inside');
  assert.equal(classifyContainment(release, path.join(release, 'output')), 'inside');
  assert.equal(classifyContainment(release, path.join(release, 'output', 'win-unpacked')), 'inside');
  assert.equal(classifyContainment(release, path.join(release, 'output', 'win-unpacked', 'evidence')), 'inside');
});

test('siblings, ancestors and unrelated trees stay allowed', () => {
  assert.equal(classifyContainment(release, parent), 'outside');
  assert.equal(classifyContainment(release, ancestor), 'outside');
  assert.equal(classifyContainment(release, path.join(parent, 'other-release')), 'outside');
  assert.equal(classifyContainment(release, path.join(ancestor, 'evidence')), 'outside');
  assert.equal(classifyContainment(release, path.join(parent, '..', 'evidence')), 'outside');
  assert.equal(classifyContainment(release, path.resolve(release, '..', '..', 'outside')), 'outside');
});

test('a prefix-similar sibling is not mistaken for a descendant', () => {
  // The old string-prefix test answered wrongly in both directions: it accepted
  // every descendant asserted above and rejected these legitimate siblings.
  assert.equal(classifyContainment(release, `${release}-evidence`), 'outside');
  assert.equal(classifyContainment(release, path.join(`${release}-old`, 'evidence')), 'outside');
  assert.equal(classifyContainment(release, path.join(parent, `${path.basename(release)}-extra`)), 'outside');
  assert.equal(path.join(release, 'evidence').startsWith(release), true);
});
  assert.equal(classifyContainment(release.toUpperCase(), path.join(release, 'output', 'win-unpacked')), 'inside');
test('another drive is outside', {skip: !isWindows}, () => {
  assert.equal(classifyContainment(release, 'C:\\cm-p8-evidence'), 'outside');
  assert.equal(classifyContainment('C:\\cm-p8-release', release), 'outside');
});

test('Windows path comparison folds case', {skip: !isWindows}, () => {
  assert.equal(classifyContainment(release.toUpperCase(), release), 'equal');
  assert.equal(classifyContainment(release.toUpperCase(), path.join(release, 'output,evidence'.replace(',', path.sep))), 'inside');
  assert.equal(classifyContainment(release, parent.toUpperCase()), 'outside');
  assert.equal(classifyContainment(release, `${release}-EVIDENCE`.toUpperCase()), 'outside');
});

test('a synthetic release is refused before anything is created', () => {
  const scratch = fs.mkdtempSync(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'p8-preflight-containment-'));
  const fakeRelease = path.join(scratch, 'release');
  fs.mkdirSync(fakeRelease);
  fs.writeFileSync(path.join(fakeRelease, 'frozen.keep'), 'untouched');
  const inside = path.join(fakeRelease, 'evidence');
  const sibling = path.join(scratch, 'release-evidence');
  const before = fs.readdirSync(scratch).sort();
  const run = outputParent => spawnSync(
    process.execPath,
    [driver, '--source-root', scratch, '--deps-app', scratch, '--release-root', fakeRelease, '--output-parent', outputParent],
    {encoding: 'utf8', windowsHide: true},
  );

  // Inside the release: refused by the containment guard, which runs before any
  // filesystem work, so the sink directory never appears and the release stands.
  const refused = run(inside);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /PREFLIGHT_OUTPUT_INSIDE_RELEASE/);
  assert.equal(fs.existsSync(inside), false);
  assert.deepEqual(fs.readdirSync(scratch).sort(), before);
  assert.equal(fs.readFileSync(path.join(fakeRelease, 'frozen.keep'), 'utf8'), 'untouched');

  // The release directory itself is equally refused.
  const refusedRoot = run(fakeRelease);
  assert.equal(refusedRoot.status, 1);
  assert.match(refusedRoot.stderr, /PREFLIGHT_OUTPUT_INSIDE_RELEASE/);
  assert.deepEqual(fs.readdirSync(fakeRelease).sort(), ['frozen.keep']);

  // A prefix-similar sibling passes the containment gate. This fixture has no run
  // record, so the next gate refuses it, which proves containment was not the
  // reason and that the sink is still created only after the record is accepted.
  const control = run(sibling);
  assert.equal(control.status, 1);
  assert.doesNotMatch(control.stderr, /PREFLIGHT_OUTPUT_INSIDE_RELEASE/);
  assert.match(control.stderr, /PREFLIGHT_RELEASE_RECORD_MISSING/);
  assert.equal(fs.existsSync(sibling), false);
  assert.deepEqual(fs.readdirSync(scratch).sort(), before);

  fs.rmSync(scratch, {recursive: true, force: true});
});
