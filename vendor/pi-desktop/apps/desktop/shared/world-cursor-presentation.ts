/** Host -> isolated world preload. This is presentation, never pointer lock. */
export const WORLD_CURSOR_CHANNEL = "craftmine-world:cursor-presentation";

/** Keep authored cursor styles from overriding the trusted play/pause policy. */
export function attachWorldCursor(target: Window, subscribe: (listener: (hide: boolean) => void) => () => void): () => void {
  let hide = false;
  let focused = target.document.hasFocus();
  let style: HTMLStyleElement | null = null;
  let disposed = false;
  const update = () => {
    if (disposed || !target.document.head) return;
    if (!style) {
      style = target.document.createElement("style");
      style.dataset.craftmineCursor = "trusted";
      target.document.head.append(style);
    }
    const hidden = hide && focused && target.document.hasFocus() && target.document.visibilityState !== "hidden";
    style.textContent = `html, body, canvas { cursor: ${hidden ? "none" : "auto"} !important; }`;
  };
  const focus = () => { focused = target.document.hasFocus(); update(); };
  const blur = () => { focused = false; update(); };
  const off = subscribe(value => { hide = value === true; update(); });
  target.addEventListener("focus", focus);
  target.addEventListener("blur", blur);
  target.document.addEventListener("visibilitychange", focus);
  target.document.addEventListener("DOMContentLoaded", update);
  update();
  return () => {
    disposed = true;
    off();
    target.removeEventListener("focus", focus);
    target.removeEventListener("blur", blur);
    target.document.removeEventListener("visibilitychange", focus);
    target.document.removeEventListener("DOMContentLoaded", update);
    style?.remove();
  };
}
