// Read-only licence / asset / packaging preflight core.
// Facts only: every rule below compares pinned bytes or declared metadata. It never
// downloads, executes or rewrites anything inside the checked tree.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const NOTICES_MANIFEST = 'desktop/godot/licenses/notices.manifest.json';
export const BASE_ASSETS_DIR = 'desktop/delivery/base-assets';
export const LOCK_PATH = 'desktop/godot/toolchain.lock.json';

// Single source of truth for the files a built Windows package must contain.
// desktop/windows-package-tools.mjs imports this list when staging a package so a
// successful development directory can never be reported as a complete package.
export const PACKAGE_REQUIRED_FILES = [
  'Craftmine World.exe',
  'resources/app.asar',
  'resources/bin/pi-desktop-host-core.exe',
  'resources/bin/craftmine-core.exe',
  'resources/agent-runtime/sidecar.js',
  'resources/plugins/craftmine.world/main.cjs',
  'resources/source/CraftmineWorld-source.zip',
  'resources/source/build-manifest.json',
  'resources/source/USER_GUIDE.zh-CN.md',
  'resources/licenses/PI-Desktop-LICENSE.txt',
  'resources/licenses/CRAFTMINE-NOTICES.md',
  // R1's managed Git must not depend on the user's PATH, so the pinned Git tree and
  // its bundle record are part of a delivery package.
  'resources/git/bin/git.exe',
  'resources/git/GIT-BUNDLE.json',
  'resources/git/LICENSE.txt',
  'resources/runtime-resources.json',
  'resources/godot/broker/godot-host-broker.exe',
  'resources/godot/broker/broker-identity.json',
  'resources/godot/engine/4.7.2-stable/editor/Godot_v4.7.2-stable_win64.exe',
  'resources/godot/engine/4.7.2-stable/templates/web_release.zip',
  'resources/godot/engine/4.7.2-stable/templates/windows_release_x86_64.exe',
  'resources/godot/engine/4.7.2-stable/templates/windows_debug_x86_64.exe',
  'resources/licenses/godot/GODOT_LICENSE.txt',
  'resources/licenses/godot/GODOT_COPYRIGHT.txt'
];

const MAX_TEXT_SCAN = 1024 * 1024;
const DISTRIBUTIONS = ['app-bundle', 'user-export', 'development-only'];
const REDISTRIBUTION = ['permitted', 'permitted-with-notice', 'permitted-with-notice-and-corresponding-source', 'conditional', 'denied', 'unreviewed', 'unrevealed'];
const SHIPPED = ['app-bundle', 'user-export'];
// Licences that need no separate notice text because the project owns the file or
// the licence imposes no attribution. Anything else must point at a notice file.
const NO_NOTICE_LICENCES = ['project-authored', 'public-domain', 'CC0-1.0', 'Unlicense'];

export const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const exists = file => fs.existsSync(file);
// A notice or rights document must be a real regular file: a symlink or a directory
// must not satisfy a licence claim.
const isRegularFile = file => {
  try {
    return fs.lstatSync(file).isFile();
  } catch {
    return false;
  }
};
const readText = file => fs.readFileSync(file).subarray(0, MAX_TEXT_SCAN).toString('utf8');
const rel = (root, file) => path.relative(root, file).replaceAll('\\', '/');

const fail = (code, message, extra = {}) => ({code, message, ...extra});

function statFile(root, relativePath) {
  const target = path.resolve(root, relativePath);
  if (!target.startsWith(root + path.sep) && target !== root) return {target, escaped: true};
  // Inspect each existing component without following links, including junctions.
  let component = path.parse(target).root;
  for (const name of target.slice(component.length).split(path.sep).filter(Boolean)) {
    component = path.join(component, name);
    if (exists(component) && fs.lstatSync(component).isSymbolicLink()) return {target, escaped: true};
  }
  return {target, escaped: false};
}

/** Compare a pinned {bytes, sha256} expectation with the file on disk. */
function checkPinnedFile(root, relativePath, pinned, codes) {
  const {target, escaped} = statFile(root, relativePath);
  if (escaped) return fail(codes.escaped ?? 'PATH_ESCAPE', 'Declared path escapes the repository root: ' + relativePath);
  if (!exists(target)) return fail(codes.missing, 'Declared file is absent: ' + relativePath);
  const info = fs.statSync(target);
  if (!info.isFile()) return fail(codes.missing, 'Declared path is not a regular file: ' + relativePath);
  if (typeof pinned.bytes === 'number' && info.size !== pinned.bytes) {
    return fail(codes.bytes, 'Byte count differs from the manifest: ' + relativePath, {declared: pinned.bytes, actual: info.size});
  }
  if (typeof pinned.sha256 === 'string') {
    const actual = sha256(target);
    if (actual !== pinned.sha256) return fail(codes.hash, 'SHA-256 differs from the manifest: ' + relativePath, {declared: pinned.sha256, actual});
  }
  return null;
}

export function loadLock(root) {
  return readJson(path.join(root, LOCK_PATH));
}

