export type CraftmineLayout = {
  mode: "create" | "play";
  widths: { create: number; play: number };
  chatWidth: number;
};

const KEY = "craftmine.desktop.layout.v1";
export const CRAFTMINE_CHAT_MIN_WIDTH = 360;
export const CRAFTMINE_CHAT_MAX_WIDTH = 640;
export const CRAFTMINE_CHAT_DEFAULT_WIDTH = 400;
export function clampCraftmineChatWidth(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(CRAFTMINE_CHAT_MAX_WIDTH, Math.max(CRAFTMINE_CHAT_MIN_WIDTH, Math.round(value)))
    : CRAFTMINE_CHAT_DEFAULT_WIDTH;
}
const boundedWidth = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(720, Math.max(244, Math.round(value)))
    : fallback;

export function loadCraftmineLayout(storage: Pick<Storage, "getItem">): CraftmineLayout {
  try {
    const value = JSON.parse(storage.getItem(KEY) ?? "null");
    return {
      mode: value?.mode === "play" ? "play" : "create",
      chatWidth: clampCraftmineChatWidth(value?.chatWidth),
      widths: {
        create: boundedWidth(value?.widths?.create, 480),
        play: boundedWidth(value?.widths?.play, 720),
      },
    };
  } catch {
    return { mode: "create", widths: { create: 480, play: 720 }, chatWidth: CRAFTMINE_CHAT_DEFAULT_WIDTH };
  }
}

export function saveCraftmineLayout(storage: Pick<Storage, "setItem">, value: CraftmineLayout): void {
  try { storage.setItem(KEY, JSON.stringify(value)); } catch { /* Optional display preference only. */ }
}

export function changeCraftmineLayout(value: CraftmineLayout, mode: CraftmineLayout["mode"], currentWidth: number): CraftmineLayout {
  return { ...value, mode, widths: { ...value.widths, [value.mode]: boundedWidth(currentWidth, value.widths[value.mode]) } };
}

export function rememberCraftmineChatWidth(storage: Pick<Storage, "getItem" | "setItem">, width: number): void {
  saveCraftmineLayout(storage, { ...loadCraftmineLayout(storage), chatWidth: clampCraftmineChatWidth(width) });
}

export function isCraftmineWorldWorkspace(page: string, open: boolean, activeTabId: string | null, blocked = false): boolean {
  return page === "chat" && open && !blocked && activeTabId === "plugin:craftmine.world/world";
}

export function rememberCraftmineWidth(storage: Pick<Storage, "getItem" | "setItem">, width: number): void {
  const value = loadCraftmineLayout(storage);
  saveCraftmineLayout(storage, changeCraftmineLayout(value, value.mode, width));
}
