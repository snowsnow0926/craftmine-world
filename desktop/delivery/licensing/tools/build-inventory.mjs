#!/usr/bin/env node
// Build licensing/inventory.json from hand-curated decisions plus machine-checked
// evidence (git history, the verified upstream archive diff, the real npm install
// inventory and a real cargo metadata dependency walk).
//
// The generator never applies a licence and never rewrites licence metadata. Facts
// come from evidence files; the human decisions live in tools/inventory-curation.json.
//
// Usage:
//   node desktop/delivery/licensing/tools/build-inventory.mjs
//   node desktop/delivery/licensing/tools/build-inventory.mjs --refresh-evidence --package <win-unpacked>
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const LICENSING_DIR = path.resolve(HERE, '..');
export const REPO_ROOT = path.resolve(LICENSING_DIR, '..', '..', '..');
const EVIDENCE_DIR = path.join(LICENSING_DIR, 'evidence');
const CURATION = path.join(HERE, 'inventory-curation.json');
const INVENTORY = path.join(LICENSING_DIR, 'inventory.json');
const NPM_EVIDENCE = path.join(EVIDENCE_DIR, 'npm-licenses.json');
const CARGO_EVIDENCE = path.join(EVIDENCE_DIR, 'cargo-licenses.json');
const UPSTREAM_DIFF = path.join(EVIDENCE_DIR, 'upstream-diff.json');
const SHIPPED = new Set(['app-bundle', 'user-export']);

const option = name => {
  const index = process.argv.indexOf('--' + name);
  return index === -1 ? null : process.argv[index + 1];
};
const flag = name => process.argv.includes('--' + name);
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const git = args => {
  try {
    return execFileSync('git', ['-C', REPO_ROOT, ...args], {encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']}).trim();
  } catch {
    return null;
  }
};
const commitFor = relativePath => {
  const output = git(['log', '-1', '--format=%H|%cs', '--', relativePath]);
  if (!output) return null;
  const [commit, date] = output.split('|');
  return {commit, date};
};

/** Split "name@version" (optionally with a pnpm peer suffix) into name/version. */
function splitPackageId(id) {
  const cleaned = id.replace(/^'|'$/g, '').replace(/\(.*\)$/, '');
  const at = cleaned.lastIndexOf('@');
  if (at <= 0) return {name: cleaned, version: null};
  return {name: cleaned.slice(0, at), version: cleaned.slice(at + 1)};
}

function parsePnpmLock(lockfile) {
  const text = fs.readFileSync(lockfile, 'utf8');
  const ids = new Set();
  let inSection = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^(packages|snapshots):\s*$/.test(line)) { inSection = true; continue; }
    if (/^\S/.test(line) && !/^(packages|snapshots):/.test(line)) inSection = false;
    if (!inSection) continue;
    const match = /^  '?([^':\s]+)'?:\s*$/.exec(line);
    if (match) ids.add(match[1].replace(/\(.*\)$/, ''));
  }
  return ids;
}

export function refreshNpmEvidence({packageDirectory} = {}) {
  if (!packageDirectory) throw new Error('--package <win-unpacked directory> is required to refresh the npm evidence');
  const inventoryPath = path.join(packageDirectory, 'resources/licenses/third-party/npm-inventory.json');
  if (!fs.existsSync(inventoryPath)) throw new Error('installed npm inventory is absent: ' + inventoryPath);
  const installed = readJson(inventoryPath);
  if (installed.format !== 'craftmine.third-party/1') throw new Error('unexpected installed inventory format: ' + installed.format);
  const packages = (installed.packages ?? []).map(entry => {
    const {name, version} = splitPackageId(entry.package);
    return {package: entry.package, name, version, license: entry.license ?? null, licenseFiles: entry.licenseFiles ?? []};
  }).sort((a, b) => a.package.localeCompare(b.package));
  const lockPath = path.join(REPO_ROOT, 'vendor/pi-desktop/pnpm-lock.yaml');
  const lockIds = parsePnpmLock(lockPath);
  const unmatched = packages.filter(entry => !lockIds.has(entry.package.replace(/\(.*\)$/, ''))).map(entry => entry.package);
  const licenseCounts = {};
  for (const entry of packages) licenseCounts[entry.license ?? 'NO-LICENCE-DECLARED'] = (licenseCounts[entry.license ?? 'NO-LICENCE-DECLARED'] ?? 0) + 1;
  const record = {
    format: 'craftmine.npm-licenses/1',
    generatedAt: new Date().toISOString(),
    generatedBy: 'desktop/delivery/licensing/tools/build-inventory.mjs --refresh-evidence',
    source: {
      packageDirectory: path.resolve(packageDirectory),
      installedInventory: inventoryPath,
      installedInventorySha256: sha256(inventoryPath),
      lockfile: 'vendor/pi-desktop/pnpm-lock.yaml',
      lockfileSha256: sha256(lockPath)
    },
    counts: {packages: packages.length, withoutCopiedText: packages.filter(entry => !entry.licenseFiles.length).length, lockPackages: lockIds.size, unmatchedAgainstLock: unmatched.length},
    licenseCounts,
    unmatchedAgainstLock: unmatched,
    packages
  };
  fs.mkdirSync(EVIDENCE_DIR, {recursive: true});
  fs.writeFileSync(NPM_EVIDENCE, JSON.stringify(record, null, 2) + '\n');
  return record;
}

