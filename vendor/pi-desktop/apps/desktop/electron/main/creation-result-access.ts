import { validatePreviewControl } from "../../shared/craftmine-preview-controls";

/** A result card may select a candidate, never supply build facts or application tokens. */
export async function assertCreationResultAccess(input: Record<string, unknown>, access: {
  viewingSession: () => string | null | undefined;
  selectedWorld: () => Promise<string | null>;
  domain: (method: string, payload: Record<string, unknown>) => Promise<any>;
}) {
  const request = validatePreviewControl(input);
  if (!["open", "adopt"].includes(String(request.action))) return;
  const checkContext = async () => {
    if (access.viewingSession() !== request.sessionId || await access.selectedWorld() !== request.worldId)
      throw Error("CREATION_RESULT_CONTEXT_CHANGED");
  };
  await checkContext();
  const job = await access.domain("godotBuild.latest", {sessionId: request.sessionId});
  if (!job || job.jobId !== request.jobId || job.worldId !== request.worldId
    || job.buildId !== request.buildId || job.candidateId !== request.candidateId
    || job.status !== "passed" || job.sourceStale === true) throw Error("CREATION_RESULT_STALE");
  const result = await access.domain("godotCandidate.read", {worldId: request.worldId, candidateId: request.candidateId});
  const candidate = result?.candidate;
  if (!candidate || candidate.worldId !== request.worldId || candidate.buildId !== request.buildId
    || candidate.candidateId !== request.candidateId || candidate.status !== "ready"
    || candidate.checkJobId !== request.jobId || result.checkStatus !== "passed") throw Error("CREATION_RESULT_STALE");
  await checkContext();
}
