const initialWorld = CRAFTMINE_BOOT_WORLD;
const gameDocument = CRAFTMINE_GAME_DOCUMENT;
const frame = document.querySelector('iframe');
const status = document.getElementById('world-status');
const nonce = crypto.randomUUID();
const requests = new Map();
let loaded = false;

function send(type, value = {}) {
  frame.contentWindow.postMessage({channel:'craftmine-host/1',nonce,type,...value}, '*');
}

addEventListener('message', event => {
  const message = event.data;
  if (event.source !== frame.contentWindow || message?.channel !== 'craftmine-game/1' || message.nonce !== nonce) return;
  if (message.type === 'ready') send('load', initialWorld);
  if (message.type === 'loaded') {
    loaded = true;
    status.textContent = initialWorld.build.scene.title;
    document.body.dataset.worldLoaded = 'true';
  }
  if (message.type === 'error') {
    status.textContent = message.message;
    document.body.dataset.worldError = message.message;
  }
  const pending = requests.get(message.requestId);
  if (pending) { requests.delete(message.requestId); clearTimeout(pending.timer); pending.resolve(message); }
});

// A read-only diagnostics surface also used by the isolated resource probe.
globalThis.craftmineView = Object.freeze({
  snapshot() {
    if (!loaded) return Promise.reject(Error('世界仍在载入'));
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => { requests.delete(requestId); reject(Error('读取世界超时')); }, 5000);
      requests.set(requestId, {resolve,reject,timer});
      send('snapshot', {requestId});
    });
  },
});
frame.srcdoc = gameDocument.replace('__CRAFTMINE_NONCE__', nonce);
