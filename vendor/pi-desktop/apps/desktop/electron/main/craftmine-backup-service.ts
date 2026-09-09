import { constants } from "node:fs";
import { lstat, open, realpath, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

export type CraftmineDomainCall = (method: string, params: Record<string, unknown>) => Promise<any>;
export type CraftmineFilePicker = (request: { kind: "save-backup" | "open-backup" | "save-diagnostics"; suggestedName?: string }) => Promise<string | null>;
export const CRAFTMINE_BACKUP_LIMIT = 32 * 1024 * 1024;
export function desktopServiceError(code: string): Error { return Object.assign(new Error(code), { code }); }
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function fields(input: Record<string, unknown>, allowed: string[]) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) throw desktopServiceError("INVALID_PARAMS");
}
function id(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(value)) throw desktopServiceError("INVALID_OPERATION_ID");
  return value;
}
async function selectedFile(path: string): Promise<string> {
  if (!isAbsolute(path)) throw desktopServiceError("INVALID_SELECTED_PATH");
  const parent = await realpath(dirname(path));
  const { basename } = await import("node:path");
  const target = join(parent, basename(path));
  const info = await lstat(target).catch(error => { if (error.code === "ENOENT") return undefined; throw error; });
  if (info && (!info.isFile() || info.isSymbolicLink())) throw desktopServiceError("BACKUP_LINK_OR_NONFILE_DENIED");
  return target;
}
async function readBounded(path: string): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > CRAFTMINE_BACKUP_LIMIT) throw desktopServiceError("BACKUP_FILE_TOO_LARGE");
    const buffer = Buffer.alloc(Math.min(CRAFTMINE_BACKUP_LIMIT + 1, info.size + 1));
    let total = 0;
    while (total < buffer.length) { const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total); if (!bytesRead) break; total += bytesRead; }
    if (total !== info.size || (await handle.stat()).size !== info.size) throw desktopServiceError("BACKUP_FILE_CHANGED");
    return buffer.subarray(0, total);
  } finally { await handle.close(); }
}
export async function writeSelectedFile(path: string, bytes: Buffer, canCommit: () => boolean = () => true): Promise<void> {
  const target = await selectedFile(path), temporary = `${target}.tmp-${randomUUID()}`;
  const file = await open(temporary, "wx", 0o600);
  try { await file.writeFile(bytes); await file.sync(); }
  catch (error) { await file.close(); await unlink(temporary).catch(() => {}); throw error; }
  await file.close();
  try { await selectedFile(target); if (!canCommit()) throw desktopServiceError("BACKUP_CANCELLED"); await rename(temporary, target); }
  catch (error) { await unlink(temporary).catch(() => {}); throw error; }
}

/** Paths and archive bytes are private to this native service. The renderer
 * receives expiring, content-bound grants and data-only status projections. */
