import { createHash } from "node:crypto";

// Trusted finite authored-sample evidence; no model tool, OS input or state setter.
export type GodotBasesAcceptanceAccess = {
  observe: () => Promise<any>;
  action: (op: string, args: Record<string, unknown>) => Promise<any>;
  capture: (width: number, height: number) => Promise<{ pngBase64: string; width: number; height: number; viewportObservation?: unknown }>;
  save?: () => Promise<any>;
};
const object = (v: any): v is Record<string, any> => v !== null && typeof v === "object" && !Array.isArray(v);

/** Transport metadata is discarded; NO field inside progress is ignored.
 * Observations cannot substitute for complete saves: G observations omit ledgers. */
export function godotPersistentProgress(value: any): Record<string, any> {
  const visit = (v: any, depth: number): Record<string, any> | null => {
    if (!object(v) || depth > 5) return null;
    if (v.format === "craftmine.godot-progress/1") {
      if (!v.worldId || !v.baseId || !v.baseVersion || v.stateVersion !== 1 || !object(v.body) || v.body.worldId !== v.worldId) throw Error("Invalid complete Godot progress identity/body");
      return v;
    }
    for (const key of ["state", "snapshot", "result"]) {
      const found = visit(v[key], depth + 1);
      if (found) return found;
    }
    return null;
  };
  const found = visit(value, 0);
  if (!found) throw Error("Complete craftmine.godot-progress/1 required; observations are not complete saves");
  return JSON.parse(JSON.stringify(found));
}
function canonical(value: any): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (object(value)) return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
  return JSON.stringify(value);
}
export function compareGodotPersistentProgress(before: unknown, after: unknown) {
  const left = godotPersistentProgress(before), right = godotPersistentProgress(after);
  const differences: { path: string; before?: unknown; after?: unknown }[] = [];
  const walk = (a: any, b: any, path: string) => {
    if (canonical(a ?? null) === canonical(b ?? null) && (a === undefined) === (b === undefined)) return;
    if (object(a) && object(b)) {
      for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) walk(a[key], b[key], path + "/" + key.replaceAll("~", "~0").replaceAll("/", "~1"));
    } else differences.push({ path, before: a, after: b });
  };
  walk(left, right, "");
  return { equal: differences.length === 0, beforeSha256: createHash("sha256").update(canonical(left)).digest("hex"), afterSha256: createHash("sha256").update(canonical(right)).digest("hex"), differences };
}

