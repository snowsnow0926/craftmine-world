#!/usr/bin/env node
// Self-test for the delivery preflight. Proves that every negative rule fires and
// that a well-formed tree passes, using a synthetic fixture instead of the repo.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {
  REPO_ROOT,
  checkBaseAssets,
  checkExport,
  checkGodotCache,
  checkLgpl,
  checkNotices,
  checkPackage
} from './lib/preflight-core.mjs';

const results = [];
const test = (name, body) => {
  try {
    body();
    results.push({name, passed: true});
    console.log('PASS ' + name);
  } catch (error) {
    results.push({name, passed: false, error: String(error.message)});
    console.error('FAIL ' + name + ': ' + error.message);
  }
};
const digest = buffer => createHash('sha256').update(buffer).digest('hex');
const codes = result => result.failures.map(failure => failure.code);

fs.mkdirSync(path.join(REPO_ROOT, 'test-results'), {recursive: true});
const workRoot = fs.mkdtempSync(path.join(REPO_ROOT, 'test-results/delivery-preflight-selftest-'));
let sequence = 0;
function fixture() {
  const root = path.join(workRoot, 'fixture-' + ++sequence);
  fs.mkdirSync(root, {recursive: true});
  const write = (relative, content) => {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, content);
    return target;
  };
  const copy = relative => {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.copyFileSync(path.join(REPO_ROOT, relative), target);
  };
  // Only small, licence-relevant inputs are copied; no engine cache or package bytes.
  for (const relative of [
    'desktop/godot/toolchain.lock.json',
    'desktop/godot/licenses/GODOT_LICENSE.txt',
    'desktop/godot/licenses/GODOT_COPYRIGHT.txt',
    'desktop/godot/licenses/notices.manifest.json',
    'desktop/UPSTREAM.json',
    'vendor/pi-desktop/LICENSE',
    'vendor/pi-desktop/Cargo.toml',
    'vendor/pi-desktop/apps/desktop/src/assets/fonts/licenses/OFL-Geist.txt',
    'vendor/pi-desktop/apps/desktop/src/assets/fonts/licenses/OFL-Inter.txt',
    'vendor/pi-desktop/apps/desktop/src/assets/fonts/licenses/OFL-NotoSansSC.txt',
    'vendor/pi-desktop/apps/desktop/src/assets/fonts/licenses/OFL-LXGWWenKai.txt',
    'desktop/godot/probes/first-person/project.godot',
    'desktop/godot/probes/first-person/world.gd',
    'desktop/godot/probes/first-person/world.tscn',
    'desktop/godot/probes/first-person/crosshair.gd',
    'desktop/godot/probes/top-down/project.godot',
    'desktop/godot/probes/top-down/world.gd',
    'desktop/godot/probes/top-down/world.tscn',
    'desktop/godot/probes/shared/web_bridge.gd',
    'desktop/godot/web/bridge.js',
    'desktop/godot/web/host.mjs',
    'desktop/godot/web/runtime.mjs',
    'desktop/godot/web/runtime.d.mts',
    'desktop/godot/web/shell.html',
    'desktop/delivery/base-assets/first-person.json',
    'desktop/delivery/base-assets/top-down.json',
    'desktop/delivery/base-assets/shared-web.json'
  ]) copy(relative);
  write('vendor/pi-desktop/pnpm-lock.yaml', 'lockfileVersion: 9\n');
  write('vendor/pi-desktop/Cargo.lock', '# synthetic\n');
  const readManifest = () => JSON.parse(fs.readFileSync(path.join(root, 'desktop/godot/licenses/notices.manifest.json'), 'utf8'));
  const writeManifest = manifest => write('desktop/godot/licenses/notices.manifest.json', JSON.stringify(manifest, null, 2));
  const readAssets = name => JSON.parse(fs.readFileSync(path.join(root, 'desktop/delivery/base-assets', name), 'utf8'));
  const writeAssets = (name, manifest) => write('desktop/delivery/base-assets/' + name, JSON.stringify(manifest, null, 2));
  const readLock = () => JSON.parse(fs.readFileSync(path.join(root, 'desktop/godot/toolchain.lock.json'), 'utf8'));
  const writeLock = lock => write('desktop/godot/toolchain.lock.json', JSON.stringify(lock, null, 2));
  return {root, write, copy, readManifest, writeManifest, readAssets, writeAssets, readLock, writeLock};
}

