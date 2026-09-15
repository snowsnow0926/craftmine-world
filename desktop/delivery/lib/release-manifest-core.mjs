// Reproducible release manifest + package verification core (read-only).
//
// Facts only: every hash below is computed from bytes on disk or copied from a
// pinned lock/manifest. Nothing here downloads, executes a GUI, activates a
// window, sends input or writes inside an inspected tree.
//
// The packaged-file list and the artifact -> package path map deliberately mirror
// checkPackage() in ./preflight-core.mjs. REQUIRED_PACKAGE_FILES and
// PACKAGE_ARTIFACT_MAP are exported so a test can prove they have not drifted
// away from preflight-core instead of silently contradicting it.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {PROJECT_LICENSE_FILES} from '../../project-license-files.mjs';
import {
  PACKAGE_REQUIRED_FILES,
  checkGodotCache,
  loadLock,
  readJson,
  sha256 as sha256Pinned
} from './preflight-core.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const RELEASE_MANIFEST_FORMAT = 'craftmine.release-manifest/1';
export const PACKAGE_VERIFICATION_FORMAT = 'craftmine.package-verification/1';
export const MANIFEST_DIFF_FORMAT = 'craftmine.release-manifest-diff/1';

export const TOOLCHAIN_LOCK = 'desktop/godot/toolchain.lock.json';
export const BASE_ASSETS_DIR = 'desktop/delivery/base-assets';
export const BASE_IDS = ['first-person', 'side-view', 'top-down', 'mining-sandbox', 'creation-sandbox'];
export const BRIDGE_FILES = [
  'desktop/godot/web/bridge.js',
  'desktop/godot/web/shell.html',
  'desktop/godot/probes/shared/web_bridge.gd'
];
export const LOCKFILE_NAMES = ['pnpm-lock.yaml', 'package-lock.json', 'Cargo.lock'];

// Imported from preflight-core: it is the single source of truth for the files a
// built Windows package must contain. Re-exported under the release-manifest name.
export const REQUIRED_PACKAGE_FILES = [...PACKAGE_REQUIRED_FILES];

// Mirrors the `artifactMap` in preflight-core checkPackage(). Same keys, same targets.
export const PACKAGE_ARTIFACT_MAP = new Map([
  ['vendor/pi-desktop/target/release/pi-desktop-host-core.exe', 'resources/bin/pi-desktop-host-core.exe'],
  ['vendor/pi-desktop/target/release/craftmine-core.exe', 'resources/bin/craftmine-core.exe'],
  ['vendor/pi-desktop/packages/agent-runtime/dist-bundle/sidecar.js', 'resources/agent-runtime/sidecar.js'],
  ['vendor/pi-desktop/apps/desktop/resources/plugins/craftmine.world/manifest.json', 'resources/plugins/craftmine.world/manifest.json'],
  ['desktop/build/CraftmineWorld-source.zip', 'resources/source/CraftmineWorld-source.zip']
]);

// `*.pdb` is listed as optional: debug symbols are a leak, not a functional defect.
export const FORBIDDEN_PACKAGE_RULES = [
  {id: 'node-modules', kind: 'segment', value: 'node_modules', description: 'Dependency tree must never ship.'},
  {id: 'git-metadata', kind: 'segment', value: '.git', description: 'Git metadata must never ship.'},
  {id: 'test-results', kind: 'segment', value: 'test-results', description: 'Test output must never ship.'},
  {id: 'python-cache', kind: 'segment', value: '__pycache__', description: 'Interpreter cache must never ship.'},
  {id: 'virtualenv', kind: 'segment', value: '.venv', description: 'Virtual environment must never ship.'},
  {id: 'coverage', kind: 'segment', value: 'coverage', description: 'Coverage output must never ship.'},
  {id: 'pnpm-store', kind: 'segment', value: '.pnpm', description: 'Package-manager store must never ship.'},
  {id: 'env-file', kind: 'basenamePrefix', value: '.env', description: 'Environment/credential file must never ship.'},
  {id: 'log-file', kind: 'extension', value: '.log', description: 'Log file must never ship.'},
  {id: 'npmrc', kind: 'basename', value: '.npmrc', description: 'Registry credentials must never ship.'},
  {id: 'git-credentials', kind: 'basename', value: '.git-credentials', description: 'Git credentials must never ship.'},
  {id: 'ssh-private-key', kind: 'basename', value: 'id_rsa', description: 'Private key must never ship.'},
  {id: 'private-key', kind: 'extension', value: '.pem', except: ['cert.pem', 'cacert.pem', 'ca-bundle.pem'], description: 'Private key must never ship. A public CA bundle such as cert.pem is not a private key and is allowed.'},
  {id: 'pkcs12', kind: 'extension', value: '.p12', description: 'Signing material must never ship.'},
  {id: 'pfx', kind: 'extension', value: '.pfx', description: 'Signing material must never ship.'},
  {id: 'credentials-json', kind: 'basename', value: 'credentials.json', description: 'Credential store must never ship.'},
  {id: 'auth-json', kind: 'basename', value: 'auth.json', description: 'Credential store must never ship.'},
  {id: 'debug-symbols', kind: 'extension', value: '.pdb', optional: true, description: 'Debug symbols leak source paths; optional to strip.'}
];

const MAX_SCAN_ENTRIES = 200000;
const MAX_HASH_BYTES = 16 * 1024 ** 3;
const STREAM_THRESHOLD = 8 * 1024 * 1024;

const fail = (code, message, extra = {}) => ({code, message, ...extra});
const toPosix = value => value.replaceAll('\\', '/');

/** SHA-256 of a regular file. Reuses preflight-core's buffered hasher for small
 *  files and streams larger ones so the 1.28 GB template archive does not have to
 *  be materialised in memory. */
