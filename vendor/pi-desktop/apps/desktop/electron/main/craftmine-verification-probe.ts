// Fixed headless acceptance. All calls use the real PI/Rust/plugin route.
export async function runNativeVerificationProbe(access: {
  invoke: (name: string, args: unknown, id?: string) => Promise<any>;
  panel: (channel: string, payload: Record<string, unknown>) => Promise<any>;
  preview: (id: string) => Promise<any>;
  check: (name: string, value: boolean) => void;
  worldId: string;
}): Promise<unknown> {
  const { invoke, check } = access;
  const before = await access.panel("world.open", { id: access.worldId });
  const behavior = { format: "craftmine.behavior/2", id: "native-check-behavior", name: "Verification fixture",
    description: "Runs inside a real bounded Worker", code: "export function step({state}) {return {state,commands:[]};}",
    stateVersion: 1, initialState: {}, params: {}, targets: ["native-flower"], permissions: ["objects.write"], requires: [], binding: null, keys: [] };
  await invoke("workspace_patch", { workspaceRevision: 1, operations: [{ op: "add", kind: "behavior", id: behavior.id, expectedHash: null, value: behavior }] });
  const started = Date.now();
  const job = await invoke("verification_submit", { workspaceRevision: 2, summary: "Native flower and gameplay verification" }, "native-check-submit");
  check("Verification submission returns a durable queued job without waiting for rendering", job.status === "queued" && Date.now() - started < 5000);
  const replay = await invoke("verification_submit", { workspaceRevision: 2, summary: "Native flower and gameplay verification" }, "native-check-submit");
  check("Repeated submission recovers the same job", replay.id === job.id);
  const wait = async (id: string) => {
    const deadline = Date.now() + 40_000;
    while (Date.now() < deadline) {
      const result = await invoke("verification_read", { id, limit: 16000 });
      if (!["queued", "running"].includes(result.status)) return { ...result, detail: JSON.parse(result.text) };
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("Native verification did not settle");
  };
  const passed = await wait(job.id);
  check("The native isolated renderer runs actual behavior Workers and renders the compiled world",
    passed.status === "passed" && passed.detail.evidence.behaviors.modules[0]?.passed && passed.detail.evidence.render.capture?.sha256?.length === 64);
  let denied = false;
  try { await access.panel("verification.finish", { id: job.id, output: { passed: true } }); } catch { denied = true; }
  check("The world panel cannot manufacture verification evidence", denied);
  const preview = await access.preview(job.id);
  check("An independent preview loads the checked build and retains the formal player", preview.loaded && preview.playerPreserved && preview.guards.every((guard: any) => guard && guard.pointerLock === 0 && guard.focus === 0));
  const read = await invoke("resource_read", { kind: "behavior", id: behavior.id });
  await invoke("workspace_patch", { workspaceRevision: 2, operations: [{ op: "replace", kind: "behavior", id: behavior.id, expectedHash: read.hash,
    value: { ...behavior, code: "export function step() {throw new Error('NATIVE_VERIFIER_FAILURE');}" } }] });
  const failedJob = await invoke("verification_submit", { workspaceRevision: 3, summary: "Intentional Worker failure" });
  const failed = await wait(failedJob.id);
  check("A compiled but broken behavior fails inside the actual Worker and retains its diagnostic",
    failed.status === "failed" && JSON.stringify(failed.detail).includes("NATIVE_VERIFIER_FAILURE"));
  const older = await invoke("verification_read", { id: job.id });
  check("Old successful evidence is marked historical after the draft changes", older.status === "passed" && !older.current);
  const after = await access.panel("world.open", { id: access.worldId });
  check("Verification and preview do not publish draft code or replace saved player progress",
    after.world.build.id === before.world.build.id && JSON.stringify(after.world.snapshot.player) === JSON.stringify(before.world.snapshot.player));
  return { passed, failed, preview };
}
