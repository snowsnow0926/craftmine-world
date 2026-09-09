#!/usr/bin/env node
// Freeze / re-freeze the task I acceptance set.
//
// Freezing is deliberate: it records the sha256 of every frozen artefact and of
// the requirement documents it was derived from. Re-freezing is a review action,
// not a way to make a failing assertion pass.
import fs from 'node:fs';
import path from 'node:path';
import { writeLock, verifyLock, computeLock, ROOT } from '../lib/frozen.mjs';
import { loadFrozenSpec } from '../lib/frozen.mjs';
import { checkCoverage } from '../lib/coverage.mjs';

const argv = process.argv.slice(2);
const check = argv.includes('--check');
const acceptChange = argv.includes('--accept-change');

if (check) {
  const verdict = verifyLock(ROOT);
  console.log(JSON.stringify(verdict, null, 2));
  process.exitCode = verdict.ok && verdict.sourcesOk ? 0 : 1;
} else {
  const before = computeLock(ROOT);
  const changed = Object.entries(before.files).filter(([relative, hash]) => {
    if (!fs.existsSync(path.join(ROOT, 'spec', 'FREEZE.lock.json'))) return false;
    const previous = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'FREEZE.lock.json'), 'utf8'));
    return previous.files?.[relative] !== hash;
  }).map(([relative]) => relative);
  if (changed.length && !acceptChange) {
    console.error(`refusing to re-freeze silently; changed frozen artefacts: ${changed.join(', ')}`);
    console.error('re-run with --accept-change "<reason>" once the change is a deliberate review decision.');
    process.exitCode = 1;
  } else {
    const { file, lock } = writeLock(ROOT);
    const spec = loadFrozenSpec({ root: ROOT });
    const coverage = checkCoverage(spec);
    console.log(`wrote ${file}`);
    console.log(`frozen files: ${Object.keys(lock.files).length}`);
    console.log(`coverage ok: ${coverage.ok} (${coverage.categories} categories, ${coverage.rounds} rounds, ${coverage.assertions} assertions)`);
    if (!coverage.ok) { console.error(coverage.problems.join('\n')); process.exitCode = 1; }
    if (changed.length) console.log(`re-frozen after deliberate change: ${changed.join(', ')}`);
  }
}
