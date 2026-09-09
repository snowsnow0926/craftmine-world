/**
 * World navigation model for the left column.
 *
 * Presentation only: every fact rendered by the world list comes from the
 * Craftmine host (`craftmine.world` plugin -> Rust core). There is deliberately
 * no localStorage world store here — when the host bridge is unavailable the
 * panel reports that state instead of inventing a second world database.
 *
 * The host bridge is resolved from, in order:
 *   1. `globalThis.__craftmineWorldBridge` — the documented acceptance seam
 *      used by headless tests to drive the real plugin and Rust core.
 *   2. `window.piDesktop.pluginPanelInvoke` — the required renderer-to-panel
 *      channel (see docs/dispatch-reports/godot-parallel/D/INTERFACE_REQUEST.md).
 *   3. `api.pluginPanelInvoke` — the same channel once `lib/api.ts` exposes it.
 * Nothing else is consulted; a missing bridge is a visible state, not a
 * fallback dataset.
 */

export const CRAFTMINE_WORLD_PLUGIN_ID = "craftmine.world";
export const CRAFTMINE_WORLD_VIEW_ID = "world";

/**
 * Channels the left column needs. `world.list`, `world.create` and
 * `world.saveProgress` already exist in the plugin; `world.switch` is the one
 * handler the world surface still has to expose (it owns the live snapshot).
 */
export const CRAFTMINE_REQUIRED_CHANNELS = [
  "world.list",
  "world.create",
  "world.saveProgress",
  "world.switch",
  "workbench.capabilities",
  "verification.list",
] as const;

export type CraftmineWorldBase = {
  /** Real engine/runtime identifier, e.g. `craftmine-web/5`. */
  id: string;
  label: string;
  /** false when the host knows the base only as a planned/schema value. */
  delivered: boolean;
};

export type CraftmineWorldStarter = {
  id: string;
  label: string;
  delivered: boolean;
};

export type CraftmineWorldOrigin = "created" | "imported" | "godot-source" | "unknown";

export type CraftmineCheckStatus =
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "cancelled"
  | "interrupted";

export type CraftmineWorldEntry = {
  id: string;
  title: string;
  revision: number;
  updatedAt: number;
  /** Reported base/runtime label, or null when the host does not report one. */
  base: CraftmineWorldBase | null;
  origin: CraftmineWorldOrigin | null;
  check: { status: CraftmineCheckStatus; at: number } | null;
};

export type CraftmineWorldList = {
  worlds: CraftmineWorldEntry[];
  activeWorldId: string | null;
};

export type CraftmineWorldCapabilities = {
  bases: CraftmineWorldBase[];
  starters: CraftmineWorldStarter[];
  create: boolean;
  /** true/false when the host reports it; null when the host is silent. */
  switch: boolean | null;
};

export type CraftmineWorldCreateInput = {
  title: string;
  baseId?: string;
  starterId?: string;
};

export type CraftmineWorldCreateResult = { id: string; title: string };

export type CraftmineWorldSwitchResult =
  | { ok: true; activeWorldId: string }
  | { ok: false; error: string; activeWorldId: string | null };

export type CraftmineActiveTask = {
  sessionId: string;
  worldId: string;
  taskId: string;
  generation: number;
  running: boolean;
};

export type CraftmineAuxSummary = {
  id: string;
  label: string;
  count: number | null;
  detail: string;
};

export type CraftmineWorldBridge = {
  list(): Promise<CraftmineWorldList>;
  capabilities(worldId: string): Promise<CraftmineWorldCapabilities>;
  create(input: CraftmineWorldCreateInput): Promise<CraftmineWorldCreateResult>;
  /** Freezes the running world, saves it, then opens the target world. */
  switchWorld(id: string): Promise<CraftmineWorldSwitchResult>;
  /** Task bound to the currently viewed session, with the world that owns it. */
  activeTask(worldId: string): Promise<CraftmineActiveTask | null>;
  /** Raw host channel call, used by the auxiliary sections' real summaries. */
  call(channel: string, payload?: Record<string, unknown>): Promise<unknown>;
  onChanged(listener: () => void): () => void;
};

export type CraftmineHostInvoker = (
  pluginId: string,
  channel: string,
  payload: Record<string, unknown>,
) => Promise<unknown>;

type SeamHost = {
  __craftmineWorldBridge?: unknown;
  piDesktop?: { pluginPanelInvoke?: unknown; onCraftmineWorldChanged?: unknown };
};

function asInvoker(value: unknown): CraftmineHostInvoker | null {
  return typeof value === "function" ? (value as CraftmineHostInvoker) : null;
}

