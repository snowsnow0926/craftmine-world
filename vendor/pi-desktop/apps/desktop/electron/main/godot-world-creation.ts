/**
 * Godot world creation for the product client.
 *
 * The renderer never builds a world. It asks for the delivered bases, submits a
 * base + start point + name, and then renders whatever the host reports. This
 * module owns the trusted half: it reads the base catalog that ships with the
 * client, materializes the trusted authored base source into a managed
 * directory, builds the initial progress document and hands it to the core's
 * durable `godotWorld.initialize` transaction. A world created here is
 * registered but NOT playable until the core reports `confirmed`.
 *
 * Nothing in this file invents progress, stages or a base: every value comes
 * from the catalog, the materialized project or the core.
 */
import fs from "node:fs";
import path from "node:path";
import {createHash, randomBytes} from "node:crypto";
import {pathToFileURL} from "node:url";
import {canAutomaticallyInitialize} from "./godot-world-initialization";
import {readPublishedWorldOptions} from "./godot-template-options";

export const PROGRESS_FORMAT = "craftmine.godot-progress/1";
/** Bases this client can actually create. Matches the core's accepted set. */
export const DELIVERED_GODOT_BASES = ["first-person", "top-down", "side-view", "mining-sandbox", "creation-sandbox"] as const;

export type GodotBaseTemplate = {
  id: string;
  label: string;
  kind: string;
  description: string;
  delivered: boolean;
  preview?: string;
  source?: {id: string; version: string; sha256: string};
  initialState?: string;
};

export type GodotBaseOption = {
  id: string;
  baseVersion: string;
  label: string;
  description: string;
  delivered: boolean;
  templates: GodotBaseTemplate[];
};

export type GodotCreateOptions = {
  create: boolean;
  createActions: boolean;
  bases: GodotBaseOption[];
};

export type GodotCreateRequest = { title: string; baseId: string; templateId: string; operationId: string };

export type CreationStageStatus = "pending" | "running" | "passed" | "failed" | "skipped";
export type CreationStage = { id: string; label: string; status: CreationStageStatus };
export type WorldCreation = {
  operationId: string;
  stage: string;
  stages: CreationStage[];
  progress: number;
  error: { code: string; message: string; stage: string; recoverable: boolean } | null;
  actions: string[];
};

const BASE_LABELS: Record<string, { label: string; description: string }> = {
  "creation-sandbox": { label: "造物世界 · 3D", description: "空白创造场地、物体布置、交互与连续创作" },
  "first-person": { label: "3D 第一人称", description: "摄像机、碰撞、装备与指向交互" },
  "top-down": { label: "2D 俯视", description: "瓦片地图、人物碰撞、区域交互与背包" },
  "side-view": { label: "2D 横版", description: "重力、跳跃、平台碰撞与检查点" },
  "mining-sandbox": { label: "2D 挖掘沙盒", description: "可挖掘地形、材料合成、建造与分块存档" },
};

const readJson = (file: string): Record<string, any> | null => {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
};

/**
 * Reads the shipped base catalog. A base is offered only when the catalog lists
 * it, the client ships its source directory and the core accepts its id.
 */
export function readGodotCreateOptions(input: {catalogFile: string; basesRoot: string}): GodotCreateOptions {
  const catalog = readJson(input.catalogFile);
  const bases: GodotBaseOption[] = [];
  for (const raw of Array.isArray(catalog?.bases) ? catalog!.bases : []) {
    const baseId = String(raw?.baseId ?? "");
    if (!DELIVERED_GODOT_BASES.includes(baseId as (typeof DELIVERED_GODOT_BASES)[number])) continue;
    const source = path.join(input.basesRoot, baseId);
    const delivered = fs.existsSync(path.join(source, "base_manifest.json")) || fs.existsSync(path.join(source, "manifest.json"));
    const templates: GodotBaseTemplate[] = (Array.isArray(raw?.templates) ? raw.templates : []).flatMap((template: any) => {
      const id = String(template?.id ?? "");
      if (!id) return [];
      return [{
        id,
        label: String(template?.label ?? id),
        kind: String(template?.kind ?? "example"),
        description: String(template?.description ?? ""),
        delivered,
      }];
    });
    if (baseId === "creation-sandbox" && delivered) templates.push(...readPublishedWorldOptions(input.basesRoot));
    bases.push({
      id: baseId,
      baseVersion: String(raw?.baseVersion ?? ""),
      label: BASE_LABELS[baseId]?.label ?? String(raw?.title ?? baseId),
      description: BASE_LABELS[baseId]?.description ?? String(raw?.title ?? ""),
      delivered,
      templates,
    });
  }
  return {create: true, createActions: true, bases};
}

