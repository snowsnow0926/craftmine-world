// Fixed, opt-in native acceptance. No arbitrary RPC or renderer source is accepted.
import { randomUUID } from "node:crypto";
import type { BrowserWindow, WebContents } from "electron";

type Access = {
  enabled: boolean;
  window: () => BrowserWindow | null;
  world: () => WebContents | null;
  call: <T = any>(method: string, params: Record<string, unknown>) => Promise<T>;
  panel: (channel: string, payload: Record<string, unknown>) => Promise<any>;
  active: (sessionId: string) => boolean;
};

export function installNativeAgentAcceptance(access: Access): void {
  if (!access.enabled || process.env.CRAFTMINE_F_AGENT !== "1" || !process.send) return;
  let sessionId = "", worldId = "", started = false, backupGrant: any = null;
  const desktop = (source: string) => {
    const window = access.window();
    if (!window || window.isDestroyed()) throw Error("Acceptance desktop unavailable");
    return window.webContents.executeJavaScript(source, false);
  };
  const panel = async (channel: string, payload: Record<string, unknown> = {}) => {
    const contents = access.world();
    if (!contents) throw Error("Acceptance world view unavailable");
    return contents.executeJavaScript(`pluginBridge.invoke(${JSON.stringify(channel)},${JSON.stringify({ worldId, ...payload })})`, false);
  };
  const run = async (method: string): Promise<unknown> => {
    if (method === "initialize") {
      if (sessionId) throw Error("Acceptance session already initialized");
      const modelId = process.env.CRAFTMINE_F_MODEL || "";
      const secret = process.env.CRAFTMINE_F_KEY || "";
      if (!/^deepseek-[a-z0-9.-]+$/i.test(modelId) || !secret) throw Error("Explicit authorized DeepSeek configuration required");
      const worlds = await access.panel("world.list", {});
      worldId = worlds.activeWorldId;
      if (!worldId) throw Error("Isolated blank world missing");
      const restoreId = process.env.CRAFTMINE_F_REOPEN_SESSION;
      if (restoreId) {
        if (!/^[a-f0-9-]{36}$/.test(restoreId)) throw Error("Invalid fixed recovery session");
        const record = await access.call("session.get", { id: restoreId });
        if (record.session?.id !== restoreId) throw Error("Recovery session missing in isolated profile");
        sessionId = restoreId;
        await desktop(`piDesktop.invoke(piDesktop.channels.invoke.notificationSetViewingSession,${JSON.stringify({ sessionId })})`);
        return { sessionId, worldId, modelId, reopened: true };
      }
      const created = await access.call("session.create", { title: "F native Agent acceptance" });
      sessionId = created.session.id;
      const result = await access.call("providers.create", {
        name: "Isolated real DeepSeek Agent", vendorKey: "deepseek", protocol: "openai_compatible", type: "openai_compatible",
        baseUrl: "https://api.deepseek.com", authKind: "api_key_and_base_url", secretValue: secret,
        apiStyle: "chat_completions", defaultModelId: modelId,
        models: [{ id: modelId, contextWindow: 1000000, maxTokens: 32768, thinkingLevels: ["off", "low", "medium", "high"] }],
      });
      await access.call("session.configure", { id: sessionId, mode: "agent", permissionMode: "auto", providerId: result.provider.id, modelId, thinkingLevel: process.env.CRAFTMINE_F_THINKING || "high" });
      await desktop(`piDesktop.invoke(piDesktop.channels.invoke.notificationSetViewingSession,${JSON.stringify({ sessionId })})`);
      return { sessionId, worldId, modelId };
    }
    if (!sessionId) throw Error("Initialize the isolated acceptance first");
    if (method === "prompt") {
      if (started) throw Error("The fixed acceptance task can only start once");
      started = true;
      const compact = process.env.CRAFTMINE_F_COMPACTIONS === "3";
      const reuse = process.env.CRAFTMINE_F_REUSE_REF ? JSON.parse(process.env.CRAFTMINE_F_REUSE_REF) : null;
      if (reuse && (Object.keys(reuse).sort().join(',') !== 'hash,id,version' || !/^[a-z][a-z0-9-]{0,63}$/.test(reuse.id) || !Number.isSafeInteger(reuse.version) || !/^[a-f0-9]{64}$/.test(reuse.hash))) throw Error("Invalid fixed library reference");
      const content = reuse
        ? `请实际复用作品，不要重新编写树源码。先检索作品库并读取这个精确固定版本：${JSON.stringify(reuse)}。用 library_install 把它加入当前世界位置x=20 y=6 z=4，保留原来的树。不要使用latest或替换已有对象，保留模块来源。安装后实际提交验证、读取结果，若失败请修复。最终应有两棵记忆松树：原来的在(10,6,4)，固定旧版本复用的新树在(20,6,4)，两者总高3、有树干和树冠。通过后保留候选等待玩家应用。`
        : compact
        ? "请实际创作，不要只解释。用现有世界工具在空世界增加一棵有树干和树冠的树，id 为 native-oak。请在同一任务按顺序完成四阶段：1. 先读取规范和当前项目，制作高度5、位置x=-10 y=6 z=4的树并提交草稿；2. 实际调用内置 new_context 压缩上下文，恢复后读取草稿，把树变矮为总高度3并提交；3. 再调用 new_context，恢复后移动树到x=10 y=6 z=4并提交；4. 第三次调用 new_context，恢复后把名称改为记忆松树并提交。三次压缩必须真的执行，不要在文字里模拟。最终验收只针对最后状态：树名记忆松树、位置(10,6,4)、有树干树冠、总高度3。最后实际提交验证、读取验收，若失败请修复；通过后保留候选等待玩家应用。别增加其他物体或玩法。"
        : "请实际创作，不要只解释。读取世界工具规范，在空世界增加一棵有树干和树冠的树，id为native-oak，名称记忆松树，位置x=10 y=6 z=4，总高度3。提交草稿，实际提交验证并读取结果，若失败请修复。通过后保留候选等待玩家应用，别增加其他物体或玩法。";
      return desktop(`piDesktop.invoke(piDesktop.channels.invoke.agentPrompt, ${JSON.stringify({ sessionId, viewingSessionId: sessionId, messageId: randomUUID(), content })})`);
    }
    if (method === "snapshot") {
      const record = await access.call("session.get", { id: sessionId });
      return { sessionId, worldId, active: access.active(sessionId), record,
        verifications: await access.panel("verification.list", { worldId, limit: 16 }) };
    }
    if (method === "abort") return desktop(`piDesktop.invoke(piDesktop.channels.invoke.agentAbort, ${JSON.stringify({ sessionId })})`);
    if (method === "capture") return panel("library.capture", { operationId: "f-capture-native-oak-v1", kind: "object", resourceId: "native-oak", tags: ["native-f-tree"] });
    if (method === "memory") {
      const proposed = await panel("memory.propose", { operationId: "f-memory-tree-rule-v1", kind: "project-rule", claim: "这个世界复用树时保留原树。", tags: ["native-f-rule"] });
      return { proposed, search: await panel("memory.search", { query: "保留原树", includeInactive: true }) };
    }
    if (method === "context") return panel("task.current");
    if (method === "resume") {
      const result = await panel("task.recoverable");
      if (result.items?.length !== 1) throw Error("Expected exactly one real interrupted task");
      const task = result.items[0];
      return panel("task.resume", { taskId: task.taskId || task.id, generation: task.generation });
    }
    if (method === "backup") {
      const exported = await panel("backup.export", { operationId: "f-backup-export-0001" });
      const inspected = await panel("backup.inspect");
      backupGrant = inspected;
      return { exported, inspected };
    }
    if (method === "restoreBackup") {
      if (!backupGrant?.grantId) throw Error("Inspect the real selected backup first");
      return panel("backup.restore", { operationId: "f-backup-restore-0001", grantId: backupGrant.grantId, expectedCurrentHash: backupGrant.expectedCurrentHash });
    }
    if (method === "retryReview") {
      const list = await access.panel("verification.list", { worldId, limit: 16 });
      const job = (Array.isArray(list) ? list : list.items || []).find((item: any) => item.current && item.status === "passed");
      if (!job) throw Error("No passed current candidate to review");
      return panel("review.start", { verificationId: job.id });
    }
    if (method === "apply") {
      const list = await access.panel("verification.list", { worldId, limit: 16 });
      const items = Array.isArray(list) ? list : list.items || list.records || [];
      const job = items.find((item: any) => item.status === "passed" && item.current !== false);
      if (!job) throw Error("No passed current verification to apply");
      const contents = access.world();
      if (!contents) throw Error("Acceptance world view unavailable");
      return contents.executeJavaScript(`(async()=>{
        await craftmineView.preview(${JSON.stringify(job.id)});
        const deadline=Date.now()+180000;
        while(document.getElementById('apply-world').disabled&&Date.now()<deadline){
          const reviews=await pluginBridge.invoke('review.list',{verificationId:${JSON.stringify(job.id)}});
          const latest=reviews[0];
          if(latest&&['failed','cancelled','interrupted'].includes(latest.status))throw Error('Actual review unavailable: '+(latest.error||latest.status));
          await new Promise(resolve=>setTimeout(resolve,250));
        }
        if(document.getElementById('apply-world').disabled)throw Error('Real review did not enable application');
        document.getElementById('apply-form').requestSubmit();
        while(Date.now()<deadline){
          if(!document.body.dataset.previewLoaded&&document.body.dataset.worldLoaded==='true')return {applied:true,snapshot:await craftmineView.snapshot()};
          await new Promise(resolve=>setTimeout(resolve,250));
        }
        throw Error('Native application did not finish');
      })()`, false);
    }
    throw Error("Unknown fixed F acceptance operation");
  };
  process.on("message", (message: any) => {
    if (message?.type !== "craftmine-acceptance-f" || typeof message.id !== "string") return;
    if (Object.keys(message).some(key => !["type", "id", "method"].includes(key))) {
      process.send?.({ type: message.type, id: message.id, error: "Unexpected acceptance fields" });
      return;
    }
    void run(message.method).then(result => process.send?.({ type: message.type, id: message.id, result }),
      error => process.send?.({ type: message.type, id: message.id, error: String(error?.message || error) }));
  });
}
