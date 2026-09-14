import { describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import type { AssistantMessage, Context, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { buildProviderModel, createProviderModels, type RuntimeProviderConfig } from "./provider-binding.js";
import { craftmineGuardedStream, createCraftmineRequestHooks, type CraftmineTaskContext } from "./craftmine-context.js";
import { DesktopAgentRuntime } from "./runtime.js";

const provider: RuntimeProviderConfig = { id: "fixture-provider", name: "Fixture", baseUrl: "https://api.deepseek.com", modelId: "deepseek-flash",
  apiKey: "fake-never-sent", supportsReasoning: true, supportedThinkingLevels: ["off", "max"],
  modelConfig: { source: "generic", name: "Flash", baseUrl: "https://api.deepseek.com", input: ["text", "image"], reasoning: true,
    contextWindow: 1000000, maxTokens: 384000, supportedThinkingLevels: ["off", "max"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } };
const model = buildProviderModel(provider), models = createProviderModels(provider, model);
const answer: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: 2,
  content: [{ type: "text", text: "Done" }], stopReason: "stop", usage: { input: 3000, cacheRead: 1000, cacheWrite: 0, output: 5,
    totalTokens: 4005, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
const context: Context = { systemPrompt: "Stable system", tools: [], messages: [
  { role: "user", content: "Existing scene\n".repeat(18000), timestamp: 1 }, answer,
  { role: "user", content: "Keep working", timestamp: 3 },
] };
function fixture() {
  let revision = 1;
  let pauseReserve: (() => Promise<void>) | undefined;
  const calls: Array<{ method: string; params: any }> = [], bodies: any[] = [];
  const snapshot = (): CraftmineTaskContext => ({ binding: { projectId: "p", sessionId: "s", turnId: "t", taskId: "task", baseBuild: "v1" },
    generation: 1, status: "running", world: { id: "w", revision, buildId: "v1", hash: "a".repeat(64) }, draft: { revision, hash: "b".repeat(64) },
    requirements: [{ id: "r", text: "Make it playable", kind: "request" }], modifiedResources: [], receipts: [], jobs: [], lease: { owned: true }, budget: {} });
  const hooks = createCraftmineRequestHooks({ getContext: async () => snapshot(), domainCall: async <T>(method: string, params: any) => {
    calls.push({ method, params }); if (method === "budget.reserve") await pauseReserve?.(); return {} as T;
  } });
  const transport = vi.fn(async (_url: any, init?: RequestInit) => {
    expect(calls.at(-1)?.method).toBe("budget.reserve");
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "deepseek-flash",
      choices: [{ index: 0, delta: { role: "assistant", content: "Done" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 4000, completion_tokens: 5, total_tokens: 4005, prompt_tokens_details: { cached_tokens: 1000 } } })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
  });
  const run = (input = context, options: SimpleStreamOptions = {}) => craftmineGuardedStream(model, input, { reasoning: "max", fetch: transport, ...options }, hooks,
    "creation", (prepared, opts) => models.streamSimple(model, prepared, opts), true).result();
  return { hooks, calls, bodies, transport, run, revise() { revision++; }, pauseReserve(callback: () => Promise<void>) { pauseReserve = callback; } };
}
const nextContext = (): Context => ({ ...context, messages: [...context.messages, { ...answer, timestamp: 4 }, { role: "user", content: "继续添加互动🐕", timestamp: 5 }] });

describe("pinned DeepSeek SDK final-body calibrated reservations", () => {
  it("uses successful measured input for an exact append while preserving current host facts and 384K output", async () => {
    const f = fixture(); expect((await f.run()).stopReason).toBe("stop");
    const first = f.calls.find(call => call.method === "budget.reserve")!.params;
    expect(first.estimatedInputTokens).toBeGreaterThan(100000);
    f.revise(); const next = nextContext();
    const inspected = await f.hooks.inspectRequest!({ requestId: "preflight", purpose: "creation", model, context: next, maxOutputTokens: 384000 });
    expect(inspected.method).toContain("measured-whole-prompt-exact-prefix");
    expect(inspected.input).toBeLessThan(20000);
    expect((await f.run(next)).stopReason).toBe("stop");
    const reservations = f.calls.filter(call => call.method === "budget.reserve");
    expect(reservations).toHaveLength(2);
    expect(reservations[1].params.estimatedInputTokens).toBeLessThan(20000);
    expect(reservations.map(call => call.params.maxOutputTokens)).toEqual([384000, 384000]);
    expect(f.bodies[1].max_tokens).toBe(384000); expect(f.bodies[1].reasoning_effort).toBe("max");
    expect(JSON.stringify(f.bodies[1].messages.at(-1))).toContain('\\"revision\\":2');
    const settlement = f.calls.filter(call => call.method === "budget.settle").at(-1)!.params;
    expect(settlement.usage).toEqual({ inputTokens: 3000, outputTokens: 5, totalTokens: 4005 });
    expect(settlement.promptUsage).toBeUndefined();
  });
  it("falls back before reservation when the final effort or payload differs from the preflight", async () => {
    for (const options of [{ reasoning: "high" as const }, { onPayload: (body: any) => ({ ...body, temperature: 0.25 }) }, { headers: { "x-feature": "changed" } }]) {
      const f = fixture(); await f.run(); const next = nextContext();
      expect((await f.hooks.inspectRequest!({ requestId: "p", purpose: "creation", model, context: next, maxOutputTokens: 384000 })).input).toBeLessThan(20000);
      expect((await f.run(next, options)).stopReason).toBe("stop");
      expect(f.calls.filter(call => call.method === "budget.reserve").at(-1)!.params.estimatedInputTokens).toBeGreaterThan(100000);
    }
  });
  it("uses the normal PI loop with a tool result that previously crossed the conservative trigger", async () => {
    const f = fixture(), events: any[] = [];
    const completeEstimates: number[] = [];
    const prepareRequest = f.hooks.prepareRequest!;
    f.hooks.prepareRequest = async input => { const prepared = await prepareRequest(input); completeEstimates.push(prepared.estimate.input); return prepared; };
    let count = 0;
    const tool = "plugin_craftmine_world_project_inspect";
    const fakeFetch = vi.fn(async (_url: any, init?: RequestInit) => {
      expect(f.calls.at(-1)?.method).toBe("budget.reserve");
      const body = JSON.parse(String(init?.body));
      expect(body.max_tokens).toBe(384000); expect(body.reasoning_effort).toBe("max");
      const first = count++ === 0;
      return new Response(`data: ${JSON.stringify({ id: "native-fixture", object: "chat.completion.chunk", created: 1, model: model.id,
        choices: [{ index: 0, delta: first ? { role: "assistant", reasoning_content: "Inspect the scene.", tool_calls: [{ index: 0, id: "source-read", type: "function", function: { name: tool, arguments: "{}" } }] }
          : { role: "assistant", content: "The requested interaction is complete." }, finish_reason: first ? "tool_calls" : "stop" }],
        usage: { prompt_tokens: 4000, completion_tokens: 5, total_tokens: 4005, prompt_tokens_details: { cached_tokens: 1000 } } })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
    });
    const host = { call: vi.fn(async (method: string) => method === "tools.execute" ? { content: [{ type: "text", text: "scene ".repeat(34000) }] } : {}), onNotification: () => () => {} };
    vi.stubGlobal("fetch", fakeFetch);
    const runtime = new DesktopAgentRuntime({ craftmineWorld: true, craftmineHooks: f.hooks, sessionId: "s", turnId: "t", mode: "agent", thinkingLevel: "max", provider,
      commandShell: { id: "bash", label: "Bash", dialect: "posix", available: true, isDefault: true },
      history: [{ id: "old-user", role: "user", content: "source ".repeat(128000), createdAt: "2026-09-14T00:00:00Z", status: "complete" },
        { id: "old-answer", role: "assistant", content: "Source remains unchanged.", createdAt: "2026-09-14T00:00:01Z", status: "complete" }],
      pluginTools: [{ name: tool, description: "Inspect the current scene" }], host: host as any, onEvent: event => events.push(event) });
    try {
      await runtime.prompt("Continue creating the interaction.", "new-user", "t");
      expect(count, JSON.stringify(events.filter(envelope => envelope.event.type === "error").map(envelope => envelope.event.error))).toBe(2);
      expect(host.call.mock.calls.some(call => call[0] === "tools.execute")).toBe(true);
      expect(events.some(envelope => envelope.event.type === "compaction_start")).toBe(false);
      const reservations = f.calls.filter(call => call.method === "budget.reserve");
      expect(reservations).toHaveLength(2);
      expect(reservations[0].params.estimatedInputTokens).toBeGreaterThan(400000);
      expect(reservations[1].params.estimatedInputTokens).toBeLessThan(160000);
      expect(completeEstimates[0]).toBeLessThan(521859);
      expect(completeEstimates[1]).toBeGreaterThan(521859);
      expect((runtime as any).fullEntries.at(-1).message.stopReason).toBe("stop");
      if (process.env.CRAFTMINE_PREFIX_REPORT) writeFileSync(process.env.CRAFTMINE_PREFIX_REPORT, JSON.stringify({ fixture: "Native PI loop + pinned SDK + controlled fetch; synthetic provider usage, no model call",
        contextWindow: 1000000, maxOutputTokens: 384000, threshold: 521859, promptUsage: { input: 3000, cacheRead: 1000, cacheWrite: 0 },
        completeEstimates, reservedInputs: reservations.map(call => call.params.estimatedInputTokens), physicalRequests: count,
        compactions: events.filter(envelope => envelope.event.type === "compaction_start").length }, null, 2));
    } finally { await runtime.dispose(); vi.unstubAllGlobals(); }
  });
  it("requires known successful usage and a surviving lifecycle epoch before reusing a receipt", async () => {
    for (const status of ["unknown", "cancelled", "error", "boundary"] as const) {
      const f = fixture(); await f.run();
      const original = f.hooks.afterRequest;
      f.hooks.afterRequest = async input => {
        if (status === "boundary") { f.hooks.clearPromptReceipt!(); return original(input); }
        return original({ ...input, ...(status === "error" ? { errorCode: "PROVIDER_REQUEST_FAILED" } : { status }), promptUsage: status === "unknown" ? undefined : input.promptUsage });
      };
      await f.run(nextContext());
      expect((await f.hooks.inspectRequest!({ requestId: "p", purpose: "creation", model, context: nextContext(), maxOutputTokens: 384000 })).method).not.toContain("measured-");
    }
  });
  it("does not fetch when the durable reservation is refused", async () => {
    const f = fixture(); await f.run();
    f.hooks.finalizeRequest = async () => { throw new Error("TOKEN_BUDGET_EXHAUSTED"); };
    expect((await f.run(nextContext())).errorMessage).toBe("TOKEN_BUDGET_EXHAUSTED");
    expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it("rejects a changed or oversized serialized payload without a low reservation or network request", async () => {
    const f = fixture(); await f.run();
    const failed = await f.run(nextContext(), { onPayload: (body: any) => ({ ...body, extra: "x".repeat(1400000) }) });
    expect(failed.errorMessage).toContain("CRAFTMINE_PREFIX_FALLBACK_CONTEXT_TOO_LARGE");
    expect(f.transport).toHaveBeenCalledTimes(1);
    expect(f.calls.filter(call => call.method === "budget.reserve")).toHaveLength(1);
    expect((await f.hooks.inspectRequest!({ requestId: "p", purpose: "creation", model, context: nextContext(), maxOutputTokens: 384000 })).method).not.toContain("measured-");
  });
  it("keeps media on the original conservative accounting path", async () => {
    const f = fixture(); await f.run(); const next = nextContext();
    next.messages.push({ role: "user", content: [{ type: "image", data: "a".repeat(20000), mimeType: "image/png" }], timestamp: 6 });
    const inspected = await f.hooks.inspectRequest!({ requestId: "p", purpose: "creation", model, context: next, maxOutputTokens: 384000 });
    expect(inspected.method).not.toContain("measured-"); expect(inspected.attachments).toBeGreaterThan(10000);
    expect((await f.run(next)).stopReason).toBe("stop");
    expect(f.calls.filter(call => call.method === "budget.reserve").at(-1)!.params.estimatedInputTokens).toBeGreaterThan(100000);
  });
  it("clears receipts on cancellation and never sends an unreserved request after a delayed reservation", async () => {
    const f = fixture(); await f.run(); const controller = new AbortController();
    const original = f.hooks.finalizeRequest!;
    let release!: () => void, reached!: () => void;
    const arrived = new Promise<void>(resolve => { reached = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    f.hooks.finalizeRequest = async (...args) => { reached(); await gate; return original(...args); };
    const pending = f.run(nextContext(), { signal: controller.signal }); await arrived;
    controller.abort(); expect((await pending).stopReason).toBe("aborted"); release();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(f.transport).toHaveBeenCalledTimes(1); expect(f.calls.filter(call => call.method === "budget.reserve")).toHaveLength(1);
    expect((await f.hooks.inspectRequest!({ requestId: "p", purpose: "creation", model, context: nextContext(), maxOutputTokens: 384000 })).method).not.toContain("measured-");
  });
  it("rejects SDK body mutation after onPayload and clears completed receipts on compaction", async () => {
    const f = fixture(); await f.run();
    const failed = await craftmineGuardedStream(model, nextContext(), { fetch: f.transport }, f.hooks, "creation", (prepared, opts) => {
      const stream = createAssistantMessageEventStream();
      void (async () => {
        try {
          const body: any = { model: model.id, max_tokens: 384000, messages: [{ role: "user", content: "test" }] };
          await opts.onPayload!(body, model); body.temperature = 1;
          await opts.fetch!("https://api.deepseek.com/chat/completions", { method: "POST", body: JSON.stringify(body) }); stream.end(answer);
        } catch (error) { stream.end({ ...answer, stopReason: "error", errorMessage: String(error) }); }
      })(); return stream;
    }, true).result();
    expect(failed.errorMessage).toContain("CRAFTMINE_UNVERIFIED_PROVIDER_BODY"); expect(f.transport).toHaveBeenCalledTimes(1);
    await f.run(); await f.hooks.onBoundary({ kind: "compaction", eventId: "compact" });
    expect((await f.hooks.inspectRequest!({ requestId: "p", purpose: "creation", model, context: nextContext(), maxOutputTokens: 384000 })).method).not.toContain("measured-");
  });
  it("settles a reservation cancelled while the host was acknowledging it, without dispatch", async () => {
    const f=fixture(); await f.run(); const controller=new AbortController();
    let release!:()=>void,reached!:()=>void;
    const arrived=new Promise<void>(resolve=>{reached=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
    f.pauseReserve(async()=>{reached();await gate;});
    const pending=f.run(nextContext(),{signal:controller.signal});await arrived;controller.abort();
    expect((await pending).stopReason).toBe("aborted");release();await new Promise(resolve=>setTimeout(resolve,10));
    expect(f.calls.filter(call=>call.method==="budget.reserve")).toHaveLength(2);
    expect(f.calls.filter(call=>call.method==="budget.settle").at(-1)!.params).toMatchObject({status:"cancelled",errorCode:"CANCELLED_BEFORE_SEND"});
    expect(f.transport).toHaveBeenCalledTimes(1);
  });
});