/** Resolves the host channel for panel calls; null when the host lacks it. */
export function craftmineHostInvoker(): CraftmineHostInvoker | null {
  const seam = (globalThis as SeamHost).__craftmineWorldBridge;
  if (seam && typeof seam === "object") {
    const invoke = asInvoker((seam as { invoke?: unknown }).invoke);
    if (invoke) return invoke;
  }
  const direct = asInvoker(seam);
  if (direct) return direct;
  const preload = asInvoker((globalThis as SeamHost).piDesktop?.pluginPanelInvoke);
  if (preload) return preload;
  return null;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asText = (value: unknown): string => (typeof value === "string" ? value : "");
const asNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const ORIGINS: CraftmineWorldOrigin[] = ["created", "imported", "godot-source"];
const CHECK_STATUSES: CraftmineCheckStatus[] = [
  "queued",
  "running",
  "passed",
  "failed",
  "cancelled",
  "interrupted",
];

function parseBase(value: unknown): CraftmineWorldBase | null {
  const raw = asRecord(value);
  const id = asText(raw.id);
  if (!id) return null;
  return {
    id,
    label: asText(raw.label) || id,
    // Only an explicit `delivered: true` counts; a silent host must never make
    // a planned base selectable.
    delivered: raw.delivered === true,
  };
}

function parseCheck(value: unknown): CraftmineWorldEntry["check"] {
  const raw = asRecord(value);
  const status = asText(raw.status) as CraftmineCheckStatus;
  if (!CHECK_STATUSES.includes(status)) return null;
  return { status, at: asNumber(raw.at) };
}

export function parseWorldList(value: unknown): CraftmineWorldList {
  const raw = asRecord(value);
  const worlds = Array.isArray(raw.worlds) ? raw.worlds : [];
  const seen = new Set<string>();
  return {
    activeWorldId: asText(raw.activeWorldId) || null,
    worlds: worlds.flatMap((item) => {
      const entry = asRecord(item);
      const id = asText(entry.id);
      // Duplicate ids would collide as React keys and misreconcile row state.
      if (!id || seen.has(id)) return [];
      seen.add(id);
      const origin = asText(entry.origin) as CraftmineWorldOrigin;
      return [
        {
          id,
          title: asText(entry.title) || id,
          revision: asNumber(entry.revision),
          updatedAt: asNumber(entry.updatedAt),
          base: parseBase(entry.base),
          origin: ORIGINS.includes(origin) ? origin : null,
          check: parseCheck(entry.check),
        },
      ];
    }),
  };
}

export function parseWorldCapabilities(value: unknown): CraftmineWorldCapabilities {
  const raw = asRecord(value);
  const bases = (Array.isArray(raw.bases) ? raw.bases : []).flatMap((item) => {
    const base = parseBase(item);
    return base ? [base] : [];
  });
  const starters = (Array.isArray(raw.starters) ? raw.starters : []).flatMap((item) => {
    const entry = asRecord(item);
    const id = asText(entry.id);
    if (!id) return [];
    return [{ id, label: asText(entry.label) || id, delivered: entry.delivered === true }];
  });
  return {
    bases,
    starters,
    create: raw.create !== false,
    switch: typeof raw.switch === "boolean" ? raw.switch : null,
  };
}

/**
 * Builds a bridge over a host invoker. Responses are validated here so the
 * components only ever see the model above.
 */
export function createCraftmineWorldBridge(
  invoke: CraftmineHostInvoker,
  options: { onChanged?: (listener: () => void) => () => void } = {},
): CraftmineWorldBridge {
  const call = async (channel: string, payload: Record<string, unknown> = {}) =>
    invoke(CRAFTMINE_WORLD_PLUGIN_ID, channel, payload);
  return {
    async list() {
      return parseWorldList(await call("world.list"));
    },
    async capabilities(worldId) {
      const [capabilities, options] = await Promise.all([
        // The gateway rejects a call whose worldId is not the selected world.
        call("workbench.capabilities", { worldId }).catch(() => null),
        call("world.createOptions", { worldId }).catch(() => null),
      ]);
      const parsed = parseWorldCapabilities({
        ...asRecord(capabilities),
        ...asRecord(options),
      });
      return parsed;
    },
    async create(input) {
      const payload: Record<string, unknown> = { title: input.title };
      if (input.baseId) payload.baseId = input.baseId;
      if (input.starterId) payload.starterId = input.starterId;
      const record = asRecord(await call("world.create", payload));
      const id = asText(record.id) || asText(asRecord(record.summary).id);
      if (!id) throw new Error("WORLD_CREATE_NO_ID");
      return { id, title: asText(record.title) || input.title };
    },
    async switchWorld(id) {
      try {
        const result = asRecord(await call("world.switch", { id }));
        const active = asText(result.activeWorldId) || id;
        return { ok: true, activeWorldId: active };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          activeWorldId: null,
        };
      }
    },
    async activeTask(worldId) {
      const result = asRecord(await call("task.current", { worldId }));
      const context = asRecord(result.context ?? result);
      const binding = asRecord(context.binding);
      const boundWorldId =
        asText(context.worldId) || asText(binding.worldId) || asText(result.worldId) || worldId;
      const taskId = asText(binding.taskId) || asText(context.taskId);
      const sessionId = asText(binding.sessionId) || asText(context.sessionId);
      if (!boundWorldId || !taskId || !sessionId) return null;
      return {
        sessionId,
        worldId: boundWorldId,
        taskId,
        generation: asNumber(context.generation),
        running: asText(context.status) === "running",
      };
    },
    call(channel, payload = {}) {
      return call(channel, payload);
    },
    onChanged(listener) {
      return options.onChanged?.(listener) ?? (() => {});
    },
  };
}

