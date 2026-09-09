#!/usr/bin/env node
// Bring an already-built Windows package's licence directory up to the offline entry.
//
// Why this exists: a built package can only carry the notices its build step copied.
// Round one produced a package that failed the licence check with 67 items, mostly
// third-party texts that simply were not copied. This tool assembles those texts from
// the provenance-recorded official copies under desktop/delivery/licensing/texts/
// and rewrites only the package's licence directory. It never touches a binary, never
// invents a licence text, and records every action with a SHA-256.
//
// Usage
//   node desktop/delivery/licensing/tools/apply-package-licences.mjs --package <win-unpacked> [options]
//
// Options
//   --package <dir>    built package to repair (required)
//   --licensing <dir>  licensing directory (default: this tool's parent)
//   --guide <file>     copy this file to resources/source/USER_GUIDE.zh-CN.md
//   --report <file>    report path (default: <package>/resources/licenses/LICENCE-FIX-REPORT.json)
//   --dry-run          list the actions without writing
//
// Exit code: 0 when every required text is present and every npm package has a text
// or a recorded unresolved reason; 1 when something is still missing; 2 on usage error.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argumentsList = process.argv.slice(2);
const option = name => {
  const index = argumentsList.indexOf('--' + name);
  return index === -1 ? null : argumentsList[index + 1];
};
const flag = name => argumentsList.includes('--' + name);

const packageOption = option('package');
if (!packageOption) {
  console.error('Usage: node desktop/delivery/licensing/tools/apply-package-licences.mjs --package <win-unpacked> [--guide <file>] [--dry-run]');
  process.exit(2);
}
const packageDirectory = path.resolve(packageOption);
if (!fs.existsSync(packageDirectory) || !fs.statSync(packageDirectory).isDirectory()) {
  console.error('Package directory is absent: ' + packageDirectory);
  process.exit(2);
}
const licensingDirectory = path.resolve(option('licensing') ?? path.join(HERE, '..'));
const textsDirectory = path.join(licensingDirectory, 'texts');
const licencesDirectory = path.join(packageDirectory, 'resources/licenses');
const dryRun = flag('dry-run');
const actions = [];
const failures = [];

const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const relative = file => path.relative(packageDirectory, file).replaceAll('\\', '/');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));

/** Copy a provenance-recorded text into the package; never overwrite a different file. */
function installText(source, target, why) {
  if (!fs.existsSync(source)) {
    failures.push({code: 'SOURCE_TEXT_ABSENT', target: relative(target), source, why});
    return false;
  }
  const sourceBytes = fs.statSync(source).size;
  if (fs.existsSync(target)) {
    const same = digest(source) === digest(target);
    actions.push({action: same ? 'kept' : 'conflict', target: relative(target), source, bytes: sourceBytes, sha256: digest(source), why});
    if (!same) failures.push({code: 'TEXT_CONFLICT', target: relative(target), source, why});
    return same;
  }
  if (!dryRun) {
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.copyFileSync(source, target);
  }
  actions.push({action: 'installed', target: relative(target), source, bytes: sourceBytes, sha256: digest(source), why});
  return true;
}

// ---------------------------------------------------------------- offline entry
const offline = readJson(path.join(licensingDirectory, 'offline-entry.json'));
const section = offline.package;
if (!section) {
  console.error('offline-entry.json has no package section');
  process.exit(2);
}
const engineBundled = fs.existsSync(path.join(packageDirectory, 'resources/licenses/godot'));
for (const item of section.required ?? []) {
  const required = item.status === 'required' || (item.status === 'required-when-engine-bundled' && engineBundled);
  if (!required) continue;
  const target = path.join(licencesDirectory, item.file);
  if (item.generated) {
    // Generated at package time (npm inventory, Rust notices); repoText is only the
    // reference evidence. Verify presence instead of copying it over the package file.
    if (!fs.existsSync(target)) failures.push({code: 'GENERATED_TEXT_ABSENT', target: section.root + '/' + item.file, why: item.id});
    else actions.push({action: 'present', target: relative(target), bytes: fs.statSync(target).size, sha256: digest(target), why: 'generated at package time: ' + item.id});
    continue;
  }
  if (!item.repoText) {
    failures.push({code: 'REQUIRED_TEXT_WITHOUT_SOURCE', target: section.root + '/' + item.file, why: item.id});
    continue;
  }
  installText(path.join(licensingDirectory, '..', '..', '..', item.repoText), target, 'offline-entry ' + item.id + ' (' + item.status + ')');
}