// 1. Baseline: the copied real inputs must pass every provenance check.
test('baseline notices, assets and LGPL checks pass', () => {
  const {root} = fixture();
  assert.deepEqual(checkNotices(root).failures, []);
  assert.deepEqual(checkBaseAssets(root).failures, []);
  assert.deepEqual(checkLgpl(root).failures, []);
});

// 2. Missing pinned notice file.
test('absent engine licence file fails', () => {
  const {root} = fixture();
  fs.rmSync(path.join(root, 'desktop/godot/licenses/GODOT_LICENSE.txt'));
  assert.ok(codes(checkNotices(root)).includes('NOTICE_FILE_MISSING'));
});

// 3. Content, not just hash: a manifest whose hash matches but whose text is wrong.
test('licence text that is not the MIT text fails even with a matching hash', () => {
  const {root, readManifest, writeManifest} = fixture();
  const replacement = Buffer.from('This file intentionally contains no licence grant.\n');
  fs.writeFileSync(path.join(root, 'desktop/godot/licenses/GODOT_LICENSE.txt'), replacement);
  const manifest = readManifest();
  manifest.entries.find(entry => entry.id === 'godot-engine').noticeBytes = replacement.length;
  manifest.entries.find(entry => entry.id === 'godot-engine').noticeSha256 = digest(replacement);
  writeManifest(manifest);
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'desktop/godot/toolchain.lock.json'), 'utf8'));
  lock.licenses[0].sha256 = digest(replacement);
  fs.writeFileSync(path.join(root, 'desktop/godot/toolchain.lock.json'), JSON.stringify(lock, null, 2));
  assert.ok(codes(checkNotices(root)).includes('NOTICE_CONTENT_UNEXPECTED'));
});

// 4. Hash drift between the notice manifest and the toolchain lock.
test('notice manifest drifting from the toolchain lock fails', () => {
  const {root, readManifest, writeManifest} = fixture();
  const manifest = readManifest();
  manifest.entries.find(entry => entry.id === 'godot-engine').noticeSha256 = 'f'.repeat(64);
  writeManifest(manifest);
  assert.ok(codes(checkNotices(root)).includes('NOTICE_HASH_MISMATCH'));
  assert.ok(codes(checkNotices(root)).includes('LOCK_NOTICE_DRIFT'));
});

// 5. Removing a required entry (for example the LGPL one) is a hard failure.
test('deleting the required LGPL notice entry fails', () => {
  const {root, readManifest, writeManifest} = fixture();
  const manifest = readManifest();
  manifest.entries = manifest.entries.filter(entry => entry.id !== 'pi-desktop-lgpl');
  writeManifest(manifest);
  assert.ok(codes(checkNotices(root)).includes('NOTICE_REQUIRED_ENTRY_MISSING'));
  assert.ok(codes(checkLgpl(root)).includes('LGPL_NOT_DECLARED'));
});

// 6. The Godot MIT text must never stand in for the LGPL text.
test('MIT text substituted for the LGPL notice fails', () => {
  const {root, readManifest, writeManifest} = fixture();
  const mit = fs.readFileSync(path.join(root, 'desktop/godot/licenses/GODOT_LICENSE.txt'));
  fs.writeFileSync(path.join(root, 'vendor/pi-desktop/LICENSE'), mit);
  const manifest = readManifest();
  const entry = manifest.entries.find(candidate => candidate.id === 'pi-desktop-lgpl');
  entry.noticeBytes = mit.length;
  entry.noticeSha256 = digest(mit);
  writeManifest(manifest);
  const found = codes(checkLgpl(root));
  assert.ok(found.includes('LGPL_NOTICE_NOT_LGPL'), 'LGPL_NOTICE_NOT_LGPL');
  assert.ok(found.includes('LGPL_NOTICE_IS_MIT'), 'LGPL_NOTICE_IS_MIT');
  assert.ok(codes(checkNotices(root)).includes('NOTICE_CONTENT_FORBIDDEN'), 'NOTICE_CONTENT_FORBIDDEN');
});