/** Bridge backed by the real host, or null when the channel is not wired. */
export function craftmineWorldBridge(): CraftmineWorldBridge | null {
  const invoke = craftmineHostInvoker();
  if (!invoke) return null;
  const seam = (globalThis as SeamHost).__craftmineWorldBridge;
  const onChanged = asRecord(seam).onChanged ?? (globalThis as SeamHost).piDesktop?.onCraftmineWorldChanged;
  return createCraftmineWorldBridge(invoke, {
    ...(typeof onChanged === "function"
      ? { onChanged: onChanged as (listener: () => void) => () => void }
      : {}),
  });
}

/* ------------------------------------------------------------------ labels */

export type CraftmineLang = "zh" | "en";

export function craftmineLang(language: string): CraftmineLang {
  return language.startsWith("zh") ? "zh" : "en";
}

/** Base label; never turns an unreported or planned base into a real one. */
export function worldBaseLabel(entry: CraftmineWorldEntry, lang: CraftmineLang): string {
  if (!entry.base) return lang === "zh" ? "底座未标注" : "Base not reported";
  if (entry.base.delivered) return entry.base.label;
  return lang === "zh" ? `${entry.base.label} · 规划中` : `${entry.base.label} · planned`;
}

export function worldBaseState(entry: CraftmineWorldEntry): "reported" | "planned" | "unreported" {
  if (!entry.base) return "unreported";
  return entry.base.delivered ? "reported" : "planned";
}

export function worldOriginLabel(entry: CraftmineWorldEntry, lang: CraftmineLang): string | null {
  if (entry.origin === "imported") return lang === "zh" ? "旧世界导入" : "Imported";
  if (entry.origin === "godot-source") return lang === "zh" ? "Godot 源码工程" : "Godot source";
  if (entry.origin === "created") return lang === "zh" ? "新建" : "Created";
  return null;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Recency text derived from the host's `updatedAt` only. */
export function worldRecency(updatedAt: number, now: number, lang: CraftmineLang): string {
  if (!updatedAt) return lang === "zh" ? "尚未保存进度" : "No saved progress";
  const delta = Math.max(0, now - updatedAt);
  if (delta < MINUTE) return lang === "zh" ? "刚刚保存" : "Saved just now";
  if (delta < HOUR) {
    const minutes = Math.floor(delta / MINUTE);
    return lang === "zh" ? `${minutes} 分钟前保存` : `Saved ${minutes}m ago`;
  }
  if (delta < DAY) {
    const hours = Math.floor(delta / HOUR);
    return lang === "zh" ? `${hours} 小时前保存` : `Saved ${hours}h ago`;
  }
  const days = Math.floor(delta / DAY);
  if (days < 30) return lang === "zh" ? `${days} 天前保存` : `Saved ${days}d ago`;
  const date = new Date(updatedAt);
  const text = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
  return lang === "zh" ? `${text} 保存` : `Saved ${text}`;
}

export function worldCheckLabel(
  check: CraftmineWorldEntry["check"],
  lang: CraftmineLang,
): string | null {
  if (!check) return null;
  const labels: Record<CraftmineCheckStatus, [string, string]> = {
    queued: ["检查排队中", "Check queued"],
    running: ["检查进行中", "Check running"],
    passed: ["检查通过", "Check passed"],
    failed: ["检查未通过", "Check failed"],
    cancelled: ["检查已取消", "Check cancelled"],
    interrupted: ["检查中断", "Check interrupted"],
  };
  return labels[check.status][lang === "zh" ? 0 : 1];
}

export function worldCheckTone(
  check: CraftmineWorldEntry["check"],
): "idle" | "busy" | "ok" | "bad" {
  if (!check) return "idle";
  if (check.status === "passed") return "ok";
  if (check.status === "failed" || check.status === "interrupted") return "bad";
  if (check.status === "cancelled") return "idle";
  return "busy";
}

/* ------------------------------------------------------------------ inputs */

export const CRAFTMINE_WORLD_TITLE_MAX = 80;

export function normalizeWorldTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, CRAFTMINE_WORLD_TITLE_MAX);
}

