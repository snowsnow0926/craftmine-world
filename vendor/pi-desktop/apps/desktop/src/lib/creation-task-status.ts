export type CreationTaskStatus = {
  worldId: string; selectedWorldId?: string | null; worldTitle?: string; sessionId: string; taskId?: string; jobId?: string; candidateId?: string; buildId?: string; sourceStale?: boolean;
  phase: "idle" | "editing" | "checking" | "ready" | "applying" | "repairing" | "deferred" | "applied" | "historical" | "failed" | "interrupted" | "cancelled" | "recovered";
  laterVersion?: boolean;
  /** Only the host's matching durable automatic-application receipt sets this. */
  automaticallyApplied?: boolean;
  latestRequest?: {turnId:string;taskId:string;status:string};
  resultRequestRelation?: "current-request"|"previous-request"|"unresolved";
  stage?: string; requirementStatus: "not-requested" | "pending" | "passed" | "failed" | "unsupported";
  error?: string; updatedAt?: number;
};
const phases = new Set(["idle", "editing", "checking", "ready", "applying", "repairing", "deferred", "applied", "historical", "failed", "interrupted", "cancelled", "recovered"]);
const requirements = new Set(["not-requested", "pending", "passed", "failed", "unsupported"]);
export function parseCreationTaskStatus(value: unknown, sessionId: string): CreationTaskStatus {
  const data = value as CreationTaskStatus | null;
  if (!data || data.sessionId !== sessionId || typeof data.worldId !== "string" || !phases.has(data.phase)
    || !requirements.has(data.requirementStatus)) throw Error("INVALID_CREATION_TASK_STATUS");
  for(const key of ["jobId","buildId","candidateId","error"] as const)if(data[key]!==undefined&&typeof data[key]!=="string")throw Error("INVALID_CREATION_TASK_STATUS");
  if(data.sourceStale!==undefined&&typeof data.sourceStale!=="boolean")throw Error("INVALID_CREATION_TASK_STATUS");
  if(data.resultRequestRelation!==undefined&&!["current-request","previous-request","unresolved"].includes(data.resultRequestRelation))throw Error("INVALID_CREATION_TASK_STATUS");
  return data;
}
export function creationTaskPending(status: CreationTaskStatus): boolean {
  return ["editing", "checking", "applying", "repairing", "deferred", "recovered"].includes(status.phase);
}
export function creationTaskLabel(status: CreationTaskStatus, chinese: boolean): string {
  const labels = {
    idle: ["", ""], editing: ["正在创作世界", "Creating world"], checking: ["检查中", "Checking"],
    ready: ["检查通过，可以试玩副本", "Checks passed · try the preview"], applying: ["应用中", "Applying"],
    deferred: ["结果已保存 · 等待自动继续", "Result saved · automatic continuation pending"],
    repairing: ["检查未通过 · 正在自动修复", "Check failed · repairing automatically"],
    historical: ["已采用过 · 当前世界使用其他版本", "Previously adopted · another version is active"],
    applied: ["已放入世界，可以试玩", "Added to world · ready to try"], failed: ["需处理", "Needs attention"],
    interrupted: ["需处理 · 任务已中断", "Needs attention · task interrupted"], cancelled: ["已取消", "Cancelled"],
    recovered: ["草稿已恢复 · 继续创作", "Draft recovered · continue creating"],
  };
  let text = labels[status.phase][chinese ? 0 : 1];
  if (["ready", "applied"].includes(status.phase)) {
    if (status.requirementStatus === "failed") text = chinese ? "需处理 · 自动检查项未通过" : "Needs attention · an automated check failed";
    else if (status.sourceStale) text = chinese ? "草稿已更新，请检查最新版本" : "Draft updated · check the latest version";
    else if(status.phase==="ready"&&!status.candidateId)text=chinese?"检查通过 · 暂无试玩副本":"Checks passed · preview unavailable";
  }
  return status.resultRequestRelation==="previous-request"?(chinese?"上次创作结果 · ":"Previous creation · ")+text
    :status.resultRequestRelation==="unresolved"?(chinese?"本轮归属未确认 · ":"Request attribution unconfirmed · ")+text:text;
}

/** A check/application receipt cannot certify actual interaction or playability. */
export function creationTaskEvidence(status: CreationTaskStatus, chinese: boolean): string {
  const check = status.requirementStatus === "passed" ? (chinese ? "自动检查项已通过。" : "Automated checks passed. ")
    : status.requirementStatus === "failed" ? (chinese ? "有自动检查项未通过。" : "Some automated checks failed. ")
    : (chinese ? "尚无通过的自动需求检查记录。" : "No passing automated requirement check is recorded. ");
  return check + (chinese ? "放入世界只确认版本已应用；跟随、导航和其他交互效果需实际试玩确认。"
    : "Adding to the world confirms application only; following, navigation and other interactions need an actual playtest.");
}

export function canUseCreationResult(status: CreationTaskStatus | null, state: {running: boolean; refreshing: boolean; unavailable: boolean}): boolean {
  return !!status && !state.running && !state.refreshing && !state.unavailable && !status.sourceStale
    && ["ready","applied"].includes(status.phase)
    && status.selectedWorldId === status.worldId && !!status.jobId && !!status.buildId
    && status.resultRequestRelation !== "previous-request" && status.resultRequestRelation !== "unresolved";
}

export function creationResultError(raw: string, chinese: boolean): string {
  if (/CREATION_RESULT_(?:STALE|CONTEXT_CHANGED)|CREATION_WORLD_CHANGED|STALE_GENERATION|LEASE_LOST/.test(raw))
    return chinese ? "草稿或目标已变化，请重新读取结果。" : "The draft or target changed. Refresh the result.";
  if (/GODOT_CANDIDATE_ACTIVE|WORLD_BUSY|GODOT_APPLICATION_ACTIVE/.test(raw))
    return chinese ? "世界正在处理其他操作，请稍后重试。" : "The world is busy with another operation. Try again shortly.";
  if (/SAVE_TEMPORARILY_UNAVAILABLE|SAVE_FAILED|DISK_WRITE_FAILED/.test(raw))
    return chinese ? "保存未完成，请查看详情后重试。" : "Saving did not finish. Check the details and retry.";
  return chinese ? "操作未完成，请查看详情后重试。" : "The operation did not finish. Check the details and retry.";
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
