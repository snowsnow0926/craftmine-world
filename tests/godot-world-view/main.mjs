// Acceptance harness main process (task C).
//
// This is a test entry, not the product entry: it builds a real BrowserWindow,
// a real `WebContentsView` through `GodotWorldViewHost`, a real Godot Web
// export on the runtime's loopback origin, and exposes the commands the runner
// drives. The production wiring of the same module into
// `electron/main/index.ts` is task I's integration step (see INTEGRATION_C.md).
import { app, BrowserWindow, ipcMain, session, WebContentsView } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GodotWorldViewHost } from "../../vendor/pi-desktop/apps/desktop/electron/main/godot-world-view-host";

const root = process.env.CRAFTMINE_GODOT_ACCEPTANCE_ROOT;
if (!root) throw new Error("CRAFTMINE_GODOT_ACCEPTANCE_ROOT is required");
const allowedRoots = (process.env.CRAFTMINE_GODOT_ALLOWED_ROOTS ?? "").split(";").filter(Boolean);
const guardCounts = { "pointer-lock": 0, "window-focus": 0 };
let window;
let host;
let lastProgressFailure = false;

app.commandLine.appendSwitch("enable-unsafe-swiftshader");
app.commandLine.appendSwitch("use-angle");
app.commandLine.appendSwitch("use-angle=swiftshader");
app.disableHardwareAcceleration();

function send(message) {
  process.send?.(message);
}

function gameView() {
  const children = window?.contentView.children ?? [];
  return children.find((child) => child instanceof WebContentsView && child.webContents.getURL().startsWith("http://127.0.0.1:")) ?? null;
}

async function capture(target, name) {
  if (!/^[a-z0-9-]{1,60}$/.test(name)) throw new Error("Invalid capture name");
  const contents = target === "game" ? gameView()?.webContents : window.webContents;
  if (!contents) throw new Error("Capture surface is not ready");
  const image = await contents.capturePage();
  const file = join(root, name + ".png");
  writeFileSync(file, image.toPNG());
  return { file, width: image.getSize().width, height: image.getSize().height };
}

async function main() {
  mkdirSync(root, { recursive: true });
  // The runtime view uses its own persisted partition. Register the no-input
  // guard before the first world starts so it applies to every game document.
  const ses = session.fromPartition("persist:pi-godot-world", { cache: true });
  ses.registerPreloadScript({ type: "frame", filePath: join(__dirname, "pointer-guard.cjs") });
  ipcMain.on("pi-desktop/godot-world/guard", (_event, kind) => {
    if (kind in guardCounts) guardCounts[kind] += 1;
  });
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);

  window = new BrowserWindow({
    show: false,
    focusable: false,
    width: 1280,
    height: 860,
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await window.loadFile(join(__dirname, "panel.html"));

  host = new GodotWorldViewHost({
    window: () => window,
    allowedRoots: () => allowedRoots,
    onState: (state) => send({ type: "state", state }),
    progress: async (call) => {
      if (lastProgressFailure) return { failed: true, error: "progress store is locked" };
      return {
        receipt: {
          format: "craftmine.progress-receipt/1",
          worldId: call.worldId,
          buildId: call.buildId,
          revision: call.revision + 1,
          contentHash: "harness-" + call.revision,
          persistedAt: Math.floor(Date.now() / 1000),
        },
      };
    },
  });

  window.on("closed", () => {
    window = undefined;
  });
  send({ type: "ready", pid: process.pid });
}

const commands = {
  async open(request) {
    const state = await host.ensure(request);
    if (request.bounds) host.setBounds(request.bounds);
    if (request.visible !== false) host.setVisible(true);
    return { state, instance: host.instance };
  },
  bounds(request) {
    host.setBounds(request.bounds);
    const view = gameView();
    return { instance: host.instance, bounds: view?.getBounds() ?? null, surface: view ? true : false };
  },
  visible(request) {
    host.setVisible(request.visible);
    return { instance: host.instance, attached: !!gameView() };
  },
  async save(request) {
    lastProgressFailure = request?.failProgress === true;
    const result = await host.save({ revision: request?.revision });
    lastProgressFailure = false;
    return { result, state: host.state };
  },
  async snapshot() {
    return { snapshot: await host.snapshot(), state: host.state };
  },
  async request(request) {
    return { result: await host.request(request.op, request.args ?? {}), state: host.state };
  },
  state() {
    return { state: host.state, instance: host.instance, guards: { ...guardCounts }, url: gameView()?.webContents.getURL() ?? null };
  },
  async evaluate(request) {
    const contents = request.target === "game" ? gameView()?.webContents : window?.webContents;
    if (!contents) throw new Error("Evaluate surface is not ready");
    return { value: await contents.executeJavaScript(request.script, false) };
  },
  async capture(request) {
    return capture(request.target, request.name);
  },
  async late(request) {
    // Inject a message that claims another world/instance into the live view.
    const view = gameView();
    if (!view) throw new Error("No game view");
    view.webContents.send("pi-desktop/godot-world/message", request.message);
    return { injected: true };
  },
  async close() {
    await host.close();
    return { state: host.state };
  },
  async quit() {
    await host.close();
    // Reply before quitting: the IPC channel is gone once the app shuts down.
    setImmediate(() => app.quit());
    return { requested: true };
  },
};

app.whenReady().then(main).catch((error) => {
  send({ type: "fatal", error: String(error?.stack ?? error) });
  app.exit(1);
});

process.on("message", (message) => {
  if (message?.type !== "craftmine-godot-acceptance") return;
  const run = commands[message.method];
  const reply = (result) => send({ type: "craftmine-godot-acceptance", id: message.id, result });
  const fail = (error) => send({ type: "craftmine-godot-acceptance", id: message.id, error: String(error?.message ?? error) });
  if (!run) return fail(new Error("Unknown acceptance operation"));
  Promise.resolve(run(message.payload ?? {})).then(reply, fail);
});
