/** Serialized into a page's main world before application or game scripts. */
export function installHeadlessInputGuard(): void {
  const page = globalThis as typeof globalThis & { __craftmineHeadless?: { pointerLock: number; focus: number } };
  if (page.__craftmineHeadless) return;
  const calls = { pointerLock: 0, focus: 0 };
  Object.defineProperty(page, "__craftmineHeadless", { value: calls, configurable: false, writable: false });
  Object.defineProperty(Element.prototype, "requestPointerLock", { configurable: false, writable: false, value: () => {
    calls.pointerLock++;
    throw new Error("Pointer lock is disabled in headless acceptance");
  } });
  Object.defineProperty(window, "focus", { configurable: false, writable: false, value: () => {
    calls.focus++;
    throw new Error("Window focus is disabled in headless acceptance");
  } });
}