// ---------------------------------------------------------------- notice document
const noticeSource = path.join(licensingDirectory, 'notices', section.entryDocument ?? 'CRAFTMINE-NOTICES.md');
if (fs.existsSync(noticeSource)) {
  const target = path.join(licencesDirectory, section.entryDocument ?? 'CRAFTMINE-NOTICES.md');
  if (fs.existsSync(target) && digest(target) !== digest(noticeSource)) {
    if (!dryRun) fs.copyFileSync(noticeSource, target);
    actions.push({action: 'replaced', target: relative(target), source: noticeSource, bytes: fs.statSync(noticeSource).size, sha256: digest(noticeSource), why: 'package notice document refreshed from the generated notices'});
  } else if (!fs.existsSync(target)) {
    installText(noticeSource, target, 'package notice document');
  } else {
    actions.push({action: 'kept', target: relative(target), source: noticeSource, bytes: fs.statSync(target).size, sha256: digest(target), why: 'notice document already current'});
  }
} else {
  failures.push({code: 'NOTICE_DOCUMENT_SOURCE_ABSENT', source: noticeSource, why: 'generated notices are missing; run licensing/tools/gen-notices.mjs'});
}

// ---------------------------------------------------------------- Rust notices
const cargoEvidence = path.join(licensingDirectory, 'evidence', 'cargo-licenses.json');
const cargoTarget = path.join(licencesDirectory, 'third-party/CARGO-NOTICES.md');
if (fs.existsSync(cargoEvidence)) {
  const evidence = readJson(cargoEvidence);
  const packages = evidence.packages ?? [];
  const lines = [
    '# Rust third-party notices',
    '',
    'Generated by desktop/delivery/licensing/tools/apply-package-licences.mjs from',
    '`desktop/delivery/licensing/evidence/cargo-licenses.json` (source: `' + (evidence.source ?? 'cargo metadata') + '`).',
    '',
    'Every crate below is linked into the shipped Rust binaries (`resources/bin/craftmine-core.exe`,',
    '`resources/bin/pi-desktop-host-core.exe`). The canonical licence texts named by each crate are',
    'bundled beside this file under `third-party/`.',
    '',
    '| Crate | Version | Licence |',
    '| --- | --- | --- |',
    ...packages.map(item => '| ' + item.name + ' | ' + item.version + ' | ' + (item.license ?? 'unknown') + ' |'),
    '',
    'Licence counts: ' + Object.entries(evidence.licenseCounts ?? {}).map(([id, count]) => id + '=' + count).join(', '),
    ''
  ];
  if (!dryRun) {
    fs.mkdirSync(path.dirname(cargoTarget), {recursive: true});
    fs.writeFileSync(cargoTarget, lines.join('\n'));
  }
  actions.push({action: 'generated', target: relative(cargoTarget), source: cargoEvidence, bytes: Buffer.byteLength(lines.join('\n')), sha256: dryRun ? null : digest(cargoTarget), why: 'consolidated Rust crate attribution'});
} else {
  failures.push({code: 'CARGO_EVIDENCE_ABSENT', source: cargoEvidence, why: 'cargo licence evidence missing'});
}

