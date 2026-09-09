#!/usr/bin/env node
// Freeze / re-freeze the task I acceptance set.
//
// Freezing is deliberate: it records the sha256 of every frozen artefact and of
// the requirement documents it was derived from. Re-freezing is a review action,
// not a way to make a failing assertion pass.
import { writeLock, verifyLock, computeLock, ROOT } from '../lib/frozen.mjs';
import { loadFrozenSpec } from '../lib/frozen.mjs';
import { checkCoverage } from '../lib/coverage.mjs';

const argv = process.argv.slice(2);
const check = argv.includes('--check');

if (check) {
  const verdict = verifyLock(ROOT);
  console.log(JSON.stringify(verdict, null, 2));
  process.exitCode = verdict.ok ? 0 : 1;
} else {
  const before = computeLock(ROOT);
  const { file, lock } = writeLock(ROOT);
  const spec = loadFrozenSpec({ root: ROOT });
  const coverage = checkCoverage(spec);
  console.log(`wrote ${file}`);
  console.log(`frozen files: ${Object.keys(lock.files).length}`);
  console.log(`coverage ok: ${coverage.ok} (${coverage.categories} categories, ${coverage.rounds} rounds, ${coverage.assertions} assertions)`);
  if (!coverage.ok) { console.error(coverage.problems.join('\n')); process.exitCode = 1; }
  const changed = Object.entries(lock.files).filter(([relative, hash]) => before.files[relative] !== hash).map(([relative]) => relative);
  if (changed.length) console.log(`changed since last lock: ${changed.join(', ')}`);
}
