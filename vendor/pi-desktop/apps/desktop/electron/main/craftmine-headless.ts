import { app, BrowserWindow, dialog, globalShortcut, Notification, session, shell, type WebContents } from "electron";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { readHeadlessProfile } from "./craftmine-headless-profile";
import { createGodotGameplayAcceptance, type GodotGameplayAccess } from "./craftmine-godot-gameplay-acceptance";
import { createGodotBasesAcceptance } from "./craftmine-godot-bases-acceptance";
import { createGodotMiningAcceptance } from "./craftmine-godot-mining-acceptance";

export const isHeadlessAcceptance = () => process.env.CRAFTMINE_HEADLESS_TEST === "1";
const violations: string[] = [];
const pageErrors: string[] = [];
type Profile = NonNullable<ReturnType<typeof readHeadlessProfile>>;
let profile: Profile | null = null;

function denied(name: string): never {
  violations.push(name);
  throw new Error(`Headless acceptance blocked ${name}`);
}

export function configureHeadlessAcceptance(): Profile | null {
  if (!isHeadlessAcceptance()) return null;
  // Install before validation: even a malformed probe must never open Electron's
  // default uncaught-error dialog or fall back to a personal profile.
  const fail = (error: unknown) => { process.stderr.write(`HEADLESS FAILURE: ${String(error)}\n`); app.exit(1); };
  process.on("uncaughtException", fail);
  process.on("unhandledRejection", fail);
  profile = readHeadlessProfile(process.env);
  if (!profile || !process.send || !process.connected) throw new Error("Headless acceptance requires a parent IPC channel");
  const block = (target: object, name: string) => Object.defineProperty(target, name, { configurable: false, writable: false, value: () => denied(name) });
  for (const name of ["showOpenDialog", "showOpenDialogSync", "showSaveDialog", "showSaveDialogSync", "showMessageBox", "showMessageBoxSync", "showErrorBox", "showCertificateTrustDialog"]) block(dialog, name);
  for (const name of ["openExternal", "openPath", "showItemInFolder"]) block(shell, name);
  for (const name of ["register", "registerAll"]) block(globalShortcut, name);
  block(Notification.prototype, "show");
  block(app, "focus");
  const preparedSessions = new WeakSet<Electron.Session>();
  const prepareSession = (ses: Electron.Session) => {
    if (preparedSessions.has(ses)) return;
    preparedSessions.add(ses);
    ses.registerPreloadScript({ type: "frame", filePath: join(__dirname, "../preload/craftmine-headless.cjs") });
    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
  };
  app.on("session-created", prepareSession);
  void app.whenReady().then(() => prepareSession(session.defaultSession));
  app.on("web-contents-created", (_event, contents) => {
    block(contents, "sendInputEvent"); block(contents, "focus");
    contents.on("console-message", event => {
      process.stdout.write(`HEADLESS PAGE ${contents.id}: ${event.message}\n`);
      if (event.message.startsWith("Uncaught")) pageErrors.push(event.message);
    });
    contents.on("render-process-gone", (_event, details) => fail(`Renderer ${contents.id}: ${details.reason}`));
    contents.on("preload-error", (_event, path, error) => fail(`${path}: ${error.message}`));
    contents.on("will-attach-webview", event => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
  });
  app.on("browser-window-created", (_event, window) => {
    if (window.isVisible() || window.isFocusable() || !window.webContents.isOffscreen()) throw new Error("Headless window was not created offscreen and unfocusable");
    for (const name of ["show", "showInactive", "focus", "restore", "moveTop", "setAlwaysOnTop", "flashFrame"]) block(window, name);
  });
  app.on("will-quit", () => process.send?.({ type: "craftmine-headless-exit", violations, pageErrors }));
  return profile;
}

export function installHeadlessControl(access: {
  window: () => BrowserWindow | null;
  world: () => WebContents | null;
  runtime: () => unknown;
  draftProbe: () => Promise<unknown>;
  godotGameplay?: GodotGameplayAccess;
  godotSave?: () => Promise<any>;
}): void {
  if (!profile) return;
  const godotGameplay = access.godotGameplay ? createGodotGameplayAcceptance(access.godotGameplay) : null;
  const godotBases = access.godotGameplay ? createGodotBasesAcceptance({...access.godotGameplay, save: access.godotSave}) : null;
  const godotMining = access.godotGameplay && access.godotSave ? createGodotMiningAcceptance({...access.godotGameplay, save: access.godotSave}) : null;
  const configuration = profile;
  const evaluateWorld = (script: string) => {
    const view = access.world();
    if (!view || view.isDestroyed()) throw new Error("World view is not ready");
    return view.executeJavaScript(script, false);
  };
  process.on("message", (input: unknown) => {
    const request = input as { type?: string; id?: string; method?: string; name?: string; channel?: string; payload?: Record<string, unknown> };
    if (request?.type !== "craftmine-headless" || typeof request.id !== "string") return;
    void (async () => {
      switch (request.method) {
        case "godotPlayMine":
          if (Object.keys(request).sort().join(",") !== "id,method,type" || !godotMining) throw Error("Unsupported fixed mining gameplay request");
          return godotMining(request.method);
        case "godotObserve":
          if (!access.godotGameplay) throw Error("Actual Godot host unavailable");
          return access.godotGameplay.observe();
        case "godotSnapshot":
          if (!access.godotGameplay) throw Error("Actual Godot host unavailable");
          return access.godotGameplay.action("snapshot", {});
        case "godotCaptureView":
          if (!access.godotGameplay) throw Error("Actual Godot host unavailable");
          return access.godotGameplay.capture(1280, 720);
        case "godotPlayTown":
        case "godotPlayRuins":
          if (Object.keys(request).sort().join(",") !== "id,method,type" || !godotBases) throw Error("Unsupported fixed base gameplay request");
          return godotBases(request.method);
        case "godotPlay":
        case "godotAdvance":
        case "godotCapture720":
        case "godotCapture600":
        case "godotCapture1080":
          if (Object.keys(request).sort().join(",") !== "id,method,type") throw new Error("Unexpected fixed gameplay request fields");
          if (!godotGameplay) throw new Error("Actual Godot gameplay host unavailable");
          return godotGameplay(request.method);
        case "status": return {
          name: app.getName(), profile: app.getPath("userData"), runtime: access.runtime(), violations, pageErrors,
          windows: BrowserWindow.getAllWindows().map(window => ({ visible: window.isVisible(), focused: window.isFocused(), focusable: window.isFocusable(), offscreen: window.webContents.isOffscreen() })),
          world: access.world()?.getURL() || null,
        };
        case "worldState": return evaluateWorld(`(async()=>({loaded:document.body.dataset.worldLoaded==='true',id:document.body.dataset.worldId,error:document.getElementById('error').textContent,status:document.getElementById('world-status').textContent,disabled:document.getElementById('save-world').disabled,guard:globalThis.__craftmineHeadless,snapshot:document.body.dataset.worldLoaded==='true'?(await craftmineView.snapshot()).snapshot:null}))()`);
        case "worldNavigationReady": return evaluateWorld(`({worldId:document.body.dataset.worldId,ready:!document.getElementById('world-list').disabled})`);
        case "desktopState": {
          const window = access.window(); if (!window) throw new Error("Window is not ready");
          return window.webContents.executeJavaScript(`(async()=>({title:document.title,text:document.body.innerText,version:globalThis.piDesktop?await piDesktop.invoke(piDesktop.channels.invoke.appGetVersion):null,guard:globalThis.__craftmineHeadless}))()`, false);
        }
        case "worldNavigation": {
          const window = access.window(); if (!window) throw new Error("Window is not ready");
          return window.webContents.executeJavaScript(
            `globalThis.piDesktop.pluginPanelInvoke("craftmine.world",${JSON.stringify(request.channel)},${JSON.stringify(request.payload ?? {})})`, false,
          );
        }
        case "worldNavigationRows": {
          const window = access.window(); if (!window) throw new Error("Window is not ready");
          return window.webContents.executeJavaScript(
            `[...document.querySelectorAll(".craftmine-world-item")].map(row=>({id:row.dataset.worldId,active:row.dataset.worldActive==="true",text:row.innerText}))`, false,
          );
        }
        case "worldPanel": {
          if (!new Set(["godot.exportWindows", "godot.exportWindows.status", "godot.exportWindows.cancel", "godot.runtimeSave", "godot.runtimeResume", "godot.runtimeState", "godot.candidatePreview", "godot.candidateApply", "godot.candidateClose", "godot.candidateState", "godot.candidateList", "godot.candidateRead", "package.request", "backup.export", "backup.inspect", "backup.restore", "backup.status", "workbench.capabilities", "workbench.prepare", "workbench.execute", "workbench.operations", "diagnostics.status", "diagnostics.export", "issue.create", "issue.list", "issue.read", "issue.delete"]).has(request.channel ?? "")) throw Error("Unsupported product panel acceptance channel");
          return evaluateWorld(`globalThis.pluginBridge.invoke(${JSON.stringify(request.channel)},${JSON.stringify(request.payload ?? {})})`);
        }
        case "draftProbe": return access.draftProbe();
        case "guards": {
          const contents = [access.window()?.webContents, access.world()].filter((value): value is WebContents => !!value);
          return Promise.all(contents.flatMap(view => view.mainFrame.framesInSubtree.map(frame => frame.executeJavaScript(`({url:location.href,guard:globalThis.__craftmineHeadless||null,node:typeof process,bridge:typeof pluginBridge})`, false))));
        }
        case "importLegacy": return evaluateWorld(`document.getElementById('import-form').requestSubmit()`);
        case "respawn": return evaluateWorld(`(()=>{const frame=document.querySelector('iframe');const nonce=frame.srcdoc.match(/name="craftmine-nonce" content="([^"]+)"/)[1];frame.contentWindow.postMessage({channel:'craftmine-host/1',nonce,type:'respawn'},'*');})()`);
        case "close": access.window()?.close(); return { requested: true };
        case "quit": app.quit(); return { requested: true };
        case "capture":
        case "captureWorld": {
          if (!/^[a-z0-9-]{1,60}$/.test(request.name || "")) throw new Error("Invalid probe capture name");
          const contents = request.method === "captureWorld" ? access.world() : access.window()?.webContents;
          if (!contents) throw new Error("Capture surface is not ready");
          const screenshot = await contents.capturePage();
          writeFileSync(join(configuration.root, request.name + ".png"), screenshot.toPNG());
          return { width: screenshot.getSize().width, height: screenshot.getSize().height };
        }
        default: throw new Error("Unknown headless acceptance operation");
      }
    })().then(result => process.send?.({ type: "craftmine-headless", id: request.id, result }), error => process.send?.({ type: "craftmine-headless", id: request.id, error: String(error) }));
  });
  process.send?.({ type: "craftmine-headless-ready" });
}
