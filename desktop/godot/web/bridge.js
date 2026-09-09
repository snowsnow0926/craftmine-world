// Runs only in the separate game origin. It has no desktop or filesystem authority.
//
// Two transports share one message contract:
//   * `craftmine.godot-runtime/2` (production): the host preload or a test
//     page-script adapter exposes `craftmineRuntime` / `__craftmineRuntimeHost`
//     with a fixed instance scope. The page is a top-level document served from
//     the loopback runtime origin, so it can be cross-origin isolated.
//   * `craftmine.godot-preview/1` (fixed preview fixtures): the MessageChannel
//     handshake in desktop/godot/web/host.mjs. Kept for the authored preview
//     checks and not used by the product runtime.
(() => {
  'use strict';
  const previewProtocol = 'craftmine.godot-preview/1';
  const runtimeProtocol = 'craftmine.godot-runtime/2';
  const runtimeOps = ['capabilities', 'load', 'snapshot', 'save', 'pause', 'resume', 'acknowledge', 'cancel', 'exit'];
  const limit = 8 * 1024 * 1024;
  const bytes = value => new TextEncoder().encode(value).byteLength;
  const adapter = globalThis.craftmineRuntime || globalThis.__craftmineRuntimeHost || null;
  let port, scope, callback, engine, started = false, exited = false, quitting, exitRequested = false, detached = false;
  const active = new Set();
  const status = document.getElementById('status');
  const send = message => { if (detached || !port) return; port.postMessage({ ...scope, ...message }); };
  const ready = () => { if (started && callback && !exited && !detached) send({ type: 'ready', ops: runtimeOps }); };
  const error = message => { status.textContent = String(message); status.hidden = false; send({ type: 'runtime-error', error: String(message).slice(0, 2000) }); };
  const finishQuit = () => { if (quitting && active.size === 1 && !exitRequested) { exitRequested = true; engine.requestQuit(); } };
  const reply = (id, result, failure) => {
    if (!active.delete(id)) return;
    send({ type: 'response', id, ...(failure ? { error: failure } : { result }) });
    finishQuit();
  };
  function handle(request) {
    if (detached) return;
    if (request?.protocol !== runtimeProtocol && request?.protocol !== previewProtocol) return;
    if (Object.entries(scope).some(([key, value]) => request[key] !== value)) return;
    if (!Number.isSafeInteger(request.id) || request.id < 1 || active.has(request.id)) return;
    try {
      if (typeof request.op !== 'string' || bytes(JSON.stringify(request)) > limit || active.size >= 16) throw Error('Invalid, oversized or busy runtime request');
    } catch { send({type:'response',id:request.id,error:'Invalid, oversized or busy runtime request'}); return; }
    active.add(request.id);
    if (request.op === 'cancel') {
      const target = request.args?.id;
      if (Number.isSafeInteger(target) && target !== request.id && active.has(target)) reply(target, null, 'Request cancelled');
      reply(request.id, { cancelled: target ?? null });
      return;
    }
    if (!started || !callback || exited || quitting) return reply(request.id, null, 'Runtime is unavailable');
    if (request.op === 'quit' || request.op === 'exit') {
      quitting = request.id;
      finishQuit();
    } else {
      try { callback(JSON.stringify({ id: request.id, worldId: scope.worldId, buildId: scope.buildId, instanceId: scope.instanceId, op: request.op, args: request.args ?? {} })); }
      catch { reply(request.id,null,'Runtime callback rejected the request'); }
    }
  }
  function scopeIsValid(value) {
    return !!value && typeof value === 'object'
      && [value.worldId, value.buildId, value.instanceId].every(item => typeof item === 'string' && item.length > 0 && item.length <= 128);
  }
  if (adapter) {
    // Production transport. The scope is fixed before the engine starts and
    // cannot be renegotiated by a page message.
    if (!scopeIsValid(adapter.scope) || typeof adapter.post !== 'function' || typeof adapter.on !== 'function') {
      error('Runtime adapter is invalid');
      return;
    }
    scope = { protocol: runtimeProtocol, worldId: adapter.scope.worldId, buildId: adapter.scope.buildId, instanceId: adapter.scope.instanceId };
    port = { postMessage: message => { try { adapter.post(message); } catch { detached = true; } } };
    adapter.on(message => handle(message));
    if (adapter.onDetach) adapter.onDetach(() => { detached = true; active.clear(); });
  } else {
    window.addEventListener('message', event => {
      const data = event.data;
      if (port || event.source !== parent || event.origin === location.origin || event.ports.length !== 1 || data?.protocol !== previewProtocol || data.type !== 'connect') return;
      if (![data.session, data.worldId, data.buildId].every(value => typeof value === 'string' && value.length > 0 && value.length <= 128)) return;
      scope = { protocol: previewProtocol, session: data.session, worldId: data.worldId, buildId: data.buildId };
      port = event.ports[0];
      port.onmessage = event => {
        const request = event.data;
        if (request?.protocol !== previewProtocol) return;
        handle(request);
      };
      port.start();
      ready();
    });
  }
  const api = Object.freeze({
    register(value) { if (typeof value !== 'function' || callback) throw Error('Runtime already registered'); callback = value; ready(); },
    complete(value) {
      if (typeof value !== 'string' || bytes(value) > limit) { for (const id of [...active]) reply(id,null,'Invalid or oversized runtime response'); return; }
      let response; try { response = JSON.parse(value); } catch { for (const id of [...active]) reply(id,null,'Invalid runtime response JSON'); return; }
      reply(response.id, response.result, response.error);
    },
    start(value) {
      if (engine) throw Error('Runtime already started');
      engine = value;
      engine.startGame({ canvas: document.getElementById('canvas'), focusCanvas: false, canvasResizePolicy: 2, locale: 'en',
        onPrint: (...args) => console.log(...args),
        onPrintError: (...args) => { console.error(...args); error(args.join(' ')); },
        onExit: code => { exited = true; if (quitting) reply(quitting, { exitCode: code }); send({ type: 'exited', exitCode: code }); },
      }).then(() => { started = true; status.hidden = true; ready(); }).catch(error);
    },
  });
  Object.defineProperty(window, 'CraftmineGame', { value: api, writable: false, configurable: false });
})();
