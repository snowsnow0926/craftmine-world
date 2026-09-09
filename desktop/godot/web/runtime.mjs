// Godot Web world runtime host.
//
// Owns one loopback HTTP origin per world runtime instance and the protocol the
// host uses to drive the running game. This is the production transport: the
// older `connectGodotFrame` MessageChannel preview in host.mjs stays for the
// fixed preview fixtures and is not used here.
//
// Why a real HTTP origin instead of the plugin's `file://` page: a
// multi-threaded Godot Web export needs `crossOriginIsolated`, which requires
// COOP/COEP response headers on the top-level document. `file://` documents
// have an opaque origin and cannot carry response headers, so the game page is
// served from its own token-scoped loopback origin. Each instance gets a fresh
// port and a fresh 256-bit path token, so two worlds never share an origin and
// a stale page cannot address another world's build.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {createHash, randomBytes} from 'node:crypto';
import {once} from 'node:events';

export const RUNTIME_PROTOCOL = 'craftmine.godot-runtime/2';
/** Extra vertical space the creation panel reserves above the game surface. */
export const WORLD_CHROME_HEIGHT = 76;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const ID_PATTERN = /^[a-zA-Z0-9._-]{1,128}$/;
const WIRE_LIMIT = 262144;
const MAX_PENDING = 16;
const TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.mjs', 'application/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.pck', 'application/octet-stream'],
  ['.data', 'application/octet-stream'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.ogg', 'audio/ogg'],
  ['.mp3', 'audio/mpeg'],
  ['.txt', 'text/plain; charset=utf-8'],
]);
/** Ops the runtime host itself answers; everything else reaches the base. */
export const RUNTIME_OPS = Object.freeze([
  'capabilities',
  'load',
  'snapshot',
  'save',
  'pause',
  'resume',
  'acknowledge',
  'cancel',
  'exit',
]);