/** Offline notice inventory: pinned bytes, required coverage and drift against the toolchain lock. */
export function checkNotices(root) {
  const failures = [];
  const warnings = [];
  const manifestPath = path.join(root, NOTICES_MANIFEST);
  if (!exists(manifestPath)) return {id: 'notices', ok: false, failures: [fail('NOTICES_MANIFEST_MISSING', 'Notice manifest is absent: ' + NOTICES_MANIFEST)], warnings, facts: {}};
  let manifest;
  try {
    manifest = readJson(manifestPath);
  } catch (error) {
    return {id: 'notices', ok: false, failures: [fail('NOTICES_MANIFEST_INVALID', 'Notice manifest is not valid JSON: ' + error.message)], warnings, facts: {}};
  }
  if (manifest.format !== 'craftmine.notices/1') failures.push(fail('NOTICES_FORMAT', 'Unsupported notice manifest format: ' + manifest.format));
  const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
  if (!entries.length) failures.push(fail('NOTICES_EMPTY', 'Notice manifest declares no entries'));
  const directory = path.dirname(manifestPath);
  const byId = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry.id !== 'string' || !entry.id) { failures.push(fail('NOTICE_ENTRY_ID', 'Notice entry without a stable id')); continue; }
    if (byId.has(entry.id)) failures.push(fail('NOTICE_ENTRY_DUPLICATE', 'Duplicate notice entry id: ' + entry.id));
    byId.set(entry.id, entry);
    if (typeof entry.component !== 'string' || !entry.component) failures.push(fail('NOTICE_COMPONENT', entry.id + ' has no component name'));
    if (typeof entry.license !== 'string' || !entry.license) failures.push(fail('NOTICE_LICENSE', entry.id + ' has no declared licence'));
    if (!Array.isArray(entry.appliesTo) || !entry.appliesTo.length) failures.push(fail('NOTICE_SCOPE', entry.id + ' does not declare what it applies to'));
    if (!REDISTRIBUTION.includes(entry.redistribution)) failures.push(fail('NOTICE_REDISTRIBUTION', entry.id + ' has an unknown redistribution condition: ' + entry.redistribution));
    if (['denied', 'unreviewed', 'unrevealed'].includes(entry.redistribution)) failures.push(fail('NOTICE_REDISTRIBUTION_DENIED', entry.id + ' has not been cleared for redistribution'));
    if (typeof entry.noticeRequired !== 'boolean') failures.push(fail('NOTICE_REQUIRED_FLAG', entry.id + ' must state noticeRequired explicitly'));
    if (entry.noticeRequired) {
      const pinned = {bytes: entry.noticeBytes, sha256: entry.noticeSha256};
      const relative = path.relative(root, path.resolve(directory, entry.noticeFile ?? '')).replaceAll('\\', '/');
      const problem = checkPinnedFile(root, relative, pinned, {
        missing: 'NOTICE_FILE_MISSING',
        bytes: 'NOTICE_BYTES_MISMATCH',
        hash: 'NOTICE_HASH_MISMATCH'
      });
      if (problem) failures.push(problem);
      else {
        const text = readText(path.resolve(directory, entry.noticeFile));
        for (const pattern of entry.expectAll ?? []) {
          if (!new RegExp(pattern, 'm').test(text)) failures.push(fail('NOTICE_CONTENT_UNEXPECTED', entry.id + ' is missing required text /' + pattern + '/ in ' + relative));
        }
        for (const pattern of entry.expectNone ?? []) {
          if (new RegExp(pattern, 'm').test(text)) failures.push(fail('NOTICE_CONTENT_FORBIDDEN', entry.id + ' contains text that must not appear: /' + pattern + '/ in ' + relative));
        }
      }
    }
  }
  for (const id of manifest.requiredEntryIds ?? []) {
    if (!byId.has(id)) failures.push(fail('NOTICE_REQUIRED_ENTRY_MISSING', 'Required notice entry is absent: ' + id));
  }
  // The toolchain lock and the notice manifest must not drift apart.
  let lock = null;
  try {
    lock = loadLock(root);
  } catch (error) {
    failures.push(fail('LOCK_INVALID', 'Toolchain lock is not valid JSON: ' + error.message));
  }
  const declaredFiles = new Set(entries.filter(entry => entry.noticeRequired).map(entry => path.basename(String(entry.noticeFile ?? ''))));
  const lockDirectory = path.dirname(LOCK_PATH);
  for (const locked of lock?.licenses ?? []) {
    const lockRelative = (lockDirectory + '/' + locked.file).replaceAll('\\', '/');
    const target = path.join(root, lockRelative);
    if (!exists(target)) { failures.push(fail('LOCK_NOTICE_FILE_MISSING', 'Toolchain lock declares an absent notice: ' + lockRelative)); continue; }
    if (sha256(target) !== locked.sha256) failures.push(fail('LOCK_NOTICE_HASH_MISMATCH', 'Pinned notice differs from the toolchain lock: ' + lockRelative));
    if (!declaredFiles.has(path.basename(locked.file))) failures.push(fail('LOCK_NOTICE_UNDECLARED', 'Toolchain lock notice is missing from the notice manifest: ' + lockRelative));
    const entry = entries.find(candidate => candidate.lockCrossCheck && path.basename(candidate.noticeFile) === path.basename(locked.file));
    if (entry && entry.noticeSha256 !== locked.sha256) failures.push(fail('LOCK_NOTICE_DRIFT', 'Notice manifest and toolchain lock disagree on ' + lockRelative));
  }
  for (const entry of entries.filter(candidate => candidate.lockCrossCheck)) {
    if (!(lock?.licenses ?? []).some(locked => path.basename(locked.file) === path.basename(entry.noticeFile))) {
      failures.push(fail('NOTICE_LOCK_ENTRY_ABSENT', entry.id + ' claims a toolchain lock cross-check but the lock does not pin ' + entry.noticeFile));
    }
  }
  if (!lock) warnings.push('Toolchain lock unavailable; lock cross-checks were skipped.');
  return {id: 'notices', ok: failures.length === 0, failures, warnings, facts: {entries: entries.length, requiredEntries: (manifest.requiredEntryIds ?? []).length}};
}

