import type { CraftmineImmersionState, CraftmineImmersionBounds, CraftmineImmersionShortcut } from "@pi-desktop/shared";
import type { NativeFullscreenInput } from "./world-fullscreen-shortcuts";

export const IMMERSION_INPUT_CHANNEL = "craftmine-world:immersion-input";
export const NO_IMMERSION: CraftmineImmersionState = { active: false, overlay: "closed", overlayBounds: null };

export function parseImmersion(value: unknown): CraftmineImmersionState {
  if (!value || typeof value !== "object") throw new Error("Invalid immersion state");
  const input = value as CraftmineImmersionState;
  if (input.blocked !== undefined && typeof input.blocked !== "boolean") throw new Error("Invalid immersion block state");
  if (input.covered !== undefined && typeof input.covered !== "boolean") throw new Error("Invalid immersion cover state");
  if (typeof input.active !== "boolean" || !["closed", "compact", "full"].includes(input.overlay)) throw new Error("Invalid immersion state");
  const rect = input.overlayBounds;
  if (rect !== null && (!rect || ![rect.x, rect.y, rect.width, rect.height].every(n => Number.isFinite(n) && n >= 0 && n <= 100000))) throw new Error("Invalid immersion bounds");
  return { active: input.active, blocked:input.blocked === true, covered:input.covered === true, overlay: input.overlay, overlayBounds: rect ? {x:rect.x,y:rect.y,width:rect.width,height:rect.height} : null };
}

export const immersionBlocksInput = (state: CraftmineImmersionState): boolean => state.covered === true || (state.active && (state.blocked === true || state.overlay !== "closed"));

/** Immersion is composited above the complete world, never a layout reservation. */
export function excludeImmersion(bounds: CraftmineImmersionBounds, _state: CraftmineImmersionState): CraftmineImmersionBounds {
  return bounds;
}

export function immersionShortcut(input: NativeFullscreenInput, overlayOpen: boolean): CraftmineImmersionShortcut | null {
  if (input.type !== "keyDown" || input.isAutoRepeat || input.isComposing || input.keyCode === 229 || input.alt || input.control || input.meta) return null;
  if (input.key === "F2") return input.shift ? "full" : "compact";
  // Escape layers outward: an open overlay closes first, and only a closed one
  // returns to the workbench, before any later Escape leaves OS fullscreen.
  if (input.key === "Escape" && !input.shift) return overlayOpen ? "escape" : "exit-play";
  return null;
}

/** No outbound capabilities: only suppress gameplay input while chat owns it. */
export function attachImmersionInput(target: Window, subscribe: (listener: (blocked: boolean) => void) => () => void, options: {gameFramesOnly?:boolean} = {}): () => void {
  let blocked = false;
  const frames = new Map<HTMLIFrameElement, {inert:boolean; pointerEvents:string}>();
  const updateFrames = () => {
    if (blocked) {
      for (const frame of target.document.querySelectorAll("iframe")) {
        if (!frames.has(frame)) frames.set(frame, {inert:frame.inert, pointerEvents:frame.style.pointerEvents});
        frame.inert = true; frame.style.pointerEvents = "none";
      }
    } else {
      for (const [frame, previous] of frames) { frame.inert = previous.inert; frame.style.pointerEvents = previous.pointerEvents; }
      frames.clear();
    }
  };
  const observer = new MutationObserver(updateFrames);
  observer.observe(target.document, {childList:true, subtree:true});
  const stop = (event: Event) => {
    if (!blocked || options.gameFramesOnly) return;
    // Release events still reach the engine so held movement cannot get stuck.
    if (event.type === "keyup" || event.type === "pointerup" || event.type === "mouseup") return;
    event.preventDefault(); event.stopImmediatePropagation();
  };
  const events = ["keydown", "pointerdown", "mousedown", "pointermove", "mousemove", "wheel", "touchstart", "touchmove", "click", "contextmenu"];
  for (const name of events) target.addEventListener(name, stop, {capture:true, passive:false});
  const off = subscribe(value => {
    blocked = value === true;
    updateFrames();
    if (blocked && target.document.pointerLockElement) target.document.exitPointerLock();
  });
  return () => { off(); observer.disconnect(); blocked = false; updateFrames(); for (const name of events) target.removeEventListener(name, stop, true); };
}
