import type { TaskMetrics } from "./task-metrics.js";

const unknown: TaskMetrics = {
  format: "craftmine.task-metrics/1", sessionId: "fixture-session", turnId: "fixture-turn",
  status: "completed", startedAtMs: 1000, endedAtMs: 6000, observedAtMs: 6000,
  wallTimeMs: 5000, coverage: "unknown", usage: null,
  calls: { observed: 1, reported: 0, pending: 0 },
  tps: { value: null, outputTokens: null, generationMs: null, coverage: "unknown", window: "model-generation" },
  models: [], scope: "root-and-delegates", modelIdentity: "runtime-binding",
};
const complete: TaskMetrics = {
  ...unknown, coverage: "complete", usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
  calls: { observed: 1, reported: 1, pending: 0 },
  tps: { value: 100, outputTokens: 200, generationMs: 2000, coverage: "complete", window: "model-generation" },
  models: [{ providerId: "fixture-provider", modelId: "fixture-model", coverage: "complete",
    usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
    calls: { observed: 1, reported: 1, pending: 0 },
    tps: { value: 100, outputTokens: 200, generationMs: 2000, coverage: "complete", window: "model-generation" } }],
};
/** Authored UI fixtures, never provider usage or native acceptance evidence. */
export const taskMetricsFixtures = {
  complete,
  partial: { ...complete, coverage: "partial", calls: { observed: 2, reported: 1, pending: 0 },
    tps: { ...complete.tps, coverage: "partial" } } satisfies TaskMetrics,
  unknown,
  running: { ...unknown, status: "running", endedAtMs: null, calls: { observed: 1, reported: 0, pending: 1 } } satisfies TaskMetrics,
  aborted: { ...unknown, status: "aborted" } satisfies TaskMetrics,
};