export function createGodotBasesAcceptance(access: GodotBasesAcceptanceAccess) {
  let busy = false;
  return async (method: string): Promise<any> => {
    if (!["godotPlayTown", "godotPlayRuins"].includes(method)) throw Error("Unknown fixed base acceptance operation");
    if (busy) throw Error("A fixed base acceptance operation is already running");
    busy = true;
    const baseId = method === "godotPlayTown" ? "top-down" : "side-view";
    const evidence: any = { format: "craftmine.godot-bases-gameplay-evidence/1", method, baseId, ok: false, actions: [], observations: [], captures: [], checkpoints: [], checks: [], limits: ["Fixed authored sample route; not model authoring or player-feel acceptance", "Capture bytes and live viewport recorded; pixel inspection belongs to actual client harness", "Caller must perform process restart/backup and compare full progress separately"] };
    let identity = "";
    const check = (name: string, passed: boolean) => {
      evidence.checks.push({ name, passed: !!passed });
      if (!passed) throw Error(name);
    };
    const observe = async (sample?: any) => {
      const value = sample ?? await access.observe();
      evidence.observations.push(value);
      if (value?.format !== "craftmine.godot-observation/1" || value.baseId !== baseId || !value.worldId || !value.buildId || !value.instanceId) throw Error("Actual selected-base observation required");
      const current = JSON.stringify([value.worldId, value.buildId, value.instanceId, value.baseVersion]);
      if (identity && identity !== current) throw Error("Runtime identity changed during fixed gameplay");
      identity = current;
      return value;
    };
    const action = async (op: string, args: Record<string, unknown> = {}) => {
      const entry: any = { op, args };
      evidence.actions.push(entry);
      try {
        entry.result = await access.action(op, args);
        const result = entry.result?.result ?? entry.result;
        if (result?.error || result?.ok === false) throw Error(String(result.error ?? result.reason ?? "Gameplay rejected"));
        entry.observation = await observe();
        return result;
      } catch (error) { entry.error = String(error); throw error; }
    };
    const snapshot = async (label: string) => {
      const raw = await action("snapshot");
      const state = godotPersistentProgress(raw);
      const observed = evidence.observations.at(-1);
      check(label + ": progress belongs to observed runtime", state.baseId === baseId && state.worldId === observed.worldId && state.baseVersion === observed.baseVersion);
      evidence.checkpoints.push({ label, raw, state });
      return state;
    };
    const capture = async (label: string) => {
      const image = await access.capture(1280, 720);
      evidence.captures.push({ label, image });
      check(label + ": capture dimensions and PNG", image.width === 1280 && image.height === 720 && typeof image.pngBase64 === "string" && image.pngBase64.startsWith("iVBORw0KGgo"));
      const observation = await observe(image.viewportObservation);
      evidence.captures.at(-1).observation = observation;
      check(label + ": live output surface matches capture", JSON.stringify(observation.payload?.surfaceSize) === "[1280,720]");
      check(label + ": logical viewport is measured", Array.isArray(observation.payload?.logicalViewportSize) && observation.payload.logicalViewportSize.length === 2 && observation.payload.logicalViewportSize.every((v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0));
    };
    try {
      evidence.before = await observe();
      await action("pause");
      const initial = await snapshot("initial");
      if (baseId === "top-down") {
        check("Fresh town sample required", initial.body.player?.sceneId === "overworld" && initial.body.coins === 40 && !initial.body.quests?.["herb-delivery"]?.rewarded && !initial.body.flags?.["zone.herb-patch.gathered"]);
      } else {
        check("Fresh ruins sample required", initial.body.player?.room === "entrance" && !initial.body.abilities?.double_jump && !initial.body.counters?.hits);
      }
      await action("resume");
      if (baseId === "top-down") {
        await action("move", { dx: 0, dy: 1, steps: 55 });
        check("Walking reaches herb patch", evidence.observations.at(-1).payload?.physical?.overlaps?.["zone-herb-patch"] === true);
        for (let i = 0; i < 3; i++) await action("gather", { zoneId: "zone-herb-patch" });
        const herbs = await snapshot("gathered");
        check("Gathering changes inventory and zone ledger", herbs.body.inventory.herb === 3 && herbs.body.flags["zone.herb-patch.gathered"] === 3);
        await action("move", { dx: 0, dy: -1, steps: 55 });
        await action("move", { dx: 1, dy: 0, steps: 65 });
        const dialogue = await action("talk", { npcId: "npc-mira" });
        check("Live NPC returns dialogue", dialogue.ok === true && typeof dialogue.line === "string" && dialogue.line.length > 0);
        await action("deliver", { npcId: "npc-mira", questId: "herb-delivery" });
        const quest = await snapshot("delivered");
        check("Quest consumes herbs and grants reward", quest.body.quests["herb-delivery"].rewarded === true && !!quest.body.grantedRewards["herb-delivery#reward"] && !quest.body.inventory.herb && quest.body.inventory.apple === 1 && quest.body.coins === 70);
        await capture("town-delivery");
        await action("move", { dx: 1, dy: 0, steps: 180 });
        await action("move", { dx: 0, dy: -1, steps: 32 });
        check("Doorway enters actual shop", (await snapshot("shop-entry")).body.player.sceneId === "shop-interior");
        await action("move", { dx: 0, dy: -1, steps: 38 });
        await action("buy", { shopId: "shop-general", itemId: "bread" });
        await action("move", { dx: -1, dy: 0, steps: 8 });
        const bought = await snapshot("purchased");
        check("Purchase preserves price, inventory, stock and facing", bought.body.coins === 64 && bought.body.inventory.bread === 1 && bought.body.inventory.apple === 1 && bought.body.shops.general.stock.bread === 2 && bought.body.player.facing === "left" && bought.body.player.sceneId === "shop-interior");
      } else {
        const travel: Record<string, unknown>[] = [];
        for (let i = 0; i < 5; i++) travel.push({ ticks: 15, move: 1, jump: true }, { ticks: 15, move: 1 });
        travel.push({ ticks: 150 });
        await action("control", { segments: travel });
        check("Controls cross pit and enter ruins", evidence.observations.at(-1).payload?.roomId === "ruins");
        await action("control", { segments: [{ ticks: 10, move: 1 }, { ticks: 15, move: 1, jump: true }, { ticks: 275, move: 1 }, { ticks: 120 }] });
        const ability = await snapshot("ability-pickup");
        check("Real pickup unlocks double jump", ability.body.abilities.double_jump === true);
        await capture("ruins-ability");
        const position = (await observe()).payload?.player?.x;
        check("Live player position is finite", typeof position === "number" && Number.isFinite(position));
        // Bounded feedback steering, never position assignment. Authored speed 260 px/s.
        const ticks = Math.max(1, Math.round(Math.abs(position - 590) / (260 / 60)));
        check("Approach fits control budget", ticks + 35 <= 600);
        await action("control", { segments: [{ ticks, move: position > 590 ? -1 : 1 }, { ticks: 35 }] });
        await action("control", { segments: [{ ticks: 1, move: -1 }, { ticks: 1, attack: true }, { ticks: 60 }] });
        const hit = await snapshot("target-hit");
        const target = evidence.observations.at(-1).payload?.targets?.find((v: any) => v.id === "dummy_ruins");
        check("Actual hit persists target health", target?.health === 1 && hit.body.entities.dummy_ruins.health === 1 && hit.body.counters.hits === 1);
        check("Room, ability and living player persist", hit.body.player.room === "ruins" && hit.body.abilities.double_jump === true && hit.body.vitals.health > 0 && hit.body.vitals.alive === true && !!hit.body.rooms.ruins);
      }
      await action("pause");
      evidence.finalState = await snapshot("paused-final");
      await capture("paused-final");
      if (access.save) {
        evidence.save = await access.save();
        check("Save confirms core durability", evidence.save?.status === "persisted" && evidence.save?.receipt?.format === "craftmine.godot-progress-receipt/1");
        evidence.afterSave = await snapshot("after-save");
        evidence.saveComparison = compareGodotPersistentProgress(evidence.finalState, evidence.afterSave);
        check("Save preserves every paused native field", evidence.saveComparison.equal);
      } else evidence.save = { status: "not-requested" };
      evidence.ok = true;
    } catch (error) {
      evidence.error = String(error);
      try { evidence.failurePause = await access.action("pause", {}); } catch (pauseError) { evidence.failurePauseError = String(pauseError); }
    } finally { busy = false; }
    return evidence;
  };
}
