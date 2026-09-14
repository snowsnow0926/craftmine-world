import { createServer, type ServerResponse } from "node:http";
import { setImmediate as tick } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { buildProviderModel, createProviderModels, type RuntimeProviderConfig } from "./provider-binding.js";
import { craftmineGuardedStream, createCraftmineRequestHooks, type CraftmineTaskContext } from "./craftmine-context.js";

const provider: RuntimeProviderConfig = {
  id: "fake-local-row", name: "Local fixture", baseUrl: "https://api.deepseek.com", modelId: "deepseek-flash",
  apiKey: "fake-local-key", supportsReasoning: true, supportedThinkingLevels: ["off", "max"],
  modelConfig: { source: "generic", name: "Local fixture", baseUrl: "https://api.deepseek.com", input: ["text"], reasoning: true, contextWindow: 1000000, maxTokens: 384000,
    supportedThinkingLevels: ["off", "max"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
};

describe("DeepSeek pre-inference keep-alive through the pinned SDK", () => {
  it.each(["silent", "non-heartbeat", "heartbeat-then-silence", "post-generation", "cancel", "untrusted"] as const)("preserves %s termination and settles exactly once", async mode => {
    const model = buildProviderModel(provider), models = createProviderModels(provider, model), settlements: unknown[] = [];
    const hooks = createCraftmineRequestHooks({ getContext: async () => ({ binding: { projectId: "p", sessionId: "s", turnId: "t", taskId: "task", baseBuild: "b" },
      generation: 1, status: "running", world: { id: "w", revision: 1, buildId: "b", hash: "a".repeat(64) },
      draft: { revision: 1, hash: "b".repeat(64) }, requirements: [], modifiedResources: [], receipts: [], jobs: [], lease: { owned: true }, budget: {} }),
      domainCall: async <T>(method: string, input: Record<string, unknown>) => { if (method === "budget.settle") settlements.push(input); return {} as T; } });
    let wire: ReadableStreamDefaultController<Uint8Array> | undefined, calls = 0;
    const encoder = new TextEncoder(), abort = new AbortController(), events: string[] = [];
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      const outer = craftmineGuardedStream(model, { messages: [{ role: "user", content: "Make a sword", timestamp: 1 }] }, {
        signal: abort.signal, reasoning: "max", fetch: async () => { calls++; return new Response(new ReadableStream({ start(controller) { wire = controller; } }),
          { headers: { "content-type": "text/event-stream" } }); },
      }, hooks, "creation", (context, options) => models.streamSimple(model, context, options), mode !== "untrusted");
      const consume = (async () => { for await (const event of outer) events.push(event.type); })();
      await vi.advanceTimersByTimeAsync(0); expect(wire).toBeDefined();
      if (mode === "post-generation") {
        wire!.enqueue(encoder.encode(`data: ${JSON.stringify({ id: "local", object: "chat.completion.chunk", model: model.id,
          choices: [{ index: 0, delta: { content: "x" }, finish_reason: null }] })}\n\n`));
        for (let i = 0; !events.includes("text_delta") && i < 100; i++) await tick();
        expect(events).toContain("text_delta");
      }
      for (let i = 0; i < 2; i++) {
        await vi.advanceTimersByTimeAsync(50000);
        if (mode !== "silent") wire!.enqueue(encoder.encode(mode === "non-heartbeat" ? "\n: other\ndata: {}\n\n" : ": keep-alive\n\n"));
        await tick(); await vi.advanceTimersByTimeAsync(0);
      }
      if (mode === "cancel") abort.abort();
      else await vi.advanceTimersByTimeAsync(mode === "heartbeat-then-silence" ? 120000 : 20000);
      const answer = await outer.result(); await consume; await vi.advanceTimersByTimeAsync(0);
      expect(answer.errorMessage).toBe(mode === "cancel" ? "TURN_ABORTED" : "PROVIDER_IDLE_TIMEOUT");
      expect(calls).toBe(1); expect(settlements).toHaveLength(1);
      expect(settlements[0]).toMatchObject({ status: mode === "cancel" ? "cancelled" : "unknown" });
      expect(settlements[0]).not.toHaveProperty("usage"); expect(vi.getTimerCount()).toBe(0);
      if (mode !== "post-generation") expect(events.filter(type => type.endsWith("_delta"))).toEqual([]);
    } finally { abort.abort(); vi.useRealTimers(); }
  });

  it("keeps one physical waiting request alive beyond two minutes without inventing semantic output", async () => {
    let response: ServerResponse | undefined, chunks = 0, physical = 0, responseCallbacks = 0;
    let wireSettings: unknown;
    const server = createServer(async (req, res) => {
      const input: Buffer[] = []; for await (const chunk of req) input.push(Buffer.from(chunk));
      const payload = JSON.parse(Buffer.concat(input).toString());
      wireSettings = { model: payload.model, maxTokens: payload.max_tokens ?? payload.max_completion_tokens,
        effort: payload.reasoning_effort, thinking: payload.thinking };
      physical++; response = res; res.writeHead(200, { "content-type": "text/event-stream" }); res.flushHeaders();
    });
    await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
    const localUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/chat/completions`;
    const model = buildProviderModel(provider), models = createProviderModels(provider, model);
    const settlements: unknown[] = [];
    const snapshot: CraftmineTaskContext = { binding: { projectId: "p", sessionId: "s", turnId: "t", taskId: "task", baseBuild: "b" },
      generation: 1, status: "running", world: { id: "w", revision: 1, buildId: "b", hash: "a".repeat(64) },
      draft: { revision: 1, hash: "b".repeat(64) }, requirements: [], modifiedResources: [], receipts: [], jobs: [], lease: { owned: true }, budget: {} };
    const hooks = createCraftmineRequestHooks({ getContext: async () => snapshot, domainCall: async <T>(method: string, input: Record<string, unknown>) => {
      if (method === "budget.settle") settlements.push(input); return {} as T;
    } });
    const signal = new AbortController();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      const outer = craftmineGuardedStream(model, { messages: [{ role: "user", content: "Make a sword", timestamp: 1 }] }, {
        signal: signal.signal, reasoning: "max", onResponse: response => { responseCallbacks++; expect(response.status).toBe(200); }, fetch: async (_input, init) => {
          const received = await fetch(localUrl, init);
          return new Response(received.body!.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) { chunks++; controller.enqueue(chunk); },
          })), { status: received.status, headers: received.headers });
        },
      }, hooks, "creation", (context, options) => models.streamSimple(model, context, options), true);
      const events: string[] = []; const consume = (async () => { for await (const event of outer) events.push(event.type); })();
      for (let attempt = 0; !response && attempt < 1000; attempt++) await tick();
      expect(response).toBeDefined();
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(50000);
        const prior = chunks; response!.write(": keep-alive\n\n");
        for (let attempt = 0; chunks === prior && attempt < 1000; attempt++) await tick();
        // No assistant text, reasoning or tool calls are supplied by the fixture.
        await tick();
      }
      expect(events.filter(type => type.endsWith("_delta"))).toEqual([]);
      response!.end(`data: ${JSON.stringify({ id: "local", object: "chat.completion.chunk", created: 1, model: model.id,
        choices: [{ index: 0, delta: { content: "Done" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } })}\n\ndata: [DONE]\n\n`);
      const answer = await outer.result(); await consume;
      expect(answer.errorMessage).toBeUndefined(); expect(answer.stopReason).toBe("stop");
      expect(chunks).toBeGreaterThanOrEqual(4); expect(physical).toBe(1); expect(settlements).toHaveLength(1);
      expect(settlements[0]).toMatchObject({ status: "known" });
      expect(responseCallbacks).toBe(1); expect(model.contextWindow).toBe(1000000);
      expect(wireSettings).toEqual({ model: "deepseek-flash", maxTokens: 384000, effort: "max", thinking: { type: "enabled" } });
    } finally {
      signal.abort(); vi.useRealTimers(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()));
    }
  });
});
