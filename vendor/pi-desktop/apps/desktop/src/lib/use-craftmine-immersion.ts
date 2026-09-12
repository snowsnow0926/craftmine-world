import { useEffect, useState, type RefObject } from "react";
import { isCraftmineWorldWorkspace, loadCraftmineLayout, setCraftmineOverlay, type CraftmineOverlay } from "./craftmine-layout";
import { api } from "./api";
import { applyImmersionKey, immersionKeyAction, immersionShortcutAction } from "./craftmine-immersion-keys";
import { enterCraftmineMode } from "./craftmine-mode";
import { fullscreenEscapeContext } from "../../shared/world-fullscreen-shortcuts";

export function useCraftmineLayout() {
  const [layout, setLayout] = useState(() => loadCraftmineLayout(localStorage));
  useEffect(() => {
    const sync = () => setLayout(loadCraftmineLayout(localStorage));
    window.addEventListener("craftmine-layout-changed", sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener("craftmine-layout-changed", sync); window.removeEventListener("storage", sync); };
  }, []);
  return layout;
}

/** A client presentation only: never activates a window or enters OS fullscreen. */
export function useCraftmineImmersion(page: string, open: boolean, activeTabId: string | null, blocked = false): boolean {
  return useCraftmineLayout().mode === "play" && isCraftmineWorldWorkspace(page, open, activeTabId, blocked);
}

