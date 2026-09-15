import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PROJECT_LICENSE_FILES, verifyProjectLicenseFiles} from '../desktop/project-license-files.mjs';
import {writeWindowsExportNotices} from '../vendor/pi-desktop/apps/desktop/electron/main/godot-windows-export-service.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const notices = ['GODOT_LICENSE.txt', 'GODOT_COPYRIGHT.txt', 'CRAFTMINE-RUNTIME-MIT.txt', 'CRAFTMINE-RUNTIME-NOTICES.md'];
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'craftmine-license-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  return root;
}
async function put(file, bytes) { await fs.mkdir(path.dirname(file), {recursive: true}); await fs.writeFile(file, bytes); }
async function exportFixture(t) {
  const root = await fixture(t), resources = path.join(root, 'godot'), output = path.join(root, 'output');
  await fs.mkdir(output);
  for (const name of notices) await put(path.join(resources, 'licenses', name), await fs.readFile(path.join(repo, 'desktop/godot/licenses', name)));
  return {resources, output};
}

test('client builder stages every required project license at its verified path', async () => {
  const packageDirectory = path.join(repo, 'vendor/pi-desktop/apps/desktop');
  const metadata = JSON.parse(await fs.readFile(path.join(packageDirectory, 'package.json'), 'utf8'));
  for (const [source, target] of PROJECT_LICENSE_FILES) {
    assert.ok(metadata.build.extraResources.some(item => {
      const relative = path.relative(path.resolve(packageDirectory, item.from), path.join(repo, source));
      return !relative.startsWith('..') && !path.isAbsolute(relative) &&
        path.posix.join('resources', item.to, relative.replaceAll('\\', '/')) === target;
    }), source);
  }
});

test('client verifier checks exact license bytes and rejects missing or changed copies', async t => {
  const root = await fixture(t), sources = path.join(root, 'sources'), packaged = path.join(root, 'package');
  for (const [source, target] of PROJECT_LICENSE_FILES) {
    await put(path.join(sources, source), 'original license ' + source + '\n');
    await put(path.join(packaged, target), 'original license ' + source + '\n');
  }
  await verifyProjectLicenseFiles(sources, packaged);
  const [source, target] = PROJECT_LICENSE_FILES[0];
  await fs.writeFile(path.join(packaged, target), 'different terms');
  await assert.rejects(verifyProjectLicenseFiles(sources, packaged), /PACKAGE_PROJECT_LICENSE_MISMATCH/);
  await fs.copyFile(path.join(sources, source), path.join(packaged, target));
  await fs.unlink(path.join(packaged, target));
  await assert.rejects(verifyProjectLicenseFiles(sources, packaged), {code: 'ENOENT'});
});

test('standalone export preserves all four pinned notice texts byte for byte', async t => {
  const {resources, output} = await exportFixture(t);
  await writeWindowsExportNotices(resources, output);
  assert.deepEqual((await fs.readdir(output)).sort(), [...notices].sort());
  for (const name of notices) assert.deepEqual(await fs.readFile(path.join(output, name)), await fs.readFile(path.join(resources, 'licenses', name)));
  const scope = await fs.readFile(path.join(output, 'CRAFTMINE-RUNTIME-NOTICES.md'), 'utf8');
  assert.match(scope, /not every file in an exported world/);
  assert.match(scope, /Existing third-party\nlicenses/);
});

test('standalone export rejects absent runtime license before writing notices', async t => {
  const {resources, output} = await exportFixture(t);
  await fs.unlink(path.join(resources, 'licenses/CRAFTMINE-RUNTIME-MIT.txt'));
  await assert.rejects(writeWindowsExportNotices(resources, output), {code: 'ENOENT'});
  assert.deepEqual(await fs.readdir(output), []);
});

test('standalone export rejects changed runtime scope and license before writing notices', async t => {
  for (const name of notices.slice(2)) {
    const {resources, output} = await exportFixture(t);
    await fs.appendFile(path.join(resources, 'licenses', name), '\nAll assets are now licensed.\n');
    await assert.rejects(writeWindowsExportNotices(resources, output), /EXPORT_NOTICE_HASH_MISMATCH/);
    assert.deepEqual(await fs.readdir(output), []);
  }
});
