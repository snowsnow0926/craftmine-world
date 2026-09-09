#!/usr/bin/env node
// Compare the vendored PI-Desktop tree with the pinned upstream archive.
// Produces licensing/evidence/upstream-diff.json: which files are upstream,
// project-modified or project-added. It verifies the archive SHA-256 first and
// never writes inside the vendored tree.
//
// Usage:
//   node desktop/delivery/licensing/tools/upstream-diff.mjs --archive <PI-Desktop.zip> [--out <file>]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const LICENSING_DIR = path.resolve(HERE, '..');
export const REPO_ROOT = path.resolve(LICENSING_DIR, '..', '..', '..');
const UPSTREAM = 'desktop/UPSTREAM.json';
const DEFAULT_OUT = 'desktop/delivery/licensing/evidence/upstream-diff.json';
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', 'target', 'dist', 'dist-bundle', '.godot', 'build']);

const option = name => {
  const index = process.argv.indexOf('--' + name);
  return index === -1 ? null : process.argv[index + 1];
};

const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const rel = (base, file) => path.relative(base, file).replaceAll('\\', '/');

function walkFiles(root, base = root, out = new Map()) {
  for (const name of fs.readdirSync(base).sort()) {
    const target = path.join(base, name);
    const info = fs.lstatSync(target);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) {
      if (SKIP_DIRECTORIES.has(name)) continue;
      walkFiles(root, target, out);
    } else if (info.isFile()) {
      out.set(rel(root, target), sha256(target));
    }
  }
  return out;
}

function trackedFiles(repoRoot, prefix) {
  const output = execFileSync('git', ['-C', repoRoot, 'ls-files', '--', prefix], {encoding: 'utf8', windowsHide: true});
  return output.split(/\r?\n/).filter(Boolean);
}

function extractArchive(archive, destination) {
  fs.mkdirSync(destination, {recursive: true});
  try {
    execFileSync('tar', ['-xf', archive, '-C', destination], {stdio: 'ignore', windowsHide: true});
    return;
  } catch (error) {
    // Windows without bsdtar: fall back to PowerShell Expand-Archive.
    execFileSync('powershell', ['-NoProfile', '-Command', 'Expand-Archive -LiteralPath "' + archive.replaceAll('"', '""') + '" -DestinationPath "' + destination.replaceAll('"', '""') + '" -Force'], {stdio: 'ignore', windowsHide: true});
  }
}

export function upstreamDiff({archive, out = DEFAULT_OUT} = {}) {
  const upstream = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, UPSTREAM), 'utf8'));
  if (!archive) throw new Error('--archive <PI-Desktop.zip> is required (download ' + upstream.archiveURL + ')');
  if (!fs.existsSync(archive)) throw new Error('archive is absent: ' + archive);
  const archiveSha256 = sha256(archive);
  if (archiveSha256 !== upstream.archiveSHA256) {
    throw new Error('archive SHA-256 ' + archiveSha256 + ' does not match desktop/UPSTREAM.json ' + upstream.archiveSHA256);
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'craftmine-upstream-'));
  try {
    extractArchive(path.resolve(archive), temporary);
    const roots = fs.readdirSync(temporary).filter(name => fs.lstatSync(path.join(temporary, name)).isDirectory());
    if (roots.length !== 1) throw new Error('expected one top-level directory in the archive, found ' + roots.length);
    const upstreamRoot = path.join(temporary, roots[0]);
    const upstreamFiles = walkFiles(upstreamRoot);
    const vendorRoot = path.join(REPO_ROOT, upstream.sourceDirectory);
    const vendorFiles = new Map();
    for (const file of trackedFiles(REPO_ROOT, upstream.sourceDirectory)) {
      const absolute = path.join(REPO_ROOT, file);
      if (!fs.existsSync(absolute)) continue;
      vendorFiles.set(rel(vendorRoot, absolute), sha256(absolute));
    }
    const added = [], modified = [], removed = [];
    let unchanged = 0;
    for (const [file, hash] of vendorFiles) {
      if (!upstreamFiles.has(file)) added.push(file);
      else if (upstreamFiles.get(file) !== hash) modified.push(file);
      else unchanged++;
    }
    for (const file of upstreamFiles.keys()) if (!vendorFiles.has(file)) removed.push(file);
    added.sort();
    modified.sort();
    removed.sort();
    const record = {
      format: 'craftmine.upstream-diff/1',
      generatedAt: new Date().toISOString(),
      generatedBy: 'desktop/delivery/licensing/tools/upstream-diff.mjs',
      upstream: {
        repository: upstream.repository,
        commit: upstream.commit,
        archiveURL: upstream.archiveURL,
        archiveBytes: fs.statSync(archive).size,
        archiveSha256,
        archiveSha256Verified: true,
        sourceDirectory: upstream.sourceDirectory
      },
      counts: {
        upstreamFiles: upstreamFiles.size,
        vendoredTrackedFiles: vendorFiles.size,
        unchanged,
        modified: modified.length,
        added: added.length,
        removed: removed.length
      },
      added,
      modified,
      removed,
      limits: [
        'Tracked files only: untracked or build-generated files in the vendored tree are not compared.',
        'Hash equality shows the bytes match the archive; it is not a copyright or authorship determination.',
        'A file listed as added may still be copied from an unrecorded source outside this archive.'
      ]
    };
    fs.mkdirSync(path.dirname(path.join(REPO_ROOT, out)), {recursive: true});
    fs.writeFileSync(path.join(REPO_ROOT, out), JSON.stringify(record, null, 2) + '\n');
    return record;
  } finally {
    fs.rmSync(temporary, {recursive: true, force: true});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = upstreamDiff({archive: option('archive'), out: option('out') ?? DEFAULT_OUT});
    console.log(JSON.stringify(result.counts));
  } catch (error) {
    console.error('upstream-diff failed: ' + error.message);
    process.exit(2);
  }
}
