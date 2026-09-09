// Fixed native acceptance scenario; never registers a general-purpose RPC tool.
import { runNativeVerificationProbe } from "./craftmine-verification-probe";
type Call = <T = any>(method: string, params: Record<string, unknown>) => Promise<T>;

export async function runNativeDraftProbe(access: {
  call: Call;
  toolName: (name: string) => string;
  begin: (sessionId: string, turnId: string) => void;
  finish: (sessionId: string) => Promise<void>;
  reviewBaseUrl?: string;
  liveReview?: { modelId: string; secret: string; thinkingLevel: string };
  verification?: {
    panel: (channel: string, payload: Record<string, unknown>) => Promise<any>;
    preview: (id: string) => Promise<any>;
    apply?: (id: string) => Promise<any>;
  };
}): Promise<unknown> {
  const checks: Array<{ name: string; passed: boolean }> = [];
  const check = (name: string, value: boolean) => {
    checks.push({ name, passed: !!value });
    if (!value) throw new Error(`Native draft check failed: ${name}`);
  };
  const created = await access.call("session.create", { title: "Native draft acceptance" });
  const sessionId = created.session.id as string;
  let providerId: string | undefined;
  const modelId=access.liveReview?.modelId||"craftmine-review-fixture";
  if(access.liveReview) {
    if(!/^deepseek-[a-z0-9.-]+$/i.test(modelId)||!access.liveReview.secret)throw Error("Explicit live DeepSeek configuration is required");
    const result=await access.call("providers.create",{name:"Isolated live DeepSeek review",vendorKey:"deepseek",protocol:"openai_compatible",type:"openai_compatible",
      baseUrl:"https://api.deepseek.com",authKind:"api_key_and_base_url",secretValue:access.liveReview.secret,apiStyle:"chat_completions",defaultModelId:modelId,
      models:[{id:modelId,contextWindow:1000000,maxTokens:32768,thinkingLevels:["off","low","medium","high"]}]});
    providerId=result.provider.id;
  } else if(access.reviewBaseUrl) {
    if(!/^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(access.reviewBaseUrl))throw Error("Native review fixture must be loopback");
    const result=await access.call("providers.create",{name:"Isolated review fixture",vendorKey:"custom",protocol:"openai_compatible",type:"openai_compatible",
      baseUrl:access.reviewBaseUrl,authKind:"api_key_and_base_url",secretValue:"isolated-fixture-key",apiStyle:"chat_completions",defaultModelId:"craftmine-review-fixture",
      models:[{id:"craftmine-review-fixture",contextWindow:128000,maxTokens:4096,thinkingLevels:["off"]}]});
    providerId=result.provider.id;
  }
  await access.call("session.configure", { id: sessionId, mode: "agent", permissionMode: "auto",...(providerId?{providerId,modelId,thinkingLevel:access.liveReview?.thinkingLevel||"off"}:{}) });
  const turn = await access.call("session.beginTurn", { sessionId });
  const turnId = turn.turnId as string;
  if(providerId)await access.call("session.appendMessage",{sessionId,turnId,message:{id:"native-review-user",role:"user",content:"真实宿主需求：在地上增加一朵有花瓣的花，按 G 隐藏花，再按一次恢复。",createdAt:new Date().toISOString(),status:"complete"}});
  access.begin(sessionId, turnId);
  let sequence = 0;
  const raw = (name: string, args: unknown, callId = `native-world-${++sequence}`) => access.call("tools.execute", {
    sessionId, turnId, toolCallId: callId, toolName: access.toolName(name), args, mode: "agent", declaredRisk: "medium", timeoutMs: 10_000,
  });
  const invoke = async (name: string, args: unknown, callId?: string) => {
    const result = await raw(name, args, callId);
    if (!result.ok) throw new Error(`${name}: ${JSON.stringify(result)}`);
    return result.content;
  };
  try {
    const start = await invoke("project_inspect", {});
    check("PI Rust dispatch resolves the actual session and world identity", !!start.worldId && start.workspaceRevision === 0);
    const request = { workspaceRevision: 0, operations: [{
      op: "add", kind: "object", id: "native-flower", expectedHash: null,
      value: { id: "native-flower", name: "原生测试花", position: { x: 3, y: 6, z: 4 }, source: null,
        components: { health: 0, contactDamage: 0 }, parts: [
          { shape: "box", offset: { x: 0, y: 0, z: 0 }, size: { x: 0.05, y: 0.6, z: 0.05 }, color: "#40804c", material: "solid", solid: false },
          { shape: "box", offset: { x: -0.12, y: 0.58, z: -0.12 }, size: { x: 0.3, y: 0.08, z: 0.3 }, color: "#f4a1c0", material: "solid", solid: false },
        ] },
    }] };
    const result = await invoke("workspace_patch", request, "native-add-flower");
    check("Native utility process compiles and commits a real resource", result.workspaceRevision === 1);
    const replay = await invoke("workspace_patch", request, "native-add-flower");
    check("The same host tool-call ID recovers its committed receipt", replay.workspaceRevision === 1 && replay.replayed);
    const read = await invoke("resource_read", { kind: "object", id: "native-flower" });
    check("Native read returns the saved authored resource and its hash", JSON.parse(read.text).parts.length === 2 && read.hash.length === 64);
    const forged = await raw("project_inspect", { sessionId: "foreign" });
    check("Native tool dispatch cannot accept model-authored session identity", !forged.ok);
    const verification = access.verification ? await runNativeVerificationProbe({ invoke, check, worldId: start.worldId, liveReview:!!access.liveReview, ...access.verification }) : null;
    await access.finish(sessionId);
    const late = await raw("workspace_patch", request, "native-late-flower");
    check("Finishing the host turn prevents late native tool writes", !late.ok);
    if(access.verification?.apply){
      const next=await access.call("session.beginTurn",{sessionId});access.begin(sessionId,next.turnId);
      const after=await access.call("tools.execute",{sessionId,turnId:next.turnId,toolCallId:"native-after-apply",toolName:access.toolName("project_inspect"),args:{},mode:"agent",declaredRisk:"low",timeoutMs:10000});
      check("The next native PI turn starts from the applied world and retains the flower",after.ok&&after.content.baseBuild!==start.baseBuild&&after.content.resources.some((resource:any)=>resource.id==='native-flower'));
    }
    return { sessionId, turnId, worldId: start.worldId, taskId: start.taskId, checks, draftAuthorship:"fixed-native-fixture", modelCalled:!!access.liveReview, verification };
  } finally {
    await access.finish(sessionId);
  }
}