export function hashFile(file) {
  const info = fs.lstatSync(file);
  if (info.isSymbolicLink()) throw fail('LINK_DENIED', 'Refusing to hash a link: ' + file);
  if (!info.isFile()) throw fail('NOT_A_FILE', 'Refusing to hash a non-regular file: ' + file);
  if (info.size <= STREAM_THRESHOLD) return sha256Pinned(file);
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(65536);
  const fd = fs.openSync(file, 'r');
  try {
    for (;;) {
      const length = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!length) break;
      hash.update(buffer.subarray(0, length));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

export function forbiddenRuleFor(relative) {
  const segments = toPosix(relative).split('/').filter(Boolean);
  const base = (segments.at(-1) ?? '').toLowerCase();
  const extension = path.posix.extname(base);
  for (const rule of FORBIDDEN_PACKAGE_RULES) {
    if (rule.except && rule.except.includes(base)) continue;
    if (rule.kind === 'segment' && segments.some(segment => segment.toLowerCase() === rule.value)) return rule;
    if (rule.kind === 'basename' && base === rule.value) return rule;
    if (rule.kind === 'basenamePrefix' && (base === rule.value || base.startsWith(rule.value + '.'))) return rule;
    if (rule.kind === 'extension' && extension === rule.value) return rule;
  }
  return null;
}

function run(root, file, args, {timeout = 20000, capture = true} = {}) {
  try {
    return execFileSync(file, args, {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      timeout,
      stdio: [capture ? 'ignore' : 'ignore', capture ? 'pipe' : 'ignore', 'ignore']
    }).trim();
  } catch {
    return null;
  }
}

function runTool(root, candidates, args, options) {
  for (const candidate of candidates) {
    const output = run(root, candidate, args, options);
    if (output !== null) return output;
  }
  return null;
}

/** Recursive file listing without following links. Directories are visited in a
 *  deterministic order so aggregate hashes are stable across machines. */
export function walkFiles(root, relativeDirectory, {maxEntries = MAX_SCAN_ENTRIES, onLink = null, onOther = null} = {}) {
  const start = relativeDirectory ? path.join(root, relativeDirectory) : root;
  const files = [];
  const stack = [{directory: start, relative: relativeDirectory ? toPosix(relativeDirectory) : ''}];
  let entries = 0;
  while (stack.length) {
    const current = stack.pop();
    if (!fs.existsSync(current.directory)) continue;
    for (const name of fs.readdirSync(current.directory).sort()) {
      if (++entries > maxEntries) throw fail('SCAN_INCOMPLETE', 'Entry limit exceeded under ' + (current.relative || '.'));
      const absolute = path.join(current.directory, name);
      const relative = current.relative ? current.relative + '/' + name : name;
      const info = fs.lstatSync(absolute);
      if (info.isSymbolicLink()) { if (onLink) onLink(relative); continue; }
      if (info.isDirectory()) stack.push({directory: absolute, relative});
      else if (info.isFile()) files.push({path: relative, absolute, bytes: info.size});
      else if (onOther) onOther(relative);
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function entryFor(root, relative, extra = {}) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) return null;
  const info = fs.lstatSync(absolute);
  if (info.isSymbolicLink()) return {path: toPosix(relative), bytes: null, sha256: null, present: false, link: true, ...extra};
  if (!info.isFile()) return null;
  return {path: toPosix(relative), bytes: info.size, sha256: hashFile(absolute), present: true, ...extra};
}

function directoryEntries(root, relativeDirectory, extra = {}) {
  return walkFiles(root, relativeDirectory).map(file => ({
    path: file.path,
    bytes: file.bytes,
    sha256: hashFile(file.absolute),
    present: true,
    ...extra
  }));
}

export function aggregateHash(entries) {
  const hash = createHash('sha256');
  for (const entry of [...entries].sort((a, b) => String(a.path).localeCompare(String(b.path)))) {
    hash.update(toPosix(String(entry.path)));
    hash.update('\0');
    hash.update(String(entry.bytes ?? ''));
    hash.update('\0');
    hash.update(String(entry.sha256 ?? ''));
    hash.update('\n');
  }
  return hash.digest('hex');
}

function component(id, {version = null, source = null, files = [], status = 'verified', notes = '', ...extra} = {}) {
  return {
    id,
    version,
    source: source ?? {path: null, commit: null, tag: null},
    files,
    status,
    notes,
    ...extra
  };
}

export function collectIdentity(root) {
  const commit = run(root, 'git', ['rev-parse', 'HEAD']);
  const shortCommit = run(root, 'git', ['rev-parse', '--short', 'HEAD']);
  const commitDate = run(root, 'git', ['show', '-s', '--format=%cI', 'HEAD']);
  const statusText = run(root, 'git', ['status', '--porcelain']);
  let packageJson = null;
  try {
    packageJson = readJson(path.join(root, 'package.json'));
  } catch {}
  let buildManifest = null;
  try {
    buildManifest = readJson(path.join(root, 'desktop/build/build-manifest.json'));
  } catch {}
  return {
    commit,
    shortCommit,
    commitDate,
    dirty: statusText === null ? null : statusText.length > 0,
    clientVersion: packageJson?.version ?? null,
    productName: buildManifest?.product ?? packageJson?.productName ?? packageJson?.name ?? null
  };
}

function collectClient(root, identity) {
  const files = [];
  const push = entry => {
    if (entry) files.push(entry);
  };
  push(entryFor(root, 'package.json', {role: 'client-identity'}));
  push(entryFor(root, 'desktop/windows-USER_GUIDE.zh-CN.md', {
    role: 'client-guide',
    packagePath: 'resources/source/USER_GUIDE.zh-CN.md'
  }));
  push(entryFor(root, 'desktop/windows-upgrade-guard.ps1', {
    role: 'client-upgrade-guard',
    packagePath: 'resources/source/windows-upgrade-guard.ps1'
  }));
  return component('client', {
    version: identity.clientVersion,
    source: {path: 'package.json', commit: identity.commit, tag: null},
    files,
    status: files.length ? 'verified' : 'absent',
    notes: 'Client identity plus the packaged client documents. The Electron runtime ' +
      '(Craftmine World.exe, resources/app.asar) is a build output; it is pinned only when ' +
      'create is given --package, and those pins are package snapshots, not reproducible builds.'
  });
}

function collectEngine(root, lock, options) {
  const files = [];
  if (lock?.editor) {
    files.push({
      path: lock.editor.file,
      bytes: typeof lock.editor.bytes === 'number' ? lock.editor.bytes : null,
      sha256: lock.editor.sha256 ?? null,
      present: false,
      role: 'editor-archive',
      pinnedFrom: TOOLCHAIN_LOCK,
      cachePath: lock.editor.file,
      url: lock.editor.url ?? null
    });
    files.push({
      path: 'editor/' + lock.editor.executable,
      bytes: null,
      sha256: lock.editor.executableSha256 ?? null,
      present: false,
      role: 'editor-executable',
      pinnedFrom: TOOLCHAIN_LOCK,
      cachePath: 'editor/' + lock.editor.executable
    });
  }
  const cache = options.cacheDirectory ? verifyEngineCache(root, options.cacheDirectory) : null;
  const notes = ['Engine bytes are pinned by ' + TOOLCHAIN_LOCK + '. The archive and executable live in the ' +
    'shared engine cache, never inside the repository or the package. Pass --cache <dir> to hash that cache ' +
    'with preflight-core checkGodotCache.'];
  if (options.cacheDirectory) notes.push('Cache inspection requested: ' + path.resolve(options.cacheDirectory));
  return component('engine', {
    version: lock?.version ?? null,
    source: {url: lock?.editor?.url ?? lock?.releaseUrl ?? null, path: TOOLCHAIN_LOCK, commit: null, tag: lock?.version ?? null},
    files,
    status: lock ? 'verified' : 'absent',
    notes: notes.join(' '),
    cache
  });
}

function verifyEngineCache(root, cacheDirectory) {
  const absolute = path.resolve(cacheDirectory);
  if (!fs.existsSync(absolute)) {
    return {ok: false, failures: [fail('CACHE_DIRECTORY_MISSING', 'Engine cache is absent: ' + absolute)], facts: {}};
  }
  try {
    return checkGodotCache(root, absolute);
  } catch (error) {
    return {ok: false, failures: [fail('CACHE_INSPECTION_FAILED', error.message)], facts: {}};
  }
}

function collectExportTemplates(root, lock) {
  const files = [];
  const templates = lock?.exportTemplates;
  if (templates) {
    files.push({
      path: templates.file,
      bytes: typeof templates.bytes === 'number' ? templates.bytes : null,
      sha256: templates.sha256 ?? null,
      present: false,
      role: 'export-templates-archive',
      pinnedFrom: TOOLCHAIN_LOCK,
      cachePath: templates.file,
      url: templates.url ?? null
    });
    if (templates.webThreadedRelease) {
      files.push({
        path: 'templates/' + templates.webThreadedRelease.file,
        bytes: typeof templates.webThreadedRelease.bytes === 'number' ? templates.webThreadedRelease.bytes : null,
        sha256: templates.webThreadedRelease.sha256 ?? null,
        present: false,
        role: 'web-threaded-template',
        pinnedFrom: TOOLCHAIN_LOCK,
        cachePath: 'templates/' + templates.webThreadedRelease.file
      });
    }
    if (templates.webRelease) {
      files.push({
        path: 'templates/' + templates.webRelease.file,
        bytes: typeof templates.webRelease.bytes === 'number' ? templates.webRelease.bytes : null,
        sha256: templates.webRelease.sha256 ?? null,
        present: false,
        role: 'web-single-thread-template',
        pinnedFrom: TOOLCHAIN_LOCK,
        cachePath: 'templates/' + templates.webRelease.file
      });
    }
  }
  return component('exportTemplates', {
    version: lock?.version ?? null,
    source: {url: templates?.url ?? lock?.releaseUrl ?? null, path: TOOLCHAIN_LOCK, commit: null, tag: lock?.version ?? null},
    files,
    status: templates ? 'verified' : 'absent',
    notes: 'Template archives are pinned by ' + TOOLCHAIN_LOCK + '; they live in the shared engine cache. ' +
      'webThreadedRelease is the preferred Web preview template (lock webPreview.preferredTemplate).'
  });
}

function collectBroker(root, options) {
  const files = [];
  const probes = [];
  for (const relative of [
    'vendor/pi-desktop/target/release/pi-desktop-host-core.exe',
    'vendor/pi-desktop/target/release/craftmine-core.exe'
  ]) {
    const entry = entryFor(root, relative, {
      role: 'native-broker',
      packagePath: PACKAGE_ARTIFACT_MAP.get(relative) ?? null
    });
    if (!entry) continue;
    let version = null;
    let versionSource = 'not-probed';
    if (options.probeBinaries) {
      const output = run(root, path.join(root, relative), ['--version'], {timeout: 10000});
      version = output ? (output.split(/\r?\n/)[0] || null) : null;
      versionSource = output ? 'binary --version' : 'probe-failed';
    }
    files.push({...entry, version, versionSource});
    probes.push({path: relative, probed: !!options.probeBinaries});
  }
  const absent = files.length === 0;
  return component('broker', {
    version: files.find(file => file.version)?.version ?? null,
    source: {path: 'vendor/pi-desktop/target/release', commit: null, tag: null},
    files,
    status: absent ? 'absent' : 'verified',
    notes: absent
      ? 'Native broker binaries are build outputs of vendor/pi-desktop and are absent from this tree. ' +
        'They are expected package files (resources/bin/*.exe) but cannot be pinned without a built binary.'
      : 'Native broker binaries hashed in place. --version is only read with --probe-binaries so no GUI is started.',
    packagePaths: [
      'resources/bin/pi-desktop-host-core.exe',
      'resources/bin/craftmine-core.exe'
    ],
    probes
  });
}

function collectBases(root) {
  const bases = {};
  for (const baseId of BASE_IDS) {
    const directory = 'desktop/godot/bases/' + baseId;
    const manifestCandidates = [directory + '/base_manifest.json', directory + '/manifest.json'];
    const manifestRelative = manifestCandidates.find(candidate => fs.existsSync(path.join(root, candidate))) ?? null;
    // The shipped-base provenance manifest is `bases-<id>.json`. A same-name probe
    // manifest must not be accepted, so the declared sourceDirectory is checked too.
    const provenanceRelative = [BASE_ASSETS_DIR + '/bases-' + baseId + '.json', BASE_ASSETS_DIR + '/' + baseId + '.json']
      .find(candidate => {
        if (!fs.existsSync(path.join(root, candidate))) return false;
        try {
          return readJson(path.join(root, candidate)).sourceDirectory === directory;
        } catch {
          return false;
        }
      }) ?? null;
    const expectedProvenance = BASE_ASSETS_DIR + '/bases-' + baseId + '.json';
    const links = [];
    if (!fs.existsSync(path.join(root, directory))) {
      bases[baseId] = component('base:' + baseId, {
        status: 'absent',
        source: {path: directory, commit: null, tag: null},
        notes: 'Base directory is absent.'
      });
      continue;
    }
    let manifest = null;
    let manifestError = null;
    if (manifestRelative) {
      try {
        manifest = readJson(path.join(root, manifestRelative));
      } catch (error) {
        manifestError = error.message;
      }
    }
    const files = walkFiles(root, directory, {onLink: value => links.push(value)}).map(file => ({
      path: file.path,
      bytes: file.bytes,
      sha256: hashFile(file.absolute),
      present: true,
      role: 'base-file'
    }));
    const engine = manifest
      ? {
          name: manifest.engine?.name ?? 'godot',
          version: manifest.engine?.version ?? manifest.godotVersion ?? null,
          renderer: manifest.engine?.renderer ?? manifest.renderer ?? null,
          scriptLanguage: manifest.engine?.scriptLanguage ?? manifest.language ?? null
        }
      : null;
    const provenanceEntry = provenanceRelative ? entryFor(root, provenanceRelative, {role: 'delivery-provenance'}) : null;
    let provenance = null;
    if (provenanceEntry) {
      let declared = null;
      try {
        const parsed = readJson(path.join(root, provenanceRelative));
        declared = {
          format: parsed.format ?? null,
          baseId: parsed.baseId ?? null,
          sourceDirectory: parsed.sourceDirectory ?? null,
          engine: parsed.engine ?? null
        };
        if (declared.sourceDirectory && fs.existsSync(path.join(root, declared.sourceDirectory))) {
          declared.sourceDirectoryFiles = walkFiles(root, declared.sourceDirectory).length;
          declared.sourceDirectoryAggregateSha256 = aggregateHash(directoryEntries(root, declared.sourceDirectory));
        } else {
          declared.sourceDirectoryFiles = 0;
          declared.sourceDirectoryAggregateSha256 = null;
        }
      } catch (error) {
        declared = {error: error.message};
      }
      provenance = {...provenanceEntry, declared};
    } else {
      provenance = {
        status: 'absent',
        path: null,
        present: false,
        expectedPath: expectedProvenance,
        source: 'desktop/delivery/base-assets + docs/ASSET_LIBRARY_DEVELOPMENT_PLAN.md',
        owner: 'H',
        note: 'No delivery provenance manifest covers ' + directory + ' yet; expected ' + expectedProvenance + '.'
      };
    }
    const status = manifestError ? 'absent' : manifest ? 'verified' : 'absent';
    const notes = [
      'baseId=' + (manifest?.baseId ?? baseId) + '; version=' + (manifest?.baseVersion ?? 'null') +
        '; manifest=' + (manifestRelative ?? 'absent') + '; files=' + files.length + '.',
      'Aggregate content hash covers every regular file under the base directory (repository-relative path, ' +
        'bytes, sha256), sorted by path.',
      links.length ? 'Links were found and excluded: ' + links.join(', ') : 'No links inside the base directory.',
      provenance.present === false
        ? 'Delivery provenance manifest ' + expectedProvenance + ' is absent; recorded as pending/absent, no hash invented.'
        : 'Delivery provenance manifest ' + provenanceRelative + ' pins the base delivery bytes.'
    ];
    bases[baseId] = component('base:' + baseId, {
      version: manifest?.baseVersion ?? null,
      source: {path: manifestRelative ?? directory, commit: null, tag: null},
      files,
      status,
      notes: notes.join(' '),
      baseId: manifest?.baseId ?? baseId,
      // Authored declarations only; an ID does not prove automatic installation.
      declaredComponentIds: (Array.isArray(manifest?.components) ? manifest.components : []).map(entry => entry.id).filter(id => typeof id === 'string').sort(),
      engine,
      fileCount: files.length,
      aggregateSha256: aggregateHash(files),
      links,
      provenance
    });
  }
  return bases;
}

function collectBridge(root) {
  const files = [];
  for (const relative of BRIDGE_FILES) {
    const entry = entryFor(root, relative, {role: 'web-bridge'});
    if (entry) files.push(entry);
  }
  return component('bridge', {
    version: null,
    source: {path: 'desktop/godot/web', commit: null, tag: null},
    files,
    status: files.length === BRIDGE_FILES.length ? 'verified' : files.length ? 'verified' : 'absent',
    notes: 'Godot Web host bridge sources. bridge.js and shell.html ship in the Web export; ' +
      'web_bridge.gd is the shared probe interface. Files that are absent are simply not listed.'
  });
}

function findLockfiles(root) {
  const skip = new Set([
    'node_modules', '.git', '.pnpm', 'target', 'dist', 'dist-bundle', 'build', 'test-results',
    '.gradle', '.godot', '.cache', '.venv', '__pycache__', 'coverage', '.next', 'out', '.turbo',
    '.cargo', 'vendor_imports', '.pi-desktop'
  ]);
  const found = [];
  const stack = [{directory: root, relative: '', depth: 0}];
  let entries = 0;
  while (stack.length) {
    const current = stack.pop();
    if (current.depth > 6) continue;
    let names;
    try {
      names = fs.readdirSync(current.directory);
    } catch {
      continue;
    }
    for (const name of names.sort()) {
      if (++entries > 50000) return found.sort((a, b) => a.path.localeCompare(b.path));
      const absolute = path.join(current.directory, name);
      const relative = current.relative ? current.relative + '/' + name : name;
      let info;
      try {
        info = fs.lstatSync(absolute);
      } catch {
        continue;
      }
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) {
        if (!skip.has(name)) stack.push({directory: absolute, relative, depth: current.depth + 1});
      } else if (LOCKFILE_NAMES.includes(name)) {
        found.push({path: toPosix(relative), absolute, bytes: info.size});
      }
    }
  }
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

function collectDependencies(root) {
  const files = findLockfiles(root).map(file => ({
    path: file.path,
    bytes: file.bytes,
    sha256: hashFile(file.absolute),
    present: true,
    role: 'lockfile'
  }));
  const tools = {
    node: process.version,
    npm: runTool(root, ['npm.cmd', 'npm'], ['--version']),
    pnpm: runTool(root, ['pnpm.cmd', 'pnpm'], ['--version']),
    cargo: runTool(root, ['cargo'], ['--version']),
    rustc: runTool(root, ['rustc'], ['--version'])
  };
  return component('dependencies', {
    version: null,
    source: {path: files[0]?.path ?? 'package.json', commit: null, tag: null},
    files,
    status: files.length ? 'verified' : 'absent',
    notes: 'Lockfiles found by a bounded scan (node_modules/.git/target/build/dist/test-results and ' +
      'similar generated directories are skipped). Tool versions are read-only --version output.',
    tools
  });
}

function collectLicenses(root) {
  const files = [];
  const push = entry => {
    if (entry) files.push(entry);
  };
  for (const file of directoryEntries(root, 'desktop/godot/licenses')) {
    files.push({...file, role: 'engine-notice'});
  }
  push(entryFor(root, 'desktop/UPSTREAM.json', {role: 'provenance', packagePath: 'resources/licenses/UPSTREAM.json'}));
  // Mirror the current electron-builder mapping. Historical generated audit
  // notices remain repository evidence, not the client build's notice source.
  push(entryFor(root, 'desktop/windows-NOTICES.md', {role: 'product-notices', packagePath: 'resources/licenses/CRAFTMINE-NOTICES.md'}));
  push(entryFor(root, 'desktop/delivery/licensing/notices/CRAFTMINE-NOTICES.md', {role: 'historical-audit-notices', packagePath: null}));
  for (const [source, target] of PROJECT_LICENSE_FILES) push(entryFor(root, source, {role: 'project-license', packagePath: target}));
  push(entryFor(root, 'desktop/delivery/licensing/offline-entry.json', {role: 'offline-licence-entry', packagePath: null}));
  push(entryFor(root, 'vendor/pi-desktop/LICENSE', {role: 'lgpl-text', packagePath: 'resources/licenses/PI-Desktop-LICENSE.txt'}));
  const seen = new Set();
  const unique = [];
  for (const file of files) {
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    unique.push(file);
  }
  return component('licenses', {
    version: null,
    source: {path: 'desktop/godot/licenses', commit: null, tag: null},
    files: unique,
    status: unique.length ? 'verified' : 'absent',
    notes: 'desktop/godot/licenses/** (engine notices and the notice manifest), desktop/UPSTREAM.json, ' +
      'the project license texts and scope, historical audit notices, the offline ' +
      'licence entry, the packaged desktop/windows-NOTICES.md and the vendor LGPL text that the package ships as ' +
      'resources/licenses/PI-Desktop-LICENSE.txt.'
  });
}

function collectGitBundle(root, packageDirectory) {
  const pinRelative = 'desktop/delivery/git-bundle.json';
  const pinEntry = entryFor(root, pinRelative, {role: 'git-bundle-pin'});
  const pin = pinEntry ? readJson(path.join(root, pinRelative)) : null;
  let staged = null;
  if (packageDirectory) {
    const stagedPath = path.join(packageDirectory, 'resources/git/GIT-BUNDLE.json');
    if (fs.existsSync(stagedPath)) {
      try {
        const record = readJson(stagedPath);
        staged = {
          fileCount: record.fileCount ?? null,
          totalBytes: record.totalBytes ?? null,
          versionOutput: record.versionOutput ?? null,
          entry: record.entry ?? null
        };
      } catch (error) {
        staged = {error: 'GIT-BUNDLE.json is not valid JSON: ' + error.message};
      }
    }
  }
  const notes = pin
    ? 'Pinned ' + pin.id + ' ' + pin.version + ' (archive sha256 ' + pin.archive.sha256 + '). R1 requires a bundled Git: '
      + 'CRAFTMINE_BUNDLED_GIT or an exe-adjacent ' + pin.layout.entry + '; without it content.gitInfo reports pathFallback. '
      + (staged
        ? 'A staged tree is present in the supplied package (' + staged.fileCount + ' files, ' + staged.totalBytes + ' bytes, ' + staged.versionOutput + ').'
        : 'No staged resources/git tree was supplied with --package.')
    : 'No git-bundle pin exists in this tree.';
  return component('git', {
    version: pin?.version ?? null,
    source: {path: pin?.archive?.url ?? pinRelative, commit: null, tag: pin?.version ?? null},
    files: pinEntry ? [pinEntry] : [],
    status: pinEntry ? (staged ? 'verified' : 'pending-package') : 'absent',
    notes,
    contract: pin?.contract ?? null,
    staged
  });
}

function collectContentBoundaries(root) {
  const relativePaths = [
    'desktop/delivery/content-boundaries.json',
    'desktop/delivery/content-boundary-check.mjs',
    'desktop/delivery/CONTENT_BOUNDARIES.md'
  ];
  const files = relativePaths.map(relative => entryFor(root, relative, {role: 'content-boundary'})).filter(Boolean);
  const spec = fs.existsSync(path.join(root, relativePaths[0])) ? readJson(path.join(root, relativePaths[0])) : null;
  const boundaries = spec
    ? Object.values(spec.boundaries ?? {}).map(boundary => ({id: boundary.id, kind: boundary.kind, status: boundary.status}))
    : [];
  return component('contentBoundaries', {
    version: null,
    source: {path: relativePaths[0], commit: null, tag: null},
    files,
    status: files.length ? 'verified' : 'absent',
    notes: 'Client install, creation-share package, portable backup and standalone-game boundaries with the paths that must not cross them. '
      + 'standalone-game is declared but pending: no export layout exists in the integrated trees.',
    boundaries
  });
}

function collectToolingM() {
  const expectedPaths = [
    {
      status: 'pending-integration',
      expectedPath: 'vendor/pi-desktop/crates/craftmine-core/src/content_history/',
      source: 'docs/dispatch-prompts/godot-remaining-20260910/M-git-content-history.md',
      owner: 'M',
      capability: 'config-isolation + managed Git adapter (VM0)'
    },
    {
      status: 'pending-integration',
      expectedPath: 'vendor/pi-desktop/crates/craftmine-core/src/content_history/',
      source: 'docs/VERSION_MANAGEMENT_DEVELOPMENT_PLAN.md',
      owner: 'M',
      capability: 'source history, branches, diff and recovery (VM1/VM2/VM3)'
    },
    {
      status: 'pending-integration',
      expectedPath: 'craftmine.assets.lock.json',
      source: 'docs/VERSION_MANAGEMENT_DEVELOPMENT_PLAN.md',
      owner: 'M',
      capability: 'shared content reference contract, format craftmine.assets-lock/1 (section 5)'
    },
    {
      status: 'pending-integration',
      expectedPath: 'tests/godot-remaining/M/',
      source: 'docs/dispatch-prompts/godot-remaining-20260910/M-git-content-history.md',
      owner: 'M',
      capability: 'task tests'
    },
    {
      status: 'pending-integration',
      expectedPath: 'docs/dispatch-reports/godot-remaining/M/',
      source: 'docs/dispatch-prompts/godot-remaining-20260910/M-git-content-history.md',
      owner: 'M',
      capability: 'task report and evidence'
    }
  ];
  return component('tooling:m', {
    version: null,
    source: {path: 'docs/VERSION_MANAGEMENT_DEVELOPMENT_PLAN.md', commit: null, tag: null},
    files: [],
    status: 'pending-integration',
    notes: 'VM0–VM4 content history is implemented on branch codex/godot-round2-r1-20260910 ' +
      '(commit 62a700f13f061e1b5d8cafdc6de33ee5ec536b87) but is not integrated in this worktree. ' +
      'No hash is recorded because those bytes are not in this tree; consume them after the main task merges R1.',
    availableAt: {
      branch: 'codex/godot-round2-r1-20260910',
      commit: '62a700f13f061e1b5d8cafdc6de33ee5ec536b87',
      report: 'docs/dispatch-reports/godot-round2/R1/REPORT.md',
      interface: 'content.gitInfo, content.status and the content.* RPC surface'
    },
    owner: 'M',
    expectedPaths
  });
}

function collectToolingN() {
  const expectedPaths = [
    {
      status: 'pending-integration',
      expectedPath: 'vendor/pi-desktop/crates/craftmine-core/src/asset_catalog/',
      source: 'docs/dispatch-prompts/godot-remaining-20260910/N-assets-and-previews.md',
      owner: 'N',
      capability: 'asset library import, search, preview and dependency closure (AL0–AL5)'
    },
    {
      status: 'pending-integration',
      expectedPath: 'craftmine.assets.lock.json',
      source: 'docs/ASSET_LIBRARY_DEVELOPMENT_PLAN.md',
      owner: 'N',
      capability: 'full pinned dependency list, format craftmine.assets-lock/1 (section 5)'
    },
    {
      status: 'pending-integration',
      expectedPath: 'tests/godot-remaining/N/',
      source: 'docs/dispatch-prompts/godot-remaining-20260910/N-assets-and-previews.md',
      owner: 'N',
      capability: 'task tests'
    },
    {
      status: 'pending-integration',
      expectedPath: 'docs/dispatch-reports/godot-remaining/N/',
      source: 'docs/dispatch-prompts/godot-remaining-20260910/N-assets-and-previews.md',
      owner: 'N',
      capability: 'task report and evidence'
    }
  ];
  return component('tooling:n', {
    version: null,
    source: {path: 'docs/ASSET_LIBRARY_DEVELOPMENT_PLAN.md', commit: null, tag: null},
    files: [],
    status: 'pending-integration',
    notes: 'AL0–AL5 asset catalog, search, preview and dependency list are implemented on branch ' +
      'codex/godot-round2-r6-20260910 (commit 64948746fa052411669d776d19e81c76ee35d518) but are not integrated ' +
      'in this worktree. No hash is recorded because those bytes are not in this tree.',
    availableAt: {
      branch: 'codex/godot-round2-r6-20260910',
      commit: '64948746fa052411669d776d19e81c76ee35d518',
      report: 'docs/dispatch-reports/godot-round2/R6/INTERFACE_R6.md',
      interface: 'asset.search, asset.previewBegin, asset.previewRead, asset.previewFinish'
    },
    owner: 'N',
    expectedPaths
  });
}

function requiredPackagePaths(manifest) {
  const required = new Map();
  for (const relative of REQUIRED_PACKAGE_FILES) {
    required.set(relative, {path: relative, origin: 'preflight-core checkPackage required list'});
  }
  for (const {component: entry} of listComponents(manifest)) {
    for (const file of entry.files ?? []) {
      if (file?.packagePath) required.set(file.packagePath, {path: file.packagePath, origin: entry.id + ':' + file.path});
    }
  }
  return required;
}

/** When --package is given, every required package file that has no source-derived
 *  pin is recorded as a package snapshot. A snapshot proves byte identity with a
 *  recorded artifact; it does not prove reproducibility from source. */
function applyPackageSnapshot(components, root, packageDirectory) {
  const absolute = path.resolve(packageDirectory);
  if (!fs.existsSync(absolute)) return;
  const alreadyPinned = new Set();
  const collect = entry => {
    for (const file of entry.files ?? []) if (file?.packagePath) alreadyPinned.add(file.packagePath);
  };
  collect(components.client);
  for (const base of Object.values(components.bases)) collect(base);
  collect(components.licenses);
  collect(components.broker);
  const client = components.client;
  for (const relative of REQUIRED_PACKAGE_FILES) {
    if (alreadyPinned.has(relative)) continue;
    const entry = entryFor(absolute, relative, {
      role: 'packaged-file',
      packagePath: relative,
      pinnedFrom: 'package-snapshot',
      reproducible: false
    });
    if (!entry) continue;
    client.files.push({...entry, path: relative});
    alreadyPinned.add(relative);
  }
  client.notes += ' Package snapshot pins were recorded from ' + absolute +
    ' for required package files that have no source-derived pin (pinnedFrom=package-snapshot).';
}

function computeTotals(components) {
  const byPath = new Map();
  const visit = entry => {
    for (const file of entry.files ?? []) {
      if (!file?.path) continue;
      if (byPath.has(file.path)) continue;
      byPath.set(file.path, file);
    }
  };
  for (const value of Object.values(components)) {
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value.files) || typeof value.status === 'string') visit(value);
    else for (const nested of Object.values(value)) if (nested && typeof nested === 'object') visit(nested);
  }
  let files = 0;
  let bytes = 0;
  let presentFiles = 0;
  let presentBytes = 0;
  for (const file of byPath.values()) {
    files++;
    if (typeof file.bytes === 'number') bytes += file.bytes;
    if (file.present !== false) {
      presentFiles++;
      if (typeof file.bytes === 'number') presentBytes += file.bytes;
    }
  }
  return {
    files,
    bytes,
    presentFiles,
    presentBytes,
    pinnedOnlyFiles: files - presentFiles,
    pinnedOnlyBytes: bytes - presentBytes,
    note: 'Unique file paths across every component. pinnedOnly counts lock-pinned inputs that live in the ' +
      'shared engine cache or as build outputs, not in the repository.'
  };
}

export function listComponents(manifest) {
  const out = [];
  for (const [key, value] of Object.entries(manifest.components ?? {})) {
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value.files) || typeof value.status === 'string') out.push({key, component: value});
    else for (const [nestedKey, nested] of Object.entries(value)) {
      if (nested && typeof nested === 'object') out.push({key: key + '.' + nestedKey, component: nested});
    }
  }
  return out;
}