export function validateGodotCreateRequest(value: unknown): GodotCreateRequest {  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title || title.length > 80 || /[\u0000-\u001f]/.test(title)) throw new Error("INVALID_WORLD_TITLE");
  const baseId = typeof raw.baseId === "string" ? raw.baseId : "";
  if (!DELIVERED_GODOT_BASES.includes(baseId as (typeof DELIVERED_GODOT_BASES)[number])) throw new Error("WORLD_BASE_UNAVAILABLE");
  const templateId = typeof raw.starterId === "string" && raw.starterId ? raw.starterId : "blank";
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(templateId)) throw new Error("WORLD_STARTER_UNAVAILABLE");
  // Stable operation identity: a retried submit must target the same world.
  const operationId = typeof raw.operationId === "string" && raw.operationId
    ? raw.operationId
    : randomBytes(16).toString("hex");
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(operationId)) throw new Error("INVALID_OPERATION_ID");
  return {title, baseId, templateId, operationId};
}

/** Deterministic portable world id for one operation (lowercase, tooling-safe). */
export function worldIdForOperation(operationId: string): string {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(operationId)) throw new Error("INVALID_OPERATION_ID");
  const digest = createHash("sha256").update(`craftmine.godot-world-op/1|${operationId}`).digest("hex");
  return `world-${digest.slice(0, 12)}`;
}

/** A world id that is portable across machines and accepted by the base tooling. */
export function portableWorldId(random: () => Buffer = () => randomBytes(6)): string {
  return `world-${random().toString("hex")}`;
}

/**
 * Finds the shipped `desktop/godot` directory. Packaged builds carry it under
 * resources; a development checkout is found by walking up from the compiled
 * main process. An explicit override exists for tests and unusual layouts.
 */
export function resolveGodotRoot(input: {resourcesPath?: string; startDir: string; override?: string}): string {
  const candidates: string[] = [];
  if (input.override) candidates.push(input.override);
  if (input.resourcesPath) candidates.push(path.join(input.resourcesPath, "godot"));
  let dir = input.startDir;
  for (let depth = 0; depth < 8; depth += 1) {
    candidates.push(path.join(dir, "desktop", "godot"));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "bases", "base-catalog.json"))) return candidate;
  }
  throw new Error("GODOT_BASES_UNAVAILABLE");
}

/** The core requires the envelope to name the same world and base as the request. */
export function buildInitialProgress(input: {
  worldId: string; baseId: string; baseVersion: string; stateVersion: number; body: Record<string, unknown>;
}): Record<string, unknown> {
  if (!input.worldId || !input.baseId || !Number.isInteger(input.stateVersion) || input.stateVersion < 1) {
    throw new Error("INVALID_GODOT_PROGRESS");
  }
  if (!input.body || typeof input.body !== "object" || Array.isArray(input.body)) throw new Error("INVALID_GODOT_PROGRESS");
  return {
    format: PROGRESS_FORMAT,
    worldId: input.worldId,
    baseId: input.baseId,
    baseVersion: input.baseVersion,
    stateVersion: input.stateVersion,
    body: {...input.body, worldId: input.worldId},
  };
}

/**
 * Reads the initial progress body that the base itself wrote into the
 * materialized project. A base that does not publish one cannot be created:
 * the client must not invent a starting state.
 */
export function readBaseInitialBody(projectDir: string): Record<string, unknown> {
  const candidates = [
    path.join(projectDir, "craftmine_initial_state.json"),
    path.join(projectDir, "world-build.json"),
    path.join(projectDir, "world.json"),
  ];
  for (const file of candidates) {
    const document = readJson(file);
    const body = document?.initialProgress ?? document?.initialState;
    if (body && typeof body === "object" && !Array.isArray(body) && Object.keys(body).length > 0) {
      // The base document names its own example world. The core requires the
      // progress body to either omit `worldId` or match the new world exactly.
      const {worldId: _exampleWorldId, ...rest} = body as Record<string, unknown>;
      return rest;
    }
  }
  throw new Error("BASE_INITIAL_STATE_MISSING");
}

