// Read-only observation envelope and bounded gameplay operations.
//
// Two rules this module exists to enforce:
//   1. An observation is only trustworthy when it names the world, the build,
//      the base version and the sampling time it came from. A bare payload can
//      be from another world or an older build.
//   2. An operation may only drive the game through its ordinary input, physics,
//      inventory and business rules. There is no operation that writes a
//      position, a health value, an ability or a reward directly.
//
// The Godot side owns the same boundary: `runtime_bridge.gd` adds an additive
// `observe-envelope` op and the per-base adapters refuse unknown operations.
// This module is the host-side schema those requests are validated against.

export const OBSERVATION_FORMAT = 'craftmine.godot-observation/1';
export const OPERATION_REQUEST_FORMAT = 'craftmine.godot-operation-request/1';
export const OPERATION_RESULT_FORMAT = 'craftmine.godot-operation-result/1';
export const TARGET_FEEDBACK_OBSERVATION_FORMAT = 'craftmine.target-feedback-observation/1';
export const TARGET_FEEDBACK_OBSERVATION_LIMIT = 256;
const targetFeedbackErrors = ['TARGET_FEEDBACK_SCRIPT_UNAVAILABLE','TARGET_FEEDBACK_TOO_MANY_TARGETS','TARGET_FEEDBACK_INVALID_ID','TARGET_FEEDBACK_DUPLICATE_ID','TARGET_FEEDBACK_INVALID_DURATION'];

/** Optional finite live configuration observation; an honest unavailable result
 * is valid schema, but cannot be used to assert that a target value was seen. */
export function validateTargetFeedbackObservation(value) {
  const issues=[];
  const invalid=()=>issues.push({code:'target-feedback',at:'payload.targetFeedback',message:'invalid bounded target feedback observation'});
  if(!value||typeof value!=='object'||Array.isArray(value)||value.format!==TARGET_FEEDBACK_OBSERVATION_FORMAT||Object.keys(value).some(key=>!['format','targets','error'].includes(key))||!Array.isArray(value.targets)||value.targets.length>TARGET_FEEDBACK_OBSERVATION_LIMIT){invalid();return {ok:false,issues};}
  if('error' in value){if(!targetFeedbackErrors.includes(value.error)||value.targets.length!==0)invalid();return {ok:issues.length===0,issues};}
  const ids=new Set();
  for(const target of value.targets){
    if(!target||typeof target!=='object'||Array.isArray(target)||Object.keys(target).sort().join(',')!=='hitFlashMilliseconds,targetId'||typeof target.targetId!=='string'||target.targetId.match(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)?.[0]!==target.targetId||ids.has(target.targetId)||!Number.isInteger(target.hitFlashMilliseconds)||target.hitFlashMilliseconds<1||target.hitFlashMilliseconds>1000){invalid();continue;}
    ids.add(target.targetId);
  }
  return {ok:issues.length===0,issues};
}

export const OBSERVATION_REQUIRED_FIELDS = Object.freeze([
  'format',
  'worldId',
  'buildId',
  'instanceId',
  'baseId',
  'baseVersion',
  'sampledAt',
  'payload',
]);

/** Operation names that would install state instead of playing the game. */
export const FORBIDDEN_OPERATIONS = Object.freeze([
  'restore',
  'restore-state',
  'set-world-id',
  'set-state',
  'teleport',
  'scene',
  'reset',
  'reset-to-initial',
  'set-position',
  'set-health',
  'set-ability',
  'grant-ability',
  'grant-reward',
  'set-reward',
  'set-coins',
  'set-inventory',
  'set-quest',
]);

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

function argSpec(kind, extra = {}) {
  return { kind, ...extra };
}

/**
 * Bounded operations per base. `readOnly` operations may be called while paused
 * and never mutate progress; `mutating` operations run the real game loop.
 * Argument names and limits match the real adapters
 * (desktop/godot/shared/adapters/*.gd) and the base probe/ops implementations.
 */
