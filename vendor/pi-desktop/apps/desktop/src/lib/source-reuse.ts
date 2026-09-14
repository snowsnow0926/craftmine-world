import type { CraftmineWorldBridge } from "./craftmine-worlds";

export type SourceProposal = {
  proposalId: string; worldId: string; displayName: string; status: string;
  source: {revision: number; manifestHash: string};
  assets: Array<{assetId: string; version: number}>;
  execution?: 'author';
  job?: SourceJob;
};
export type SourceJob = {id: string; status: string; sourceStale?: boolean; application?: 'ready'|'applied'|'historical'|'unknown'};
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function parseSourceProposals(value: unknown, worldId: string): SourceProposal[] {
  const raw = object(value);
  if (raw.worldId !== worldId || !Array.isArray(raw.items) || raw.items.length > 256) throw Error("PACKAGE_SOURCE_RECEIPT_INVALID");
  return raw.items.map(value => {
    const item = object(value), source = object(item.source), job = object(object(item.installation).job);
    if (item.worldId !== worldId || typeof item.proposalId !== "string" || !/^source-[a-f0-9]{48}$/.test(item.proposalId)
      || typeof item.displayName !== "string" || !Number.isSafeInteger(source.revision) || !/^[a-f0-9]{64}$/.test(String(source.manifestHash))) throw Error("PACKAGE_SOURCE_RECEIPT_INVALID");
    const refs = item.kind === "group" && Array.isArray(item.items) ? item.items.map(value => object(value).archiveRef) : [item.archiveRef];
    const assets = refs.map(value => { const ref = object(value); if (typeof ref.assetId !== "string" || !Number.isSafeInteger(ref.version)) throw Error("PACKAGE_SOURCE_RECEIPT_INVALID"); return {assetId: ref.assetId, version: ref.version as number}; });
    if(item.execution!==undefined&&item.execution!=='author')throw Error('PACKAGE_SOURCE_RECEIPT_INVALID');
    return {proposalId: item.proposalId, worldId, displayName: item.displayName, status: String(item.status), source: {revision: source.revision as number, manifestHash: source.manifestHash as string}, assets,...(item.execution==='author'?{execution:'author' as const}:{}),
      ...(typeof job.jobId === "string" && /^gjob-[a-f0-9]{64}$/.test(job.jobId) ? {job: {id: job.jobId, status: String(job.status)}} : {})};
  });
}
export async function sourcePackageRequest(bridge: CraftmineWorldBridge, worldId: string, method: "sourceProposals" | "installSourceProposal" | "sourceJob", args: Record<string, unknown> = {}): Promise<unknown> {
  return bridge.call("package.request", {worldId, method, params: {...args, worldId}});
}
export function sourceJobState(value: unknown, worldId: string, jobId: string): string {
  return parseSourceJob(value,worldId,jobId).status;
}
export function parseSourceJob(value: unknown, worldId: string, jobId: string): SourceJob {
  const result = object(value);
  if (result.worldId !== worldId || result.jobId !== jobId || !["blocked", "queued", "claimed", "running", "passed", "failed", "cancelled", "interrupted"].includes(String(result.status))) throw Error("PACKAGE_JOB_RECEIPT_INVALID");
  if (result.sourceStale !== undefined && typeof result.sourceStale !== "boolean") throw Error("PACKAGE_JOB_RECEIPT_INVALID");
  if(result.application!==undefined&&(!['ready','applied','historical','unknown'].includes(String(result.application))||result.status!=='passed'))throw Error('PACKAGE_JOB_RECEIPT_INVALID');
  return {id: jobId,status:String(result.status),...(typeof result.sourceStale==="boolean"?{sourceStale:result.sourceStale}:{}),...(result.application?{application:result.application as SourceJob['application']}:{})};
}