// ---------------------------------------------------------------- npm inventory
const npmInventoryPath = path.join(licencesDirectory, 'third-party/npm-inventory.json');
const textSources = fs.existsSync(path.join(textsDirectory, 'SOURCES.json')) ? readJson(path.join(textsDirectory, 'SOURCES.json')) : {texts: []};
const canonical = new Map();
for (const text of textSources.texts ?? []) canonical.set(text.spdx, path.join(licensingDirectory, 'texts', path.basename(text.file)));
const unresolved = [];
if (fs.existsSync(npmInventoryPath)) {
  const inventory = readJson(npmInventoryPath);
  let repaired = 0;
  for (const entry of inventory.packages ?? []) {
    if ((entry.licenseFiles ?? []).length) continue;
    const identifiers = String(entry.license ?? '').split(/\s+(?:OR|AND)\s+/).map(value => value.trim()).filter(Boolean);
    const sources = identifiers.map(id => canonical.get(id)).filter(Boolean);
    if (!sources.length) {
      unresolved.push({package: entry.package, license: entry.license ?? null, reason: 'no canonical text for this licence id'});
      continue;
    }
    const installed = [];
    for (const source of sources) {
      const target = path.join(licencesDirectory, 'third-party/canonical', path.basename(source));
      installText(source, target, 'canonical text for ' + entry.package + ' (' + entry.license + ')');
      installed.push('canonical/' + path.basename(source));
    }
    entry.licenseFiles = installed;
    entry.canonicalTextNote = 'The installed package ships no licence file; the canonical text for its declared licence id is bundled under third-party/canonical/.';
    repaired++;
  }
  if (!dryRun && repaired) fs.writeFileSync(npmInventoryPath, JSON.stringify(inventory, null, 2) + '\n');
  actions.push({action: 'repaired', target: relative(npmInventoryPath), bytes: fs.statSync(npmInventoryPath).size, sha256: dryRun ? null : digest(npmInventoryPath), why: repaired + ' npm packages without a bundled licence text now point at the canonical text'});
} else {
  failures.push({code: 'NPM_INVENTORY_ABSENT', source: npmInventoryPath, why: 'the package has no third-party npm inventory'});
}

// ---------------------------------------------------------------- user guide
const guideOption = option('guide');
if (guideOption) {
  const source = path.resolve(guideOption);
  const target = path.join(packageDirectory, 'resources/source/USER_GUIDE.zh-CN.md');
  if (!fs.existsSync(source)) failures.push({code: 'GUIDE_SOURCE_ABSENT', source, why: '--guide file not found'});
  else if (fs.existsSync(target) && digest(target) === digest(source)) actions.push({action: 'kept', target: relative(target), source, bytes: fs.statSync(target).size, sha256: digest(target), why: 'user guide already current'});
  else {
    if (!dryRun) {
      fs.mkdirSync(path.dirname(target), {recursive: true});
      fs.copyFileSync(source, target);
    }
    actions.push({action: 'replaced', target: relative(target), source, bytes: fs.statSync(source).size, sha256: digest(source), why: 'stale packaged user guide refreshed from the tree'});
  }
}

// ---------------------------------------------------------------- report
const report = {
  format: 'craftmine.package-licence-repair/1',
  generatedAt: new Date().toISOString(),
  package: packageDirectory,
  dryRun,
  engineBundled,
  actions,
  unresolved,
  failures,
  limits: [
    'Only the licence directory and the packaged user guide are written; no binary is modified.',
    'Every installed text is copied from a provenance-recorded official copy under desktop/delivery/licensing/texts/; no text is authored here.',
    'Repairing the notices does not apply a licence to project code: entries that are pending-rights-review stay pending in inventory.json.'
  ]
};
const reportPath = path.resolve(option('report') ?? path.join(licencesDirectory, 'LICENCE-FIX-REPORT.json'));
if (!dryRun) {
  fs.mkdirSync(path.dirname(reportPath), {recursive: true});
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
}
console.log('LICENCE REPAIR ' + (dryRun ? '(dry run) ' : '') + 'package=' + packageDirectory);
for (const action of actions) console.log('  ' + action.action.padEnd(9) + ' ' + action.target + (action.why ? '  # ' + action.why : ''));
for (const item of unresolved) console.log('  UNRESOLVED ' + item.package + ' [' + item.license + '] ' + item.reason);
for (const item of failures) console.log('  FAILURE    ' + item.code + ' ' + (item.target ?? item.source ?? '') + ' ' + (item.why ?? ''));
console.log('actions=' + actions.length + ' unresolved=' + unresolved.length + ' failures=' + failures.length);
process.exit(failures.length || unresolved.length ? 1 : 0);