/** PI-Desktop LGPL obligations, deliberately independent from the Godot MIT notice. */
export function checkLgpl(root, {packageDirectory = null} = {}) {
  const failures = [];
  const warnings = [];
  const facts = {};
  const licensePath = 'vendor/pi-desktop/LICENSE';
  const upstreamPath = 'desktop/UPSTREAM.json';
  const licenseFile = path.join(root, licensePath);
  if (!exists(licenseFile)) failures.push(fail('LGPL_NOTICE_MISSING', 'Upstream licence text is absent: ' + licensePath));
  else {
    const text = readText(licenseFile);
    facts.licenseSha256 = sha256(licenseFile);
    if (!/GNU LESSER GENERAL PUBLIC LICENSE/.test(text) || !/Version 3, 29 June 2007/.test(text)) {
      failures.push(fail('LGPL_NOTICE_NOT_LGPL', licensePath + ' does not contain the LGPL-3 text'));
    }
    if (!/GNU\s+GPL/.test(text)) {
      failures.push(fail('LGPL_NOTICE_NO_GPL_REFERENCE', licensePath + ' does not reference the GNU GPL that the LGPL-3 incorporates'));
    }
    if (/Permission is hereby granted, free of charge, to any person obtaining a copy\s+of this software/.test(text)) {
      failures.push(fail('LGPL_NOTICE_IS_MIT', licensePath + ' contains MIT text; the Godot licence must not stand in for the LGPL obligations'));
    }
    // The upstream file is the LGPL-3 supplement only; it incorporates GPL-3 by
    // reference. Whether a distribution must also bundle the GPL-3 text is a legal
    // question, so it is reported rather than asserted either way.
    if (!/GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/.test(text)) {
      warnings.push(licensePath + ' references GPL-3 but does not bundle the full GPL-3 text; confirm the required notice set with counsel.');
    }
  }
  if (!exists(path.join(root, upstreamPath))) failures.push(fail('LGPL_PROVENANCE_MISSING', 'Provenance file is absent: ' + upstreamPath));
  else {
    const upstream = readJson(path.join(root, upstreamPath));
    facts.upstreamLicense = upstream.license;
    facts.upstreamCommit = upstream.commit;
    if (upstream.license !== 'LGPL-3.0-or-later') failures.push(fail('LGPL_PROVENANCE_MISMATCH', upstreamPath + ' declares ' + upstream.license + ' instead of LGPL-3.0-or-later'));
    if (!/^[a-f0-9]{40}$/.test(String(upstream.commit ?? ''))) failures.push(fail('LGPL_PROVENANCE_COMMIT', upstreamPath + ' does not pin a full upstream commit'));
  }
  const cargoPath = 'vendor/pi-desktop/Cargo.toml';
  if (exists(path.join(root, cargoPath))) {
    const cargo = readText(path.join(root, cargoPath));
    if (!/LGPL-3\.0-or-later/.test(cargo)) failures.push(fail('LGPL_METADATA_MISMATCH', cargoPath + ' no longer declares LGPL-3.0-or-later'));
  } else failures.push(fail('LGPL_METADATA_MISSING', 'Workspace manifest is absent: ' + cargoPath));
  const noticeManifestPath = path.join(root, NOTICES_MANIFEST);
  if (exists(noticeManifestPath)) {
    const manifest = readJson(noticeManifestPath);
    const entry = (manifest.entries ?? []).find(candidate => candidate.license === 'LGPL-3.0-or-later');
    if (!entry) failures.push(fail('LGPL_NOT_DECLARED', 'Notice manifest has no LGPL-3.0-or-later entry'));
    else {
      const resolved = path.relative(root, path.resolve(path.dirname(noticeManifestPath), entry.noticeFile)).replaceAll('\\', '/');
      if (resolved !== licensePath) failures.push(fail('LGPL_NOTICE_TARGET', 'LGPL notice entry points at ' + resolved + ' instead of ' + licensePath));
    }
  }
  if (packageDirectory) {
    const packaged = ['resources/licenses/PI-Desktop-LICENSE.txt', 'PI-Desktop-LICENSE.txt'].map(candidate => path.join(packageDirectory, candidate)).find(exists);
    if (!packaged) failures.push(fail('LGPL_PACKAGED_COPY_MISSING', 'Package has no PI-Desktop-LICENSE.txt in resources/licenses/'));
    else if (sha256(packaged) !== facts.licenseSha256) failures.push(fail('LGPL_PACKAGED_COPY_MISMATCH', 'Packaged LGPL copy differs from ' + licensePath));
    const sourceOffer = path.join(packageDirectory, 'resources/source/CraftmineWorld-source.zip');
    if (!exists(sourceOffer)) failures.push(fail('LGPL_SOURCE_OFFER_MISSING', 'Package has no corresponding source archive'));
    else facts.sourceArchiveBytes = fs.statSync(sourceOffer).size;
    const notices = ['resources/licenses/CRAFTMINE-NOTICES.md', 'resources/licenses/NOTICES.md'].map(candidate => path.join(packageDirectory, candidate)).find(exists);
    if (notices) {
      const text = readText(notices);
      if (!/LGPL/i.test(text)) failures.push(fail('LGPL_NOTICE_UNDECLARED', 'Packaged notices do not mention the LGPL obligation'));
    } else failures.push(fail('LGPL_NOTICE_MISSING', 'Package has no CRAFTMINE-NOTICES.md'));
  }
  return {id: 'lgpl', ok: failures.length === 0, failures, warnings, facts};
}

function validateBaseEntry(root, manifest, entry, fileDirectory, failures) {
  const label = manifest.baseId + ':' + (entry.path ?? '<missing path>');
  for (const field of ['role', 'origin', 'author', 'version', 'license', 'redistribution', 'distribution']) {
    if (entry[field] === undefined || entry[field] === null || entry[field] === '') failures.push(fail('ASSET_FIELD_MISSING', label + ' is missing ' + field));
  }
  if (!Array.isArray(entry.distribution) || !entry.distribution.length) { failures.push(fail('ASSET_DISTRIBUTION', label + ' declares no distribution')); return; }
  for (const value of entry.distribution) if (!DISTRIBUTIONS.includes(value)) failures.push(fail('ASSET_DISTRIBUTION', label + ' has an unknown distribution: ' + value));
  if (!REDISTRIBUTION.includes(entry.redistribution)) failures.push(fail('ASSET_REDISTRIBUTION', label + ' has an unknown redistribution condition: ' + entry.redistribution));
  const shipped = entry.distribution.some(value => SHIPPED.includes(value));
  if (shipped && ['denied', 'unreviewed', 'unrevealed'].includes(entry.redistribution)) {
    failures.push(fail('ASSET_REDISTRIBUTION_DENIED', label + ' is distributed but redistribution is ' + entry.redistribution));
  }
  if (shipped && entry.redistribution === 'conditional' && !entry.conditions) {
    failures.push(fail('ASSET_CONDITIONS_MISSING', label + ' is conditional but states no conditions'));
  }
  if (!entry.license) failures.push(fail('ASSET_LICENSE_UNKNOWN', label + ' has no licence'));
  else if (shipped && !NO_NOTICE_LICENCES.includes(entry.license)) {
    if (!entry.licenseFile) failures.push(fail('ASSET_LICENSE_FILE_MISSING', label + ' needs a notice file for licence ' + entry.license));
    else {
      const resolved = path.isAbsolute(entry.licenseFile) ? entry.licenseFile : path.resolve(fileDirectory, entry.licenseFile);
      if (!isRegularFile(resolved)) failures.push(fail('ASSET_LICENSE_FILE_MISSING', label + ' notice file is absent or is not a regular file: ' + rel(root, resolved)));
    }
  }
  if (entry.license === 'project-authored' && !entry.outstanding && !entry.licenseDocument) {
    failures.push(fail('ASSET_AUTHORED_LICENSE_UNDECLARED', label + ' is project-authored but neither a licence text nor an explicit outstanding reason is recorded'));
  }
  if (entry.licenseDocument) {
    const resolved = path.isAbsolute(entry.licenseDocument) ? entry.licenseDocument : path.resolve(root, entry.licenseDocument);
    if (!isRegularFile(resolved)) failures.push(fail('ASSET_LICENSE_DOCUMENT_MISSING', label + ' rights document is absent or is not a regular file: ' + entry.licenseDocument));
  }
  if (entry.distribution.includes('user-export') && entry.redistribution === 'denied') {
    failures.push(fail('ASSET_EXPORT_DENIED', label + ' is marked user-export but redistribution is denied'));
  }
  const problem = checkPinnedFile(root, rel(root, path.join(fileDirectory, entry.path ?? '')), entry, {
    missing: 'ASSET_FILE_MISSING',
    bytes: 'ASSET_BYTES_MISMATCH',
    hash: 'ASSET_HASH_MISMATCH'
  });
  if (problem) failures.push({...problem, message: problem.message + ' (' + label + ')'});
}

