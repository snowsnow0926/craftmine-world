// Craftmine measurement core. Dependency-free helpers shared by the CLI and tests.
//
// Isolation contract enforced by the caller and verified by the guard test:
// measurements never synthesize OS input, never activate a window and never use
// a browser input driver. Every suite runs against a separate scratch data
// directory.

export const FORMAT = 'craftmine.measurement/1';

// Deterministic rounding: half away from zero on the scaled integer, applied
// only at serialization time. Raw samples stay unrounded.
export function round(value, decimals = 3) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  const scaled = value * factor;
  return (scaled < 0 ? -Math.round(-scaled) : Math.round(scaled)) / factor;
}

// Nearest-rank percentile. samples are sorted ascending (numeric), p in (0,100].
// rank = ceil(p/100 * n), clamped to [1, n]; result = sorted[rank - 1].
// This is exact, has no interpolation, and is deterministic for any n.
export function nearestRank(sortedSamples, p) {
  if (!Array.isArray(sortedSamples) || sortedSamples.length === 0) return null;
  if (typeof p !== 'number' || !(p > 0) || p > 100) throw Error('percentile must be in (0,100]');
  const rank = Math.ceil((p / 100) * sortedSamples.length);
  const index = Math.min(sortedSamples.length, Math.max(1, rank)) - 1;
  return sortedSamples[index];
}

export function percentile(samples, p) {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  const sorted = [...samples].map(Number).sort((a, b) => a - b);
  return nearestRank(sorted, p);
}

export function summarize(samples) {
  const values = (Array.isArray(samples) ? samples : []).map(Number).filter(Number.isFinite);
  if (values.length === 0) return { count: 0, p50: null, p95: null, min: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: round(nearestRank(sorted, 50)),
    p95: round(nearestRank(sorted, 95)),
    min: round(sorted[0]),
    max: round(sorted[sorted.length - 1]),
  };
}

// Cold/warm rule (deterministic, per measurement process):
// sample index 0 is "cold" because it is the first execution of that command in
// this process and therefore starts with a package/project file cache that this
// process has not warmed; every later sample is "warm". We do not purge the OS
// file cache (that needs elevated privileges and would perturb the machine).
export const COLD_WARM_RULE = 'index 0 = cold (first execution in this process), index >= 1 = warm';
export function coldWarmLabel(index) {
  if (!Number.isInteger(index) || index < 0) throw Error('sample index must be a non-negative integer');
  return index === 0 ? 'cold' : 'warm';
}
export function coldWarmLabels(count) {
  return Array.from({ length: Math.max(0, count) }, (_value, index) => coldWarmLabel(index));
}

export const SAMPLE_SOURCES = Object.freeze({
  'real-engine': 'Pinned Godot 4.7.2 headless process',
  'real-client': 'Packaged Craftmine World client process (offscreen, unfocusable)',
  'real-process': 'Operating-system process counters sampled by PowerShell',
  'real-filesystem': 'Real files on disk measured by the Node process',
  'real-git': 'Real git.exe commands in this repository',
  'synthetic-index': 'In-memory synthetic index built in a scratch directory; NOT product acceptance',
  skipped: 'Not measured',
});

export function classifySource(source) {
  return Object.hasOwn(SAMPLE_SOURCES, source) ? source : 'unknown';
}

export function normalizeThreshold(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return { max: raw, min: null, status: 'frozen' };
  const max = raw.max == null ? null : Number(raw.max);
  const min = raw.min == null ? null : Number(raw.min);
  return {
    max: Number.isFinite(max) ? max : null,
    min: Number.isFinite(min) ? min : null,
    status: typeof raw.status === 'string' ? raw.status : 'frozen',
  };
}

export function verdictFor(samples, threshold) {
  const count = Array.isArray(samples) ? samples.length : 0;
  if (count === 0) return 'unmeasured';
  const normalized = normalizeThreshold(threshold);
  if (!normalized || normalized.status === 'pending-real-sample') return 'unmeasured';
  // A frozen threshold with no bound at all is a configuration error, not a licence
  // to pass: fail closed instead of silently reporting unmeasured.
  if (normalized.max == null && normalized.min == null) return 'fail';
  const values = samples.map(Number).filter(Number.isFinite);
  if (!values.length) return 'unmeasured';
  // Every real sample must be inside the frozen bound, not just p95: a run with a
  // few over-budget frames is a failure, which is what MEASUREMENT.md promises.
  const summary = summarize(values);
  if (normalized.max != null && summary.max > normalized.max) return 'fail';
  if (normalized.min != null && summary.min < normalized.min) return 'fail';
  return 'pass';
}

export function metric({ name, unit, samples, source, process: producer, threshold = null, notes = null }) {
  const values = Array.isArray(samples) ? samples.map(Number).filter(Number.isFinite) : [];
  const summary = summarize(values);
  return {
    name,
    unit,
    samples: values.map(value => round(value)),
    count: summary.count,
    p50: summary.p50,
    p95: summary.p95,
    min: summary.min,
    max: summary.max,
    source: classifySource(source),
    process: producer,
    threshold: normalizeThreshold(threshold),
    verdict: verdictFor(values, threshold),
    notes,
  };
}

export function skippedMetric(name, reason, howToEnable, unit = 'ms') {
  return { metric: name, unit, reason, howToEnable };
}

export function buildRecord({ generatedAt, commit, environment, suites, limits = [] }) {
  return {
    format: FORMAT,
    generatedAt: generatedAt ?? new Date().toISOString(),
    commit: commit ?? null,
    environment: environment ?? {},
    suites: Array.isArray(suites) ? suites : [],
    limits: Array.isArray(limits) ? limits : [],
  };
}

