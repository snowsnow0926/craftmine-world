// Frozen-spec loader and integrity gate for task I.
// The acceptance set, assertions, scoring, failure taxonomy and ledgers are frozen:
// this module refuses to hand them out if any byte changed after freezing.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const FREEZE_FORMAT = 'craftmine.i.freeze-lock/1';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Frozen artefacts. Order is stable so the lock file diffs cleanly.
export const FROZEN_FILES = Object.freeze([
  'spec/acceptance-set.frozen.json',
  'spec/assertions.frozen.json',
  'spec/scoring.frozen.json',
  'spec/failure-classes.frozen.json',
  'spec/ledger.a01-a17.frozen.json',
  'spec/ledger.v01-v16.frozen.json',
  'spec/ledger.al-a01-a17.frozen.json',
  'spec/product-interface-contract.frozen.json',
]);

export const SOURCE_ROOT_ENV = 'CRAFTMINE_I_SOURCE_ROOT';

// Requirement sources the frozen set was derived from. The newest copies live in
// the main tree as uncommitted files, so the provenance root is configurable and
// recorded in the lock; it is never copied or committed by task I.
export const SOURCE_DOCS = Object.freeze([
  'docs/GODOT_MULTIBASE_DEVELOPMENT_PLAN.md',
  'docs/VERSION_MANAGEMENT_DEVELOPMENT_PLAN.md',
  'docs/ASSET_LIBRARY_DEVELOPMENT_PLAN.md',
  'docs/dispatch-prompts/godot-remaining-20260910/I-real-model-acceptance.md',
  'docs/dispatch-prompts/godot-remaining-20260910/README.md',
  'desktop/godot/bases/first-person/docs/MODEL_ACCEPTANCE_TASKS.md',
]);

export function sourceRoot(root = ROOT, env = process.env) {
  return env[SOURCE_ROOT_ENV] ? path.resolve(env[SOURCE_ROOT_ENV]) : path.resolve(root, '..', '..', '..');
}

export function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function sha256Text(text) {
  return sha256Buffer(Buffer.from(text, 'utf8'));
}

export function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function frozenPath(relative, root = ROOT) {
  return path.join(root, relative);
}

export function computeLock(root = ROOT, { env = process.env, docsRoot = null } = {}) {
  const files = {};
  for (const relative of FROZEN_FILES) {
    const file = frozenPath(relative, root);
    files[relative] = fs.existsSync(file) ? sha256File(file) : null;
  }
  const rootDir = docsRoot ?? sourceRoot(root, env);
  const sources = {};
  for (const relative of SOURCE_DOCS) {
    const file = path.join(rootDir, relative);
    sources[relative] = fs.existsSync(file) ? { sha256: sha256File(file), bytes: fs.statSync(file).size } : null;
  }
  return { format: FREEZE_FORMAT, frozenAt: null, sourceRoot: rootDir, sourceRootAvailable: fs.existsSync(rootDir), files, sources };
}

export function writeLock(root = ROOT, { frozenAt = new Date().toISOString(), env = process.env } = {}) {
  const lock = computeLock(root, { env });
  lock.frozenAt = frozenAt;
  const file = path.join(root, 'spec', 'FREEZE.lock.json');
  fs.writeFileSync(file, `${JSON.stringify(lock, null, 2)}\n`);
  return { file, lock };
}

// Returns a precise, machine-readable verdict. Never throws for a mismatch;
// callers decide whether a mismatch is fatal.
export function verifyLock(root = ROOT, env = process.env) {
  const file = path.join(root, 'spec', 'FREEZE.lock.json');
  if (!fs.existsSync(file)) return { ok: false, reason: 'FREEZE.lock.json is missing', mismatched: [], missing: FROZEN_FILES.slice(), changedSources: [], missingSources: [], sourceRoot: null, sourceRootAvailable: false };
  const lock = readJson(file);
  // Verify provenance against the root recorded at freeze time unless overridden.
  const current = computeLock(root, { env, docsRoot: env[SOURCE_ROOT_ENV] ? null : (lock.sourceRoot ?? null) });
  const mismatched = [];
  const missing = [];
  for (const relative of FROZEN_FILES) {
    if (current.files[relative] === null) { missing.push(relative); continue; }
    if (current.files[relative] !== lock.files?.[relative]) mismatched.push({ file: relative, locked: lock.files?.[relative] ?? null, current: current.files[relative] });
  }
  const changedSources = [];
  const missingSources = [];
  for (const relative of SOURCE_DOCS) {
    const locked = lock.sources?.[relative]?.sha256 ?? null;
    const now = current.sources[relative]?.sha256 ?? null;
    if (!locked || !now) { missingSources.push(relative); continue; }
    if (locked !== now) changedSources.push({ file: relative, locked, current: now });
  }
  const unknown = Object.keys(lock.files ?? {}).filter(relative => !FROZEN_FILES.includes(relative));
  return {
    ok: missing.length === 0 && mismatched.length === 0,
    reason: missing.length || mismatched.length ? 'frozen artefacts changed after freezing' : 'ok',
    lockedAt: lock.frozenAt ?? null,
    sourceRoot: lock.sourceRoot ?? current.sourceRoot,
    sourceRootAvailable: current.sourceRootAvailable,
    mismatched,
    missing,
    unknownLockEntries: unknown,
    changedSources,
    missingSources,
  };
}

export class FrozenSpecError extends Error {
  constructor(verdict) {
    super(`frozen acceptance set integrity failed: ${verdict.missing.length} missing, ${verdict.mismatched.length} changed (${[...verdict.missing, ...verdict.mismatched.map(m => m.file)].join(', ')})`);
    this.name = 'FrozenSpecError';
    this.verdict = verdict;
  }
}

// Load every frozen artefact, refusing to continue if the lock does not match.
// `allowSourceDrift` only downgrades changed requirement docs to a warning, it
// never permits a changed frozen assertion/scoring file.
export function loadFrozenSpec({ root = ROOT, requireLock = true, allowSourceDrift = true } = {}) {
  const verdict = verifyLock(root);
  if (requireLock && !verdict.ok) throw new FrozenSpecError(verdict);
  if (!allowSourceDrift && verdict.changedSources.length) throw new FrozenSpecError({ ...verdict, ok: false });
  const set = readJson(frozenPath('spec/acceptance-set.frozen.json', root));
  const assertions = readJson(frozenPath('spec/assertions.frozen.json', root));
  const scoring = readJson(frozenPath('spec/scoring.frozen.json', root));
  const failures = readJson(frozenPath('spec/failure-classes.frozen.json', root));
  const ledgers = {
    godot: readJson(frozenPath('spec/ledger.a01-a17.frozen.json', root)),
    version: readJson(frozenPath('spec/ledger.v01-v16.frozen.json', root)),
    assets: readJson(frozenPath('spec/ledger.al-a01-a17.frozen.json', root)),
  };
  const productInterface = readJson(frozenPath('spec/product-interface-contract.frozen.json', root));
  return { root, verdict, set, assertions, scoring, failures, ledgers, productInterface };
}

export function indexAssertions(catalog) {
  const byId = new Map();
  for (const assertion of catalog.assertions) {
    if (byId.has(assertion.id)) throw new Error(`duplicate assertion id ${assertion.id}`);
    byId.set(assertion.id, assertion);
  }
  return byId;
}

export function roundsOf(set) {
  return set.categories.flatMap(category => category.rounds.map(round => ({ ...round, categoryId: category.id, categoryTitle: category.title, stories: category.stories })));
}