/** Coordinates native geometry/input; CSS cannot cover a WebContentsView. */
export function useCraftmineImmersionSurface(
  active: boolean,
  overlay: CraftmineOverlay,
  blocked: boolean,
  surfaceRef: RefObject<HTMLElement | null>,
  onPause?: () => void,
) {
  const [hostError, setHostError] = useState("");
  useEffect(() => () => {
    void api.craftmineSetImmersion({ active: false, overlay: "closed", overlayBounds: null }).catch(() => undefined);
  }, []);
  useEffect(() => {
    let disposed = false;
    let frame = 0;
    const report = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const surface = surfaceRef.current;
        const rect = active && overlay !== "closed" ? surface?.getBoundingClientRect() : null;
        let overlayBounds = rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
        if (overlayBounds && surface) {
          // Composer pickers can extend above the compact strip. Their actual
          // bounds are included in the host's overlay measurement while visible.
          for (const layer of surface.querySelectorAll('[role="menu"],[role="listbox"],[role="dialog"]')) {
            if (layer.closest('[hidden],[inert],[aria-hidden="true"]') || !layer.getClientRects().length) continue;
            const bounds = layer.getBoundingClientRect();
            const x = Math.min(overlayBounds.x, bounds.x);
            const y = Math.min(overlayBounds.y, bounds.y);
            overlayBounds = { x, y, width: Math.max(overlayBounds.x + overlayBounds.width, bounds.right) - x, height: Math.max(overlayBounds.y + overlayBounds.height, bounds.bottom) - y };
          }
          // Native IPC accepts viewport coordinates only. A tall picker may
          // extend above a short window, but its visible area still blocks it.
          const x = Math.max(0, Math.min(window.innerWidth, overlayBounds.x));
          const y = Math.max(0, Math.min(window.innerHeight, overlayBounds.y));
          overlayBounds = {
            x, y,
            width: Math.max(0, Math.min(window.innerWidth, overlayBounds.x + overlayBounds.width) - x),
            height: Math.max(0, Math.min(window.innerHeight, overlayBounds.y + overlayBounds.height) - y),
          };
        }
        void api.craftmineSetImmersion({
          active,
          overlay,
          overlayBounds,
          blocked,
        }).then(() => { if (!disposed) setHostError(""); }, error => {
          if (!disposed) setHostError(error instanceof Error ? error.message : String(error));
        });
      });
    };
    const observer = new ResizeObserver(report);
    const layers = new MutationObserver(report);
    if (surfaceRef.current) observer.observe(surfaceRef.current);
    if (surfaceRef.current) layers.observe(surfaceRef.current, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "aria-hidden", "style", "class"] });
    window.addEventListener("resize", report);
    report();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      layers.disconnect();
      window.removeEventListener("resize", report);
    };
  }, [active, overlay, blocked, surfaceRef]);

  useEffect(() => {
    if (!active || overlay === "closed" || blocked) return;
    const surface = surfaceRef.current;
    if (!surface) return;
    const focusables = () => Array.from(surface.querySelectorAll<HTMLElement>(
      'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[contenteditable="true"],[tabindex]:not([tabindex="-1"])',
    )).filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0 && !element.closest('[inert],[hidden],[aria-hidden="true"]'));
    const frame = requestAnimationFrame(() => {
      if (!surface.contains(document.activeElement)) {
        const composer = surface.querySelector<HTMLElement>('.composer-input[contenteditable="true"]');
        (composer ?? focusables()[0] ?? surface).focus({ preventScroll: true });
      }
    });
    const contain = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.defaultPrevented) return;
      // Portalled menus and dialogs own their own focus while open.
      if (fullscreenEscapeContext(document, false, surface).overlayOpen) return;
      const elements = focusables();
      const current = elements.indexOf(document.activeElement as HTMLElement);
      if (elements.length === 0) { event.preventDefault(); surface.focus({ preventScroll: true }); }
      else if (event.shiftKey && current <= 0) { event.preventDefault(); elements.at(-1)!.focus({ preventScroll: true }); }
      else if (!event.shiftKey && (current < 0 || current === elements.length - 1)) { event.preventDefault(); elements[0].focus({ preventScroll: true }); }
    };
    window.addEventListener("keydown", contain);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("keydown", contain); };
  }, [active, overlay, blocked, surfaceRef]);

  useEffect(() => {
    if (!active || blocked) return;
    let composing = false;
    const layers = new WeakMap<KeyboardEvent, boolean>();
    // Closed-world Escape opens the application's pause menu. Embedded callers
    // without that menu retain the earlier workbench transition.
    const exitPlay = () => { if (onPause) onPause(); else enterCraftmineMode("create"); };
    const capture = (event: KeyboardEvent) => {
      const context = fullscreenEscapeContext(document, composing, surfaceRef.current);
      const voiceActive = event.key === "Escape" && !!document.querySelector('.voice-input[data-voice-state="starting"],.voice-input[data-voice-state="recording"],.voice-input[data-voice-state="transcribing"]');
      layers.set(event, context.composing || context.overlayOpen || context.editing || context.pointerLocked || voiceActive);
    };
    const bubble = (event: KeyboardEvent) => {
      const next = immersionKeyAction(event, loadCraftmineLayout(localStorage).overlay, composing || layers.get(event) === true);
      if (!applyImmersionKey(next, { setOverlay: setCraftmineOverlay, exitPlay })) return;
      event.preventDefault();
    };
    const begin = () => { composing = true; };
    const end = () => { composing = false; };
    const off = api.onCraftmineImmersionShortcut(action => {
      const context = fullscreenEscapeContext(document, composing, surfaceRef.current);
      if (context.composing || context.overlayOpen || context.editing || context.pointerLocked) return;
      const current = loadCraftmineLayout(localStorage).overlay;
      applyImmersionKey(immersionShortcutAction(action, current), { setOverlay: setCraftmineOverlay, exitPlay });
    });
    window.addEventListener("keydown", capture, true);
    window.addEventListener("keydown", bubble);
    window.addEventListener("compositionstart", begin, true);
    window.addEventListener("compositionend", end, true);
    window.addEventListener("blur", end);
    return () => {
      off();
      window.removeEventListener("keydown", capture, true);
      window.removeEventListener("keydown", bubble);
      window.removeEventListener("compositionstart", begin, true);
      window.removeEventListener("compositionend", end, true);
      window.removeEventListener("blur", end);
    };
  }, [active, blocked, onPause]);
  return hostError;
}
