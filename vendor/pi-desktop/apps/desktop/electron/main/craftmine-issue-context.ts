import type { IssueContext } from "./craftmine-issue-service";

type Instance = {worldId: string; buildId: string; instanceId: string};
type State = Instance & {state: string};
function fail(code: string): never { throw Object.assign(Error(code), {code}); }

/** Capture identity only. Never sample, save, or forward a snapshot or host path. */
export function createCraftmineIssueContext(options: {
  selection: () => Promise<string | null>;
  instance: () => Instance | null;
  state: () => State | null;
  blocked: () => boolean;
  describe: (worldId: string) => Promise<unknown>;
}) {
  const same = (a: Instance | null, b: Instance | null) => !!a && !!b && a.worldId === b.worldId && a.buildId === b.buildId && a.instanceId === b.instanceId;
  const ready = (instance: Instance | null) => {
    const state = options.state();
    return !options.blocked() && same(instance, state) && ["ready", "paused", "saved"].includes(state!.state);
  };
  return async (): Promise<IssueContext | null> => {
    const worldId = await options.selection(), instance = options.instance();
    if (!worldId || !instance || instance.worldId !== worldId) return null;
    if (!ready(instance)) fail("ISSUE_CONTEXT_NOT_READY");
    const descriptor = await options.describe(worldId) as Record<string, any> | null;
    if (await options.selection() !== worldId || !same(instance, options.instance())) fail("ISSUE_WORLD_CHANGED");
    if (!ready(instance)) fail("ISSUE_CONTEXT_NOT_READY");
    if (!descriptor || descriptor.phase !== "formal" || descriptor.worldId !== worldId || descriptor.buildId !== instance.buildId ||
        descriptor.snapshot?.baseId !== descriptor.baseId || typeof descriptor.snapshot?.baseVersion !== "string" ||
        !/^[a-f0-9]{64}$/.test(descriptor.artifactManifestHash)) fail("ISSUE_CONTEXT_UNAVAILABLE");
    return {phase: "formal", status: "ready", worldId, buildId: instance.buildId, instanceId: instance.instanceId,
      baseId: descriptor.baseId, baseVersion: descriptor.snapshot.baseVersion, runtimeTarget: "godot-web",
      artifactManifestHash: descriptor.artifactManifestHash};
  };
}