export function createCraftmineBackupService(options: { domainCall: CraftmineDomainCall; pickFile: CraftmineFilePicker; now?: () => number }) {
  const now = options.now ?? Date.now;
  const grants = new Map<string, { path: string; fileHash: string; archiveHash: string; expiresAt: number }>();
  const operations = new Map<string, { kind: string; cancelled: boolean; result?: Record<string, unknown>; pending?: Promise<unknown> }>();
  const prune = () => { for (const [key, grant] of grants) if (grant.expiresAt <= now()) grants.delete(key); };
  const remember = (operationId: string, kind: string, run: (entry: { cancelled: boolean }) => Promise<Record<string, unknown>>) => {
    const previous = operations.get(operationId);
    if (previous) {
      if (previous.kind !== kind) throw desktopServiceError("BACKUP_OPERATION_CONFLICT");
      if (previous.pending) return previous.pending;
      if (previous.result) return Promise.resolve(previous.result);
      if (previous.cancelled) return Promise.resolve({ status: "cancelled", operationId, scope: "profile" });
      // A transport/file-write failure leaves the domain operation id intact.
      // An explicit retry can recover its durable receipt; it cannot invent a
      // successful local result or replace the original operation arguments.
      operations.delete(operationId);
    }
    if (operations.size >= 64) throw desktopServiceError("BACKUP_OPERATION_LIMIT");
    const entry: { kind: string; cancelled: boolean; result?: Record<string, unknown>; pending?: Promise<unknown> } = { kind, cancelled: false };
    operations.set(operationId, entry);
    entry.pending = run(entry).then(result => { entry.result = result; return result; }).finally(() => { entry.pending = undefined; });
    return entry.pending;
  };
  return {
    async request(channel: string, input: Record<string, unknown> = {}): Promise<any> {
      try {
      prune();
      if (channel === "backup.inspect") {
        fields(input, ["worldId"]);
        const selected = await options.pickFile({ kind: "open-backup" });
        if (!selected) return { status: "cancelled", scope: "profile" };
        if (grants.size >= 4) throw desktopServiceError("BACKUP_GRANT_LIMIT");
        const path = await selectedFile(selected), bytes = await readBounded(path);
        let archive; try { archive = JSON.parse(bytes.toString("utf8")); } catch { throw desktopServiceError("BACKUP_INVALID_JSON"); }
        const inspected = await options.domainCall("backup.inspect", { archive });
        if (inspected.valid !== true || typeof inspected.hash !== "string") throw desktopServiceError("BACKUP_INVALID_ARCHIVE");
        const current = await options.domainCall("backup.status", {}), grantId = randomUUID();
        grants.set(grantId, { path, fileHash: hash(bytes), archiveHash: inspected.hash, expiresAt: now() + 10 * 60_000 });
        return { status: "ready", grantId, archiveHash: inspected.hash, expectedCurrentHash: current.currentHash, counts: inspected.counts, bytes: bytes.length, scope: "profile", credentialsIncluded: false };
      }
      if (channel === "backup.export") {
        fields(input, ["worldId", "operationId"]); const operationId = id(input.operationId);
        return await remember(operationId, "export", async entry => {
          const selected = await options.pickFile({ kind: "save-backup", suggestedName: "Craftmine-World-backup.craftmine.json" });
          if (!selected || entry.cancelled) return { status: "cancelled", operationId, scope: "profile" };
          const result = await options.domainCall("backup.export", { operationId });
          if (entry.cancelled) return { status: "cancelled", operationId, scope: "profile" };
          const bytes = Buffer.from(JSON.stringify(result.archive));
          if (bytes.length > CRAFTMINE_BACKUP_LIMIT) throw desktopServiceError("BACKUP_FILE_TOO_LARGE");
          try { await writeSelectedFile(selected, bytes, () => !entry.cancelled); }
          catch (error) { if (entry.cancelled) return { status: "cancelled", operationId, scope: "profile" }; throw error; }
          return { status: "completed", operationId, archiveHash: result.manifest?.hash, bytes: bytes.length, scope: "profile", credentialsIncluded: false };
        });
      }
      if (channel === "backup.restore") {
        fields(input, ["worldId", "operationId", "grantId", "expectedCurrentHash"]);
        const operationId = id(input.operationId), grantId = id(input.grantId);
        if (typeof input.expectedCurrentHash !== "string" || !/^[a-f0-9]{64}$/.test(input.expectedCurrentHash)) throw desktopServiceError("INVALID_EXPECTED_HASH");
        return await remember(operationId, `restore:${grantId}:${input.expectedCurrentHash}`, async entry => {
          const grant = grants.get(grantId); if (!grant || grant.expiresAt <= now()) throw desktopServiceError("BACKUP_GRANT_EXPIRED");
          const bytes = await readBounded(await selectedFile(grant.path));
          if (hash(bytes) !== grant.fileHash) throw desktopServiceError("BACKUP_FILE_CHANGED");
          if (entry.cancelled) return { status: "cancelled", operationId, scope: "profile" };
          const archive = JSON.parse(bytes.toString("utf8"));
          const result = await options.domainCall("backup.restore", { operationId, archive, expectedCurrentHash: input.expectedCurrentHash });
          grants.delete(grantId);
          return { id: result.id, operationId, status: result.status, currentHash: result.currentHash, modelReplay: false, scope: "profile" };
        });
      }
      if (channel === "backup.cancel") {
        fields(input, ["operationId"]); const operationId = id(input.operationId), entry = operations.get(operationId);
        if (entry?.result?.status === "completed") throw desktopServiceError("BACKUP_ALREADY_COMPLETED");
        if (entry) entry.cancelled = true;
        return await options.domainCall("backup.cancel", { operationId });
      }
      if (channel === "backup.status") {
        fields(input, ["operationId"]);
        const operationId = input.operationId === undefined ? undefined : id(input.operationId);
        const local = operationId ? operations.get(operationId) : undefined;
        if (local?.result) return local.result;
        const result = await options.domainCall("backup.status", operationId ? { id: operationId } : {});
        return { ...(operationId ? { operationId } : {}), status: local?.pending ? "running" : local?.kind === "export" ? "failed" : result.status, currentHash: result.currentHash, archiveHash: result.archiveHash, scope: "profile" };
      }
      throw desktopServiceError("UNKNOWN_BACKUP_CHANNEL");
      } catch (error) {
        const candidate = error as { code?: unknown; errorCode?: unknown };
        const code = candidate.errorCode ?? candidate.code;
        throw desktopServiceError(typeof code === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : "BACKUP_OPERATION_FAILED");
      }
    },
    dispose() { grants.clear(); for (const entry of operations.values()) entry.cancelled = true; },
  };
}