/** Per-base provenance: declared files, pinned hashes, undeclared files and export rights. */
export function checkBaseAssets(root, {directory = BASE_ASSETS_DIR} = {}) {
  const failures = [];
  const warnings = [];
  const inventory = {};
  const assetsDirectory = path.join(root, directory);
  if (!exists(assetsDirectory)) return {id: 'assets', ok: false, failures: [fail('ASSETS_DIRECTORY_MISSING', 'Base asset manifest directory is absent: ' + directory)], warnings, facts: {}};
  if (statFile(root, directory).escaped) return {id: 'assets', ok: false, failures: [fail('ASSET_LINK_DENIED', 'Manifest directory escapes the root or contains a link')], warnings, facts: {}};
  const manifests = fs.readdirSync(assetsDirectory).filter(name => name.endsWith('.json')).sort();
  if (!manifests.length) failures.push(fail('ASSETS_EMPTY', 'No base asset manifest was found in ' + directory));
  let lock = null;
  try {
    lock = loadLock(root);
  } catch (error) {
    failures.push(fail('LOCK_INVALID', 'Toolchain lock is not valid JSON: ' + error.message));
  }
  const coveredDirectories = new Set();
  for (const name of manifests) {
    let manifest;
    if (fs.lstatSync(path.join(assetsDirectory, name)).isSymbolicLink()) { failures.push(fail('ASSET_LINK_DENIED', 'Manifest is a link: ' + name)); continue; }
    try {
      manifest = readJson(path.join(assetsDirectory, name));
    } catch (error) {
      failures.push(fail('ASSET_MANIFEST_INVALID', name + ' is not valid JSON: ' + error.message));
      continue;
    }
    const label = manifest.baseId ?? name;
    if (manifest.format !== 'craftmine.base-assets/1') failures.push(fail('ASSET_FORMAT', label + ' has an unsupported format: ' + manifest.format));
    if (!manifest.baseId) failures.push(fail('ASSET_BASE_ID', name + ' has no baseId'));
    if (!manifest.sourceDirectory) { failures.push(fail('ASSET_SOURCE_DIRECTORY', label + ' has no sourceDirectory')); continue; }
    const baseDirectory = path.resolve(root, manifest.sourceDirectory);
    if (statFile(root, manifest.sourceDirectory).escaped || !baseDirectory.startsWith(path.resolve(root) + path.sep)) { failures.push(fail('ASSET_SOURCE_ESCAPE', label + ' source directory escapes the root')); continue; }
    if (exists(baseDirectory) && fs.lstatSync(baseDirectory).isSymbolicLink()) { failures.push(fail('ASSET_LINK_DENIED', label + ' source directory is a link')); continue; }
    if (manifest.format === 'craftmine.base-assets/1') coveredDirectories.add(baseDirectory);
    if (!exists(baseDirectory)) { failures.push(fail('ASSET_SOURCE_MISSING', label + ' source directory is absent: ' + manifest.sourceDirectory)); continue; }
    if (lock && manifest.engine?.version && manifest.engine.version !== lock.version) {
      failures.push(fail('ASSET_ENGINE_MISMATCH', label + ' targets engine ' + manifest.engine.version + ' but the lock pins ' + lock.version));
    }
    // Rights that are documented but not yet formally applied stay visible as a
    // single warning per manifest instead of one line per file. A manifest that
    // tracks a target licence or a rights document without declaring rightsStatus
    // is treated as pending too, so omitting the field cannot silence the state.
    const rightsTracked = [...(manifest.entries ?? []), ...(manifest.externalEntries ?? [])]
      .some(entry => entry.targetLicense || entry.licenseDocument);
    if ((manifest.rightsStatus && manifest.rightsStatus !== 'applied') || (!manifest.rightsStatus && rightsTracked)) {
      warnings.push('ASSET_RIGHTS_PENDING ' + label + ' rightsStatus=' + (manifest.rightsStatus ?? 'undeclared')
        + (manifest.rightsDocument ? ' rightsDocument=' + manifest.rightsDocument : '')
        + (manifest.rightsNote ? ' :: ' + manifest.rightsNote : ''));
    }
    const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
    const external = Array.isArray(manifest.externalEntries) ? manifest.externalEntries : [];
    const declared = new Set(entries.map(entry => String(entry.path ?? '').replaceAll('\\', '/')));
    for (const entry of entries) validateBaseEntry(root, manifest, entry, baseDirectory, failures);
    for (const entry of external) validateBaseEntry(root, manifest, entry, root, failures);
    const seen = new Set();
    for (const entry of entries) {
      const key = String(entry.path ?? '').replaceAll('\\', '/');
      if (seen.has(key)) failures.push(fail('ASSET_DUPLICATE', label + ' declares ' + key + ' twice'));
      seen.add(key);
    }
    // Any file that ships but is not declared is a provenance gap.
    const walk = (current, prefix) => {
      for (const child of fs.readdirSync(current).sort()) {
        const childPath = path.join(current, child);
        const relative = (prefix ? prefix + '/' : '') + child;
        const info = fs.lstatSync(childPath);
        if (info.isSymbolicLink()) failures.push(fail('ASSET_LINK_DENIED', label + ' contains a link: ' + relative));
        else if (info.isDirectory()) walk(childPath, relative);
        else if (!declared.has(relative)) failures.push(fail('ASSET_UNDECLARED_FILE', label + ' has an undeclared file: ' + manifest.sourceDirectory + '/' + relative));
      }
    };
    walk(baseDirectory, '');
    for (const notice of manifest.requiredNotices ?? []) {
      const problem = checkPinnedFile(root, notice.path, notice, {
        missing: 'ASSET_NOTICE_MISSING',
        bytes: 'ASSET_NOTICE_BYTES_MISMATCH',
        hash: 'ASSET_NOTICE_HASH_MISMATCH'
      });
      if (problem) failures.push({...problem, message: problem.message + ' (' + label + ')'});
    }
    const bucket = {appBundle: [], userExport: [], developmentOnly: []};
    for (const entry of [...entries, ...external]) {
      const relative = entry.path && !path.isAbsolute(entry.path) && entries.includes(entry) ? manifest.sourceDirectory + '/' + entry.path : entry.path;
      if ((entry.distribution ?? []).includes('app-bundle')) bucket.appBundle.push(relative);
      if ((entry.distribution ?? []).includes('user-export')) bucket.userExport.push(relative);
      if ((entry.distribution ?? []).includes('development-only')) bucket.developmentOnly.push(relative);
      if (entry.outstanding) warnings.push(label + ' ' + relative + ': ' + entry.outstanding);
    }
    inventory[label] = bucket;
  }
  // A probe with the same baseId does not cover the shipped base directory.
  const basesRoot = path.join(root, 'desktop/godot/bases');
  const discoveredBases = [];
  if (exists(basesRoot)) {
    if (fs.lstatSync(basesRoot).isSymbolicLink()) failures.push(fail('ASSET_LINK_DENIED', 'Base root is a link'));
    else for (const name of fs.readdirSync(basesRoot).sort()) {
      const target = path.join(basesRoot, name), info = fs.lstatSync(target);
      if (info.isSymbolicLink()) { failures.push(fail('ASSET_LINK_DENIED', 'Base is a link: ' + name)); continue; }
      if (!info.isDirectory()) continue;
      // Shared verification code is a development harness, not a world base.
      // A project/manifest in that reserved directory removes the exemption.
      if (name === 'tests' && !['project.godot', 'manifest.json', 'base_manifest.json'].some(file => exists(path.join(target, file)))) continue;
      discoveredBases.push(name);
      if (!coveredDirectories.has(path.resolve(target))) failures.push(fail('ASSET_BASE_MANIFEST_MISSING', 'No asset manifest covers desktop/godot/bases/' + name));
    }
  }
  return {id: 'assets', ok: failures.length === 0, failures, warnings, facts: {manifests: manifests.length, discoveredBases, inventory}};
}

