import { craftmineProjectIdentity } from "./craftmine-tool-context";

export const CRAFTMINE_PANEL_CHANNELS = new Set([
  "workbench.capabilities", "task.current", "task.recoverable", "task.resume", "task.discard", "task.stop",
  "library.search", "library.read", "library.prepareInstall", "library.install", "library.capture",
  "memory.search", "memory.propose", "memory.retire", "selection.set", "selection.clear",
  "backup.export", "backup.inspect", "backup.restore", "backup.status", "backup.cancel",
  "diagnostics.status", "diagnostics.export",
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
  backup: (channel: string, payload: Record<string, any>) => Promise<any>;
  diagnostics: (channel: string, payload: Record<string, any>) => Promise<any>;
}) {
  const inFlight = new Map<string, Promise<any>>();
  return async function request(channel: string, payload: Record<string, any> = {}): Promise<any> {
    if (!CRAFTMINE_PANEL_CHANNELS.has(channel)) throw new Error("UNSUPPORTED_WORKBENCH_CHANNEL");
    if (!payload || Array.isArray(payload) || ["context", "host", "sessionId", "turnId", "projectId", "binding", "origin"].some(key => Object.hasOwn(payload, key))) throw new Error("HOST_IDENTITY_REQUIRED");
    const selection = await options.domain("selection.read", {});
    const worldId = selection.worldId;
    if (typeof worldId !== "string" || !worldId || payload.worldId !== worldId) throw new Error("SELECTED_WORLD_CHANGED");
    const sessionId = options.viewingSession();
    const session = sessionId ? await options.session(sessionId) : null;
    const owner: Owner = { sessionId, projectId: sessionId ? craftmineProjectIdentity(session, sessionId) : `world-${worldId}`, selectedWorld: worldId, active: !!(sessionId && options.activeTurn(sessionId)) };
    const workbench = (name: string, input: Record<string, any> = payload, host: Owner = owner) => options.domain("workbench.request", { channel: name, payload: input, host });
    if (channel === "workbench.capabilities") {
      const available = await workbench(channel);
      return { channels: [...new Set([...available.channels, "task.resume", "task.discard", "task.stop", ...[...CRAFTMINE_PANEL_CHANNELS].filter(name => /^(backup|diagnostics)\./.test(name))])] };
    }
    if (channel.startsWith("backup.")) {
      const { worldId: _worldId, ...input } = payload;
      return options.backup(channel, input);
    }
    if (channel.startsWith("diagnostics.")) {
      const { worldId: _worldId, ...input } = payload;
      return options.diagnostics(channel, input);
    }
    if (!["library.install", "memory.propose", "task.resume", "task.discard", "task.stop"].includes(channel)) return workbench(channel);
    if (!sessionId || !session) throw new Error("请先创建或打开一个创作任务，再执行此操作。");
    const current = await workbench("task.current", { worldId });
    if (channel === "task.stop") {
      if (!owner.active || current.context?.binding?.taskId !== payload.taskId || current.context?.generation !== payload.generation) throw new Error("STALE_TASK");
      await options.stop(sessionId); return { stopped: true };
    }
    if (owner.active) throw new Error("ACTIVE_TASK_EXISTS");
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
      try {
        if (channel === "task.resume") {
          const result = await options.domain("task.resume", { context, worldId, taskId: payload.taskId, generation: payload.generation });
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
      } catch (error) { await options.end(sessionId, "error"); throw error; }
    })();
    inFlight.set(key, action);
    try { return await action; } finally { inFlight.delete(key); }
  };
}
