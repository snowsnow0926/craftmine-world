const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

// electron-builder normally warns and skips absent extraResources. A Windows
// game must refuse incomplete or stale inputs before producing an installer.
module.exports = async function beforePack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const root = path.resolve(context.packager.info.appDir, '../../../..');
  const build = path.join(root, 'desktop/build');
  try {
    const { fileHash, resourceInventory, verifyRuntimeResources } = await import(pathToFileURL(path.join(root, 'desktop/prepare-runtime-resources.mjs')).href);
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const manifest = JSON.parse(await fs.readFile(path.join(build, 'build-manifest.json'), 'utf8'));
    if (manifest.commit !== commit) throw Error('Build manifest belongs to another commit');
    await verifyRuntimeResources(path.join(build, 'runtime-resources'), commit);
    for (const artifact of manifest.artifacts) {
      if (await fileHash(path.join(root, artifact.path)) !== artifact.sha256) throw Error('Stale build artifact: ' + artifact.path);
    }
    for (const [directory, recorded] of [
      ['vendor/pi-desktop/apps/desktop/resources/plugins/craftmine.world', manifest.pluginFiles],
      ['vendor/pi-desktop/apps/desktop/out', manifest.clientFiles],
    ]) {
      if (JSON.stringify(await resourceInventory(path.join(root, directory))) !== JSON.stringify(recorded)) throw Error('Stale build directory: ' + directory);
    }
    await fs.access(path.join(root, 'vendor/pi-desktop/apps/desktop/resources/plugins/craftmine.world/main.cjs'));
    await fs.access(path.join(build, 'third-party/npm-inventory.json'));
  } catch (error) {
    throw Error('Windows packaging blocked: ' + error.message + '. Use desktop/build-client.ps1 with a clean checkout to prepare and verify the complete game.');
  }
};
