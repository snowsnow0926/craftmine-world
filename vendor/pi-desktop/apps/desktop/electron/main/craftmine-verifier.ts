import { BrowserWindow, session } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { checkCraftmineFrame } from "./craftmine-frame-check";

/** Built-in product service. This is never exposed as a model or panel API. */
export class CraftmineVerifier {
  private jobs = new Map<string, () => void>();

  cancel(id: string): void { this.jobs.get(id)?.(); }
  cancelAll(): void { for (const cancel of this.jobs.values()) cancel(); }

  async verify(input: any, pluginPath: string): Promise<unknown> {
    const id = input?.id;
    if (typeof id !== "string" || !/^(check|review|apply)-[a-f0-9]{64}$/.test(id) || !input.world?.build?.id) throw new Error("INVALID_VERIFICATION_REQUEST");
    if (input.mode !== undefined && !["verification", "application", "observe", "acceptance"].includes(input.mode)) throw new Error("INVALID_VERIFICATION_MODE");
    if (Buffer.byteLength(JSON.stringify(input)) > 66 * 1024 * 1024) throw new Error("VERIFICATION_TOO_LARGE");
    if (this.jobs.has(id) || this.jobs.size >= 2) throw new Error("VERIFIER_BUSY");
    const directory = join(pluginPath, "views");
    const allowed = new Set(["verify.html", "verify.js"].map(file => pathToFileURL(join(directory, file)).href));
    const isolated = session.fromPartition(`craftmine-verification-${randomUUID()}`, { cache: false });
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    isolated.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !allowed.has(details.url) && !/^(about:blank|about:srcdoc|blob:|data:)/.test(details.url) }));
    const window = new BrowserWindow({ width: 960, height: 640, show: false, focusable: false,
      webPreferences: { session: isolated, offscreen: true, sandbox: true, contextIsolation: true,
        nodeIntegration: false, webSecurity: true, backgroundThrottling: false, spellcheck: false } });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", event => event.preventDefault());
    window.webContents.on("will-attach-webview", event => event.preventDefault());
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stopped = new Promise<never>((_resolve, reject) => {
      this.jobs.set(id, () => reject(new Error("VERIFICATION_CANCELLED")));
      timer = setTimeout(() => reject(new Error("VERIFICATION_TIMEOUT")), 30_000);
      window.webContents.once("render-process-gone", (_event, details) => reject(new Error(`VERIFIER_RENDERER_EXIT: ${details.reason}`)));
    });
    try {
      return await Promise.race([stopped, (async () => {
        await window.loadFile(join(directory, "verify.html"));
        const result = await window.webContents.executeJavaScript(`globalThis.craftmineVerify(${JSON.stringify(input)})`, false);
        const frames = await Promise.all(window.webContents.mainFrame.framesInSubtree.map(async frame => await frame.executeJavaScript("({guard:globalThis.__craftmineHeadless||null,node:typeof process,bridge:typeof pluginBridge})", false) as {guard: {focus: number; pointerLock: number} | null; node: string; bridge: string}));
        if (window.isVisible() || window.isFocusable() || !window.webContents.isOffscreen() || frames.some(frame => !frame.guard || frame.guard.focus || frame.guard.pointerLock || frame.node !== "undefined" || frame.bridge !== "undefined")) throw new Error("VERIFIER_ISOLATION_FAILED");
        result.isolation = { offscreen: true, focusable: false, visible: false, frames };
        if (result.render?.passed) {
          // A loaded message precedes the compositor's first offscreen paint.
          // Require real pixels within a bounded readiness window; an empty
          // canvas still fails, regardless of successful script/Worker replies.
          const paintDeadline = Date.now() + 2500;
          let attempts = 0;
          for (;;) {
            if (window.isDestroyed()) throw new Error("VERIFIER_RENDERER_EXIT");
            window.webContents.invalidate();
            const capture = await window.webContents.capturePage();
            attempts++;
            try {
              const pixels = checkCraftmineFrame(capture);
              const png = capture.toPNG();
              result.render.capture = { sha256: createHash("sha256").update(png).digest("hex"), ...capture.getSize(), ...pixels, attempts };
              break;
            } catch (error) {
              if (!(error instanceof Error) || error.message !== "BLANK_GAME_FRAME" || Date.now() >= paintDeadline) throw error;
              await new Promise(resolve => setTimeout(resolve, 50));
            }
          }
        }
        return result;
      })()]);
    } finally {
      clearTimeout(timer); this.jobs.delete(id);
      if (!window.isDestroyed()) window.destroy();
      isolated.webRequest.onBeforeRequest(null);
      await isolated.clearStorageData();
    }
  }
}
