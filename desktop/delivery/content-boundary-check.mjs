#!/usr/bin/env node
// Check a real artefact against one declared content boundary.
//
// The delivery has four artefacts that must not be confused: the client install, the
// creation-share package, the full portable backup and the standalone game export.
// Their contents are declared in desktop/delivery/content-boundaries.json; this tool
// reads a real directory or archive and fails closed on a forbidden path, a missing
// notice, or a boundary that is still pending.
//
// Usage
//   node desktop/delivery/content-boundary-check.mjs --boundary <id> --path <dir|file|zip> [--json]
//
// Exit codes: 0 pass, 1 violation, 3 boundary declared but not implemented, 2 usage error.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const boundaries = JSON.parse(fs.readFileSync(path.join(HERE, 'content-boundaries.json'), 'utf8').replace(/^\uFEFF/, ''));
const argumentsList = process.argv.slice(2);
const option = name => {
  const index = argumentsList.indexOf('--' + name);
  return index === -1 ? null : argumentsList[index + 1];
};
const flag = name => argumentsList.includes('--' + name);

const id = option('boundary');
const target = option('path');
if (!id || !target) {
  console.error('Usage: node desktop/delivery/content-boundary-check.mjs --boundary <client|share-package|portable-backup|standalone-game> --path <dir|file|zip> [--json]');
  process.exit(2);
}
const boundary = boundaries.boundaries?.[id];
if (!boundary) {
  console.error('Unknown boundary: ' + id + ' (known: ' + Object.keys(boundaries.boundaries ?? {}).join(', ') + ')');
  process.exit(2);
}
const targetPath = path.resolve(target);
if (!fs.existsSync(targetPath)) {
  console.error('Path is absent: ' + targetPath);
  process.exit(2);
}

const violations = [];
const notes = [];
const facts = {};

/** List entries of a ZIP without decompressing: read the central directory. */
function zipEntries(file) {
  const buffer = fs.readFileSync(file);
  const eocdSignature = 0x06054b50;
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= 0 && offset > buffer.length - 66000; offset -= 1) {
    if (buffer.readUInt32LE(offset) === eocdSignature) { eocd = offset; break; }
  }
  if (eocd === -1) throw new Error('ZIP end-of-central-directory not found');
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('bad central directory record at ' + offset);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const size = buffer.readUInt32LE(offset + 24);
    entries.push({name: buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'), bytes: size});
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function walk(directory, prefix = '') {
  const found = [];
  for (const name of fs.readdirSync(directory).sort()) {
    const child = path.join(directory, name);
    const relative = (prefix ? prefix + '/' : '') + name;
    const info = fs.lstatSync(child);
    if (info.isSymbolicLink()) { violations.push({code: 'LINK_DENIED', path: relative}); continue; }
    if (info.isDirectory()) found.push(...walk(child, relative));
    else if (info.isFile()) found.push({name: relative, bytes: info.size});
  }
  return found;
}

let entries = [];
if (boundary.kind === 'zip') {
  try {
    entries = zipEntries(targetPath);
    facts.format = 'zip';
  } catch (error) {
    violations.push({code: 'ARCHIVE_UNREADABLE', message: String(error?.message ?? error)});
  }
} else if (boundary.kind === 'stream') {
  const buffer = fs.readFileSync(targetPath).subarray(0, 4096).toString('utf8');
  facts.magicOk = buffer.startsWith(boundary.magic ?? '');
  if (!facts.magicOk) violations.push({code: 'MAGIC_MISMATCH', message: 'expected ' + JSON.stringify(boundary.magic)});
  const headerLine = buffer.split('\n')[1];
  try {
    facts.header = headerLine ? JSON.parse(headerLine) : null;
  } catch {
    violations.push({code: 'HEADER_UNPARSEABLE'});
  }
  if (facts.header && boundary.flags?.credentialsIncluded === false && facts.header.credentialsIncluded !== false) {
    violations.push({code: 'CREDENTIALS_FLAG', message: 'header does not declare credentialsIncluded:false'});
  }
  // A stream archive cannot be fully listed here; the declared exclusions are checked
  // by the producer. Record that limit instead of pretending to have scanned it.
  notes.push('stream archive: only the magic and header were read, not every entry');
} else {
  entries = walk(targetPath);
  facts.format = 'directory';
}

if (boundary.status === 'pending') {
  notes.push('boundary is declared but not implemented: ' + (boundary.pendingReason ?? ''));
}

for (const rule of boundary.mustNotContain ?? []) {
  const expression = new RegExp(rule.pattern, 'i');
  for (const entry of entries) {
    if (expression.test(entry.name)) violations.push({code: 'FORBIDDEN_PATH', path: entry.name, reason: rule.reason});
  }
}

for (const notice of boundary.requiredNotices ?? []) {
  if (notice.includes('<')) continue; // templated for the share package; verified by its own format check
  const present = entries.some(entry => entry.name === notice || entry.name.endsWith('/' + notice));
  if (!present) violations.push({code: 'NOTICE_MISSING', path: notice});
}

const record = {
  format: 'craftmine.content-boundary-check/1',
  generatedAt: new Date().toISOString(),
  boundary: id,
  path: targetPath,
  kind: boundary.kind,
  status: boundary.status,
  entryCount: entries.length,
  totalBytes: entries.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0),
  facts,
  violations,
  notes,
  limits: [
    'The check reads names and sizes; it does not open payload files or prove the artefact works.',
    'A pending boundary always exits 3 and is never reported as a pass.'
  ]
};
if (flag('json')) console.log(JSON.stringify(record, null, 2));
else {
  console.log('BOUNDARY ' + id + ' ' + targetPath);
  console.log('  kind=' + boundary.kind + ' status=' + boundary.status + ' entries=' + record.entryCount + ' bytes=' + record.totalBytes);
  for (const violation of violations) console.log('  VIOLATION ' + violation.code + ' ' + (violation.path ?? violation.message ?? '') + (violation.reason ? '  # ' + violation.reason : ''));
  for (const note of notes) console.log('  note: ' + note);
  console.log((violations.length ? 'BOUNDARY VIOLATED' : boundary.status === 'pending' ? 'BOUNDARY PENDING — NOT A PASS' : 'BOUNDARY OK') + ': ' + violations.length + ' violation(s)');
}
process.exit(violations.length ? 1 : boundary.status === 'pending' ? 3 : 0);