export function createReleaseManifest(root, options = {}) {
  const resolvedRoot = path.resolve(root);
  if (!fs.existsSync(resolvedRoot)) throw fail('ROOT_MISSING', 'Root directory is absent: ' + resolvedRoot);
  let lock = null;
  const warnings = [];
  try {
    lock = loadLock(resolvedRoot);
  } catch (error) {
    warnings.push('Toolchain lock unreadable: ' + error.message);
  }
  const identity = collectIdentity(resolvedRoot);
  const components = {
    client: collectClient(resolvedRoot, identity),
    engine: collectEngine(resolvedRoot, lock, options),
    exportTemplates: collectExportTemplates(resolvedRoot, lock),
    broker: collectBroker(resolvedRoot, options),
    bases: collectBases(resolvedRoot),
    bridge: collectBridge(resolvedRoot),
    dependencies: collectDependencies(resolvedRoot),
    licenses: collectLicenses(resolvedRoot),
    git: collectGitBundle(resolvedRoot, options.packageDirectory ?? null),
    contentBoundaries: collectContentBoundaries(resolvedRoot),
    tooling: {m: collectToolingM(), n: collectToolingN()}
  };
  if (options.packageDirectory) applyPackageSnapshot(components, resolvedRoot, options.packageDirectory);
  const required = requiredPackagePaths({components});
  const manifest = {
    format: RELEASE_MANIFEST_FORMAT,
    generatedAt: options.now ?? new Date().toISOString(),
    identity,
    components,
    totals: computeTotals(components),
    reproducibility: {
      pinnedInputs: [
        {id: 'git-commit', source: 'git rev-parse HEAD', value: identity.commit, dirty: identity.dirty},
        {id: 'toolchain-lock', source: TOOLCHAIN_LOCK, sha256: entryFor(resolvedRoot, TOOLCHAIN_LOCK)?.sha256 ?? null},
        {id: 'engine-and-templates', source: TOOLCHAIN_LOCK, note: 'editor archive/exe, tpz and both web zips are pinned by bytes+sha256'},
        {id: 'base-manifests', source: 'desktop/godot/bases/*/{base_manifest.json,manifest.json}'},
        {id: 'base-delivery-provenance', source: BASE_ASSETS_DIR + '/*.json'},
        {id: 'notice-manifest', source: 'desktop/godot/licenses/notices.manifest.json'},
        {id: 'lockfiles', source: 'bounded scan for ' + LOCKFILE_NAMES.join(', ')},
        {id: 'bridge-sources', source: BRIDGE_FILES.join(', ')},
        {id: 'git-bundle', source: 'desktop/delivery/git-bundle.json (pinned MinGit archive url/bytes/sha256 and the R1 discovery contract)'},
        {id: 'content-boundaries', source: 'desktop/delivery/content-boundaries.json (client, share package, portable backup, standalone game)'},
        {id: 'package-required-files', source: 'preflight-core checkPackage required list + manifest packagePath pins',
          value: [...required.keys()].sort()}
      ],
      limits: [
        'Read-only: no download, no GUI, no window activation, no input, no write inside an inspected tree.',
        'A passing development build is not a verified package. verify requires --package and reports every ' +
          'required file that is absent, unpinned or byte-different.',
        'Byte-identical native/NSIS outputs are not claimed; hashes prove these bytes, not reproducibility of ' +
          'the compiler or installer toolchain.',
        'Engine and export-template bytes are pinned from the lock and live in the shared cache; create only ' +
          'hashes them when --cache is supplied.',
        'package-snapshot pins prove byte identity with a recorded artifact, not reproducibility from source.',
        'Planned M/N capabilities are recorded as pending-integration and carry no hash.',
        warnings.length ? warnings.join(' ') : 'No warnings.'
      ]
    }
  };
  return manifest;
}

