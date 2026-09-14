import {lstat, open} from "node:fs/promises";
import {createHash} from "node:crypto";
import {isAbsolute, parse, resolve, sep, join} from "node:path";

type Preview = {worldId: string; buildId: string; pngBase64: string; sha256: string};
const METHODS = new Set(["list", "read", "describe", "save", "status", "cancel", "export", "import", "capture", "releaseCapture"]);
export const WORLD_TEMPLATE_PANEL_CHANNELS = new Set([...METHODS].map(method => `worldTemplate.${method}`));
const exact = (value: any, keys: string[]) => {if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw Error("WORLD_TEMPLATE_INVALID_PARAMS");};
const operation = (value: unknown) => {if (typeof value !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(value)) throw Error("WORLD_TEMPLATE_OPERATION_REQUIRED");};
function ref(value: any) {exact(value, ["assetId", "version", "contentHash"]);if (typeof value.assetId !== "string" || !/^player\.world\.[a-z0-9_-]{1,60}$/.test(value.assetId) || !Number.isSafeInteger(value.version) || value.version < 1 || value.version > 100000 || !/^[a-f0-9]{64}$/.test(value.contentHash)) throw Error("WORLD_TEMPLATE_INVALID_REF");return {...value};}
async function ordinaryFile(filename: string, mayBeMissing = false) {
  if (!isAbsolute(filename)) throw Error("WORLD_TEMPLATE_FILE_GRANT_REQUIRED");
  const absolute = resolve(filename), root = parse(absolute).root; let current = root;
  for (const part of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    const stat = await lstat(current).catch(error => {if (mayBeMissing && current === absolute && error.code === "ENOENT") return null; throw error;});
    if (stat?.isSymbolicLink() || (stat && current === absolute && !stat.isFile())) throw Error("WORLD_TEMPLATE_FILE_GRANT_REQUIRED");
  }
  return absolute;
}
async function archiveHash(filename: string) {
  const file = await open(await ordinaryFile(filename), "r");
  try {const before = await file.stat(); if (before.size > 64 * 1024 * 1024) throw Error("WORLD_TEMPLATE_TOO_LARGE");const bytes = await file.readFile();const after = await file.stat();if (bytes.length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw Error("WORLD_TEMPLATE_SOURCE_CHANGED");return createHash("sha256").update(bytes).digest("hex");}
  finally {await file.close();}
}
/** Main-window metadata and file-picker boundary; private archive paths never cross IPC. */
export function createWorldTemplatePanel(options: {
  domain(method: string, args: Record<string, unknown>): Promise<any>;
  selection(): Promise<string | null>;
  capturePreview(worldId: string): Promise<Preview>;
  capture?(worldId: string): Promise<{receipt: unknown; release(): Promise<void>}>;
  pick(kind: "import" | "export", suggestedName?: string): Promise<string | null>;
}) {
  let disposed = false;
  const imports = new Map<string, {archivePath: string; archiveSha256: string}>();
  type Capture = {worldId: string; pending: Promise<{receipt: unknown; release(): Promise<void>}>; saving?: Promise<any>; releasing?: Promise<void>; released?: boolean};
  const captures = new Map<string, Capture>();
  const release = (entry: Capture) => entry.releasing ??= (async () => {
    const capture = await entry.pending;
    try {await entry.saving;} catch { /* Publication retains its own failure. */ }
    await capture.release();
  })().finally(() => {entry.released = true;});
  const selected = async (worldId: unknown) => {if (disposed) throw Error("WORLD_TEMPLATE_UNAVAILABLE"); if (typeof worldId !== "string" || await options.selection() !== worldId) throw Error("WORLD_TEMPLATE_WORLD_CHANGED"); if (disposed) throw Error("WORLD_TEMPLATE_UNAVAILABLE");};
  return {
    async request(channel: string, input: any) {
      if (!WORLD_TEMPLATE_PANEL_CHANNELS.has(channel) || disposed) throw Error("WORLD_TEMPLATE_UNAVAILABLE");
      if (!input || typeof input !== "object" || Array.isArray(input) || Buffer.byteLength(JSON.stringify(input)) > 8192) throw Error("WORLD_TEMPLATE_INVALID_PARAMS");
      const args = structuredClone(input), method = channel.slice("worldTemplate.".length);
      if (method === "capture" || method === "releaseCapture") {
        exact(args, ["worldId", "operationId"]); operation(args.operationId);
        if (typeof args.worldId !== "string") throw Error("WORLD_TEMPLATE_WORLD_CHANGED");
        let entry = captures.get(args.operationId);
        if (entry && entry.worldId !== args.worldId) throw Error("WORLD_TEMPLATE_OPERATION_CONFLICT");
        if (method === "releaseCapture") {
          if (entry) await release(entry);
          else captures.set(args.operationId, {worldId: args.worldId, pending: Promise.resolve({receipt: null, release: async () => {}}), releasing: Promise.resolve(), released: true});
          return {status: "released", operationId: args.operationId};
        }
        await selected(args.worldId);
        if (!options.capture) throw Error("WORLD_TEMPLATE_CAPTURE_UNAVAILABLE");
        entry = captures.get(args.operationId);
        if (entry && entry.worldId !== args.worldId) throw Error("WORLD_TEMPLATE_OPERATION_CONFLICT");
        if (entry?.releasing) throw Error("WORLD_TEMPLATE_CAPTURE_RELEASED");
        if (!entry && [...captures.values()].some(value => value.worldId === args.worldId && !value.released)) throw Error("WORLD_BUSY");
        if (!entry) {entry = {worldId: args.worldId, pending: options.capture(args.worldId)}; captures.set(args.operationId, entry);}
        return (await entry.pending).receipt;
      }
      if (method === "list") {exact(args, ["query", "offset", "limit"]); return options.domain(channel, args);}
      if (method === "read") {exact(args, ["ref"]); return options.domain(channel, {ref: ref(args.ref)});}
      if (method === "status" || method === "cancel") {exact(args, ["operationId"]); operation(args.operationId); return options.domain(channel, args);}
      if (method === "describe") {exact(args, ["worldId"]); await selected(args.worldId); const result = await options.domain(channel, args); await selected(args.worldId); return result;}
      if (method === "save") {
        exact(args, ["worldId", "operationId", "displayName", "description", "tags", "assetId", "version", "initialState", "expectedSource", "includePreview"]);
        operation(args.operationId); if (args.includePreview !== undefined && typeof args.includePreview !== "boolean") throw Error("WORLD_TEMPLATE_INVALID_PARAMS");
        const {includePreview, ...request} = args;
        const capture = captures.get(args.operationId);
        if (capture && capture.worldId !== args.worldId) throw Error("WORLD_TEMPLATE_OPERATION_CONFLICT");
        if (capture?.releasing && !capture.released) throw Error("WORLD_TEMPLATE_CAPTURE_RELEASED");
        const save = async () => {
          await selected(args.worldId);
          if (capture) await capture.pending;
          const preview = includePreview ? await options.capturePreview(args.worldId).catch(() => null) : null;
          await selected(args.worldId); const result = await options.domain(channel, {...request, ...(preview ? {preview} : {})});
          await selected(args.worldId); return result;
        };
        // Exact archive retries remain valid after capture release; they retain
        // the original source identity and the domain's idempotent journal.
        const saving = save(); if (capture && !capture.releasing) capture.saving = Promise.allSettled([capture.saving, saving]);
        return saving;
      }
      if (method === "export") {
        exact(args, ["ref"]); const reference = ref(args.ref);
        const file = await options.pick("export", `${reference.assetId}-v${reference.version}.zip`);
        if (!file) return {status: "cancelled"};
        const destination = await ordinaryFile(file, true);
        const result = await options.domain("worldTemplate.exportArchive", {ref: reference, destination});
        return {status: "completed", ref: ref(result.ref), bytes: result.bytes, sha256: result.sha256};
      }
      exact(args, ["operationId"]); operation(args.operationId);
      let grant = imports.get(args.operationId);
      if (!grant) {const file = await options.pick("import"); if (!file) return {status: "cancelled"};const archivePath = await ordinaryFile(file);grant = {archivePath, archiveSha256: await archiveHash(archivePath)};imports.set(args.operationId, grant);}
      if (disposed) throw Error("WORLD_TEMPLATE_UNAVAILABLE");
      const result = await options.domain("worldTemplate.importArchive", {...args, ...grant});
      imports.delete(args.operationId); return result;
    },
    // Disposal follows the shutdown checkpoint. Do not undo that pause; active
    // requests retain their local entries until their existing work settles.
    dispose() {disposed = true; imports.clear(); captures.clear();},
  };
}