export function refreshCargoEvidence() {
  const workspace = path.join(REPO_ROOT, 'vendor/pi-desktop');
  let raw;
  try {
    raw = execFileSync('cargo', ['metadata', '--format-version', '1', '--locked'], {cwd: workspace, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024});
  } catch (error) {
    throw new Error('cargo metadata failed; run: cd vendor/pi-desktop && cargo metadata --format-version 1 --locked (' + error.message + ')');
  }
  const metadata = JSON.parse(raw);
  const byId = new Map(metadata.packages.map(entry => [entry.id, entry]));
  const roots = metadata.packages.filter(entry => entry.source === null && ['craftmine-core', 'host-core'].includes(entry.name)).map(entry => entry.id);
  if (!roots.length) throw new Error('no shipped workspace binary roots were found in cargo metadata');
  const adjacency = new Map(metadata.resolve.nodes.map(node => [node.id, node.dependencies ?? []]));
  const reachable = new Set();
  const stack = [...roots];
  while (stack.length) {
    const id = stack.pop();
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const dependency of adjacency.get(id) ?? []) stack.push(dependency);
  }
  const packages = [...reachable].map(id => byId.get(id)).filter(Boolean).map(entry => ({
    name: entry.name,
    version: entry.version,
    license: entry.license ?? null,
    workspace: entry.source === null
  })).sort((a, b) => a.name.localeCompare(b.name));
  const licenseCounts = {};
  for (const entry of packages) licenseCounts[entry.license ?? 'NO-LICENCE-DECLARED'] = (licenseCounts[entry.license ?? 'NO-LICENCE-DECLARED'] ?? 0) + 1;
  const record = {
    format: 'craftmine.cargo-licenses/1',
    generatedAt: new Date().toISOString(),
    generatedBy: 'desktop/delivery/licensing/tools/build-inventory.mjs --refresh-evidence',
    source: {
      workspace: 'vendor/pi-desktop',
      lockfile: 'vendor/pi-desktop/Cargo.lock',
      lockfileSha256: sha256(path.join(workspace, 'Cargo.lock')),
      roots: roots.map(id => byId.get(id).name),
      command: 'cargo metadata --format-version 1 --locked'
    },
    counts: {lockedPackages: metadata.packages.length, reachableFromShippedBins: packages.length, missingLicenseId: packages.filter(entry => !entry.license).length},
    licenseCounts,
    packages
  };
  fs.mkdirSync(EVIDENCE_DIR, {recursive: true});
  fs.writeFileSync(CARGO_EVIDENCE, JSON.stringify(record, null, 2) + '\n');
  return record;
}

function evidenceFile(relative) {
  const absolute = path.join(REPO_ROOT, relative);
  return {path: relative, sha256: fs.existsSync(absolute) ? sha256(absolute) : null};
}

