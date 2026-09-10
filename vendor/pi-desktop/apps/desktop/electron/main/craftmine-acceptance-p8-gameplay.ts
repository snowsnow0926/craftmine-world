import type { GodotGameplayAccess } from "./craftmine-godot-gameplay-acceptance.js";

// These are ordinary game commands over fixed case IDs, not a state-writing or
// arbitrary node inspector. The caller retains the raw results, including errors.
//
// The sequences are sized so the acceptance criteria are actually decidable:
//   * the hammer sequence forces one attack, an immediate repeat inside the same
//     cooldown window, a wait longer than the required one second, and then
//     enough walking for a melee reach to connect with the training target;
//   * the dog sequence talks at spawn, walks a short way, and then walks as far
//     as the small town map allows before talking again, so "still in range"
//     and "out of range" both come from real movement.
// A blocked leg is retained as evidence instead of being retried silently.
export async function exerciseP8Gameplay(access: GodotGameplayAccess, caseId: "hammer" | "dog", worldId: string) {
  const first = await access.observe();
  if (first?.format !== "craftmine.godot-observation/1" || first.worldId !== worldId || first.baseId !== (caseId === "hammer" ? "first-person" : "top-down") || !first.buildId || !first.instanceId) throw Error("P8_ACTUAL_RUNTIME_REQUIRED");
  const identity = JSON.stringify([first.worldId, first.buildId, first.instanceId]);
  const observe = async () => {
    const result = await access.observe();
    if (JSON.stringify([result.worldId, result.buildId, result.instanceId]) !== identity) throw Error("P8_RUNTIME_CHANGED");
    return result;
  };
  const commands: [string, Record<string, unknown>][] = caseId === "hammer"
    ? [["resume", {}], ["equip", { value: "thunder_hammer" }], ["look", { yaw: 0, pitch: 0 }],
       ["fire", {}], ["fire", {}], ["wait", { frames: 90 }], ["fire", {}],
       ["walk", { forward: 1, frames: 150 }], ["fire", {}],
       ["walk", { forward: 1, frames: 45 }], ["fire", {}],
       ["walk", { forward: 1, frames: 45 }], ["fire", {}]]
    : [["resume", {}], ["talk", { npcId: "p8-dog" }],
       ["move", { dx: 1, dy: 0, steps: 45 }], ["wait", { frames: 60 }], ["talk", { npcId: "p8-dog" }],
       ["move", { dx: 1, dy: 0, steps: 600 }], ["wait", { frames: 60 }],
       ["move", { dx: 0, dy: 1, steps: 600 }], ["wait", { frames: 60 }], ["talk", { npcId: "p8-dog" }]];
  const actions = [];
  for (const [op, args] of commands) {
    let result: unknown;
    try { result = await access.action(op, args); }
    catch (error) { result = { error: error instanceof Error ? error.message : "P8_GAMEPLAY_FAILED" }; }
    const observation = await observe();
    const image = await access.capture(1280, 720);
    await observe();
    if (image.width !== 1280 || image.height !== 720 || !image.pngBase64.startsWith("iVBORw0KGgo")) throw Error("P8_ACTUAL_CAPTURE_REQUIRED");
    actions.push({ op, args, result, observation, image });
  }
  return { format: "craftmine.p8-gameplay/1", caseId, before: first, actions,
    limitation: "Raw ordinary-command observations and game-view images. The per-criterion verdicts are computed separately from these results, the live observations and the authored source; these raw frames stay available for independent inspection." };
}