/** Pinned engine cache: archive, unpacked executable, selected Web templates. */
export function checkGodotCache(root, cacheDirectory) {
  const failures = [];
  const facts = {};
  if (!cacheDirectory) return {id: 'godot-cache', ok: true, failures, warnings: ['No engine cache directory was supplied; cache bytes were not verified.'], facts: {skipped: true}};
  const cache = path.resolve(cacheDirectory);
  if (!exists(cache)) return {id: 'godot-cache', ok: false, failures: [fail('CACHE_DIRECTORY_MISSING', 'Engine cache directory is absent: ' + cache)], warnings: [], facts: {}};
  let lock;
  try {
    lock = loadLock(root);
  } catch (error) {
    return {id: 'godot-cache', ok: false, failures: [fail('LOCK_INVALID', 'Toolchain lock is not valid JSON: ' + error.message)], warnings: [], facts: {}};
  }
  const expect = (relative, pinned, codes) => {
    const problem = checkPinnedFile(cache, relative, pinned, codes);
    if (problem) failures.push(problem);
  };
  expect(lock.editor.file, lock.editor, {missing: 'CACHE_EDITOR_ARCHIVE_MISSING', bytes: 'CACHE_EDITOR_ARCHIVE_BYTES', hash: 'CACHE_EDITOR_ARCHIVE_HASH'});
  expect(path.join('editor', lock.editor.executable), {sha256: lock.editor.executableSha256}, {missing: 'CACHE_EXECUTABLE_MISSING', hash: 'CACHE_EXECUTABLE_HASH'});
  if (exists(path.join(cache, 'unpacked-files.json'))) {
    const manifest = readJson(path.join(cache, 'unpacked-files.json'));
    if (manifest.archiveSha256 !== lock.editor.sha256) failures.push(fail('CACHE_UNPACKED_LOCK_DRIFT', 'unpacked-files.json does not match the locked editor archive'));
    for (const entry of manifest.files ?? []) {
      const problem = checkPinnedFile(cache, path.join('editor', entry.path), entry, {missing: 'CACHE_UNPACKED_MISSING', bytes: 'CACHE_UNPACKED_BYTES', hash: 'CACHE_UNPACKED_HASH'});
      if (problem) failures.push(problem);
    }
    facts.unpackedFiles = (manifest.files ?? []).length;
  } else failures.push(fail('CACHE_UNPACKED_MANIFEST_MISSING', 'unpacked-files.json is absent from the cache'));
  expect(lock.exportTemplates.file, lock.exportTemplates, {missing: 'CACHE_TEMPLATE_ARCHIVE_MISSING', bytes: 'CACHE_TEMPLATE_ARCHIVE_BYTES', hash: 'CACHE_TEMPLATE_ARCHIVE_HASH'});
  if (exists(path.join(cache, 'template-files.json'))) {
    const manifest = readJson(path.join(cache, 'template-files.json'));
    if (manifest.archiveSha256 !== lock.exportTemplates.sha256) failures.push(fail('CACHE_TEMPLATE_LOCK_DRIFT', 'template-files.json does not match the locked template archive'));
    for (const entry of manifest.files ?? []) {
      const problem = checkPinnedFile(cache, path.join('templates', entry.path), entry, {missing: 'CACHE_TEMPLATE_MISSING', bytes: 'CACHE_TEMPLATE_BYTES', hash: 'CACHE_TEMPLATE_HASH'});
      if (problem) failures.push(problem);
    }
    facts.templateFiles = (manifest.files ?? []).length;
  } else failures.push(fail('CACHE_TEMPLATE_MANIFEST_MISSING', 'template-files.json is absent from the cache'));
  for (const entry of [lock.exportTemplates.webRelease, lock.exportTemplates.webThreadedRelease]) {
    expect(path.join('templates', entry.file), entry, {missing: 'CACHE_TEMPLATE_MISSING', bytes: 'CACHE_TEMPLATE_BYTES', hash: 'CACHE_TEMPLATE_HASH'});
  }
  const versionFile = path.join(cache, 'templates', 'version.txt');
  if (exists(versionFile)) {
    const expected = lock.version.replace('-stable', '.stable');
    const actual = fs.readFileSync(versionFile, 'utf8').trim();
    facts.templateVersion = actual;
    if (actual !== expected) failures.push(fail('CACHE_TEMPLATE_VERSION', 'Template version.txt is ' + actual + ' instead of ' + expected));
  } else failures.push(fail('CACHE_TEMPLATE_VERSION_MISSING', 'templates/version.txt is absent from the cache'));
  return {id: 'godot-cache', ok: failures.length === 0, failures, warnings: [], facts};
}

