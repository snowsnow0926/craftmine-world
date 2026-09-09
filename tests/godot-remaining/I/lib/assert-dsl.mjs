// Frozen assertion evaluator for task I (real-model acceptance).
// Pure logic only: no I/O, no model calls, no input simulation.
// An assertion is data; a passing verdict must be reproducible from evidence.
export const ASSERTION_DSL_FORMAT = 'craftmine.i.assertion-dsl/1';
export const ASSERTION_KINDS = Object.freeze(['machine', 'visual', 'human', 'accounting']);
export const SET_OPS = Object.freeze(['every', 'some']);

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(k => deepEqual(a[k], b[k]));
  }
  return false;
}

export function resolvePath(source, path) {
  if (path === undefined || path === null || path === '' || path === '$') return source;
  const normal = String(path).replace(/\[(\d+)\]/g, '.$1').replace(/^\$\.?/, '');
  let value = source;
  for (const key of normal.split('.')) {
    if (key === '') continue;
    if (value === undefined || value === null) return undefined;
    if (Array.isArray(value) && /^\d+$/.test(key)) { value = value[Number(key)]; continue; }
    if (isObject(value) && Object.prototype.hasOwnProperty.call(value, key)) { value = value[key]; continue; }
    return undefined;
  }
  return value;
}

const sizeOf = value => Array.isArray(value) || typeof value === 'string'
  ? value.length
  : isObject(value) ? Object.keys(value).length : undefined;

