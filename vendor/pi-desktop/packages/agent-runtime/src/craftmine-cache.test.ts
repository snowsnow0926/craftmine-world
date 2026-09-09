import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { type Api, type Context, type Model } from "@earendil-works/pi-ai";
import { createProviderModels } from "./provider-binding.js";
import { appendCraftmineRequestData, createCraftmineRequestHooks, craftmineGuardedStream, type CraftmineTaskContext } from "./craftmine-context.js";
import { usageFromPi } from "./agent-messages.js";

function snapshot(): CraftmineTaskContext {
  return { binding: { projectId: "p", sessionId: "s", turnId: "t", taskId: "task", baseBuild: "v1" }, generation: 1, status: "running",
    world: { id: "w", revision: 1, buildId: "v1", hash: "a".repeat(64) }, draft: { revision: 1, hash: "b".repeat(64) },
    requirements: [{ id: "request", text: "Keep the tree; add blue flowers.", kind: "request" }], modifiedResources: ["object:tree"], receipts: [], jobs: [], lease: { owned: true }, budget: { requestCount: 1 } };
}

describe("Craftmine stable request prefixes", () => {
  it("keeps actual serialized history, tools and reasoning stable while refreshing host facts at the tail", async () => {
    const payloads: any[] = [];
    const server = createServer(async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      payloads.push(JSON.parse(Buffer.concat(chunks).toString()));
      // A transport fixture: these numbers exercise parsing, not real cache performance.
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "deepseek-fixture", choices: [{ index: 0, delta: { role: "assistant", content: "Done" }, finish_reason: "stop" }], usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100, prompt_cache_hit_tokens: 900, prompt_cache_miss_tokens: 100, completion_tokens_details: { reasoning_tokens: 70 } } })}\n\ndata: [DONE]\n\n`);
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const model: Model<Api> = { id: "deepseek-fixture", name: "Fixture", provider: "deepseek", api: "openai-completions", baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1`, input: ["text"], reasoning: true, contextWindow: 128000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    const state = snapshot(), settlements: any[] = [];
    const models = createProviderModels({ id: model.provider, name: "Fixture", modelId: model.id, baseUrl: model.baseUrl, apiKey: "fixture", supportsReasoning: true, supportedThinkingLevels: ["off", "high"] }, model);
    const hooks = createCraftmineRequestHooks({ getContext: async () => structuredClone(state), domainCall: async <T>(method: string, params: any) => { if (method === "budget.settle") settlements.push(params); return {} as T; } });
    const context: Context = { systemPrompt: "Stable world policy.", tools: [{ name: "inspect", description: "Inspect source", parameters: { type: "object", properties: {} } }], messages: [
      { role: "user", content: "Keep the existing tree.", timestamp: 1 },
      { role: "assistant", content: [{ type: "thinking", thinking: "Read existing source first.", thinkingSignature: "reasoning_content" }, { type: "toolCall", id: "call-one", name: "inspect", arguments: {} }], api: model.api, provider: model.provider, model: model.id, timestamp: 2, stopReason: "toolUse", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } },
      { role: "toolResult", toolCallId: "call-one", toolName: "inspect", content: [{ type: "text", text: "Tree source and an actual receipt." }], isError: false, timestamp: 3 },
    ] };
    const before = JSON.stringify(context);
    try {
      for (let i = 0; i < 2; i++) {
        state.draft.revision = i + 1; state.budget.requestCount = i + 1;
        const answer = await craftmineGuardedStream(model, context, { apiKey: "fixture" }, hooks, i ? "retry" : "creation", (prepared, options) => models.streamSimple(model, prepared, options)).result();
        expect(answer.errorMessage).toBeUndefined();
        expect(usageFromPi(answer.usage)).toMatchObject({ inputTokens: 100, outputTokens: 100, cacheReadTokens: 900, totalTokens: 1100, reasoningTokens: 70 });
      }
      expect(payloads).toHaveLength(2);
      const [a, b] = payloads;
      expect(a.tools).toEqual(b.tools);
      expect(a.messages.slice(0, -1)).toEqual(b.messages.slice(0, -1));
      expect(a.messages.at(-1).role).toBe("tool"); expect(b.messages.at(-1).tool_call_id).toBe("call-one");
      expect(a.messages.find((message: any) => message.role === "assistant").reasoning_content).toBe("Read existing source first.");
      expect(a.messages.at(-1).content).toContain('"requestCount":1');
      expect(b.messages.at(-1).content).toContain('"requestCount":2');
      expect(a.messages[0].content).not.toContain('"requestCount"');
      expect(JSON.stringify(context)).toBe(before);
      expect(settlements.every(item => item.usage.totalTokens === 1100)).toBe(true);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });

  it("does not alter player images or create a synthetic user turn after tool results", () => {
    const context: Context = { messages: [{ role: "user", timestamp: 1, content: [{ type: "text", text: "My request" }, { type: "image", data: "AAAA", mimeType: "image/png" }] }] };
    const next = appendCraftmineRequestData(context, "fresh facts");
    expect(next.messages).toHaveLength(1); expect(next.messages[0].content).toHaveLength(3);
    expect(context.messages[0].content).toHaveLength(2);
  });
});
