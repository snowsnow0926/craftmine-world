import { randomUUID } from "node:crypto";

type Data = Record<string, any>;
type Domain = (method: string, params: Data) => Promise<any>;
const channels: Record<string, string[]> = {
  "godot.historyLoad": ["worldId", "branchId", "skip", "offset"],
  "godot.historyCreateBranch": ["worldId", "branchId", "fromOid"],
  "godot.historyReadSource": ["worldId", "branchId", "revision", "manifestHash", "path"],
  "godot.historySaveSource": ["worldId", "branchId", "revision", "manifestHash", "path", "expectedHash", "text"],
  "godot.historyCheck": ["worldId", "branchId", "revision", "manifestHash"],
  "godot.historyJob": ["worldId", "jobId"],
};
const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const oid = (value: unknown) => typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
const page = (value: unknown) => value == null ? 0 : Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : (() => { throw Error("INVALID_HISTORY_PAGE"); })();

/** Main-window only facade. The host owns task identity and source CAS context. */
export function createGodotHistoryPanelService(options: { domain: Domain; selection: () => Promise<string | null> }) {
  const { domain } = options;
  const busy = new Set<string>();
  async function selected(worldId: string) {
    if (await options.selection() !== worldId) throw Error("GODOT_WORLD_CHANGED");
  }
  async function task<T>(worldId: string, run: (context: Data) => Promise<T>): Promise<T> {
    const id = randomUUID();
    const context = { projectId: "craftmine-history-panel", sessionId: `history-${id}`, turnId: id };
    await selected(worldId);
    await domain("turn.begin", { context, selectedWorld: worldId, request: { id, text: "Manage the selected world's creation branch from the history panel." } });
    let succeeded = false;
    try { const result = await run(context); succeeded = true; return result; }
    finally { await domain("workspace.endTurn", { sessionId: context.sessionId, turnId: context.turnId, status: succeeded ? "completed" : "error" }); }
  }
  return {
    async invoke(channel: string, payload: Data): Promise<any> {
      const fields = channels[channel];
      if (!fields || !payload || Object.keys(payload).some(key => !fields.includes(key))) throw Error("INVALID_HISTORY_ACTION");
      const worldId = payload.worldId;
      if (typeof worldId !== "string" || !worldId || worldId.length > 128) throw Error("INVALID_WORLD_ID");
      await selected(worldId);
      if (channel === "godot.historyJob") {
        if (typeof payload.jobId !== "string" || payload.jobId.length > 128) throw Error("INVALID_GODOT_JOB");
        const job = await domain("godotBuild.read", { worldId, jobId: payload.jobId });
        await selected(worldId);
        return job;
      }
      const branchId = payload.branchId ?? "main";
      if (typeof branchId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(branchId)) throw Error("INVALID_BRANCH_ID");
      const mutation = ["godot.historyCreateBranch", "godot.historySaveSource", "godot.historyCheck"].includes(channel);
      if (mutation && busy.has(worldId)) throw Error("WORLD_BUSY");
      if (mutation) busy.add(worldId);
      try {
        const status = await domain("content.status", { worldId });
        if (status.backend !== "git") throw Error("GODOT_HISTORY_REQUIRES_GIT");
        const branches = (status.branches ?? []).map((branch: Data) => ({ branchId: String(branch.name).replace(/^refs\/heads\//, ""), headOid: branch.oid }));
        if (channel === "godot.historyCreateBranch") {
          if (!oid(payload.fromOid)) throw Error("INVALID_CONTENT_OID");
          await selected(worldId);
          return domain("content.branch.create", { worldId, branchId, fromRev: payload.fromOid,
            requestId: randomUUID(), taskId: "native-history-panel", title: `Create ${branchId}` });
        }
        const branch = branches.find((item: Data) => item.branchId === branchId);
        if (!branch) throw Error("CONTENT_BRANCH_NOT_FOUND");
        if (channel === "godot.historyLoad") {
          return task(worldId, async context => {
            const index = await domain("godotProject.index", { context, worldId, branchId, offset: page(payload.offset), limit: 32 });
            index.offset = page(payload.offset);
            const history = await domain("content.history", { worldId, rev: branch.headOid, skip: page(payload.skip), limit: 20 });
            const fresh = await domain("content.status", { worldId });
            if (!(fresh.branches ?? []).some((item: Data) => item.name === `refs/heads/${branchId}` && item.oid === branch.headOid)) throw Error("GODOT_SOURCE_STALE");
            await selected(worldId);
            // Never expose the private gitDir from content.status to a renderer.
            return { worldId, branchId, repoId: status.repoId, appliedOid: status.appliedOid, headOid: branch.headOid, branches, index, history };
          });
        }
        if (!Number.isSafeInteger(payload.revision) || !hash(payload.manifestHash)) throw Error("INVALID_SOURCE_REVISION");
        return await task(worldId, async context => {
          const identity = { context, worldId, branchId, revision: payload.revision, manifestHash: payload.manifestHash };
          if (channel === "godot.historyReadSource") {
            if (typeof payload.path !== "string") throw Error("INVALID_SOURCE_PATH");
            const result = await domain("godotProject.read", { ...identity, path: payload.path, offset: 0, limit: 16000 });
            await selected(worldId);
            return result;
          }
          // Both save and check retain the renderer's exact source revision;
          // they cannot silently build newer bytes after a concurrent write.
          await selected(worldId);
          const toolCallId = `history-${randomUUID()}`;
          if (channel === "godot.historyCheck") return domain("godotBuild.start", { ...identity, toolCallId, mode: "check" });
          if (typeof payload.path !== "string" || typeof payload.text !== "string" || Buffer.byteLength(payload.text, "utf8") > 64 * 1024 || !hash(payload.expectedHash)) throw Error("INVALID_HISTORY_SOURCE");
          const { branchId: _branch, ...sourceIdentity } = identity;
          return domain("godotProject.patch", { ...sourceIdentity, toolCallId,
            operation: { operationId: toolCallId, worldId, repoId: status.repoId, branchId,
              expectedHeadOid: branch.headOid, expectedAppliedOid: status.appliedOid, expectedProgressRevision: null },
            operations: [{ op: "put", path: payload.path, expectedHash: payload.expectedHash, text: payload.text }] });
        });
      } finally { if (mutation) busy.delete(worldId); }
    },
  };
}
