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
// The plan only schedules commands. Every timing claim is decided from these
// recorded receipt times, never from the intended spacing, and a capture is never
// moved into a window whose timing has to be measured.
//
// Hammer plan
//   resume → pickup scan over three pitches by three headings at two distances,
//   interacting each time (bounded, stops early on a real pickup) → equip
//   thunder_hammer → look at the training target → two adjacent attacks with no
//   capture between them → wait → attack again → walk in and keep attacking.
//   Directly equipping is recorded but is never presented as a pickup.
//
// Dog plan
//   resume → talk at spawn → walk well beyond the dog and talk again → walk as
//   far as the town map allows and talk → walk back along the recorded outbound
//   path in small steps until contact returns, then talk again. The return uses
//   the measured outbound displacement, never a guessed number of steps.
const MAX_FRAMES = 12;
const SCREEN = { width: 1280, height: 720 };
/** Steps per return chunk. The town interaction radius is about 14 px wide, so a
 * chunk of 10 steps (~14.7 px) cannot step over the dog without contact. */
const RETRACE_CHUNK_STEPS = 10;
const RETRACE_CHUNK_LIMIT = 60;
const FALLBACK_PX_PER_STEP = 88 / 60;

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
  let frames = 0, attackCount = 0, retrace: Record<string, unknown> | null = null;
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
  const moveDistance = (dx: number, dy: number) => actions.reduce((sum, action) => (action.op === "move" && Number(action.args?.dx) === dx && Number(action.args?.dy) === dy ? sum + (Number(action.result?.distance) || 0) : sum), 0);
  const moveSteps = (dx: number, dy: number) => actions.reduce((sum, action) => (action.op === "move" && Number(action.args?.dx) === dx && Number(action.args?.dy) === dy ? sum + (Number(action.args?.steps) || 0) : sum), 0);

  if (caseId === "hammer") {
    await act("resume", {});
    // Bounded pickup scan. A negative pitch looks down (the aim ray is the camera's
    // -Z, so pitch_pivot.rotation.x > 0 looks up), and these pitches form a ladder
    // whose rays meet the ground between about 0.7 m and 3.6 m, which is where an
    // ordinary pickup near the spawn can be. Three headings cover the forward arc,
    // and the whole scan repeats one walk further out. It stops as soon as the
    // hammer is really carried. The driver cannot aim at every point in the world,
    // so a scan that never points at an interactable is reported as untested rather
    // than as a product failure.
    const yaws = [0, 0.6, -0.6], pitches = [-1.15, -1.0, -0.9, -0.8, -0.7, -0.6, -0.5, -0.42];
    let picked = false, scanned = 0;
    for (const leg of [0, 1]) {
      if (picked) break;
      if (leg === 1) await act("walk", { forward: 1, frames: 24 });
      for (const yaw of yaws) {
        for (const pitch of pitches) {
          await act("look", { yaw, pitch }, scanned === 0);
          scanned += 1;
          const attempt = await act("interact", {});
          if (carried(attempt.observation)) { picked = true; break; }
        }
        if (picked) break;
      }
    }
    if (!picked) await act("walk", { forward: -1, frames: 24 });
    // Equip is always attempted and reported; it is never pickup evidence.
    await act("equip", { value: "thunder_hammer" });
    await act("look", { yaw: 0, pitch: 0 }, true);
    // Two adjacent attacks with nothing between them, so the gap between the two
    // commands is the real one. Frames are taken on later attacks only.
    await act("fire", {});
    await act("fire", {});
    await act("wait", { frames: 66 });
    await act("fire", {}, true);
    await act("wait", { frames: 12 });
    await act("fire", {}, true);
    // Close the distance to the training target and keep attacking.
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
    // Walk back along the measured outbound path. A truncated leg can only
    // understate the speed, so the fastest observed leg gives the nominal pixels
    // per step: sizing the northward leg with the southward leg's truncated average
    // would have overshot into the wall. The north leg is then walked in chunks and
    // stops on the outbound row or on contact, and the westward sweep advances far
    // less than the contact area so it cannot step over the dog.
    const southPx = moveDistance(0, 1);
    const requiredPx = moveDistance(1, 0);
    const pxPerStep = Math.max(FALLBACK_PX_PER_STEP * 0.5, ...actions
      .filter(action => action.op === "move" && Number(action.args?.steps) > 0 && Number(action.result?.distance) > 0)
      .map(action => Number(action.result.distance) / Number(action.args.steps)));
    let contact = false, coveredPx = 0, northPx = 0, northChunks = 0, chunks = 0;
    while (!contact && southPx > 0 && northPx < southPx * 0.98 && northChunks < 40) {
      const steps = Math.max(1, Math.min(40, Math.round((southPx - northPx) / pxPerStep)));
      await act("move", { dx: 0, dy: -1, steps });
      northPx = moveDistance(0, -1);
      northChunks += 1;
      const settled = await act("wait", { frames: 15 });
      if (overlapsDog(settled.observation)) { contact = true; break; }
    }
    while (!contact && chunks < RETRACE_CHUNK_LIMIT && coveredPx < requiredPx * 1.05) {
      await act("move", { dx: -1, dy: 0, steps: RETRACE_CHUNK_STEPS });
      coveredPx = moveDistance(-1, 0);
      chunks += 1;
      const settled = await act("wait", { frames: 15 });
      if (overlapsDog(settled.observation)) { contact = true; break; }
    }
    // `complete` means the retrace finished its search: either it found the dog, or
    // it really covered the whole outbound path. Only then can "no contact" be read
    // as evidence about the dog rather than as a driver limitation.
    retrace = { southPx, pxPerStep, requiredPx, northPx, northChunks, coveredPx, chunks, chunkSteps: RETRACE_CHUNK_STEPS, chunkLimit: RETRACE_CHUNK_LIMIT,
      complete: contact || (requiredPx > 0 && coveredPx >= requiredPx * 1.05), contact };
    if (contact) await act("talk", { npcId: "p8-dog" }, true);
    else await act("talk", { npcId: "p8-dog" });
  }
  const byOp = (op: string) => actions.filter(action => action.op === op).length;
  return {
    format: "craftmine.p8-gameplay/1",
    caseId,
    before: first,
    actions,
    ...(retrace ? { retrace } : {}),
    plan: { frames: frames, maxFrames: MAX_FRAMES, actions: actions.length, attacks: byOp("fire"), interactions: byOp("interact"), moves: byOp("move"), talks: byOp("talk"),
      scope: "Fixed per-case plan over a closed op vocabulary. Bounded adaptivity only: it stops scanning once the item is really carried, and walks back in chunks until contact returns. It never injects a caller-supplied op and never writes state." },
    limitation: "Raw ordinary-command results, live observations and a bounded set of real rendered frames with their real capture times. The per-criterion verdicts are computed separately; frames exist to support an independent review of the lightning effect and the dog's visible stop, which no product channel reports.",
  };
}
