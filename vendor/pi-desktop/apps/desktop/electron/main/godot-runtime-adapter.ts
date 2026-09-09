import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { GodotWorldOpenRequest, GodotWorldProgressCall, GodotWorldProgressResult } from "./godot-world-view-host";
const HASH = /^[a-f0-9]{64}$/;
export type RuntimeArtifact = { path: string; sha256: string; bytes: number };
export type GodotRuntimeDescriptor = GodotWorldOpenRequest & { format: "craftmine.godot-runtime-descriptor/1"; phase: "formal"; baseId: string; contentHash: string; artifactManifestHash: string; artifacts: RuntimeArtifact[] };
export type GodotCandidateDescriptor = Omit<GodotRuntimeDescriptor,"phase"> & {phase:"candidate";applicationId:string;applicationInputHash:string};

type Domain = (method: string, params: Record<string, unknown>) => Promise<unknown>;
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
/** Private main-process adapter: paths and durable receipts come only from Rust. */
export function createGodotRuntimeAdapter(options: {
  domain: Domain; selection: () => Promise<string | null>;
  instance: () => { worldId: string; buildId: string; instanceId: string } | null;
}) {
  const roots = new Set<string>();
  function descriptor(value: unknown, worldId: string, phase = "formal"): GodotRuntimeDescriptor | null {
    if (value === null) return null;
    if (!object(value) || value.format !== "craftmine.godot-runtime-descriptor/1" || value.phase !== phase || value.worldId !== worldId ||
        typeof value.buildId !== "string" || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
        !HASH.test(value.contentHash) || !HASH.test(value.artifactManifestHash) || typeof value.root !== "string" ||
        value.entry !== "web/index.html" || !Array.isArray(value.artifacts) || value.artifacts.length < 1 || value.artifacts.length > 4096) throw new Error("INVALID_GODOT_RUNTIME_DESCRIPTOR");
    const files = new Set<string>();
    for (const file of value.artifacts) {
      if (!object(file) || typeof file.path !== "string" || !HASH.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || files.has(file.path)) throw new Error("INVALID_GODOT_RUNTIME_ARTIFACT");
      files.add(file.path);
    }
    if (!files.has(value.entry)) throw new Error("GODOT_RUNTIME_ENTRY_UNDECLARED");
    roots.add(value.root);
    return value as GodotRuntimeDescriptor;
  }
  const describe = async (worldId: string) => descriptor(await options.domain("godotRuntime.describe", { worldId }), worldId);
  const durable = (value: unknown, call: GodotWorldProgressCall) => {
    if (!object(value) || !object(value.receipt)) throw new Error("GODOT_DURABLE_RECEIPT_REQUIRED");
    const receipt = value.receipt;
    if (receipt.format !== "craftmine.godot-progress-receipt/1" || receipt.instanceId !== call.runnerReceipt.instanceId || receipt.snapshotSha256 !== call.runnerReceipt.snapshotSha256 || receipt.worldId !== call.worldId || receipt.buildId !== call.buildId ||
        !Number.isSafeInteger(receipt.revision) || receipt.revision < call.revision || !HASH.test(receipt.contentHash)) throw new Error("GODOT_DURABLE_RECEIPT_MISMATCH");
    return { receipt: receipt as any };
  };
  return {
    allowedRoots: () => [...roots], describe,
    async describeCandidate(worldId: string, applicationId: string, token: string): Promise<GodotCandidateDescriptor> {
      const value = await options.domain("godotRuntime.describeCandidate", {worldId, applicationId, token});
      if (!object(value) || value.applicationId !== applicationId || !HASH.test(value.applicationInputHash)) throw new Error("INVALID_GODOT_CANDIDATE_DESCRIPTOR");
      const result = descriptor(value, worldId, "candidate");
      if (!result) throw new Error("GODOT_CANDIDATE_UNAVAILABLE");
      return result as unknown as GodotCandidateDescriptor;
    },
    async descriptor() { const id = await options.selection(); return id ? describe(id) : null; },
    async progress(call: GodotWorldProgressCall): Promise<GodotWorldProgressResult> {
      const current = options.instance(), receipt = call.runnerReceipt;
      if (!current || current.worldId !== call.worldId || current.buildId !== call.buildId ||
          receipt.format !== "craftmine.godot-runner-receipt/1" || receipt.worldId !== current.worldId ||
          receipt.buildId !== current.buildId || receipt.instanceId !== current.instanceId ||
          typeof receipt.snapshotText !== "string" || !HASH.test(String(receipt.snapshotSha256)) ||
          receipt.bytes !== Buffer.byteLength(receipt.snapshotText, "utf8") || Number(receipt.bytes) > 1024 * 1024 ||
          hash(receipt.snapshotText) !== receipt.snapshotSha256) return { failed: true, error: "GODOT_RUNNER_RECEIPT_MISMATCH" };
      let state;
      try { state = JSON.parse(receipt.snapshotText); } catch { return { failed: true, error: "INVALID_GODOT_PROGRESS" }; }
      if (!object(state) || state.format !== "craftmine.godot-progress/1" || state.worldId !== call.worldId || !isDeepStrictEqual(state, call.snapshot)) return { failed: true, error: "GODOT_SNAPSHOT_MISMATCH" };
      let result;
      try { result = await options.domain("godotRuntime.saveProgress", { worldId: call.worldId, buildId: call.buildId, revision: call.revision, runnerReceipt: receipt, snapshot: state }); }
      catch (error) {
        // Never repeat an uncertain mutation. Only an exact Rust-persisted state
        // at this build/revision can resolve a missing transport reply.
        if (object(error) && error.errorCode) throw error;
        try {
          const saved = await describe(call.worldId);
          if (saved && saved.buildId === call.buildId && saved.revision >= call.revision && isDeepStrictEqual(saved.snapshot, state)) return durable({ receipt: {
            format: "craftmine.godot-progress-receipt/1", worldId: saved.worldId, buildId: saved.buildId,
            revision: saved.revision, contentHash: saved.contentHash,
            instanceId: receipt.instanceId, snapshotSha256: receipt.snapshotSha256,
          } }, call);
        } catch { /* Keep the original uncertain error. */ }
        throw error;
      }
      return durable(result, call);
    },
  };
}