/** Exported Web build: notices, bridge, and the build.json file manifest. */
export function checkExport(root, exportDirectory) {
  const failures = [];
  const facts = {};
  if (!exportDirectory) return {id: 'export', ok: true, failures, warnings: ['No export directory was supplied; exported bytes were not verified.'], facts: {skipped: true}};
  const directory = path.resolve(exportDirectory);
  if (!exists(directory)) return {id: 'export', ok: false, failures: [fail('EXPORT_DIRECTORY_MISSING', 'Export directory is absent: ' + directory)], warnings: [], facts: {}};
  let lock;
  try {
    lock = loadLock(root);
  } catch (error) {
    return {id: 'export', ok: false, failures: [fail('LOCK_INVALID', 'Toolchain lock is not valid JSON: ' + error.message)], warnings: [], facts: {}};
  }
  for (const name of ['index.html', 'index.wasm', 'index.pck', 'bridge.js']) {
    if (!exists(path.join(directory, name))) failures.push(fail('EXPORT_FILE_MISSING', 'Exported build is missing ' + name));
  }
  for (const locked of lock.licenses) {
    const name = path.basename(locked.file);
    const target = path.join(directory, 'licenses', name);
    if (!exists(target)) failures.push(fail('EXPORT_NOTICE_MISSING', 'Exported build is missing licenses/' + name));
    else if (sha256(target) !== locked.sha256) failures.push(fail('EXPORT_NOTICE_HASH_MISMATCH', 'Exported licenses/' + name + ' differs from the pinned engine notice'));
  }
  const manifestPath = path.join(directory, 'build.json');
  if (!exists(manifestPath)) failures.push(fail('EXPORT_MANIFEST_MISSING', 'Exported build has no build.json'));
  else {
    const manifest = readJson(manifestPath);
    if (!/^[a-f0-9]{64}$/.test(String(manifest.buildId ?? ''))) failures.push(fail('EXPORT_BUILD_ID', 'build.json has no SHA-256 buildId'));
    if (manifest.godotVersion && !String(manifest.godotVersion).startsWith(lock.version.replace('-stable', '.stable'))) {
      failures.push(fail('EXPORT_ENGINE_VERSION', 'build.json reports engine ' + manifest.godotVersion + ' instead of the pinned ' + lock.version));
    }
    facts.buildId = manifest.buildId;
    facts.engineVersion = manifest.godotVersion;
    let checked = 0;
    for (const entry of manifest.files ?? []) {
      const problem = checkPinnedFile(directory, entry.path, entry, {missing: 'EXPORT_MANIFEST_FILE_MISSING', bytes: 'EXPORT_MANIFEST_BYTES', hash: 'EXPORT_MANIFEST_HASH'});
      if (problem) failures.push(problem);
      checked++;
    }
    facts.manifestFiles = checked;
  }
  const exportFiles = [];
  const walk = current => {
    for (const child of fs.readdirSync(current)) {
      const childPath = path.join(current, child);
      if (fs.lstatSync(childPath).isSymbolicLink()) { failures.push(fail('EXPORT_LINK_DENIED', 'Exported build contains a link: ' + rel(directory, childPath))); continue; }
      if (fs.statSync(childPath).isDirectory()) walk(childPath);
      else exportFiles.push(childPath);
    }
  };
  walk(directory);
  facts.developmentOnlyFiles = checkDevelopmentOnlyFiles(root, directory, exportFiles, failures);
  return {id: 'export', ok: failures.length === 0, failures, warnings: [], facts};
}

/** Built Windows package: required files, source manifest, third-party texts and offline entry. */
/**
 * Files a provenance manifest declares development-only. The spec says they must
 * never ship or export, so the package and export checks look for them explicitly.
 * An entry that carries a shipping distribution value as well is not included,
 * because the shipping value is authoritative.
 *
 * Matching is by declared repository path (exact or as a suffix), never by bare
 * basename: a basename such as index.html is shared by shipped and development-only
 * files, and flagging it would produce false failures. The limitation is recorded in
 * docs/dispatch-reports/godot-remaining/K/SPEC_K_BASE_MANIFEST_DELTA.md.
 */
function developmentOnlyIndex(root) {
  const paths = new Set();
  const directory = path.join(root, BASE_ASSETS_DIR);
  if (!exists(directory)) return paths;
  for (const name of fs.readdirSync(directory).filter(entry => entry.endsWith('.json')).sort()) {
    let manifest;
    try {
      manifest = readJson(path.join(directory, name));
    } catch {
      continue;
    }
    const record = (entry, repositoryPath) => {
      const distribution = entry.distribution ?? [];
      if (!distribution.includes('development-only')) return;
      if (distribution.some(value => SHIPPED.includes(value))) return;
      paths.add(String(repositoryPath).replaceAll('\\', '/'));
    };
    for (const entry of manifest.entries ?? []) record(entry, (manifest.sourceDirectory ? manifest.sourceDirectory + '/' : '') + entry.path);
    for (const entry of manifest.externalEntries ?? []) record(entry, entry.path);
  }
  return paths;
}

/** Report every shipped file whose path matches a development-only declaration. */
function checkDevelopmentOnlyFiles(root, directory, files, failures) {
  const declared = developmentOnlyIndex(root);
  if (!declared.size) return 0;
  let found = 0;
  for (const file of files) {
    const relativePath = rel(directory, file);
    for (const candidate of declared) {
      if (relativePath === candidate || relativePath.endsWith('/' + candidate)) {
        failures.push(fail('DEVELOPMENT_ONLY_FILE_SHIPPED', 'Development-only file must not ship: ' + relativePath));
        found++;
        break;
      }
    }
  }
  return found;
}