// 7. Upstream provenance must keep declaring LGPL.
test('upstream provenance claiming a non-LGPL licence fails', () => {
  const {root, write} = fixture();
  write('desktop/UPSTREAM.json', JSON.stringify({format: 'craftmine.upstream/1', commit: '0'.repeat(40), license: 'MIT'}));
  assert.ok(codes(checkLgpl(root)).includes('LGPL_PROVENANCE_MISMATCH'));
});

// 8. Changed base source bytes must fail until provenance is re-reviewed.
test('modified base source fails the pinned hash', () => {
  const {root} = fixture();
  const target = path.join(root, 'desktop/godot/probes/first-person/world.gd');
  const buffer = Buffer.from(fs.readFileSync(target));
  buffer[0] = buffer[0] === 0x65 ? 0x66 : 0x65;
  fs.writeFileSync(target, buffer);
  const found = codes(checkBaseAssets(root));
  assert.ok(found.includes('ASSET_HASH_MISMATCH') || found.includes('ASSET_BYTES_MISMATCH'), found.join(','));
});

// 9. An undeclared file next to the base sources is a provenance gap.
test('undeclared file inside a base directory fails', () => {
  const {root, write} = fixture();
  write('desktop/godot/probes/first-person/sneaky.gd', 'extends Node\n');
  assert.ok(codes(checkBaseAssets(root)).includes('ASSET_UNDECLARED_FILE'));
});

// 10. Shipping or exporting an asset whose redistribution is denied.
test('denied redistribution on a shipped asset fails', () => {
  const {root, readAssets, writeAssets} = fixture();
  const manifest = readAssets('first-person.json');
  manifest.entries[0].redistribution = 'denied';
  writeAssets('first-person.json', manifest);
  const found = codes(checkBaseAssets(root));
  assert.ok(found.includes('ASSET_REDISTRIBUTION_DENIED'), 'ASSET_REDISTRIBUTION_DENIED');
  assert.ok(found.includes('ASSET_EXPORT_DENIED'), 'ASSET_EXPORT_DENIED');
});

// 11. A shipped third-party asset without a licence file.
test('third-party asset without a notice file fails', () => {
  const {root, readAssets, writeAssets} = fixture();
  const manifest = readAssets('first-person.json');
  Object.assign(manifest.entries[1], {origin: 'third-party', license: 'CC-BY-4.0', licenseFile: null});
  writeAssets('first-person.json', manifest);
  assert.ok(codes(checkBaseAssets(root)).includes('ASSET_LICENSE_FILE_MISSING'));
});

// 12. Authored code must state either a licence text or an explicit outstanding reason.
test('authored asset without licence text or reason fails', () => {
  const {root, readAssets, writeAssets} = fixture();
  const manifest = readAssets('first-person.json');
  delete manifest.entries[0].outstanding;
  writeAssets('first-person.json', manifest);
  assert.ok(codes(checkBaseAssets(root)).includes('ASSET_AUTHORED_LICENSE_UNDECLARED'));
});

// 13. A base must target the engine version pinned in the lock.
test('base manifest targeting another engine version fails', () => {
  const {root, readAssets, writeAssets} = fixture();
  const manifest = readAssets('first-person.json');
  manifest.engine.version = '4.6.0-stable';
  writeAssets('first-person.json', manifest);
  assert.ok(codes(checkBaseAssets(root)).includes('ASSET_ENGINE_MISMATCH'));
});

// 14. Missing required export notice.
test('missing required notice for an exported base fails', () => {
  const {root} = fixture();
  fs.rmSync(path.join(root, 'desktop/godot/licenses/GODOT_COPYRIGHT.txt'));
  assert.ok(codes(checkBaseAssets(root)).includes('ASSET_NOTICE_MISSING'));
  const noticeCodes = codes(checkNotices(root));
  assert.ok(noticeCodes.includes('NOTICE_FILE_MISSING'), noticeCodes.join(','));
  assert.ok(noticeCodes.includes('LOCK_NOTICE_FILE_MISSING'), noticeCodes.join(','));
});

