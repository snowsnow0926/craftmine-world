// Run identity for task I. Records exactly what produced a result, and nothing
// that could leak a credential. The plan requires every acceptance record to
// carry client/engine/base version, project and resource hashes, model and usage.
import crypto from 'node:crypto';
import { sha256Text } from './frozen.mjs';

export const IDENTITY_FORMAT = 'craftmine.i.identity/1';

const SECRET_KEY = /(api[_-]?key|token|secret|password|authorization|credential|cookie|session[_-]?key)/i;
const SECRET_VALUE = /\b(sk-[A-Za-z0-9_-]{8,}|[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g;

export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = SECRET_KEY.test(key) ? '[redacted]' : redact(item);
    return out;
  }
  return value;
}

export function secretLeaks(text) {
  const leaks = [];
  for (const match of String(text).matchAll(SECRET_VALUE)) leaks.push({ kind: 'credential-shaped-value', excerpt: `${match[0].slice(0, 6)}...` });
  for (const match of String(text).matchAll(/"(api[_-]?key|token|secret|password)"\s*:\s*"([^"]{6,})"/gi)) {
    if (match[2] !== '[redacted]') leaks.push({ kind: 'secret-field', field: match[1] });
  }
  return leaks;
}

// Provider/model identity comes from configuration *names* only. Values that are
// credentials are never read into the identity.
export function modelIdentityFromEnv(env = process.env) {
  return redact({
    provider: env.CRAFTMINE_MODEL_PROVIDER ?? null,
    modelId: env.CRAFTMINE_MODEL ?? null,
    thinking: env.CRAFTMINE_THINKING ?? null,
    reasoningEffort: env.CRAFTMINE_REASONING_EFFORT ?? null,
    maxTokens: env.CRAFTMINE_MAX_TOKENS ?? null,
    contextCap: env.CRAFTMINE_CONTEXT_CAP ?? null,
    harnessSteps: env.CRAFTMINE_HARNESS_STEPS ?? null,
    credentialPresent: Boolean(env.CRAFTMINE_DEEPSEEK_API_KEY || env.DEEPSEEK_API_KEY),
    credentialValue: undefined,
  });
}

export function hashTreeDescriptor(entries = []) {
  const canonical = [...entries].map(entry => `${entry.path}\u0000${entry.sha256 ?? ''}\u0000${entry.bytes ?? ''}`).sort().join('\n');
  return sha256Text(canonical);
}

export function captureIdentity({
  mode,
  product = {},
  engine = {},
  base = {},
  project = {},
  model = {},
  dataDir = null,
  runId = null,
  inputLedger = null,
  startedAt = new Date().toISOString(),
} = {}) {
  const identity = {
    format: IDENTITY_FORMAT,
    runId: runId ?? crypto.randomUUID(),
    mode,
    startedAt,
    product: redact({ version: null, clientVersion: null, commit: null, ...product }),
    engine: redact({ name: 'godot', version: null, binarySha256: null, renderer: null, ...engine }),
    base: redact({ id: null, version: null, commit: null, ...base }),
    project: redact({ path: null, treeHash: null, fileCount: null, ...project }),
    model: redact({ provider: null, modelId: null, thinking: null, reasoningEffort: null, ...model }),
    dataDir,
    input: inputLedger ? redact({ ...inputLedger }) : null,
    artifacts: [],
  };
  identity.digest = identityDigest(identity);
  return identity;
}

export function identityDigest(identity) {
  const { digest, startedAt, runId, dataDir, artifacts, ...rest } = identity;
  return sha256Text(JSON.stringify(rest));
}

// Fields the plan requires before a story may be called 已证实.
export const REQUIRED_IDENTITY_FIELDS = Object.freeze([
  'product.version',
  'engine.version',
  'base.version',
  'project.treeHash',
  'model.provider',
  'model.modelId',
  'input.inputEventsSent',
]);

function read(object, dotted) {
  return dotted.split('.').reduce((value, key) => (value === null || value === undefined ? undefined : value[key]), object);
}

export function missingIdentityFields(identity = {}) {
  return REQUIRED_IDENTITY_FIELDS.filter(field => {
    const value = read(identity, field);
    return value === undefined || value === null || value === '';
  });
}