export function verifyPackage(manifest, packageDirectory, options = {}) {
  const failures = [];
  const warnings = [];
  const record = {
    format: PACKAGE_VERIFICATION_FORMAT,
    generatedAt: options.now ?? new Date().toISOString(),
    manifestFormat: manifest?.format ?? null,
    manifestIdentity: manifest?.identity ?? null,
    packageDirectory: packageDirectory ? path.resolve(packageDirectory) : null,
    ok: false,
    missing: [],
    mismatch: [],
    unpinned: [],
    forbidden: [],
    optionalForbidden: [],
    extra: {count: 0, sample: [], strict: !!options.strictExtra},
    links: [],
    pendingComponents: [],
    selfAttestation: null,
    facts: {},
    failures,
    warnings
  };
  if (!manifest || manifest.format !== RELEASE_MANIFEST_FORMAT) {
    failures.push(fail('MANIFEST_FORMAT', 'Unsupported or missing release manifest format: ' + (manifest?.format ?? 'none')));
    return record;
  }
  if (!packageDirectory) {
    failures.push(fail('PACKAGE_DIRECTORY_REQUIRED',
      'verify requires --package <dir>. A development directory is never a verified package, and a ' +
      'successful dev build must not count as package verification.'));
    return record;
  }
  const root = path.resolve(packageDirectory);
  if (!fs.existsSync(root) || !fs.lstatSync(root).isDirectory()) {
    failures.push(fail('PACKAGE_DIRECTORY_MISSING', 'Package directory is absent: ' + root));
    return record;
  }

  const files = [];
  const allPaths = [];
  let scannedBytes = 0;
  let scannedEntries = 0;
  let stopped = false;
  const stack = [{directory: root, relative: ''}];
  while (stack.length && !stopped) {
    const current = stack.pop();
    for (const name of fs.readdirSync(current.directory).sort()) {
      if (++scannedEntries > MAX_SCAN_ENTRIES) {
        failures.push(fail('PACKAGE_SCAN_INCOMPLETE', 'Package entry limit exceeded'));
        stopped = true;
        break;
      }
      const absolute = path.join(current.directory, name);
      const relative = current.relative ? current.relative + '/' + name : name;
      const info = fs.lstatSync(absolute);
      if (info.isSymbolicLink()) {
        record.links.push(relative);
        allPaths.push(relative);
        failures.push(fail('PACKAGE_LINK_DENIED', 'Package contains a link: ' + relative, {path: relative}));
        continue;
      }
      if (info.isDirectory()) {
        allPaths.push(relative);
        stack.push({directory: absolute, relative});
      } else if (info.isFile()) {
        scannedBytes += info.size;
        if (scannedBytes > MAX_HASH_BYTES) {
          failures.push(fail('PACKAGE_SCAN_INCOMPLETE', 'Package hashing exceeds the audited byte bound'));
          stopped = true;
          break;
        }
        files.push({path: relative, absolute, bytes: info.size});
        allPaths.push(relative);
      } else {
        allPaths.push(relative);
        failures.push(fail('PACKAGE_FILE_TYPE', 'Package contains a non-regular file: ' + relative, {path: relative}));
      }
    }
  }
  const fileIndex = new Map(files.map(file => [file.path, file]));
  record.facts.packageFiles = files.length;
  record.facts.packageBytes = scannedBytes;

  // A repository/development tree is not a package, even if some paths coincide.
  const hasPackageJson = fileIndex.has('package.json');
  const hasInstaller = fileIndex.has('Craftmine World.exe');
  const looksLikeSourceTree = [...fileIndex.keys()].some(rel => rel.startsWith('desktop/') || rel.startsWith('vendor/'));
  if (hasPackageJson && !hasInstaller && looksLikeSourceTree) {
    failures.push(fail('PACKAGE_IS_DEV_DIRECTORY',
      'The supplied directory looks like a source/development tree (package.json plus desktop/ or vendor/ ' +
      'and no "Craftmine World.exe"). A development directory can never pass package verification.'));
  }

  // Pins: source-derived pins win over package-snapshot pins for the same path.
  const pins = new Map();
  for (const {key, component: entry} of listComponents(manifest)) {
    if (entry.status === 'pending-integration') record.pendingComponents.push(entry.id ?? key);
    for (const file of entry.files ?? []) {
      if (!file || typeof file.path !== 'string' || !file.packagePath) continue;
      const candidate = {
        bytes: typeof file.bytes === 'number' ? file.bytes : null,
        sha256: typeof file.sha256 === 'string' ? file.sha256 : null,
        origin: (entry.id ?? key) + ':' + file.path,
        pinnedFrom: file.pinnedFrom ?? 'manifest'
      };
      const existing = pins.get(file.packagePath);
      if (!existing || (existing.pinnedFrom === 'package-snapshot' && candidate.pinnedFrom !== 'package-snapshot')) {
        pins.set(file.packagePath, candidate);
      }
    }
  }

  const required = requiredPackagePaths(manifest);
  record.facts.requiredCount = required.size;
  record.facts.pinnedCount = pins.size;

  for (const {path: relative, origin} of [...required.values()].sort((a, b) => a.path.localeCompare(b.path))) {
    const found = fileIndex.get(relative);
    const pin = pins.get(relative) ?? null;
    if (!found) {
      record.missing.push({path: relative, origin, pinned: !!pin});
      failures.push(fail('PACKAGE_FILE_MISSING', 'Required package file is absent: ' + relative,
        {path: relative, origin}));
      continue;
    }
    const actual = {bytes: found.bytes, sha256: hashFile(found.absolute)};
    if (!pin || typeof pin.sha256 !== 'string') {
      record.unpinned.push({
        path: relative,
        origin,
        bytes: actual.bytes,
        sha256: actual.sha256,
        reason: pin ? 'pin carries no sha256' : 'no pin in the release manifest'
      });
      failures.push(fail('PACKAGE_FILE_UNPINNED',
        'Required package file has no pinned bytes+sha256 in the release manifest: ' + relative,
        {path: relative, origin}));
      continue;
    }
    const bytesDiffer = typeof pin.bytes === 'number' && pin.bytes !== actual.bytes;
    if (bytesDiffer || pin.sha256 !== actual.sha256) {
      record.mismatch.push({
        path: relative,
        origin: pin.origin,
        pinnedFrom: pin.pinnedFrom,
        expected: {bytes: pin.bytes, sha256: pin.sha256},
        actual
      });
      failures.push(fail('PACKAGE_FILE_MISMATCH', 'Required package file differs from its pin: ' + relative,
        {path: relative, origin: pin.origin, expected: pin.sha256, actual: actual.sha256}));
    }
  }

  // The package's own build-manifest.json is self-attestation: useful against
  // corruption, never an independent pin.
  const buildManifestPath = 'resources/source/build-manifest.json';
  if (fileIndex.has(buildManifestPath)) {
    try {
      const buildManifest = readJson(fileIndex.get(buildManifestPath).absolute);
      const artifacts = [];
      for (const artifact of buildManifest.artifacts ?? []) {
        let relative = PACKAGE_ARTIFACT_MAP.get(artifact.path) ?? null;
        if (!relative) {
          const candidates = files
            .map(file => file.path)
            .filter(candidate => path.posix.basename(candidate) === path.posix.basename(artifact.path));
          if (candidates.length === 1) relative = candidates[0];
        }
        if (!relative || !fileIndex.has(relative)) {
          artifacts.push({artifact: artifact.path, packagePath: relative, ok: false, reason: 'no package path'});
          failures.push(fail('PACKAGE_SELF_ATTESTATION_UNMAPPED',
            'Packaged build-manifest artifact has no package path: ' + artifact.path));
          continue;
        }
        const found = fileIndex.get(relative);
        const actualSha = hashFile(found.absolute);
        const ok = actualSha === artifact.sha256 &&
          (typeof artifact.bytes !== 'number' || artifact.bytes === found.bytes);
        artifacts.push({
          artifact: artifact.path,
          packagePath: relative,
          ok,
          expected: {bytes: artifact.bytes ?? null, sha256: artifact.sha256 ?? null},
          actual: {bytes: found.bytes, sha256: actualSha}
        });
        if (!ok) {
          failures.push(fail('PACKAGE_SELF_ATTESTATION_MISMATCH',
            'Packaged build-manifest artifact does not match the packaged bytes: ' + relative,
            {path: relative, expected: artifact.sha256, actual: actualSha}));
        }
      }
      record.selfAttestation = {
        path: buildManifestPath,
        format: buildManifest.format ?? null,
        commit: buildManifest.commit ?? null,
        artifacts
      };
      record.facts.selfAttestedArtifacts = artifacts.length;
    } catch (error) {
      failures.push(fail('PACKAGE_SELF_ATTESTATION_INVALID', 'Packaged build-manifest.json is invalid: ' + error.message));
    }
  } else {
    warnings.push('Package has no resources/source/build-manifest.json; self-attestation was skipped.');
  }

  const forbiddenByRule = new Map();
  const optionalForbiddenByRule = new Map();
  for (const relative of allPaths) {
    const rule = forbiddenRuleFor(relative);
    if (!rule) continue;
    const item = {path: relative, rule: rule.id, description: rule.description, optional: !!rule.optional};
    if (rule.optional) {
      if (!optionalForbiddenByRule.has(rule.id)) optionalForbiddenByRule.set(rule.id, item);
      continue;
    }
    // One report per rule, keeping the shallowest matching path; the whole
    // node_modules tree is one violation, not one per file.
    const existing = forbiddenByRule.get(rule.id);
    if (!existing || relative.length < existing.path.length) forbiddenByRule.set(rule.id, item);
  }
  record.forbidden = [...forbiddenByRule.values()];
  record.optionalForbidden = [...optionalForbiddenByRule.values()];
  for (const item of record.forbidden) {
    failures.push(fail('PACKAGE_FORBIDDEN_ARTIFACT',
      'Forbidden development/test/credential artifact inside the package: ' + item.path + ' (' + item.rule + ')',
      {path: item.path, rule: item.rule}));
  }
  for (const item of record.optionalForbidden) {
    warnings.push('Optional forbidden artifact present: ' + item.path + ' (' + item.rule + ')');
  }

  const requiredPaths = new Set(required.keys());
  const extra = files.map(file => file.path).filter(relative => !requiredPaths.has(relative));
  record.extra = {
    count: extra.length,
    sample: extra.slice(0, options.maxExtraListed ?? 50),
    strict: !!options.strictExtra,
    note: 'Files that are not required by the release manifest. They are reported, not treated as a failure, ' +
      'unless --strict-extra is used; forbidden artifacts are always fatal.'
  };
  if (options.strictExtra && extra.length) {
    failures.push(fail('PACKAGE_EXTRA_FILES', extra.length + ' package files are not declared by the release manifest',
      {count: extra.length}));
  }

  record.facts.links = record.links.length;
  record.facts.forbidden = record.forbidden.length;
  record.ok = failures.length === 0;
  return record;
}