// 15. Engine cache: absent directory is a failure, omitted directory is a skip.
test('cache check distinguishes absent from omitted input', () => {
  const {root} = fixture();
  assert.equal(checkGodotCache(root, null).facts.skipped, true);
  assert.ok(codes(checkGodotCache(root, path.join(root, 'no-such-cache'))).includes('CACHE_DIRECTORY_MISSING'));
});

// 16. Exported Web build: valid build passes, tampering fails.
function makeExport(root) {
  const directory = path.join(root, 'export');
  const write = (relative, content) => {
    const target = path.join(directory, relative);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, content);
    return target;
  };
  for (const name of ['index.html', 'index.wasm', 'index.pck', 'bridge.js']) write(name, 'synthetic ' + name);
  for (const name of ['GODOT_LICENSE.txt', 'GODOT_COPYRIGHT.txt']) {
    const target = write(path.join('licenses', name), fs.readFileSync(path.join(REPO_ROOT, 'desktop/godot/licenses', name)));
  }
  const files = [];
  const walk = (current, prefix) => {
    for (const child of fs.readdirSync(current).sort()) {
      const childPath = path.join(current, child);
      if (fs.statSync(childPath).isDirectory()) walk(childPath, prefix ? prefix + '/' + child : child);
      else files.push({path: prefix ? prefix + '/' + child : child, bytes: fs.statSync(childPath).size, sha256: digest(fs.readFileSync(childPath))});
    }
  };
  walk(directory, '');
  const buildId = digest(Buffer.from(JSON.stringify(files)));
  write('build.json', JSON.stringify({base: 'first-person', buildId, threads: true, files, godotVersion: '4.7.2.stable.official.ed1daf0bf'}));
  return directory;
}
test('well-formed export build passes', () => {
  const {root} = fixture();
  assert.deepEqual(checkExport(root, makeExport(root)).failures, []);
});
test('export missing an engine notice fails', () => {
  const {root} = fixture();
  const directory = makeExport(root);
  fs.rmSync(path.join(directory, 'licenses/GODOT_COPYRIGHT.txt'));
  assert.ok(codes(checkExport(root, directory)).includes('EXPORT_NOTICE_MISSING'));
});
test('export whose build.json hash no longer matches fails', () => {
  const {root} = fixture();
  const directory = makeExport(root);
  const target = path.join(directory, 'index.wasm');
  const buffer = Buffer.from(fs.readFileSync(target));
  buffer[0] = buffer[0] === 0x73 ? 0x74 : 0x73;
  fs.writeFileSync(target, buffer);
  const found = codes(checkExport(root, directory));
  assert.ok(found.includes('EXPORT_MANIFEST_HASH') || found.includes('EXPORT_MANIFEST_BYTES'), found.join(','));
});

