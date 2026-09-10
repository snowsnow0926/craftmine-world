import type { GodotGameplayAccess } from "./craftmine-godot-gameplay-acceptance.js";

// Fixed, bounded gameplay plans per case. These are ordinary game commands over a
// closed vocabulary — the caller cannot inject an op, an argument or a target, and
// nothing here writes state, teleports, or fabricates an observation. Where the
// plan adapts, it adapts to what the running build reported, with a hard cap.
//
// Evidence kept for every step: op, args, the raw result, the full observation
// envelope, and the real receipt times of the command and the observation. Frames
// are captured only at a few decisive moments (bounded), each with its own capture
// times and an explicit statement of which attack it belongs to.
//
// The plan only schedules commands. Whether a repeated attack really was refused
// inside one second is decided from these recorded receipt times, never from the
// intended spacing.
//
// Hammer plan
//   resume → pickup sweep over three headings (interact before and after each
//   short walk, stepping back between headings) → equip thunder_hammer → look at
//   the training target → fire, capture, fire again, wait, fire again → walk in
//   and keep firing at the target.
//   The sweep stops early once the hammer is really carried. Directly equipping
//   is recorded but is never presented as a pickup.
//
// Dog plan
//   resume → talk at spawn → walk well beyond the dog and talk again → walk as
//   far as the town map allows and talk → walk back until contact returns and
//   talk again. Every leg records the real distance and the physical overlap
//   report, so "it followed" and "it stopped" are not inferred from one refusal.
const MAX_FRAMES = 12;
const SCREEN = { width: 1280, height: 720 };

