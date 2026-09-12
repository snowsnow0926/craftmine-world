/** Host-only OS metrics. These describe the renderer process, not engine timings. */
export type PerformanceProcess = {
  worldId: string; buildId: string; instanceId: string;
  rendererProcessId: number; webContentsId: number;
};
type ProcessMetric = { pid: number; type: string; memory?: { workingSetSize?: number } };
type Request = { worldId?: string | null; buildId?: string | null; instanceId?: string | null };
const identities = ["worldId", "buildId", "instanceId"] as const;
const keys = [...identities, "rendererProcessId", "webContentsId"] as const;

export function createCraftminePerformanceSampler(
  process: () => PerformanceProcess | null,
  metrics: () => ProcessMetric[] | Promise<ProcessMetric[]>,
  now: () => number = Date.now,
) {
  return async (input: Request = {}): Promise<Record<string, unknown> | null> => {
    if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.entries(input).some(([key, value]) => !identities.includes(key as typeof identities[number]) ||
        (value !== null && (typeof value !== "string" || !/^[a-zA-Z0-9._-]{1,128}$/.test(value)))))
      throw Error("PERFORMANCE_INVALID_IDENTITY");
    const before = process();
    if (!before) return null;
    // Copy the identity before any asynchronous work; never retain a mutable descriptor.
    const identity = { ...before };
    if (identities.some(key => !/^[a-zA-Z0-9._-]{1,128}$/.test(identity[key])) ||
      !Number.isSafeInteger(identity.rendererProcessId) || identity.rendererProcessId <= 0 ||
      !Number.isSafeInteger(identity.webContentsId) || identity.webContentsId <= 0)
      throw Error("PERFORMANCE_PROCESS_UNAVAILABLE");
    for (const key of identities) if (input[key] && input[key] !== identity[key]) throw Error(`PERFORMANCE_${key.toUpperCase()}_MISMATCH`);
    const reading = await metrics();
    const after = process();
    if (!after || keys.some(key => identity[key] !== after[key])) throw Error("PERFORMANCE_INSTANCE_CHANGED");
    const matching = reading.filter(entry => entry.pid === identity.rendererProcessId && entry.type === "Tab");
    const workingSetKb = matching.length === 1 ? matching[0].memory?.workingSetSize : undefined;
    const measured = typeof workingSetKb === "number" && Number.isFinite(workingSetKb) && workingSetKb >= 0;
    return {
      ...identity, sampledAt: new Date(now()).toISOString(),
      provenance: "electron-app-metrics", measurementScope: "renderer-process", memoryUnit: "MiB",
      ...(measured ? { memoryWorkingSetMb: workingSetKb / 1024 } : {}),
      unavailable: {
        frameTimeMs: "Engine frame timing is not exposed by the current runtime protocol.",
        physicsStepMs: "Engine physics timing is not exposed by the current runtime protocol.",
        objectCount: "Engine object count is not exposed by the current runtime protocol.",
        ...(!measured ? { memoryWorkingSetMb: "Renderer working set was unavailable from the OS process metrics." } : {}),
      },
    };
  };
}