// 17. Windows package: valid synthetic package passes, tampering fails.
function makePackage(root) {
  const directory = path.join(root, 'package');
  const write = (relative, content) => {
    const target = path.join(directory, relative);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, content);
    return target;
  };
  for (const relative of ['Craftmine World.exe', 'resources/app.asar', 'resources/bin/pi-desktop-host-core.exe', 'resources/bin/craftmine-core.exe', 'resources/agent-runtime/sidecar.js', 'resources/plugins/craftmine.world/main.cjs']) {
    write(relative, 'synthetic ' + relative);
  }
  write('resources/source/CraftmineWorld-source.zip', 'synthetic source archive');
  write('resources/source/USER_GUIDE.zh-CN.md', 'synthetic user guide');
  write('resources/git/bin/git.exe', 'synthetic git wrapper');
  write('resources/git/GIT-BUNDLE.json', JSON.stringify({format: 'craftmine.git-bundle-staged/1', version: '2.53.0.windows.1'}));
  write('resources/git/LICENSE.txt', 'GNU GENERAL PUBLIC LICENSE Version 2');
  write('resources/licenses/PI-Desktop-LICENSE.txt', fs.readFileSync(path.join(REPO_ROOT, 'vendor/pi-desktop/LICENSE')));
  write('resources/licenses/CRAFTMINE-NOTICES.md', 'LGPL-3.0-or-later obligations are documented here.\n');
  for (const name of ['OFL-Geist.txt', 'OFL-Inter.txt', 'OFL-NotoSansSC.txt', 'OFL-LXGWWenKai.txt']) write('resources/licenses/fonts/' + name, 'SIL OPEN FONT LICENSE');
  write('resources/licenses/third-party/example@1.0.0-LICENSE', 'MIT');
  write('resources/licenses/third-party/npm-inventory.json', JSON.stringify({format: 'craftmine.third-party/1', packages: [{package: 'example@1.0.0', license: 'MIT', licenseFiles: ['example@1.0.0-LICENSE']}]}));
  const artifacts = ['resources/bin/pi-desktop-host-core.exe', 'resources/bin/craftmine-core.exe', 'resources/agent-runtime/sidecar.js', 'resources/plugins/craftmine.world/main.cjs', 'resources/source/CraftmineWorld-source.zip'].map(relative => {
    const buffer = fs.readFileSync(path.join(directory, relative));
    return {path: relative, bytes: buffer.length, sha256: digest(buffer)};
  });
  write('resources/source/build-manifest.json', JSON.stringify({format: 'craftmine.build/1', commit: '0'.repeat(40), sourceDate: '2026-09-09T00:00:00Z', appId: 'world.craftmine.desktop', sourceArchiveHash: artifacts.at(-1).sha256, artifacts, toolchain: {node: 'v24.0.0', cargo: 'cargo 1.96.1'}}));
  return directory;
}
test('well-formed Windows package passes', () => {
  const {root} = fixture();
  assert.deepEqual(checkPackage(root, makePackage(root)).failures, []);
});
test('package with a tampered artefact fails', () => {
  const {root} = fixture();
  const directory = makePackage(root);
  const target = path.join(directory, 'resources/bin/craftmine-core.exe');
  const buffer = Buffer.from(fs.readFileSync(target));
  buffer[0] = buffer[0] === 0x73 ? 0x74 : 0x73;
  fs.writeFileSync(target, buffer);
  const found = codes(checkPackage(root, directory));
  assert.ok(found.includes('PACKAGE_ARTIFACT_HASH') || found.includes('PACKAGE_ARTIFACT_BYTES'), found.join(','));
});
test('package whose third-party inventory points at an absent text fails', () => {
  const {root} = fixture();
  const directory = makePackage(root);
  fs.rmSync(path.join(directory, 'resources/licenses/third-party/example@1.0.0-LICENSE'));
  assert.ok(codes(checkPackage(root, directory)).includes('PACKAGE_THIRD_PARTY_TEXT_MISSING'));
});
test('package bundling an engine without Godot notices fails', () => {
  const {root} = fixture();
  const directory = makePackage(root);
  fs.writeFileSync(path.join(directory, 'Godot_v4.7.2-stable_win64.exe'), 'synthetic engine');
  const found = codes(checkPackage(root, directory));
  assert.ok(found.includes('PACKAGE_GODOT_NOTICE_MISSING'), 'PACKAGE_GODOT_NOTICE_MISSING');
  assert.ok(found.includes('PACKAGE_GODOT_NOTICE_UNDECLARED'), 'PACKAGE_GODOT_NOTICE_UNDECLARED');
});
test('package bundling an engine with correct Godot notices passes', () => {
  const {root} = fixture();
  const directory = makePackage(root);
  fs.writeFileSync(path.join(directory, 'Godot_v4.7.2-stable_win64.exe'), 'synthetic engine');
  for (const name of ['GODOT_LICENSE.txt', 'GODOT_COPYRIGHT.txt']) {
    const target = path.join(directory, 'resources/licenses/godot', name);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.copyFileSync(path.join(REPO_ROOT, 'desktop/godot/licenses', name), target);
  }
  fs.appendFileSync(path.join(directory, 'resources/licenses/CRAFTMINE-NOTICES.md'), 'Godot Engine 4.7.2-stable is bundled under the MIT licence.\n');
  assert.deepEqual(checkPackage(root, directory).failures, []);
});