// Every op receives (actual, expected, context). It returns true or a reason string.
export const OPS = Object.freeze({
  eq: (a, b) => deepEqual(a, b) || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`,
  ne: (a, b) => !deepEqual(a, b) || `expected a value other than ${JSON.stringify(b)}`,
  gt: (a, b) => (finite(a) && a > b) || `expected > ${b}, got ${JSON.stringify(a)}`,
  gte: (a, b) => (finite(a) && a >= b) || `expected >= ${b}, got ${JSON.stringify(a)}`,
  lt: (a, b) => (finite(a) && a < b) || `expected < ${b}, got ${JSON.stringify(a)}`,
  lte: (a, b) => (finite(a) && a <= b) || `expected <= ${b}, got ${JSON.stringify(a)}`,
  closeTo: (a, b, c) => (finite(a) && Math.abs(a - b) <= (finite(c.tolerance) ? c.tolerance : 0.001)) || `expected ${b} +/- ${c.tolerance ?? 0.001}, got ${JSON.stringify(a)}`,
  includes: (a, b) => (Array.isArray(a) ? a.some(v => deepEqual(v, b)) : typeof a === 'string' ? a.includes(String(b)) : false) || `expected ${JSON.stringify(a)} to include ${JSON.stringify(b)}`,
  excludes: (a, b) => !(Array.isArray(a) ? a.some(v => deepEqual(v, b)) : typeof a === 'string' ? a.includes(String(b)) : false) || `expected ${JSON.stringify(a)} to exclude ${JSON.stringify(b)}`,
  matches: (a, b) => (typeof a === 'string' && new RegExp(b).test(a)) || `expected ${JSON.stringify(a)} to match /${b}/`,
  exists: a => (a !== undefined && a !== null) || 'expected a value, got none',
  absent: a => (a === undefined || a === null) || `expected no value, got ${JSON.stringify(a)}`,
  truthy: a => Boolean(a) || `expected truthy, got ${JSON.stringify(a)}`,
  falsy: a => !a || `expected falsy, got ${JSON.stringify(a)}`,
  empty: a => (sizeOf(a) === 0) || `expected empty, got ${JSON.stringify(a)}`,
  notEmpty: a => ((sizeOf(a) ?? 0) > 0) || `expected non-empty, got ${JSON.stringify(a)}`,
  lengthEq: (a, b) => sizeOf(a) === b || `expected length ${b}, got ${sizeOf(a)}`,
  lengthGte: (a, b) => (sizeOf(a) ?? -1) >= b || `expected length >= ${b}, got ${sizeOf(a)}`,
  lengthLte: (a, b) => (sizeOf(a) ?? Number.POSITIVE_INFINITY) <= b || `expected length <= ${b}, got ${sizeOf(a)}`,
  in: (a, b) => (Array.isArray(b) && b.some(v => deepEqual(v, a))) || `expected ${JSON.stringify(a)} to be one of ${JSON.stringify(b)}`,
  notIn: (a, b) => !(Array.isArray(b) && b.some(v => deepEqual(v, a))) || `expected ${JSON.stringify(a)} not to be one of ${JSON.stringify(b)}`,
  equalsPath: (a, b, c) => {
    const reference = resolvePath(c.observation, b);
    if (reference === undefined) return `reference ${b} is missing from the observation`;
    return deepEqual(a, reference) || `expected ${JSON.stringify(a)} to equal ${b} (${JSON.stringify(reference)})`;
  },
  notEqualsPath: (a, b, c) => {
    const reference = resolvePath(c.observation, b);
    if (reference === undefined) return `reference ${b} is missing from the observation`;
    return !deepEqual(a, reference) || `expected ${JSON.stringify(a)} to differ from ${b}`;
  },
  lessThanPath: (a, b, c) => (finite(a) && finite(resolvePath(c.observation, b)) && a < resolvePath(c.observation, b)) || `expected ${JSON.stringify(a)} < ${b} (${JSON.stringify(resolvePath(c.observation, b))})`,
  greaterThanPath: (a, b, c) => (finite(a) && finite(resolvePath(c.observation, b)) && a > resolvePath(c.observation, b)) || `expected ${JSON.stringify(a)} > ${b} (${JSON.stringify(resolvePath(c.observation, b))})`,
  changedFrom: (a, b, c) => {
    const reference = resolvePath(c.observation, b);
    if (reference === undefined) return `reference ${b} is missing from the observation`;
    return !deepEqual(a, reference) || `expected a change from ${b}`;
  },
  unchangedFrom: (a, b, c) => {
    const reference = resolvePath(c.observation, b);
    if (reference === undefined) return `reference ${b} is missing from the observation`;
    return deepEqual(a, reference) || `expected no change from ${b} (${JSON.stringify(reference)})`;
  },
});

export const OP_NAMES = Object.freeze(Object.keys(OPS));

function evaluateSingle(check, observation) {
  const op = check.op;
  if (!OP_NAMES.includes(op)) return { passed: false, reason: `unknown op ${JSON.stringify(op)}`, op };
  const actual = resolvePath(observation, check.path);
  const outcome = OPS[op](actual, check.value, { observation, tolerance: check.tolerance });
  return {
    passed: outcome === true,
    op,
    path: check.path,
    actual,
    expected: check.value,
    reason: outcome === true ? 'ok' : String(outcome),
  };
}

// Evaluate one frozen assertion check against one observation document.
export function evaluateCheck(check, observation = {}) {
  if (!isObject(check)) return { passed: false, reason: 'check must be an object', op: null };
  if (Array.isArray(check.all)) {
    const children = check.all.map(child => evaluateCheck(child, observation));
    const bad = children.find(child => !child.passed);
    return { passed: !bad, op: 'all', children, reason: bad ? bad.reason : 'ok' };
  }
  if (Array.isArray(check.any)) {
    const children = check.any.map(child => evaluateCheck(child, observation));
    const good = children.find(child => child.passed);
    return { passed: Boolean(good), op: 'any', children, reason: good ? 'ok' : `no branch passed: ${children.map(c => c.reason).join(' | ')}` };
  }
  if (Array.isArray(check.none)) {
    const children = check.none.map(child => evaluateCheck(child, observation));
    const bad = children.find(child => child.passed);
    return { passed: !bad, op: 'none', children, reason: bad ? `forbidden branch passed: ${bad.reason}` : 'ok' };
  }
  if (isObject(check.not)) {
    const child = evaluateCheck(check.not, observation);
    return { passed: !child.passed, op: 'not', children: [child], reason: child.passed ? 'forbidden check passed' : 'ok' };
  }
  if (isObject(check.check)) {
    const items = resolvePath(observation, check.path);
    if (!Array.isArray(items)) return { passed: false, op: check.op, path: check.path, reason: `expected an array at ${check.path}` };
    // An empty collection must not satisfy `every`: "nothing was done" is not
    // "everything was done". `some` keeps normal semantics.
    if (check.op !== 'some' && items.length === 0) return { passed: false, op: check.op, path: check.path, reason: `expected a non-empty array at ${check.path}` };
    const results = items.map((item, index) => ({ index, ...evaluateCheck(check.check, item) }));
    const wanted = check.op === 'some' ? results.some(r => r.passed) : results.every(r => r.passed);
    const bad = results.find(r => (check.op === 'some' ? r.passed : !r.passed));
    return {
      passed: wanted,
      op: check.op,
      path: check.path,
      children: results,
      reason: wanted ? 'ok' : check.op === 'some' ? `no element of ${check.path} satisfied ${JSON.stringify(check.check)}` : `element ${bad?.index} failed: ${bad?.reason}`,
    };
  }
  return evaluateSingle(check, observation);
}

// Machine assertions are decided by the DSL. Visual/human/accounting assertions
// cannot pass by machine; they need their own recorded artefact.
export function evaluateAssertion(assertion, observation = {}) {
  const base = { id: assertion.id, round: assertion.round, kind: assertion.kind ?? 'machine', hard: assertion.hard !== false, statement: assertion.statement };
  if (!ASSERTION_KINDS.includes(base.kind)) {
    return { ...base, passed: false, invalid: true, reason: `unknown assertion kind ${JSON.stringify(base.kind)}` };
  }
  if (base.kind !== 'machine') {
    return { ...base, passed: false, notMachineCheckable: true, reason: `${base.kind} evidence is required and cannot be satisfied by the assertion evaluator` };
  }
  const result = evaluateCheck(assertion.check, observation);
  return { ...base, ...result };
}

export function evaluateAssertions(assertions = [], observation = {}) {
  const results = assertions.map(assertion => evaluateAssertion(assertion, observation));
  const hard = results.filter(result => result.hard);
  return {
    results,
    machine: results.filter(result => result.kind === 'machine').length,
    failed: results.filter(result => !result.passed),
    hardFailed: hard.filter(result => !result.passed),
    invalid: results.filter(result => result.invalid),
    pendingEvidence: results.filter(result => result.notMachineCheckable),
    passed: hard.every(result => result.passed) && results.filter(r => !r.hard).every(r => r.passed),
  };
}
