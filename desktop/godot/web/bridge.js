// Runs only in the separate game origin. It has no desktop or filesystem authority.
(() => {
  'use strict';
  const protocol = 'craftmine.godot-preview/1';
  const limit = 65536;
  let port, scope, callback, engine, started = false, exited = false, quitting, exitRequested = false;
  const active = new Set();
  const status = document.getElementById('status');
  const send = message => port?.postMessage({ ...scope, protocol, ...message });
  const ready = () => { if (started && callback && !exited) send({ type: 'ready' }); };
  const error = message => { status.textContent = String(message); status.hidden = false; send({ type: 'runtime-error', error: String(message).slice(0, 2000) }); };
  const finishQuit = () => { if (quitting && active.size === 1 && !exitRequested) { exitRequested = true; engine.requestQuit(); } };
  const reply = (id, result, failure) => {
    if (!active.delete(id)) return;
    send({ type: 'response', id, ...(failure ? { error: failure } : { result }) });
    finishQuit();
  };
  window.addEventListener('message', event => {
    const data = event.data;
    if (port || event.source !== parent || event.origin === location.origin || event.ports.length !== 1 || data?.protocol !== protocol || data.type !== 'connect') return;
    if (![data.session, data.worldId, data.buildId].every(value => typeof value === 'string' && value.length > 0 && value.length <= 128)) return;
    scope = { session: data.session, worldId: data.worldId, buildId: data.buildId };
    port = event.ports[0];
    port.onmessage = event => {
      const request = event.data;
      if (request?.protocol !== protocol || Object.entries(scope).some(([key, value]) => request[key] !== value)) return;
      if (!Number.isSafeInteger(request.id) || request.id < 1 || active.has(request.id)) return;
      if (typeof request.op !== 'string' || JSON.stringify(request).length > limit || active.size >= 16) return;
      active.add(request.id);
      if (!started || !callback || exited || quitting) return reply(request.id, null, 'Runtime is unavailable');
      if (request.op === 'quit') {
        quitting = request.id;
        finishQuit();
      } else {
        callback(JSON.stringify({ id: request.id, worldId: scope.worldId, op: request.op, args: request.args ?? {} }));
      }
    };
    port.start(); ready();
  });
  const api = Object.freeze({
    register(value) { if (typeof value !== 'function' || callback) throw Error('Runtime already registered'); callback = value; ready(); },
    complete(value) {
      if (typeof value !== 'string' || value.length > limit) return;
      let response; try { response = JSON.parse(value); } catch { return; }
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
