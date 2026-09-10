import fs from "node:fs";
import path from "node:path";
import {createHash, randomUUID} from "node:crypto";

type Data = Record<string, any>;
type Domain = (method: string, args: Data) => Promise<any>;
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const SOURCE = new Set([".godot", ".gd", ".tscn", ".tres", ".gdshader", ".gdshaderinc", ".json", ".cfg", ".txt", ".md", ".csv", ".svg", ".obj", ".mtl", ".uid", ".png", ".jpg", ".jpeg", ".webp", ".glb", ".ogg", ".wav"]);

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
}) {
  const running = new Map<string, Promise<void>>();
  const failures = new Map<string, string>();
  const domain = options.domain;
  async function initialize(worldId: string, recover=false) {
    if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(worldId)) throw Error("INVALID_WORLD_ID");
    let status = await domain("godotWorld.initStatus", {worldId});
    if (status.playable) return;
    if (!recover && !canAutomaticallyInitialize(status)) return;
    if (recover && status.launchFailure) {
      const failure = status.launchFailure;
      if (failure.worldId !== worldId || failure.initId !== status.initId ||
        failure.candidateId !== status.candidateId || typeof failure.applicationId !== "string") throw Error("GODOT_INIT_LAUNCH_IDENTITY_MISMATCH");
      await domain("godotWorld.initLaunchRetry", {worldId, initId: failure.initId,
        candidateId: failure.candidateId, applicationId: failure.applicationId});
      status = await domain("godotWorld.initStatus", {worldId});
      if (status.playable) return;
      if (!canAutomaticallyInitialize(status)) throw Error("GODOT_INIT_LAUNCH_RETRY_UNCONFIRMED");
    }
    const directory = path.join(options.worldsRoot, worldId);
    const metadata = JSON.parse(fs.readFileSync(path.join(directory, "managed-base.json"), "utf8"));
    if (metadata.worldId !== worldId || !Array.isArray(metadata.files)) throw Error("MANAGED_BASE_IDENTITY_MISMATCH");
    const context = {projectId: "craftmine-world-initialization", sessionId: `create-${worldId}`, turnId: randomUUID()};
    if(recover){
      const available=await domain("task.recoverable",{projectId:context.projectId,worldId});
      const previous=(available.items??[]).find((item:Data)=>item.worldId===worldId&&item.binding?.sessionId===context.sessionId);
      if(previous)await domain("task.resume",{context,worldId,taskId:previous.taskId,generation:previous.generation});
    }
    const task = await domain("turn.begin", {context, selectedWorld: worldId,
      request: {id: `initialize-${worldId}`, text: "Initialize the selected authored base and confirm its first load."}});
    let completed = false;
    try {
    const files: Array<{path: string; bytesBase64: string; sha256: string}> = [];
    for (const item of metadata.files) {
      const relative = String(item.path);
      if (relative.includes("\\") || relative.startsWith("/") || relative.includes(":") || relative.split("/").some((part: string) => !part || part === "." || part === "..")) throw Error("INVALID_MANAGED_BASE_PATH");
      const full = path.join(directory, ...relative.split("/"));
      let parent = directory;
      for (const part of relative.split("/")) { parent = path.join(parent, part); if (fs.lstatSync(parent).isSymbolicLink()) throw Error("MANAGED_BASE_LINK_DENIED"); }
      const bytes = fs.readFileSync(full);
      if (bytes.length !== item.bytes || sha(bytes) !== item.sha256) throw Error("MANAGED_BASE_FILE_CHANGED");
      const ext = path.extname(relative).toLowerCase();
      if (SOURCE.has(ext)) files.push({path: relative, bytesBase64: bytes.toString("base64"), sha256: sha(bytes)});
    }
    files.sort((a, b) => a.path === "project.godot" ? -1 : b.path === "project.godot" ? 1 : a.path.localeCompare(b.path));
    if (files[0]?.path !== "project.godot") throw Error("PROJECT_CONFIG_REQUIRED");
    let project: Data;
    try { project = await domain("godotProject.index", {context, worldId}); }
    catch (error) {
      if (!/GODOT_PROJECT_(?:NOT_FOUND|MISSING)/.test(String(error))) throw error;
      project = await domain("godotProject.create", {context, worldId, toolCallId: `base-create-${worldId}`,
        baseBuild: task.binding.baseBuild, baseId: metadata.baseId, files: [{path: "project.godot", text: Buffer.from(files[0].bytesBase64, "base64").toString("utf8")}]});
    }
    const existing = new Map<string, string>();
    let offset = 0;
    do {
      const page = await domain("godotProject.index", {context, worldId, offset, limit: 32});
      project = page;
      for (const file of page.files ?? []) existing.set(file.path, file.sha256);
      offset = page.nextOffset ?? 0;
    } while (offset);
    const missing = files.filter(file => !existing.has(file.path));
    if (missing.length) {
      const content = await domain("content.status", {worldId});
      const installedFiles = missing.map(({path, bytesBase64}) => ({path, bytesBase64, expectedHash: null}));
      const operationId = `base-patch-${sha(JSON.stringify(installedFiles)).slice(0, 40)}`;
      project = await domain("godotProject.applyFiles", {context, worldId, toolCallId: operationId,
        revision: project.revision, manifestHash: project.manifestHash, files: installedFiles,
        ...(content.backend === "git" ? {operation: {operationId, worldId, repoId: content.repoId, branchId: "main",
          expectedHeadOid: content.headOid, expectedAppliedOid: content.appliedOid, expectedProgressRevision: null}} : {})});
    }
    const contentStatus = await domain("content.status", {worldId});
    if (contentStatus.backend !== "git") {
      await domain("content.migrate.apply", {worldId});
      project = await domain("godotProject.index", {context, worldId});
    }
    const candidates = await domain("godotCandidate.list", {worldId});
    let candidateId = (candidates.items ?? []).find((item: Data) => item.status === "ready" && item.manifestHash === project.manifestHash)?.candidateId;
    if (!candidateId) {
      const gateDeadline = Date.now() + 150_000;
      while (true) {
        const gate = await domain("godotExecutor.status", {});
        if (gate.buildAvailable && gate.checkAvailable) break;
        if (Date.now() > gateDeadline || gate.state === "unavailable") throw Error(gate.reason || "GODOT_EXECUTOR_UNAVAILABLE");
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      const job = await domain("godotBuild.start", {context, worldId, toolCallId: `base-build-${project.manifestHash}`,
        revision: project.revision, manifestHash: project.manifestHash, mode: "check"});
      const deadline = Date.now() + 900_000;
      while (true) {
        const current = await domain("godotBuild.read", {worldId, jobId: job.jobId});
        if (current.status === "passed") { candidateId = current.candidateId; break; }
        if (["failed", "cancelled", "interrupted", "blocked"].includes(current.status)) throw Error(initializationJobFailure(current));
        if (Date.now() > deadline) throw Error("GODOT_INITIALIZATION_TIMEOUT");
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    if (candidateId && await options.selection() === worldId) await options.firstLoad(worldId, candidateId);
    completed = true;
    } finally {
      await domain("workspace.endTurn", {sessionId: context.sessionId, turnId: context.turnId, status: completed ? "completed" : "error"});
    }
  }
  return {
    get busy() { return running.size > 0; },
    start(worldId: string, settings?: {recover?:boolean}) {
      if (!running.has(worldId)) {
        failures.delete(worldId);
        const work = initialize(worldId,settings?.recover===true).catch(error => {failures.set(worldId, String(error));}).finally(() => running.delete(worldId));
        running.set(worldId, work);
      }
      return running.get(worldId)!;
    },
    error: (worldId: string) => failures.get(worldId) ?? null,
    running: (worldId: string) => running.has(worldId),
  };
}
