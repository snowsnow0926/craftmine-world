import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {previewLauncher, archivePreview, verifyPortableTool, exportPreview, readPreviewExtras, copyPreviewExtras} from '../desktop/export-preview.mjs';
import {fileHash, resourceInventory} from '../desktop/prepare-runtime-resources.mjs';
import {beginRelease, sealRelease, verifySeal} from '../desktop/release-run.mjs';

test('preview launcher is relocatable, uses its own profile, and clears inherited test configuration', () => {
  const launcher = previewLauncher('0.14.4-preview.22');
  assert.match(launcher, /CRAFTMINE_DATA_DIR=%LOCALAPPDATA%\\CraftmineWorld-FirstCreationPreview22/);
  assert.match(launcher, /%~dp0output\\win-unpacked\\Craftmine World.exe/);
  assert.match(launcher, /set CRAFTMINE_/); assert.match(launcher, /set PI_DESKTOP_/);
  assert.match(launcher, /set "ELECTRON_RUN_AS_NODE="/); assert.match(launcher, /set "NODE_OPTIONS="/);
  assert.ok(!launcher.replaceAll('\r\n', '').includes('\n'));
  for (const version of ['0.14.4', '0.14.4-preview.22&calc', 'other']) assert.throws(() => previewLauncher(version), /PREVIEW_VERSION/);
});

test('archive tool must match an explicit byte pin', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'craftmine-preview-pin-'));
  const tool = path.join(directory, 'tool.exe'); await fs.writeFile(tool, 'not executable');
  await assert.rejects(verifyPortableTool(tool, '0'.repeat(64)), /PIN_MISMATCH/);
  await assert.rejects(verifyPortableTool('relative.exe', '0'.repeat(64)), /PIN_REQUIRED/);
  await verifyPortableTool(tool, await fileHash(tool));
});

async function extrasFixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'craftmine-preview-extras-'));
  const file = path.join(directory, 'source.zip'); await fs.writeFile(file, 'pinned template');
  const entry = {name: 'examples/template.zip', file, bytes: (await fs.stat(file)).size, sha256: await fileHash(file)};
  const manifest = path.join(directory, 'extras.json');
  const write = entries => fs.writeFile(manifest, JSON.stringify({format: 'craftmine.preview-extras/1', entries}));
  await write([entry]);
  return {directory, file, entry, manifest, write};
}

test('extras copy preserves pinned bytes with proof outside the sealed application', async () => {
  const fixture = await extrasFixture();
  const extras = await readPreviewExtras(fixture.manifest), destination = path.join(fixture.directory, 'delivery');
  await fs.mkdir(destination);
  const proof = await copyPreviewExtras(destination, extras);
  assert.equal(proof.sourceManifestSha256, await fileHash(fixture.manifest));
  assert.deepEqual(proof.entries, [{name: fixture.entry.name, bytes: fixture.entry.bytes, sha256: fixture.entry.sha256}]);
  assert.equal(await fileHash(path.join(destination, fixture.entry.name)), fixture.entry.sha256);
  assert.deepEqual((await fs.readdir(destination)).sort(), ['EXTRAS.json', 'examples']);
});

test('extras allow only the named root player guide and preserve its pinned bytes', async () => {
  const fixture = await extrasFixture();
  await fixture.write([{...fixture.entry, name: '00-开始试玩.txt'}]);
  const extras = await readPreviewExtras(fixture.manifest), destination = path.join(fixture.directory, 'with-guide');
  await fs.mkdir(destination); await copyPreviewExtras(destination, extras);
  assert.equal(await fileHash(path.join(destination, '00-开始试玩.txt')), fixture.entry.sha256);
  for (const name of ['00-开始试玩.cmd', '00-开始试玩.txt/child', 'START-PLAYER-PREVIEW.cmd', 'README.zh-CN.txt', 'DELIVERY.json']) {
    await fixture.write([{...fixture.entry, name}]);
    await assert.rejects(readPreviewExtras(fixture.manifest), /ENTRY_INVALID/);
  }
});

test('extras reject traversal, Windows aliases, duplicate destinations and excessive declarations', async () => {
  const fixture = await extrasFixture();
  for (const name of ['output/app.exe', 'examples/../escape.zip', 'docs/con.txt', 'docs/x:stream', 'docs/a?.txt', 'docs/back\\slash', 'docs/trailing.']) {
    await fixture.write([{...fixture.entry, name}]); await assert.rejects(readPreviewExtras(fixture.manifest));
  }
  for (const name of ['examples/TEMPLATE.ZIP', 'examples/template.zip/child']) {
    await fixture.write([fixture.entry, {...fixture.entry, name}]); await assert.rejects(readPreviewExtras(fixture.manifest));
  }
  await fixture.write([{...fixture.entry, bytes: 64 * 1024 * 1024 + 1}]);
  await assert.rejects(readPreviewExtras(fixture.manifest), /ENTRY_INVALID/);
  await fixture.write(Array.from({length: 17}, (_, i) => ({...fixture.entry, name: `docs/${i}.txt`})));
  await assert.rejects(readPreviewExtras(fixture.manifest), /MANIFEST_INVALID/);
});

test('extras refuse tampered source bytes before and after inspection', async () => {
  const fixture = await extrasFixture(), extras = await readPreviewExtras(fixture.manifest);
  await fs.writeFile(fixture.file, 'tampered bytes');
  await assert.rejects(readPreviewExtras(fixture.manifest), /PIN_MISMATCH/);
  const destination = path.join(fixture.directory, 'delivery'); await fs.mkdir(destination);
  await assert.rejects(copyPreviewExtras(destination, extras), /CHANGED_DURING_COPY/);
});

