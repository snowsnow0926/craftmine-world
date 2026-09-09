// Offscreen Electron host for the S2 in-game error-hook test.
//
// It loads one hidden, non-focusable, offscreen window with the packaged
// godot-check preload and a page whose script throws, then prints every message
// the preload sent on the host channel as one JSON line. It never shows a
// window, never takes focus and sends no input.
import {app, BrowserWindow, ipcMain, session} from 'electron';
import fs from 'node:fs';

const CHANNEL = 'pi-desktop/godot-world/message';
const [preload, page, partition] = process.argv.slice(2).filter(value => !value.startsWith('--'));
const trace = message => process.stderr.write('[hook-fixture] ' + message + '\n');
process.on('uncaughtException', error => { trace('uncaught: ' + (error?.stack ?? error)); process.exit(4); });
process.on('unhandledRejection', reason => { trace('unhandled: ' + (reason?.stack ?? reason)); process.exit(5); });

const received = [];
ipcMain.on(CHANNEL, (_event, message) => received.push(message));

app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');
app.disableHardwareAcceleration();

trace('waiting for ready');
// No top-level await: Electron's ESM loader can hang on it before the app is
// ready. The ready event drives everything instead.
app.whenReady().then(main).catch(error => { trace('main failed: ' + (error?.stack ?? error)); app.exit(6); });

async function main() {
  trace('ready');
  const isolated = session.fromPartition(partition ?? 'craftmine-s2-check-hook');
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);

  const scope = {protocol:'craftmine.godot-check/1', worldId:'world-s2-hook', buildId:'gbd-' + 'a'.repeat(64), instanceId:'instance-s2-hook'};
  const window = new BrowserWindow({
    show:false, focusable:false, width:640, height:480, x:-10000, y:-10000,
    webPreferences:{
      preload,
      additionalArguments:['--craftmine-godot-scope=' + encodeURIComponent(JSON.stringify(scope))],
      contextIsolation:true, nodeIntegration:false, sandbox:true, offscreen:true,
      backgroundThrottling:false, webSecurity:true,
    },
  });
  window.webContents.setAudioMuted(true);

  const deadline = setTimeout(() => finish('timeout'), 20000);
  function finish(reason) {
    clearTimeout(deadline);
    const runtimeErrors = received.filter(message => message?.type === 'runtime-error').map(message => message.error);
    process.stdout.write(JSON.stringify({reason, scope, count:received.length, runtimeErrors,
      types:received.map(message => message?.type ?? null)}) + '\n');
    try { window.destroy(); } catch { /* already gone */ }
    app.exit(runtimeErrors.length >= 2 ? 0 : 3);
  }

  window.webContents.once('did-finish-load', () => setTimeout(() => finish('settled'), 1500));
  window.webContents.once('did-fail-load', (_event, code, description) => finish('load-failed:' + code + ':' + description));
  trace('loading page');
  await window.loadFile(page);
  trace('page loaded');
}
