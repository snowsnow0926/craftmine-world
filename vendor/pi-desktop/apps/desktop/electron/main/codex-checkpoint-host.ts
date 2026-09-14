import { createHash } from "node:crypto";
import { CODEX_WORLD_MODEL, CODEX_WORLD_EFFORT } from "@pi-desktop/shared";
import type { CraftmineTurnBinding } from "./craftmine-turn-gateway";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const transcriptHash=(messages:any[])=>digest(messages.map(message=>({id:message.id,role:message.role,content:message.content,
  status:message.status,toolName:message.toolName,toolArgs:message.toolArgs,toolResult:message.toolResult,
  attachments:message.attachments?.map((image:any)=>({ref:image.ref,kind:image.kind,mimeType:image.mimeType}))})));
function fail(code: string): never { throw Object.assign(Error(code), { data: { errorCode: code } }); }
type Access = {
  binding(sessionId: string, turnId: string): CraftmineTurnBinding | undefined;
  call(method: string, params: Record<string, unknown>): Promise<any>;
  drain(sessionId: string): Promise<void>;
  fence(sessionId: string, turnId: string, status: "error" | "aborted"): Promise<void>;
};

/** Only transport metadata crosses this private sidecar channel. Never page RPC. */
export class CodexCheckpointHost {
  constructor(private readonly access: Access) {}
  async invoke(method: string, params: Record<string, any>) {
    const sessionId = String(params.sessionId ?? ""), turnId = String(params.turnId ?? "");
    const binding = this.access.binding(sessionId, turnId);
    if (!binding) fail("CODEX_ACTIVE_WORLD_TURN_REQUIRED");
    if (method === "codex.fence") {
      if (params.status !== "aborted" && params.status !== "error") fail("CODEX_FENCE_STATUS_INVALID");
      await this.access.fence(sessionId, turnId, params.status);
      return { ok: true };
    }
    if (method !== "codex.checkpoint.load" && method !== "codex.checkpoint.save") fail("CODEX_METHOD_DENIED");
    await this.access.drain(sessionId);
    const detail = await this.access.call("session.get", { id: sessionId });
    if (!detail.session) fail("CODEX_SESSION_MISSING");
    if (this.access.binding(sessionId, turnId) !== binding) fail("CODEX_STALE_TURN");
    const bindingDigest = digest([binding.sessionId, binding.projectId, binding.selectedWorld, detail.session.projectPath ?? null]);
    let messages = detail.session.messages ?? [];
    if (method === "codex.checkpoint.load") {
      if (!params.userMessageId || messages.at(-1)?.id !== params.userMessageId || messages.at(-1)?.role !== "user") fail("CODEX_USER_MESSAGE_NOT_CURRENT");
      messages = messages.slice(0, -1);
    }
    // Revision pager metadata and UI timings do not change what the model saw.
    const transcriptDigest = transcriptHash(messages);
    if (method === "codex.checkpoint.load") {
      const { checkpoint: stored } = await this.access.call("session.codexCheckpointGet", { sessionId });
      if (stored && stored.bindingDigest !== bindingDigest) fail("CODEX_WORLD_SOURCE_BINDING_CHANGED");
      const deferredMessageIds:string[]=[];
      // Only verification failures before any native history mutation are local
      // requests. Keep them visible and deliver their original text on recovery.
      while(stored && stored.transcriptDigest!==transcriptHash(messages) && messages.length>=2){
        const [user,error]=messages.slice(-2);
        const readFailure=error.status==='error'&&error.error?.code==='CODEX_INTERRUPTED_RECOVERY_UNVERIFIED';
        const readAborted=error.status==='aborted'&&error.error?.code==='TURN_ABORTED'&&error.error?.details?.recoveryReadOnly===true;
        if(user.role!=='user'||error.role!=='assistant'||error.content!==''||(!readFailure&&!readAborted))break;
        deferredMessageIds.unshift(user.id,error.id);messages=messages.slice(0,-2);
      }
      const transcriptMatches=!!stored&&stored.transcriptDigest===transcriptHash(messages);
      let recovery;
      const last=messages.at(-1),user=messages.findLast((m:any)=>m.role==='user');
      if(stored?.checkpoint?.submitted && !stored.checkpoint.synchronized && transcriptMatches &&
        last?.role==='assistant'&&last.status==='aborted'&&last.content===''&&last.error?.code==='TURN_ABORTED'&&user){
        const metrics=await this.access.call('session.turnMetrics',{sessionId,messageId:user.id}).catch(()=>undefined);
        if(this.access.binding(sessionId,turnId)!==binding)fail('CODEX_STALE_TURN');
        // Presence marks a recovery candidate even if metrics cannot certify it:
        // the runtime must fail visibly rather than silently rebuild this tail.
        recovery={hostTurnId:metrics?.status==='aborted'&&metrics?.sessionId===sessionId?metrics.turnId:null,
          sessionId,projectId:binding.projectId,worldId:binding.selectedWorld,userMessageId:user.id,
          tailEndMessageId:last.id,deferredMessageIds};
      }
      return { checkpoint: stored?.checkpoint, transcriptMatches, ...(recovery?{recovery}:{}) };
    }
    const checkpoint = validateCodexCheckpoint(params.checkpoint);
    await this.access.call("session.codexCheckpointSet", { sessionId, turnId, checkpoint: { bindingDigest, transcriptDigest, checkpoint } });
    return { ok: true };
  }
}

export function validateCodexCheckpoint(value: any) {
  if (!value || Object.keys(value).some(key => !["version", "model", "effort", "threadId", "toolDigest", "submitted", "synchronized", "usageTotal"].includes(key)) ||
      value.version !== 1 || value.model !== CODEX_WORLD_MODEL || value.effort !== CODEX_WORLD_EFFORT ||
      typeof value.threadId !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(value.threadId) ||
      !/^[a-f0-9]{64}$/.test(value.toolDigest) || typeof value.submitted !== "boolean" || typeof value.synchronized !== "boolean") fail("CODEX_CHECKPOINT_INVALID");
  if (value.usageTotal !== undefined && (!value.usageTotal || Object.entries(value.usageTotal).some(([key, count]) =>
      !["inputTokens", "outputTokens", "totalTokens", "cachedInputTokens", "cacheWriteInputTokens", "reasoningOutputTokens"].includes(key) || !Number.isSafeInteger(count) || (count as number) < 0))) fail("CODEX_CHECKPOINT_USAGE_INVALID");
  return value;
}