export const BOUNDED_OPERATIONS = Object.freeze({
  'creation-sandbox': {
    readOnly: ['snapshot'],
    mutating: {
      walk: {forward:argSpec('number',{min:-1,max:1,optional:true}),right:argSpec('number',{min:-1,max:1,optional:true}),frames:argSpec('integer',{min:1,max:600,optional:true})},
      wait: {frames:argSpec('integer',{min:1,max:600})},
      look: {yaw:argSpec('number',{min:-Math.PI,max:Math.PI,optional:true}),pitch:argSpec('number',{min:-1.55,max:1.55,optional:true})},
      interact: {},
      attack: {},
      'set-time': {hours:argSpec('number',{min:0,max:24})},
    },
  },
  'first-person': {
    readOnly: ['snapshot', 'crosshair', 'hud', 'probe-aim', 'state'],
    mutating: {
      walk: {
        forward: argSpec('number', { min: -1, max: 1, optional: true }),
        right: argSpec('number', { min: -1, max: 1, optional: true }),
        frames: argSpec('integer', { min: 1, max: 600, optional: true }),
      },
      wait: { frames: argSpec('integer', { min: 1, max: 600 }) },
      look: { yaw: argSpec('number', { optional: true }), pitch: argSpec('number', { optional: true }) },
      equip: { value: argSpec('string', { optional: true }), id: argSpec('string', { optional: true }) },
      'next-equipment': {},
      attack: {},
      fire: {},
      reload: {},
      interact: {},
    },
  },
  'top-down': {
    readOnly: ['snapshot'],
    mutating: {
      move: {
        dx: argSpec('number', { min: -1, max: 1, optional: true }),
        dy: argSpec('number', { min: -1, max: 1, optional: true }),
        steps: argSpec('integer', { min: 1, max: 600 }),
      },
      wait: { frames: argSpec('integer', { min: 1, max: 600 }) },
      buy: { shopId: argSpec('string'), itemId: argSpec('string') },
      deliver: { npcId: argSpec('string'), questId: argSpec('string', { optional: true }) },
      talk: { npcId: argSpec('string') },
      gather: { zoneId: argSpec('string') },
      interact: { entityId: argSpec('string') },
      focus: { entityId: argSpec('string') },
    },
  },
  'side-view': {
    readOnly: ['snapshot'],
    mutating: {
      control: { segments: argSpec('control-segments') },
    },
  },
  'mining-sandbox': {
    readOnly: ['snapshot', 'tile', 'inventory', 'hash', 'chunk'],
    mutating: {
      move: {
        dx: argSpec('number', { min: -1, max: 1, optional: true }),
        dy: argSpec('number', { min: -1, max: 1, optional: true }),
        steps: argSpec('integer', { min: 1, max: 600 }),
      },
      wait: { frames: argSpec('integer', { min: 1, max: 600 }) },
      dig: {
        tx: argSpec('integer'),
        ty: argSpec('integer'),
        requestId: argSpec('string', { optional: true }),
      },
      place: {
        tx: argSpec('integer'),
        ty: argSpec('integer'),
        materialId: argSpec('string'),
        requestId: argSpec('string', { optional: true }),
      },
      craft: {
        recipeId: argSpec('string'),
        requestId: argSpec('string', { optional: true }),
        stationId: argSpec('string', { optional: true }),
      },
      cancel: { requestId: argSpec('string') },
    },
  },
});

const MAX_CONTROL_SEGMENTS = 64;
const MAX_CONTROL_TICKS = 600;