export function thresholdFor(thresholds, name) {
  if (!thresholds || typeof thresholds !== 'object') return null;
  const metrics = thresholds.metrics ?? thresholds;
  return Object.hasOwn(metrics, name) ? metrics[name] : null;
}

/**
 * Frozen metrics that were not actually measured: an unmeasured verdict, a skipped
 * record, or (when requireCoverage is set) a frozen metric the record never reported.
 * A run with any of these is pending, never a pass.
 */
export function pendingFrozenMetrics(record, thresholds, {requireCoverage = false} = {}) {
  const pending = [];
  const seen = new Set();
  for (const suite of record?.suites ?? []) {
    for (const item of suite.metrics ?? []) {
      seen.add(item.name);
      const threshold = thresholdFor(thresholds, item.name);
      if (item.verdict === 'unmeasured' && threshold && threshold.status !== 'pending-real-sample') {
        pending.push({suite: suite.id, metric: item.name, state: 'unmeasured'});
      }
    }
    for (const item of suite.skipped ?? []) {
      seen.add(item.metric);
      const threshold = thresholdFor(thresholds, item.metric);
      if (threshold && threshold.status !== 'pending-real-sample') {
        pending.push({suite: suite.id, metric: item.metric, state: 'skipped'});
      }
    }
  }
  if (requireCoverage) {
    const metrics = thresholds?.metrics ?? thresholds ?? {};
    for (const [name, threshold] of Object.entries(metrics)) {
      if (threshold?.status === 'pending-real-sample') continue;
      if (!seen.has(name)) pending.push({suite: null, metric: name, state: 'not-reported'});
    }
  }
  return pending;
}

export function failingMetrics(record) {
  const failed = [];
  for (const suite of record?.suites ?? []) {
    for (const item of suite.metrics ?? []) {
      if (item.verdict === 'fail') failed.push({ suite: suite.id, metric: item.name, p95: item.p95, threshold: item.threshold });
    }
  }
  return failed;
}

export function unmeasuredMetrics(record) {
  const pending = [];
  for (const suite of record?.suites ?? []) {
    for (const item of suite.metrics ?? []) {
      if (item.verdict === 'unmeasured') pending.push({ suite: suite.id, metric: item.name, count: item.count, threshold: item.threshold });
    }
  }
  return pending;
}

const RECORD_KEYS = ['format', 'generatedAt', 'commit', 'environment', 'suites', 'limits'];
const ENVIRONMENT_KEYS = ['os', 'node', 'cpu', 'logicalCpus', 'totalRamBytes'];
const METRIC_KEYS = ['name', 'unit', 'samples', 'count', 'p50', 'p95', 'min', 'max', 'source', 'process', 'threshold', 'verdict'];
const SKIPPED_KEYS = ['metric', 'unit', 'reason', 'howToEnable'];
const VERDICTS = ['pass', 'fail', 'unmeasured'];

export function validateRecord(record) {
  const errors = [];
  const fail = message => errors.push(message);
  if (!record || typeof record !== 'object') return { ok: false, errors: ['record must be an object'] };
  for (const key of RECORD_KEYS) if (!Object.hasOwn(record, key)) fail(`missing record key: ${key}`);
  if (record.format !== FORMAT) fail(`format must be ${FORMAT}`);
  if (typeof record.generatedAt !== 'string' || Number.isNaN(Date.parse(record.generatedAt))) fail('generatedAt must be an ISO timestamp');
  if (record.commit !== null && typeof record.commit !== 'string') fail('commit must be a string or null');
  if (!record.environment || typeof record.environment !== 'object') fail('environment must be an object');
  else for (const key of ENVIRONMENT_KEYS) if (!Object.hasOwn(record.environment, key)) fail(`missing environment key: ${key}`);
  if (!Array.isArray(record.suites)) fail('suites must be an array');
  else record.suites.forEach((suite, suiteIndex) => {
    if (!suite || typeof suite !== 'object') return fail(`suite[${suiteIndex}] must be an object`);
    if (typeof suite.id !== 'string') fail(`suite[${suiteIndex}].id must be a string`);
    if (!Array.isArray(suite.metrics)) fail(`suite[${suiteIndex}].metrics must be an array`);
    else suite.metrics.forEach((item, metricIndex) => {
      for (const key of METRIC_KEYS) if (!Object.hasOwn(item, key)) fail(`suite[${suiteIndex}].metrics[${metricIndex}] missing ${key}`);
      if (!Array.isArray(item.samples)) fail(`suite[${suiteIndex}].metrics[${metricIndex}].samples must be an array`);
      if (item.count !== (item.samples?.length ?? -1)) fail(`suite[${suiteIndex}].metrics[${metricIndex}].count must equal samples.length`);
      if (!VERDICTS.includes(item.verdict)) fail(`suite[${suiteIndex}].metrics[${metricIndex}].verdict must be one of ${VERDICTS.join('/')}`);
      if (!Object.hasOwn(SAMPLE_SOURCES, item.source)) fail(`suite[${suiteIndex}].metrics[${metricIndex}].source must be a known source`);
    });
    if (!Array.isArray(suite.skipped)) fail(`suite[${suiteIndex}].skipped must be an array`);
    else suite.skipped.forEach((item, skipIndex) => {
      for (const key of SKIPPED_KEYS) if (!Object.hasOwn(item, key)) fail(`suite[${suiteIndex}].skipped[${skipIndex}] missing ${key}`);
    });
  });
  if (!Array.isArray(record.limits)) fail('limits must be an array');
  return { ok: errors.length === 0, errors };
}