export async function exerciseP8Gameplay(access: GodotGameplayAccess, caseId: "hammer" | "dog", worldId: string) {
  const first = await access.observe();
  if (first?.format !== "craftmine.godot-observation/1" || first.worldId !== worldId || first.baseId !== (caseId === "hammer" ? "first-person" : "top-down") || !first.buildId || !first.instanceId) throw Error("P8_ACTUAL_RUNTIME_REQUIRED");
  const identity = JSON.stringify([first.worldId, first.buildId, first.instanceId]);
  const observe = async () => {
    const result = await access.observe();
    if (JSON.stringify([result.worldId, result.buildId, result.instanceId]) !== identity) throw Error("P8_RUNTIME_CHANGED");
    return result;
  };
  const actions: any[] = [];
  let frames = 0, attackCount = 0;
  let lastAttack: any = null;
  const act = async (op: string, args: Record<string, unknown>, capture = false) => {
    const commandStartedAtMs = Date.now();
    let result: unknown;
    try { result = await access.action(op, args); }
    catch (error) { result = { error: error instanceof Error ? error.message : "P8_GAMEPLAY_FAILED" }; }
    const commandCompletedAtMs = Date.now();
    const observation = await observe();
    const observedAtMs = Date.now();
    // An attack is registered before any frame is taken, so a frame captured on
    // this step is associated with this attack rather than the previous one.
    if (op === "fire" || op === "attack") {
      const outcome: any = result;
      attackCount += 1;
      lastAttack = { attackIndex: attackCount, op, args, fired: outcome?.fired === true,
        reason: typeof outcome?.reason === "string" && outcome.reason.length ? outcome.reason : null,
        commandStartedAtMs, commandCompletedAtMs, observedAtMs };
    }
    let frame: Record<string, unknown> | undefined;
    if (capture) {
      if (frames >= MAX_FRAMES) throw Error("P8_FRAME_BUDGET_EXCEEDED");
      const captureStartedAtMs = Date.now();
      const image = await access.capture(SCREEN.width, SCREEN.height);
      const capturedAtMs = Date.now();
      const resampled = await observe();
      if (image.width !== SCREEN.width || image.height !== SCREEN.height || !image.pngBase64.startsWith("iVBORw0KGgo")) throw Error("P8_ACTUAL_CAPTURE_REQUIRED");
      frames += 1;
      frame = {
        pngBase64: image.pngBase64, width: image.width, height: image.height,
        commandStartedAtMs, commandCompletedAtMs, observedAtMs, captureStartedAtMs, capturedAtMs,
        sampledAt: observation.sampledAt, resampledAt: resampled.sampledAt,
        // Which attack this frame belongs to, with the real offsets from it. These
        // are measurements for a reviewer; nothing here asserts a time window.
        associatedAttack: lastAttack ? { attackIndex: lastAttack.attackIndex, op: lastAttack.op, fired: lastAttack.fired, reason: lastAttack.reason, commandStartedAtMs: lastAttack.commandStartedAtMs, commandCompletedAtMs: lastAttack.commandCompletedAtMs, observedAtMs: lastAttack.observedAtMs } : null,
        offsetFromAttackObservedMs: lastAttack ? observedAtMs - lastAttack.observedAtMs : null,
        offsetFromAttackCompletedMs: lastAttack ? commandCompletedAtMs - lastAttack.commandCompletedAtMs : null,
      };
    }
    const record = { op, args, result, observation, commandStartedAtMs, commandCompletedAtMs, observedAtMs, ...(frame ? { frame } : {}) };
    actions.push(record);
    return record;
  };
  const carried = (observation: any) => Array.isArray(observation?.payload?.inventory?.slots)
    && observation.payload.inventory.slots.some((slot: any) => typeof slot?.id === "string" && slot.id.includes("thunder_hammer"));
  const overlapsDog = (observation: any) => observation?.payload?.physical?.overlaps?.["p8-dog"] === true;

  if (caseId === "hammer") {
    await act("resume", {});
    // Bounded pickup sweep near spawn: three headings, up to three interactions
    // each, returning to the spawn area between headings.
    const headings = [0, 0.7, -0.7];
    let picked = false;
    for (const yaw of headings) {
      if (picked) break;
      await act("look", { yaw, pitch: -0.4 }, yaw === 0);
      for (const step of [0, 1, 2]) {
        if (step > 0) await act("walk", { forward: 1, frames: 24 });
        const attempt = await act("interact", {});
        if (carried(attempt.observation)) { picked = true; break; }
      }
      if (!picked) await act("walk", { forward: -1, frames: 48 });
    }
    // Equip is always attempted and reported; it is never pickup evidence.
    await act("equip", { value: "thunder_hammer" });
    await act("look", { yaw: 0, pitch: 0 }, true);
    await act("fire", {}, true);
    await act("fire", {});
    await act("wait", { frames: 66 });
    await act("fire", {}, true);
    await act("wait", { frames: 12 });
    await act("fire", {}, true);
    // Close the distance to the training target and keep firing.
    await act("walk", { forward: 1, frames: 150 });
    await act("fire", {});
    await act("walk", { forward: 1, frames: 45 });
    await act("fire", {});
    await act("walk", { forward: 1, frames: 45 });
    await act("fire", {}, true);
  } else {
    await act("resume", {}, true);
    await act("talk", { npcId: "p8-dog" });
    // Short leg: well beyond the interaction radius, so staying in contact proves
    // the dog actually followed instead of never losing contact by accident.
    await act("move", { dx: 1, dy: 0, steps: 200 });
    await act("wait", { frames: 60 });
    await act("talk", { npcId: "p8-dog" }, true);
    // Far leg: as far as the small town map allows, in two directions.
    await act("move", { dx: 1, dy: 0, steps: 600 });
    await act("wait", { frames: 60 });
    await act("move", { dx: 0, dy: 1, steps: 600 });
    await act("wait", { frames: 60 });
    await act("talk", { npcId: "p8-dog" }, true);
    // Walk back along the same path in bounded chunks until contact returns, so
    // "it stayed behind" is observed rather than assumed.
    let contact = false;
    for (const leg of [{ dx: 0, dy: -1, steps: 400 }, { dx: 0, dy: -1, steps: 400 }, { dx: -1, dy: 0, steps: 400 }, { dx: -1, dy: 0, steps: 400 }]) {
      await act("move", leg);
      const settled = await act("wait", { frames: 45 });
      if (overlapsDog(settled.observation)) { contact = true; break; }
    }
    if (contact) await act("talk", { npcId: "p8-dog" }, true);
    else await act("talk", { npcId: "p8-dog" });
  }
  const byOp = (op: string) => actions.filter(action => action.op === op).length;
  return {
    format: "craftmine.p8-gameplay/1",
    caseId,
    before: first,
    actions,
    plan: { frames: frames, maxFrames: MAX_FRAMES, actions: actions.length, attacks: byOp("fire"), interactions: byOp("interact"), moves: byOp("move"), talks: byOp("talk"),
      scope: "Fixed per-case plan over a closed op vocabulary. Bounded adaptivity only: it stops picking once the item is really carried, and stops walking back once contact returns. It never injects a caller-supplied op and never writes state." },
    limitation: "Raw ordinary-command results, live observations and a bounded set of real rendered frames with their real capture times. The per-criterion verdicts are computed separately; frames exist to support an independent review of the lightning effect and the dog's visible stop, which no product channel reports.",
  };
}
