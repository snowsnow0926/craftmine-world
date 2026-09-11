import { createHash } from "node:crypto";
import type { GodotGameplayAccess } from "./craftmine-godot-gameplay-acceptance";

// Test-controller input, not an agent tool or a new gameplay operation.
export const GODOT_EXPLORATION_LIMITS = Object.freeze({ steps: 16, framesPerStep: 120, actionPhysicsTicks: 600, captures: 4 });
type Identity = { worldId: string; buildId: string; instanceId: string };
type Step = { op: "look" | "walk" | "wait" | "interact"; args: Record<string, number>; capture: boolean };
function fail(reason: string): never { throw Error("GODOT_EXPLORATION_" + reason); }
function object(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_OBJECT");
}
function fields(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail("INVALID_FIELDS");
}
function number(value: unknown, min: number, max: number, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) fail("INVALID_NUMBER");
  return value;
}
function parse(input: unknown): { identity: Identity; steps: Step[]; actionPhysicsTicks: number } {
  object(input); fields(input, ["worldId", "buildId", "instanceId", "steps"]);
  const identity = {} as Identity;
  for (const key of ["worldId", "buildId", "instanceId"] as const) {
    const value = input[key];
    if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(value)) fail("INVALID_IDENTITY");
    identity[key] = value;
  }
  if (!Array.isArray(input.steps) || input.steps.length < 1 || input.steps.length > GODOT_EXPLORATION_LIMITS.steps) fail("STEP_LIMIT");
  let actionPhysicsTicks = 0, captures = 0;
  const steps = input.steps.map((entry: unknown): Step => {
    object(entry); fields(entry, ["op", "args"], ["capture"]); object(entry.args);
    if (entry.capture !== undefined && typeof entry.capture !== "boolean") fail("INVALID_CAPTURE");
    const capture = entry.capture === true;
    if (capture) captures++;
    const args: Record<string, number> = {};
    switch (entry.op) {
      case "look":
        fields(entry.args, ["yaw", "pitch"]);
        args.yaw = number(entry.args.yaw, -Math.PI, Math.PI);
        args.pitch = number(entry.args.pitch, -1.55, 1.55);
        actionPhysicsTicks++;
        break;
      case "walk":
        fields(entry.args, ["forward", "right", "frames"]);
        args.forward = number(entry.args.forward, -1, 1);
        args.right = number(entry.args.right, -1, 1);
        args.frames = number(entry.args.frames, 1, GODOT_EXPLORATION_LIMITS.framesPerStep, true);
        // first-person BaseOps._walk waits one extra physics frame after walk().
        actionPhysicsTicks += args.frames + 1;
        break;
      case "wait":
        fields(entry.args, ["frames"]);
        args.frames = number(entry.args.frames, 1, GODOT_EXPLORATION_LIMITS.framesPerStep, true);
        actionPhysicsTicks += args.frames;
        break;
      case "interact":
        fields(entry.args, []); actionPhysicsTicks++;
        break;
      default: fail("UNSUPPORTED_ACTION");
    }
    return { op: entry.op, args, capture };
  });
  if (actionPhysicsTicks > GODOT_EXPLORATION_LIMITS.actionPhysicsTicks) fail("PHYSICS_TICK_LIMIT");
  if (captures > GODOT_EXPLORATION_LIMITS.captures) fail("CAPTURE_LIMIT");
  return { identity, steps, actionPhysicsTicks };
}

export function createGodotExploration(access: GodotGameplayAccess) {
  let busy = false;
  return async (input: unknown) => {
    // Copy and validate the entire request before even observing the world.
    const { identity, steps, actionPhysicsTicks } = parse(input);
    if (busy) fail("BUSY");
    busy = true;
    let baseId: string | undefined;
    const checked = (value: any) => {
      if (value?.format !== "craftmine.godot-observation/1" || !["creation-sandbox", "first-person"].includes(value.baseId)) fail("UNSUPPORTED_OBSERVATION");
      if (Object.entries(identity).some(([key, expected]) => value[key] !== expected) || (baseId && value.baseId !== baseId)) fail("IDENTITY_CHANGED");
      baseId = value.baseId;
      return value;
    };
    const observe = async () => checked(await access.observe());
    try {
      const before = await observe(), actions = [], captures = [];
      for (const step of steps) {
        const beforeAction = await observe();
        const result = await access.action(step.op, step.args);
        const observation = await observe();
        if (!result || typeof result !== "object" || result.error) fail("ACTION_FAILED" + (result?.error ? ": " + String(result.error).slice(0, 300) : ""));
        actions.push({ op: step.op, args: step.args, before: beforeAction, result, observation });
        if (step.capture) {
          await observe();
          const image = await access.capture(1280, 720);
          // Capture supplies its own same-surface observation. A later fallback
          // sample would not establish which instance produced these pixels.
          const captured = checked(image.viewportObservation);
          await observe();
          if (image.width !== 1280 || image.height !== 720 || typeof image.pngBase64 !== "string" || image.pngBase64.length > 6 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.pngBase64)) fail("INVALID_CAPTURE");
          const png = Buffer.from(image.pngBase64, "base64");
          if (png.length < 24 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || png.toString("ascii", 12, 16) !== "IHDR" || png.readUInt32BE(16) !== 1280 || png.readUInt32BE(20) !== 720) fail("INVALID_CAPTURE");
          const size = captured.payload?.logicalViewportSize ?? captured.payload?.viewportSize;
          if (!Array.isArray(size) || size[0] !== 1280 || size[1] !== 720) fail("CAPTURE_VIEWPORT_MISMATCH");
          captures.push({ afterAction: actions.length - 1, source: "godot-headless-capture", identity: { ...identity },
            image: { pngBase64: image.pngBase64, width: image.width, height: image.height, sha256: createHash("sha256").update(png).digest("hex") }, observation: captured });
        }
      }
      return { format: "craftmine.godot-exploration/1", identity, baseId, before, after: await observe(), actions, captures,
        actionPhysicsTicks, limits: GODOT_EXPLORATION_LIMITS,
        note: "Observed gameplay and pixels only; no automatic claim of wish acceptance, visual quality or adoption. Tick budget bounds scheduled actions, not elapsed physics during observation/capture." };
    } finally { busy = false; }
  };
}
