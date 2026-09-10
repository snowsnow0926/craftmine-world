import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, opendir, rename, unlink } from "node:fs/promises";
import { isAbsolute, join, parse, resolve } from "node:path";

export type IssueContext = {
  phase: "formal"; status: "ready"; worldId: string; buildId: string;
  baseId: string; baseVersion: string; instanceId: string; runtimeTarget: "godot-web";
  artifactManifestHash: string;
};
export type IssueRecord = {
  format: "craftmine.local-issue/1"; id: string; description: string; createdAt: string;
  context: IssueContext; status: "recorded"; scope: "local-only";
  reproduction: "not-attempted"; attachments: [];
  client: { version: string; commit?: string };
};
export type IssueSummary = Omit<IssueRecord, "description"> & { descriptionPreview: string; playerStatus: PlayerStatus; followupCount: number };
export type IssueFollowup = {
  format: "craftmine.local-issue-followup/1"; id: string; issueId: string; revision: number;
  kind: "note" | "still-present" | "player-resolved" | "reopened"; text: string;
  createdAt: string; context: IssueContext; client: IssueRecord["client"];
};
type PlayerStatus = "recorded" | Exclude<IssueFollowup["kind"], "note">;
export const ISSUE_LIMITS = Object.freeze({
  maxRecords: 100, maxDescriptionBytes: 16384, maxDescriptionLength: 4096,
  maxLedgerBytes: 2097152, maxReceipts: 1024, maxCreatedRecords: 512,
  maxFollowupsPerIssue: 32, maxFollowupLength: 2048, maxFollowupBytes: 8192,
});
export type IssueFaultPoint = "beforeWrite" | "beforeSync" | "beforeRename" | "afterRename";
export type IssueServiceOptions = {
  directory: string;
  /** Trusted host callback. Never derive this identity from panel parameters. */
  captureContext: () => Promise<unknown>;
  client: { version: string; commit?: string };
  now?: () => number;
  /** Dependency injection for storage-failure tests; never accepted over IPC. */
  fault?: (point: IssueFaultPoint) => void | Promise<void>;
};
type Receipt = { operationId: string; worldId: string; method: "issue.create" | "issue.delete" | "issue.followup"; requestHash: string; issueId: string; followupId?: string };
type Ledger = { format: "craftmine.local-issues/2"; records: IssueRecord[]; receipts: Receipt[]; followups: IssueFollowup[] };
type Input = Record<string, unknown>;
const CONTEXT_KEYS = ["phase", "status", "worldId", "buildId", "baseId", "baseVersion", "instanceId", "runtimeTarget", "artifactManifestHash"];
const RECORD_KEYS = ["format", "id", "description", "createdAt", "context", "status", "scope", "reproduction", "attachments", "client"];
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ISSUE_ID = /^issue-[a-f0-9]{64}$/;
const FOLLOWUP_ID = /^followup-[a-f0-9]{64}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_PENDING = 16;
function fail(code: string): never { throw Object.assign(new Error(code), { code }); }
const object = (value: unknown): value is Input => !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const keys = (value: Input, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const identifier = (value: unknown): value is string => typeof value === "string" && ID.test(value);
const validDescription = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= ISSUE_LIMITS.maxDescriptionLength && Buffer.byteLength(value, "utf8") <= ISSUE_LIMITS.maxDescriptionBytes && !value.includes("\0") && Buffer.from(value, "utf8").toString("utf8") === value;
const validClient = (value: unknown): value is IssueRecord["client"] => object(value) && keys(value, ["version", "commit"]) && typeof value.version === "string" && /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/.test(value.version) && (value.commit === undefined || (typeof value.commit === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.commit)));
const validFollowup = (kind: unknown, text: unknown) => ["note", "still-present", "player-resolved", "reopened"].includes(String(kind)) && typeof text === "string" &&
  (kind !== "note" || text.trim().length > 0) && text.length <= ISSUE_LIMITS.maxFollowupLength && Buffer.byteLength(text, "utf8") <= ISSUE_LIMITS.maxFollowupBytes && !text.includes("\0") && Buffer.from(text, "utf8").toString("utf8") === text;
const followupRequest = (worldId: string, input: Input) => ({ worldId, issueId: input.issueId, revision: input.revision, contextHash: input.contextHash, kind: input.kind, text: input.text });
const playerStatus = (entries: IssueFollowup[]): PlayerStatus => entries.filter(entry => entry.kind !== "note").at(-1)?.kind as PlayerStatus ?? "recorded";
function transition(status: PlayerStatus, kind: IssueFollowup["kind"]) {
  return kind === "note" || (kind === "reopened" ? status === "player-resolved" : status !== "player-resolved");
}

