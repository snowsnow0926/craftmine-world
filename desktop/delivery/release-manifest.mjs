#!/usr/bin/env node
// Reproducible release manifest + package verification CLI (read-only).
//
//   create --root <dir> --out <file> [--package <dir>] [--cache <dir>] [--probe-binaries]
//   verify --manifest <file> --package <dir> [--strict-extra]
//   diff   --manifest <a> --manifest <b>
//
// No third-party dependencies. No download, no GUI, no window activation, no input.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  RELEASE_MANIFEST_FORMAT,
  REPO_ROOT,
  createReleaseManifest,
  diffManifests,
  loadReleaseManifest,
  verifyPackage
} from './lib/release-manifest-core.mjs';

const USAGE = `craftmine release manifest + package verification (read-only)

Usage: node desktop/delivery/release-manifest.mjs <command> [options]

Commands
  create   Pin a reproducible release manifest from a repository root
  verify   Assert a built package matches the manifest and carries no dev artifacts
  diff     Compare two manifests and list added/removed/changed components and files

Options
  --root <dir>       Repository root for create (default: this worktree)
  --out <file>       Write the created manifest to this file
  --package <dir>    create: pin required package files as package snapshots
                     verify: the package directory to verify (required)
  --cache <dir>      create: hash the shared Godot engine cache with preflight-core
  --probe-binaries   create: read native broker --version output (no window)
  --manifest <file>  verify: manifest to verify; diff: pass twice (a then b)
  --strict-extra     verify: treat undeclared package files as a failure
  --evidence <file>  Write the full JSON record to this path
  --json             Print the machine-readable record instead of a summary
  --quiet            Print only problems
  --help             Show this text

Exit codes: 0 success, 1 verification/diff failure, 2 usage error.

A passing development build is never a verified package: verify requires --package
and lists every required file that is absent, unpinned or byte-different.`;

const argv = process.argv.slice(2);
const command = argv[0] && !argv[0].startsWith('--') ? argv[0] : null;
const option = name => {
  const index = argv.indexOf('--' + name);
  return index === -1 ? null : argv[index + 1] ?? null;
};
const options = name => {
  const values = [];
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--' + name) values.push(argv[index + 1] ?? null);
  }
  return values;
};
const flag = name => argv.includes('--' + name);
const quiet = flag('quiet');
const asJson = flag('json');

if (!command || command === 'help' || flag('help')) {
  console.log(USAGE);
  process.exit(command ? 0 : 2);
}

const evidencePath = option('evidence');
const writeEvidence = record => {
  if (!evidencePath) return;
  const target = path.resolve(evidencePath);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, JSON.stringify(record, null, 2) + '\n');
};

const failUsage = message => {
  console.error(message + '\n\n' + USAGE);
  process.exit(2);
};

if (command === 'create') {
  const root = path.resolve(option('root') ?? REPO_ROOT);
  if (!fs.existsSync(root)) failUsage('Repository root is absent: ' + root);
  const manifest = createReleaseManifest(root, {
    packageDirectory: option('package') ? path.resolve(option('package')) : null,
    cacheDirectory: option('cache') ? path.resolve(option('cache')) : null,
    probeBinaries: flag('probe-binaries')
  });
  const out = option('out');
  if (out) {
    const target = path.resolve(out);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, JSON.stringify(manifest, null, 2) + '\n');
  }
  writeEvidence(manifest);
  if (asJson) {
    console.log(JSON.stringify(manifest, null, 2));
  } else {
    console.log('RELEASE MANIFEST ' + manifest.format);
    console.log('  commit      ' + (manifest.identity.commit ?? '<none>') + ' (' + (manifest.identity.shortCommit ?? '?') + ')');
    console.log('  dirty       ' + String(manifest.identity.dirty));
    console.log('  client      ' + (manifest.identity.productName ?? '?') + ' ' + (manifest.identity.clientVersion ?? '?'));
    for (const {key, component: entry} of flatten(manifest)) {
      const label = (entry.id ?? key).padEnd(26);
      console.log('  ' + label + ' ' + String(entry.status).padEnd(20) +
        ' files=' + String((entry.files ?? []).length).padStart(4) +
        ' bytes=' + String(totalBytes(entry)).padStart(12) +
        ' version=' + (entry.version ?? 'null'));
      if (!quiet) {
        if (entry.notes) console.log('      ' + entry.notes);
        for (const expected of entry.expectedPaths ?? []) {
          console.log('      pending: ' + expected.expectedPath + ' (' + expected.owner + ', ' + expected.source + ')');
        }
      }
    }
    console.log('  totals      files=' + manifest.totals.files + ' bytes=' + manifest.totals.bytes +
      ' presentFiles=' + manifest.totals.presentFiles + ' presentBytes=' + manifest.totals.presentBytes);
    console.log('  pinnedInputs ' + manifest.reproducibility.pinnedInputs.length +
      ', limits ' + manifest.reproducibility.limits.length);
    if (out) console.log('Wrote ' + path.resolve(out));
  }
  process.exit(0);
}