// Integration audit regressions: old probe green does not cover newly shipped bases.
test('every new base directory requires its own manifest despite matching probe IDs', () => {
  const {root, write} = fixture();
  for (const name of ['first-person', 'top-down', 'side-view']) write('desktop/godot/bases/' + name + '/project.godot', 'synthetic project');
  const result = checkBaseAssets(root);
  assert.equal(result.failures.filter(item => item.code === 'ASSET_BASE_MANIFEST_MISSING').length, 3);
  assert.equal(result.ok, false);
});
for (const value of ['unrevealed', 'unreviewed']) test(value + ' asset redistribution is rejected', () => {
  const {root, readAssets, writeAssets} = fixture();
  const manifest = readAssets('shared-web.json'); manifest.entries[0].redistribution = value; writeAssets('shared-web.json', manifest);
  assert.ok(codes(checkBaseAssets(root)).includes('ASSET_REDISTRIBUTION_DENIED'));
});
for (const value of ['unrevealed', 'unreviewed']) test(value + ' notice redistribution is rejected', () => {
  const {root, readManifest, writeManifest} = fixture();
  const manifest = readManifest(); manifest.entries[0].redistribution = value; writeManifest(manifest);
  assert.ok(codes(checkNotices(root)).includes('NOTICE_REDISTRIBUTION_DENIED'));
});
test('deeply nested Godot executable cannot bypass package notice checks', () => {
  const {root} = fixture(), directory = makePackage(root), nested = path.join(directory, 'a/b/c/d/e/f/g');
  fs.mkdirSync(nested, {recursive: true});fs.writeFileSync(path.join(nested, 'godot.exe'), 'synthetic engine');
  assert.ok(codes(checkPackage(root, directory)).includes('PACKAGE_GODOT_NOTICE_MISSING'));
});
test('renamed engine is recognized by the locked executable hash', () => {
  const {root, readLock, writeLock} = fixture(), directory = makePackage(root), bytes = Buffer.from('synthetic locked executable');
  const lock = readLock(); lock.editor.executableSha256 = digest(bytes); writeLock(lock);
  fs.writeFileSync(path.join(directory, 'innocent.dat'), bytes);
  const result = checkPackage(root, directory);
  assert.equal(result.facts.godotEngineBinary, 'innocent.dat');
  assert.ok(codes(result).includes('PACKAGE_GODOT_NOTICE_MISSING'));
});
test('Web WASM and PCK without native executable still require Godot notices', () => {
  const {root} = fixture(), directory = makePackage(root);
  fs.writeFileSync(path.join(directory, 'renamed.wasm'), 'synthetic wasm');fs.writeFileSync(path.join(directory, 'differently-named.pck'), 'synthetic pack');
  assert.ok(codes(checkPackage(root, directory)).includes('PACKAGE_GODOT_NOTICE_MISSING'));
});
test('unknown WASM needs an exact reviewed runtime declaration', () => {
  const {root} = fixture(), directory = makePackage(root), bytes = Buffer.from('unknown wasm');
  fs.writeFileSync(path.join(directory, 'runtime.wasm'), bytes);
  assert.ok(codes(checkPackage(root, directory)).includes('PACKAGE_WASM_RUNTIME_UNDECLARED'));
  const entry = {path: 'runtime.wasm', sha256: digest(bytes), runtime: 'other', license: 'test-only', redistribution: 'unrevealed'};
  const save = () => fs.writeFileSync(path.join(directory, 'resources/runtime-manifest.json'), JSON.stringify({format: 'craftmine.package-runtimes/1', entries: [entry]}));
  save();assert.ok(codes(checkPackage(root, directory)).includes('PACKAGE_WASM_RUNTIME_UNDECLARED'));
  entry.redistribution = 'permitted';save();assert.equal(checkPackage(root, directory).ok, true);
  fs.appendFileSync(path.join(directory, 'runtime.wasm'), 'changed');assert.ok(codes(checkPackage(root, directory)).includes('PACKAGE_WASM_RUNTIME_UNDECLARED'));
});


