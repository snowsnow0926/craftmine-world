#!/usr/bin/env node
// Read-only delivery preflight. Fails closed on missing notices, missing assets,
// hash drift and licence conditions that contradict the declared distribution.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  REPO_ROOT,
  checkBaseAssets,
  checkExport,
  checkGodotCache,
  checkLgpl,
  checkNotices,
  checkPackage,
  collectBuildFacts,
  loadLock
} from './lib/preflight-core.mjs';

const USAGE = `craftmine delivery preflight (read-only)

Usage: node desktop/delivery/preflight.mjs <command> [options]

Commands
  notices    Pinned Godot licence/copyright bytes, required entries, lock drift
  assets     Per-base provenance manifests, pinned hashes, undeclared files
  lgpl       PI-Desktop LGPL notice, provenance, metadata and packaged copies
  cache      Pinned engine cache archives, unpacked files and Web templates
  export     An exported Web build: notices, bridge and build.json manifest
  package    A built Windows package: required files, source manifest, notices
  all        Every check whose inputs are available (default)

Options
  --root <dir>       Repository root to inspect (default: this worktree)
  --cache <dir>      Engine cache directory (default: desktop/build/godot/<version>)
  --export <dir>     Exported Web build directory
  --package <dir>    win-unpacked directory
  --evidence <file>  Write the JSON evidence record to this path
  --json             Print the machine-readable record instead of a summary
  --quiet            Print only failures

Exit code is non-zero when any check fails. Missing optional inputs are reported
as skipped, never as passed.`;

const argumentsList = process.argv.slice(2);
const command = argumentsList[0] && !argumentsList[0].startsWith('--') ? argumentsList[0] : 'all';
const option = name => {
  const index = argumentsList.indexOf('--' + name);
  return index === -1 ? null : argumentsList[index + 1];
};
const flag = name => argumentsList.includes('--' + name);

if (flag('help') || command === 'help') {
  console.log(USAGE);
  process.exit(0);
}

const root = path.resolve(option('root') ?? REPO_ROOT);
if (!fs.existsSync(root)) {
  console.error('Repository root is absent: ' + root);
  process.exit(2);
}
let lock = null;
try {
  lock = loadLock(root);
} catch {}

const cacheOption = option('cache');
const defaultCache = lock ? path.join(root, 'desktop/build/godot', lock.version) : null;
const cacheDirectory = cacheOption ? path.resolve(cacheOption) : defaultCache && fs.existsSync(defaultCache) ? defaultCache : null;
const exportDirectory = option('export') ? path.resolve(option('export')) : null;
const packageDirectory = option('package') ? path.resolve(option('package')) : null;

const runners = {
  notices: () => [checkNotices(root)],
  assets: () => [checkBaseAssets(root)],
  lgpl: () => [checkLgpl(root, {packageDirectory})],
  cache: () => [checkGodotCache(root, cacheDirectory)],
  export: () => [checkExport(root, exportDirectory)],
  package: () => [checkPackage(root, packageDirectory)],
  all: () => [
    checkNotices(root),
    checkBaseAssets(root),
    checkLgpl(root, {packageDirectory}),
    checkGodotCache(root, cacheDirectory),
    checkExport(root, exportDirectory),
    checkPackage(root, packageDirectory)
  ]
};

if (!runners[command]) {
  console.error('Unknown command: ' + command + '\n\n' + USAGE);
  process.exit(2);
}

const checks = runners[command]();
const failures = checks.flatMap(check => check.failures);
const warnings = checks.flatMap(check => check.warnings);
const record = {
  format: 'craftmine.delivery-preflight/1',
  generatedAt: new Date().toISOString(),
  command,
  root,
  commit: collectBuildFacts(root).commit,
  ok: failures.length === 0,
  checks,
  failures,
  warnings,
  inputs: {
    cache: cacheDirectory,
    export: exportDirectory,
    package: packageDirectory
  },
  facts: collectBuildFacts(root, {packageDirectory, exportDirectory}),
  limits: [
    'Read-only: no download, no installer, no window and no write inside the inspected tree.',
    'Hash equality proves these bytes, not that a licence is legally sufficient for a specific business use.',
    'Skipped inputs are not verified and are listed explicitly.'
  ]
};

const evidencePath = option('evidence');
if (evidencePath) {
  const target = path.resolve(evidencePath);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, JSON.stringify(record, null, 2) + '\n');
}

if (flag('json')) {
  console.log(JSON.stringify(record, null, 2));
} else {
  for (const check of checks) {
    const skipped = check.facts?.skipped ? ' (skipped)' : '';
    console.log((check.ok ? 'PASS ' : 'FAIL ') + check.id + skipped);
    if (!flag('quiet')) {
      for (const failure of check.failures) console.log('  - ' + failure.code + ': ' + failure.message);
      for (const warning of check.warnings) console.log('  ~ ' + warning);
    } else {
      for (const failure of check.failures) console.log('  - ' + failure.code + ': ' + failure.message);
    }
  }
  console.log((record.ok ? 'PREFLIGHT PASSED' : 'PREFLIGHT FAILED') + ': ' + checks.length + ' checks, ' + failures.length + ' failures, ' + warnings.length + ' warnings');
  if (evidencePath) console.log('Evidence: ' + path.resolve(evidencePath));
  else console.log('Tip: add --evidence <file> to persist this record.');
}

process.exit(record.ok ? 0 : 1);