test('extras refuse source paths through a directory link', async () => {
  const fixture = await extrasFixture();
  const actual = path.join(fixture.directory, 'ordinary'); await fs.mkdir(actual);
  await fs.copyFile(fixture.file, path.join(actual, 'source.zip'));
  const alias = path.join(fixture.directory, 'alias'); await fs.symlink(actual, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await fixture.write([{...fixture.entry, file: path.join(alias, 'source.zip')}]);
  await assert.rejects(readPreviewExtras(fixture.manifest), /LINK_DENIED/);
});

test('real ZIP round trip pins exact extracted bytes and never replaces an existing archive', {skip: !process.env.CRAFTMINE_PREVIEW_ARCHIVE_TOOL}, async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'craftmine-preview-archive-'));
  const directory = path.join(parent, 'preview22-with-spaces'); await fs.mkdir(directory);
  await fs.mkdir(path.join(directory, 'output/win-unpacked/resources/licenses'), {recursive: true});
  await fs.writeFile(path.join(directory, 'output/win-unpacked/resources/licenses/notice.txt'), 'license bytes\n');
  await fs.writeFile(path.join(directory, 'START-PLAYER-PREVIEW.cmd'), previewLauncher('0.14.4-preview.22'));
  const tool = process.env.CRAFTMINE_PREVIEW_ARCHIVE_TOOL, toolSha256 = await fileHash(tool);
  const result = await archivePreview(directory, {tool, toolSha256});
  assert.equal(result.extractedBytesVerified, true); assert.equal(result.fileCount, 2);
  assert.equal(result.cleanWindowsVerified, false); assert.equal(result.installerExecuted, false);
  assert.equal(result.sha256, await fileHash(result.archive));
  assert.match(await fs.readFile(result.archive + '.sha256', 'utf8'), new RegExp('^' + result.sha256 + '  '));
  await assert.rejects(archivePreview(directory, {tool, toolSha256}), /EEXIST/);
  assert.equal(await fileHash(result.archive), result.sha256);
});

test('sealed release export rejects changed source or payload and preserves original seal', {skip: !process.env.CRAFTMINE_PREVIEW_ARCHIVE_TOOL}, async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'craftmine-preview-export-'));
  const root = path.join(parent, 'source'); await fs.mkdir(root);
  const git = args => execFileSync('git', args, {cwd: root, encoding: 'utf8', windowsHide: true}).trim();
  git(['init', '-q']);
  await fs.mkdir(path.join(root, 'vendor/pi-desktop/apps/desktop'), {recursive: true});
  const metadataPath = path.join(root, 'vendor/pi-desktop/apps/desktop/package.json');
  await fs.writeFile(metadataPath, JSON.stringify({version: '0.14.4-preview.22'}));
  await fs.writeFile(path.join(root, '.gitignore'), 'desktop/build/\n'); git(['add', '.']);
  git(['-c', 'user.name=Preview fixture', '-c', 'user.email=preview@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture']);
  const commit = git(['rev-parse', 'HEAD']);
  await fs.mkdir(path.join(root, 'desktop/build'), {recursive: true});
  await fs.writeFile(path.join(root, 'desktop/build/build-manifest.json'), JSON.stringify({commit}));
  const run = await beginRelease(root, {commit});
  await fs.mkdir(path.join(run.output, 'win-unpacked/resources/source'), {recursive: true});
  await fs.copyFile(path.join(root, 'desktop/build/build-manifest.json'), path.join(run.output, 'win-unpacked/resources/source/build-manifest.json'));
  await sealRelease(run, '0.14.4-preview.22');
  const evidenceFile = path.join(path.dirname(run.runFile), 'package-evidence.json');
  await fs.writeFile(evidenceFile, JSON.stringify({format: 'craftmine.package-evidence/2', commit,
    buildManifestSha256: run.buildManifestSha256, files: await resourceInventory(path.join(run.output, 'win-unpacked'))}));
  const tool = process.env.CRAFTMINE_PREVIEW_ARCHIVE_TOOL, toolSha256 = await fileHash(tool);
  const extra = await extrasFixture();
  const options = {root, runFile: run.runFile, destination: path.join(parent, 'delivery-preview22'), tool, toolSha256, extrasManifest: extra.manifest};
  await fs.appendFile(metadataPath, ' ');
  await assert.rejects(exportPreview(options), /CURRENT_CLEAN_SOURCE_REQUIRED/);
  await fs.writeFile(metadataPath, JSON.stringify({version: '0.14.4-preview.22'}));
  const result = await exportPreview(options);
  assert.equal(result.extractedBytesVerified, true);
  await verifySeal(run);
  const delivery = JSON.parse(await fs.readFile(path.join(options.destination, 'DELIVERY.json'), 'utf8'));
  assert.equal(delivery.commit, commit); assert.equal(delivery.version, '0.14.4-preview.22');
  assert.equal(delivery.extras.entries[0].sha256, extra.entry.sha256);
  assert.equal(await fileHash(path.join(result.extraction, path.basename(options.destination), extra.entry.name)), extra.entry.sha256);
  await fs.writeFile(path.join(run.output, 'unexpected.txt'), 'changed');
  await assert.rejects(exportPreview({...options, destination: path.join(parent, 'other')}), /OUTPUT_CHANGED_AFTER_SEAL/);
});
