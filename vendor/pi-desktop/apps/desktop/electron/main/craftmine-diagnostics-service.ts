import { createHash } from "node:crypto";
import { arch, platform, release } from "node:os";
import { desktopServiceError, writeSelectedFile, type CraftmineFilePicker } from "./craftmine-backup-service";
import type { TelemetrySource, TelemetryOutcome } from "./craftmine-telemetry";

type Metric = "startup" | "frame" | "modelJob";
const safeCode = (value: unknown) => typeof value === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(value) ? value : undefined;
const safeHash = (value: unknown) => typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value) ? value : undefined;
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
const plain = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};

/** Build diagnostics from allowlisted fields, never redact an unbounded copy
 * of logs, chat, provider configuration or world source after the fact. */
export function createCraftmineDiagnosticsService(options: { pickFile: CraftmineFilePicker; snapshot: () => Promise<unknown>; now?: () => number }) {
  const metrics: Record<Metric, Array<{ duration: number; source?: TelemetrySource; outcome?: TelemetryOutcome }>> = { startup: [], frame: [], modelJob: [] };
  const receipts = new Map<string, Record<string, unknown>>();
  const pending = new Map<string, Promise<Record<string, unknown>>>();
  async function status() {
    const input = plain(await options.snapshot()), build = plain(input.build), task = plain(input.task), credentials = plain(input.credentials), telemetry = plain(input.telemetry);
    const summary = Object.fromEntries(Object.entries(metrics).map(([key, values]) => {
      const summarize = (items: typeof values) => {
        const ordered = items.map(item => item.duration).sort((a, b) => a - b);
        return { samples: ordered.length, ...(ordered.length ? { p50Ms: ordered[Math.floor((ordered.length - 1) * .5)], p95Ms: ordered[Math.floor((ordered.length - 1) * .95)] } : {}) };
      };
      const sources = [...new Set(values.map(item => item.source).filter(Boolean))];
      return [key, { ...summarize(values), bySource: Object.fromEntries(sources.map(source => [source, summarize(values.filter(item => item.source === source))])), outcomes: Object.fromEntries(["completed", "failed", "aborted"].map(outcome => [outcome, values.filter(item => item.outcome === outcome).length])) }];
    }));
    return { format: "craftmine.diagnostics/1", scope: "sanitized", createdAt: new Date((options.now ?? Date.now)()).toISOString(),
      product: "craftmine world / 最中幻想", build: { version: typeof build.version === "string" && /^[0-9][a-zA-Z0-9.+-]{0,39}$/.test(build.version) ? build.version : undefined, commit: safeHash(build.commit), sourceHash: safeHash(build.sourceHash), packageHash: safeHash(build.packageHash), manifestHash: safeHash(build.manifestHash) },
      environment: { platform: platform(), arch: arch(), release: release(), node: process.versions.node, electron: process.versions.electron },
      metrics: { ...summary, mainProcessRssBytes: process.memoryUsage().rss, boundedWindowSamples: 200,
        definitions: { startup: "process start to first renderer document load", frame: "visible desktop animation callback interval; not GPU time", modelJob: "host workflow elapsed time; see bySource; agent_turn includes tools/network" },
        sampling: Object.fromEntries(["frameWindows", "hiddenFrameWindows", "failedFrameWindows", "droppedJobStarts", "unpairedJobEnds", "activeAgentJobs"].map(key => [key, number(telemetry[key])])) },
      task: { status: ["running", "finished", "cancelled", "interrupted", "failed", "idle"].includes(task.status) ? task.status : "unknown", requestCount: number(task.requestCount), compactionCount: number(task.compactionCount), errorCode: safeCode(task.errorCode) },
      credentials: { status: ["protected", "fallback", "unavailable"].includes(credentials.status) ? credentials.status : "unavailable" },
      exclusions: ["credentials", "chat", "personalPaths", "worldSource", "rawLogs", "providerConfiguration"],
    };
  }
  return {
    observe(metric: Metric, durationMs: number, details: { source?: TelemetrySource; outcome?: TelemetryOutcome } = {}) {
      if (!Object.hasOwn(metrics, metric) || !Number.isFinite(durationMs) || durationMs < 0 || durationMs > 3_600_000) throw desktopServiceError("INVALID_METRIC");
      if (details.source && !["renderer_document_load", "desktop_animation_interval", "agent_turn", "one_shot_completion"].includes(details.source) || details.outcome && !["completed", "failed", "aborted"].includes(details.outcome)) throw desktopServiceError("INVALID_METRIC_SOURCE");
      metrics[metric].push({ duration: durationMs, ...details }); if (metrics[metric].length > 200) metrics[metric].shift();
    },
    async request(channel: string, input: Record<string, unknown> = {}) {
      try {
      if (!input || Array.isArray(input) || Object.keys(input).some(key => key !== "operationId")) throw desktopServiceError("INVALID_PARAMS");
      if (channel === "diagnostics.status") return await status();
      if (channel !== "diagnostics.export") throw desktopServiceError("UNKNOWN_DIAGNOSTICS_CHANNEL");
      const operationId = input.operationId;
      if (typeof operationId !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(operationId)) throw desktopServiceError("INVALID_OPERATION_ID");
      if (receipts.has(operationId)) return receipts.get(operationId);
      if (pending.has(operationId)) return await pending.get(operationId);
      if (receipts.size >= 32) throw desktopServiceError("DIAGNOSTICS_EXPORT_LIMIT");
      const run = (async () => {
      const selected = await options.pickFile({ kind: "save-diagnostics", suggestedName: "Craftmine-World-diagnostics.json" });
      if (!selected) return { status: "cancelled", operationId };
      const bytes = Buffer.from(JSON.stringify(await status(), null, 2));
      await writeSelectedFile(selected, bytes);
      const receipt = { status: "completed", operationId, bytes: bytes.length, hash: createHash("sha256").update(bytes).digest("hex"), scope: "sanitized" };
      receipts.set(operationId, receipt); return receipt;
      })();
      pending.set(operationId, run);
      try { return await run; } finally { pending.delete(operationId); }
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        throw desktopServiceError(typeof code === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : "DIAGNOSTICS_OPERATION_FAILED");
      }
    },
  };
}
