#!/usr/bin/env node
// Verifies that every committed world under worlds/ is exactly what the current
// templates, core runtime and parameters produce. Run it after touching core/,
// params/ or templates/; a stale world is a real defect because the world is
// what a player (and the acceptance harness) actually opens.
//
// Usage:
//   node tools/check-sync.mjs

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE_DIR = resolve(HERE, '..');
const MANIFEST = JSON.parse(readFileSync(join(BASE_DIR, 'manifest.json'), 'utf8'));
const TEMPLATE_OF_WORLD = { blank: 'blank', 'mine-camp': 'mine-camp' };

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function listFiles(root) {
  const result = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory).sort()) {
      const full = join(directory, entry);
      if (statSync(full).isDirectory()) walk(full);
      else result.push(full);
    }
  };
  walk(root);
  return result;
}

const failures = [];

for (const [worldName, worldInfo] of Object.entries(MANIFEST.worlds)) {
  const worldDir = join(BASE_DIR, worldInfo.directory);
  if (!existsSync(worldDir)) {
    failures.push(`missing committed world: ${worldInfo.directory}`);
    continue;
  }
  const world = JSON.parse(readFileSync(join(worldDir, 'world.json'), 'utf8'));
  const template = TEMPLATE_OF_WORLD[worldName] || worldName;
  const temp = mkdtempSync(join(tmpdir(), `ms-sync-${worldName}-`));
  const regenerated = join(temp, 'world');
  try {
    execFileSync(process.execPath, [
      join(HERE, 'new-world.mjs'),
      '--template', template,
      '--world-id', world.worldId,
      '--name', world.displayName,
      '--out', regenerated,
    ], { stdio: 'pipe' });
    const committedFiles = listFiles(worldDir).map((path) => relative(worldDir, path).split(sep).join('/'));
    const generatedFiles = listFiles(regenerated).map((path) => relative(regenerated, path).split(sep).join('/'));
    const onlyCommitted = committedFiles.filter((path) => !generatedFiles.includes(path));
    const onlyGenerated = generatedFiles.filter((path) => !committedFiles.includes(path));
    for (const path of onlyCommitted) failures.push(`${worldInfo.directory}: committed-only file ${path}`);
    for (const path of onlyGenerated) failures.push(`${worldInfo.directory}: generated-only file ${path}`);
    for (const path of committedFiles.filter((entry) => generatedFiles.includes(entry))) {
      const a = hashFile(join(worldDir, path));
      const b = hashFile(join(regenerated, path));
      if (a !== b) failures.push(`${worldInfo.directory}: ${path} differs from the template output`);
    }
    // The receipt must describe the files that are actually on disk.
    const receipt = JSON.parse(readFileSync(join(worldDir, 'world-build.json'), 'utf8'));
    const listed = new Map((receipt.files || []).map((entry) => [entry.path, entry]));
    for (const path of committedFiles.filter((entry) => entry !== 'world-build.json')) {
      const entry = listed.get(path);
      if (!entry) {
        failures.push(`${worldInfo.directory}: world-build.json does not list ${path}`);
        continue;
      }
      const actualBytes = statSync(join(worldDir, path)).size;
      const actualHash = hashFile(join(worldDir, path));
      if (entry.bytes !== actualBytes) failures.push(`${worldInfo.directory}: ${path} bytes ${entry.bytes} != ${actualBytes}`);
      if (entry.sha256 !== actualHash) failures.push(`${worldInfo.directory}: ${path} sha256 mismatch`);
    }
    if ((receipt.files || []).length !== committedFiles.length - 1) {
      failures.push(`${worldInfo.directory}: world-build.json lists ${(receipt.files || []).length} files but ${committedFiles.length - 1} exist`);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`check-sync: ${failure}\n`);
  process.exit(1);
}
process.stdout.write(`check-sync: ${Object.keys(MANIFEST.worlds).length} committed worlds match their templates\n`);