function fileIndexForDiff(manifest) {
  const index = new Map();
  for (const {key, component: entry} of listComponents(manifest)) {
    for (const file of entry.files ?? []) {
      if (!file?.path) continue;
      index.set(key + '::' + file.path, {
        component: key,
        path: file.path,
        bytes: typeof file.bytes === 'number' ? file.bytes : null,
        sha256: typeof file.sha256 === 'string' ? file.sha256 : null,
        packagePath: file.packagePath ?? null,
        status: entry.status
      });
    }
  }
  return index;
}

function componentIndexForDiff(manifest) {
  const index = new Map();
  for (const {key, component: entry} of listComponents(manifest)) {
    const files = (entry.files ?? []).map(file => ({
      path: file?.path ?? null,
      bytes: file?.bytes ?? null,
      sha256: file?.sha256 ?? null
    }));
    const signature = JSON.stringify({
      version: entry.version ?? null,
      status: entry.status ?? null,
      files,
      cache: entry.cache ?? null,
      engine: entry.engine ?? null,
      aggregateSha256: entry.aggregateSha256 ?? null,
      provenance: entry.provenance ? {present: entry.provenance.present ?? null, sha256: entry.provenance.sha256 ?? null} : null,
      tools: entry.tools ?? null,
      packagePaths: entry.packagePaths ?? null,
      expectedPaths: (entry.expectedPaths ?? []).map(item => [item.status ?? null, item.expectedPath ?? null, item.owner ?? null])
    });
    index.set(key, {
      key,
      id: entry.id ?? key,
      version: entry.version ?? null,
      status: entry.status ?? null,
      fileCount: files.length,
      files,
      signature
    });
  }
  return index;
}

