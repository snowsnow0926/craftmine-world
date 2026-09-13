import { createContext, useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TaskMetrics, TaskMetricsQuery, MessageUsage } from "@pi-desktop/shared";
import { api } from "../lib/api";
import "../styles/task-metrics.css";

const SessionContext = createContext<string | undefined>(undefined);
export const TaskMetricsSession = SessionContext.Provider;

const labels = {
  en: {
    operation: "This operation", tokens: "Total tokens", time: "Task time", model: "Model",
    unknown: "Not reported", partial: "Partial usage", loading: "Reading usage…",
    failed: "Usage could not be read", details: "Usage details", calls: "Reported calls",
    input: "Input", output: "Output", cacheRead: "Cache read", cacheWrite: "Cache write",
    reasoning: "Reasoning", speed: "Output tokens per second of model generation; tool and waiting time are excluded.",
    scope: "Includes the model calls and delegated work in this user operation. Task time includes tools and waits.",
    running: "Running", completed: "Completed", error: "Failed", aborted: "Stopped",
  },
  zh: {
    operation: "本次操作", tokens: "总 Token", time: "任务耗时", model: "模型",
    unknown: "未报告", partial: "部分统计", loading: "正在读取用量…",
    failed: "用量读取失败", details: "用量详情", calls: "已报告调用",
    input: "输入", output: "输出", cacheRead: "缓存读取", cacheWrite: "缓存写入",
    reasoning: "推理", speed: "输出 Token ÷ 对应模型生成秒数；不包含工具和等待时间。",
    scope: "包含本次用户操作的模型调用及子任务；任务耗时包含工具和等待。",
    running: "进行中", completed: "已结束", error: "失败", aborted: "已停止",
  },
};

function count(value: number | null | undefined, language: string, decimals = 0) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? new Intl.NumberFormat(language, { maximumFractionDigits: decimals }).format(value)
    : "—";
}

function duration(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "—";
  const seconds = Math.floor(value / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Presentation only: all totals, model identities and timing come from the host. */
export function TaskMetricsView({ metrics, loading = false, failed = false, codex }: {
  metrics: TaskMetrics | null; loading?: boolean; failed?: boolean;
  codex?: { modelId?: string; usage?: MessageUsage };
}) {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage || i18n.language || "en";
  const text = language.startsWith("zh") ? labels.zh : labels.en;
  const models = metrics?.models ?? [];
  const modelName = codex?.modelId ?? (models.length ? models.map((model) => model.modelId).join(" / ") : text.unknown);
  const coverage = metrics?.coverage ?? "unknown";
  return (
    <section className="task-metrics" aria-label={text.operation} aria-live="off"
      data-task-id={metrics?.turnId} data-task-coverage={coverage}>
      <div className="task-metrics-heading">
        <span>{text.operation}</span>
        <span>{failed ? text.failed : loading && !metrics ? text.loading : metrics ? text[metrics.status] : text.unknown}</span>
        {coverage === "partial" ? <span className="task-metrics-partial">{text.partial}</span> : null}
      </div>
      <dl className="task-metrics-summary">
        <div><dt>{text.tokens}</dt><dd data-metric="tokens">{count(codex ? codex.usage?.totalTokens : metrics?.usage?.totalTokens, language)}</dd></div>
        <div title={text.speed}><dt>TPS</dt><dd data-metric="tps">{count(metrics?.tps.value, language, 1)}{metrics?.tps.coverage === "partial" ? ` (${text.partial})` : ""}</dd></div>
        <div><dt>{text.time}</dt><dd data-metric="time">{duration(metrics?.wallTimeMs)}</dd></div>
        <div className="task-metrics-model"><dt>{text.model}</dt><dd data-metric="model" title={modelName}>{modelName}</dd></div>
      </dl>
      {codex ? <p>Codex CLI · current-turn token totals. Internal request count, generation-only TPS and cost are unavailable.</p> : metrics ? (
        <details className="task-metrics-details">
          <summary>{text.details}</summary>
          <p>{text.scope}</p>
          <p>{text.speed}</p>
          <p>{text.calls}: {metrics.calls.reported}/{metrics.calls.observed}</p>
          {models.map((model) => (
            <div className="task-metrics-model-detail" key={`${model.providerId}\0${model.modelId}`}>
              <strong>{model.providerId} / {model.modelId}</strong>
              <span>{model.coverage === "complete" ? "" : model.coverage === "partial" ? text.partial : text.unknown}</span>
              <dl>
                {([[text.input, model.usage?.inputTokens], [text.output, model.usage?.outputTokens],
                  [text.cacheRead, model.usage?.cacheReadTokens], [text.cacheWrite, model.usage?.cacheWriteTokens],
                  [text.reasoning, model.usage?.reasoningTokens]] as const).map(([label, value]) => (
                  <div key={label}><dt>{label}</dt><dd>{count(value, language)}</dd></div>
                ))}
                <div><dt>TPS</dt><dd>{count(model.tps.value, language, 1)}</dd></div>
              </dl>
            </div>
          ))}
        </details>
      ) : null}
    </section>
  );
}

type Snapshot = { key: string; metrics: TaskMetrics | null; loading: boolean; failed: boolean };
export function TaskMetricsPanel({ messageId, running, read = api.getTaskMetrics, codex }: {
  messageId: string | undefined; running: boolean;
  read?: (query: TaskMetricsQuery) => Promise<TaskMetrics | null>;
  codex?: { modelId?: string; usage?: MessageUsage };
}) {
  const sessionId = useContext(SessionContext);
  const key = `${sessionId ?? ""}\0${messageId ?? ""}`;
  const [snapshot, setSnapshot] = useState<Snapshot>({ key, metrics: null, loading: true, failed: false });
  useEffect(() => {
    if (!sessionId || !messageId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let finalReads = 0;
    setSnapshot((previous) => previous.key === key
      ? { ...previous, loading: true, failed: false }
      : { key, metrics: null, loading: true, failed: false });
    const refresh = async () => {
      let unsettled = true;
      try {
        const metrics = await read({ sessionId, messageId });
        if (disposed) return;
        if (metrics && (metrics.format !== "craftmine.task-metrics/1" || metrics.sessionId !== sessionId)) {
          throw new Error("Task metrics identity mismatch");
        }
        unsettled = !metrics || metrics.status === "running";
        setSnapshot({ key, metrics, loading: false, failed: false });
      } catch {
        if (disposed) return;
        setSnapshot({ key, metrics: null, loading: false, failed: true });
      }
      // A stopped renderer can precede the durable end-turn write. Retry a
      // bounded number of times; never overlap reads or keep polling history.
      if (!disposed && (running || (unsettled && ++finalReads < 5))) timer = setTimeout(refresh, 1000);
    };
    void refresh();
    return () => { disposed = true; clearTimeout(timer); };
  }, [sessionId, messageId, key, running, read]);
  if (!sessionId || !messageId) return null;
  const visible = snapshot.key === key ? snapshot : { metrics: null, loading: true, failed: false };
  return <TaskMetricsView metrics={visible.metrics} loading={visible.loading} failed={visible.failed} codex={codex} />;
}
