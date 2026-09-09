import { performance } from "node:perf_hooks";

export type TelemetryMetric = "startup" | "frame" | "modelJob";
export type TelemetrySource = "renderer_document_load" | "desktop_animation_interval" | "agent_turn" | "one_shot_completion";
export type TelemetryOutcome = "completed" | "failed" | "aborted";
type WebContentsLike = {
  isDestroyed(): boolean;
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
  on(event: string, listener: () => void): unknown;
  once(event: string, listener: () => void): unknown;
  removeListener(event: string, listener: () => void): unknown;
};

/** Short observation windows, no input or focus. Hidden documents do not
 * manufacture zero-duration frames. This measures callback cadence, not GPU time. */
export const CRAFTMINE_FRAME_SAMPLE_SCRIPT = `(${function () {
  return new Promise(resolve => {
    const started = performance.now(), intervals: number[] = [];
    let previous: number | undefined, frame = 0, finished = false, hidden = false;
    const finish = () => {
      if (finished) return;
      finished = true; clearTimeout(timer); cancelAnimationFrame(frame);
      resolve({ intervals, elapsedMs: performance.now() - started, hidden });
    };
    const next = (time: number) => {
      if (document.hidden) { hidden = true; finish(); return; }
      if (previous !== undefined && time > previous) intervals.push(time - previous);
      previous = time;
      if (intervals.length >= 120 || performance.now() - started >= 2500) finish();
      else frame = requestAnimationFrame(next);
    };
    const timer = setTimeout(finish, 3000);
    if (document.hidden) { hidden = true; finish(); } else frame = requestAnimationFrame(next);
  });
}.toString()})()`;

export function createCraftmineTelemetry(options: {
  observe(metric: TelemetryMetric, durationMs: number, details: { source: TelemetrySource; outcome?: TelemetryOutcome }): void;
  clock?: () => number;
  processStartedAt?: number;
}) {
  const now = options.clock ?? (() => performance.now());
  const processStartedAt = options.processStartedAt ?? now() - process.uptime() * 1000;
  const jobs = new Map<string, number>(), windows = new Map<WebContentsLike, () => void>();
  const counters = { frameWindows: 0, hiddenFrameWindows: 0, failedFrameWindows: 0, droppedJobStarts: 0, unpairedJobEnds: 0 };
  let startupRecorded = false, disposed = false;
  function observe(metric: TelemetryMetric, elapsed: number, source: TelemetrySource, outcome?: TelemetryOutcome) {
    if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= 3_600_000) options.observe(metric, elapsed, { source, ...(outcome ? { outcome } : {}) });
  }
  function finish(key: string, outcome: TelemetryOutcome) {
    const started = jobs.get(key); if (started === undefined) { counters.unpairedJobEnds++; return; }
    jobs.delete(key); observe("modelJob", now() - started, "agent_turn", outcome);
  }
  return {
    attachWindow(contents: WebContentsLike) {
      if (disposed || windows.has(contents)) return;
      let pending = false, stopped = false;
      const sample = async () => {
        if (pending || stopped || contents.isDestroyed()) return;
        pending = true;
        try {
          const result = await contents.executeJavaScript(CRAFTMINE_FRAME_SAMPLE_SCRIPT, false) as { intervals?: unknown; hidden?: unknown };
          if (stopped || disposed) return;
          if (!result || !Array.isArray(result.intervals) || result.intervals.length > 120 || result.intervals.some(value => typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 3000)) throw Error("INVALID_FRAME_SAMPLE");
          counters.frameWindows++;
          if (result.hidden) counters.hiddenFrameWindows++;
          for (const duration of result.intervals) observe("frame", duration, "desktop_animation_interval");
        } catch { if (!stopped && !disposed) counters.failedFrameWindows++; }
        finally { pending = false; }
      };
      const loaded = () => {
        if (!startupRecorded) { startupRecorded = true; observe("startup", now() - processStartedAt, "renderer_document_load"); }
        void sample();
      };
      const timer = setInterval(() => { void sample(); }, 30_000); timer.unref?.();
      const stop = () => { stopped = true; clearInterval(timer); contents.removeListener("did-finish-load", loaded); contents.removeListener("destroyed", stop); windows.delete(contents); };
      windows.set(contents, stop); contents.on("did-finish-load", loaded); contents.once("destroyed", stop);
    },
    observeAgentEvent(envelope: { sessionId?: unknown; turnId?: unknown; event?: { type?: unknown; [key: string]: unknown } }) {
      if (disposed || typeof envelope.sessionId !== "string" || typeof envelope.turnId !== "string") return;
      const key = JSON.stringify([envelope.sessionId, envelope.turnId]), type = envelope.event?.type;
      if (type === "agent_start") {
        if (jobs.has(key)) return;
        if (jobs.size >= 128) { counters.droppedJobStarts++; return; }
        jobs.set(key, now());
      } else if (type === "agent_end") finish(key, "completed");
      else if (type === "error") finish(key, "failed");
    },
    finishAgentJob(sessionId: string, turnId: string, outcome: TelemetryOutcome) { if (jobs.has(JSON.stringify([sessionId, turnId]))) finish(JSON.stringify([sessionId, turnId]), outcome); },
    async measureCompletion<T>(run: () => Promise<T>): Promise<T> {
      const started = now();
      try { const result = await run(); observe("modelJob", now() - started, "one_shot_completion", "completed"); return result; }
      catch (error) { observe("modelJob", now() - started, "one_shot_completion", "failed"); throw error; }
    },
    status() { return { ...counters, activeAgentJobs: jobs.size, definitions: {
      startup: "Process start to first renderer document load; does not include later world loading.",
      frame: "Desktop requestAnimationFrame callback interval in visible documents; not GPU render duration or a benchmark.",
      modelJob: "Observed host workflow elapsed time; agent turns include tools and network; one-shot completion is separate by source.",
    } }; },
    dispose() { disposed = true; for (const stop of [...windows.values()]) stop(); jobs.clear(); },
  };
}
