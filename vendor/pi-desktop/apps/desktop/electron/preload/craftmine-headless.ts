import { contextBridge } from "electron";
import { installHeadlessInputGuard } from "../shared/craftmine-headless-input";
import { NATIVE_ACCEPTANCE_MARKER, NATIVE_ACCEPTANCE_SOURCE } from "../shared/craftmine-native-acceptance-source.mjs";

contextBridge.executeInMainWorld({ func: installHeadlessInputGuard });
// The isolated preload owns this observer; a renderer-defined global cannot
// enable it. Observe srcdoc before its document loads, including opaque frames
// for which Electron does not run a frame preload. No input or focus is used.
const inject = () => {
  for (const frame of document.querySelectorAll<HTMLIFrameElement>("iframe[srcdoc]")) {
    if (frame.srcdoc.includes(NATIVE_ACCEPTANCE_MARKER))
      frame.srcdoc = frame.srcdoc.replace(NATIVE_ACCEPTANCE_MARKER, "<script>" + NATIVE_ACCEPTANCE_SOURCE + "</script>");
  }
};
const observer = new MutationObserver(inject);
observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["srcdoc"] });
inject();
addEventListener("pagehide", () => observer.disconnect(), { once: true });
