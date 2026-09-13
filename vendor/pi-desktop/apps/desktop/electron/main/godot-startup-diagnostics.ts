import type { WebContents } from "electron";

/** Fixed, read-only probe. It cannot send runtime messages or make ready true. */
const PAGE_PROBE = `new Promise(resolve => {
  const canvas = document.querySelector('canvas');
  const state = {ready:document.readyState, visibility:document.visibilityState,
    canvas:canvas?[canvas.width,canvas.height]:null, raf:false};
  requestAnimationFrame(()=>{state.raf=true;resolve(state)});
  setTimeout(()=>resolve(state),200);
})`;

/** Bounded startup evidence, frozen before the host destroys a failed renderer. */
export function createGodotStartupProbe(contents: WebContents) {
  const started = Date.now();
  let phase = "navigation", paints = 0, stopped = false;
  const paint = () => { paints++; };
  contents.on("paint", paint);
  const dispose = () => {
    if (stopped) return;
    stopped = true;
    try { contents.removeListener("paint", paint); } catch { /* Already destroyed. */ }
  };
  return {
    phase(value: "wait-ready" | "capabilities" | "scene-load" | "pause") { phase = value; },
    dispose,
    async failure(): Promise<string> {
      dispose();
      const fields = [`phase=${phase}`, `elapsedMs=${Date.now()-started}`, `paints=${paints}`];
      try {
        fields.push(`renderer=${contents.getOSProcessId()}`, `offscreen=${contents.isOffscreen()}`,
          `painting=${contents.isPainting()}`, `throttled=${contents.getBackgroundThrottling()}`);
      } catch { fields.push("native=unavailable"); }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const page = await Promise.race([
          contents.executeJavaScript(PAGE_PROBE, false),
          new Promise(resolve => { timer = setTimeout(() => resolve(null), 500); }),
        ]);
        if (!page) fields.push("page=timeout");
        else {
          // The page controls its JS realm. Copy only finite dimensions and
          // known enum/boolean values; never include a URL, status text or token.
          fields.push("page=responded");
          if (["loading", "interactive", "complete"].includes(page.ready)) fields.push(`document=${page.ready}`);
          if (["hidden", "visible"].includes(page.visibility)) fields.push(`visibility=${page.visibility}`);
          if (typeof page.raf === "boolean") fields.push(`raf=${page.raf}`);
          if (Array.isArray(page.canvas) && page.canvas.length === 2 && page.canvas.every((n: unknown) => Number.isSafeInteger(n) && Number(n) >= 0 && Number(n) <= 100000)) fields.push(`canvas=${page.canvas.join("x")}`);
        }
      } catch { fields.push("page=unavailable"); }
      finally { if (timer) clearTimeout(timer); }
      return ` [startup ${fields.join(" ")}]`;
    },
  };
}