function validateArg(name, value, spec, issues) {
  const at = `args.${name}`;
  if (spec.kind === 'number') {
    if (!finite(value)) issues.push({ code: 'arg-not-finite', at, message: `${name} must be a finite number` });
    else if (spec.min !== undefined && value < spec.min) issues.push({ code: 'arg-min', at, message: `${name} must be >= ${spec.min}` });
    else if (spec.max !== undefined && value > spec.max) issues.push({ code: 'arg-max', at, message: `${name} must be <= ${spec.max}` });
    return;
  }
  if (spec.kind === 'integer') {
    if (!Number.isInteger(value)) issues.push({ code: 'arg-not-integer', at, message: `${name} must be an integer` });
    else if (spec.min !== undefined && value < spec.min) issues.push({ code: 'arg-min', at, message: `${name} must be >= ${spec.min}` });
    else if (spec.max !== undefined && value > spec.max) issues.push({ code: 'arg-max', at, message: `${name} must be <= ${spec.max}` });
    return;
  }
  if (spec.kind === 'string') {
    if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
      issues.push({ code: 'arg-string', at, message: `${name} must be a non-empty string of at most 128 characters` });
    }
    return;
  }
  if (spec.kind === 'control-segments') {
    if (!Array.isArray(value)) {
      issues.push({ code: 'arg-segments', at, message: 'segments must be an array' });
      return;
    }
    if (value.length === 0 || value.length > MAX_CONTROL_SEGMENTS) {
      issues.push({ code: 'arg-segments-length', at, message: `segments must contain 1..${MAX_CONTROL_SEGMENTS} entries` });
      return;
    }
    let totalTicks = 0;
    value.forEach((segment, index) => {
      const where = `args.segments[${index}]`;
      if (segment === null || typeof segment !== 'object' || Array.isArray(segment)) {
        issues.push({ code: 'arg-segment', at: where, message: 'segment must be an object' });
        return;
      }
      const allowed = ['ticks', 'move', 'jump', 'attack', 'interact'];
      for (const key of Object.keys(segment)) {
        if (!allowed.includes(key)) issues.push({ code: 'arg-unknown', at: `${where}.${key}`, message: `unknown segment field ${key}` });
      }
      if (!Number.isInteger(segment.ticks) || segment.ticks < 1 || segment.ticks > MAX_CONTROL_TICKS) {
        issues.push({ code: 'arg-ticks', at: `${where}.ticks`, message: `ticks must be an integer 1..${MAX_CONTROL_TICKS}` });
      } else {
        totalTicks += segment.ticks;
      }
      if (segment.move !== undefined && (!finite(segment.move) || segment.move < -1 || segment.move > 1)) {
        issues.push({ code: 'arg-move', at: `${where}.move`, message: 'move must be a finite number in -1..1' });
      }
      for (const button of ['jump', 'attack', 'interact']) {
        if (segment[button] !== undefined && typeof segment[button] !== 'boolean') {
          issues.push({ code: 'arg-button', at: `${where}.${button}`, message: `${button} must be a boolean` });
        }
      }
    });
    if (totalTicks > MAX_CONTROL_TICKS) {
      issues.push({ code: 'arg-total-ticks', at, message: `segments total ${totalTicks} ticks, limit is ${MAX_CONTROL_TICKS}` });
    }
  }
}

/** Validate a bounded operation. Returns { ok, issues, readOnly, mutating }. */
export function validateOperation({ baseId, op, args = {} }) {
  const issues = [];
  const schema = BOUNDED_OPERATIONS[baseId];
  if (!schema) {
    return { ok: false, issues: [{ code: 'unknown-base', at: `base:${baseId}`, message: `no bounded operation schema for base ${baseId}` }] };
  }
  if (typeof op !== 'string' || op.length === 0) {
    return { ok: false, issues: [{ code: 'missing-op', at: 'op', message: 'op is required' }] };
  }
  if (FORBIDDEN_OPERATIONS.includes(op)) {
    return {
      ok: false,
      issues: [{ code: 'forbidden-state-operation', at: 'op', message: `${op} would install state directly and is not an allowed operation` }],
    };
  }
  const readOnly = schema.readOnly.includes(op);
  const spec = schema.mutating[op];
  if (!readOnly && !spec) {
    return {
      ok: false,
      issues: [{ code: 'unknown-operation', at: 'op', message: `${op} is not a bounded operation for ${baseId}` }],
    };
  }
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return { ok: false, issues: [{ code: 'args-not-object', at: 'args', message: 'args must be an object' }] };
  }
  const allowed = spec ? Object.keys(spec) : [];
  for (const key of Object.keys(args)) {
    if (!allowed.includes(key)) issues.push({ code: 'unknown-argument', at: `args.${key}`, message: `unknown argument ${key} for ${op}` });
  }
  if (spec) {
    for (const [name, argSpecValue] of Object.entries(spec)) {
      if (!(name in args)) {
        if (argSpecValue.optional !== true) issues.push({ code: 'missing-argument', at: `args.${name}`, message: `${name} is required for ${op}` });
        continue;
      }
      validateArg(name, args[name], argSpecValue, issues);
    }
  }
  // The real first-person adapter accepts either spelling of the equip target.
  if (baseId === 'first-person' && op === 'equip' && !('value' in args) && !('id' in args)) {
    issues.push({ code: 'missing-argument', at: 'args.value', message: 'equip requires value or id' });
  }
  return { ok: issues.length === 0, issues, readOnly, mutating: !readOnly };
}

