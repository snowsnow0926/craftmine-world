// Product interface transport for task I.
//
// This is a *request* to the owning modules (C executor/verifier, D preview and
// lifecycle, E UI/world creation, L model tools), not an implementation of a
// second world database, model loop or privileged execution path. Until those
// modules expose the contract below, every live round must be recorded as
// 尚未执行 — never as passed, and never by substituting a fixture run.
//
// The transport only reads; it never simulates input and never writes a
// world/project itself. All state changes must come from the product's own
// apply/build/check path.
export const PRODUCT_INTERFACE_FORMAT = 'craftmine.product-acceptance/1';

export class ProductInterfaceUnavailable extends Error {
  constructor(reason, detail = null) {
    super(`product interface unavailable: ${reason}`);
    this.name = 'ProductInterfaceUnavailable';
    this.reason = reason;
    this.detail = detail;
  }
}

export function interfaceConfig(env = process.env) {
  const url = env.CRAFTMINE_I_PRODUCT_INTERFACE ?? null;
  const file = env.CRAFTMINE_I_PRODUCT_INTERFACE_FILE ?? null;
  const token = env.CRAFTMINE_I_PRODUCT_INTERFACE_TOKEN ?? null;
  // The token value is never returned or logged; only its presence.
  return { url, file, tokenPresent: Boolean(token) };
}

export async function probeProductInterface({ env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 3000 } = {}) {
  const config = interfaceConfig(env);
  if (!config.url) {
    return {
      available: false,
      reason: 'product-interface-not-configured',
      detail: 'CRAFTMINE_I_PRODUCT_INTERFACE is not set; no live round can run yet.',
      endpoints: null,
      tokenPresent: config.tokenPresent,
    };
  }
  if (typeof fetchImpl !== 'function') return { available: false, reason: 'fetch-unavailable', detail: 'no fetch implementation', tokenPresent: config.tokenPresent };
  try {
    const response = await fetchImpl(`${config.url.replace(/\/$/, '')}/acceptance/identity`, {
      headers: config.tokenPresent ? { 'X-Craftmine-Acceptance': 'present' } : {},
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { available: false, reason: 'identity-endpoint-failed', detail: `HTTP ${response.status}`, tokenPresent: config.tokenPresent };
    const body = await response.json();
    const problems = [];
    if (body.format !== PRODUCT_INTERFACE_FORMAT) problems.push(`format=${body.format}`);
    if (body.inputPolicy?.inputEventsSent !== 0) problems.push('inputPolicy.inputEventsSent must be 0');
    if (body.inputPolicy?.pointerLockRequests !== 0) problems.push('inputPolicy.pointerLockRequests must be 0');
    if (problems.length) return { available: false, reason: 'contract-mismatch', detail: problems.join(', '), tokenPresent: config.tokenPresent };
    return { available: true, reason: 'ok', identity: body, endpoints: body.endpoints ?? null, tokenPresent: config.tokenPresent };
  } catch (error) {
    return { available: false, reason: 'unreachable', detail: error.message, tokenPresent: config.tokenPresent };
  }
}

// The live transport is intentionally a thin HTTP client over the product's own
// acceptance endpoints. It is not exercised until the interface exists.
export function createProductTransport({ baseUrl, token = null, fetchImpl = globalThis.fetch, timeoutMs = 60000 } = {}) {
  if (!baseUrl) throw new ProductInterfaceUnavailable('product-interface-not-configured');
  const call = async (route, body) => {
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Craftmine-Acceptance': 'present' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`${route} -> HTTP ${response.status}: ${(await response.text()).slice(0, 400)}`);
    return response.json();
  };
  return {
    format: PRODUCT_INTERFACE_FORMAT,
    identity: () => call('/acceptance/identity'),
    openSession: round => call('/acceptance/session', { roundId: round.id, prompt: round.prompt, categoryId: round.categoryId }),
    request: (sessionId, prompt) => call('/acceptance/request', { sessionId, prompt }),
    task: (sessionId, taskId) => call(`/acceptance/task/${taskId}?sessionId=${encodeURIComponent(sessionId)}`),
    apply: (sessionId, taskId) => call('/acceptance/apply', { sessionId, taskId }),
    observe: (sessionId, ops) => call('/acceptance/observe', { sessionId, ops }),
    save: sessionId => call('/acceptance/save', { sessionId }),
    restart: sessionId => call('/acceptance/restart', { sessionId }),
    usage: sessionId => call(`/acceptance/usage?sessionId=${encodeURIComponent(sessionId)}`),
    close: sessionId => call('/acceptance/close', { sessionId }),
  };
}

export const LIVE_COMMAND = 'set CRAFTMINE_I_PRODUCT_INTERFACE=<product acceptance base url> then: node tests/godot-remaining/I/run.mjs --mode live --confirm-live';