export function diffManifests(a, b) {
  const result = {
    format: MANIFEST_DIFF_FORMAT,
    generatedAt: new Date().toISOString(),
    a: {generatedAt: a?.generatedAt ?? null, identity: a?.identity ?? null, totals: a?.totals ?? null},
    b: {generatedAt: b?.generatedAt ?? null, identity: b?.identity ?? null, totals: b?.totals ?? null},
    identity: {changed: []},
    components: {added: [], removed: [], changed: []},
    files: {added: [], removed: [], changed: []},
    ok: true
  };
  if (a?.format !== RELEASE_MANIFEST_FORMAT || b?.format !== RELEASE_MANIFEST_FORMAT) {
    result.ok = false;
    result.error = 'Both inputs must be ' + RELEASE_MANIFEST_FORMAT;
    return result;
  }
  for (const field of ['commit', 'shortCommit', 'dirty', 'clientVersion', 'productName']) {
    const oldValue = a.identity?.[field] ?? null;
    const newValue = b.identity?.[field] ?? null;
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      result.identity.changed.push({field, old: oldValue, new: newValue});
    }
  }
  const oldComponents = componentIndexForDiff(a);
  const newComponents = componentIndexForDiff(b);
  for (const [key, value] of oldComponents) {
    const other = newComponents.get(key);
    if (!other) result.components.removed.push({key, id: value.id, status: value.status, fileCount: value.fileCount});
    else if (JSON.stringify(value) !== JSON.stringify(other)) {
      result.components.changed.push({
        key,
        id: value.id,
        old: {status: value.status, version: value.version, fileCount: value.fileCount},
        new: {status: other.status, version: other.version, fileCount: other.fileCount}
      });
    }
  }
  for (const [key, value] of newComponents) {
    if (!oldComponents.has(key)) result.components.added.push({key, id: value.id, status: value.status, fileCount: value.fileCount});
  }
  const oldFiles = fileIndexForDiff(a);
  const newFiles = fileIndexForDiff(b);
  for (const [key, value] of oldFiles) {
    const other = newFiles.get(key);
    if (!other) result.files.removed.push({key, path: value.path, sha256: value.sha256, bytes: value.bytes});
    else if (value.sha256 !== other.sha256 || value.bytes !== other.bytes || value.status !== other.status) {
      result.files.changed.push({
        key,
        path: value.path,
        oldSha256: value.sha256,
        newSha256: other.sha256,
        oldBytes: value.bytes,
        newBytes: other.bytes,
        oldStatus: value.status,
        newStatus: other.status
      });
    }
  }
  for (const [key, value] of newFiles) {
    if (!oldFiles.has(key)) result.files.added.push({key, path: value.path, sha256: value.sha256, bytes: value.bytes});
  }
  result.ok = !result.identity.changed.length && !result.components.added.length &&
    !result.components.removed.length && !result.components.changed.length &&
    !result.files.added.length && !result.files.removed.length && !result.files.changed.length;
  return result;
}

export function loadReleaseManifest(file) {
  const manifest = readJson(file);
  if (manifest?.format !== RELEASE_MANIFEST_FORMAT) {
    throw fail('MANIFEST_FORMAT', 'Unsupported release manifest format in ' + file + ': ' + manifest?.format);
  }
  return manifest;
}