// Electron owns a profile exclusively. Also serialize multiple factories for
// that profile inside this process; never cache a stale in-memory ledger.
const queues = new Map<string, { tail: Promise<unknown>; count: number }>();
function locked<T>(directory: string, run: () => Promise<T>): Promise<T> {
  const key = process.platform === "win32" ? directory.toLowerCase() : directory;
  let queue = queues.get(key);
  if (!queue) { queue = { tail: Promise.resolve(), count: 0 }; queues.set(key, queue); }
  if (queue.count >= MAX_PENDING) return Promise.reject(Object.assign(new Error("ISSUE_BUSY"), { code: "ISSUE_BUSY" }));
  ++queue.count;
  const task = queue.tail.then(run);
  queue.tail = task.catch(() => {});
  void task.finally(() => { if (--queue!.count === 0 && queues.get(key) === queue) queues.delete(key); }).catch(() => {});
  return task;
}

function context(value: unknown): IssueContext {
  if (value === null || value === undefined) fail("ISSUE_CONTEXT_UNAVAILABLE");
  if (!object(value) || value.phase !== "formal" || value.status !== "ready" || value.runtimeTarget !== "godot-web") fail("ISSUE_CONTEXT_NOT_READY");
  for (const key of ["worldId", "buildId", "baseId", "baseVersion", "instanceId"]) if (!identifier(value[key])) fail("ISSUE_CONTEXT_NOT_READY");
  if (typeof value.artifactManifestHash !== "string" || !HASH.test(value.artifactManifestHash)) fail("ISSUE_CONTEXT_NOT_READY");
  // Explicit projection: descriptor paths, source, progress and tokens never enter the ledger.
  return Object.fromEntries(CONTEXT_KEYS.map(key => [key, value[key]])) as IssueContext;
}
function validateRecord(value: unknown): value is IssueRecord {
  if (!object(value) || !keys(value, RECORD_KEYS) || value.format !== "craftmine.local-issue/1" ||
      typeof value.id !== "string" || !ISSUE_ID.test(value.id) || !validDescription(value.description) ||
      typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) ||
      value.status !== "recorded" || value.scope !== "local-only" || value.reproduction !== "not-attempted" ||
      !Array.isArray(value.attachments) || value.attachments.length !== 0 || !object(value.context) || !keys(value.context, CONTEXT_KEYS) || !validClient(value.client)) return false;
  try { context(value.context); return true; } catch { return false; }
}
function validateLedger(value: unknown): Ledger {
  if (!object(value) || !keys(value, ["format", "records", "receipts", "followups"]) || !["craftmine.local-issues/1", "craftmine.local-issues/2"].includes(String(value.format)) ||
      !Array.isArray(value.records) || value.records.length > ISSUE_LIMITS.maxRecords || !value.records.every(validateRecord) ||
      !Array.isArray(value.receipts) || value.receipts.length > ISSUE_LIMITS.maxReceipts) fail("ISSUE_STORAGE_INVALID");
  const legacy = value.format === "craftmine.local-issues/1";
  if (legacy ? value.followups !== undefined : !Array.isArray(value.followups)) fail("ISSUE_STORAGE_INVALID");
  const followups = (legacy ? [] : value.followups) as IssueFollowup[];
  if (followups.length > ISSUE_LIMITS.maxReceipts) fail("ISSUE_STORAGE_INVALID");
  const ids = new Set<string>(), operations = new Set<string>(), created = new Map<string, Receipt>(), deleted = new Set<string>();
  for (const record of value.records) { if (ids.has(record.id)) fail("ISSUE_STORAGE_INVALID"); ids.add(record.id); }
  for (const receipt of value.receipts) {
    if (!object(receipt) || !keys(receipt, ["operationId", "worldId", "method", "requestHash", "issueId", "followupId"]) ||
        !identifier(receipt.operationId) || !identifier(receipt.worldId) || !(legacy ? ["issue.create", "issue.delete"] : ["issue.create", "issue.delete", "issue.followup"]).includes(String(receipt.method)) ||
        typeof receipt.requestHash !== "string" || !HASH.test(receipt.requestHash) || typeof receipt.issueId !== "string" || !ISSUE_ID.test(receipt.issueId) || operations.has(receipt.operationId)) fail("ISSUE_STORAGE_INVALID");
    if (receipt.method === "issue.followup" ? typeof receipt.followupId !== "string" || !FOLLOWUP_ID.test(receipt.followupId) || receipt.followupId !== `followup-${digest({ operationId: receipt.operationId, worldId: receipt.worldId, issueId: receipt.issueId })}` : receipt.followupId !== undefined) fail("ISSUE_STORAGE_INVALID");
    operations.add(receipt.operationId);
    if (receipt.method === "issue.create") {
      if (created.has(receipt.issueId) || receipt.issueId !== `issue-${digest({ operationId: receipt.operationId, worldId: receipt.worldId })}`) fail("ISSUE_STORAGE_INVALID");
      created.set(receipt.issueId, receipt as Receipt);
    } else if (receipt.method === "issue.delete") {
      if (deleted.has(receipt.issueId) || receipt.requestHash !== digest({ worldId: receipt.worldId, issueId: receipt.issueId })) fail("ISSUE_STORAGE_INVALID");
      deleted.add(receipt.issueId);
    }
  }
  for (const record of value.records) {
    const receipt = created.get(record.id);
    if (!receipt || receipt.worldId !== record.context.worldId || receipt.requestHash !== digest({ worldId: record.context.worldId, description: record.description })) fail("ISSUE_STORAGE_INVALID");
  }
  if (created.size > ISSUE_LIMITS.maxCreatedRecords) fail("ISSUE_STORAGE_INVALID");
  for (const id of created.keys()) if (!ids.has(id) && !deleted.has(id)) fail("ISSUE_STORAGE_INVALID");
  for (const receipt of value.receipts) {
    const original = created.get(receipt.issueId);
    if (!original || original.worldId !== receipt.worldId ||
        (receipt.method === "issue.delete" && ids.has(receipt.issueId))) fail("ISSUE_STORAGE_INVALID");
  }
  const seen = new Set<string>(), byIssue = new Map<string, IssueFollowup[]>();
  for (const entry of followups) {
    if (!object(entry) || !keys(entry, ["format", "id", "issueId", "revision", "kind", "text", "createdAt", "context", "client"]) ||
      entry.format !== "craftmine.local-issue-followup/1" || typeof entry.id !== "string" || !FOLLOWUP_ID.test(entry.id) || seen.has(entry.id) ||
      !ids.has(entry.issueId as string) || !validFollowup(entry.kind, entry.text) || !validClient(entry.client) ||
      typeof entry.createdAt !== "string" || !Number.isFinite(Date.parse(entry.createdAt)) || !object(entry.context) || !keys(entry.context, CONTEXT_KEYS)) fail("ISSUE_STORAGE_INVALID");
    const captured = context(entry.context), prior = byIssue.get(entry.issueId as string) ?? [];
    const receipt = value.receipts.find(item => item.method === "issue.followup" && item.followupId === entry.id);
    if (!receipt || receipt.issueId !== entry.issueId || receipt.worldId !== captured.worldId || entry.revision !== prior.length + 1 || prior.length >= ISSUE_LIMITS.maxFollowupsPerIssue ||
      !transition(playerStatus(prior), entry.kind as IssueFollowup["kind"]) || receipt.requestHash !== digest(followupRequest(captured.worldId, { issueId: entry.issueId, revision: prior.length, contextHash: digest(captured), kind: entry.kind, text: entry.text }))) fail("ISSUE_STORAGE_INVALID");
    seen.add(entry.id); prior.push(entry as unknown as IssueFollowup); byIssue.set(entry.issueId as string, prior);
  }
  for (const receipt of value.receipts) if (receipt.method === "issue.followup" && ids.has(receipt.issueId) && !seen.has(receipt.followupId)) fail("ISSUE_STORAGE_INVALID");
  return { format: "craftmine.local-issues/2", records: value.records as IssueRecord[], receipts: value.receipts as Receipt[], followups };
}

