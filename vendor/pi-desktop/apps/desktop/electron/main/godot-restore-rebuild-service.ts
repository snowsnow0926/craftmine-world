import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

type Data = Record<string, any>;
type Options = {
  domain: (method: string, payload: Data) => Promise<any>;
  selection: () => Promise<string | null>;
  /** Private coordinator entry; validates the rebuild plan again before launch. */
  restoreLoad: (worldId: string, candidateId: string) => Promise<unknown>;
};

/** Rebuild disposable exports from restored authoritative content and progress. */
export function createGodotRestoreRebuildService(options: Options) {
  const running = new Map<string, Promise<Data>>();
  const states = new Map<string, Data>();
  const { domain } = options;
  const state = (worldId: string, value: Data) => { const next = { worldId, ...value }; states.set(worldId, next); return next; };
  async function selected(worldId: string) {
    if (await options.selection() !== worldId) throw Error("GODOT_WORLD_CHANGED");
  }
  async function rebuild(worldId: string): Promise<Data> {
    await selected(worldId);
    state(worldId, { status: "restoring", stage: "source" });
    const content = await domain("content.status", { worldId });
    if (content.backend !== "git") await domain("content.migrate.apply", { worldId });
    await domain("godotWorld.prepareRebuildSource", { worldId });
    let plan = await domain("godotWorld.rebuildPlan", { worldId });
    if (!plan.rebuildRequired) {
      await domain("godotRuntime.describe", { worldId });
      return state(worldId, { status: "ready", buildId: plan.formalBuildId, rebuilt: false });
    }
    const before = await domain("world.read", { id: worldId });
    if (!plan.rebuildContentOid) {
      try {
        await domain("content.branch.create", { worldId, branchId: plan.rebuildBranchId,
          fromRev: plan.contentOid, requestId: randomUUID(), taskId: "native-restore-rebuild",
          title: "Rebuild restored formal content" });
      } catch (error) {
        // A lost response or another caller may have created this exact branch.
        // Only the core's tree-validated plan can admit that result.
        const recovered = await domain("godotWorld.rebuildPlan", { worldId });
        if (!recovered.rebuildContentOid) throw error;
      }
      plan = await domain("godotWorld.rebuildPlan", { worldId });
    }
    const id = randomUUID();
    const context = { projectId: "craftmine-restore-rebuild", sessionId: `restore-${id}`, turnId: id };
    await domain("turn.begin", { context, selectedWorld: worldId,
      request: { id, text: "Rebuild the restored formal Godot source while preserving all saved progress and drafts." } });
    let succeeded = false;
    try {
      const project = await domain("godotProject.index", { context, worldId, branchId: plan.rebuildBranchId });
      await selected(worldId);
      const job = await domain("godotBuild.start", { context, worldId, branchId: plan.rebuildBranchId,
        toolCallId: `restore-${id}`, revision: project.revision, manifestHash: project.manifestHash, mode: "check" });
      state(worldId, { status: "restoring", stage: "check", jobId: job.jobId, branchId: plan.rebuildBranchId });
      const deadline = Date.now() + 900_000;
      let checked: Data;
      while (true) {
        checked = await domain("godotBuild.read", { worldId, jobId: job.jobId });
        if (checked.status === "passed") break;
        if (["failed", "blocked", "cancelled", "interrupted"].includes(checked.status)) throw Error(checked.blockedReason || checked.interruptReason || checked.error || `GODOT_REBUILD_${checked.status.toUpperCase()}`);
        if (Date.now() > deadline) throw Error("GODOT_REBUILD_TIMEOUT");
        state(worldId, { status: "restoring", stage: checked.stage || "check", jobId: job.jobId, progress: checked.progress });
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      const raw = await domain("godotCandidate.read", { worldId, candidateId: checked.candidateId });
      const candidate = raw.candidate ?? raw;
      const fresh = await domain("godotWorld.rebuildPlan", { worldId });
      if (!fresh.rebuildRequired || candidate.content?.repoId !== fresh.repoId || candidate.content?.branchId !== fresh.rebuildBranchId || candidate.content?.contentOid !== fresh.rebuildContentOid) throw Error("GODOT_REBUILD_CANDIDATE_MISMATCH");
      const current = await domain("world.read", { id: worldId });
      if (current.revision !== before.revision || !isDeepStrictEqual(current.world, before.world)) throw Error("GODOT_REBUILD_WORLD_CHANGED");
      await selected(worldId);
      state(worldId, { status: "restoring", stage: "confirm", jobId: job.jobId, candidateId: checked.candidateId });
      await options.restoreLoad(worldId, checked.candidateId);
      const descriptor = await domain("godotRuntime.describe", { worldId });
      if (!descriptor || !isDeepStrictEqual(descriptor.snapshot, before.world.snapshot)) throw Error("GODOT_REBUILD_PROGRESS_CHANGED");
      succeeded = true;
      return state(worldId, { status: "ready", rebuilt: true, buildId: descriptor.buildId, candidateId: checked.candidateId, jobId: job.jobId });
    } finally {
      await domain("workspace.endTurn", { sessionId: context.sessionId, turnId: context.turnId, status: succeeded ? "completed" : "error" });
    }
  }
  return {
    get busy() { return running.size > 0; },
    start(worldId: string): Promise<Data> {
      if (typeof worldId !== "string" || !worldId || worldId.length > 128) return Promise.reject(Error("INVALID_WORLD_ID"));
      const existing = running.get(worldId); if (existing) return existing;
      const work = rebuild(worldId).catch(error => { state(worldId, { status: "failed", reason: String(error) }); throw error; }).finally(() => running.delete(worldId));
      running.set(worldId, work); return work;
    },
    status: (worldId: string) => states.get(worldId) ?? null,
    running: (worldId: string) => running.has(worldId),
  };
}
