export type CraftmineLayout = {
  mode: "create" | "play";
  overlay: CraftmineOverlay;
  widths: { create: number; play: number };
  chatWidth: number;
  /**
   * Which auxiliary sections the player expanded. Absent keys stay collapsed,
   * so a layout saved before the world list existed keeps working.
   */
  aux: Record<string, boolean>;
  /**
   * Enter play — the world filling the whole workspace — when a world becomes
   * active. On by default, and only the visible 游玩/回到创作 controls state it;
   * an automatic switch never rewrites it.
   */
  playWhenWorldActivates: boolean;
  /**
   * The world the automatic switch already ran for. Remembering it keeps a
   * reload, an ordinary re-render or an explicit return to create from being
   * overridden by the same activation again.
   */
  enteredWorldId: string | null;
};

export type CraftmineOverlay = "closed" | "compact" | "full";

const KEY = "craftmine.desktop.layout.v1";
export const CRAFTMINE_CHAT_MIN_WIDTH = 360;
export const CRAFTMINE_CHAT_MAX_WIDTH = 640;
export const CRAFTMINE_CHAT_DEFAULT_WIDTH = 400;
export const CRAFTMINE_CREATE_DEFAULT_WIDTH = 480;
export const CRAFTMINE_PLAY_DEFAULT_WIDTH = 720;
/** Defaults for "reset layout"; also the shape used when storage is corrupt. */
export const CRAFTMINE_LAYOUT_DEFAULTS: CraftmineLayout = {
  mode: "create",
  overlay: "closed",
  widths: { create: CRAFTMINE_CREATE_DEFAULT_WIDTH, play: CRAFTMINE_PLAY_DEFAULT_WIDTH },
  chatWidth: CRAFTMINE_CHAT_DEFAULT_WIDTH,
  aux: {},
  playWhenWorldActivates: true,
  enteredWorldId: null,
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

const parseWorldId = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

export function loadCraftmineLayout(storage: Pick<Storage, "getItem">): CraftmineLayout {
  try {
    const value = JSON.parse(storage.getItem(KEY) ?? "null");
    return {
      mode: value?.mode === "play" ? "play" : "create",
      // Older saved layouts have no overlay preference.
      overlay: value?.overlay === "compact" || value?.overlay === "full" ? value.overlay : "closed",
      chatWidth: clampCraftmineChatWidth(value?.chatWidth),
      aux: parseAux(value?.aux),
      widths: {
        create: boundedWidth(value?.widths?.create, CRAFTMINE_CREATE_DEFAULT_WIDTH),
        play: boundedWidth(value?.widths?.play, CRAFTMINE_PLAY_DEFAULT_WIDTH),
      },
      // Entering a world fills the workspace unless the player turned it off
      // with 创作; a stored layout from before this option keeps the default.
      playWhenWorldActivates: value?.playWhenWorldActivates !== false,
      enteredWorldId: parseWorldId(value?.enteredWorldId),
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
    playWhenWorldActivates: mode === "play",
    widths: { ...CRAFTMINE_LAYOUT_DEFAULTS.widths },
    aux: {},
  };
  saveCraftmineLayout(storage, value);
  return value;
}

export function changeCraftmineLayout(
  value: CraftmineLayout,
  mode: CraftmineLayout["mode"],
  currentWidth: number,
  options: { explicit?: boolean } = {},
): CraftmineLayout {
  return {
    ...value,
    mode,
    overlay: "closed",
    widths: { ...value.widths, [value.mode]: boundedWidth(currentWidth, value.widths[value.mode]) },
    // Only a visible control states the preference; entering play for a new
    // world must not silently become "always enter play".
    ...(options.explicit ? { playWhenWorldActivates: mode === "play" } : {}),
  };
}

export type CraftmineActivationDecision = {
  /** Switch the workspace into play now. */
  switchToPlay: boolean;
  /** The activation marker to store, or the previous one when nothing changed. */
  enteredWorldId: string | null;
};

/**
 * A world becoming active is the only event that may change the workspace on
 * its own, and it may do so once per world. The decision is pure so the
 * automatic switch is checkable without a renderer: entering a world fills the
 * workspace by default, an explicit return to create is not re-applied, and an
 * already playing workspace is left alone.
 */
export function decideCraftmineActivation(input: {
  worldId: string | null;
  enteredWorldId: string | null;
  playWhenWorldActivates: boolean;
  playing: boolean;
}): CraftmineActivationDecision {
  if (!input.worldId) {
    return { switchToPlay: false, enteredWorldId: input.enteredWorldId };
  }
  if (input.worldId === input.enteredWorldId) {
    // A persisted automatic-play preference should restore the immersive
    // presentation after relaunch when the world is still in create mode.
    // An explicit return to create stores playWhenWorldActivates=false, so it
    // remains a deliberate choice and is not overridden here.
    return { switchToPlay: input.playWhenWorldActivates && !input.playing, enteredWorldId: input.enteredWorldId };
  }
  return {
    switchToPlay: input.playWhenWorldActivates && !input.playing,
    enteredWorldId: input.worldId,
  };
}

/** Presentation only: never creates sessions, submits prompts, or stops tasks. */
export function setCraftmineOverlay(overlay: CraftmineOverlay): void {
  saveCraftmineLayout(localStorage, { ...loadCraftmineLayout(localStorage), overlay });
  window.dispatchEvent(new CustomEvent("craftmine-layout-changed"));
}

export function toggleCraftmineOverlay(current: CraftmineOverlay, requested: "compact" | "full"): CraftmineOverlay {
  return current === requested ? "closed" : requested;
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