if (command === 'verify') {
  const manifestFile = option('manifest');
  if (!manifestFile) failUsage('verify requires --manifest <file>');
  if (!fs.existsSync(path.resolve(manifestFile))) failUsage('Manifest is absent: ' + path.resolve(manifestFile));
  const manifest = loadReleaseManifest(path.resolve(manifestFile));
  const packageDirectory = option('package');
  const record = verifyPackage(manifest, packageDirectory ? path.resolve(packageDirectory) : null, {
    strictExtra: flag('strict-extra')
  });
  writeEvidence(record);
  if (asJson) {
    console.log(JSON.stringify(record, null, 2));
  } else {
    console.log('PACKAGE VERIFICATION ' + record.format);
    console.log('  manifest    ' + path.resolve(manifestFile));
    console.log('  package     ' + (record.packageDirectory ?? '<not supplied>'));
    console.log('  required    ' + record.facts.requiredCount + '  packageFiles ' +
      record.facts.packageFiles + '  packageBytes ' + record.facts.packageBytes);
    if (record.pendingComponents.length) {
      console.log('  pending-integration components (no hash, not package files): ' +
        record.pendingComponents.join(', '));
    }
    for (const item of record.missing) console.log('  MISSING   ' + item.path + '  [' + item.origin + ']');
    for (const item of record.mismatch) {
      console.log('  MISMATCH  ' + item.path + '  [' + item.origin + ']');
      if (!quiet) {
        console.log('      expected ' + item.expected.sha256 + ' (' + item.expected.bytes + ' bytes)');
        console.log('      actual   ' + item.actual.sha256 + ' (' + item.actual.bytes + ' bytes)');
      }
    }
    for (const item of record.unpinned) {
      console.log('  UNPINNED  ' + item.path + '  [' + item.origin + '] ' + item.reason +
        ' actual=' + item.sha256);
    }
    for (const item of record.forbidden) console.log('  FORBIDDEN ' + item.path + '  (' + item.rule + ')');
    for (const item of record.links) console.log('  LINK      ' + item);
    if (record.selfAttestation) {
      const artifacts = record.selfAttestation.artifacts ?? [];
      console.log('  self-attested artifacts: ' + artifacts.filter(item => item.ok).length + '/' +
        artifacts.length + ' match the packaged build-manifest.json (self-attestation, not independent)');
    }
    console.log('  extra files: ' + record.extra.count + (record.extra.strict ? ' (strict: fatal)' : ' (reported, not fatal)'));
    if (!quiet && record.extra.sample.length) {
      console.log('      first ' + record.extra.sample.length + ': ' + record.extra.sample.slice(0, 8).join(', ') +
        (record.extra.sample.length > 8 ? ', ...' : ''));
    }
    for (const warning of record.warnings) console.log('  ~ ' + warning);
    console.log((record.ok ? 'PACKAGE VERIFIED' : 'PACKAGE NOT VERIFIED') + ': ' +
      record.missing.length + ' missing, ' + record.mismatch.length + ' mismatch, ' +
      record.unpinned.length + ' unpinned, ' + record.forbidden.length + ' forbidden, ' +
      record.links.length + ' links');
  }
  if (evidencePath) console.log('Evidence: ' + path.resolve(evidencePath));
  process.exit(record.ok ? 0 : 1);
}

if (command === 'diff') {
  const files = options('manifest').filter(Boolean);
  if (files.length !== 2) failUsage('diff requires --manifest <a> --manifest <b>');
  for (const file of files) if (!fs.existsSync(path.resolve(file))) failUsage('Manifest is absent: ' + path.resolve(file));
  const result = diffManifests(loadReleaseManifest(path.resolve(files[0])), loadReleaseManifest(path.resolve(files[1])));
  writeEvidence(result);
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('RELEASE MANIFEST DIFF ' + result.format);
    console.log('  a ' + path.resolve(files[0]) + '  ' + (result.a.identity?.commit ?? '?'));
    console.log('  b ' + path.resolve(files[1]) + '  ' + (result.b.identity?.commit ?? '?'));
    for (const item of result.identity.changed) {
      console.log('  IDENTITY  ' + item.field + ': ' + JSON.stringify(item.old) + ' -> ' + JSON.stringify(item.new));
    }
    for (const item of result.components.added) console.log('  COMPONENT + ' + item.key);
    for (const item of result.components.removed) console.log('  COMPONENT - ' + item.key);
    for (const item of result.components.changed) console.log('  COMPONENT ~ ' + item.key);
    for (const item of result.files.added) console.log('  FILE + ' + item.key + '  ' + item.sha256);
    for (const item of result.files.removed) console.log('  FILE - ' + item.key + '  ' + item.sha256);
    for (const item of result.files.changed) {
      console.log('  FILE ~ ' + item.key);
      if (!quiet) console.log('      ' + item.oldSha256 + ' -> ' + item.newSha256);
    }
    console.log((result.ok ? 'MANIFESTS IDENTICAL' : 'MANIFESTS DIFFER') + ': ' +
      result.components.added.length + ' components added, ' + result.components.removed.length +
      ' removed, ' + result.components.changed.length + ' changed; ' +
      result.files.added.length + ' files added, ' + result.files.removed.length + ' removed, ' +
      result.files.changed.length + ' changed');
  }
  if (evidencePath) console.log('Evidence: ' + path.resolve(evidencePath));
  process.exit(result.ok ? 0 : 1);
}

failUsage('Unknown command: ' + command);

function flatten(manifest) {
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

function totalBytes(entry) {
  return (entry.files ?? []).reduce((sum, file) => sum + (typeof file?.bytes === 'number' ? file.bytes : 0), 0);
}
