export type PlayerWorldKind = "web" | "godot";
export type PlayerWorldSlot = {
  kind: PlayerWorldKind;
  worldId: string | null;
  title: string;
  state: "empty" | "ready" | "initializing" | "failed";
  error?: string;
  progress?: number;
};
export type PlayerWorlds = {
  slots: PlayerWorldSlot[];
  activeKind: PlayerWorldKind | null;
  activeWorldId: string | null;
};

/** Slot membership is a host fact. Never classify a legacy world by its title. */
export function parsePlayerWorlds(raw: unknown): PlayerWorlds {
  const data = raw as Partial<PlayerWorlds> | null;
  if (!data || !Array.isArray(data.slots)) throw Error("PLAYER_WORLDS_UNAVAILABLE");
  const slots = (["godot", "web"] as const).map(kind => {
    const matches = data.slots!.filter(slot => slot?.kind === kind);
    const slot = matches[0];
    if (matches.length !== 1 || !slot || !["empty", "ready", "initializing", "failed"].includes(slot.state)
      || (slot.worldId !== null && (typeof slot.worldId !== "string" || !slot.worldId))) throw Error("PLAYER_WORLDS_INVALID");
    return {...slot, title: typeof slot.title === "string" ? slot.title : kind === "godot" ? "Godot 3D" : "Web"};
  });
  return {slots, activeKind: data.activeKind === "web" || data.activeKind === "godot" ? data.activeKind : null,
    activeWorldId: typeof data.activeWorldId === "string" ? data.activeWorldId : null};
}
