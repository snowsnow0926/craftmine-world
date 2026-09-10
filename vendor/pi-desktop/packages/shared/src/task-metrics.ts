import type { MessageUsage } from "./types.js";

export type MetricsCoverage = "complete" | "partial" | "unknown";
export type ModelCallObservation = {
  callId: string;
  providerId: string;
  modelId: string;
  source: "agent" | "subagent" | "compaction";
  startedAtMs: number;
  generationStartedAtMs: number | null;
  endedAtMs: number | null;
  outcome: "running" | "completed" | "error" | "aborted";
  usage: MessageUsage | null;
};
export type TaskMetricCounts = { observed: number; reported: number; pending: number };
export type TaskThroughput = {
  value: number | null;
  outputTokens: number | null;
  generationMs: number | null;
  coverage: MetricsCoverage;
  window: "model-generation";
};
export type TaskModelMetrics = {
  providerId: string;
  modelId: string;
  coverage: MetricsCoverage;
  usage: MessageUsage | null;
  calls: TaskMetricCounts;
  tps: TaskThroughput;
};
/** One durable user operation, never a visual bubble or whole-session total. */
export type TaskMetrics = {
  format: "craftmine.task-metrics/1";
  sessionId: string;
  turnId: string;
  status: "running" | "completed" | "error" | "aborted";
  startedAtMs: number;
  endedAtMs: number | null;
  observedAtMs: number;
  wallTimeMs: number | null;
  coverage: MetricsCoverage;
  usage: MessageUsage | null;
  calls: TaskMetricCounts;
  tps: TaskThroughput;
  models: TaskModelMetrics[];
  scope: "root-and-delegates";
  modelIdentity: "runtime-binding";
};
export type TaskMetricsQuery = { sessionId: string; turnId?: string; messageId?: string };