const STAGE_LABELS = {
  materialize: "复制底座与登记世界",
  project: "建立工程源码",
  build: "首次构建",
  confirm: "确认可加载",
} as const;

const FAILED_STATUSES = new Set(["failed", "interrupted", "cancelled"]);

/**
 * Maps the core's `godotWorld.initStatus` to the renderer contract. Unknown
 * statuses stay visible as themselves instead of being rounded to a pass.
 */
export function initStatusToCreation(status: Record<string, any> | null | undefined): {
  state: "ready" | "initializing" | "failed";
  creation: WorldCreation | null;
} {
  if (!status || typeof status !== "object") return {state: "initializing", creation: null};
  const raw = String(status.status ?? "");
  const reason = status.reason == null ? "" : String(status.reason);
  const playable = status.playable === true;
  if (!playable && raw === "cancelled" && reason === "GODOT_INITIALIZATION_CANCELLED") return {
    state: "failed", creation: {operationId: String(status.initId ?? ""), stage: "cancelled", stages: [], progress: 0,
      error: {code: reason, message: "已取消准备。你的世界和创作内容已保留，可以重新准备。", stage: "cancelled", recoverable: true}, actions: ["retry", "details"]},
  };
  const order: Array<keyof typeof STAGE_LABELS> = ["materialize", "project", "build", "confirm"];
  // `pending` means the durable world record exists but no project head yet:
  // copying and registering already happened, the project source has not.
  const reached = (stage: keyof typeof STAGE_LABELS): CreationStageStatus => {
    if (playable) return "passed";
    if (raw === "pending") return stage === "materialize" ? "passed" : stage === "project" ? "running" : "pending";
    if (raw === "drafting") return stage === "build" ? "running" : stage === "confirm" ? "pending" : "passed";
    if (raw === "building") return stage === "confirm" ? "pending" : stage === "build" ? "running" : "passed";
    if (raw === "checked") return stage === "confirm" ? "running" : "passed";
    if (raw === "blocked" || FAILED_STATUSES.has(raw)) {
      // The core emits JOB_FAILED/JOB_ENDED only for an existing build/check job.
      // Do not infer this phase from an arbitrary failed status or reason prefix.
      const blockedAt = reason === "GODOT_INITIAL_LOAD_FAILED" && status.failureStage === "confirm"
        ? "confirm"
        : ["GODOT_EXECUTION_UNAVAILABLE", "GODOT_TASK_PATH_TOO_LONG", "GODOT_JOB_FAILED", "GODOT_JOB_ENDED"].includes(reason) ? "build" : "project";
      const index = order.indexOf(stage);
      const blockedIndex = order.indexOf(blockedAt);
      return index < blockedIndex ? "passed" : index === blockedIndex ? "failed" : "pending";
    }
    return "pending";
  };
  const stages: CreationStage[] = order.map((id) => ({id, label: STAGE_LABELS[id], status: reached(id)}));
  const failed = raw === "blocked" || FAILED_STATUSES.has(raw);
  const progress = playable ? 100
    : raw === "checked" ? 90
      : raw === "building" ? 75
        : raw === "drafting" ? 50
          : raw === "pending" ? 25 : failed && reason === "GODOT_INITIAL_LOAD_FAILED" ? 90 : failed ? 60 : 0;
  return {
    state: playable ? "ready" : failed ? "failed" : "initializing",
    creation: {
      operationId: String(status.initId ?? ""),
      stage: stages.find((stage) => stage.status === "failed" || stage.status === "running")?.id ?? stages.filter((stage) => stage.status === "passed").at(-1)?.id ?? "materialize",
      stages,
      progress,
      error: failed
        ? {code: reason || "GODOT_WORLD_INIT_FAILED", message: reason === "GODOT_INITIALIZATION_CANCELLED" ? "已取消准备。你的世界和创作内容已保留，可以重新准备。" : reason === "GODOT_INITIAL_LOAD_FAILED" ? "首次进入世界失败。重新初始化会修复可识别的旧版加载组件并重新检查；原始源码和存档会保留。" : reason === "GODOT_TASK_PATH_TOO_LONG" ? "任务目录路径过长，无法开始构建。请在较短的数据目录中重试。" : reason || "初始化未完成", stage: stages.find((s) => s.status === "failed")?.id ?? "build", recoverable: true}
        : null,
      // Only actions this module can actually perform are advertised.
      actions: failed ? ["retry", "details"] : ["details"],
    },
  };
}