function policyFor(threads) {
  // Mirrors the verified export policy: the engine needs wasm compilation,
  // inline bootstrap, blob workers for the threaded build, and its own assets.
  return [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:",
    `worker-src ${threads ? "'self' blob:" : "'none'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "frame-src 'none'",
    "child-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

export function isolationHeaders({threads = true} = {}) {
  return {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Content-Security-Policy': policyFor(threads),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  };
}

function safeRelative(raw) {
  const decoded = decodeURIComponent(raw);
  if (!decoded || decoded.includes("\0") || decoded.includes("\\")) throw Error("Invalid runtime path");
  const parts = decoded.split("/");
  if (
    parts.some(
      (part) =>
        part === "" ||
        part === "." ||
        part === ".." ||
        part.includes(":") ||
        // Win32 strips trailing dots and spaces when opening a path, so
        // `..%20` would otherwise resolve outside the build root.
        /[. ]$/.test(part),
    )
  ) {
    throw Error("Invalid runtime path");
  }
  return parts;
}

function validateId(name, value) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw Error(`Invalid ${name}`);
  return value;
}

/**
 * Serve one world build from a private loopback origin.
 *
 * Returns a host handle: the caller starts the page (an Electron
 * `WebContentsView`, or a browser page in acceptance tests), then drives it
 * with `request()`.
 */
export async function createWorldRuntime(options) {
  const worldId = validateId('world identity', options.worldId);
  const buildId = validateId('build identity', options.buildId);
  const root = path.resolve(options.root);
  const threads = options.threads !== false;
  const timeoutMs = options.timeoutMs ?? 30000;
  const entry = options.entry ?? 'index.html';
  const token = options.token ?? randomBytes(32).toString('hex');
  if (!TOKEN_PATTERN.test(token)) throw Error('Invalid runtime token');
  const instanceId = options.instanceId ? validateId('instance identity', options.instanceId) : randomBytes(12).toString('hex');
  const scope = Object.freeze({protocol: RUNTIME_PROTOCOL, worldId, buildId, instanceId});
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) throw Error('Invalid runtime timeout');
  const stat = await fsp.stat(root).catch(() => null);
  if (!stat?.isDirectory()) throw Error('World build directory is missing');
  // The entry goes through the same validation as a request path, so a
  // traversal or an empty segment is refused before a server is created.
  const entryParts = safeRelative(entry);
  const entryPath = path.join(root, ...entryParts);
  if (!(await fsp.stat(entryPath).catch(() => null))?.isFile()) throw Error('World build entry is missing');
  const realRoot = await fsp.realpath(root);

  const requests = [];
  const listeners = new Set();
  const pending = new Map();
  let sequence = 0;
  let disposed = false;
  let ready = false;
  let exited = false;
  let state = 'loading';
  let resolveReady, rejectReady;
  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // A host that never awaits `waitReady()` must not produce an unhandled
  // rejection when the runtime fails or is disposed.
  void readyPromise.catch(() => {});
  // A runtime that never reports ready must not hang the host forever.
  const startupTimer = setTimeout(() => fail('Godot runtime did not report ready'), timeoutMs);

  function emit(event) {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // A host listener must not break the runtime.
      }
    }
  }

  function fail(error) {
    if (disposed || ready || exited) return;
    state = 'error';
    clearTimeout(startupTimer);
    rejectReady(Error(error));
  }

  function settle(id, error, result) {
    const item = pending.get(id);
    if (!item) return;
    pending.delete(id);
    clearTimeout(item.timer);
    if (error) item.reject(Error(error));
    else item.resolve(result);
  }

  function accept(message) {
    if (disposed || exited) return;
    if (!message || typeof message !== 'object') return;
    // Late or foreign messages are dropped before any state changes: a reloaded
    // page, a stale instance, or another world can never drive this runtime.
    for (const [key, value] of Object.entries(scope)) {
      if (message[key] !== value) return;
    }
    if (message.type === 'ready') {
      if (ready) return;
      ready = true;
      state = 'ready';
      clearTimeout(startupTimer);
      emit({type: 'ready', ops: Array.isArray(message.ops) ? message.ops.slice(0, 64) : []});
      resolveReady({...scope, ops: message.ops ?? []});
      return;
    }
    if (message.type === 'runtime-error') {
      emit({type: 'runtime-error', error: typeof message.error === 'string' ? message.error.slice(0, 2000) : 'Unknown runtime error'});
      return;
    }
    if (message.type === 'event') {
      emit({type: 'event', name: String(message.name ?? '').slice(0, 64), detail: message.detail ?? null});
      return;
    }
    if (message.type === 'exited') {
      exited = true;
      state = 'exited';
      clearTimeout(startupTimer);
      const code = Number.isInteger(message.exitCode) ? message.exitCode : null;
      for (const id of [...pending.keys()]) settle(id, 'Godot runtime exited');
      emit({type: 'exited', exitCode: code});
      return;
    }
    if (message.type === 'response') settle(message.id, typeof message.error === 'string' ? message.error : null, message);
  }

  /** The page side calls this; the host adapter is injected by preload or a test. */
  function receive(raw) {
    let message;
    try {
      message = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return;
    }
    // Structured clone can carry values JSON cannot (BigInt, cycles); a
    // malformed message must be dropped, never thrown into the IPC handler.
    try {
      if (JSON.stringify(message ?? null).length > WIRE_LIMIT) return;
    } catch {
      return;
    }
    accept(message);
  }

  const server = http.createServer((request, response) => {
    const headers = isolationHeaders({threads});
    const record = {method: request.method, url: request.url, headers: {}, status: 0};
    requests.push(record);
    if (requests.length > 256) requests.shift();
    const send = (status, body, type = 'text/plain; charset=utf-8') => {
      record.status = status;
      response.writeHead(status, {...headers, 'Content-Type': type});
      response.end(body);
    };
    if (disposed) return send(410, 'Runtime disposed');
    if (request.method !== 'GET' && request.method !== 'HEAD') return send(405, 'Method not allowed');
    let pathname;
    try {
      pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    } catch {
      return send(400, 'Invalid request');
    }
    const prefix = `/w/${token}/`;
    if (!pathname.startsWith(prefix)) return send(404, 'Not found');
    let parts;
    try {
      parts = safeRelative(pathname.slice(prefix.length) || entryParts.join('/'));
    } catch {
      return send(400, 'Invalid runtime path');
    }
    const file = path.resolve(root, ...parts);
    const relative = path.relative(root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return send(403, 'Forbidden');
    // A junction or symlink inside the build root must not become a read
    // primitive for the rest of the disk.
    let real;
    try {
      real = fs.realpathSync(file);
    } catch {
      return send(404, 'Not found');
    }
    const realRelative = path.relative(realRoot, real);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) return send(403, 'Forbidden');
    const type = TYPES.get(path.extname(file).toLowerCase());
    if (!type) return send(415, 'Unsupported runtime asset');
    let stream;
    try {
      if (!fs.statSync(file).isFile()) return send(404, 'Not found');
      stream = fs.createReadStream(file);
    } catch {
      return send(404, 'Not found');
    }
    record.status = 200;
    record.headers = {...headers, 'Content-Type': type};
    response.writeHead(200, record.headers);
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  });
  server.keepAliveTimeout = 1000;
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const url = `${origin}/w/${token}/${entryParts.join('/')}`;

  function request(op, args = {}, {timeoutMs: perRequest} = {}) {
    if (disposed) return Promise.reject(Error('Godot runtime is disposed'));
    if (exited) return Promise.reject(Error('Godot runtime has exited'));
    if (!ready) return Promise.reject(Error('Godot runtime is not ready'));
    if (typeof op !== 'string' || !op.length || op.length > 64) return Promise.reject(Error('Invalid runtime operation'));
    if (pending.size >= MAX_PENDING) return Promise.reject(Error('Too many runtime requests'));
    const id = ++sequence;
    const message = {...scope, type: 'request', id, op, args};
    if (JSON.stringify(message).length > WIRE_LIMIT) return Promise.reject(Error('Invalid runtime request'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => settle(id, `Runtime request timed out: ${op}`), perRequest ?? timeoutMs);
      pending.set(id, {resolve, reject, timer});
      try {
        if (!deliver) throw Error('Runtime transport is not attached');
        deliver(message);
      } catch (error) {
        settle(id, `Runtime transport failed: ${error.message}`);
      }
    });
  }

  /** The host transport: an Electron preload, or a test page-script adapter. */
  let deliver = null;
  const runtime = {
    ...scope,
    url,
    origin,
    entry: entryParts.join('/'),
    root,
    threads,
    get state() {
      return state;
    },
    get requests() {
      return requests.map(entry => ({...entry}));
    },
    waitReady() {
      return readyPromise;
    },
    attach(transport) {
      if (deliver) throw Error('Runtime transport is already attached');
      if (typeof transport !== 'function') throw Error('Runtime transport must be a function');
      deliver = transport;
      return () => {
        if (deliver === transport) deliver = null;
      };
    },
    receive,
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    request,
    load(args = {}) {
      return request('load', args);
    },
    snapshot(args = {}) {
      return request('snapshot', args);
    },
    save(args = {}) {
      return request('save', args);
    },
    pause(args = {}) {
      return request('pause', args);
    },
    resume(args = {}) {
      return request('resume', args);
    },
    cancel(id) {
      return request('cancel', {id});
    },
    acknowledge(args = {}) {
      return request('acknowledge', args);
    },
    async exit({timeoutMs: limit} = {}) {
      if (disposed) return {exitCode: null, alreadyStopped: true};
      if (exited) return {exitCode: null, alreadyStopped: true};
      try {
        const result = await request('exit', {}, {timeoutMs: limit ?? 10000});
        return result.result ?? result;
      } catch (error) {
        // A runtime that cannot answer is stopped by the caller closing the page.
        return {exitCode: null, error: error.message};
      }
    },
    async dispose({graceful = true} = {}) {
      if (disposed) return;
      if (graceful) await runtime.exit();
      disposed = true;
      state = 'disposed';
      clearTimeout(startupTimer);
      rejectReady(Error('Godot runtime was disposed'));
      for (const id of [...pending.keys()]) settle(id, 'Godot runtime was disposed');
      deliver = null;
      listeners.clear();
      // A page can hold a keep-alive socket; `server.close()` alone would wait
      // for it and could hang the caller, so terminate remaining connections.
      const closed = new Promise(resolve => server.close(resolve));
      server.closeAllConnections?.();
      await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 2000))]);
    },
    evidence() {
      return {
        protocol: RUNTIME_PROTOCOL,
        ...scope,
        origin,
        url,
        state,
        threads,
        ready,
        exited,
        requests: requests.map(entry => ({...entry})),
        isolation: isolationHeaders({threads}),
        root,
        entry,
      };
    },
  };
  return runtime;
}

/** Stable identity for a build directory, so a rebuild is a new buildId. */
export async function hashBuildDirectory(root) {
  const files = [];
  const walk = async (directory, prefix) => {
    for (const entry of (await fsp.readdir(directory, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative);
      else if (entry.isFile()) files.push({path: relative, sha256: createHash('sha256').update(await fsp.readFile(path.join(directory, entry.name))).digest('hex')});
    }
  };
  await walk(root, '');
  return createHash('sha256').update(JSON.stringify(files)).digest('hex');
}
