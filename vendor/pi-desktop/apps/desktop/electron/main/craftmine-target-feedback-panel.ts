import { targetFeedbackConfiguration, validateTargetFeedbackConfiguration } from "../../../../../../desktop/godot/shared/target-feedback-configuration.mjs";

type Data = Record<string, any>;
const object = (value: unknown): value is Data => !!value && typeof value === "object" && !Array.isArray(value);
function fail(code: string): never { throw Object.assign(Error(code), {code}); }
const fields = (value: unknown, allowed: string[]) => { if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail("TARGET_FEEDBACK_INVALID_ARGUMENT"); };
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const allowed = ["targetFeedback.describe", "targetFeedback.submit", "targetFeedback.status"];
const rejectedBeforeWrite = ["TARGET_FEEDBACK_STALE_BINDING", "TARGET_FEEDBACK_UNAPPLIED_DRAFT", "TARGET_FEEDBACK_FORMAL_SOURCE_REQUIRED"];
function binding(value: unknown, worldId: string, targetId: string): Data {
  fields(value, ["format", "worldId", "buildId", "contentOid", "revision", "manifestHash", "targetId", "targetHash"]);
  const b = value as Data;
  if (b.format !== "craftmine.target-feedback-source/1" || b.worldId !== worldId || b.targetId !== targetId || !id(b.buildId) ||
      typeof b.contentOid !== "string" || !/^[a-f0-9]{40}$/.test(b.contentOid) || !Number.isSafeInteger(b.revision) || b.revision < 0 || !hash(b.manifestHash) || !hash(b.targetHash)) fail("TARGET_FEEDBACK_STALE_BINDING");
  return {...b};
}
function values(value: unknown) {
  fields(value, ["hitFlashMilliseconds"]); const milliseconds = (value as Data).hitFlashMilliseconds;
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1 || milliseconds > 1000) fail("TARGET_FEEDBACK_INVALID_VALUE");
  return {hitFlashMilliseconds: milliseconds};
}

export function validateTargetFeedbackIntent(value: unknown): Data {
  fields(value, ["targetId", "sourceBinding", "values"]);
  const input = value as Data;
  if (!id(input.targetId) || !object(input.sourceBinding) || !id(input.sourceBinding.worldId)) fail("TARGET_FEEDBACK_INVALID_ARGUMENT");
  return {targetId: input.targetId, sourceBinding: binding(input.sourceBinding, input.sourceBinding.worldId, input.targetId), values: values(input.values)};
}

export function validateTargetFeedbackReceipt(value: unknown): Data {
  fields(value, ["worldId", "operationId", "status", "applied", "draftRetained", "job", "source", "reason"]);
  const result = value as Data;
  if (!id(result.worldId) || !id(result.operationId) || result.applied !== false || typeof result.draftRetained !== "boolean" ||
      !["rejected", "unchanged", "check-queued", "source-saved-check-blocked", "passed", "failed", "cancelled", "interrupted"].includes(result.status)) fail("TARGET_FEEDBACK_INVALID_RESPONSE");
  if (result.status === "rejected" && (!rejectedBeforeWrite.includes(result.reason) || result.job !== null || result.draftRetained !== false || result.source !== undefined) || result.status !== "rejected" && result.reason !== undefined) fail("TARGET_FEEDBACK_INVALID_RESPONSE");
  if (result.job !== null) {
    fields(result.job, ["jobId", "status", "buildId", "candidateId"]);
    if (!/^gjob-[a-f0-9]{64}$/.test(result.job.jobId) || !["blocked", "queued", "claimed", "running", "passed", "failed", "cancelled", "interrupted"].includes(result.job.status) ||
        result.job.buildId !== undefined && !id(result.job.buildId) || result.job.candidateId !== undefined && !id(result.job.candidateId)) fail("TARGET_FEEDBACK_INVALID_RESPONSE");
  }
  if (result.source !== undefined) {
    fields(result.source, ["revision", "manifestHash"]);
    if (!Number.isSafeInteger(result.source.revision) || result.source.revision < 0 || !hash(result.source.manifestHash)) fail("TARGET_FEEDBACK_INVALID_RESPONSE");
  }
  return structuredClone(result);
}