// Compare only Core identity/state fields, never volatile presentation errors.
function preparationStatusKey(status: Record<string, any> | null): string {
  return JSON.stringify([status?.worldId, status?.initId, status?.status, status?.reason,
    status?.playable, status?.failureStage, status?.projectRevision, status?.worldRevision,
    status?.candidateId, status?.applicationId, status?.launchFailure]);
}

export type GodotCreationDependencies = {
  /** Absolute directory where per-world project sources live. */
  worldsRoot: string;
  catalogFile: string;
  basesRoot: string;
  domain: (method: string, params: Record<string, unknown>) => Promise<any>;
  materialize: (input: {baseId: string; worldId: string; template: string; out: string}) => unknown;
  makeWorldId?: () => string;
  /** Tell all world lists to reread durable state after retry scheduling/settlement. */
  changed?: (worldId: string) => void;
  initialization?: {start: (worldId: string, settings?: {recover?:boolean}) => Promise<void>; error: (worldId: string) => string | null; running: (worldId: string) => boolean;
    cancel?: (worldId: string) => Promise<unknown>; stopAll?: () => Promise<void>;
    preparation?: (worldId: string) => import("./godot-world-initialization").InitializationPreparation | null};
};

/**
 * Loads the shipped materializer lazily so the main process never bundles it
 * twice. The argument is an absolute filesystem path (not a URL); this is the
 * single place that converts it, so callers cannot double-encode it.
 */
export async function loadMaterializer(modulePath: string): Promise<GodotCreationDependencies["materialize"]> {
  if (typeof modulePath !== "string" || !path.isAbsolute(modulePath)) {
    throw new Error("MATERIALIZER_PATH_REQUIRED");
  }
  if (!fs.existsSync(modulePath)) throw new Error("MATERIALIZER_NOT_FOUND");
  const module = await import(pathToFileURL(modulePath).href) as {materializeBase: GodotCreationDependencies["materialize"]};
  if (typeof module.materializeBase !== "function") throw new Error("MATERIALIZER_INVALID");
  return module.materializeBase;
}

