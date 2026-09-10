// Explicitly enabled, finite acceptance only. Real credentials never enter Main.
import { randomUUID } from "node:crypto";
import type { BrowserWindow, WebContents } from "electron";

export const P8_MODEL = "deepseek-v4.1-flash-expires-on-0910";
export const P8_PROMPTS = {
  hammer: "这是新的隔离测试训练场；下面是重建需求，不是原玩家提示。请真正用当前Godot工程工具创作一把可见的雷神之锤，稳定装备ID为thunder_hammer，能在出生点附近拾取、装备，用现有普通攻击操作击打目标，并产生有至少1秒冷却的局部闪电视觉效果。保留原训练目标、原装备和所有旧进度字段。请先读当前底座规范及相关工程文件，沿实际工具读写、构建、检查反馈修正；不要使用旧体素world JSON代替Godot源码，也不要用文字模拟完成。锤子造型可以用工程内几何制作，不需要外部资产下载。不要加入测试专用接口、伪造观察值或为了通过检查重置玩家进度。只完成这个有限功能，实际发起Godot检查并读其结果，通过后保留未采用候选，等待玩家确认；明确给出候选ID、真实拾取位置和普通操作，不要宣称已正式采用。",
  dog: "这是新的隔离俯视村落测试世界；下面是重建需求，不是原玩家提示。请真正用当前Godot工程工具增加一只明显可见的小狗，稳定ID为p8-dog，在玩家出生点附近；在有限距离内跟随玩家，走远后停止追赶，接近交互时显示一句狗狗对白。保留地图、已有角色、任务、背包、钱物和所有旧进度字段。请先读当前底座规范及相关工程文件，沿实际工具读写、构建、检查反馈修正；不能用旧体素world JSON代替Godot源码，不要只说能做到。小狗可用项目内绘制或几何制作，不需要外部资产下载。不要加入测试专用接口、伪造观察值或为了检查清空旧进度。只完成这个有限功能，实际发起Godot检查并读取结果，通过后保留未采用候选等待玩家确认；明确给出候选ID、真实所在位置、跟随范围与普通交互操作，不要宣称已正式采用。",
} as const;
type CaseId = keyof typeof P8_PROMPTS;
type Binding = { sessionId: string; worldId: string; providerId: string; submitted: boolean };
export type P8AcceptanceAccess = {
  enabled: boolean;
  window: () => BrowserWindow | null;
  world: () => WebContents | null;
  call: <T = any>(method: string, params: Record<string, unknown>) => Promise<T>;
  panel: (channel: string, payload: Record<string, unknown>) => Promise<any>;
  active: (sessionId: string) => boolean;
};
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9-]{36}$/.test(v);
const worldId = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9][a-z0-9-]{1,47}$/.test(v);
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);

