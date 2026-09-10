import { useEffect, useState, type RefObject } from "react";
import { isCraftmineWorldWorkspace, loadCraftmineLayout, setCraftmineOverlay, toggleCraftmineOverlay, type CraftmineOverlay } from "./craftmine-layout";
import { api } from "./api";
import { immersionKeyAction } from "./craftmine-immersion-keys";
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

/** A layout preference only: never activates a window or enters OS fullscreen. */
export function useCraftmineImmersion(page: string, open: boolean, activeTabId: string | null, blocked = false): boolean {
  return useCraftmineLayout().mode === "play" && isCraftmineWorldWorkspace(page, open, activeTabId, blocked);
}

/** Coordinates native geometry/input; CSS cannot cover a WebContentsView. */
export function useCraftmineImmersionSurface(
  active: boolean,
  overlay: CraftmineOverlay,
  blocked: boolean,
  surfaceRef: RefObject<HTMLElement | null>,
) {
  const [hostError, setHostError] = useState("");
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
          // bounds are part of the native exclusion rectangle while visible.
          for (const layer of surface.querySelectorAll('[role="menu"],[role="listbox"],[role="dialog"]')) {
            if (layer.closest('[hidden],[inert],[aria-hidden="true"]') || !layer.getClientRects().length) continue;
            const bounds = layer.getBoundingClientRect();
            const x = Math.min(overlayBounds.x, bounds.x);
            const y = Math.min(overlayBounds.y, bounds.y);
            overlayBounds = { x, y, width: Math.max(overlayBounds.x + overlayBounds.width, bounds.right) - x, height: Math.max(overlayBounds.y + overlayBounds.height, bounds.bottom) - y };
          }
        }
        void api.craftmineSetImmersion({
          active: active && !blocked,
          overlay,
          overlayBounds,
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
      void api.craftmineSetImmersion({ active: false, overlay: "closed", overlayBounds: null }).catch(() => undefined);
    };
  }, [active, overlay, blocked, surfaceRef]);

  useEffect(() => {
    if (!active || blocked) return;
    let composing = false;
    const layers = new WeakMap<KeyboardEvent, boolean>();
    const capture = (event: KeyboardEvent) => {
      const context = fullscreenEscapeContext(document, composing);
      layers.set(event, context.composing || context.overlayOpen || context.editing || context.pointerLocked);
    };
    const bubble = (event: KeyboardEvent) => {
      const next = immersionKeyAction(event, loadCraftmineLayout(localStorage).overlay, composing || layers.get(event) === true);
      if (next === null) return;
      event.preventDefault();
      setCraftmineOverlay(next);
    };
    const begin = () => { composing = true; };
    const end = () => { composing = false; };
    const off = api.onCraftmineImmersionShortcut(action => {
      const context = fullscreenEscapeContext(document, composing);
      if (context.composing || context.overlayOpen || context.editing || context.pointerLocked) return;
      const current = loadCraftmineLayout(localStorage).overlay;
      setCraftmineOverlay(action === "escape" ? "closed" : toggleCraftmineOverlay(current, action));
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
  }, [active, blocked]);
  return hostError;
}