export function buildInventory() {
  const curation = readJson(CURATION);
  const missing = [];
  for (const required of ['npm-licenses.json', 'cargo-licenses.json', 'upstream-diff.json']) {
    if (!fs.existsSync(path.join(EVIDENCE_DIR, required))) missing.push(required);
  }
  if (missing.length) throw new Error('evidence files are missing: ' + missing.join(', ') + ' — run with --refresh-evidence and tools/upstream-diff.mjs first');
  const npm = readJson(NPM_EVIDENCE);
  const cargo = readJson(CARGO_EVIDENCE);
  const upstream = readJson(UPSTREAM_DIFF);

  const entries = curation.entries.map(entry => {
    const evidence = entry.evidence.map(item => {
      const commit = commitFor(item.path.replace(/\s*\(.*\)$/, ''));
      return {path: item.path, note: item.note, commit: commit?.commit ?? null};
    });
    const channels = [...entry.deliveryChannels];
    const shipped = channels.some(channel => SHIPPED.has(channel)) && entry.origin !== 'user-content';
    return {
      id: entry.id,
      module: entry.module,
      paths: entry.paths,
      origin: entry.origin,
      rightsHolder: entry.rightsHolder,
      observedLicense: entry.observedLicense,
      targetLicense: entry.targetLicense,
      licenseFile: entry.licenseFile,
      deliveryChannels: channels,
      dependencies: entry.dependencies,
      evidence,
      status: entry.status,
      openQuestions: entry.openQuestions,
      noticeKey: entry.noticeKey,
      licenseTextIds: entry.licenseTextIds,
      packageProbe: entry.packageProbe,
      projectDistributed: shipped,
      notes: entry.notes ?? ''
    };
  });

  const summary = {
    entries: entries.length,
    byStatus: {},
    byOrigin: {},
    byChannel: {},
    projectDistributed: entries.filter(entry => entry.projectDistributed).length,
    pendingRightsholderUnknown: entries.filter(entry => entry.status === 'unknown-rightsholder').map(entry => entry.id)
  };
  for (const entry of entries) {
    summary.byStatus[entry.status] = (summary.byStatus[entry.status] ?? 0) + 1;
    summary.byOrigin[entry.origin] = (summary.byOrigin[entry.origin] ?? 0) + 1;
    for (const channel of entry.deliveryChannels) summary.byChannel[channel] = (summary.byChannel[channel] ?? 0) + 1;
  }

  const record = {
    format: 'craftmine.license-inventory/1',
    generatedAt: new Date().toISOString(),
    generatedBy: 'desktop/delivery/licensing/tools/build-inventory.mjs',
    curatedBy: 'desktop/delivery/licensing/tools/inventory-curation.json',
    worktree: {
      branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
      commit: git(['rev-parse', 'HEAD']),
      upstreamRepository: upstream.upstream.repository,
      upstreamCommit: upstream.upstream.commit,
      upstreamArchiveSha256: upstream.upstream.archiveSha256
    },
    decisionRecord: {
      path: 'docs/LICENSING_STRATEGY.md',
      status: 'decision record only; not an applied licence and not a contract',
      note: 'This inventory implements the per-module fact gathering and target recording from the decision record. It does not apply any licence.'
    },
    generatedFrom: [
      evidenceFile('desktop/UPSTREAM.json'),
      evidenceFile('desktop/delivery/licensing/evidence/upstream-diff.json'),
      evidenceFile('desktop/delivery/licensing/evidence/npm-licenses.json'),
      evidenceFile('desktop/delivery/licensing/evidence/cargo-licenses.json'),
      evidenceFile('vendor/pi-desktop/LICENSE'),
      evidenceFile('vendor/pi-desktop/Cargo.toml'),
      evidenceFile('vendor/pi-desktop/pnpm-lock.yaml'),
      evidenceFile('vendor/pi-desktop/Cargo.lock'),
      evidenceFile('desktop/godot/licenses/notices.manifest.json'),
      evidenceFile('desktop/godot/toolchain.lock.json')
    ],
    dependencyFacts: {
      npm: {packages: npm.counts.packages, withoutCopiedText: npm.counts.withoutCopiedText, lockPackages: npm.counts.lockPackages, unmatchedAgainstLock: npm.counts.unmatchedAgainstLock, licenseCounts: npm.licenseCounts},
      cargo: {lockedPackages: cargo.counts.lockedPackages, reachableFromShippedBins: cargo.counts.reachableFromShippedBins, missingLicenseId: cargo.counts.missingLicenseId, licenseCounts: cargo.licenseCounts}
    },
    upstreamDiffFacts: upstream.counts,
    summary,
    entries,
    limits: [
      'Rights verification is deliberately incomplete where evidence is missing; pending and unknown entries are not cleared by this file.',
      'Targets are copied from docs/LICENSING_STRATEGY.md and are not applied licences.',
      'Observed licence values are what the metadata or file declares, not a legal conclusion.',
      'A dependency licence expression is not the attribution text that MIT/Apache-2.0 notices require.'
    ]
  };
  fs.mkdirSync(LICENSING_DIR, {recursive: true});
  fs.writeFileSync(INVENTORY, JSON.stringify(record, null, 2) + '\n');
  return record;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (flag('refresh-evidence')) {
      const npm = refreshNpmEvidence({packageDirectory: option('package')});
      const cargo = refreshCargoEvidence();
      console.log('npm packages=' + npm.counts.packages + ' withoutText=' + npm.counts.withoutCopiedText + ' unmatchedAgainstLock=' + npm.counts.unmatchedAgainstLock);
      console.log('cargo reachable=' + cargo.counts.reachableFromShippedBins + '/' + cargo.counts.lockedPackages + ' missingLicenceId=' + cargo.counts.missingLicenseId);
    }
    const record = buildInventory();
    console.log('inventory entries=' + record.summary.entries + ' ' + JSON.stringify(record.summary.byStatus));
  } catch (error) {
    console.error('build-inventory failed: ' + error.message);
    process.exit(2);
  }
}