/** Refuse symlink/junction ancestors; issue IDs are never filesystem paths. */
async function safeDirectory(directory: string) {
  const root = parse(directory).root;
  let current = root;
  for (const part of directory.slice(root.length).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    let info = await lstat(current).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (!info) { await mkdir(current).catch(error => { if (error.code !== "EEXIST") throw error; }); info = await lstat(current); }
    if (!info.isDirectory() || info.isSymbolicLink()) fail("ISSUE_STORAGE_INVALID");
  }
}

export function createCraftmineIssueService(options: IssueServiceOptions) {
  if (!isAbsolute(options.directory) || !validClient(options.client)) fail("ISSUE_INVALID_INPUT");
  const client = structuredClone(options.client);
  const directory = resolve(options.directory), file = join(directory, "issues.json");
  async function load(): Promise<Ledger> {
    await safeDirectory(directory);
    // A process killed before rename leaves only this owned temporary file.
    // Do not follow links or remove unrecognized files during recovery.
    const names: string[] = [];
    for await (const entry of await opendir(directory)) {
      names.push(entry.name);
      if (names.length > ISSUE_LIMITS.maxReceipts + 4) fail("ISSUE_STORAGE_INVALID");
    }
    for (const name of names.filter(name => /^\.issue-pending-[a-f0-9-]{36}$/.test(name))) {
      const pending = join(directory, name), info = await lstat(pending);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > ISSUE_LIMITS.maxLedgerBytes) fail("ISSUE_STORAGE_INVALID");
      await unlink(pending);
    }
    const info = await lstat(file).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (!info) return { format: "craftmine.local-issues/2", records: [], receipts: [], followups: [] };
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > ISSUE_LIMITS.maxLedgerBytes) fail("ISSUE_STORAGE_INVALID");
    const handle = await open(file, "r");
    try {
      const actual = await handle.stat();
      if (!actual.isFile() || actual.nlink !== 1 || actual.size !== info.size || actual.ino !== info.ino || actual.size > ISSUE_LIMITS.maxLedgerBytes) fail("ISSUE_STORAGE_INVALID");
      const bytes = Buffer.alloc(actual.size + 1);
      let offset = 0;
      while (offset < bytes.length) { const read = await handle.read(bytes, offset, bytes.length - offset, null); if (!read.bytesRead) break; offset += read.bytesRead; }
      if (offset !== actual.size) fail("ISSUE_STORAGE_INVALID");
      try { return validateLedger(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, offset)))); }
      catch { return fail("ISSUE_STORAGE_INVALID"); }
    } finally { await handle.close(); }
  }
  async function persist(ledger: Ledger) {
    validateLedger(ledger);
    const bytes = Buffer.from(JSON.stringify(ledger) + "\n");
    if (bytes.length > ISSUE_LIMITS.maxLedgerBytes) fail("ISSUE_CAPACITY_REACHED");
    const pending = join(directory, `.issue-pending-${randomUUID()}`);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      await options.fault?.("beforeWrite");
      handle = await open(pending, "wx", 0o600);
      await handle.writeFile(bytes);
      await options.fault?.("beforeSync");
      await handle.sync(); await handle.close(); handle = undefined;
      await options.fault?.("beforeRename");
      // The old file is never removed first. Rename is the atomic commit point.
      await rename(pending, file);
      await options.fault?.("afterRename");
    } finally {
      await handle?.close().catch(() => {});
      await unlink(pending).catch(() => {});
    }
  }
  async function capture(): Promise<IssueContext> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([Promise.resolve().then(options.captureContext), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("ISSUE_CONTEXT_UNAVAILABLE"), { code: "ISSUE_CONTEXT_UNAVAILABLE" })), 5000);
      })]);
      return context(result);
    } catch (error) {
      if (["ISSUE_CONTEXT_NOT_READY", "ISSUE_WORLD_CHANGED"].includes((error as any)?.code)) return fail((error as any).code);
      return fail("ISSUE_CONTEXT_UNAVAILABLE");
    } finally { clearTimeout(timer); }
  }
  async function execute(channel: string, input: Input) {
    const ledger = await load(), worldId = input.worldId as string;
    const entries = (id: string) => ledger.followups.filter(entry => entry.issueId === id);
    const details = (issue: IssueRecord) => ({ issue, followups: entries(issue.id), revision: entries(issue.id).length, playerStatus: playerStatus(entries(issue.id)) });
    if (channel === "issue.list") {
      const all = ledger.records.filter(record => record.context.worldId === worldId).reverse();
      const offset = input.offset as number ?? 0, limit = input.limit as number ?? 20;
      const items: IssueSummary[] = all.slice(offset, offset + limit).map(({ description, ...record }) => ({ ...record, descriptionPreview: Array.from(description).slice(0, 160).join(""), playerStatus: playerStatus(entries(record.id)), followupCount: entries(record.id).length }));
      return { items, total: all.length, nextOffset: offset + limit < all.length ? offset + limit : null, limits: ISSUE_LIMITS,
        usage: { records: ledger.records.length, createdRecords: ledger.receipts.filter(receipt => receipt.method === "issue.create").length, receipts: ledger.receipts.length },
        remainingCreateSlots: Math.max(0, Math.min(ISSUE_LIMITS.maxCreatedRecords - ledger.receipts.filter(receipt => receipt.method === "issue.create").length,
          Math.floor((ISSUE_LIMITS.maxReceipts - ledger.receipts.length - ledger.records.length) / 2))),
        scope: "local-profile", backupIncluded: false };
    }
    if (channel === "issue.read") {
      const issue = ledger.records.find(record => record.id === input.issueId && record.context.worldId === worldId);
      if (!issue) fail("ISSUE_NOT_FOUND");
      return details(issue);
    }
    if (channel === "issue.followupPrepare") {
      const issue = ledger.records.find(record => record.id === input.issueId && record.context.worldId === worldId);
      if (!issue) fail("ISSUE_NOT_FOUND");
      const before = await capture(), after = await capture();
      if (before.worldId !== worldId || JSON.stringify(before) !== JSON.stringify(after)) fail("ISSUE_WORLD_CHANGED");
      return { issueId: issue.id, revision: entries(issue.id).length, context: before, contextHash: digest(before), playerStatus: playerStatus(entries(issue.id)) };
    }
    const requestHash = digest(channel === "issue.create" ? { worldId, description: input.description } : channel === "issue.followup" ? followupRequest(worldId, input) : { worldId, issueId: input.issueId });
    const prior = ledger.receipts.find(receipt => receipt.operationId === input.operationId);
    if (prior) {
      if (prior.worldId !== worldId || prior.method !== channel || prior.requestHash !== requestHash) fail("ISSUE_OPERATION_CONFLICT");
      const issue = ledger.records.find(record => record.id === prior.issueId) ?? null;
      if (channel === "issue.followup") return { status: "completed", replayed: true, deleted: !issue, ...(issue ? details(issue) : { issue: null, followups: [] }), followupId: prior.followupId };
      return channel === "issue.create" ? { status: "completed", replayed: true, issue, deleted: !issue } : { status: "completed", issueId: prior.issueId, deleted: true, replayed: true };
    }
    if (ledger.receipts.length >= ISSUE_LIMITS.maxReceipts) fail("ISSUE_RECEIPT_CAPACITY_REACHED");
    if (channel === "issue.create") {
      // Reserve one receipt per created record for its eventual deletion.
      if (ledger.receipts.filter(receipt => receipt.method === "issue.create").length >= ISSUE_LIMITS.maxCreatedRecords) fail("ISSUE_RECEIPT_CAPACITY_REACHED");
      if (ledger.records.length >= ISSUE_LIMITS.maxRecords) fail("ISSUE_CAPACITY_REACHED");
      if (ledger.receipts.length + ledger.records.length + 2 > ISSUE_LIMITS.maxReceipts) fail("ISSUE_RECEIPT_CAPACITY_REACHED");
      const before = await capture();
      if (before.worldId !== worldId) fail("ISSUE_WORLD_CHANGED");
      const after = await capture();
      if (JSON.stringify(before) !== JSON.stringify(after)) fail("ISSUE_WORLD_CHANGED");
      const createdAt = new Date((options.now ?? Date.now)()).toISOString();
      const id = `issue-${digest({ operationId: input.operationId, worldId })}`;
      const issue: IssueRecord = { format: "craftmine.local-issue/1", id, description: input.description as string, createdAt, context: before, status: "recorded", scope: "local-only", reproduction: "not-attempted", attachments: [], client };
      ledger.records.push(issue);
      ledger.receipts.push({ method: "issue.create", operationId: input.operationId as string, worldId, requestHash, issueId: id });
      await persist(ledger);
      return { status: "completed", replayed: false, issue, deleted: false };
    }
    const issue = ledger.records.find(record => record.id === input.issueId && record.context.worldId === worldId);
    if (!issue) fail("ISSUE_NOT_FOUND");
    if (channel === "issue.followup") {
      const priorEntries = entries(issue.id);
      if (input.revision !== priorEntries.length) fail("ISSUE_REVISION_CHANGED");
      if (!transition(playerStatus(priorEntries), input.kind as IssueFollowup["kind"])) fail("ISSUE_STATE_CONFLICT");
      if (priorEntries.length >= ISSUE_LIMITS.maxFollowupsPerIssue) fail("ISSUE_FOLLOWUP_CAPACITY_REACHED");
      // Every live issue must retain a receipt slot for eventual deletion.
      if (ledger.receipts.length + ledger.records.length + 1 > ISSUE_LIMITS.maxReceipts) fail("ISSUE_RECEIPT_CAPACITY_REACHED");
      const before = await capture();
      if (before.worldId !== worldId || digest(before) !== input.contextHash) fail("ISSUE_WORLD_CHANGED");
      const after = await capture();
      if (JSON.stringify(before) !== JSON.stringify(after)) fail("ISSUE_WORLD_CHANGED");
      const id = `followup-${digest({ operationId: input.operationId, worldId, issueId: issue.id })}`;
      const entry: IssueFollowup = { format: "craftmine.local-issue-followup/1", id, issueId: issue.id, revision: priorEntries.length + 1,
        kind: input.kind as IssueFollowup["kind"], text: input.text as string, createdAt: new Date((options.now ?? Date.now)()).toISOString(), context: before, client };
      ledger.followups.push(entry);
      ledger.receipts.push({ method: "issue.followup", operationId: input.operationId as string, worldId, issueId: issue.id, followupId: id, requestHash });
      await persist(ledger);
      return { status: "completed", replayed: false, deleted: false, ...details(issue), followupId: id };
    }
    ledger.records = ledger.records.filter(record => record !== issue);
    ledger.followups = ledger.followups.filter(entry => entry.issueId !== issue.id);
    ledger.receipts.push({ method: "issue.delete", operationId: input.operationId as string, worldId, requestHash, issueId: issue.id });
    await persist(ledger);
    return { status: "completed", issueId: issue.id, deleted: true, replayed: false };
  }
  return {
    async request(channel: string, value: unknown = {}) {
      const allowed: Record<string, string[]> = {
        "issue.create": ["worldId", "operationId", "description"], "issue.list": ["worldId", "offset", "limit"],
        "issue.read": ["worldId", "issueId"], "issue.delete": ["worldId", "issueId", "operationId"],
        "issue.followupPrepare": ["worldId", "issueId"],
        "issue.followup": ["worldId", "issueId", "operationId", "revision", "contextHash", "kind", "text"],
      };
      if (!allowed[channel] || !object(value) || !keys(value, allowed[channel]) || !identifier(value.worldId)) fail("ISSUE_INVALID_INPUT");
      const input = { ...value };
      if (channel === "issue.create") {
        if (!validDescription(input.description)) fail("ISSUE_INVALID_INPUT");
      }
      if (channel === "issue.followup" && (!validFollowup(input.kind, input.text) || !Number.isSafeInteger(input.revision) || Number(input.revision) < 0 || Number(input.revision) > ISSUE_LIMITS.maxFollowupsPerIssue || typeof input.contextHash !== "string" || !HASH.test(input.contextHash))) fail("ISSUE_INVALID_INPUT");
      if (["issue.create", "issue.delete", "issue.followup"].includes(channel) && !identifier(input.operationId)) fail("ISSUE_INVALID_INPUT");
      if (["issue.read", "issue.delete", "issue.followupPrepare", "issue.followup"].includes(channel) && (typeof input.issueId !== "string" || !ISSUE_ID.test(input.issueId))) fail("ISSUE_INVALID_INPUT");
      if (input.offset !== undefined && (!Number.isSafeInteger(input.offset) || Number(input.offset) < 0 || Number(input.offset) > ISSUE_LIMITS.maxRecords)) fail("ISSUE_INVALID_INPUT");
      if (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || Number(input.limit) < 1 || Number(input.limit) > 50)) fail("ISSUE_INVALID_INPUT");
      try { return structuredClone(await locked(directory, () => execute(channel, input))); }
      catch (error) {
        const code = (error as any)?.code;
        if (typeof code === "string" && /^ISSUE_(INVALID_INPUT|CONTEXT_UNAVAILABLE|CONTEXT_NOT_READY|WORLD_CHANGED|NOT_FOUND|OPERATION_CONFLICT|CAPACITY_REACHED|RECEIPT_CAPACITY_REACHED|FOLLOWUP_CAPACITY_REACHED|REVISION_CHANGED|STATE_CONFLICT|BUSY|STORAGE_INVALID)$/.test(code)) throw error;
        return fail("ISSUE_STORAGE_UNAVAILABLE");
      }
    },
  };
}