export function checkPackage(root, packageDirectory) {
  const failures = [];
  const warnings = [];
  const facts = {};
  if (!packageDirectory) return {id: 'package', ok: true, failures, warnings: ['No package directory was supplied; package bytes were not verified.'], facts: {skipped: true}};
  const directory = path.resolve(packageDirectory);
  if (!exists(directory)) return {id: 'package', ok: false, failures: [fail('PACKAGE_DIRECTORY_MISSING', 'Package directory is absent: ' + directory)], warnings, facts: {}};
  const packageFiles = [];
  const pendingDirectories = [{directory, depth: 0}];
  let scannedEntries = 0;
  if (statFile(directory, '.').escaped) failures.push(fail('PACKAGE_LINK_DENIED', 'Package root contains a link'));
  while (pendingDirectories.length && !failures.length) {
    const current = pendingDirectories.pop();
    if (current.depth > 64) { failures.push(fail('PACKAGE_SCAN_INCOMPLETE', 'Package nesting exceeds the audited scan bound')); break; }
    for (const child of fs.readdirSync(current.directory)) {
      if (++scannedEntries > 100000) { failures.push(fail('PACKAGE_SCAN_INCOMPLETE', 'Package entry limit exceeded')); break; }
      const target = path.join(current.directory, child), info = fs.lstatSync(target);
      if (info.isSymbolicLink()) { failures.push(fail('PACKAGE_LINK_DENIED', 'Package contains a link: ' + rel(directory, target))); continue; }
      if (info.isDirectory()) pendingDirectories.push({directory: target, depth: current.depth + 1});
      else if (info.isFile()) packageFiles.push(target);
      else failures.push(fail('PACKAGE_FILE_TYPE', 'Package contains a non-regular file: ' + rel(directory, target)));
    }
  }
  if (failures.length) return {id: 'package', ok: false, failures, warnings, facts: {scannedEntries}};
  const required = PACKAGE_REQUIRED_FILES;
  for (const relative of required) {
    if (!exists(path.join(directory, relative))) failures.push(fail('PACKAGE_FILE_MISSING', 'Package is missing ' + relative));
  }
  facts.developmentOnlyFiles = checkDevelopmentOnlyFiles(root, directory, packageFiles, failures);
  const manifestPath = path.join(directory, 'resources/source/build-manifest.json');
  if (exists(manifestPath)) {
    const manifest = readJson(manifestPath);
    facts.commit = manifest.commit;
    facts.toolchain = manifest.toolchain;
    if (manifest.format !== 'craftmine.build/1') failures.push(fail('PACKAGE_MANIFEST_FORMAT', 'build-manifest.json has an unexpected format'));
    // build-manifest.json records build-machine paths; the packaging entry point maps
    // them to fixed package paths. Unknown entries fall back to a unique basename match.
    const artifactMap = new Map([
      ['vendor/pi-desktop/target/release/pi-desktop-host-core.exe', 'resources/bin/pi-desktop-host-core.exe'],
      ['vendor/pi-desktop/target/release/craftmine-core.exe', 'resources/bin/craftmine-core.exe'],
      ['vendor/pi-desktop/packages/agent-runtime/dist-bundle/sidecar.js', 'resources/agent-runtime/sidecar.js'],
      ['vendor/pi-desktop/apps/desktop/resources/plugins/craftmine.world/manifest.json', 'resources/plugins/craftmine.world/manifest.json'],
      ['desktop/build/CraftmineWorld-source.zip', 'resources/source/CraftmineWorld-source.zip']
    ]);
    const packageFiles = [];
    const index = current => {
      for (const child of fs.readdirSync(current)) {
        const childPath = path.join(current, child);
        const info = fs.lstatSync(childPath);
        if (info.isSymbolicLink()) continue;
        if (info.isDirectory()) index(childPath);
        else packageFiles.push(rel(directory, childPath));
      }
    };
    index(directory);
    let mapped = 0;
    for (const artifact of manifest.artifacts ?? []) {
      let relative = artifactMap.get(artifact.path);
      if (!relative) {
        const candidates = packageFiles.filter(candidate => path.basename(candidate) === path.basename(artifact.path));
        if (candidates.length === 1) relative = candidates[0];
      }
      if (!relative) { failures.push(fail('PACKAGE_ARTIFACT_UNMAPPED', 'build-manifest.json artifact has no package path: ' + artifact.path)); continue; }
      const problem = checkPinnedFile(directory, relative, artifact, {missing: 'PACKAGE_ARTIFACT_MISSING', bytes: 'PACKAGE_ARTIFACT_BYTES', hash: 'PACKAGE_ARTIFACT_HASH'});
      if (problem) failures.push({...problem, message: problem.message + ' (' + artifact.path + ')'});
      else mapped++;
    }
    facts.artifactsVerified = mapped;
    const archive = path.join(directory, 'resources/source/CraftmineWorld-source.zip');
    if (exists(archive) && manifest.sourceArchiveHash && sha256(archive) !== manifest.sourceArchiveHash) {
      failures.push(fail('PACKAGE_SOURCE_ARCHIVE_HASH', 'Bundled source archive does not match build-manifest.json'));
    }
  }
  // Third-party inventory must stay self-contained: every recorded text must exist.
  const inventoryPath = path.join(directory, 'resources/licenses/third-party/npm-inventory.json');
  if (!exists(inventoryPath)) failures.push(fail('PACKAGE_THIRD_PARTY_INVENTORY_MISSING', 'Package has no npm-inventory.json'));
  else {
    const inventory = readJson(inventoryPath);
    if (inventory.format !== 'craftmine.third-party/1') failures.push(fail('PACKAGE_THIRD_PARTY_FORMAT', 'npm-inventory.json has an unexpected format'));
    const packages = inventory.packages ?? [];
    if (!packages.length) failures.push(fail('PACKAGE_THIRD_PARTY_EMPTY', 'npm-inventory.json declares no packages'));
    let withoutText = 0;
    for (const entry of packages) {
      if (!entry.license) failures.push(fail('PACKAGE_THIRD_PARTY_LICENSE', 'Inventory entry has no declared licence: ' + entry.package));
      for (const file of entry.licenseFiles ?? []) {
        if (!exists(path.join(directory, 'resources/licenses/third-party', file))) {
          failures.push(fail('PACKAGE_THIRD_PARTY_TEXT_MISSING', 'Inventory lists an absent licence text: ' + file));
        }
      }
      if (!(entry.licenseFiles ?? []).length) withoutText++;
    }
    facts.inventoryPackages = packages.length;
    facts.inventoryWithoutText = withoutText;
    if (withoutText) warnings.push(withoutText + ' inventory entries have no copied licence text; they are recorded as "see package source" rather than invented.');
  }
  // The offline entry must be readable without network access and free of links.
  const licensesDirectory = path.join(directory, 'resources/licenses');
  if (!exists(licensesDirectory)) failures.push(fail('PACKAGE_OFFLINE_ENTRY_MISSING', 'Package has no resources/licenses directory'));
  else {
    for (const relative of ['fonts/OFL-Geist.txt', 'fonts/OFL-Inter.txt', 'fonts/OFL-NotoSansSC.txt', 'fonts/OFL-LXGWWenKai.txt', 'third-party/npm-inventory.json']) {
      if (!exists(path.join(licensesDirectory, relative))) failures.push(fail('PACKAGE_OFFLINE_ENTRY_INCOMPLETE', 'Offline licence entry is missing ' + relative));
    }
    const walk = current => {
      for (const child of fs.readdirSync(current)) {
        const childPath = path.join(current, child);
        if (fs.lstatSync(childPath).isSymbolicLink()) failures.push(fail('PACKAGE_LINK_DENIED', 'Package contains a link: ' + rel(directory, childPath)));
        else if (fs.statSync(childPath).isDirectory()) walk(childPath);
      }
    };
    walk(licensesDirectory);
  }
  // Classify every unpacked file by locked content, filename and Web companions.
  // Unknown WASM is not proof of absence: require a pinned explicit runtime declaration.
  let lock;
  try { lock = loadLock(root); }
  catch (error) { failures.push(fail('LOCK_INVALID', 'Cannot classify packaged runtime: ' + error.message)); }
  if (!/^[a-f0-9]{64}$/.test(lock?.editor?.executableSha256 ?? '')) failures.push(fail('PACKAGE_ENGINE_HASH_UNAVAILABLE', 'A valid locked executable hash is required to classify renamed runtimes'));
  let declarations = [];
  const runtimeManifest = path.join(directory, 'resources/runtime-manifest.json');
  if (exists(runtimeManifest)) {
    try {
      const manifest = readJson(runtimeManifest);
      if (manifest.format !== 'craftmine.package-runtimes/1' || !Array.isArray(manifest.entries)) throw Error('invalid runtime declaration format');
      declarations = manifest.entries;
    } catch (error) { failures.push(fail('PACKAGE_RUNTIME_MANIFEST_INVALID', error.message)); }
  }
  const hashes = new Map();
  let scannedBytes = 0;
  for (const file of packageFiles) {
    const size = fs.lstatSync(file).size;
    if ((scannedBytes += size) > 8 * 1024 ** 3) { failures.push(fail('PACKAGE_SCAN_INCOMPLETE', 'Package hashing exceeds the audited byte bound')); break; }
    const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(65536), fd = fs.openSync(file, 'r');
    try { for (;;) { const length = fs.readSync(fd, buffer, 0, buffer.length, null); if (!length) break; hash.update(buffer.subarray(0, length)); } }
    finally { fs.closeSync(fd); }
    hashes.set(file, hash.digest('hex'));
  }
  const engineFiles = [];
  const packDirectories = new Set(packageFiles.filter(file => path.extname(file).toLowerCase() === '.pck').map(file => path.dirname(file).toLowerCase()));
  for (const file of packageFiles) {
    const relative = rel(directory, file), hash = hashes.get(file);
    if (!hash) continue;
    if (/^godot.*\.exe$/i.test(path.basename(file)) || hash === lock?.editor?.executableSha256) engineFiles.push(relative);
    if (path.extname(file).toLowerCase() !== '.wasm') continue;
    const declaration = declarations.find(entry => entry?.path === relative && entry.sha256 === hash &&
      ['godot', 'other'].includes(entry.runtime) && typeof entry.license === 'string' && entry.license.trim() &&
      ['permitted', 'permitted-with-notice', 'permitted-with-notice-and-corresponding-source'].includes(entry.redistribution));
    if (packDirectories.has(path.dirname(file).toLowerCase()) || declaration?.runtime === 'godot') engineFiles.push(relative);
    else if (!declaration) failures.push(fail('PACKAGE_WASM_RUNTIME_UNDECLARED', 'WASM runtime needs an explicit hash-bound reviewed declaration: ' + relative));
  }
  facts.godotEngineBundled = engineFiles.length > 0;
  facts.godotEngineBinary = engineFiles[0] ?? null;
  facts.godotRuntimeFiles = [...new Set(engineFiles)];
  facts.scannedEntries = scannedEntries;
  facts.scannedBytes = scannedBytes;
  if (engineFiles.length) {
    for (const locked of lock?.licenses ?? []) {
      const name = path.basename(locked.file), target = path.join(licensesDirectory, 'godot', name);
      if (!exists(target)) failures.push(fail('PACKAGE_GODOT_NOTICE_MISSING', 'Package bundles a runtime but has no resources/licenses/godot/' + name));
      else if (sha256(target) !== locked.sha256) failures.push(fail('PACKAGE_GODOT_NOTICE_HASH', 'Packaged Godot notice differs from the lock: ' + name));
    }
    const notices = path.join(directory, 'resources/licenses/CRAFTMINE-NOTICES.md');
    if (exists(notices) && (!/Godot/.test(readText(notices)) || !/MIT/.test(readText(notices)))) failures.push(fail('PACKAGE_GODOT_NOTICE_UNDECLARED', 'Package bundles a runtime but notices do not state the Godot MIT coverage'));
  }
  // Build inputs must be reconstructable from pinned files.
  for (const relative of ['vendor/pi-desktop/pnpm-lock.yaml', 'vendor/pi-desktop/Cargo.lock', 'desktop/godot/toolchain.lock.json']) {
    if (!exists(path.join(root, relative))) failures.push(fail('REBUILD_INPUT_MISSING', 'Rebuild input is absent: ' + relative));
  }
  return {id: 'package', ok: failures.length === 0, failures, warnings, facts};
}

