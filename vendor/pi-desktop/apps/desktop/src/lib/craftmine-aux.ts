/**
 * Auxiliary world sections for the left column.
 *
 * Each section groups an existing surface behind one on-demand expansion. The
 * row summaries are read from the real host channels; a section whose channel
 * does not exist yet renders as unreported instead of showing invented data.
 */
import type {
  CraftmineAuxSectionId,
  CraftmineAuxSummary,
  CraftmineLang,
  CraftmineWorldBridge,
} from "./craftmine-worlds";

export type CraftmineAuxSurface =
  | { kind: "workbench"; tab: string }
  | { kind: "checks" }
  | { kind: "world" }
  | { kind: "assets" };

export type CraftmineAuxSection = {
  id: CraftmineAuxSectionId;
  label: Record<CraftmineLang, string>;
  /** Where the full surface lives inside the world panel. */
  surface: CraftmineAuxSurface;
  /** Host channel used for the row summary; null when none exists yet. */
  channel: string | null;
  note: Record<CraftmineLang, string>;
};

export const CRAFTMINE_AUX_SECTIONS: CraftmineAuxSection[] = [
  {
    id: "works",
    label: { zh: "作品", en: "Works" },
    surface: { kind: "workbench", tab: "library" },
    channel: "library.search",
    note: { zh: "可复用的对象、玩法与创作。", en: "Reusable objects, gameplay and creations." },
  },
  {
    id: "assets",
    label: { zh: "素材", en: "Assets" },
    surface: { kind: "assets" },
    channel: "asset.search",
    note: {
      zh: "本地素材库：按版本浏览、预览与导入，不自动应用世界。",
      en: "Local asset library: browse, preview and import by version; never applied automatically.",
    },
  },
  {
    id: "checks",
    label: { zh: "检查", en: "Checks" },
    surface: { kind: "checks" },
    channel: "verification.list",
    note: { zh: "当前世界的后台检查记录。", en: "Background checks for this world." },
  },
  {
    id: "memory",
    label: { zh: "记忆", en: "Memory" },
    surface: { kind: "workbench", tab: "memory" },
    channel: "memory.search",
    note: { zh: "仅属于当前世界的记忆。", en: "Memories that belong to this world." },
  },
  {
    id: "tasks",
    label: { zh: "任务", en: "Tasks" },
    surface: { kind: "workbench", tab: "task" },
    channel: "task.current",
    note: {
      zh: "当前会话绑定的创作任务，以及可重新接续的中断草稿。",
      en: "The task bound to this session and any interrupted drafts that can be resumed.",
    },
  },
  {
    id: "backups",
    label: { zh: "备份", en: "Backups" },
    surface: { kind: "workbench", tab: "backup" },
    channel: "backup.status",
    note: { zh: "备份状态与导出。", en: "Backup status and export." },
  },
];

export function craftmineAuxSection(id: CraftmineAuxSectionId): CraftmineAuxSection {
  const found = CRAFTMINE_AUX_SECTIONS.find((section) => section.id === id);
  if (!found) throw new Error(`UNKNOWN_AUX_SECTION:${id}`);
  return found;
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * Reads the real row summary for one section. Returns null when the host does
 * not provide the channel, so the row can say so instead of guessing.
 */
export async function loadAuxSummary(
  bridge: CraftmineWorldBridge,
  worldId: string,
  id: CraftmineAuxSectionId,
): Promise<CraftmineAuxSummary | null> {
  const section = craftmineAuxSection(id);
  if (!section.channel) return null;
  const payload: Record<string, unknown> = { worldId };
  if (section.channel === "library.search" || section.channel === "memory.search") {
    payload.query = "";
    payload.limit = 5;
  }
  if (section.channel === "verification.list") {
    payload.offset = 0;
    payload.limit = 5;
  }
  if (section.channel === "asset.search") {
    payload.scope = "local-library";
    payload.offset = 0;
    payload.limit = 5;
  }
  const result = await bridge.call(section.channel, payload);
  const raw = record(result);
  const items = list(raw.items ?? result);
  switch (id) {
    case "works": {
      const count = typeof raw.total === "number" ? raw.total : items.length;
      return { id, label: section.label.zh, count, detail: `${count}` };
    }
    case "assets": {
      const count = typeof raw.total === "number" ? raw.total : items.length;
      const truncated = raw.truncated === true;
      return { id, label: section.label.zh, count, detail: truncated ? "…" : `${count}` };
    }
    case "checks": {
      const first = record(items[0]);
      const status = text(first.status);
      return { id, label: section.label.zh, count: items.length, detail: status };
    }
    case "memory": {
      const count = typeof raw.total === "number" ? raw.total : items.length;
      return { id, label: section.label.zh, count, detail: `${count}` };
    }
    case "tasks": {
      const context = record(raw.context ?? raw);
      const status = text(context.status);
      const taskId = text(record(context.binding).taskId) || text(context.taskId);
      // A recoverable draft list is a separate real read. When the host does
      // not expose it, the row keeps reporting only the bound task.
      const recoverable = await bridge.call("task.recoverable", { worldId }).catch(() => null);
      const drafts = list(record(recoverable).items);
      const resumable = drafts.length > 0 ? `可接续 ${drafts.length} 项草稿` : "";
      return {
        id,
        label: section.label.zh,
        count: taskId ? 1 : 0,
        detail: [status || (taskId ? "bound" : ""), resumable].filter(Boolean).join(" · "),
      };
    }
    case "backups": {
      const status = text(raw.status) || text(raw.state);
      return { id, label: section.label.zh, count: null, detail: status };
    }
    default:
      return null;
  }
}

/** Human text for a summary row; empty when the host reported nothing. */
export function auxSummaryText(
  summary: CraftmineAuxSummary | null,
  lang: CraftmineLang,
): string {
  if (!summary) return lang === "zh" ? "接口未接入" : "Not connected";
  const parts: string[] = [];
  if (summary.count !== null) parts.push(lang === "zh" ? `${summary.count} 项` : `${summary.count}`);
  if (summary.detail) parts.push(summary.detail);
  return parts.join(" · ") || (lang === "zh" ? "暂无内容" : "Empty");
}
