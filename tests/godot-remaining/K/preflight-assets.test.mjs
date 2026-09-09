// Real-tree and synthetic checks for the shipped-base provenance manifests.
//
// The real-tree case is the regression that task K had to fix: the preflight used to
// report three byte drifts, two undeclared files and three missing base manifests.
// It runs read-only against this worktree. The synthetic case proves the drafting
// tool refuses to invent a manifest for a tree that has none.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkBaseAssets} from '../../../desktop/delivery/lib/preflight-core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const TOOL = path.join(ROOT, 'desktop/delivery/tools/draft-base-manifest.mjs');
const BASES = ['first-person', 'side-view', 'top-down'];

test('the real worktree passes the base asset provenance check', () => {
  const result = checkBaseAssets(ROOT);
  assert.deepEqual(result.failures, []);
  assert.equal(result.ok, true);
});

test('every shipped base directory has exactly one provenance manifest', () => {
  for (const baseId of BASES) {
    const manifestPath = path.join(ROOT, 'desktop/delivery/base-assets', 'bases-' + baseId + '.json');
    assert.ok(fs.existsSync(manifestPath), 'missing manifest for ' + baseId);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.format, 'craftmine.base-assets/1');
    assert.equal(manifest.sourceDirectory, 'desktop/godot/bases/' + baseId);
    assert.equal(manifest.provenanceScope, 'shipped-base-directory');
    assert.equal(manifest.rightsStatus, 'pending-formal-application');
    assert.ok(fs.existsSync(path.join(ROOT, manifest.rightsDocument)), manifest.rightsDocument);
  }
});

test('each manifest declares every file and every declaration resolves', () => {
  for (const baseId of BASES) {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop/delivery/base-assets', 'bases-' + baseId + '.json'), 'utf8'));
    const directory = path.join(ROOT, manifest.sourceDirectory);
    const walk = (current, prefix = '') => fs.readdirSync(current).sort().flatMap(name => {
      const target = path.join(current, name);
      const relative = (prefix ? prefix + '/' : '') + name;
      return fs.lstatSync(target).isDirectory() ? walk(target, relative) : [relative];
    });
    const actual = walk(directory);
    const declared = manifest.entries.map(entry => entry.path);
    assert.deepEqual([...declared].sort(), actual, baseId + ' declarations differ from the tree');
    for (const entry of manifest.entries) {
      assert.ok(entry.license, entry.path + ' has no licence');
      assert.ok(entry.redistribution, entry.path + ' has no redistribution');
      assert.ok(entry.distribution.length, entry.path + ' has no distribution');
      assert.equal(typeof entry.bytes, 'number');
      assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    }
  }
});

test('the drafting tool reports no drift for the committed manifests', () => {
  const output = execFileSync(process.execPath, [TOOL, '--check'], {cwd: ROOT, encoding: 'utf8', windowsHide: true});
  assert.match(output, /NO DRIFT/);
});

test('the drafting tool never blesses bytes: a tree without a manifest is drift', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'k-base-draft-'));
  try {
    const base = path.join(directory, 'desktop/godot/bases/first-person');
    fs.mkdirSync(base, {recursive: true});
    fs.writeFileSync(path.join(base, 'base_manifest.json'), JSON.stringify({baseId: 'first-person', baseVersion: '0.1.0', engine: {version: '4.7.2-stable'}}));
    fs.writeFileSync(path.join(base, 'world.gd'), 'extends Node\n');
    let failed = false;
    try {
      execFileSync(process.execPath, [TOOL, '--check', '--base', 'first-person', '--root', directory], {encoding: 'utf8', windowsHide: true});
    } catch (error) {
      failed = true;
      assert.equal(error.status, 1);
      assert.match(String(error.stdout), /MANIFEST_ABSENT/);
    }
    assert.equal(failed, true, 'a missing manifest must be reported, not created');
    assert.equal(fs.existsSync(path.join(directory, 'desktop/delivery/base-assets')), false, 'the tool must not write manifests during --check');
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

test('bridge and host runtime byte pins match the shipped files', async () => {
  const {sha256} = await import('../../../desktop/delivery/lib/preflight-core.mjs');
  const shared = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop/delivery/base-assets/shared-web.json'), 'utf8'));
  for (const name of ['bridge.js', 'runtime.mjs', 'runtime.d.mts']) {
    const entry = shared.entries.find(candidate => candidate.path === name);
    assert.ok(entry, name + ' is not declared');
    const file = path.join(ROOT, 'desktop/godot/web', name);
    assert.equal(entry.bytes, fs.statSync(file).size);
    assert.equal(entry.sha256, sha256(file));
  }
});
