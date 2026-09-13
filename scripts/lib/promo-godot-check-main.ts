import {app, BrowserWindow, type NativeImage} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {GodotBuildVerifier} from '../../vendor/pi-desktop/apps/desktop/electron/main/godot-build-verifier';

// Private host process. Only the coordinator sends descriptors over Node IPC;
// the author and game page do not receive this interface.
const directory = process.env.CRAFTMINE_PROMO_CHECK_ROOT;
if (!directory || !path.isAbsolute(directory) || !process.send) throw Error('PRIVATE_CHECK_HOST_REQUIRED');
app.setPath('userData', path.join(directory, 'chromium'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
const verifier = new GodotBuildVerifier();
let active: {jobId: string; lastFrame: NativeImage | null; width: number; height: number} | null = null;
let closing = false;
const checks = new Set<Promise<void>>();

// The existing verifier owns the hidden, non-focusable window, network policy,
// preload guard, artifact hashes and runtime assertions. Observe its actual
// offscreen frames without injecting input or changing the authored scene.
app.on('web-contents-created', (_event, contents) => {
  contents.once('dom-ready', () => {
    void contents.executeJavaScript('window.addEventListener("error",event=>console.error("[runtime-stack] "+String(event.error?.stack??event.message)))', false).catch(() => undefined);
  });
  contents.on('paint', (_paintEvent, _dirty, nativeImage) => {
    if (!active || nativeImage.isEmpty()) return;
    const size = nativeImage.getSize();
    // Retain the last native bitmap. PNG compression on every animated paint
    // can delay the very runtime/exit messages this verifier is measuring.
    active.lastFrame = nativeImage;
    active.width = size.width; active.height = size.height;
  });
});
app.on('window-all-closed', () => {});

async function close() {
  if (closing) return;
  closing = true; verifier.cancelAll();
  await Promise.allSettled([...checks]);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  app.quit();
}

process.on('message', (message: any) => {
  if (!message || message.kind !== 'craftmine-promo-check') return;
  const reply = (value: unknown) => process.send?.({id: message.id, ...value as object});
  if (message.method === 'cancel') { verifier.cancelAll(); reply({result: {cancelling: true}}); return; }
  if (message.method === 'close') { void close(); return; }
  if (message.method !== 'check' || closing || active) { reply({error: 'CHECK_HOST_NOT_AVAILABLE'}); return; }
  const jobId = message.descriptor?.jobId;
  if (!/^gjob-[a-f0-9]{64}$/.test(jobId ?? '')) { reply({error: 'INVALID_CHECK_JOB'}); return; }
  const capture = {jobId, lastFrame: null as NativeImage | null, width: 0, height: 0};
  active = capture;
  const work = (async () => {
    try {
      const evidence = await verifier.check(message.descriptor);
      let frame = null;
      if (capture.lastFrame) {
        const file = path.join(directory!, jobId + '.png');
        const bytes = capture.lastFrame.toPNG();
        fs.writeFileSync(file, bytes);
        frame = {file, sha256: createHash('sha256').update(bytes).digest('hex'),
          width: capture.width, height: capture.height, source: 'actual candidate runtime offscreen frame'};
      }
      fs.writeFileSync(path.join(directory!, jobId + '.json'), JSON.stringify({evidence, frame}, null, 2) + '\n');
      reply({result: evidence, frame});
    } catch (error) {
      reply({error: error instanceof Error ? error.message : 'CHECK_FAILED'});
    } finally { active = null; }
  })();
  checks.add(work); void work.finally(() => checks.delete(work));
});
process.on('disconnect', () => void close());
void app.whenReady().then(() => process.send?.({kind: 'craftmine-promo-check-ready'}));