/** A finite player UI adapter; renderer sourceBinding is never a host task binding. */
export function createCraftmineTargetFeedbackPanel(options: {
  domain: (method: string, args: Data) => Promise<unknown>;
  selection: () => Promise<string | null>;
  blocked: () => boolean;
}) {
  const selected = async (worldId: string) => { if (await options.selection() !== worldId) fail("GODOT_WORLD_CHANGED"); };
  return async (channel: string, input: Data): Promise<Data> => {
    if (!allowed.includes(channel)) fail("TARGET_FEEDBACK_INVALID_ARGUMENT");
    fields(input, channel === "targetFeedback.describe" ? ["worldId"] : channel === "targetFeedback.status" ? ["worldId", "operationId"] : ["worldId", "operationId", "targetId", "sourceBinding", "values"]);
    if (!id(input.worldId) || channel !== "targetFeedback.describe" && !id(input.operationId)) fail("TARGET_FEEDBACK_INVALID_ARGUMENT");
    await selected(input.worldId);
    if (channel !== "targetFeedback.status" && options.blocked()) fail("TARGET_FEEDBACK_WORLD_BUSY");
    let args: Data = {worldId: input.worldId};
    if (channel === "targetFeedback.status") args.operationId = input.operationId;
    if (channel === "targetFeedback.submit") {
      if (!id(input.targetId)) fail("TARGET_FEEDBACK_INVALID_ARGUMENT");
      args = {...args, operationId: input.operationId, targetId: input.targetId, binding: binding(input.sourceBinding, input.worldId, input.targetId), values: values(input.values)};
    }
    let result: unknown;
    try { result = await options.domain(channel, args); }
    catch (error) {
      const code = (error as any)?.code ?? (error as any)?.errorCode ?? (error as any)?.message;
      if (channel !== "targetFeedback.submit" || !rejectedBeforeWrite.includes(code)) throw error;
      // These exact failures occur while deriving the new source plan, before
      // this operation can write. Other errors keep an uncertain durable intent.
      result = {worldId: input.worldId, operationId: input.operationId, status: "rejected", reason: code, applied: false, draftRetained: false, job: null};
    }
    await selected(input.worldId);
    if (!object(result) || result.worldId !== input.worldId) fail("TARGET_FEEDBACK_INVALID_RESPONSE");
    if (channel === "targetFeedback.describe") {
      if (!id(result.buildId) || !Array.isArray(result.targets) || result.targets.length > 512) fail("TARGET_FEEDBACK_INVALID_RESPONSE");
      const identities = new Set<string>();
      const targets = result.targets.map((target: any) => {
        if (!object(target) || !id(target.targetId) || identities.has(target.targetId)) fail("TARGET_FEEDBACK_INVALID_RESPONSE");
        identities.add(target.targetId); validateTargetFeedbackConfiguration(target.configuration);
        return {targetId: target.targetId, label: typeof target.label === "string" ? target.label.slice(0, 160) : target.targetId,
          sourceBinding: binding(target.binding, input.worldId, target.targetId), values: values(target.values), configuration: targetFeedbackConfiguration()};
      });
      return {worldId: input.worldId, buildId: result.buildId, targets, unsupportedCount: Array.isArray(result.unsupported) ? result.unsupported.length : 0};
    }
    if (result.operationId !== input.operationId || result.applied !== false || !["rejected", "unchanged", "check-queued", "source-saved-check-blocked", "passed", "failed", "cancelled", "interrupted"].includes(result.status)) fail("TARGET_FEEDBACK_INVALID_RESPONSE");
    let job: Data | null = null;
    if (result.job) {
      if (!object(result.job) || !/^gjob-[a-f0-9]{64}$/.test(result.job.jobId) || !["blocked", "queued", "claimed", "running", "passed", "failed", "cancelled", "interrupted"].includes(result.job.status)) fail("TARGET_FEEDBACK_INVALID_RESPONSE");
      job = {jobId: result.job.jobId, status: result.job.status, ...(id(result.job.buildId) ? {buildId: result.job.buildId} : {}), ...(id(result.job.candidateId) ? {candidateId: result.job.candidateId} : {})};
    }
    return validateTargetFeedbackReceipt({worldId: input.worldId, operationId: input.operationId, status: result.status, applied: false, draftRetained: result.draftRetained === true, job,
      ...(result.status === "rejected" ? {reason: result.reason} : {}),
      ...(object(result.source) && Number.isSafeInteger(result.source.revision) && hash(result.source.manifestHash) ? {source: {revision: result.source.revision, manifestHash: result.source.manifestHash}} : {})});
  };
}
