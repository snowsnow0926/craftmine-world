#!/usr/bin/env node
// Generates delivery/base-assets.mining-sandbox.json for task K.
//
// The file follows the desktop/delivery/base-assets/<baseId>.json format checked
// by desktop/delivery/lib/preflight-core.mjs: every shipped file under
// sourceDirectory needs an entry with a real byte count and SHA-256, the engine
// version must equal desktop/godot/toolchain.lock.json, and the Godot notices are
// pinned by bytes and hash.
//
// Usage:
//   node desktop/godot/bases/mining-sandbox/delivery/make-base-assets.mjs [--out <file>]
//
// The default output is the dispatch report directory, NOT the base directory:
// the file must not live inside its own sourceDirectory or the release preflight
// would see it as an undeclared file. Copy the result to
// desktop/delivery/base-assets/mining-sandbox.json (task K's directory).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = resolve(HERE, '..');
const REPO = resolve(BASE, '..', '..', '..', '..');
const OUT = process.argv.includes('--out')
  ? resolve(process.argv[process.argv.indexOf('--out') + 1])
  : join(REPO, 'docs', 'dispatch-reports', 'godot-remaining', 'G', 'delivery', 'base-assets.mining-sandbox.json');

const MANIFEST = JSON.parse(readFileSync(join(BASE, 'manifest.json'), 'utf8'));
const LOCK = JSON.parse(readFileSync(join(REPO, 'desktop', 'godot', 'toolchain.lock.json'), 'utf8'));

const OUTSTANDING = 'The project owns this file; formal licence text and per-module application are still pending the review recorded in docs/LICENSING_STRATEGY.md.';

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function walk(root) {
  const result = [];
  const visit = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      if (name === '.godot') continue;
      const full = join(directory, name);
      if (statSync(full).isDirectory()) visit(full);
      else result.push(full);
    }
  };
  visit(root);
  return result;
}

function roleOf(relativePath) {
  if (relativePath === 'project.godot' || relativePath.endsWith('.gitignore') || relativePath === 'manifest.json') return 'config';
  if (relativePath.endsWith('.tscn')) return 'scene';
  if (relativePath.endsWith('.gd')) return 'source';
  if (relativePath.endsWith('.json') || relativePath.endsWith('.json.template')) return 'data';
  if (relativePath.endsWith('.mjs')) return 'tool';
  if (relativePath.endsWith('.svg')) return 'asset';
  if (relativePath.endsWith('.md')) return 'docs';
  return 'data';
}

function distributionOf(relativePath) {
  // Everything a player world or the app bundle actually needs ships; the
  // authoring tools, specs and the delivery manifest itself are development-only.
  if (relativePath.startsWith('tools/') || relativePath.startsWith('docs/')
    || relativePath.startsWith('contracts/') || relativePath.startsWith('delivery/')
    || relativePath.endsWith('.md')) {
    return ['development-only'];
  }
  if (relativePath.startsWith('worlds/') || relativePath.startsWith('templates/')) {
    return ['app-bundle', 'user-export'];
  }
  return ['app-bundle', 'user-export'];
}

const entries = walk(BASE)
  .map((path) => relative(BASE, path).split(sep).join('/'))
  .filter((relativePath) => !relativePath.startsWith('delivery/base-assets.mining-sandbox.json'))
  .map((relativePath) => {
    const full = join(BASE, relativePath);
    return {
      path: relativePath,
      role: roleOf(relativePath),
      origin: 'authored',
      author: 'Craftmine World project',
      version: MANIFEST.baseVersion,
      license: 'project-authored',
      licenseFile: null,
      redistribution: 'permitted',
      distribution: distributionOf(relativePath),
      bytes: statSync(full).size,
      sha256: hashFile(full),
      outstanding: OUTSTANDING,
      notes: '',
    };
  });

const notices = [
  ['desktop/godot/licenses/GODOT_LICENSE.txt', 'Godot 4.7.2-stable licence text for the pinned engine.'],
  ['desktop/godot/licenses/GODOT_COPYRIGHT.txt', 'Godot copyright and third-party notices for the pinned engine.'],
].map(([path, notes]) => {
  const full = join(REPO, path);
  if (!existsSync(full)) throw new Error(`missing notice file: ${path}`);
  return { path, bytes: statSync(full).size, sha256: hashFile(full), appliesTo: ['user-export'], notes };
});

const manifest = {
  format: 'craftmine.base-assets/1',
  baseId: MANIFEST.baseId,
  displayName: '2D side-view mining sandbox base',
  baseVersion: MANIFEST.baseVersion,
  engine: {
    version: LOCK.version,
    renderer: MANIFEST.renderer,
    language: MANIFEST.language,
  },
  sourceDirectory: 'desktop/godot/bases/mining-sandbox',
  reviewedCommit: process.env.CRAFTMINE_REVIEWED_COMMIT || 'e462147852e36bdfcaf897d3f915c5809fb88670',
  reviewedAt: new Date().toISOString().slice(0, 10),
  entries,
  externalEntries: [],
  requiredNotices: notices,
  hashReviewNote: 'Generated by delivery/make-base-assets.mjs from the working tree; every byte count and SHA-256 was computed from the file on disk. Copy this file to desktop/delivery/base-assets/mining-sandbox.json and record the final commit in reviewedCommit.',
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`make-base-assets: ${entries.length} entries -> ${OUT}\n`);