/** Build the request the runtime bridge expects. */
export function buildOperationRequest({ id, worldId, buildId, instanceId, baseId, op, args = {} }) {
  const validation = validateOperation({ baseId, op, args });
  if (!validation.ok) {
    const text = validation.issues.map((entry) => `${entry.code} @ ${entry.at}: ${entry.message}`).join('; ');
    throw new Error(`invalid operation: ${text}`);
  }
  return {
    format: OPERATION_REQUEST_FORMAT,
    id,
    worldId,
    buildId,
    instanceId,
    op,
    args,
    readOnly: validation.readOnly,
  };
}

/** Wrap a bridge observation result in the identity/sampling envelope. */
export function createObservationEnvelope({ worldId, buildId, instanceId, baseId, baseVersion, payload, sampledAt = null, protocol = null }) {
  return {
    format: OBSERVATION_FORMAT,
    worldId,
    buildId,
    instanceId,
    baseId,
    baseVersion,
    sampledAt: sampledAt || new Date().toISOString(),
    protocol,
    payload,
  };
}

export function validateObservationEnvelope(envelope, { expect = null } = {}) {
  const issues = [];
  const at = 'observation';
  if (envelope === null || typeof envelope !== 'object') {
    return { ok: false, issues: [{ code: 'not-object', at, message: 'observation must be an object' }] };
  }
  if (envelope.format !== OBSERVATION_FORMAT) {
    issues.push({ code: 'format', at, message: `format must be ${OBSERVATION_FORMAT}` });
  }
  for (const field of OBSERVATION_REQUIRED_FIELDS) {
    if (!(field in envelope)) issues.push({ code: 'missing-field', at, message: `${field} is required` });
  }
  for (const field of ['worldId', 'buildId', 'instanceId', 'baseId', 'baseVersion']) {
    const value = envelope[field];
    if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
      issues.push({ code: 'identity-field', at: field, message: `${field} must be a non-empty string of at most 128 characters` });
    }
  }
  if (typeof envelope.sampledAt !== 'string' || Number.isNaN(Date.parse(envelope.sampledAt))) {
    issues.push({ code: 'sampled-at', at: 'sampledAt', message: 'sampledAt must be an ISO-8601 timestamp' });
  }
  if (!('payload' in envelope) || envelope.payload === null || typeof envelope.payload !== 'object') {
    issues.push({ code: 'payload', at: 'payload', message: 'payload must be an object' });
  }
  if(envelope.payload && Object.hasOwn(envelope.payload,'targetFeedback')){
    if(envelope.baseId!=='first-person')issues.push({code:'target-feedback-base',at:'baseId',message:'target feedback belongs to first-person'});
    issues.push(...validateTargetFeedbackObservation(envelope.payload.targetFeedback).issues);
  }
  if (expect) {
    for (const [key, value] of Object.entries(expect)) {
      if (value !== undefined && envelope[key] !== value) {
        issues.push({ code: 'identity-mismatch', at: key, message: `expected ${key}=${value}, got ${String(envelope[key])}` });
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

/** The observation must not leak a caller-supplied progress body as if it were live state. */
export function observationCarriesProgressBody(envelope) {
  return Boolean(envelope && envelope.payload && typeof envelope.payload === 'object' && 'state' in envelope.payload && envelope.payload.state !== null);
}
