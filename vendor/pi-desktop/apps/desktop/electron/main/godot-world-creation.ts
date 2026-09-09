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

export const PROGRESS_FORMAT = "craftmine.godot-progress/1";
/** Bases this client can actually create. Matches the core's accepted set. */
export const DELIVERED_GODOT_BASES = ["first-person", "top-down", "side-view"] as const;

export type GodotBaseTemplate = {
  id: string;
  label: string;
  kind: string;
  description: string;
  delivered: boolean;
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
  "first-person": { label: "3D 第一人称", description: "摄像机、碰撞、装备与指向交互" },
  "top-down": { label: "2D 俯视", description: "瓦片地图、人物碰撞、区域交互与背包" },
  "side-view": { label: "2D 横版", description: "重力、跳跃、平台碰撞与检查点" },
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
    body: input.body,
  };
}

/**
 * Reads the initial progress body that the base itself wrote into the
 * materialized project. A base that does not publish one cannot be created:
 * the client must not invent a starting state.
 */
export function readBaseInitialBody(projectDir: string): Record<string, unknown> {
  const candidates = [
    path.join(projectDir, "world-build.json"),
    path.join(projectDir, "world.json"),
    path.join(projectDir, "craftmine_initial_state.json"),
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
      const blockedAt = reason === "GODOT_EXECUTION_UNAVAILABLE" ? "build" : "project";
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
          : raw === "pending" ? 25 : failed ? 60 : 0;
  return {
    state: playable ? "ready" : failed ? "failed" : "initializing",
    creation: {
      operationId: String(status.initId ?? ""),
      stage: stages.find((stage) => stage.status === "running")?.id ?? stages.filter((stage) => stage.status === "passed").at(-1)?.id ?? "materialize",
      stages,
      progress,
      error: failed
        ? {code: reason || "GODOT_WORLD_INIT_FAILED", message: reason || "初始化未完成", stage: stages.find((s) => s.status === "failed")?.id ?? "build", recoverable: true}
        : null,
      // Only actions this module can actually perform are advertised.
      actions: failed ? ["retry", "details"] : ["details"],
    },
  };
}

export type GodotCreationDependencies = {
  /** Absolute directory where per-world project sources live. */
  worldsRoot: string;
  catalogFile: string;
  basesRoot: string;
  domain: (method: string, params: Record<string, unknown>) => Promise<any>;
  materialize: (input: {baseId: string; worldId: string; template: string; out: string}) => unknown;
  makeWorldId?: () => string;
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
      if (!ownsProjectDir) throw new Error("WORLD_EXISTS");
      fs.mkdirSync(path.dirname(projectDir), {recursive: true});
      try {
        deps.materialize({baseId: request.baseId, worldId, template: request.templateId, out: projectDir});
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
    async status(worldId: string): Promise<{state: string; creation: WorldCreation | null} | null> {
      try {
        return initStatusToCreation(await deps.domain("godotWorld.initStatus", {worldId}));
      } catch {
        return null;
      }
    },
  };
}