export function validateWorldTitle(value: string, lang: CraftmineLang): string | null {
  const title = normalizeWorldTitle(value);
  if (!title) return lang === "zh" ? "请先填写世界名称。" : "Enter a world name.";
  return null;
}

/* ---------------------------------------------------------------- ordering */

/** Active world first, then most recently saved, then title. */
export function sortWorldEntries(
  worlds: CraftmineWorldEntry[],
  activeWorldId: string | null,
): CraftmineWorldEntry[] {
  return [...worlds].sort((left, right) => {
    if (left.id === right.id) return 0;
    if (left.id === activeWorldId) return -1;
    if (right.id === activeWorldId) return 1;
    if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt;
    return left.title.localeCompare(right.title);
  });
}

/* ------------------------------------------------------------ switch plan */

export type CraftmineSwitchPlan =
  | { kind: "noop" }
  | { kind: "blocked"; reason: "busy" | "saving" | "unsupported" }
  | { kind: "switch"; targetId: string; taskStaysInWorld: string | null };

/**
 * Decides what a click on another world does. A running task never redirects:
 * the switch is allowed, but the plan reports the world that keeps the task.
 */
export function planWorldSwitch(input: {
  activeWorldId: string | null;
  targetId: string;
  busy: boolean;
  saving: boolean;
  switchSupported: boolean | null;
  activeTask: CraftmineActiveTask | null;
}): CraftmineSwitchPlan {
  if (input.targetId === input.activeWorldId) return { kind: "noop" };
  if (input.busy) return { kind: "blocked", reason: "busy" };
  if (input.saving) return { kind: "blocked", reason: "saving" };
  if (input.switchSupported === false) return { kind: "blocked", reason: "unsupported" };
  const task = input.activeTask;
  return {
    kind: "switch",
    targetId: input.targetId,
    taskStaysInWorld: task && task.worldId !== input.targetId ? task.worldId : null,
  };
}

/* ------------------------------------------------------------------ errors */

/** Maps host error codes to readable text; unknown text is kept verbatim. */
export function worldErrorMessage(raw: unknown, lang: CraftmineLang): string {
  const text = (raw instanceof Error ? raw.message : String(raw ?? "")).trim();
  if (!text) return lang === "zh" ? "世界操作失败，请重试。" : "The world operation failed.";
  const known: Record<string, [string, string]> = {
    SELECTED_WORLD_CHANGED: [
      "当前世界已改变，请刷新列表后重试。",
      "The selected world changed; refresh and try again.",
    ],
    SELECTED_WORLD_MISMATCH: [
      "界面选择的世界与主机当前世界不一致。",
      "The panel selection and the host world disagree.",
    ],
    WORLD_NOT_FOUND: ["这个世界已不存在。", "That world no longer exists."],
    CRAFTMINE_WORLD_BINDING_MISMATCH: [
      "任务绑定的世界与请求的世界不一致，未做改动。",
      "The task world and the requested world differ; nothing changed.",
    ],
    UNSUPPORTED_WORKBENCH_CHANNEL: [
      "主机尚未提供这个世界操作。",
      "The host does not provide that world operation yet.",
    ],
    WORLD_CREATE_NO_ID: ["主机创建世界后没有返回身份。", "The host returned no world identity."],
    ACTIVE_TASK_EXISTS: [
      "当前会话仍有进行中的任务，请先结束或停止。",
      "The current session still has a running task.",
    ],
  };
  const mapped = known[text];
  if (mapped) return mapped[lang === "zh" ? 0 : 1];
  if (/^Unsupported Craftmine panel operation$/i.test(text)) {
    return lang === "zh" ? "主机尚未提供这个世界操作。" : "The host does not provide that operation.";
  }
  return text;
}

/** Sections that group the existing auxiliary surfaces behind one expansion. */
export const CRAFTMINE_AUX_SECTION_IDS = [
  "works",
  "assets",
  "checks",
  "memory",
  "tasks",
  "backups",
] as const;

export type CraftmineAuxSectionId = (typeof CRAFTMINE_AUX_SECTION_IDS)[number];
