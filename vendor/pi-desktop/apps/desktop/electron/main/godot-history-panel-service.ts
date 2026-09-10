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
  "godot.historyCompare": ["worldId", "viewId", "targetOid", "offset"],
  "godot.historyDiff": ["worldId", "viewId", "targetOid", "path"],
};
const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const oid = (value: unknown) => typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
const page = (value: unknown) => value == null ? 0 : Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : (() => { throw Error("INVALID_HISTORY_PAGE"); })();

/** Main-window only facade. The host owns task identity and source CAS context. */
export function createGodotHistoryPanelService(options: { domain: Domain; selection: () => Promise<string | null> }) {
  const { domain } = options;
  const busy = new Set<string>();
  // Renderer tokens only select host-observed versions; they never supply refs
  // or paths to a local filesystem. Eviction requires an explicit UI refresh.
  const views = new Map<string, Data>();
  async function read<T>(worldId: string, run: (context: Data) => Promise<T>): Promise<T> {
    await selected(worldId);
    const { context } = await domain("godotProject.sourceContext", { worldId });
    await selected(worldId);
    return run(context);
  }
  async function fresh(view: Data) {
    await selected(view.worldId);
    const current = await domain("content.status", { worldId: view.worldId });
    if (current.backend !== "git" || current.repoId !== view.repoId || current.appliedOid !== view.appliedOid
      || !(current.branches ?? []).some((item: Data) => item.name === `refs/heads/${view.branchId}` && item.oid === view.headOid)) throw Error("GODOT_HISTORY_VIEW_STALE");
    await selected(view.worldId);
  }
  async function compare(channel: string, payload: Data) {
    const view = typeof payload.viewId === "string" ? views.get(payload.viewId) : null;
    if (!view || view.worldId !== payload.worldId) throw Error("GODOT_HISTORY_VIEW_STALE");
    if (!oid(payload.targetOid) || !view.targets.has(payload.targetOid)) throw Error("INVALID_HISTORY_VERSION");
    if (!oid(view.appliedOid)) throw Error("GODOT_HISTORY_NO_FORMAL_VERSION");
    await fresh(view);
    const range = { worldId: view.worldId, from: view.appliedOid, to: payload.targetOid };
    const result = await domain("content.changes", range);
    const changes = result.changes;
    if (!Array.isArray(changes) || changes.length > 100_000) throw Error("INVALID_HISTORY_CHANGES");
    const identity = { worldId: view.worldId, viewId: payload.viewId, fromOid: view.appliedOid, toOid: payload.targetOid };
    let output: Data;
    if (channel === "godot.historyCompare") {
      const offset = page(payload.offset);
      if (offset > changes.length) throw Error("INVALID_HISTORY_PAGE");
      output = { ...identity, changes: changes.slice(offset, offset + 32).map((item: Data) => ({ path: item.path, status: item.status })),
        offset, total: changes.length, nextOffset: offset + 32 < changes.length ? offset + 32 : null };
    } else {
      // Exact membership excludes traversal, Git pathspecs and unrelated files.
      if (typeof payload.path !== "string" || !changes.some((item: Data) => item.path === payload.path)) throw Error("INVALID_HISTORY_DIFF_PATH");
      const diff = await domain("content.diff", { ...range, path: payload.path });
      if (diff.path !== payload.path) throw Error("INVALID_HISTORY_DIFF");
      if (diff.kind === "binary") {
        output = { ...identity, kind: "binary", path: diff.path, oldBytes: diff.old_bytes ?? diff.oldBytes ?? null, newBytes: diff.new_bytes ?? diff.newBytes ?? null };
      } else if (diff.kind === "text" && typeof diff.patch === "string") {
        const bytes = Buffer.from(diff.patch, "utf8");
        let end = Math.min(bytes.length, 64 * 1024);
        while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
        output = { ...identity, kind: "text", path: diff.path, added: diff.added, removed: diff.removed,
          patch: bytes.subarray(0, end).toString("utf8"), totalBytes: bytes.length, shownBytes: end, truncated: end < bytes.length };
      } else throw Error("INVALID_HISTORY_DIFF");
    }
    await fresh(view);
    return output;
  }
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
      if (channel === "godot.historyCompare" || channel === "godot.historyDiff") {
        try { return await compare(channel, payload); }
        catch (failure) {
          const code = failure instanceof Error ? failure.message : "";
          // Git errors may carry private repository paths. The renderer gets a
          // finite error, never raw stderr or arbitrary upstream diagnostics.
          if (["GODOT_WORLD_CHANGED", "GODOT_HISTORY_VIEW_STALE", "INVALID_HISTORY_VERSION", "GODOT_HISTORY_NO_FORMAL_VERSION",
            "INVALID_HISTORY_PAGE", "INVALID_HISTORY_DIFF_PATH"].includes(code)) throw Error(code);
          throw Error("GODOT_HISTORY_READ_FAILED");
        }
      }
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
          return read(worldId, async context => {
            const index = await domain("godotProject.index", { context, worldId, branchId, offset: page(payload.offset), limit: 32 });
            index.offset = page(payload.offset);
            const history = await domain("content.history", { worldId, rev: branch.headOid, skip: page(payload.skip), limit: 20 });
            const fresh = await domain("content.status", { worldId });
            if (fresh.repoId !== status.repoId || fresh.appliedOid !== status.appliedOid || !(fresh.branches ?? []).some((item: Data) => item.name === `refs/heads/${branchId}` && item.oid === branch.headOid)) throw Error("GODOT_SOURCE_STALE");
            await selected(worldId);
            const viewId = randomUUID();
            for (const [key, view] of views) if (view.worldId !== worldId) views.delete(key);
            while (views.size >= 16) views.delete(views.keys().next().value!);
            views.set(viewId, { worldId, branchId, repoId: status.repoId, appliedOid: status.appliedOid, headOid: branch.headOid,
              targets: new Set([branch.headOid, ...(history.records ?? []).map((record: Data) => record.oid)]) });
            // Never expose the private gitDir from content.status to a renderer.
            return { worldId, branchId, viewId, repoId: status.repoId, appliedOid: status.appliedOid, headOid: branch.headOid, branches, index, history };
          });
        }
        if (!Number.isSafeInteger(payload.revision) || !hash(payload.manifestHash)) throw Error("INVALID_SOURCE_REVISION");
        return await (channel === "godot.historyReadSource" ? read : task)(worldId, async context => {
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
