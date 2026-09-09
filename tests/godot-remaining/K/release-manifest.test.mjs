// Release manifest + package verification tests.
//
// Everything runs against synthetic trees under PI_SCRATCH_DIR. No real package,
// no network, no GUI, no input, no browser test entry point.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {PACKAGE_REQUIRED_FILES} from '../../../desktop/delivery/lib/preflight-core.mjs';
import {
  BASE_IDS,
  BRIDGE_FILES,
  PACKAGE_ARTIFACT_MAP,
  RELEASE_MANIFEST_FORMAT,
  REQUIRED_PACKAGE_FILES,
  createReleaseManifest,
  diffManifests,
  hashFile,
  listComponents,
  verifyPackage
} from '../../../desktop/delivery/lib/release-manifest-core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PREFLIGHT_CORE = path.resolve(HERE, '../../../desktop/delivery/lib/preflight-core.mjs');
const SCRATCH = process.env.PI_SCRATCH_DIR ?? os.tmpdir();

const syntheticLock = () => ({
  format: 'craftmine.godot-toolchain/1',
  version: '4.7.2-stable',
  releaseUrl: 'https://example.invalid/godot/release',
  platform: 'windows-x86_64',
  editor: {
    file: 'Godot_v4.7.2-stable_win64.exe.zip',
    url: 'https://example.invalid/godot/editor.zip',
    bytes: 11,
    sha256: '1'.repeat(64),
    executable: 'Godot_v4.7.2-stable_win64.exe',
    executableSha256: '2'.repeat(64)
  },
  exportTemplates: {
    file: 'Godot_v4.7.2-stable_export_templates.tpz',
    url: 'https://example.invalid/godot/templates.tpz',
    bytes: 22,
    sha256: '3'.repeat(64),
    webRelease: {file: 'web_nothreads_release.zip', bytes: 33, sha256: '4'.repeat(64)},
    webThreadedRelease: {file: 'web_release.zip', bytes: 44, sha256: '5'.repeat(64)}
  },
  licenses: []
});

function write(file, content) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, content);
  return file;
}

function tempDirectory(prefix) {
  return fs.mkdtempSync(path.join(SCRATCH, prefix));
}