/** Host-side facts that the evidence record must carry for other tasks (I). */
export function collectBuildFacts(root, {packageDirectory = null, exportDirectory = null} = {}) {
  const facts = {commit: null, sourceDate: null, lockVersion: null, lockStatus: null, node: process.version, pnpm: null, cargo: null};
  const command = (file, args) => {
    try {
      return execFileSync(file, args, {cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']}).trim();
    } catch {
      return null;
    }
  };
  facts.commit = command('git', ['rev-parse', 'HEAD']);
  facts.sourceDate = command('git', ['show', '-s', '--format=%cI', 'HEAD']);
  facts.pnpm = command('pnpm', ['--version']);
  facts.cargo = command('cargo', ['--version']);
  try {
    const lock = loadLock(root);
    facts.lockVersion = lock.version;
    facts.lockStatus = lock.status;
    facts.editorSha256 = lock.editor?.executableSha256 ?? null;
    facts.webTemplate = lock.webPreview?.preferredTemplate ?? null;
  } catch {}
  if (exportDirectory && exists(path.join(exportDirectory, 'build.json'))) {
    const manifest = readJson(path.join(exportDirectory, 'build.json'));
    facts.export = {buildId: manifest.buildId, engineVersion: manifest.godotVersion, bytes: manifest.bytes, files: (manifest.files ?? []).length};
  }
  if (packageDirectory && exists(path.join(packageDirectory, 'resources/source/build-manifest.json'))) {
    const manifest = readJson(path.join(packageDirectory, 'resources/source/build-manifest.json'));
    facts.package = {commit: manifest.commit, sourceDate: manifest.sourceDate, sourceArchiveHash: manifest.sourceArchiveHash, appId: manifest.appId};
  }
  return facts;
}
