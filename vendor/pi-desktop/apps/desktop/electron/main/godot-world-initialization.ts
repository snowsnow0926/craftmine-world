import fs from "node:fs";
import path from "node:path";
import {createHash, randomUUID} from "node:crypto";
import {INITIAL_LOAD_BRIDGE_PATH, INITIAL_LOAD_BASE_BRIDGE_PATH, initialLoadBridgeRepair} from "./godot-initial-load-repair";

type Data = Record<string, any>;
type Domain = (method: string, args: Data) => Promise<any>;
export type InitializationPreparation = {
  attempt: number; pending: boolean; error: string | null; status: Data | null; cancelled?: boolean;
  /** Exact durable state before this attempt clears its own cancel marker. */
  previousStatus?: Data;
};
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const SOURCE = new Set([".godot", ".gd", ".tscn", ".tres", ".gdshader", ".gdshaderinc", ".json", ".cfg", ".txt", ".md", ".csv", ".svg", ".obj", ".mtl", ".uid", ".png", ".jpg", ".jpeg", ".webp", ".glb", ".ogg", ".wav"]);

/** Keep each serialized source request below Core's 8 MiB request boundary.
 * Base64 expands binary assets; checking only their raw size is insufficient. */
export function initializationFileBatches<T extends {path: string; bytesBase64: string}>(files: T[]): T[][] {
  const batches: T[][] = []; let batch: T[] = [], bytes = 2;
  for (const file of files) {
    const size = Buffer.byteLength(JSON.stringify(file)) + 1;
    if (size > 7 * 1024 * 1024) throw Error("MANAGED_BASE_FILE_TOO_LARGE");
    if (batch.length && bytes + size > 7 * 1024 * 1024) {batches.push(batch); batch = []; bytes = 2;}
    batch.push(file); bytes += size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

/** Only unfinished work resumes automatically; terminal states require explicit retry. */
export function canAutomaticallyInitialize(status: Data | null | undefined): boolean {
  // The initialize transaction's raw record omits playable; initStatus includes it.
  return !!status && status.playable !== true && ["pending", "drafting", "building", "checked"].includes(status.status);
}

/** Preserve this finite host preparation code from the hash-checked job output. */
export function initializationJobFailure(current: Data): string {
  if (Array.isArray(current.output?.compile?.errors)
    && current.output.compile.errors.includes("GODOT_TASK_PATH_TOO_LONG")) return "GODOT_TASK_PATH_TOO_LONG";
  return current.blockedReason || current.interruptReason || current.error || `GODOT_JOB_${String(current.status).toUpperCase()}`;
}

/** Resume an authored base through the same durable project and executor APIs as editing. */
export function createGodotWorldInitializer(options: {
  worldsRoot: string; domain: Domain; selection: () => Promise<string | null>;
  firstLoad: (worldId: string, candidateId: string) => Promise<unknown>;
  cancelFirstLoad?: (worldId: string) => Promise<unknown>;
  initialLoadBridge?: (existingHash: string | undefined) => Buffer;
}) {
  const running = new Map<string, Promise<void>>();
  const failures = new Map<string, string>();
  const preparations = new Map<string, InitializationPreparation>();
  type Control = {cancelled: boolean; context?: Data; taskId?: string; jobId?: string; submitting?: boolean; cancelError?: unknown; cancelJob?: Promise<void>};
  const controls = new Map<string, Control>(), cancellations = new Map<string, Promise<Data>>();
  const cancelledWorlds = new Set<string>();
  let stopping = false;
  let nextAttempt = 0;
  const domain = options.domain;
  const cancelOwnedJob = async (worldId: string, control: Control) => {
    if (!control.jobId && control.submitting && control.context && control.taskId) {
      const latest = await domain("godotBuild.latest", {worldId, sessionId: control.context.sessionId});
      if (latest?.taskId === control.taskId) control.jobId = latest.jobId;
    }
    if (!control.jobId) return;
    control.cancelJob ??= Promise.resolve().then(async () => {
      const current = await domain("godotBuild.read", {worldId, jobId: control.jobId});
      if (!control.taskId || current.taskId !== control.taskId) throw Error("GODOT_INITIALIZATION_CANCEL_IDENTITY_MISMATCH");
      if (["blocked", "queued", "claimed", "running"].includes(current.status)) await domain("godotBuild.cancel", {worldId, jobId: control.jobId});
    }).catch(error => {control.cancelJob = undefined;throw error;});
    await control.cancelJob;
  };
  async function initialize(worldId: string, recover: boolean, preparation: InitializationPreparation, control: Control) {
    const check = () => {if (control.cancelled) throw Error("GODOT_INITIALIZATION_CANCELLED");};
    const call = async (method: string, args: Data) => {
      check();if (method === "godotBuild.start") control.submitting = true;
      const result = await domain(method, args);
      if (method === "godotBuild.start") {control.jobId = result.jobId;control.submitting = false;}
      check();return result;
    };
    if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(worldId)) throw Error("INVALID_WORLD_ID");
    let status = await call("godotWorld.initStatus", {worldId});
    preparation.previousStatus = status;
    if (recover && status.cancelled === true) {
      await call("godotWorld.initCancelClear", {worldId});
      status = await call("godotWorld.initStatus", {worldId});
    }
    preparation.status = status;
    if (status.playable) return;
    if (!recover && !canAutomaticallyInitialize(status)) return;
    if (recover && status.launchFailure) {
      const failure = status.launchFailure;
      if (failure.worldId !== worldId || failure.initId !== status.initId ||
        failure.candidateId !== status.candidateId || typeof failure.applicationId !== "string") throw Error("GODOT_INIT_LAUNCH_IDENTITY_MISMATCH");
      await call("godotWorld.initLaunchRetry", {worldId, initId: failure.initId,
        candidateId: failure.candidateId, applicationId: failure.applicationId});
      status = await call("godotWorld.initStatus", {worldId});
      preparation.status = status;
      if (status.playable) return;
      if (!canAutomaticallyInitialize(status)) throw Error("GODOT_INIT_LAUNCH_RETRY_UNCONFIRMED");
    }
    const directory = path.join(options.worldsRoot, worldId);
    const metadata = JSON.parse(fs.readFileSync(path.join(directory, "managed-base.json"), "utf8"));
    if (metadata.worldId !== worldId || !Array.isArray(metadata.files)) throw Error("MANAGED_BASE_IDENTITY_MISMATCH");
    const context = {projectId: "craftmine-world-initialization", sessionId: `create-${worldId}`, turnId: randomUUID()};
    control.context = context;
    let completed = false, opened = false;
    try {
    if(recover){
      const available=await call("task.recoverable",{projectId:context.projectId,worldId});
      const previous=(available.items??[]).find((item:Data)=>item.worldId===worldId&&item.binding?.sessionId===context.sessionId);
      if(previous){opened = true;await call("task.resume",{context,worldId,taskId:previous.taskId,generation:previous.generation});}
    }
    check();
    opened = true;
    const task = await domain("turn.begin", {context, selectedWorld: worldId,
      request: {id: `initialize-${worldId}`, text: "Initialize the selected authored base and confirm its first load."}});
    control.taskId = task.binding.taskId;
    check();
    const files: Array<{path: string; bytesBase64: string; sha256: string}> = [];
    const managedPaths = new Set(metadata.files.map((item: Data) => String(item.path)));
    for (const item of metadata.files) {
      const relative = String(item.path);
      if (relative.includes("\\") || relative.startsWith("/") || relative.includes(":") || relative.split("/").some((part: string) => !part || part === "." || part === "..")) throw Error("INVALID_MANAGED_BASE_PATH");
      const full = path.join(directory, ...relative.split("/"));
      let parent = directory;
      for (const part of relative.split("/")) { parent = path.join(parent, part); if (fs.lstatSync(parent).isSymbolicLink()) throw Error("MANAGED_BASE_LINK_DENIED"); }
      const bytes = fs.readFileSync(full);
      if (bytes.length !== item.bytes || sha(bytes) !== item.sha256) throw Error("MANAGED_BASE_FILE_CHANGED");
      if (relative.split("/").some(part => [".godot", ".import"].includes(part.toLowerCase()))) continue;
      const ext = path.extname(relative).toLowerCase();
      // Authored static GLB import policy is source. Godot's generated import
      // cache and arbitrary .import files are not. Core still validates the
      // measured policy and paired GLB bytes before accepting the patch.
      const importPolicy = relative.endsWith(".glb.import");
      if (ext === ".import" && !importPolicy) throw Error("MANAGED_BASE_IMPORT_POLICY_UNSUPPORTED");
      if (importPolicy && !managedPaths.has(relative.slice(0, -".import".length))) throw Error("MANAGED_BASE_IMPORT_MODEL_REQUIRED");
      if (SOURCE.has(ext) || importPolicy) {
        files.push({path: relative, bytesBase64: bytes.toString("base64"), sha256: sha(bytes)});
      }
    }
    files.sort((a, b) => a.path === "project.godot" ? -1 : b.path === "project.godot" ? 1 : a.path.localeCompare(b.path));
    if (files[0]?.path !== "project.godot") throw Error("PROJECT_CONFIG_REQUIRED");
    let project: Data;
    try { project = await call("godotProject.index", {context, worldId}); }
    catch (error) {
      if (!/GODOT_PROJECT_(?:NOT_FOUND|MISSING)/.test(String(error))) throw error;
      project = await call("godotProject.create", {context, worldId, toolCallId: `base-create-${worldId}`,
        baseBuild: task.binding.baseBuild, baseId: metadata.baseId, files: [{path: "project.godot", text: Buffer.from(files[0].bytesBase64, "base64").toString("utf8")}]});
    }
    const existing = new Map<string, string>();
    let offset = 0;
    do {
      const page = await call("godotProject.index", {context, worldId, offset, limit: 32});
      project = page;
      for (const file of page.files ?? []) existing.set(file.path, file.sha256);
      offset = page.nextOffset ?? 0;
    } while (offset);
    const missing = files.filter(file => !existing.has(file.path));
    if (missing.length) {
      // A checked project was already complete. Missing source after that point
      // may be an intentional edit and must not be reconstructed from the base.
      if (recover && (status.candidateId || status.status === "checked")) {
        throw Error("GODOT_INITIAL_SOURCE_MISSING");
      }
      for (const batch of initializationFileBatches(missing)) {
        const content = await call("content.status", {worldId});
        const installedFiles = batch.map(({path, bytesBase64}) => ({path, bytesBase64, expectedHash: null}));
        const operationId = `base-patch-${sha(JSON.stringify(installedFiles)).slice(0, 40)}`;
        project = await call("godotProject.applyFiles", {context, worldId, toolCallId: operationId,
          revision: project.revision, manifestHash: project.manifestHash, files: installedFiles,
          ...(content.backend === "git" ? {operation: {operationId, worldId, repoId: content.repoId, branchId: "main",
            expectedHeadOid: content.headOid, expectedAppliedOid: content.appliedOid, expectedProgressRevision: null}} : {})});
        for (const file of batch) existing.set(file.path, file.sha256);
      }
    }
    const contentStatus = await call("content.status", {worldId});
    if (contentStatus.backend !== "git") {
      await call("content.migrate.apply", {worldId});
      project = await call("godotProject.index", {context, worldId});
    }
    // Explicit retry may repair the exact bridge shipped before P1. The
    // managed-base directory stays immutable; this is a new Core/Git draft
    // revision and therefore requires a fresh build/candidate before adoption.
    if (recover && options.initialLoadBridge) {
      const existingBridgeHash = existing.get(INITIAL_LOAD_BRIDGE_PATH);
      const repair = initialLoadBridgeRepair(existingBridgeHash, options.initialLoadBridge(existingBridgeHash), existing.get(INITIAL_LOAD_BASE_BRIDGE_PATH));
      if (repair) {
        const latest = await call("godotWorld.initStatus", {worldId});
        if (latest.playable || latest.status === "confirmed" || latest.initId !== status.initId) {
          throw Error("GODOT_INITIAL_BRIDGE_REPAIR_OWNER_CHANGED");
        }
        if (!Number.isSafeInteger(latest.worldRevision) || latest.worldRevision < 0) {
          throw Error("GODOT_INITIAL_BRIDGE_REPAIR_REVISION_REQUIRED");
        }
        const content = await call("content.status", {worldId});
        if (content.backend !== "git") throw Error("GODOT_INITIAL_BRIDGE_REPAIR_REQUIRES_GIT");
        const operationId = `initial-bridge-${sha(JSON.stringify([project.manifestHash, repair])).slice(0, 40)}`;
        project = await call("godotProject.applyFiles", {context, worldId, toolCallId: operationId,
          revision: project.revision, manifestHash: project.manifestHash, files: [repair],
          initialLoadRepair: {initId: latest.initId},
          operation: {operationId, worldId, repoId: content.repoId, branchId: "main",
            expectedHeadOid: content.headOid, expectedAppliedOid: content.appliedOid, expectedProgressRevision: latest.worldRevision}});
      }
    }
    const candidates = await call("godotCandidate.list", {worldId});
    let candidateId = (candidates.items ?? []).find((item: Data) => item.status === "ready" && item.manifestHash === project.manifestHash)?.candidateId;
    if (!candidateId) {
      const gateDeadline = Date.now() + 150_000;
      while (true) {
        const gate = await call("godotExecutor.status", {});
        if (gate.buildAvailable && gate.checkAvailable) break;
        if (Date.now() > gateDeadline || gate.state === "unavailable") throw Error(gate.reason || "GODOT_EXECUTOR_UNAVAILABLE");
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      // Submission may commit even if its reply is lost. From this boundary,
      // only Core can describe the attempt; finalization is not preparation.
      preparation.pending = false;
      const job = await call("godotBuild.start", {context, worldId, toolCallId: `base-build-${project.manifestHash}`,
        revision: project.revision, manifestHash: project.manifestHash, mode: "check"});
      const deadline = Date.now() + 900_000;
      while (true) {
        const current = await call("godotBuild.read", {worldId, jobId: job.jobId});
        if (current.status === "passed") { candidateId = current.candidateId; break; }
        if (["failed", "cancelled", "interrupted", "blocked"].includes(current.status)) throw Error(initializationJobFailure(current));
        if (Date.now() > deadline) throw Error("GODOT_INITIALIZATION_TIMEOUT");
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    preparation.pending = false;
    const selected = await options.selection();check();
    if (candidateId && selected === worldId) await options.firstLoad(worldId, candidateId);
    check();
    completed = true;
    } finally {
      try {if (control.cancelled) await cancelOwnedJob(worldId, control);}
      catch (error) {control.cancelError = error;}
      if (opened) await domain("workspace.endTurn", {sessionId: context.sessionId, turnId: context.turnId, status: completed ? "completed" : control.cancelled ? "aborted" : "error"});
    }
  }
  const cancel = (worldId: string): Promise<Data> => {
    if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(worldId)) return Promise.reject(Error("INVALID_WORLD_ID"));
    const existing = cancellations.get(worldId);if (existing) return existing;
    cancelledWorlds.add(worldId);
    const control = controls.get(worldId);if (control) control.cancelled = true;
    const work = Promise.resolve().then(async () => {
      let failure: unknown;
      try {await options.cancelFirstLoad?.(worldId);if (control) await cancelOwnedJob(worldId, control);}
      catch (error) {failure = error;}
      await running.get(worldId);
      if (control?.cancelError) throw control.cancelError;
      if (failure) throw failure;
      const result = await domain("godotWorld.initCancel", {worldId});
      if (result?.worldId !== worldId || !["ready", "cancelled"].includes(result.status)) throw Error("GODOT_INITIALIZATION_CANCEL_UNCONFIRMED");
      const preparation = preparations.get(worldId);if (preparation) {preparation.cancelled = result.status === "cancelled";preparation.pending = false;preparation.error = null;}
      failures.delete(worldId);return {worldId, status: "cancelled", alreadyReady: result.status === "ready"};
    }).finally(() => cancellations.delete(worldId));
    cancellations.set(worldId, work);return work;
  };
  return {
    get busy() { return running.size > 0; },
    start(worldId: string, settings?: {recover?:boolean}) {
      if (stopping || cancellations.has(worldId) || (cancelledWorlds.has(worldId) && settings?.recover !== true)) return Promise.resolve();
      if (settings?.recover) cancelledWorlds.delete(worldId);
      if (!running.has(worldId)) {
        failures.delete(worldId);
        const preparation: InitializationPreparation = {attempt: ++nextAttempt, pending: true, error: null, status: null};
        preparations.set(worldId, preparation);
        const control: Control = {cancelled: false};controls.set(worldId, control);
        const work = initialize(worldId,settings?.recover===true, preparation, control).catch(error => {
          if (control.cancelled) {preparation.cancelled = true;return;}
          failures.set(worldId, String(error));
          if (preparation.pending) preparation.error = String(error);
        }).finally(() => { preparation.pending = false; running.delete(worldId);controls.delete(worldId); });
        running.set(worldId, work);
      }
      return running.get(worldId)!;
    },
    error: (worldId: string) => failures.get(worldId) ?? null,
    preparation: (worldId: string): InitializationPreparation | null => preparations.get(worldId) ?? null,
    running: (worldId: string) => running.has(worldId),
    cancel,
    async stopAll() {stopping = true;try {await Promise.all([...new Set([...running.keys(), ...cancellations.keys()])].map(cancel));} finally {stopping = false;}}
  };
}
