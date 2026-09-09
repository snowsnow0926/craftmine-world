import { createHash } from "node:crypto";
import { arch, platform, release } from "node:os";
import { desktopServiceError, writeSelectedFile, type CraftmineFilePicker } from "./craftmine-backup-service";

type Metric = "startup" | "frame" | "modelJob";
const safeCode = (value: unknown) => typeof value === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(value) ? value : undefined;
const safeHash = (value: unknown) => typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value) ? value : undefined;
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
const plain = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};

/** Build diagnostics from allowlisted fields, never redact an unbounded copy
 * of logs, chat, provider configuration or world source after the fact. */
export function createCraftmineDiagnosticsService(options: { pickFile: CraftmineFilePicker; snapshot: () => Promise<unknown>; now?: () => number }) {
  const metrics: Record<Metric, number[]> = { startup: [], frame: [], modelJob: [] };
  const receipts = new Map<string, Record<string, unknown>>();
  async function status() {
    const input = plain(await options.snapshot()), build = plain(input.build), task = plain(input.task), credentials = plain(input.credentials);
    const summary = Object.fromEntries(Object.entries(metrics).map(([key, values]) => {
      const ordered = [...values].sort((a, b) => a - b);
      return [key, { samples: ordered.length, ...(ordered.length ? { p50Ms: ordered[Math.floor((ordered.length - 1) * .5)], p95Ms: ordered[Math.floor((ordered.length - 1) * .95)] } : {}) }];
    }));
    return { format: "craftmine.diagnostics/1", scope: "sanitized", createdAt: new Date((options.now ?? Date.now)()).toISOString(),
      product: "craftmine world / 最中幻想", build: { version: typeof build.version === "string" && /^[0-9][a-zA-Z0-9.+-]{0,39}$/.test(build.version) ? build.version : undefined, commit: safeHash(build.commit), sourceHash: safeHash(build.sourceHash), packageHash: safeHash(build.packageHash) },
      environment: { platform: platform(), arch: arch(), release: release(), node: process.versions.node, electron: process.versions.electron },
      metrics: { ...summary, mainProcessRssBytes: process.memoryUsage().rss },
      task: { status: ["running", "finished", "cancelled", "interrupted", "failed", "idle"].includes(task.status) ? task.status : "unknown", requestCount: number(task.requestCount), compactionCount: number(task.compactionCount), errorCode: safeCode(task.errorCode) },
      credentials: { status: ["protected", "fallback", "unavailable"].includes(credentials.status) ? credentials.status : "unavailable" },
      exclusions: ["credentials", "chat", "personalPaths", "worldSource", "rawLogs", "providerConfiguration"],
    };
  }
  return {
    observe(metric: Metric, durationMs: number) {
      if (!(metric in metrics) || !Number.isFinite(durationMs) || durationMs < 0 || durationMs > 3_600_000) throw desktopServiceError("INVALID_METRIC");
      metrics[metric].push(durationMs); if (metrics[metric].length > 200) metrics[metric].shift();
    },
    async request(channel: string, input: Record<string, unknown> = {}) {
      if (!input || Array.isArray(input) || Object.keys(input).some(key => key !== "operationId")) throw desktopServiceError("INVALID_PARAMS");
      if (channel === "diagnostics.status") return status();
      if (channel !== "diagnostics.export") throw desktopServiceError("UNKNOWN_DIAGNOSTICS_CHANNEL");
      const operationId = input.operationId;
      if (typeof operationId !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(operationId)) throw desktopServiceError("INVALID_OPERATION_ID");
      if (receipts.has(operationId)) return receipts.get(operationId);
      if (receipts.size >= 32) throw desktopServiceError("DIAGNOSTICS_EXPORT_LIMIT");
      const selected = await options.pickFile({ kind: "save-diagnostics", suggestedName: "Craftmine-World-diagnostics.json" });
      if (!selected) return { status: "cancelled", operationId };
      const bytes = Buffer.from(JSON.stringify(await status(), null, 2));
      await writeSelectedFile(selected, bytes);
      const receipt = { status: "completed", operationId, bytes: bytes.length, hash: createHash("sha256").update(bytes).digest("hex"), scope: "sanitized" };
      receipts.set(operationId, receipt); return receipt;
    },
  };
}
