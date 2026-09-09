import {createHash} from "node:crypto";
import {isDeepStrictEqual} from "node:util";

type Data = Record<string, any>;
export type GodotWorldCopyOptions = {
  domain: (method: string, args: Data) => Promise<any>;
  selection: () => Promise<string | null>;
  /** Must pause/freeze the real source and durably commit its full snapshot. */
  checkpoint: (worldId: string) => Promise<any>;
  /** Select/detach using the ordinary host lifecycle; no guessed renderer state. */
  open: (worldId: string) => Promise<unknown>;
  /** Actual restore service: build/check, candidate launch, apply and confirm. */
  start: (worldId: string) => Promise<any>;
};
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export function godotCopyTarget(worldId: string, operationId: string) {
  return "copy-" + hash(worldId + "|" + operationId).slice(0, 40);
}
export function godotCopyProgressIdentity(source: Data, oldWorldId: string, newWorldId: string): Data {
  if (!source || source.format !== "craftmine.godot-progress/1" || source.worldId !== oldWorldId || source.body?.worldId !== oldWorldId) throw Error("GODOT_COPY_SOURCE_PROGRESS_INVALID");
  const result = structuredClone(source);
  if (source.baseId === "mining-sandbox") {
    if (source.body.format !== "craftmine.godot-mining-sandbox-managed/1" || source.body.state?.format !== "craftmine.godot-mining-sandbox-state/1" || source.body.state.worldId !== oldWorldId) throw Error("GODOT_COPY_PROGRESS_IDENTITY_MISMATCH");
    result.body.state.worldId = newWorldId;
  }
  result.worldId = newWorldId; result.body.worldId = newWorldId;
  return result;
}
function request(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("INVALID_COPY_REQUEST");
  const data = value as Data;
  if (Object.keys(data).some(key => !["worldId", "operationId", "title"].includes(key))) throw Error("INVALID_COPY_REQUEST");
  if (typeof data.worldId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(data.worldId)) throw Error("INVALID_WORLD_ID");
  if (typeof data.operationId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(data.operationId)) throw Error("INVALID_COPY_OPERATION");
  if (data.title !== undefined && (typeof data.title !== "string" || !data.title.trim() || [...data.title].length > 80 || /[\u0000-\u001f\u007f]/.test(data.title))) throw Error("INVALID_WORLD_TITLE");
  return {worldId: data.worldId as string, operationId: data.operationId as string, title: data.title as string | undefined};
}