test('package link rejection happens before traversing its target', () => {
  const {root} = fixture(), directory = makePackage(root), link = path.join(directory, 'pretend-junction');
  fs.mkdirSync(link);
  const lstat = fs.lstatSync, readdir = fs.readdirSync;
  // Deterministic control-flow test; does not claim an OS junction fixture.
  fs.lstatSync = function(file, ...args) { const info = lstat.call(fs, file, ...args); if (file === link) info.isSymbolicLink = () => true; return info; };
  fs.readdirSync = function(file, ...args) { assert.notEqual(file, link, 'link target was traversed'); return readdir.call(fs, file, ...args); };
  try { assert.ok(codes(checkPackage(root, directory)).includes('PACKAGE_LINK_DENIED')); }
  finally { fs.lstatSync = lstat; fs.readdirSync = readdir; }
});
test('missing locked executable identity cannot certify no runtime', () => {
  const {root, readLock, writeLock} = fixture(), directory = makePackage(root), lock = readLock();
  delete lock.editor.executableSha256; writeLock(lock);
  assert.ok(codes(checkPackage(root, directory)).includes('PACKAGE_ENGINE_HASH_UNAVAILABLE'));
});

test('shared base tests are not a base, but cannot hide a world project', () => {
  const {root, write} = fixture();
  write('desktop/godot/bases/tests/audit.mjs', '// development harness');
  assert.ok(!codes(checkBaseAssets(root)).includes('ASSET_BASE_MANIFEST_MISSING'));
  write('desktop/godot/bases/tests/project.godot', 'config_version=5');
  assert.ok(codes(checkBaseAssets(root)).includes('ASSET_BASE_MANIFEST_MISSING'));
});

test('a rights document that does not exist is a failure, not a silent pass', () => {
  const {root, readAssets, writeAssets} = fixture();
  const manifest = readAssets('shared-web.json');
  manifest.entries[0].outstanding = undefined;
  manifest.entries[0].licenseDocument = 'desktop/delivery/base-assets/rights/does-not-exist.md';
  writeAssets('shared-web.json', manifest);
  assert.ok(codes(checkBaseAssets(root)).includes('ASSET_LICENSE_DOCUMENT_MISSING'));
});

test('an unapplied rights status is always reported, even when the field is omitted', () => {
  const {root, readAssets, writeAssets, write} = fixture();
  const manifest = readAssets('shared-web.json');
  delete manifest.rightsStatus;
  manifest.entries[0].outstanding = undefined;
  manifest.entries[0].licenseDocument = 'desktop/delivery/base-assets/rights/shared-web.md';
  manifest.entries[0].targetLicense = 'MIT (pending)';
  writeAssets('shared-web.json', manifest);
  write('desktop/delivery/base-assets/rights/shared-web.md', '# rights statement\n');
  const result = checkBaseAssets(root);
  assert.deepEqual(result.failures, []);
  assert.ok(result.warnings.some(warning => warning.startsWith('ASSET_RIGHTS_PENDING')), result.warnings.join(' | '));
});

test('a development-only file inside a package is refused', () => {
  const {root} = fixture(), directory = makePackage(root);
  const copied = path.join(directory, 'resources/copied/desktop/godot/web/host.mjs');
  fs.mkdirSync(path.dirname(copied), {recursive: true});
  fs.writeFileSync(copied, '// development-only transport');
  assert.ok(codes(checkPackage(root, directory)).includes('DEVELOPMENT_ONLY_FILE_SHIPPED'));
});

test('a file whose basename merely collides with a development-only file is not refused', () => {
  const {root} = fixture(), directory = makePackage(root);
  const collision = path.join(directory, 'resources/plugins/example/renderer/index.html');
  fs.mkdirSync(path.dirname(collision), {recursive: true});
  fs.writeFileSync(collision, '<!doctype html>');
  assert.deepEqual(checkPackage(root, directory).failures, []);
});

const failed = results.filter(result => !result.passed);
fs.mkdirSync(path.join(REPO_ROOT, 'test-results'), {recursive: true});
const reportPath = path.join(workRoot, 'report.json');
fs.writeFileSync(reportPath, JSON.stringify({format: 'craftmine.delivery-preflight-selftest/1', generatedAt: new Date().toISOString(), total: results.length, failed: failed.length, results}, null, 2) + '\n');
console.log((failed.length ? 'SELFTEST FAILED' : 'SELFTEST PASSED') + ': ' + results.length + ' cases, ' + failed.length + ' failed');
console.log('Evidence: ' + reportPath);
process.exit(failed.length ? 1 : 0);
