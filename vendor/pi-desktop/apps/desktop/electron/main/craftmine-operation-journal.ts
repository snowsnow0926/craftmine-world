import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, open, rename, unlink, lstat } from "node:fs/promises";
import { join } from "node:path";
import { validateTargetFeedbackIntent, validateTargetFeedbackReceipt } from "./craftmine-target-feedback-panel";

export type OperationOwner = { projectId: string; sessionId: string | null; worldId: string };
type Payload = Record<string, any>;
export type PendingOperation = { operationId: string; channel: string; payload: Payload; state: "pending" | "running" | "uncertain" | "completed"; result?: any; errorCode?: string; createdAt: number };
type StoredOperation = PendingOperation & { owner: OperationOwner; identity: string; hash: string };
const allowed: Record<string, string[]> = {
  "library.install": ["ref", "revision", "position"],
  "library.capture": ["kind", "resourceId", "tags", "applicationId"],
  "memory.propose": ["kind", "claim", "tags", "replaceId"],
  "backup.export": [],
  "backup.restore": ["grantId", "expectedCurrentHash"],
  "task.budget": ["taskId", "generation", "maxTokens"],
  "task.releaseExecutionLimits": ["taskId", "generation"],
  "draft.recheck": ["taskId", "generation", "revision", "draftHash"],
  "targetFeedback.submit": ["targetId", "sourceBinding", "values"],
};
export const PERSISTENT_WORKBENCH_CHANNELS = new Set(Object.keys(allowed));
const fail = (code: string): never => { throw Object.assign(new Error(code), { code }); };
const plain = (value: unknown): value is Payload => !!value && typeof value === "object" && !Array.isArray(value);
const canonical = (value: any): string => JSON.stringify(value, (_key, item) => plain(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const digest = (value: any) => createHash("sha256").update(canonical(value)).digest("hex");
const sameOwner = (left: OperationOwner, right: OperationOwner) => canonical(left) === canonical(right);
function validateOwner(owner: OperationOwner) {
  if (!plain(owner) || Object.keys(owner).some(key => !["projectId", "sessionId", "worldId"].includes(key))) fail("INVALID_OPERATION_OWNER");
  for (const key of ["projectId", "worldId", "sessionId"] as const) {
    const value = owner[key]; if (key === "sessionId" && value === null) continue;
    if (typeof value !== "string" || !value.trim() || value.length > 240 || /[\x00-\x1f]/.test(value)) fail("INVALID_OPERATION_OWNER");
  }
}
function validatePayload(channel: string, payload: Payload): Payload {
  if (!allowed[channel] || !plain(payload) || Object.keys(payload).some(key => !allowed[channel].includes(key))) fail("INVALID_OPERATION_PARAMS");
  if (Buffer.byteLength(canonical(payload)) > 8192) fail("OPERATION_PARAMS_TOO_LARGE");
  if (channel === "memory.propose" && (typeof payload.claim !== "string" || !payload.claim.trim() || payload.claim.length > 400)) fail("INVALID_MEMORY_CLAIM");
  const short = (value: any, max = 240) => typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\x00-\x1f]/.test(value);
  const hash = (value: any) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  const integer = (value: any) => Number.isSafeInteger(value) && value >= 0;
  if (payload.tags !== undefined && (!Array.isArray(payload.tags) || payload.tags.length > 12 || payload.tags.some((tag: any) => !short(tag, 32)))) fail("INVALID_OPERATION_PARAMS");
  if (channel === "library.install") {
    if (!plain(payload.ref) || Object.keys(payload.ref).some(key => !["id", "version", "hash"].includes(key)) || !short(payload.ref.id, 100) || !integer(payload.ref.version) || payload.ref.version < 1 || !hash(payload.ref.hash)) fail("INVALID_OPERATION_PARAMS");
    if (payload.revision !== undefined && !integer(payload.revision)) fail("INVALID_OPERATION_PARAMS");
    if (payload.position !== undefined && (!plain(payload.position) || Object.keys(payload.position).sort().join() !== "x,y,z" || Object.values(payload.position).some(value => typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 80))) fail("INVALID_OPERATION_PARAMS");
  }
  if (channel === "library.capture" && (!["object", "gameplay", "creation"].includes(payload.kind) || !short(payload.resourceId, 100) || (payload.applicationId !== undefined && !short(payload.applicationId)))) fail("INVALID_OPERATION_PARAMS");
  if (channel === "memory.propose" && (!["project-rule", "workflow"].includes(payload.kind) || (payload.replaceId !== undefined && !short(payload.replaceId, 100)))) fail("INVALID_OPERATION_PARAMS");
  if (channel === "backup.restore" && (!short(payload.grantId, 100) || !hash(payload.expectedCurrentHash))) fail("INVALID_OPERATION_PARAMS");
  if (channel === "task.budget" && (!short(payload.taskId, 100) || !integer(payload.generation) || payload.generation < 1 || !(payload.maxTokens === null || (integer(payload.maxTokens) && payload.maxTokens > 0)))) fail("INVALID_OPERATION_PARAMS");
  if (channel === "task.releaseExecutionLimits" && (!short(payload.taskId, 100) || !integer(payload.generation) || payload.generation < 1)) fail("INVALID_OPERATION_PARAMS");
  if (channel === "draft.recheck" && (!short(payload.taskId, 100) || !integer(payload.generation) || payload.generation < 1 || !integer(payload.revision) || !hash(payload.draftHash))) fail("INVALID_OPERATION_PARAMS");
  if (channel === "targetFeedback.submit") validateTargetFeedbackIntent(payload);
  // Only the explicit player-authored business arguments are retained. Never
  // accept provider settings, credentials, archive bytes, paths or error text.
  return JSON.parse(canonical(payload));
}
function identity(channel: string, payload: Payload) {
  const selected = channel === "library.install" ? { ref: payload.ref, ...(payload.position ? { position: payload.position } : {}) } : payload;
  return digest({ channel, payload: selected });
}
function projection(record: StoredOperation): PendingOperation {
  const { owner: _owner, identity: _identity, hash: _hash, ...result } = record;
  return structuredClone(result);
}
function receipt(result: any, channel: string) {
  if (channel === "targetFeedback.submit") return validateTargetFeedbackReceipt(result);
  if (!plain(result) || Buffer.byteLength(canonical(result)) > 65536) fail("INVALID_OPERATION_RECEIPT");
  if (channel === "task.releaseExecutionLimits") {
    const keys = ["kind", "operationId", "binding", "taskId", "generation", "worldId", "previousLimits", "limits", "budget", "exhausted", "modelReplay", "resumed", "createdAt"];
    const limits = result.limits;
    if (Object.keys(result).some(key => !keys.includes(key)) || result.kind !== "player-execution-limit-release" || !Number.isSafeInteger(result.createdAt) || result.createdAt < 1
      || result.modelReplay !== false || result.resumed !== false || !plain(limits) || !plain(result.previousLimits)
      || limits.maxRequests !== null || limits.maxCompactions !== null || limits.deadlineAt !== null
      || limits.maxTokens !== result.previousLimits.maxTokens || !plain(result.budget)
      || canonical(result.budget.limits) !== canonical(limits) || !Array.isArray(result.exhausted) || !result.exhausted.length
      || result.exhausted.some((code: unknown) => !["REQUEST_BUDGET_EXHAUSTED", "COMPACTION_BUDGET_EXHAUSTED", "TASK_DEADLINE_EXCEEDED"].includes(String(code)))) fail("INVALID_OPERATION_RECEIPT");
    return structuredClone(result);
  }
  const keys = ["budget", "previousMaxTokens", "receipt", "ref", "packageHash", "metadata", "idMap", "dependencies", "applied", "verificationId", "verificationStatus", "replayed", "id", "operationId", "status", "archiveHash", "bytes", "scope", "currentHash", "modelReplay", "credentialsIncluded", "format", "kind", "claim", "sourceRefs", "tags", "appliesTo", "supersedes", "supersededBy", "createdAt", "lastVerifiedAt", "retiredReason", "generation", "draftHash", "revision", "summary", "current", "inputHash", "outputHash", "publishingAvailable", "taskId", "workspaceRevision", "baseBuild"];
  if (Object.keys(result).some(key => !keys.includes(key) && !["activated", "rebuildRequired", "errorCode"].includes(key))) fail("INVALID_OPERATION_RECEIPT");
  if (result.errorCode !== undefined || result.status === "reconciliation-pending") {
    if (channel !== "backup.restore" || result.status !== "reconciliation-pending" || result.activated !== true || result.errorCode !== "BACKUP_RESTORED_RECONCILIATION_PENDING") fail("INVALID_OPERATION_RECEIPT");
  }
  if (result.activated !== undefined && typeof result.activated !== "boolean") fail("INVALID_OPERATION_RECEIPT");
  if (result.rebuildRequired !== undefined && (!Array.isArray(result.rebuildRequired) || result.rebuildRequired.some((id: unknown) => typeof id !== "string" || !/^gbd-[a-f0-9]{64}$/.test(id)))) fail("INVALID_OPERATION_RECEIPT");
  return structuredClone(result);
}

/** Host-owned pending intent receipts, separate from authoritative world data.
 * No operation runs automatically on reload. One explicit retry keeps the
 * original parameters and identity, even when the renderer lost its response. */
export function createCraftmineOperationJournal(directory: string) {
  const file = join(directory, "pending-operations.json");
  let entries: StoredOperation[] | null = null;
  let serial: Promise<unknown> = Promise.resolve();
  const executing = new Map<string, Promise<any>>();
  function locked<T>(fn: () => Promise<T>): Promise<T> {
    const task = serial.then(fn, fn); serial = task.catch(() => {}); return task;
  }
  async function load(): Promise<StoredOperation[]> {
    if (entries) return entries;
    await mkdir(directory, { recursive: true });
    const info = await lstat(file).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (!info) return entries = [];
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) fail("INVALID_OPERATION_JOURNAL");
    let saved: any; try { saved = JSON.parse(await readFile(file, "utf8")); } catch { fail("INVALID_OPERATION_JOURNAL"); }
    if (saved.format !== "craftmine.pending-operations/1" || !Array.isArray(saved.operations) || saved.operations.length > 100) fail("INVALID_OPERATION_JOURNAL");
    const ids = new Set<string>();
    for (const record of saved.operations) {
      if (!plain(record) || Object.keys(record).some(key => !["owner", "operationId", "channel", "payload", "identity", "hash", "state", "result", "errorCode", "createdAt"].includes(key)) || !Number.isSafeInteger(record.createdAt)) fail("INVALID_OPERATION_JOURNAL");
      validateOwner(record.owner); validatePayload(record.channel, record.payload);
      if (typeof record.operationId !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(record.operationId) || ids.has(record.operationId)) fail("INVALID_OPERATION_JOURNAL");
      ids.add(record.operationId);
      if (!["pending", "running", "uncertain", "completed"].includes(record.state) || record.identity !== identity(record.channel, record.payload) || record.hash !== digest({ owner: record.owner, channel: record.channel, payload: record.payload, operationId: record.operationId })) fail("INVALID_OPERATION_JOURNAL");
      if (record.state === "completed") receipt(record.result, record.channel);
      if (record.state === "running") record.state = "uncertain";
    }
    return entries = saved.operations;
  }
  async function save() {
    const bytes = Buffer.from(canonical({ format: "craftmine.pending-operations/1", operations: entries }));
    if (bytes.length > 1024 * 1024) fail("OPERATION_JOURNAL_FULL");
    const temporary = `${file}.tmp-${randomUUID()}`;
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); }
    catch (error) { await handle.close(); await unlink(temporary).catch(() => {}); throw error; }
    await handle.close();
    try { await rename(temporary, file); } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  }
  async function find(owner: OperationOwner, id: string) {
    validateOwner(owner); const record = (await load()).find(item => item.operationId === id);
    if (!record || !sameOwner(record.owner, owner)) return fail("OPERATION_OWNER_MISMATCH");
    return record;
  }
  return {
    async prepare(owner: OperationOwner, channel: string, input: Payload, existingId?: string): Promise<PendingOperation> {
      return locked(async () => {
        validateOwner(owner); const payload = validatePayload(channel, input), key = identity(channel, payload);
        const records = await load();
        if (existingId) {
          const existing = records.find(record => record.operationId === existingId);
          if (existing) { if (!sameOwner(existing.owner, owner) || existing.channel !== channel || canonical(existing.payload) !== canonical(payload)) fail("OPERATION_REPLAY_MISMATCH"); return projection(existing); }
        }
        const prior = records.find(record => sameOwner(record.owner, owner) && record.channel === channel && record.identity === key);
        if (prior) return projection(prior);
        if (records.length >= 100) fail("OPERATION_JOURNAL_FULL");
        const operationId = existingId ?? randomUUID();
        if (!/^[a-zA-Z0-9_-]{8,100}$/.test(operationId)) fail("INVALID_OPERATION_ID");
        const record: StoredOperation = { owner: structuredClone(owner), operationId, channel, payload, identity: key, hash: digest({ owner, channel, payload, operationId }), state: "pending", createdAt: Date.now() };
        records.push(record);
        try { await save(); } catch (error) { records.pop(); throw error; }
        return projection(record);
      });
    },
    async list(owner: OperationOwner): Promise<PendingOperation[]> {
      return locked(async () => { validateOwner(owner); return (await load()).filter(record => sameOwner(record.owner, owner)).map(projection); });
    },
    async execute(owner: OperationOwner, operationId: string, action: (record: PendingOperation) => Promise<any>): Promise<any> {
      const record = await locked(async () => {
        const saved = await find(owner, operationId); if (saved.state === "completed") return projection(saved);
        const before = saved.state; saved.state = "running";
        try { await save(); } catch (error) { saved.state = before; throw error; }
        return projection(saved);
      });
      if (record.state === "completed") return record.result;
      if (executing.has(operationId)) return executing.get(operationId)!;
      const task = (async () => {
        try {
          const result = receipt(await action(record), record.channel);
          await locked(async () => {
            const saved = await find(owner, operationId); saved.state = "completed"; saved.result = result; delete saved.errorCode;
            try { await save(); } catch (error) { saved.state = "uncertain"; delete saved.result; throw error; }
          });
          return result;
        } catch (error) {
          await locked(async () => { const saved = await find(owner, operationId); saved.state = "uncertain"; saved.errorCode = "OPERATION_RESULT_UNCONFIRMED"; await save(); });
          throw error;
        }
      })();
      executing.set(operationId, task);
      try { return await task; } finally { executing.delete(operationId); }
    },
    async acknowledge(owner: OperationOwner, operationId: string) {
      return locked(async () => {
        const record = await find(owner, operationId); if (record.state !== "completed") fail("OPERATION_RESULT_UNCONFIRMED");
        const before = entries!; entries = before.filter(item => item.operationId !== operationId);
        try { await save(); } catch (error) { entries = before; throw error; }
        return { acknowledged: true };
      });
    },
  };
}
export type CraftmineOperationJournal = ReturnType<typeof createCraftmineOperationJournal>;