function buildRoot() {
  const root = tempDirectory('k-release-root-');
  write(path.join(root, 'package.json'), JSON.stringify({name: 'synthetic-craftmine', version: '9.9.9'}, null, 2) + '\n');
  write(path.join(root, 'desktop/godot/toolchain.lock.json'), JSON.stringify(syntheticLock(), null, 2) + '\n');
  write(path.join(root, 'desktop/godot/licenses/GODOT_LICENSE.txt'), 'synthetic godot license text\n');
  write(path.join(root, 'desktop/godot/licenses/GODOT_COPYRIGHT.txt'), 'synthetic godot copyright text\n');
  write(path.join(root, 'desktop/godot/licenses/notices.manifest.json'),
    JSON.stringify({format: 'craftmine.notices/1', entries: []}, null, 2) + '\n');
  write(path.join(root, 'desktop/UPSTREAM.json'),
    JSON.stringify({format: 'craftmine.upstream/1', commit: 'a'.repeat(40), license: 'LGPL-3.0-or-later'}, null, 2) + '\n');
  write(path.join(root, 'desktop/windows-NOTICES.md'), '# synthetic notices\n');
  write(path.join(root, 'desktop/windows-USER_GUIDE.zh-CN.md'), '# synthetic guide\n');
  write(path.join(root, 'desktop/windows-upgrade-guard.ps1'), 'Write-Output "synthetic"\n');
  write(path.join(root, 'vendor/pi-desktop/LICENSE'), 'synthetic LGPL text\n');
  write(path.join(root, 'vendor/pi-desktop/pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  write(path.join(root, 'vendor/pi-desktop/Cargo.lock'), '# synthetic cargo lock\n');
  write(path.join(root, 'vendor/pi-desktop/target/release/pi-desktop-host-core.exe'), 'synthetic host binary\n');
  write(path.join(root, 'vendor/pi-desktop/target/release/craftmine-core.exe'), 'synthetic core binary\n');
  // Independent shipped requirement: do not make fixture coverage follow a
  // production allowlist that could accidentally drop the fourth base again.
  for (const [index, baseId] of ['first-person', 'side-view', 'top-down', 'mining-sandbox'].entries()) {
    const directory = path.join(root, 'desktop/godot/bases', baseId);
    const manifestName = baseId === 'first-person' ? 'base_manifest.json' : 'manifest.json';
    write(path.join(directory, manifestName), JSON.stringify({
      format: 'craftmine.godot-base/1',
      baseId,
      baseVersion: '1.0.' + index,
      engine: {name: 'godot', version: '4.7.2-stable', renderer: 'gl_compatibility'},
      godotVersion: '4.7.2-stable'
    }, null, 2) + '\n');
    write(path.join(directory, 'scripts/main.gd'), 'extends Node\n# ' + baseId + '\n');
  }
  for (const baseId of ['first-person', 'top-down']) {
    write(path.join(root, 'desktop/delivery/base-assets', baseId + '.json'), JSON.stringify({
      format: 'craftmine.base-assets/1',
      baseId,
      sourceDirectory: 'desktop/godot/bases/' + baseId,
      engine: {version: '4.7.2-stable'}
    }, null, 2) + '\n');
  }
  for (const relative of BRIDGE_FILES) write(path.join(root, relative), '// synthetic ' + relative + '\n');
  return root;
}

function packagePaths(manifest) {
  const paths = new Set(REQUIRED_PACKAGE_FILES);
  for (const {component: entry} of listComponents(manifest)) {
    for (const file of entry.files ?? []) if (file?.packagePath) paths.add(file.packagePath);
  }
  return [...paths].sort();
}

/** Build a complete synthetic package from a root plus the package-path map. */
function buildPackage(root, {includeBuildManifest = true} = {}) {
  const preliminary = createReleaseManifest(root, {now: '2026-01-01T00:00:00.000Z'});
  const mapping = new Map();
  for (const {component: entry} of listComponents(preliminary)) {
    for (const file of entry.files ?? []) if (file?.packagePath) mapping.set(file.packagePath, file.path);
  }
  const directory = tempDirectory('k-release-package-');
  for (const relative of packagePaths(preliminary)) {
    if (!includeBuildManifest && relative === 'resources/source/build-manifest.json') continue;
    const source = mapping.get(relative);
    const content = source && fs.existsSync(path.join(root, source))
      ? fs.readFileSync(path.join(root, source))
      : Buffer.from('synthetic package payload for ' + relative + '\n');
    write(path.join(directory, relative), content);
  }
  if (includeBuildManifest) {
    const artifactRelative = 'vendor/pi-desktop/target/release/pi-desktop-host-core.exe';
    const packageRelative = PACKAGE_ARTIFACT_MAP.get(artifactRelative);
    const absolute = path.join(directory, packageRelative);
    const buildManifest = {
      format: 'craftmine.build/1',
      commit: 'b'.repeat(40),
      artifacts: [{
        path: artifactRelative,
        bytes: fs.statSync(absolute).size,
        sha256: hashFile(absolute)
      }]
    };
    write(path.join(directory, 'resources/source/build-manifest.json'),
      JSON.stringify(buildManifest, null, 2) + '\n');
  }
  return directory;
}

function createPinned(root, options = {}) {
  const directory = options.packageDirectory ?? buildPackage(root, options);
  return {
    directory,
    manifest: createReleaseManifest(root, {now: '2026-01-01T00:00:00.000Z', packageDirectory: directory})
  };
}

function componentFiles(manifest) {
  const out = [];
  for (const {key, component: entry} of listComponents(manifest)) {
    for (const file of entry.files ?? []) out.push({component: key, entry, file});
  }
  return out;
}

function independentSha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('create() pins real bytes for every component', () => {
  const root = buildRoot();
  const manifest = createReleaseManifest(root, {now: '2026-01-01T00:00:00.000Z'});
  assert.equal(manifest.format, RELEASE_MANIFEST_FORMAT);
  assert.equal(manifest.identity.clientVersion, '9.9.9');
  assert.equal(manifest.identity.commit, null);
  assert.equal(manifest.identity.dirty, null);

  const engineArchive = manifest.components.engine.files.find(file => file.role === 'editor-archive');
  assert.equal(engineArchive.sha256, '1'.repeat(64));
  assert.equal(engineArchive.bytes, 11);
  assert.equal(manifest.components.engine.files.find(file => file.role === 'editor-executable').sha256, '2'.repeat(64));

  const templates = manifest.components.exportTemplates.files;
  assert.equal(templates.length, 3);
  assert.equal(templates.find(file => file.role === 'export-templates-archive').sha256, '3'.repeat(64));
  assert.equal(templates.find(file => file.role === 'web-single-thread-template').path, 'templates/web_nothreads_release.zip');
  assert.equal(templates.find(file => file.role === 'web-threaded-template').sha256, '5'.repeat(64));

  const brokerFiles = manifest.components.broker.files;
  assert.equal(brokerFiles.length, 2);
  for (const file of brokerFiles) {
    assert.equal(file.sha256, independentSha256(path.join(root, file.path)));
    assert.equal(file.bytes, fs.statSync(path.join(root, file.path)).size);
  }

  assert.deepEqual(Object.keys(manifest.components.bases).sort(), ['first-person','mining-sandbox','side-view','top-down']);
  for (const baseId of ['first-person','side-view','top-down','mining-sandbox']) {
    const base = manifest.components.bases[baseId];
    assert.equal(base.baseId, baseId);
    assert.equal(base.engine.version, '4.7.2-stable');
    assert.equal(base.fileCount, base.files.length);
    assert.ok(base.files.length >= 2);
    assert.match(base.aggregateSha256, /^[a-f0-9]{64}$/);
    for (const file of base.files) {
      assert.equal(file.sha256, independentSha256(path.join(root, file.path)));
    }
  }
  assert.equal(manifest.components.bases['first-person'].provenance.present, true);
  assert.equal(manifest.components.bases['side-view'].provenance.present, false);
  assert.equal(manifest.components.bases['side-view'].provenance.status, 'absent');

  assert.equal(manifest.components.bridge.files.length, BRIDGE_FILES.length);
  const lockfiles = manifest.components.dependencies.files.map(file => file.path);
  assert.ok(lockfiles.includes('vendor/pi-desktop/pnpm-lock.yaml'));
  assert.ok(lockfiles.includes('vendor/pi-desktop/Cargo.lock'));
  for (const file of manifest.components.dependencies.files) {
    assert.equal(file.sha256, independentSha256(path.join(root, file.path)));
  }

  const licencePaths = manifest.components.licenses.files.map(file => file.path);
  assert.ok(licencePaths.includes('desktop/godot/licenses/GODOT_LICENSE.txt'));
  assert.ok(licencePaths.includes('desktop/UPSTREAM.json'));
  assert.ok(licencePaths.includes('desktop/windows-NOTICES.md'));
  assert.ok(licencePaths.includes('vendor/pi-desktop/LICENSE'));

  const uniquePaths = new Set(componentFiles(manifest).map(item => item.file.path));
  assert.equal(manifest.totals.files, uniquePaths.size);
  assert.ok(manifest.totals.bytes > 0);
  assert.ok(manifest.reproducibility.pinnedInputs.length >= 5);
  assert.ok(manifest.reproducibility.limits.length >= 3);
});

test('release inventory independently contains all four shipped bases and six declared mining components', () => {
  const expectedBases=['first-person','mining-sandbox','side-view','top-down'];
  const expectedComponents=['ms.crafting-station','ms.material','ms.ore-vein','ms.recipe','ms.spawn-point','ms.terrain-layer'];
  assert.deepEqual([...BASE_IDS].sort(),expectedBases);
  const repo=path.resolve(HERE,'../../..');
  const source=fs.readFileSync(path.join(repo,'desktop/godot/bases/mining-sandbox/manifest.json'));
  const catalog=JSON.parse(fs.readFileSync(path.join(repo,'desktop/godot/bases/component-catalog.json'),'utf8'));
  const mining=catalog.components.filter(entry=>entry.baseId==='mining-sandbox');
  assert.deepEqual(mining.map(entry=>entry.id).sort(),expectedComponents);
  assert.ok(mining.every(entry=>entry.install===null),'manual component boundary must not be promoted by inventory');
  const root=buildRoot();write(path.join(root,'desktop/godot/bases/mining-sandbox/manifest.json'),source);
  const release=createReleaseManifest(root,{now:'2026-01-01T00:00:00.000Z'});
  assert.deepEqual(Object.keys(release.components.bases).sort(),expectedBases);
  const base=release.components.bases['mining-sandbox'];
  assert.deepEqual(base.declaredComponentIds,expectedComponents);
  const file=base.files.find(entry=>entry.path==='desktop/godot/bases/mining-sandbox/manifest.json');
  assert.equal(file.sha256,createHash('sha256').update(source).digest('hex'));
  assert.equal(file.bytes,source.length);
});

test('create() pins a package snapshot only when --package is given', () => {
  const root = buildRoot();
  const withoutPackage = createReleaseManifest(root);
  const withoutPaths = new Set(componentFiles(withoutPackage)
    .filter(item => item.file.pinnedFrom === 'package-snapshot')
    .map(item => item.file.path));
  assert.equal(withoutPaths.size, 0);

  const {manifest} = createPinned(root);
  const snapshots = componentFiles(manifest).filter(item => item.file.pinnedFrom === 'package-snapshot');
  assert.ok(snapshots.length > 0);
  for (const snapshot of snapshots) {
    assert.equal(snapshot.file.reproducible, false);
    assert.match(snapshot.file.sha256, /^[a-f0-9]{64}$/);
  }
});

test('verify() requires a package directory and never accepts a dev tree', () => {
  const root = buildRoot();
  const manifest = createReleaseManifest(root);
  const noPackage = verifyPackage(manifest, null);
  assert.equal(noPackage.ok, false);
  assert.ok(noPackage.failures.some(failure => failure.code === 'PACKAGE_DIRECTORY_REQUIRED'));

  const devTree = verifyPackage(manifest, root);
  assert.equal(devTree.ok, false);
  assert.ok(devTree.failures.some(failure => failure.code === 'PACKAGE_IS_DEV_DIRECTORY'));
  assert.ok(devTree.missing.some(item => item.path === 'Craftmine World.exe'));
  assert.ok(devTree.missing.some(item => item.path === 'resources/app.asar'));
});

test('verify() fails on a missing required file', () => {
  const root = buildRoot();
  const {directory, manifest} = createPinned(root);
  const victim = 'resources/bin/craftmine-core.exe';
  fs.rmSync(path.join(directory, victim));
  const record = verifyPackage(manifest, directory);
  assert.equal(record.ok, false);
  assert.deepEqual(record.missing.map(item => item.path), [victim]);
  assert.ok(record.failures.some(failure => failure.code === 'PACKAGE_FILE_MISSING' && failure.path === victim));
});

test('verify() fails on a mutated byte', () => {
  const root = buildRoot();
  const {directory, manifest} = createPinned(root);
  const victim = 'resources/licenses/PI-Desktop-LICENSE.txt';
  const expected = manifest.components.licenses.files.find(file => file.packagePath === victim);
  const buffer = fs.readFileSync(path.join(directory, victim));
  buffer[0] = buffer[0] === 0x21 ? 0x3f : 0x21;
  fs.writeFileSync(path.join(directory, victim), buffer);
  const record = verifyPackage(manifest, directory);
  assert.equal(record.ok, false);
  const change = record.mismatch.find(item => item.path === victim);
  assert.ok(change, 'mutated file must be reported as a mismatch');
  assert.equal(change.expected.sha256, expected.sha256);
  assert.notEqual(change.actual.sha256, expected.sha256);
  assert.equal(change.actual.bytes, buffer.length);
});

test('verify() fails on a symlink inside the package', t => {
  const root = buildRoot();
  const {directory, manifest} = createPinned(root);
  const relative = 'resources/bin/linked-bin';
  const link = path.join(directory, relative);
  let linked = false;
  try {
    fs.symlinkSync(path.join(directory, 'resources/bin/craftmine-core.exe'), link, 'file');
    linked = true;
  } catch {
    try {
      // Directory junctions do not need the Windows symlink privilege and Node
      // still reports them through lstat().isSymbolicLink().
      fs.symlinkSync(path.join(directory, 'resources/bin'), link, 'junction');
      linked = true;
    } catch (error) {
      t.skip('symlink and junction creation are both denied on this machine: ' + error.code);
      return;
    }
  }
  assert.equal(linked, true);
  const record = verifyPackage(manifest, directory);
  assert.equal(record.ok, false);
  assert.ok(record.links.includes(relative), 'link must be reported: ' + JSON.stringify(record.links));
  assert.ok(record.failures.some(failure => failure.code === 'PACKAGE_LINK_DENIED'));
});

test('verify() fails when a forbidden development artifact is present', () => {
  const root = buildRoot();
  const {directory, manifest} = createPinned(root);
  write(path.join(directory, 'node_modules/left-pad/index.js'), 'module.exports = () => {};\n');
  write(path.join(directory, 'resources/build.log'), 'noise\n');
  write(path.join(directory, '.env'), 'SECRET=1\n');
  const record = verifyPackage(manifest, directory);
  assert.equal(record.ok, false);
  const rules = record.forbidden.map(item => item.rule).sort();
  assert.deepEqual(rules, ['env-file', 'log-file', 'node-modules']);
  assert.ok(!record.failures.some(failure => failure.code === 'PACKAGE_FILE_MISSING'));
});

test('verify() passes on a complete synthetic package', () => {
  const root = buildRoot();
  const {directory, manifest} = createPinned(root);
  const record = verifyPackage(manifest, directory);
  assert.equal(record.ok, true, JSON.stringify(record.failures, null, 2));
  assert.deepEqual(record.missing, []);
  assert.deepEqual(record.mismatch, []);
  assert.deepEqual(record.unpinned, []);
  assert.deepEqual(record.forbidden, []);
  assert.deepEqual(record.links, []);
  assert.equal(record.facts.requiredCount, packagePaths(manifest).length);
  assert.equal(record.selfAttestation.artifacts.length, 1);
  assert.equal(record.selfAttestation.artifacts[0].ok, true);
});

test('verify() reports unpinned required files instead of pretending they match', () => {
  const root = buildRoot();
  const directory = buildPackage(root);
  const manifest = createReleaseManifest(root); // no --package: build outputs stay unpinned
  const record = verifyPackage(manifest, directory);
  assert.equal(record.ok, false);
  const unpinned = record.unpinned.map(item => item.path);
  assert.ok(unpinned.includes('Craftmine World.exe'));
  assert.ok(unpinned.includes('resources/app.asar'));
  assert.ok(record.failures.some(failure => failure.code === 'PACKAGE_FILE_UNPINNED'));
});

test('diff() detects added, removed and changed components and files', () => {
  const root = buildRoot();
  const first = createReleaseManifest(root, {now: '2026-01-01T00:00:00.000Z'});
  const second = structuredClone(first);
  second.identity.commit = 'c'.repeat(40);
  second.identity.dirty = true;
  const bridgeFile = second.components.bridge.files[0];
  bridgeFile.sha256 = 'f'.repeat(64);
  bridgeFile.bytes = bridgeFile.bytes + 1;
  second.components.bridge.files.push({path: 'desktop/godot/web/extra.js', bytes: 5, sha256: 'e'.repeat(64), present: true});
  second.components.bases['top-down'].files.pop();

  const result = diffManifests(first, second);
  assert.equal(result.ok, false);
  assert.ok(result.identity.changed.some(item => item.field === 'commit'));
  assert.ok(result.identity.changed.some(item => item.field === 'dirty'));
  const changed = result.files.changed.find(item => item.path === 'desktop/godot/web/bridge.js');
  assert.ok(changed, 'mutated bridge file must be reported as changed');
  assert.notEqual(changed.oldSha256, changed.newSha256);
  assert.equal(changed.oldSha256, first.components.bridge.files[0].sha256);
  assert.ok(result.files.added.some(item => item.path === 'desktop/godot/web/extra.js'));
  assert.ok(result.files.removed.some(item => item.path === 'desktop/godot/bases/top-down/scripts/main.gd'));
  assert.ok(result.components.changed.some(item => item.key === 'bridge' || item.key === 'bases.top-down'));

  const identical = diffManifests(first, structuredClone(first));
  assert.equal(identical.ok, true);
});

test('pending-integration entries never carry a hash and never pass as verified', () => {
  const root = buildRoot();
  const {directory, manifest} = createPinned(root);
  for (const key of ['m', 'n']) {
    const entry = manifest.components.tooling[key];
    assert.equal(entry.status, 'pending-integration');
    assert.notEqual(entry.status, 'verified');
    assert.deepEqual(entry.files, []);
    assert.ok(entry.expectedPaths.length > 0);
    for (const expected of entry.expectedPaths) {
      assert.equal(expected.status, 'pending-integration');
      assert.equal(expected.owner, key.toUpperCase());
      assert.ok(typeof expected.expectedPath === 'string' && expected.expectedPath.length > 0);
      assert.ok(String(expected.source).startsWith('docs/'));
    }
    assert.ok(!JSON.stringify(entry).includes('sha256'), 'pending tooling must not invent a hash');
  }
  const record = verifyPackage(manifest, directory);
  assert.deepEqual(record.pendingComponents.sort(), ['tooling:m', 'tooling:n']);
  assert.equal(record.ok, true);
});

test('required package list and artifact map do not drift from preflight-core', () => {
  // preflight-core owns the packaged-file list; release-manifest re-exports it.
  assert.deepEqual([...REQUIRED_PACKAGE_FILES], [...PACKAGE_REQUIRED_FILES]);
  const source = fs.readFileSync(PREFLIGHT_CORE, 'utf8');
  const mapMatch = source.match(/const artifactMap = new Map\(\[([\s\S]*?)\]\);/);
  assert.ok(mapMatch, 'preflight-core checkPackage artifactMap was not found');
  const pairs = [...mapMatch[1].matchAll(/\['([^']+)',\s*'([^']+)'\]/g)].map(match => [match[1], match[2]]);
  assert.deepEqual([...PACKAGE_ARTIFACT_MAP.entries()], pairs);
});
