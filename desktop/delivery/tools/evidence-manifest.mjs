#!/usr/bin/env node
// Build a locatable evidence manifest for a delivery report directory.
//
// Round two found that evidence left only in an agent scratch directory cannot be
// checked later. This tool hashes every archived file in place and records, for each
// one, the exact command that produced it and what it does and does not prove. It is
// read-only with respect to the evidence files; it only writes the manifest.
//
// Usage
//   node desktop/delivery/tools/evidence-manifest.mjs --dir <evidence dir> [--provenance <file>]
//
// The provenance sidecar maps a file name to {command, proves, limits, sourceCommit}.
// Files without an entry are still hashed and are marked `unclassified` so a reviewer
// can see the gap instead of assuming everything is documented.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sha256} from '../lib/preflight-core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '..', '..', '..');
const argumentsList = process.argv.slice(2);
const option = name => {
  const index = argumentsList.indexOf('--' + name);
  return index === -1 ? null : argumentsList[index + 1];
};

const directory = option('dir');
if (!directory) {
  console.error('Usage: node desktop/delivery/tools/evidence-manifest.mjs --dir <evidence dir> [--provenance <file>]');
  process.exit(2);
}
const evidenceDirectory = path.resolve(directory);
if (!fs.existsSync(evidenceDirectory) || !fs.statSync(evidenceDirectory).isDirectory()) {
  console.error('Evidence directory is absent: ' + evidenceDirectory);
  process.exit(2);
}
const provenancePath = path.resolve(option('provenance') ?? path.join(evidenceDirectory, 'provenance.json'));
const provenance = fs.existsSync(provenancePath)
  ? JSON.parse(fs.readFileSync(provenancePath, 'utf8').replace(/^\uFEFF/, ''))
  : {format: 'craftmine.evidence-provenance/1', files: {}};

const manifestName = 'evidence-manifest.json';
const files = fs.readdirSync(evidenceDirectory)
  .filter(name => name !== manifestName)
  .sort()
  .map(name => {
    const target = path.join(evidenceDirectory, name);
    const info = fs.lstatSync(target);
    if (info.isSymbolicLink()) return {path: name, status: 'link-denied'};
    if (!info.isFile()) return {path: name, status: 'not-a-file'};
    const entry = provenance.files?.[name] ?? null;
    return {
      path: name,
      status: entry ? 'documented' : 'unclassified',
      bytes: info.size,
      sha256: sha256(target),
      command: entry?.command ?? null,
      proves: entry?.proves ?? null,
      limits: entry?.limits ?? null,
      sourceCommit: entry?.sourceCommit ?? null
    };
  });

const commit = (() => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {cwd: DEFAULT_ROOT, encoding: 'utf8', windowsHide: true}).trim();
  } catch {
    return null;
  }
})();
const manifest = {
  format: 'craftmine.evidence/1',
  generatedAt: new Date().toISOString(),
  directory: evidenceDirectory,
  commit,
  fileCount: files.length,
  documented: files.filter(file => file.status === 'documented').length,
  unclassified: files.filter(file => file.status === 'unclassified').map(file => file.path),
  files,
  limits: [
    'A hash proves which bytes are archived; it does not prove the measurement is representative.',
    'Evidence produced against a package or engine outside this repository is identified by path and hash, not by copying that binary here.',
    'This manifest does not list itself, because it cannot contain its own hash.'
  ]
};
fs.writeFileSync(path.join(evidenceDirectory, manifestName), JSON.stringify(manifest, null, 2) + '\n');
console.log('EVIDENCE ' + path.relative(DEFAULT_ROOT, evidenceDirectory).replaceAll('\\', '/')
  + ' files=' + files.length + ' documented=' + manifest.documented
  + (manifest.unclassified.length ? ' unclassified=' + manifest.unclassified.join(',') : ''));
