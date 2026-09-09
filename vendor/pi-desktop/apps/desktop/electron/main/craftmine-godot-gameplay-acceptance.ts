// Local, finite gameplay evidence. No model/provider access, OS input, arbitrary
// script, expected-state assignment, or caller-selected game operation.
export type GodotGameplayAccess = {
  observe: () => Promise<any>;
  action: (op: string, args: Record<string, unknown>) => Promise<any>;
  capture: (width: number, height: number) => Promise<{ pngBase64: string; width: number; height: number; viewportObservation?: unknown }>;
};

export function createGodotGameplayAcceptance(access: GodotGameplayAccess) {
  let busy = false;
  return async (method: string): Promise<any> => {
    if (!["godotPlay", "godotCapture720", "godotCapture600", "godotCapture1080"].includes(method)) throw Error("Unknown fixed gameplay evidence operation");
    if (busy) throw Error("A fixed gameplay evidence operation is already running");
    busy = true;
    let identity: any = null;
    const observe = async (captured?: unknown) => {
      const value: any = captured ?? await access.observe();
      if (value?.format !== "craftmine.godot-observation/1" || value.baseId !== "first-person" || !value.worldId || !value.buildId || !value.instanceId) throw Error("Actual first-person runtime observation required");
      const current = JSON.stringify([value.worldId, value.buildId, value.instanceId]);
      if (identity !== null && identity !== current) throw Error("Runtime identity changed during gameplay evidence");
      identity = current;
      return value;
    };
    const capture = async (width: number, height: number) => {
      const image = await access.capture(width, height);
      if (image.width !== width || image.height !== height || typeof image.pngBase64 !== "string" || !image.pngBase64.startsWith("iVBORw0KGgo")) throw Error("Actual Godot capture does not match requested viewport");
      const observation = await observe(image.viewportObservation);
      if (JSON.stringify(observation.payload?.viewportSize) !== JSON.stringify([width, height])) throw Error("Runtime viewport does not match captured surface");
      return { image, observation };
    };
    try {
      const before = await observe();
      if (method !== "godotPlay") {
        const [width, height] = method === "godotCapture720" ? [1280, 720] : method === "godotCapture600" ? [800, 600] : [1920, 1080];
        return { before, ...await capture(width, height) };
      }
      const actions: any[] = [], captures: any[] = [];
      const sequence: [string, Record<string, unknown>][] = [["resume", {}], ["equip", { value: "pistol" }], ["look", { yaw: 0.3, pitch: 0.15 }], ["equip", { value: "practice_sword" }], ["look", { yaw: -0.3, pitch: -0.1 }], ["equip", { value: "pistol" }], ["equip", { value: "practice_sword" }], ["equip", { value: "pistol" }]];
      for (const [op, args] of sequence) {
        const result = await access.action(op, args);
        if (result?.error) throw Error("Actual gameplay operation failed: " + String(result.error));
        actions.push({ op, args, result, observation: await observe() });
        if (op === "look") captures.push({ afterAction: actions.length - 1, ...await capture(1280, 720) });
      }
      return { format: "craftmine.godot-gameplay-evidence/1", before, actions, captures };
    } finally { busy = false; }
  };
}
