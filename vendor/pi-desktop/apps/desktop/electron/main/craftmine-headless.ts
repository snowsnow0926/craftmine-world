import type { MainWindow } from "./main-window";
import { assetsProbeScript, unwrapAssetsProbeResult } from "./craftmine-assets-acceptance";
import { targetFeedbackProbeScript } from "./craftmine-target-feedback-acceptance";
import { historyProbeScript } from "./craftmine-history-acceptance";
import { app, BaseWindow, dialog, globalShortcut, Notification, session, shell, type WebContents } from "electron";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { readHeadlessProfile, usesNormalAcceptanceRendering, assertAcceptanceWindow } from "./craftmine-headless-profile";
import { createGodotGameplayAcceptance, type GodotGameplayAccess } from "./craftmine-godot-gameplay-acceptance";
import { createGodotBasesAcceptance } from "./craftmine-godot-bases-acceptance";
import { createGodotMiningAcceptance } from "./craftmine-godot-mining-acceptance";
import { createGodotExploration } from "./craftmine-godot-exploration";
import {validateHeadlessAskEnvelope} from './craftmine-headless-ask';
import {createHeadlessPlayer,unwrapPlayerDesktopResult} from './craftmine-headless-player';
import {createHeadlessObserverUpgrade} from './craftmine-headless-observer-upgrade';
import {validateHeadlessPermissionEnvelope} from './craftmine-headless-permission';
import {runHeadlessBoundCapture} from './craftmine-headless-bound-capture';
import type {GodotViewCaptureIdentity} from './godot-view-capture';
import {validateEnginePerformanceAcceptance} from './craftmine-performance-acceptance';

export const isHeadlessAcceptance = () => process.env.CRAFTMINE_HEADLESS_TEST === "1";
const violations: string[] = [];
const pageErrors: string[] = [];
const shutdownFailures: Array<{service: string; error: string}> = [];
export function recordHeadlessShutdownFailure(service: string, error: unknown): void {
  if (!isHeadlessAcceptance()) return;
  shutdownFailures.push({service: service.slice(0, 100), error: String(error).slice(0, 2000)});
  if (shutdownFailures.length > 64) shutdownFailures.shift();
}
type Profile = NonNullable<ReturnType<typeof readHeadlessProfile>>;
let profile: Profile | null = null;
/** Established only by the protected profile + parent IPC setup. */
export const hasHeadlessController = () => isHeadlessAcceptance() && profile !== null && process.connected === true;
/** Rendering only: normal acceptance retains every headless isolation/input guard. */
export const isOffscreenAcceptance = () => isHeadlessAcceptance() && !usesNormalAcceptanceRendering(profile, process.connected === true);

function denied(name: string): never {
  violations.push(name);
  throw new Error(`Headless acceptance blocked ${name}`);
}

/** BaseWindow does not emit browser-window-created; its factory calls this too. */
export function guardHeadlessWindow(window: MainWindow): void {
  if (!isHeadlessAcceptance()) return;
  assertAcceptanceWindow(profile, process.connected === true, {visible: window.isVisible(), focusable: window.isFocusable(), offscreen: window.webContents.isOffscreen()});
  for (const name of ["show", "showInactive", "focus", "restore", "moveTop", "setAlwaysOnTop", "flashFrame"]) {
    Object.defineProperty(window, name, {configurable: false, writable: false, value: () => denied(name)});
  }
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
  app.on("browser-window-created", (_event, window) => guardHeadlessWindow(window));
  app.on("will-quit", () => process.send?.({ type: "craftmine-headless-exit", violations, pageErrors, shutdownFailures }));
  return profile;
}

