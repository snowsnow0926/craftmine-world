// Format identifiers for the controlled L3 part-extension layer.
//
// Every format string here is part of a contract: a part package, an installed
// package record, a lifecycle journal entry or a compatibility report is only
// valid when it carries the exact string below. Bump the trailing number, never
// mutate the meaning of an existing one.
//
// This module is engine independent. It validates and moves metadata; it never
// runs game code and never talks to Godot by itself.
export const PART_MANIFEST_FORMAT = 'craftmine.godot-part-manifest/1';
export const PART_INSTALLED_FORMAT = 'craftmine.godot-part-installed/1';
export const PART_COMPAT_FORMAT = 'craftmine.godot-part-compat/1';
export const PART_STORE_FORMAT = 'craftmine.godot-part-store/1';
export const PART_JOURNAL_FORMAT = 'craftmine.godot-part-journal/1';
export const PART_BUDGET_FORMAT = 'craftmine.godot-part-budget/1';
export const PART_SELFTEST_FORMAT = 'craftmine.godot-part-selftest/1';
export const CONTENT_REF_FORMAT = 'craftmine.godot-content-ref/1';

// Host part ABI. A part may only be installed when its apiVersion equals this
// value: the host owns the interface, a part never widens it.
export const HOST_PART_API_VERSION = 1;

// Part kinds the host knows how to load. Adding a kind is host work, not a
// decision a part package can make for itself.
//
// renderPass / hudWidget / postProcess mirror the kinds already used by the
// legacy runtime (app/harness/parts.mjs) so the two paths stay conceptually
// aligned. perfComponent covers non-visual performance work such as batching
// or streaming helpers.
export const PART_KINDS = Object.freeze(['renderPass', 'hudWidget', 'postProcess', 'perfComponent']);

// Kind -> entry symbol and the interface the host calls.
export const PART_INTERFACES = Object.freeze({
  renderPass: { entry: 'run', interface: 'run(ctx: Dictionary) -> void', budgetMsPerFrame: 1 },
  hudWidget: { entry: 'render', interface: 'render(ctx: Dictionary) -> Variant', budgetMsPerFrame: 1 },
  postProcess: { entry: 'apply', interface: 'apply(frame: Dictionary) -> Dictionary', budgetMsPerFrame: 2 },
  perfComponent: { entry: 'step', interface: 'step(ctx: Dictionary) -> Dictionary', budgetMsPerFrame: 4 },
});

// Kinds whose implementation must ship native code (GDExtension / engine work).
// Those packages are refused unless a separate B/C/K validation record exists.
export const NATIVE_REQUIRED_EXTENSIONS = Object.freeze(['.gdextension', '.dll', '.so', '.dylib']);

export const BUILTIN_PART_ID = 'default';

// Deliberately conservative id/path grammars: lowercase, no separators that
// could escape a directory, no absolute paths, no traversal.
export const PART_ID_PATTERN = /^[a-z][a-z0-9-]{0,47}$/;
export const SAFE_RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._\-\/]{1,160}$/;
export const SHA256_PATTERN = /^[a-f0-9]{64}$/;
export const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function need(condition, message) {
  if (!condition) throw new Error(message);
}

export function isPlain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseSemver(text) {
  const match = SEMVER_PATTERN.exec(String(text ?? ''));
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function compareSemver(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  need(a, `版本号无效：${left}`);
  need(b, `版本号无效：${right}`);
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  return 0;
}

// Supports the subset we actually use: exact ("1.0.0"), comparators
// (">=1.0.0 <2.0.0", ">1.0.0", "<=1.2.3") and "*" for "any version".
export function satisfiesSemver(version, range) {
  const text = String(range ?? '').trim();
  if (!text) return false;
  if (text === '*') return parseSemver(version) !== null;
  const actual = parseSemver(version);
  if (!actual) return false;
  const parts = text.split(/\s+/).filter(Boolean);
  return parts.every(part => {
    const match = /^(>=|<=|>|<|=)?(\d+\.\d+\.\d+)$/.exec(part);
    if (!match) return false;
    const op = match[1] || '=';
    const cmp = compareSemver(version, match[2]);
    if (op === '>=') return cmp >= 0;
    if (op === '<=') return cmp <= 0;
    if (op === '>') return cmp > 0;
    if (op === '<') return cmp < 0;
    return cmp === 0;
  });
}
