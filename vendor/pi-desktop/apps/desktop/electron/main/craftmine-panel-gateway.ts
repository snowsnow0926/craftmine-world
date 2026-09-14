import { ASSET_PANEL_CHANNELS, requestAssetPanel } from "./craftmine-asset-panel";
import { craftmineProjectIdentity } from "./craftmine-tool-context";
import { PERSISTENT_WORKBENCH_CHANNELS, type CraftmineOperationJournal, type OperationOwner, type PendingOperation } from "./craftmine-operation-journal";
import type {PackageRequestOwner} from './craftmine-package-service';

export const CRAFTMINE_PANEL_CHANNELS = new Set([
  "workbench.capabilities", "task.current", "task.recoverable", "task.resume", "task.discard", "task.stop",
  "library.search", "library.read", "library.prepareInstall", "library.install", "library.capture",
  "memory.search", "memory.propose", "memory.retire", "selection.set", "selection.clear",
  "backup.export", "backup.inspect", "backup.restore", "backup.status", "backup.cancel",
  "diagnostics.status", "diagnostics.export",
  "issue.create", "issue.list", "issue.read", "issue.delete", "issue.followupPrepare", "issue.followup", "issue.export",
  "targetFeedback.describe", "targetFeedback.submit", "targetFeedback.status",
  "workbench.operations", "workbench.prepare", "workbench.execute", "workbench.acknowledge", "draft.recheck", "task.budget", "task.releaseExecutionLimits",
  // Asset library reads (R6's contract). Writes stay in the player import flow.
  "asset.search", "asset.read", "asset.versions", "asset.usage", "asset.scan",
  "asset.probe", "asset.previewRead", "asset.annotate",
  "asset.import", "asset.preview", "asset.cancel",
  "package.request",
]);
type Domain = (method: string, params: Record<string, any>) => Promise<any>;
type Owner = { sessionId: string | null; projectId: string; selectedWorld: string; active: boolean; context?: Record<string, string>; origin?: unknown; previous?: any };

