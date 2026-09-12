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
  type UncertainSave = {worldId: string; buildId: string; instanceId: string; revision: number; snapshot: unknown};
  // An unavailable reconciliation read must not forget the exact write whose
  // reply was lost. This is evidence for a later explicit save, not a retry job.
  const uncertainSaves = new Map<string, UncertainSave>();
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
      const key = JSON.stringify([call.worldId, call.buildId, receipt.instanceId]);
      const ownsInstance = () => {const live=options.instance();return live?.worldId===call.worldId&&live.buildId===call.buildId&&live.instanceId===receipt.instanceId;};
      const readExact = async (pending: UncertainSave) => {
        // Saving is a durable-world fact. A missing/corrupt rebuildable Web
        // artifact must not make an already committed snapshot unknowable.
        const saved = await options.domain("world.read", {id: pending.worldId});
        if (!ownsInstance() || !object(saved) || saved.id!==pending.worldId || saved.world?.build?.id!==pending.buildId ||
          !Number.isSafeInteger(saved.revision) || saved.revision<pending.revision || !HASH.test(saved.contentHash) ||
          !isDeepStrictEqual(saved.world?.snapshot,pending.snapshot)) return null;
        return saved;
      };
      const confirmed = (saved: Record<string, any>) => durable({receipt:{
        format:"craftmine.godot-progress-receipt/1",worldId:saved.id,buildId:saved.world.build.id,
        revision:saved.revision,contentHash:saved.contentHash,instanceId:receipt.instanceId,snapshotSha256:receipt.snapshotSha256,
      }},call);
      const persist = async (revision: number, mayRecover: boolean): Promise<GodotWorldProgressResult> => {
        try {
          if (!ownsInstance()) return {failed:true,error:"GODOT_RUNNER_RECEIPT_MISMATCH"};
          const result=durable(await options.domain("godotRuntime.saveProgress",{worldId:call.worldId,buildId:call.buildId,revision,runnerReceipt:receipt,snapshot:state}),call);
          uncertainSaves.delete(key);return result;
        } catch(error) {
          const pending=uncertainSaves.get(key);
          if (mayRecover && object(error) && error.errorCode==="WORLD_REVISION_CONFLICT" && pending && call.revision<=pending.revision) {
            let saved=null;try {saved=await readExact(pending);} catch {/* Preserve the actual conflict if evidence is unavailable. */}
            if (saved) {
              if (isDeepStrictEqual(saved.world.snapshot,state)) {const result=confirmed(saved);uncertainSaves.delete(key);return result;}
              // Only this instance's exact earlier uncertain snapshot permits
              // rebasing a new save. CAS still rejects every intervening write.
              return persist(saved.revision,false);
            }
          }
          if (object(error) && error.errorCode) throw error;
          const uncertain:UncertainSave={worldId:call.worldId,buildId:call.buildId,instanceId:String(receipt.instanceId),revision,snapshot:structuredClone(state)};
          uncertainSaves.set(key,uncertain);
          if (uncertainSaves.size>8) uncertainSaves.delete(uncertainSaves.keys().next().value!);
          try {
            const saved=await readExact(uncertain);
            if (saved) {const result=confirmed(saved);uncertainSaves.delete(key);return result;}
          } catch {/* Keep both the original error and the exact pending save evidence. */}
          throw error;
        }
      };
      return persist(call.revision,true);
    },
  };
}
