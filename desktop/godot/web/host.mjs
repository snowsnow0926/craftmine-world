// Preview transport has no authority to publish builds or read/write host files.
const protocol = 'craftmine.godot-preview/1';
const idPattern = /^[a-zA-Z0-9._-]{1,128}$/;
const wireLimit = 65536;

export function connectGodotFrame(frame, { worldId, buildId, timeoutMs = 15000 }) {
  const url = new URL(frame.src, location.href), origin = url.origin;
  if (!/^https?:$/.test(url.protocol) || origin === location.origin || origin === 'null') throw Error('Godot requires a separate HTTP(S) origin');
  if (![worldId, buildId].every(value => typeof value === 'string' && idPattern.test(value))) throw Error('Invalid world/build identity');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw Error('Invalid preview timeout');
  const scope = { protocol, worldId, buildId, session: crypto.randomUUID() };
  const channel = new MessageChannel(), pending = new Map(), errors = [];
  let sequence = 0, closed = false, available = false, readyReceived = false, resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const timer = setTimeout(() => dispose('Godot startup timed out'), timeoutMs);
  function settle(id, error, result) {
    const entry = pending.get(id); if (!entry) return;
    pending.delete(id); clearTimeout(entry.timer);
    if (error) entry.reject(Error(error)); else entry.resolve(result);
  }
  function dispose(reason = 'Preview closed') {
    if (closed) return;
    closed = true; available = false; clearTimeout(timer); rejectReady(Error(reason));
    for (const id of pending.keys()) settle(id, reason);
    channel.port1.close();
  }
  channel.port1.onmessage = event => {
    const message = event.data;
    if (closed || !message || Object.entries(scope).some(([key, value]) => message[key] !== value)) return;
    // MessagePort supports values JSON cannot represent. Validate before clearing
    // the request timer so a cyclic/BigInt response cannot orphan a Promise.
    try {
      if (JSON.stringify(message).length > wireLimit) throw Error('Oversized runtime response');
    } catch (error) {
      settle(message.id, error.message === 'Oversized runtime response' ? error.message : 'Invalid runtime response');
      return;
    }
    if (message.type === 'ready' && !readyReceived) { readyReceived = true; available = true; clearTimeout(timer); resolveReady(); }
    if (message.type === 'runtime-error') {
      errors.push(typeof message.error === 'string' ? message.error.slice(0, 2000) : 'Invalid runtime diagnostic');
      if (errors.length > 32) errors.shift();
    }
    if (message.type === 'response') settle(message.id, typeof message.error === 'string' ? message.error : null, message.result);
    if (message.type === 'exited') dispose('Godot runtime exited');
  };
  channel.port1.start();
  frame.contentWindow.postMessage({ ...scope, type: 'connect' }, origin, [channel.port2]);
  return Object.freeze({
    worldId, buildId, ready,
    get errors() { return [...errors]; },
    request(op, args = {}) {
      if (closed || !available) return Promise.reject(Error('Preview is not ready'));
      if (pending.size >= 16) return Promise.reject(Error('Too many preview requests'));
      const id = ++sequence, message = { ...scope, type: 'request', id, op, args };
      try {
        if (typeof op !== 'string' || op.length > 64 || JSON.stringify(message).length > wireLimit) throw Error('Invalid preview request');
      } catch { return Promise.reject(Error('Invalid preview request')); }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => settle(id, 'Runtime request timed out: ' + op), timeoutMs);
        pending.set(id, { resolve, reject, timer });
        try { channel.port1.postMessage(message); } catch { settle(id, 'Invalid preview request'); }
      });
    },
    dispose,
  });
}
