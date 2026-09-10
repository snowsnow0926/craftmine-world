/* Explicit opt-in native probe. Fake devices only; never opens or focuses a window. */
const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const path = require("node:path");
const { mkdirSync, writeFileSync } = require("node:fs");
const dataRoot = process.env.CRAFTMINE_VOICE_PROBE_DATA;
const gateBundle = process.env.CRAFTMINE_VOICE_GATE_BUNDLE;
if (!dataRoot || !gateBundle) throw new Error("Dedicated probe data and compiled gate paths required");
mkdirSync(dataRoot, { recursive: true });
app.setPath("userData", path.join(dataRoot, "user-data"));
app.setPath("sessionData", path.join(dataRoot, "session-data"));
app.commandLine.appendSwitch("headless");
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
app.commandLine.appendSwitch("disable-gpu");
app.disableHardwareAcceleration();
const { VoiceMicrophonePermissionGate } = require(gateBundle);
const timer = setTimeout(() => { console.error("Voice permission probe timed out"); app.exit(1); }, 25_000);
let server;
app.whenReady().then(async () => {
  server = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><script>Element.prototype.requestPointerLock = function () { throw new Error("Pointer lock disabled in probe"); };</script><title>Isolated synthetic microphone probe</title>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const window = new BrowserWindow({ show: false, focusable: false, skipTaskbar: true, webPreferences: { offscreen: true, partition: "voice-permission-synthetic", sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const gate = new VoiceMicrophonePermissionGate(() => ({ ownerId: window.webContents.id, documentUrl: window.webContents.getURL() }));
  const events = [];
  window.webContents.session.setPermissionCheckHandler((_wc, permission) => { events.push({ phase: "check", permission }); return gate.check(); });
  window.webContents.session.setPermissionRequestHandler((wc, permission, callback, details) => {
    const allowed = gate.request(wc?.id, permission, details);
    events.push({ phase: "request", permission, details, allowed }); callback(allowed);
  });
  await window.loadURL(url);
  const capture = () => window.webContents.executeJavaScript(`(async () => { try { const stream = await navigator.mediaDevices.getUserMedia({audio:true,video:false}); const count = stream.getAudioTracks().length; stream.getTracks().forEach(track => track.stop()); return {ok:true,count}; } catch(error) { return {ok:false,name:error.name}; } })()`);
  assert.equal((await capture()).ok, false);
  assert.equal(gate.arm(window.webContents.id, url, true, { requestId: "probe-1", contextKey: "synthetic/world" }), true);
  assert.deepEqual(await capture(), { ok: true, count: 1 });
  assert.equal((await capture()).ok, false);
  assert.equal(window.isVisible(), false);
  assert.equal(window.isFocused(), false);
  assert.equal(events.filter(event => event.phase === "request" && event.allowed).length, 1);
  const result = { ok: true, electron: process.versions.electron, fakeDevicesOnly: true, checkAlwaysFalse: true, hidden: true, events };
  writeFileSync(path.join(dataRoot, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  gate.dispose(); window.destroy(); server.close(); clearTimeout(timer); app.exit(0);
}).catch(error => { console.error(error); server?.close(); clearTimeout(timer); app.exit(1); });
