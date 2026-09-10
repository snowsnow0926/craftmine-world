import http from 'node:http';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
export const MODEL = 'deepseek-v4.1-flash-expires-on-0910';
export const ENDPOINT = 'https://api.deepseek.com/chat/completions';
export const REQUEST_LIMIT = 16;
const CONFIGURATION = 'C:/Users/WINDOWS/Desktop/deepseek.txt';
const sha = text => createHash('sha256').update(text).digest('hex');
export function parseAuthorizedConfiguration(text) {
  const urls = text.match(/https?:\/\/[^\s]+/g) ?? [];
  const models = text.match(/deepseek-[A-Za-z0-9.-]+/g) ?? [];
  const keys = text.match(/sk-[A-Za-z0-9_-]+/g) ?? [];
  if (urls.length !== 1 || !/^https:\/\/api\.deepseek\.com\/?$/.test(urls[0]) || models.length !== 1 || models[0] !== MODEL || keys.length !== 1) throw Error('P8_AUTHORIZED_CONFIGURATION_MISMATCH');
  return { key: keys[0], model: MODEL, endpoint: ENDPOINT };
}
// The fixed authorized file is read only when the first admitted request runs.
export const readAuthorizedConfiguration = async () => parseAuthorizedConfiguration(await readFile(CONFIGURATION, 'utf8'));
export function createSecretRedactor(secrets) {
  const values = secrets.filter(Boolean); const retain = Math.max(0, ...values.map(s => s.length)) - 1;
  let tail = '';
  const clean = value => { for (const secret of values) value = value.replaceAll(secret, '[REDACTED]'); return value; };
  return { push(value, final = false) {
    tail += value;
    if (final) { const result = clean(tail); tail = ''; return result; }
    // Do not split a possible match at the emission boundary.
    let end = Math.max(0, tail.length - Math.max(0, retain));
    for (const secret of values) { const start = tail.lastIndexOf(secret, end); if (start >= 0 && start < end && start + secret.length > end) end = start; }
    const result = clean(tail.slice(0, end)); tail = tail.slice(end); return result;
  } };
}
export function observeSse(text) {
  const evidence = { models: [], usageReports: [], finishReasons: [] };
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:') || line.slice(5).trim() === '[DONE]') continue;
    try { const value = JSON.parse(line.slice(5).trim());
      if (typeof value.model === 'string' && !evidence.models.includes(value.model)) evidence.models.push(value.model);
      if (value.usage && typeof value.usage === 'object') evidence.usageReports.push(value.usage);
      for (const choice of value.choices ?? []) if (choice.finish_reason) evidence.finishReasons.push(choice.finish_reason);
    } catch { /* Non-JSON SSE data is retained in the raw bounded response. */ }
  }
  return evidence;
}
export async function createP8Relay({ persist, initialAttempts = [], configuration = readAuthorizedConfiguration, forward = (url, options) => fetch(url, options), requestLimit = REQUEST_LIMIT }) {
  if (requestLimit !== null && requestLimit !== REQUEST_LIMIT) throw Error('P8_INVALID_REQUEST_LIMIT');
  if (typeof persist !== 'function') throw Error('P8_EVIDENCE_WRITER_REQUIRED');
  if (!Array.isArray(initialAttempts) || requestLimit !== null && initialAttempts.length > requestLimit || initialAttempts.some((value, index) => value.id !== index + 1 || value.endpoint !== ENDPOINT || value.requestedModel !== MODEL)) throw Error('P8_INVALID_REQUEST_JOURNAL');
  const route = `/${randomBytes(24).toString('hex')}/deepseek.com/v1/chat/completions`;
  const auth = randomBytes(32).toString('hex');
  const attempts = structuredClone(initialAttempts), rejected = []; const controllers = new Set(), inflight = new Set(); let closing = false, credentials;
  const same = value => { const actual = Buffer.from(value ?? ''); const expected = Buffer.from(`Bearer ${auth}`); return actual.length === expected.length && timingSafeEqual(actual, expected); };
  const refuse = (response, code, status = 400) => { rejected.push({ code, at: Date.now() }); if (rejected.length > 64) rejected.shift(); response.writeHead(status, { 'content-type': 'application/json', 'connection': 'close' }); response.end(JSON.stringify({ error: { message: code, type: 'p8_acceptance_boundary' } })); };
  const server = http.createServer((request, response) => { const task = (async () => {
    if (closing) return refuse(response, 'P8_RELAY_CLOSING', 503);
    if (request.method !== 'POST' || request.url !== route || !same(request.headers.authorization) || !/^127\.0\.0\.1:\d+$/.test(request.headers.host ?? '')) return refuse(response, 'P8_ROUTE_REJECTED', 403);
    if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? '')) return refuse(response, 'P8_JSON_REQUIRED');
    const chunks = []; let bytes = 0;
    for await (const chunk of request) { bytes += chunk.length; if (bytes > 8 * 1024 * 1024) return refuse(response, 'P8_REQUEST_TOO_LARGE', 413); chunks.push(chunk); }
    const rawRequest = Buffer.concat(chunks), payload = rawRequest.toString('utf8');
    let body; try { if (!Buffer.from(payload).equals(rawRequest)) throw Error('invalid UTF-8'); body = JSON.parse(payload); } catch { return refuse(response, 'P8_INVALID_JSON'); }
    if (!body || Array.isArray(body) || body.model !== MODEL || body.stream !== true || !Array.isArray(body.messages) || !Number.isSafeInteger(body.max_tokens) || body.max_tokens < 1 || body.max_tokens > 16384) return refuse(response, 'P8_EXACT_MODEL_STREAM_REQUIRED');
    // Synchronous slot claim occurs before awaits: concurrent SDK retries cannot
    // cross a configured cap. Unlimited authorization still journals every attempt.
    if (requestLimit !== null && attempts.length >= requestLimit) return refuse(response, 'P8_REQUEST_LIMIT', 429);
    const attempt = { id: attempts.length + 1, admittedAtMs: Date.now(), endpoint: ENDPOINT, requestedModel: MODEL, dispatched: false, passedTransport: false };
    attempts.push(attempt);
    const controller = new AbortController(); controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(Error('P8_UPSTREAM_TIMEOUT')), 125_000);
    response.on('close', () => { if (!response.writableEnded) controller.abort(Error('P8_CLIENT_DISCONNECTED')); });
    let key = '';
    try {
      credentials ??= await configuration();
      if (credentials.model !== MODEL || credentials.endpoint !== ENDPOINT || !/^sk-[A-Za-z0-9_-]+$/.test(credentials.key)) throw Error('P8_AUTHORIZED_CONFIGURATION_MISMATCH');
      key = credentials.key;
      attempt.requestSha256 = sha(payload); attempt.requestBytes = Buffer.byteLength(payload);
      await persist({ kind: 'request', attempt: { ...attempt }, body: JSON.parse(payload.replaceAll(key, '[REDACTED]')), rawBody: payload.replaceAll(key, '[REDACTED]') });
      attempt.dispatched = true; attempt.startedAtMs = Date.now();
      const upstream = await forward(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', 'authorization': `Bearer ${key}` }, body: payload, signal: controller.signal, redirect: 'error' });
      attempt.status = upstream.status; attempt.headersAtMs = Date.now();
      const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
      response.writeHead(upstream.status, { 'content-type': contentType, 'cache-control': 'no-store' });
      const redactor = createSecretRedactor([key]); const decoder = new TextDecoder(); let raw = '', size = 0, lines = '';
      for await (const chunk of upstream.body ?? []) {
        size += chunk.length; if (size > 8 * 1024 * 1024) throw Error('P8_RESPONSE_TOO_LARGE');
        const text = decoder.decode(chunk, { stream: true });
        lines += text;
        while (lines.includes('\n')) {
          const end = lines.indexOf('\n'), line = lines.slice(0, end); lines = lines.slice(end + 1);
          if (attempt.firstDeltaAtMs !== undefined || !line.startsWith('data:')) continue;
          try { const event = JSON.parse(line.slice(5)); if (event.choices?.some(choice => {
            const delta = choice.delta; return delta && (typeof delta.content === 'string' && delta.content.length > 0 || typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0 || delta.tool_calls?.some(call => call.id || call.function?.name || call.function?.arguments));
          })) attempt.firstDeltaAtMs = Date.now(); } catch { /* Raw data is retained. */ }
        }
        const safe = redactor.push(text); raw += safe; response.write(safe);
      }
      const tail = redactor.push(decoder.decode(), true); raw += tail; response.end(tail);
      attempt.endedAtMs = Date.now(); attempt.responseBytes = Buffer.byteLength(raw); attempt.responseSha256 = sha(raw); attempt.sse = observeSse(raw); attempt.passedTransport = upstream.ok;
      await persist({ kind: 'response', attempt: { ...attempt }, body: raw });
    } catch (error) {
      attempt.endedAtMs = Date.now(); attempt.error = String(error instanceof Error ? error.message : 'P8_RELAY_FAILED').replaceAll(key || '\u0000', '[REDACTED]').slice(0, 2000);
      if (!response.headersSent) { response.writeHead(502, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: { message: attempt.error } })); } else response.destroy();
      try { await persist({ kind: 'failure', attempt: { ...attempt } }); } catch { attempt.evidenceWriteFailed = true; }
    } finally { clearTimeout(timeout); controllers.delete(controller); }
  })().catch(() => { if (!response.headersSent) refuse(response, 'P8_REQUEST_FAILED', 500); else response.destroy(); }); inflight.add(task); void task.then(() => inflight.delete(task), () => inflight.delete(task)); });
  server.maxConnections = 4; server.requestTimeout = 130000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  return { baseUrl: `http://127.0.0.1:${address.port}${route.slice(0, -'/chat/completions'.length)}`, auth,
    snapshot: () => structuredClone({ limit: requestLimit, attempts, rejected }),
    async close() { closing = true; for (const controller of controllers) controller.abort(Error('P8_RELAY_CLOSING')); server.closeAllConnections(); let timer;
      try { await Promise.race([Promise.all([new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())), Promise.allSettled([...inflight])]), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('P8_RELAY_CLOSE_TIMEOUT')), 5000); })]); }
      finally { clearTimeout(timer); }
    } };
}