/** Renderer selections describe an action; identities always come from Main. */
export function createCraftminePanelGateway(options: {
  viewingSession: () => string | null;
  session: (id: string) => Promise<any>;
  activeTurn: (id: string) => string | undefined;
  domain: Domain;
  begin: (session: any) => Promise<string>;
  end: (sessionId: string, status: "completed" | "error") => Promise<void>;
  stop: (sessionId: string) => Promise<void>;
  resume: (session: any, turnId: string, result: any) => Promise<void>;
  interrupt: (context: Record<string, string>, reason: string) => Promise<void>;
  backup: (channel: string, payload: Record<string, any>) => Promise<any>;
  diagnostics: (channel: string, payload: Record<string, any>) => Promise<any>;
  issues?: (channel: string, payload: Record<string, any>) => Promise<any>;
  targetFeedback?: (channel: string, payload: Record<string, any>) => Promise<any>;
  packages?: (channel: string, payload: Record<string, any>, owner:PackageRequestOwner) => Promise<any>;
  authorizeAssetSource?: (sourceRoot: string, sourcePath?: string) => Promise<void>;
  operations?: CraftmineOperationJournal;
}) {
  const inFlight = new Map<string, Promise<any>>();
  const internal = Symbol("host-operation");
  async function request(channel: string, payload: Record<string, any> = {}, permit?: { token: symbol; owner: OperationOwner }): Promise<any> {
    if (!CRAFTMINE_PANEL_CHANNELS.has(channel)) throw new Error("UNSUPPORTED_WORKBENCH_CHANNEL");
    if (!payload || Array.isArray(payload) || ["context", "host", "sessionId", "turnId", "projectId", "binding", "origin"].some(key => Object.hasOwn(payload, key))) throw new Error("HOST_IDENTITY_REQUIRED");
    if (ASSET_PANEL_CHANNELS.has(channel)) return requestAssetPanel(channel, payload, options);
    const selection = await options.domain("selection.read", {});
    const worldId = selection.worldId;
    if (typeof worldId !== "string" || !worldId || payload.worldId !== worldId) throw new Error("SELECTED_WORLD_CHANGED");
    const sessionId = options.viewingSession();
    const session = sessionId ? await options.session(sessionId) : null;
    const owner: Owner = { sessionId, projectId: sessionId ? craftmineProjectIdentity(session, sessionId) : `world-${worldId}`, selectedWorld: worldId, active: !!(sessionId && options.activeTurn(sessionId)) };
    const operationOwner = { projectId: owner.projectId, sessionId, worldId };
    if (permit && (permit.token !== internal || JSON.stringify(permit.owner) !== JSON.stringify(operationOwner))) throw new Error("OPERATION_OWNER_CHANGED");
    const workbench = (name: string, input: Record<string, any> = payload, host: Owner = owner) => options.domain("workbench.request", { channel: name, payload: input, host });
    const executeStored = async (record: PendingOperation) => {
      if (record.channel === "task.releaseExecutionLimits") {
        const saved = await options.domain("budget.findExecutionReleaseReceipt", {
          ...record.payload, ...operationOwner, operationId: record.operationId,
        });
        if (saved !== null) return saved;
      }
      if (record.channel === "task.budget") {
        // A resumed task has a new head. The original player operation can
        // still be completed by its exact authoritative receipt, without
        // applying the old policy to that new task or creating another turn.
        const saved = await options.domain("budget.findReceipt", {
          ...record.payload, ...operationOwner, operationId: record.operationId,
        });
        if (saved !== null) return saved;
      }
      if (record.channel === "backup.restore") {
        // A main-process restart loses its picker grant. Resolve an already
        // committed restore before attempting to consume that grant again.
        let result: any;
        try { result = await options.backup("backup.status", { operationId: record.operationId }); } catch { /* A missing receipt is not success. */ }
        if (result?.status === "reconciliation-pending" && result.activated === true && result.errorCode === "BACKUP_RESTORED_RECONCILIATION_PENDING") return result;
        if (result?.status === "completed" || result?.status === "cancelled") return { operationId: record.operationId, status: result.status, ...(result.currentHash ? { currentHash: result.currentHash } : {}), scope: "profile", modelReplay: false };
      }
      return request(record.channel, { ...record.payload, worldId, operationId: record.operationId }, { token: internal, owner: operationOwner });
    };
    if (["workbench.operations", "workbench.prepare", "workbench.execute", "workbench.acknowledge"].includes(channel)) {
      if (!options.operations) throw new Error("OPERATION_JOURNAL_UNAVAILABLE");
      const fields = channel === "workbench.prepare" ? ["worldId", "channel", "payload"] : channel === "workbench.operations" ? ["worldId"] : ["worldId", "operationId"];
      if (Object.keys(payload).some(key => !fields.includes(key))) throw new Error("INVALID_OPERATION_PARAMS");
      if (channel === "workbench.operations") return { items: await options.operations.list(operationOwner) };
      if (channel === "workbench.prepare") {
        if (!PERSISTENT_WORKBENCH_CHANNELS.has(payload.channel)) throw new Error("UNSUPPORTED_DURABLE_OPERATION");
        if (["library.install", "memory.propose", "draft.recheck", "task.budget", "task.releaseExecutionLimits"].includes(payload.channel) && !sessionId) throw new Error("HOST_SESSION_REQUIRED");
        return options.operations.prepare(operationOwner, payload.channel, payload.payload);
      }
      if (channel === "workbench.acknowledge") return options.operations.acknowledge(operationOwner, payload.operationId);
      return options.operations.execute(operationOwner, payload.operationId, executeStored);
    }
    if (options.operations && PERSISTENT_WORKBENCH_CHANNELS.has(channel) && !permit) {
      const { worldId: _worldId, operationId, ...input } = payload;
      const record = await options.operations.prepare(operationOwner, channel, input, operationId);
      return options.operations.execute(operationOwner, record.operationId, executeStored);
    }
    if (channel === "workbench.capabilities") {
      const available = await workbench(channel);
      available.channels = [...available.channels, "task.releaseExecutionLimits"];
      return { channels: [...new Set([...available.channels, "task.resume", "task.discard", "task.stop", "task.budget", ...(options.packages ? ["package.request"] : []), ...(options.targetFeedback ? ["targetFeedback.describe", "targetFeedback.submit", "targetFeedback.status"] : []), ...(options.issues ? ["issue.create", "issue.list", "issue.read", "issue.delete", "issue.followupPrepare", "issue.followup", "issue.export"] : []), ...(options.operations ? ["workbench.operations", "workbench.prepare", "workbench.execute", "workbench.acknowledge"] : []), ...[...CRAFTMINE_PANEL_CHANNELS].filter(name => /^(backup|diagnostics)\./.test(name))])] };
    }
    if (channel === "package.request") {
      if (!options.packages) throw Error("PACKAGE_SERVICE_UNAVAILABLE");
      if (owner.active) throw Error("ACTIVE_TASK_EXISTS");
      const assertCurrent=async()=>{
        if(options.viewingSession()!==sessionId)throw Error('PACKAGE_OWNER_CHANGED');
        const selected=await options.domain('selection.read',{});
        if(selected.worldId!==worldId||options.viewingSession()!==sessionId)throw Error('PACKAGE_OWNER_CHANGED');
        const current=sessionId?await options.session(sessionId):null;
        if(options.viewingSession()!==sessionId||(sessionId&&(current?.id!==sessionId||craftmineProjectIdentity(current,sessionId)!==owner.projectId)))throw Error('PACKAGE_OWNER_CHANGED');
        if(sessionId&&options.activeTurn(sessionId))throw Error('ACTIVE_TASK_EXISTS');
        const final=await options.domain('selection.read',{});
        if(final.worldId!==worldId||options.viewingSession()!==sessionId)throw Error('PACKAGE_OWNER_CHANGED');
        if(sessionId&&options.activeTurn(sessionId))throw Error('ACTIVE_TASK_EXISTS');
      };
      const packageOwner={...operationOwner,assertCurrent};
      await assertCurrent();const result=await options.packages(channel,payload,packageOwner);await assertCurrent();return result;
    }
    if (channel.startsWith("backup.")) {
      const { worldId: _worldId, ...input } = payload;
      return options.backup(channel, input);
    }
    if (channel.startsWith("diagnostics.")) {
      const { worldId: _worldId, ...input } = payload;
      return options.diagnostics(channel, input);
    }
    if (channel.startsWith("issue.")) {
      if (!options.issues) throw Error("ISSUE_SERVICE_UNAVAILABLE");
      return options.issues(channel, payload);
    }
    if (channel.startsWith("targetFeedback.")) {
      if (!options.targetFeedback) throw Error("TARGET_FEEDBACK_UNAVAILABLE");
      if (owner.active && channel === "targetFeedback.submit") throw Error("ACTIVE_TASK_EXISTS");
      return options.targetFeedback(channel, payload);
    }
    if (!["library.install", "memory.propose", "task.resume", "task.discard", "task.stop", "draft.recheck", "task.budget", "task.releaseExecutionLimits"].includes(channel)) return workbench(channel);
    if (!sessionId || !session) throw new Error("请先创建或打开一个创作任务，再执行此操作。");
    const current = await workbench("task.current", { worldId });
    if (channel === "task.stop") {
      if (!owner.active || current.context?.binding?.taskId !== payload.taskId || current.context?.generation !== payload.generation) throw new Error("STALE_TASK");
      await options.stop(sessionId); return { stopped: true };
    }
    if (owner.active) throw new Error("ACTIVE_TASK_EXISTS");
    if (channel === "task.releaseExecutionLimits") {
      const bound = current.context;
      if (!bound || bound.binding.taskId !== payload.taskId || bound.generation !== payload.generation) throw new Error("STALE_TASK");
      if (Object.keys(payload).some(key => !["worldId", "operationId", "taskId", "generation"].includes(key))) throw new Error("INVALID_OPERATION_PARAMS");
      return options.domain("budget.releaseExecutionLimits", { projectId: owner.projectId, sessionId, worldId, taskId: payload.taskId, generation: payload.generation, operationId: payload.operationId });
    }
    if (channel === "task.budget") {
      const bound = current.context;
      if (!bound || bound.binding.taskId !== payload.taskId || bound.generation !== payload.generation) throw new Error("STALE_TASK");
      if (Object.keys(payload).some(key => !["worldId", "operationId", "taskId", "generation", "maxTokens"].includes(key))) throw new Error("INVALID_OPERATION_PARAMS");
      return options.domain("budget.configure", { projectId: owner.projectId, sessionId, worldId, taskId: payload.taskId, generation: payload.generation, operationId: payload.operationId, maxTokens: payload.maxTokens });
    }
    if (channel === "draft.recheck") {
      const bound = current.context;
      if (!bound || bound.status !== "finished" || bound.binding.taskId !== payload.taskId || bound.generation !== payload.generation || bound.draft.revision !== payload.revision || bound.draft.hash !== payload.draftHash) throw new Error("STALE_DRAFT");
      return workbench(channel, payload, { ...owner, context: { projectId: owner.projectId, sessionId, turnId: bound.binding.turnId }, origin: { modelKey: session.providerId && session.modelId ? `${session.providerId}/${session.modelId}` : null, thinkingLevel: session.thinkingLevel } });
    }
    if (channel === "task.discard") return options.domain("task.discard", { projectId: owner.projectId, sessionId, worldId, taskId: payload.taskId, generation: payload.generation });
    if (channel === "library.install" || channel === "memory.propose") {
      const previous = await workbench("workbench.prepareAction", { channel, payload });
      if (previous) return previous;
    }
    const operationId = payload.operationId ?? payload.taskId;
    if (typeof operationId !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(operationId)) throw new Error("INVALID_OPERATION_ID");
    const key = JSON.stringify([sessionId, channel, operationId]);
    const pending = inFlight.get(key);
    if (pending) return pending;
    const action = (async () => {
      const turnId = await options.begin(session);
      const context = { projectId: owner.projectId, sessionId, turnId };
      let recovered = false;
      try {
        if (channel === "task.resume") {
          const result = await options.domain("task.resume", { context, worldId, taskId: payload.taskId, generation: payload.generation });
          recovered = true;
          // A fresh explicit player request continues this same recovered
          // budget owner. Ending a placeholder turn here would reset it.
          await options.resume(session, turnId, result);
          return { ...result, modelReplay: false, continuation: "running" };
        }
        const text = channel === "memory.propose" ? payload.claim : `将作品 ${payload.ref?.id}@${payload.ref?.version} 加入当前世界。`;
        const origin = { modelKey: session.providerId && session.modelId ? `${session.providerId}/${session.modelId}` : null,
          thinkingLevel: session.thinkingLevel, request: { messageId: operationId, text, attachmentsOmitted: 0 } };
        await options.domain("turn.begin", { context, selectedWorld: worldId, request: { id: operationId, text } });
        const result = await workbench(channel, payload, { ...owner, context, origin, previous: current.context });
        await options.end(sessionId, "completed");
        return result;
      } catch (error) {
        // A committed recovery must remain recoverable if starting the fresh
        // model request fails; otherwise the next prompt creates a new ledger.
        if (recovered) await options.interrupt(context, "RESUME_LAUNCH_FAILED");
        await options.end(sessionId, "error"); throw error;
      }
    })();
    inFlight.set(key, action);
    try { return await action; } finally { inFlight.delete(key); }
  }
  return (channel: string, payload: Record<string, any> = {}) => request(channel, payload);
}
