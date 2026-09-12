import { BaseWindow, WebContentsView, type BrowserWindowConstructorOptions, type WebContents } from "electron";
import { registerMainLayers, syncMainInputFocus } from "./main-window-layers";
import { guardHeadlessWindow, isHeadlessAcceptance } from "./craftmine-headless";

/** Native owner and the one stable application renderer; popup windows remain BrowserWindows. */
export type MainWindow = BaseWindow & {
  readonly webContents: WebContents;
  loadURL: WebContents["loadURL"];
  loadFile: WebContents["loadFile"];
};

/**
 * BrowserWindow's private renderer is always underneath contentView. Owning all
 * sibling views explicitly lets chat cover a full-size world without clipping,
 * reloading its renderer, copying pixels, or weakening either preload boundary.
 */
export function createMainWindow(options: BrowserWindowConstructorOptions): MainWindow {
  const { webPreferences, ...nativeOptions } = options;
  const window = new BaseWindow(nativeOptions);
  const renderer = new WebContentsView({webPreferences});
  renderer.setBackgroundColor("#00000000");
  window.contentView.addChildView(renderer);
  const contents = renderer.webContents;
  const owner: MainWindow = Object.assign(window, {
    webContents: contents,
    loadURL: contents.loadURL.bind(contents),
    loadFile: contents.loadFile.bind(contents),
  });
  registerMainLayers(owner, renderer, {headless: isHeadlessAcceptance()});
  guardHeadlessWindow(owner);
  const resize = () => {
    if (owner.isDestroyed() || contents.isDestroyed()) return;
    const [width, height] = owner.getContentSize();
    renderer.setBounds({x: 0, y: 0, width, height});
  };
  resize();
  owner.on("resize", resize);
  // BaseWindow does not own child WebContents lifetime. Close explicitly so a
  // renderer/preload cannot remain alive after its native owner has disappeared.
  owner.on("closed", () => {
    owner.removeListener("resize", resize);
    if (!contents.isDestroyed()) contents.close({waitForBeforeUnload: false});
  });
  contents.once("destroyed", () => { if (!owner.isDestroyed()) owner.destroy(); });
  owner.on("focus", () => {
    syncMainInputFocus(owner, "window-focus");
  });
  return owner;
}
