export type CreationTaskStatus = {
  worldId: string; selectedWorldId?: string | null; worldTitle?: string; sessionId: string; taskId?: string; jobId?: string; candidateId?: string; buildId?: string; sourceStale?: boolean;
  phase: "idle" | "editing" | "checking" | "ready" | "applying" | "repairing" | "deferred" | "applied" | "historical" | "failed" | "interrupted" | "cancelled" | "recovered";
  laterVersion?: boolean;
  /** Only the host's matching durable automatic-application receipt sets this. */
  automaticallyApplied?: boolean;
  stage?: string; requirementStatus: "not-requested" | "pending" | "passed" | "failed" | "unsupported";
  error?: string; updatedAt?: number;
};
const phases = new Set(["idle", "editing", "checking", "ready", "applying", "repairing", "deferred", "applied", "historical", "failed", "interrupted", "cancelled", "recovered"]);
const requirements = new Set(["not-requested", "pending", "passed", "failed", "unsupported"]);
export function parseCreationTaskStatus(value: unknown, sessionId: string): CreationTaskStatus {
  const data = value as CreationTaskStatus | null;
  if (!data || data.sessionId !== sessionId || typeof data.worldId !== "string" || !phases.has(data.phase)
    || !requirements.has(data.requirementStatus)) throw Error("INVALID_CREATION_TASK_STATUS");
  return data;
}
export function creationTaskPending(status: CreationTaskStatus): boolean {
  return ["editing", "checking", "applying", "repairing", "deferred", "recovered"].includes(status.phase);
}
export function creationTaskLabel(status: CreationTaskStatus, chinese: boolean): string {
  const labels = {
    idle: ["", ""], editing: ["正在修改世界", "Editing world"], checking: ["正在检查", "Checking"],
    ready: ["检查完成 · 待采用", "Checked · awaiting adoption"], applying: ["正在采用", "Applying"],
    deferred: ["结果已保存 · 等待自动继续", "Result saved · automatic continuation pending"],
    repairing: ["检查未通过 · 正在自动修复", "Check failed · repairing automatically"],
    historical: ["已采用过 · 当前世界使用其他版本", "Previously adopted · another version is active"],
    applied: ["已采用", "Applied"], failed: ["未完成 · 查看原因", "Failed · view details"],
    interrupted: ["已中断 · 草稿可恢复", "Interrupted · draft recoverable"], cancelled: ["已取消", "Cancelled"],
    recovered: ["草稿已恢复 · 继续创作", "Draft recovered · continue creating"],
  };
  let text = labels[status.phase][chinese ? 0 : 1];
  if (["ready", "applied"].includes(status.phase)) {
    if (status.requirementStatus === "passed") text += chinese ? " · 愿望检查通过" : " · requirements verified";
    else if (status.requirementStatus === "failed") text += chinese ? " · 愿望检查未通过" : " · requirements failed";
    else text += chinese ? " · 愿望结果待验证" : " · requirements unverified";
  }
  return text;
}

/** One mounted observer; persisted host facts remain recoverable across late checks and restarts. */
export class CreationTaskStatusObserver {
  private disposed = false;
  private epoch = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private unchanged = 0;
  private fingerprint = "";
  private read: () => Promise<CreationTaskStatus>;
  private publish: (status: CreationTaskStatus | null, unavailable: boolean) => void;
  private awaitingTask: boolean;
  constructor(read: () => Promise<CreationTaskStatus>, publish: (status: CreationTaskStatus | null, unavailable: boolean) => void, awaitingTask = false) {
    this.read = read; this.publish = publish; this.awaitingTask = awaitingTask;
  }
  async refresh() {
    if (this.disposed) return;
    clearTimeout(this.timer);
    const epoch = ++this.epoch;
    try {
      const status = await this.read();
      if (this.disposed || epoch !== this.epoch) return;
      const fingerprint = JSON.stringify(status);
      this.unchanged = this.fingerprint === fingerprint ? this.unchanged + 1 : 0;
      this.fingerprint = fingerprint;
      this.publish(status, false);
      if (creationTaskPending(status) || this.awaitingTask || status.phase === "idle" || status.phase === "ready") {
        this.timer = setTimeout(() => void this.refresh(), this.unchanged < 3 ? 2000 : this.unchanged < 8 ? 5000 : 10000);
      }
    } catch {
      if (!this.disposed && epoch === this.epoch) {
        this.publish(null, true);
        this.timer = setTimeout(() => void this.refresh(), 5000);
      }
    }
  }
  dispose() { this.disposed = true; ++this.epoch; clearTimeout(this.timer); }
}
