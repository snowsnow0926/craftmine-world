// Fast diagnostic: serve one staged Godot Web export exactly like the verifier
// does and report what the page actually is. Run through `load-probe.mjs`.
import { app, BrowserWindow, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createWorldRuntime } from '../../../../desktop/godot/web/runtime.mjs';
import { godotWorldScopeArgument, GODOT_WORLD_MESSAGE_CHANNEL } from '../../../../vendor/pi-desktop/apps/desktop/electron/shared/godot-world-chrome';

const out = process.env.CRAFTMINE_C_PROBE_OUT;
const artifactsRoot = (value => value.startsWith('\\\\?\\UNC\\') ? '\\\\' + value.slice(8) : value.startsWith('\\\\?\\') ? value.slice(4) : value)(process.env.CRAFTMINE_C_PROBE_ARTIFACTS);
const report = { artifactsRoot, steps: [], diagnostics: [] };
const note = (name, value) => { report.steps.push({ name, value }); console.log(name, JSON.stringify(value)); };

function walk(root, prefix = '') {
  const files = [];
  for (const entry of fs.readdirSync(path.join(root, prefix), { withFileTypes:true })) {
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isDirectory()) files.push(...walk(root, relative));
    else files.push({ path:'web/' + relative, bytes:fs.statSync(path.join(root, relative)).size,
      sha256:createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex') });
  }
  return files;
}

async function main() {
  const artifacts = walk(path.join(artifactsRoot, 'web'));
  note('artifactCount', artifacts.length);
  const runtime = await createWorldRuntime({ worldId:'c-probe-world', buildId:'gbd-' + 'a'.repeat(64), root:artifactsRoot,
    artifacts, entry:'web/index.html', threads:true, timeoutMs:60000 });
  note('runtimeUrl', runtime.url);
  const preload = path.join(__dirname, '../preload/godot-check.cjs');
  const isolated = session.fromPartition('c-probe-' + randomUUID(), { cache:false });
  isolated.setPermissionRequestHandler((_c, _p, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  const requests = [];
  isolated.webRequest.onBeforeRequest({ urls:['<all_urls>'] }, (details, callback) => {
    requests.push(details.url);
    callback({ cancel:false });
  });
  isolated.webRequest.onHeadersReceived({ urls:['<all_urls>'] }, (details, callback) => {
    const headers = details.responseHeaders ?? {};
    const pick = key => Object.entries(headers).find(([name]) => name.toLowerCase() === key)?.[1]?.join(', ') ?? null;
    report.steps.push({ name:'response', value:{ url:details.url, status:details.statusCode, contentType:pick('content-type'),
      csp:pick('content-security-policy'), coop:pick('cross-origin-opener-policy') } });
    callback({});
  });
  isolated.webRequest.onCompleted({ urls:['<all_urls>'] }, details => {
    report.diagnostics.push(`[completed] ${details.statusCode} ${details.url}`);
  });
  isolated.registerPreloadScript({ type:'frame', filePath:preload });
  const window = new BrowserWindow({ width:960, height:640, show:false, focusable:false,
    webPreferences:{ session:isolated, offscreen:true, sandbox:true, contextIsolation:true, nodeIntegration:false,
      webviewTag:false, webSecurity:true, backgroundThrottling:false, spellcheck:false, preload,
      additionalArguments:[godotWorldScopeArgument({ protocol:runtime.protocol, worldId:'c-probe-world',
        buildId:'gbd-' + 'a'.repeat(64), instanceId:runtime.instanceId })] } });
  window.webContents.on('console-message', details => {
    if (report.diagnostics.length < 100) report.diagnostics.push(`[${details.level}] ${details.message.slice(0, 500)}`);
  });
  window.webContents.on('did-fail-load', (_e, code, description, url, main) => note('did-fail-load', { code, description, url, main }));
  window.webContents.on('did-finish-load', () => note('did-finish-load', window.webContents.getURL()));
  window.webContents.on('preload-error', (_e, file, error) => note('preload-error', { file, message:String(error) }));
  const detach = runtime.attach(message => { if (!window.isDestroyed()) window.webContents.send(GODOT_WORLD_MESSAGE_CHANNEL, message); });
  window.webContents.ipc.on(GODOT_WORLD_MESSAGE_CHANNEL, (_e, message) => runtime.receive(message));
  runtime.onEvent(event => note('runtime-event', event));

  const loaded = await window.loadURL(runtime.url).then(() => 'resolved', error => 'rejected: ' + String(error?.message ?? error));
  note('loadURL', loaded);
  for (let index = 0; index < 20; index++) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    if (window.isDestroyed()) break;
    const probe = await window.webContents.executeJavaScript(
      "({href:location.href,title:document.title,ready:document.readyState,coi:crossOriginIsolated," +
      "game:typeof CraftmineGame,engine:typeof Engine,canvas:(()=>{const c=document.getElementById('canvas');return c?[c.width,c.height]:null})()," +
      "htmlLength:document.documentElement.outerHTML.length,html:document.documentElement.outerHTML.slice(0,600)})", false).catch(error => ({ error:String(error) }));
    report.diagnostics.push('[probe] ' + JSON.stringify(probe));
    console.log('[probe]', JSON.stringify(probe));
    if (probe.game === 'object') break;
  }
  note('requests', requests.slice(0, 20));
  const ready = await runtime.waitReady().then(info => ({ ok:true, ops:info.ops }), error => ({ ok:false, error:String(error?.message ?? error) }));
  note('waitReady', ready);
  detach();
  if (!window.isDestroyed()) window.destroy();
  await runtime.dispose({ graceful:true }).catch(() => {});
}

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.on('window-all-closed', () => {});
app.whenReady().then(main).then(() => {
  fs.writeFileSync(path.join(out, 'probe.json'), JSON.stringify(report, null, 2));
  app.exit(0);
}).catch(error => {
  report.failure = String(error?.stack ?? error);
  fs.writeFileSync(path.join(out, 'probe.json'), JSON.stringify(report, null, 2));
  console.error('PROBE FAILURE', report.failure);
  app.exit(1);
});