export function createGodotWorldCopyService(options: GodotWorldCopyOptions) {
  const running = new Map<string, Promise<Data>>();
  const states = new Map<string, Data>();
  const {domain} = options;
  let occupied = false;
  async function work(input: ReturnType<typeof request>) {
    const {worldId, operationId} = input;
    const targetWorldId = godotCopyTarget(worldId, operationId);
    let expectedInitial: Data | null = null;
    const update = (value: Data) => {
      const state = {worldId, operationId, targetWorldId, ...value};
      states.set(targetWorldId, state); return state;
    };
    const origin = async () => {
      const value = await domain("godotWorld.copyStatus", {worldId: targetWorldId, sourceWorldId: worldId});
      if (value && (value.targetWorldId !== targetWorldId || value.originalSourceWorldId !== worldId || value.copyId !== "gcopy-" + hash("craftmine.godot-world-copy/1|" + worldId + "|" + targetWorldId) || value.progressMode !== "formal")) throw Error("GODOT_COPY_ORIGIN_MISMATCH");
      return value;
    };
    try {
      update({status: "running", stage: "origin"});
      let existing = await origin();
      const selected = await options.selection();
      if (selected !== worldId && !(existing && selected === targetWorldId)) throw Error("GODOT_WORLD_CHANGED");
      if (!existing) {
        const source = await domain("godotRuntime.describe", {worldId});
        if (source?.phase !== "formal" || source.worldId !== worldId || source.snapshot?.format !== "craftmine.godot-progress/1") throw Error("GODOT_COPY_SOURCE_NOT_PLAYABLE");
        update({status: "running", stage: "save"});
        const saved = await options.checkpoint(worldId);
        if (saved?.status !== "persisted" || saved.receipt?.format !== "craftmine.godot-progress-receipt/1" || saved.receipt.worldId !== worldId) throw Error("GODOT_COPY_SOURCE_NOT_PERSISTED");
        if (await options.selection() !== worldId) throw Error("GODOT_WORLD_CHANGED");
        const savedWorld = await domain("world.read", {id: worldId});
        if (savedWorld?.revision !== saved.receipt.revision || savedWorld.world?.build?.id !== saved.receipt.buildId) throw Error("GODOT_COPY_SOURCE_CHECKPOINT_CHANGED");
        expectedInitial = godotCopyProgressIdentity(savedWorld.world.snapshot, worldId, targetWorldId);
        update({status: "running", stage: "copy"});
        try {
          await domain("godotWorld.copy", {sourceWorldId: worldId, targetWorldId,
            title: input.title?.trim() || "世界副本", progress: "formal"});
        } catch (error) {
          // A response may be lost after core commit. Resume only when durable
          // origin proves this exact operation's copy, never on WORLD_EXISTS alone.
          existing = await origin();
          if (!existing) throw error;
        }
        existing = await origin();
        if (!existing) throw Error("GODOT_COPY_COMMIT_NOT_FOUND");
      }
      const selectedAfterCopy = await options.selection();
      if (selectedAfterCopy !== worldId && selectedAfterCopy !== targetWorldId) throw Error("GODOT_WORLD_CHANGED");
      const before = await domain("world.read", {id: targetWorldId});
      if (before?.world?.snapshot?.worldId !== targetWorldId || before.world.snapshot.body?.worldId !== targetWorldId) throw Error("GODOT_COPY_PROGRESS_IDENTITY_MISMATCH");
      godotCopyProgressIdentity(before.world.snapshot, targetWorldId, targetWorldId);
      if (expectedInitial && !isDeepStrictEqual(before.world.snapshot, expectedInitial)) throw Error("GODOT_COPY_SOURCE_CHECKPOINT_CHANGED");
      update({status: "running", stage: "prepare"});
      const content = await domain("content.status", {worldId: targetWorldId});
      if (content.backend !== "git") await domain("content.migrate.apply", {worldId: targetWorldId});
      await domain("godotWorld.prepareRebuildSource", {worldId: targetWorldId});
      const identity = await domain("godotWorld.prepareCopyRuntime", {worldId: targetWorldId});
      // The core exact-copy and fixed identity derivation own all source writes.
      // No progress, caller-selected context, OS path or draft content is supplied.
      update({status: "running", stage: "check", identity});
      const beforeOpen = await options.selection();
      if (beforeOpen !== worldId && beforeOpen !== targetWorldId) throw Error("GODOT_WORLD_CHANGED");
      if (beforeOpen !== targetWorldId) await options.open(targetWorldId);
      if (await options.selection() !== targetWorldId) throw Error("GODOT_WORLD_CHANGED");
      const rebuilt = await options.start(targetWorldId);
      if (rebuilt?.status !== "ready") throw Error("GODOT_COPY_REBUILD_NOT_READY");
      const descriptor = await domain("godotRuntime.describe", {worldId: targetWorldId});
      if (descriptor?.phase !== "formal" || descriptor.worldId !== targetWorldId || descriptor.copiedFromWorldId != null) throw Error("GODOT_COPY_APPLICATION_REQUIRED");
      if (!isDeepStrictEqual(descriptor.snapshot, before.world.snapshot)) throw Error("GODOT_COPY_PROGRESS_CHANGED");
      return update({status: "ready", buildId: descriptor.buildId, identity, rebuilt});
    } catch (error) {
      update({status: "failed", reason: String(error)});
      throw error;
    }
  }
  return {
    copy(value: unknown): Promise<Data> {
      const input = request(value), target = godotCopyTarget(input.worldId, input.operationId);
      const current = running.get(target); if (current) return current;
      if (occupied) return Promise.reject(Error("GODOT_COPY_BUSY"));
      occupied = true;
      const task = work(input).finally(() => {running.delete(target); occupied = false;});
      running.set(target, task); return task;
    },
    status(value: unknown) {
      const input = request(value);
      return states.get(godotCopyTarget(input.worldId, input.operationId)) ?? null;
    },
    get busy() { return occupied; },
  };
}