export function createGodotWorldFactory(deps: GodotCreationDependencies) {
  const options = readGodotCreateOptions({catalogFile: deps.catalogFile, basesRoot: deps.basesRoot});
  // A retry is scheduled before Core publishes its new build state. Keep that
  // interval visible without changing or discarding Core's previous failure.
  const retries = new Map<string, {work: Promise<void>; waiting: boolean; cancelled: boolean; previousAttempt: number | undefined}>();
  const retryFailures = new Map<string, {attempt: number; statusKey: string; error: string}>();
  const baseOf = (baseId: string): GodotBaseOption => {
    const base = options.bases.find((candidate) => candidate.id === baseId);
    if (!base || !base.delivered) throw new Error("WORLD_BASE_UNAVAILABLE");
    return base;
  };
  return {
    options,
    /** Creates the durable world record. Returns the core's init descriptor. */
    async create(payload: unknown): Promise<{id: string; title: string; state: string; creation: WorldCreation | null}> {
      const request = validateGodotCreateRequest(payload);
      const base = baseOf(request.baseId);
      const template = base.templates.find((candidate) => candidate.id === request.templateId);
      if (!template || !template.delivered) throw new Error("WORLD_STARTER_UNAVAILABLE");
      // The world identity is derived from the caller's stable operation id, so
      // a retried submit after a lost reply targets the same world instead of
      // creating a second one.
      const worldId = deps.makeWorldId ? deps.makeWorldId() : worldIdForOperation(request.operationId);
      const projectDir = path.join(deps.worldsRoot, worldId);
      // Only a directory this operation created may be cleaned up on failure.
      const ownsProjectDir = !fs.existsSync(projectDir);
      if (!ownsProjectDir) {
        const owner = readJson(path.join(projectDir, ".creation-owner.json"));
        if (owner?.operationId !== request.operationId || owner?.worldId !== worldId || owner?.baseId !== request.baseId || owner?.templateId !== request.templateId || owner?.title !== request.title) throw new Error("WORLD_EXISTS");
        const existing = await deps.domain("godotWorld.initStatus", {worldId});
        if (canAutomaticallyInitialize(existing)) void deps.initialization?.start(worldId);
        const mapped = initStatusToCreation(existing);
        return {id: worldId, title: request.title, state: mapped.state, creation: mapped.creation};
      }
      fs.mkdirSync(path.dirname(projectDir), {recursive: true});
      try {
        deps.materialize({baseId: request.baseId, worldId, template: request.templateId, out: projectDir});
        fs.writeFileSync(path.join(projectDir, ".creation-owner.json"), JSON.stringify({...request, worldId}), {flag: "wx"});
        const body = readBaseInitialBody(projectDir);
        const snapshot = buildInitialProgress({
          worldId, baseId: request.baseId, baseVersion: base.baseVersion,
          stateVersion: 1, body,
        });
        const result = await deps.domain("godotWorld.initialize", {
          worldId, title: request.title, baseId: request.baseId,
          baseBuild: `${request.baseId}-${base.baseVersion}`.replace(/[^A-Za-z0-9._-]/g, "-"),
          snapshot,
        });
        const mapped = initStatusToCreation(result?.init ?? null);
        if (canAutomaticallyInitialize(result?.init)) void deps.initialization?.start(worldId);
        return {id: worldId, title: request.title, state: mapped.state, creation: mapped.creation};
      } catch (error) {
        // A transport failure can hide a committed transaction. Ask the core
        // for the durable record first: a world that exists is a success to
        // report, never a directory to delete.
        let durable: {state: string; creation: WorldCreation | null} | null = null;
        let notRegistered = false;
        try {
          durable = initStatusToCreation(await deps.domain("godotWorld.initStatus", {worldId}));
        } catch (queryError) {
          // The core's own "no such initialization" answer proves the world was
          // never registered; any other failure leaves the outcome unknown.
          const detail = `${(queryError as {code?: string}).code ?? ""} ${String((queryError as Error).message ?? queryError)}`;
          notRegistered = /GODOT_WORLD_NOT_INITIALIZING|GODOT_WORLD_INIT_MISSING|WORLD_NOT_FOUND/.test(detail);
        }
        if (durable) return {id: worldId, title: request.title, state: durable.state, creation: durable.creation};
        if (notRegistered && ownsProjectDir) {
          // The core proved it never registered this world, and this operation
          // created the directory: the managed copy is safe to remove.
          fs.rmSync(projectDir, {recursive: true, force: true});
          throw error;
        }
        // Unknown outcome: keep the source and report a recoverable state that
        // the player can retry with the same operation id.
        throw Object.assign(new Error("WORLD_CREATE_UNCERTAIN"), {
          cause: error, worldId, operationId: request.operationId,
        });
      }
    },
    /** Real initialization status for one world, or null when the core is silent. */
    async status(worldId: string, options: {resume?: boolean} = {}): Promise<{state: string; creation: WorldCreation | null} | null> {
      try {
        const status = await deps.domain("godotWorld.initStatus", {worldId});
        const mapped = initStatusToCreation(status);
        const retry = retries.get(worldId);
        const preparation = deps.initialization?.preparation?.(worldId);
        if (!status.playable && mapped.state === "failed" && retry
          && (retry.waiting || preparation?.attempt === retry.previousAttempt || (preparation?.pending === true
            && (preparation.status == null || preparationStatusKey(preparation.status) === preparationStatusKey(status)
              || preparationStatusKey(preparation.previousStatus ?? null) === preparationStatusKey(status))))) {
          return {state: "initializing", creation: {
            operationId: mapped.creation?.operationId ?? "", stage: "retry", progress: 0,
            stages: [{id: "retry", label: "准备重新初始化", status: "running" as const}],
            error: null, actions: ["details"],
          }};
        }
        // This finite durable reason comes from the core's identity/hash-checked
        // job output. A stale in-memory recovery error cannot replace it.
        const remembered = retryFailures.get(worldId);
        const retryFailure = remembered && preparation?.attempt === remembered.attempt
          && preparationStatusKey(status) === remembered.statusKey ? remembered.error : null;
        if (remembered && !retryFailure) retryFailures.delete(worldId);
        if (status.playable || (!retryFailure
          && ["GODOT_TASK_PATH_TOO_LONG", "GODOT_INITIAL_LOAD_FAILED"].includes(mapped.creation?.error?.code ?? ""))) return mapped;
        // Once a retry has submitted a build/first-load, newer Core failures
        // are authoritative even while workspace.endTurn is still pending.
        if (mapped.state === "failed" && preparation && !preparation.pending && !preparation.error) return mapped;
        const failure = retryFailure ?? (preparation
          ? preparation.error
            ? preparationStatusKey(preparation.status) === preparationStatusKey(status) ? preparation.error : null
            : deps.initialization?.error(worldId)
          : deps.initialization?.error(worldId));
        if (failure === "Error: GODOT_TASK_PATH_TOO_LONG" || failure === "GODOT_TASK_PATH_TOO_LONG") {
          return initStatusToCreation({...status, status: "failed", playable: false, reason: "GODOT_TASK_PATH_TOO_LONG"});
        }
        if (failure && mapped.creation) {
          const code = failure.replace(/^Error: /, "");
          const message = code === "GODOT_INITIAL_BRIDGE_CUSTOMIZED"
            ? "世界的加载组件已被修改，无法自动修复。请保留当前世界，在新世界中重试，或查看详情处理修改。"
            : code === "GODOT_INITIAL_SOURCE_MISSING"
              ? "已检查的世界缺少源码文件。为保留你的修改，未自动补回；请从备份恢复缺失文件后重试。"
              : failure;
          if (retryFailure && mapped.creation.error
            && ["GODOT_TASK_PATH_TOO_LONG", "GODOT_INITIAL_LOAD_FAILED"].includes(mapped.creation.error.code)) {
            return {state: "failed", creation: {...mapped.creation, error: {...mapped.creation.error,
              message: `${mapped.creation.error.message} 本次重试准备失败：${message}`}}};
          }
          return {state: "failed", creation: {...mapped.creation, error: {code: "GODOT_INITIALIZATION_FAILED", message, stage: mapped.creation.stage, recoverable: true}, actions: ["retry", "details"]}};
        }
        if (options.resume !== false && canAutomaticallyInitialize(status) && !deps.initialization?.running(worldId) && fs.existsSync(path.join(deps.worldsRoot, worldId, ".creation-owner.json"))) void deps.initialization?.start(worldId);
        return mapped;
      } catch {
        return null;
      }
    },
    retry(worldId: string) {
      if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(worldId)) throw Error("INVALID_WORLD_ID");
      const initialization = deps.initialization;
      if (!initialization) throw Error("GODOT_BASES_UNAVAILABLE");
      const pending = retries.get(worldId);
      if (pending) return pending.work;
      retryFailures.delete(worldId);
      const retry = {work: Promise.resolve(), waiting: true, cancelled: false, previousAttempt: initialization.preparation?.(worldId)?.attempt};
      const rememberPreparationFailure = () => {
        const preparation = initialization.preparation?.(worldId);
        if (preparation?.error && preparation.status) retryFailures.set(worldId, {
          attempt: preparation.attempt, statusKey: preparationStatusKey(preparation.status), error: preparation.error,
        });
      };
      // Install the shared record before invoking any initializer callbacks.
      retries.set(worldId, retry);
      retry.work = Promise.resolve().then(async () => {
        if (retry.cancelled) return;
        if (initialization.running(worldId)) await initialization.start(worldId);
        if (retry.cancelled) return;
        retry.waiting = false;
        await initialization.start(worldId, {recover: true});
        // The production initializer resolves on failure and exposes its error.
        rememberPreparationFailure();
      }).catch(() => {
        // The panel acknowledges scheduling; an asynchronous preparation error
        // must appear on its next status read, not become an unhandled rejection.
        rememberPreparationFailure();
      }).finally(() => {retries.delete(worldId);deps.changed?.(worldId);});
      deps.changed?.(worldId);
      return retry.work;
    },
    async cancel(worldId: string) {
      if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(worldId)) throw Error("INVALID_WORLD_ID");
      const initialization = deps.initialization;if (!initialization?.cancel) throw Error("GODOT_INITIALIZATION_CANCEL_UNAVAILABLE");
      const retry = retries.get(worldId);if (retry) retry.cancelled = true;
      await initialization.cancel(worldId);await retry?.work;
      retryFailures.delete(worldId);return {worldId, status: "cancelled"};
    },
    async stopAll() {
      for (const retry of retries.values()) retry.cancelled = true;
      await deps.initialization?.stopAll?.();
      await Promise.all([...retries.values()].map(retry => retry.work));
    },
  };
}
