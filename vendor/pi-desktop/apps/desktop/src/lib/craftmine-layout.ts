export type CraftmineLayout = {
  mode: "create" | "play";
  widths: { create: number; play: number };
  chatWidth: number;
  /**
   * Which auxiliary sections the player expanded. Absent keys stay collapsed,
   * so a layout saved before the world list existed keeps working.
   */
  aux: Record<string, boolean>;
};

const KEY = "craftmine.desktop.layout.v1";
export const CRAFTMINE_CHAT_MIN_WIDTH = 360;
export const CRAFTMINE_CHAT_MAX_WIDTH = 640;
export const CRAFTMINE_CHAT_DEFAULT_WIDTH = 400;
export const CRAFTMINE_CREATE_DEFAULT_WIDTH = 480;
export const CRAFTMINE_PLAY_DEFAULT_WIDTH = 720;
/** Defaults for "reset layout"; also the shape used when storage is corrupt. */
export const CRAFTMINE_LAYOUT_DEFAULTS: CraftmineLayout = {
  mode: "create",
  widths: { create: CRAFTMINE_CREATE_DEFAULT_WIDTH, play: CRAFTMINE_PLAY_DEFAULT_WIDTH },
  chatWidth: CRAFTMINE_CHAT_DEFAULT_WIDTH,
  aux: {},
};
export function clampCraftmineChatWidth(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(CRAFTMINE_CHAT_MAX_WIDTH, Math.max(CRAFTMINE_CHAT_MIN_WIDTH, Math.round(value)))
    : CRAFTMINE_CHAT_DEFAULT_WIDTH;
}
const boundedWidth = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(720, Math.max(244, Math.round(value)))
    : fallback;

const parseAux = (value: unknown): Record<string, boolean> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([key, expanded]) => typeof key === "string" && typeof expanded === "boolean")
          .slice(0, 16),
      ) as Record<string, boolean>
    : {};

export function loadCraftmineLayout(storage: Pick<Storage, "getItem">): CraftmineLayout {
  try {
    const value = JSON.parse(storage.getItem(KEY) ?? "null");
    return {
      mode: value?.mode === "play" ? "play" : "create",
      chatWidth: clampCraftmineChatWidth(value?.chatWidth),
      aux: parseAux(value?.aux),
      widths: {
        create: boundedWidth(value?.widths?.create, CRAFTMINE_CREATE_DEFAULT_WIDTH),
        play: boundedWidth(value?.widths?.play, CRAFTMINE_PLAY_DEFAULT_WIDTH),
      },
    };
  } catch {
    return { ...CRAFTMINE_LAYOUT_DEFAULTS, widths: { ...CRAFTMINE_LAYOUT_DEFAULTS.widths } };
  }
}

export function saveCraftmineLayout(storage: Pick<Storage, "setItem">, value: CraftmineLayout): void {
  try { storage.setItem(KEY, JSON.stringify(value)); } catch { /* Optional display preference only. */ }
}

/**
 * Writes the documented defaults and returns them. The caller keeps the mode
 * it is currently in, so resetting a dragged width does not also flip the
 * workspace out of play mode.
 */
export function resetCraftmineLayout(
  storage: Pick<Storage, "setItem">,
  mode: CraftmineLayout["mode"] = "create",
): CraftmineLayout {
  const value: CraftmineLayout = {
    ...CRAFTMINE_LAYOUT_DEFAULTS,
    mode,
    widths: { ...CRAFTMINE_LAYOUT_DEFAULTS.widths },
    aux: {},
  };
  saveCraftmineLayout(storage, value);
  return value;
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

/** Remembers one auxiliary section's expansion without touching the rest. */
export function rememberCraftmineAux(
  storage: Pick<Storage, "getItem" | "setItem">,
  section: string,
  expanded: boolean,
): void {
  const value = loadCraftmineLayout(storage);
  saveCraftmineLayout(storage, { ...value, aux: { ...value.aux, [section]: expanded } });
}
