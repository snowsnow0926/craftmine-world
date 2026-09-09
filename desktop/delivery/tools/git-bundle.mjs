#!/usr/bin/env node
// Verify and stage the pinned Git distribution that ships with the client.
//
// R1's managed Git must not depend on the user's PATH: its adapter looks for
// CRAFTMINE_BUNDLED_GIT or an exe-adjacent git/bin/git.exe and otherwise reports
// source=pathFallback. This tool turns the pinned MinGit archive in
// desktop/delivery/git-bundle.json into that layout, verifying the official digest and
// the reported version first. It never downloads anything at package time and never
// invents a version string.
//
// Usage
//   node desktop/delivery/tools/git-bundle.mjs verify --zip <MinGit.zip> [--work <dir>]
//   node desktop/delivery/tools/git-bundle.mjs stage  --package <dir> --zip <MinGit.zip> [--work <dir>]
//
// Exit codes: 0 verified, 1 verification failure, 2 usage error.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const PIN_PATH = path.join(ROOT, 'desktop/delivery/git-bundle.json');
const argumentsList = process.argv.slice(2);
const command = argumentsList[0] && !argumentsList[0].startsWith('--') ? argumentsList[0] : null;
const option = name => {
  const index = argumentsList.indexOf('--' + name);
  return index === -1 ? null : argumentsList[index + 1];
};
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

if (!['verify', 'stage'].includes(command)) {
  console.error('Usage: node desktop/delivery/tools/git-bundle.mjs <verify|stage> --zip <MinGit.zip> [--package <dir>] [--work <dir>]');
  process.exit(2);
}
const pin = JSON.parse(fs.readFileSync(PIN_PATH, 'utf8').replace(/^\uFEFF/, ''));
const zip = option('zip');
if (!zip || !fs.existsSync(zip)) {
  console.error('--zip <MinGit archive> is required and must exist');
  process.exit(2);
}
const work = path.resolve(option('work') ?? path.join(ROOT, 'desktop/build/git-bundle-work'));
const failures = [];
const facts = {};

const archiveBytes = fs.statSync(zip).size;
const archiveHash = digest(zip);
facts.archive = {path: path.resolve(zip), bytes: archiveBytes, sha256: archiveHash};
if (archiveBytes !== pin.archive.bytes) failures.push('ARCHIVE_BYTES: ' + archiveBytes + ' != pinned ' + pin.archive.bytes);
if (archiveHash !== pin.archive.sha256) failures.push('ARCHIVE_HASH: ' + archiveHash + ' != pinned ' + pin.archive.sha256);

// ---------------------------------------------------------------- extract
const extracted = path.join(work, 'extracted');
if (!failures.length) {
  fs.rmSync(extracted, {recursive: true, force: true});
  fs.mkdirSync(extracted, {recursive: true});
  try {
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      'Expand-Archive -LiteralPath ' + JSON.stringify(zip) + ' -DestinationPath ' + JSON.stringify(extracted) + ' -Force'],
    {windowsHide: true, stdio: 'pipe'});
  } catch (error) {
    failures.push('EXTRACT_FAILED: ' + String(error?.message ?? error).slice(0, 300));
  }
}

// ---------------------------------------------------------------- version probe
function walk(directory, prefix = '') {
  const found = [];
  for (const name of fs.readdirSync(directory).sort()) {
    const target = path.join(directory, name);
    const info = fs.lstatSync(target);
    const relative = (prefix ? prefix + '/' : '') + name;
    if (info.isSymbolicLink()) throw new Error('LINK_DENIED: ' + relative);
    if (info.isDirectory()) found.push(...walk(target, relative));
    else if (info.isFile()) found.push({path: relative, bytes: info.size, sha256: digest(target)});
  }
  return found;
}

if (!failures.length) {
  const wrapper = path.join(extracted, pin.layout.sourceEntry);
  if (!fs.existsSync(wrapper)) failures.push('ENTRY_MISSING: ' + pin.layout.sourceEntry);
  else {
    let output = '';
    try {
      output = execFileSync(wrapper, ['--version'], {encoding: 'utf8', windowsHide: true}).trim();
    } catch (error) {
      failures.push('VERSION_PROBE_FAILED: ' + String(error?.message ?? error).slice(0, 200));
    }
    facts.versionOutput = output;
    const match = /git version (\d+)\.(\d+)\.(\d+)/.exec(output);
    if (!match) failures.push('VERSION_UNPARSEABLE: ' + output);
    else {
      const [major, minor] = [Number(match[1]), Number(match[2])];
      facts.version = match[0].replace('git version ', '');
      facts.versionMajor = major;
      facts.versionMinor = minor;
      const [minMajor, minMinor] = pin.contract.minimum;
      if (major < minMajor || (major === minMajor && minor < minMinor)) {
        failures.push('VERSION_TOO_OLD: ' + facts.version + ' < ' + minMajor + '.' + minMinor);
      }
      if (facts.version !== pin.version && !String(pin.version).startsWith(facts.version + '.')) {
        failures.push('VERSION_MISMATCH: ' + facts.version + ' != pinned ' + pin.version);
      }
    }
  }
  const licence = path.join(extracted, pin.licence.file);
  if (!fs.existsSync(licence)) failures.push('LICENCE_MISSING: ' + pin.licence.file);
  else facts.licence = {path: pin.licence.file, bytes: fs.statSync(licence).size, sha256: digest(licence)};
}

// ---------------------------------------------------------------- stage
let staged = null;
if (!failures.length && command === 'stage') {
  const packageOption = option('package');
  if (!packageOption) {
    console.error('stage needs --package <win-unpacked>');
    process.exit(2);
  }
  const packageDirectory = path.resolve(packageOption);
  if (!fs.existsSync(packageDirectory)) {
    console.error('Package directory is absent: ' + packageDirectory);
    process.exit(2);
  }
  const target = path.join(packageDirectory, pin.layout.packageRoot);
  fs.rmSync(target, {recursive: true, force: true});
  fs.cpSync(extracted, target, {recursive: true, filter: source => !fs.lstatSync(source).isSymbolicLink()});
  fs.mkdirSync(path.join(target, 'bin'), {recursive: true});
  fs.copyFileSync(path.join(extracted, pin.layout.sourceEntry), path.join(target, pin.layout.entry));
  const files = walk(target);
  const bundleRecord = {
    format: 'craftmine.git-bundle-staged/1',
    stagedAt: new Date().toISOString(),
    pin: {id: pin.id, version: pin.version, archiveSha256: pin.archive.sha256, url: pin.archive.url},
    versionOutput: facts.versionOutput,
    entry: pin.layout.packageRoot + '/' + pin.layout.entry,
    contract: pin.contract,
    licence: facts.licence,
    files,
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    limits: [
      'The tree is the official MinGit archive; per-component licences under mingw64/share/licenses/** are kept.',
      'content.gitInfo.source is expected to become "bundled" only when the integrated client runs with this tree; that has not been observed yet.'
    ]
  };
  fs.writeFileSync(path.join(target, 'GIT-BUNDLE.json'), JSON.stringify(bundleRecord, null, 2) + '\n');
  staged = {target: pin.layout.packageRoot, fileCount: bundleRecord.fileCount, totalBytes: bundleRecord.totalBytes};
  facts.staged = staged;
}

const record = {format: 'craftmine.git-bundle-verification/1', generatedAt: new Date().toISOString(), command, pin: pin.id, ok: failures.length === 0, facts, failures};
console.log(JSON.stringify(record, null, 2));
process.exit(failures.length ? 1 : 0);
