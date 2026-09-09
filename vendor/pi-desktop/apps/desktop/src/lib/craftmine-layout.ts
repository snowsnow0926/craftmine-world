export type CraftmineLayout = {
  mode: "create" | "play";
  widths: { create: number; play: number };
};

const KEY = "craftmine.desktop.layout.v1";
const boundedWidth = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(720, Math.max(244, Math.round(value)))
    : fallback;

export function loadCraftmineLayout(storage: Pick<Storage, "getItem">): CraftmineLayout {
  try {
    const value = JSON.parse(storage.getItem(KEY) ?? "null");
    return {
      mode: value?.mode === "play" ? "play" : "create",
      widths: {
        create: boundedWidth(value?.widths?.create, 480),
        play: boundedWidth(value?.widths?.play, 720),
      },
    };
  } catch {
    return { mode: "create", widths: { create: 480, play: 720 } };
  }
}

export function saveCraftmineLayout(storage: Pick<Storage, "setItem">, value: CraftmineLayout): void {
  try { storage.setItem(KEY, JSON.stringify(value)); } catch { /* Optional display preference only. */ }
}

export function changeCraftmineLayout(value: CraftmineLayout, mode: CraftmineLayout["mode"], currentWidth: number): CraftmineLayout {
  return { mode, widths: { ...value.widths, [value.mode]: boundedWidth(currentWidth, value.widths[value.mode]) } };
}

export function rememberCraftmineWidth(storage: Pick<Storage, "getItem" | "setItem">, width: number): void {
  const value = loadCraftmineLayout(storage);
  saveCraftmineLayout(storage, changeCraftmineLayout(value, value.mode, width));
}