export function createP8Acceptance(access: P8AcceptanceAccess, env: Record<string, string | undefined>) {
  const bindings = new Map<CaseId, Binding>();
  let busy = false;
  const desktop = (script: string) => {
    const window = access.window();
    if (!window || window.isDestroyed()) throw Error("P8_DESKTOP_UNAVAILABLE");
    return window.webContents.executeJavaScript(script, false);
  };
  const selected = async (expected: string) => {
    const list = await access.panel("world.list", {});
    if (list.activeWorldId !== expected) throw Error("P8_WORLD_CHANGED");
    const contents = access.world(); if (!contents || contents.isDestroyed()) throw Error("P8_WORLD_UNAVAILABLE");
    const current = await contents.executeJavaScript("document.body.dataset.worldId", false);
    if (current !== expected) throw Error("P8_WORLD_CHANGED");
    return list.worlds?.find((item: any) => item.id === expected);
  };
  const choose = async (binding: Binding) => {
    await selected(binding.worldId);
    await desktop(`(async()=>{if(!globalThis.__craftmineHeadless||!globalThis.__PI_DESKTOP__?.selectSession)throw Error('P8_REAL_RENDERER_REQUIRED');await __PI_DESKTOP__.selectSession(${JSON.stringify(binding.sessionId)});return {selected:true};})()`);
    await desktop(`piDesktop.invoke(piDesktop.channels.invoke.notificationSetViewingSession,${JSON.stringify({ sessionId: binding.sessionId })})`);
    await selected(binding.worldId);
  };
  return async (method: unknown, payload: unknown): Promise<any> => {
    if (!access.enabled || env.CRAFTMINE_P8_NATIVE !== "1") throw Error("P8_NOT_ENABLED");
    if (!record(payload) || !["hammer", "dog"].includes(payload.caseId) || typeof method !== "string" || !["initialize", "submit", "snapshot", "abort"].includes(method)
      || Object.keys(payload).some(key => !["caseId", ...(method === "initialize" ? ["worldId"] : [])].includes(key))) throw Error("P8_INVALID_REQUEST");
    if (busy) throw Error("P8_BUSY");
    busy = true;
    try {
      const caseId = payload.caseId as CaseId;
      if (method === "initialize") {
        if (!worldId(payload.worldId)) throw Error("P8_INVALID_WORLD");
        const old = bindings.get(caseId);
        if (old) { if (old.worldId !== payload.worldId) throw Error("P8_BINDING_CONFLICT"); await choose(old); return { ...old, caseId, modelId: P8_MODEL, replayed: true }; }
        const row = await selected(payload.worldId);
        if (row?.baseId !== (caseId === "hammer" ? "first-person" : "top-down") || row?.state !== "ready") throw Error("P8_READY_BASE_REQUIRED");
        const base = new URL(env.CRAFTMINE_P8_PROXY_BASE ?? "invalid:");
        if (base.protocol !== "http:" || base.hostname !== "127.0.0.1" || !base.port || base.username || base.password || base.search || base.hash || !/^\/[a-f0-9]{48}\/deepseek\.com\/v1$/.test(base.pathname)
          || !/^[a-f0-9]{64}$/.test(env.CRAFTMINE_P8_PROXY_AUTH ?? "")) throw Error("P8_FIXED_RELAY_REQUIRED");
        const restored = JSON.parse(env.CRAFTMINE_P8_REOPEN ?? "{}");
        if (!record(restored) || Object.keys(restored).some(key => !["hammer", "dog"].includes(key))) throw Error("P8_INVALID_REOPEN");
        let binding: Binding;
        if (restored[caseId]) {
          const value = restored[caseId];
          if (!record(value) || Object.keys(value).sort().join(",") !== "providerId,sessionId,worldId" || !uuid(value.sessionId) || !uuid(value.providerId) || value.worldId !== payload.worldId) throw Error("P8_INVALID_REOPEN");
          const saved = await access.call("session.get", { id: value.sessionId });
          if (saved.session?.id !== value.sessionId || saved.session.providerId !== value.providerId || saved.session.modelId !== P8_MODEL) throw Error("P8_REOPEN_IDENTITY_MISMATCH");
          binding = { sessionId: value.sessionId, providerId: value.providerId, worldId: value.worldId, submitted: true };
        } else {
          const provider = await access.call("providers.create", { name: "P8 isolated DeepSeek relay", vendorKey: "deepseek", protocol: "openai_compatible", type: "openai_compatible", baseUrl: base.href, authKind: "api_key_and_base_url", secretValue: env.CRAFTMINE_P8_PROXY_AUTH,
            apiStyle: "chat_completions", defaultModelId: P8_MODEL, models: [{ id: P8_MODEL, contextWindow: 128000, maxTokens: 16384, thinkingLevels: ["off"] }] });
          if (!uuid(provider.provider?.id)) throw Error("P8_PROVIDER_RECEIPT_INVALID");
          const created = await access.call("session.create", { title: caseId === "hammer" ? "P8 重建案例：雷神之锤" : "P8 重建案例：小狗" });
          if (!uuid(created.session?.id)) throw Error("P8_SESSION_RECEIPT_INVALID");
          binding = { sessionId: created.session.id, worldId: payload.worldId, providerId: provider.provider.id, submitted: false };
          await access.call("session.configure", { id: binding.sessionId, mode: "agent", permissionMode: "auto", providerId: binding.providerId, modelId: P8_MODEL, thinkingLevel: "off" });
        }
        bindings.set(caseId, binding); await choose(binding);
        return { ...binding, caseId, modelId: P8_MODEL, prompt: P8_PROMPTS[caseId], transport: "fixed loopback relay to https://api.deepseek.com/chat/completions", reopened: !!restored[caseId] };
      }
      const binding = bindings.get(caseId); if (!binding) throw Error("P8_INITIALIZE_REQUIRED");
      if (method === "abort") return desktop(`piDesktop.invoke(piDesktop.channels.invoke.agentAbort,${JSON.stringify({ sessionId: binding.sessionId })})`);
      await selected(binding.worldId);
      if (method === "submit") {
        if (binding.submitted) throw Error("P8_ALREADY_SUBMITTED");
        await choose(binding); binding.submitted = true;
        return desktop(`piDesktop.invoke(piDesktop.channels.invoke.agentPrompt,${JSON.stringify({ sessionId: binding.sessionId, viewingSessionId: binding.sessionId, messageId: randomUUID(), content: P8_PROMPTS[caseId] })})`);
      }
      const saved = await access.call("session.get", { id: binding.sessionId });
      const metrics = await access.call("session.turnMetrics", { sessionId: binding.sessionId });
      const dom = await desktop(`({metrics:[...document.querySelectorAll('.task-metrics')].map(section=>({turnId:section.dataset.taskId,coverage:section.dataset.taskCoverage,text:section.innerText,values:Object.fromEntries([...section.querySelectorAll('[data-metric]')].map(item=>[item.dataset.metric,item.textContent]))})),guard:globalThis.__craftmineHeadless})`);
      await selected(binding.worldId);
      return { ...binding, caseId, modelId: P8_MODEL, active: access.active(binding.sessionId), record: saved, metrics, dom };
    } finally { busy = false; }
  };
}

export function installP8NativeAcceptance(access: P8AcceptanceAccess): void {
  if (!access.enabled || process.env.CRAFTMINE_P8_NATIVE !== "1" || !process.send) return;
  const run = createP8Acceptance(access, process.env);
  process.on("message", (value: unknown) => {
    if (!record(value) || value.type !== "craftmine-acceptance-p8") return;
    if (typeof value.id !== "string" || value.id.length > 100 || Object.keys(value).sort().join(",") !== "id,method,payload,type") {
      process.send?.({ type: "craftmine-acceptance-p8", id: typeof value.id === "string" ? value.id.slice(0, 100) : "invalid", error: "P8_INVALID_ENVELOPE" }); return;
    }
    void run(value.method, value.payload).then(result => process.send?.({ type: value.type, id: value.id, result }), error => process.send?.({ type: value.type, id: value.id, error: error instanceof Error ? error.message : "P8_FAILED" }));
  });
}