export function installHeadlessControl(access: {
  window: () => MainWindow | null;
  world: () => WebContents | null;
  runtime: () => unknown;
  draftProbe: () => Promise<unknown>;
  godotGameplay?: GodotGameplayAccess;
  godotSave?: () => Promise<any>;
  playerActive?: (sessionId:string)=>boolean;
  playerLatest?: (worldId:string,sessionId:string)=>Promise<any>;
  boundCapture?: (identity:GodotViewCaptureIdentity)=>Promise<unknown>;
  boundCaptureState?: ()=>unknown;
  enginePerformance?: (identity:{worldId:string;buildId:string;instanceId:string})=>Promise<unknown>;
}): void {
  if (!profile) return;
  const godotExplore = access.godotGameplay ? createGodotExploration(access.godotGameplay) : null;
  const godotGameplay = access.godotGameplay ? createGodotGameplayAcceptance(access.godotGameplay) : null;
  const godotBases = access.godotGameplay ? createGodotBasesAcceptance({...access.godotGameplay, save: access.godotSave}) : null;
  const godotMining = access.godotGameplay && access.godotSave ? createGodotMiningAcceptance({...access.godotGameplay, save: access.godotSave}) : null;
  const configuration = profile;
  const desktopCall=(script:string)=>{
    const window=access.window();
    if(!hasHeadlessController()||!window||window.isDestroyed()||window.isVisible()||window.isFocusable()||!window.webContents.isOffscreen())throw Error('HEADLESS_PLAYER_WINDOW_UNAVAILABLE');
    return window.webContents.executeJavaScript(script,false);
  };
  const player=access.godotGameplay&&access.playerActive&&access.playerLatest?createHeadlessPlayer({
    invoke:async(channel,...args)=>unwrapPlayerDesktopResult(await desktopCall(`piDesktop.invoke(piDesktop.channels.invoke[${JSON.stringify(channel)}],...${JSON.stringify(args)})`)),
    panel:(channel,payload)=>desktopCall(`piDesktop.pluginPanelInvoke('craftmine.world',${JSON.stringify(channel)},${JSON.stringify(payload)})`),
    observe:access.godotGameplay.observe,active:access.playerActive,latest:access.playerLatest,
  }):null;
  const observerUpgrade=access.godotGameplay&&access.playerActive?createHeadlessObserverUpgrade({
    invoke:async(channel,...args)=>unwrapPlayerDesktopResult(await desktopCall(`piDesktop.invoke(piDesktop.channels.invoke[${JSON.stringify(channel)}],...${JSON.stringify(args)})`)),
    panel:(channel,payload)=>desktopCall(`piDesktop.pluginPanelInvoke('craftmine.world',${JSON.stringify(channel)},${JSON.stringify(payload)})`),
    observe:access.godotGameplay.observe,active:access.playerActive,
  }):null;
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
        case 'godotEnginePerformance': {
          const identity=validateEnginePerformanceAcceptance(request,hasHeadlessController()&&process.env.CRAFTMINE_CREATION_EVAL!=='1');
          if(!access.enginePerformance)throw Error('HEADLESS_ENGINE_PERFORMANCE_UNAVAILABLE');
          try {return await access.enginePerformance(identity);}
          catch(error){process.stderr.write('HEADLESS ENGINE SAMPLE: '+String(error instanceof Error?error.stack:error)+'\n');throw error;}
        }
        case 'godotCaptureBoundView':case 'godotCaptureBoundState':
          if(!access.boundCapture||!access.boundCaptureState)throw Error('HEADLESS_BOUND_CAPTURE_UNAVAILABLE');
          return runHeadlessBoundCapture(request,{enabled:hasHeadlessController()&&process.env.CRAFTMINE_CREATION_EVAL!=='1',capture:access.boundCapture,state:access.boundCaptureState});
        case 'playerObserverHint':case 'playerObserverUpgrade':case 'playerObserverStatus':
          if(!hasHeadlessController()||!observerUpgrade||process.env.CRAFTMINE_CREATION_EVAL==='1'||Object.keys(request).sort().join(',')!=='id,method,payload,type')throw Error('HEADLESS_OBSERVER_NORMAL_SESSION_REQUIRED');
          return observerUpgrade(request.method,request.payload);
        case 'headlessPermissionPending':case 'headlessPermissionResolve':{
          const script=validateHeadlessPermissionEnvelope(request,hasHeadlessController()&&process.env.CRAFTMINE_CREATION_EVAL!=='1');
          return desktopCall(script);
        }
        case 'playerSetup':case 'playerPrompt':case 'playerRetryFailedPrompt':case 'playerStatus':case 'playerAbort':
          if(!hasHeadlessController()||!player||process.env.CRAFTMINE_CREATION_EVAL==='1'||Object.keys(request).sort().join(',')!=='id,method,payload,type')throw Error('HEADLESS_PLAYER_NORMAL_SESSION_REQUIRED');
          return player(request.method,request.payload);
        case "headlessAskPending":
        case "headlessAskResolve": {
          const script=validateHeadlessAskEnvelope(request,hasHeadlessController());
          const window=access.window();
          if(!window||window.isDestroyed()||window.isVisible()||window.isFocusable()||!window.webContents.isOffscreen())throw Error('HEADLESS_ASK_WINDOW_UNAVAILABLE');
          return window.webContents.executeJavaScript(script,false);
        }
        case "godotExplore":
          if (Object.keys(request).sort().join(",") !== "id,method,payload,type" || !godotExplore) throw Error("Unsupported bounded exploration request");
          return godotExplore(request.payload);
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
          name: app.getName(), profile: app.getPath("userData"), runtime: access.runtime(), violations, pageErrors, shutdownFailures,
          processes: app.getAppMetrics().map(process => ({pid: process.pid, type: process.type,
            creationTime: process.creationTime, cpu: process.cpu, memory: process.memory})),
          windows: BaseWindow.getAllWindows().map(window => ({ visible: window.isVisible(), focused: window.isFocused(), focusable: window.isFocusable(), offscreen: (window as MainWindow).webContents?.isOffscreen() === true })),
          world: access.world()?.getURL() || null,
        };
        case "worldState": return evaluateWorld(`(async()=>({loaded:document.body.dataset.worldLoaded==='true',id:document.body.dataset.worldId,error:document.getElementById('error').textContent,status:document.getElementById('world-status').textContent,disabled:document.getElementById('save-world').disabled,guard:globalThis.__craftmineHeadless,snapshot:document.body.dataset.worldLoaded==='true'?(await craftmineView.snapshot()).snapshot:null}))()`);
        case "worldNavigationReady": return evaluateWorld(`({worldId:document.body.dataset.worldId,ready:!document.getElementById('world-list').disabled})`);
        case "worldCreationGuide": {
          if (Object.keys(request).sort().join(",") !== "id,method,type") throw Error("Unexpected creation guide probe fields");
          const window = access.window(); if (!window) throw Error("Window is not ready");
          const before = await evaluateWorld(`({worldId:document.body.dataset.worldId,headerHeight:document.querySelector('header').getBoundingClientRect().height})`) as {worldId: string; headerHeight: number};
          const result = await window.webContents.executeJavaScript(`(async()=>{
            const wait=async(selector)=>{const until=Date.now()+15000;while(Date.now()<until){const node=document.querySelector(selector);if(node)return node;await new Promise(resolve=>setTimeout(resolve,25));}throw Error('Guide surface unavailable: '+selector);};
            const submit=async(selector)=>{(await wait(selector)).requestSubmit();await new Promise(resolve=>setTimeout(resolve,0));};
            const toggle=await wait('[data-first-guide-toggle]');
            const original=JSON.parse(localStorage.getItem('craftmine.first-creation.guide.v1')||'null');
            if(toggle.querySelector('button').getAttribute('aria-expanded')==='true')await submit('[data-first-guide-toggle]');
            const result={collapsed:!document.querySelector('[data-first-guide-title]'),insideSidebar:!!toggle.closest('.craftmine-navigation')};
            await submit('[data-first-guide-toggle]');
            result.expanded=!!document.querySelector('[data-first-guide-title]');result.steps=document.querySelectorAll('[data-first-guide-step]').length;
            await submit('[data-first-guide-step="1"]');await submit('[data-first-guide-action="assets"]');
            result.libraryVisible=!!await wait('[data-asset-sheet]');await submit('[data-asset-close-form]');
            await submit('[data-first-guide-step="4"]');await submit('[data-first-guide-action="share"]');
            result.shareVisible=!!await wait('[data-library-publish="world"]');
            result.progressConsentRequired=!document.querySelector('[data-publication-checkpoint]').checked;
            await submit('[data-asset-close-form]');await submit('[data-first-guide-dismiss]');
            result.dismissed=!document.querySelector('[data-first-guide-title]');await submit('[data-first-guide-toggle]');
            result.bookmarkRetained=JSON.parse(localStorage.getItem('craftmine.first-creation.guide.v1')).step===4;
            await submit('[data-first-guide-step="2"]');await submit('[data-first-guide-action="history"]');
            result.historyVisible=!!await wait('[data-history-sheet]');await submit('[data-history-close-form]');
            await submit('[data-first-guide-step="'+(original?.step??0)+'"]');
            if(!original?.open)await submit('[data-first-guide-dismiss]');
            return result;
          })()`, false);
          const after = await evaluateWorld(`({worldId:document.body.dataset.worldId,headerHeight:document.querySelector('header').getBoundingClientRect().height,oldGuideAbsent:!document.querySelector('[data-creation-guide]')})`) as {worldId: string; headerHeight: number; oldGuideAbsent: boolean};
          return {...result, worldId: before.worldId, headerUnchanged: before.headerHeight === after.headerHeight, worldUnchanged: before.worldId === after.worldId, oldGuideAbsent: after.oldGuideAbsent};
        }
        case "desktopState": {
          const window = access.window(); if (!window) throw new Error("Window is not ready");
          return window.webContents.executeJavaScript(`(async()=>({title:document.title,text:document.body.innerText,version:globalThis.piDesktop?await piDesktop.invoke(piDesktop.channels.invoke.appGetVersion):null,guard:globalThis.__craftmineHeadless}))()`, false);
        }
        case "primaryMode": {
          const action = request.payload?.action ?? "inspect";
          if (!["inspect", "entry", "create", "play", "closed", "compact", "full"].includes(String(action))) throw Error("INVALID_MODE_PROBE");
          const window = access.window(); if (!window) throw Error("Window is not ready");
          return window.webContents.executeJavaScript(`(() => {
            const action = ${JSON.stringify(action)};
            if (action === 'entry') window.dispatchEvent(new CustomEvent('craftmine-mode-entry-open'));
            if (action === 'create' || action === 'play') {
              const button = document.querySelector('[data-mode="'+action+'"]');
              const key = button && Object.keys(button).find(key => key.startsWith('__reactProps$'));
              if (!key) throw Error('Mode entry is not ready');
              button[key].onClick();
            }
            if (['closed','compact','full'].includes(action)) {
              const key = 'craftmine.desktop.layout.v1';
              const layout = JSON.parse(localStorage.getItem(key));
              if (layout.mode !== 'play') throw Error('World is not immersive');
              localStorage.setItem(key, JSON.stringify({...layout, overlay:action}));
              window.dispatchEvent(new CustomEvent('craftmine-layout-changed'));
            }
            const bounds = selector => { const r = document.querySelector(selector)?.getBoundingClientRect(); return r ? {x:r.x,y:r.y,width:r.width,height:r.height} : null; };
            return {entry:!!document.querySelector('[data-mode-entry]'),play:!!document.querySelector('.craftmine-play'),
              playWorldId:document.querySelector('[data-mode="play"]')?.getAttribute('data-active-world')??null,
              world:bounds('.work-plugin-view-surface'),dialog:bounds('.main-pane[role="dialog"]'),width:innerWidth,height:innerHeight};
          })()`, false);
        }
        case "targetFeedbackView": {
          if (Object.keys(request).sort().join(",") !== "id,method,payload,type") throw Error("INVALID_TARGET_FEEDBACK_PROBE");
          return evaluateWorld(targetFeedbackProbeScript(request.payload));
        }
        case "assetsView": {
          if (Object.keys(request).sort().join(",") !== "id,method,payload,type") throw Error("INVALID_ASSET_PROBE");
          const window = access.window(); if (!window) throw Error("Window is not ready");
          return unwrapAssetsProbeResult(await window.webContents.executeJavaScript(assetsProbeScript(request.payload), false));
        }
        case "historyView": {
          if (Object.keys(request).sort().join(",") !== "id,method,payload,type") throw Error("INVALID_HISTORY_PROBE");
          const window = access.window(); if (!window) throw Error("Window is not ready");
          return window.webContents.executeJavaScript(historyProbeScript(request.payload), false);
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
          if (!new Set(["godot.exportWindows", "godot.exportWindows.status", "godot.exportWindows.cancel", "godot.runtimeSave", "godot.runtimeResume", "godot.runtimeState", "godot.candidatePreview", "godot.candidateApply", "godot.candidateClose", "godot.candidateState", "godot.candidateList", "godot.candidateRead", "package.request", "backup.export", "backup.inspect", "backup.restore", "backup.status", "workbench.capabilities", "workbench.prepare", "workbench.execute", "workbench.operations", "diagnostics.status", "diagnostics.export", "issue.create", "issue.list", "issue.read", "issue.delete", "issue.followupPrepare", "issue.followup", "issue.export", "targetFeedback.describe", "targetFeedback.submit", "targetFeedback.status"]).has(request.channel ?? "")) throw Error("Unsupported product panel acceptance channel");
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
