import fs from 'node:fs/promises';
import path from 'node:path';

// These paths mirror electron-builder extraResources, relative to the repository
// and the packaged application. Keep license scope beside the unmodified texts.
export const PROJECT_LICENSE_FILES = Object.freeze([
  ['LICENSE', 'resources/licenses/LICENSE'],
  ['LICENSING.md', 'resources/licenses/LICENSING.md'],
  ['LICENSE.zh-CN.md', 'resources/licenses/LICENSE.zh-CN.md'],
  ['THIRD_PARTY_NOTICES.md', 'resources/licenses/THIRD_PARTY_NOTICES.md'],
  ['LICENSES/MIT.txt', 'resources/licenses/LICENSES/MIT.txt'],
  ['LICENSES/GPL-3.0-or-later.txt', 'resources/licenses/LICENSES/GPL-3.0-or-later.txt'],
  ['LICENSES/LGPL-3.0-or-later.txt', 'resources/licenses/LICENSES/LGPL-3.0-or-later.txt'],
]);

export async function verifyProjectLicenseFiles(repoRoot, packageRoot) {
  for (const [source, target] of PROJECT_LICENSE_FILES) {
    const [expected, actual] = await Promise.all([
      fs.readFile(path.join(repoRoot, source)), fs.readFile(path.join(packageRoot, target)),
    ]);
    if (!expected.equals(actual)) throw Error('PACKAGE_PROJECT_LICENSE_MISMATCH:' + target);
  }
}
