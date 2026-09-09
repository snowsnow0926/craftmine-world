// Format identifiers for the L4 creation-strategy experiment layer.
//
// These records are the only durable output of a strategy comparison. A run
// record is evidence, not a score: the scoring contract itself is frozen by the
// acceptance owner and referenced by hash, never embedded here.
export const STRATEGY_ENTRY_FORMAT = 'craftmine.godot-strategy-entry/1';
export const STRATEGY_TASKSET_FORMAT = 'craftmine.godot-strategy-taskset/1';
export const STRATEGY_RUN_FORMAT = 'craftmine.godot-strategy-run/1';
export const STRATEGY_COMPARE_FORMAT = 'craftmine.godot-strategy-compare/1';
export const STRATEGY_ARM_FORMAT = 'craftmine.godot-strategy-arm/1';

// Evidence classes, ordered from weakest to strongest. A logic-only fixture can
// never be reported as a real-model or engine result.
export const EVIDENCE_CLASSES = Object.freeze(['logic-only', 'fixture', 'engine-headless', 'real-model', 'release-package']);

export const ENTRY_KINDS = Object.freeze(['work', 'experience', 'asset']);

export function need(condition, message) {
  if (!condition) throw new Error(message);
}

export function isPlain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function median(values) {
  const list = (Array.isArray(values) ? values : []).filter(value => Number.isFinite(value)).sort((a, b) => a - b);
  if (!list.length) return null;
  const middle = Math.floor(list.length / 2);
  return list.length % 2 ? list[middle] : Number(((list[middle - 1] + list[middle]) / 2).toFixed(3));
}

export function p95(values) {
  const list = (Array.isArray(values) ? values : []).filter(value => Number.isFinite(value)).sort((a, b) => a - b);
  if (!list.length) return null;
  return list[Math.min(list.length - 1, Math.ceil(0.95 * list.length) - 1)];
}
