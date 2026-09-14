import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Context, ThinkingLevel } from "@earendil-works/pi-ai";
import { buildProviderModel, createProviderModels, type RuntimeProviderConfig } from "./provider-binding.js";

describe("official DeepSeek Flash alias transport", () => {
  it("limits compatibility overrides to verified endpoints/families and enabled effort", () => {
    const base: RuntimeProviderConfig = {
      id: "local-row", name: "Fixture", baseUrl: "https://api.deepseek.com", modelId: "deepseek-flash",
      apiKey: "fake-local-test-key", supportsReasoning: true, supportedThinkingLevels: ["off", "max"],
    };
    expect(buildProviderModel(base).thinkingLevelMap?.max).toBe("max");
    expect(buildProviderModel({ ...base, baseUrl: "https://unrelated.example" }).thinkingLevelMap?.max).toBeUndefined();
    expect(buildProviderModel({ ...base, modelId: "deepseek-chat" }).thinkingLevelMap?.max).toBeUndefined();
    expect(buildProviderModel({ ...base, modelId: "deepseek-flash-other" }).thinkingLevelMap?.max).toBeUndefined();
    expect(buildProviderModel({ ...base, supportedThinkingLevels: ["off"] }).thinkingLevelMap?.max).toBeUndefined();
    expect(buildProviderModel({ ...base, vendorKey: "deepseek", baseUrl: "https://configured-proxy.example" }).compat).toMatchObject({ thinkingFormat: "deepseek" });
    const configured = buildProviderModel(base);
    expect(buildProviderModel({ ...base, modelConfig: { ...configured, source: "generic", thinkingLevelMap: { max: "custom-max" } } as any }).thinkingLevelMap?.max).toBe("custom-max");
  });
  it("preserves max/off and tool reasoning through the pinned SDK using only localhost HTTP", async () => {
    const payloads: any[] = [], report: any[] = [];
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk);
      payloads.push(JSON.parse(Buffer.concat(chunks).toString()));
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(`data: ${JSON.stringify({ id: "local-fixture", object: "chat.completion.chunk", created: 1, model: "deepseek-flash", choices: [{ index: 0, delta: { role: "assistant", content: "Done" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
    });
    await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
    const localUrl = `http://127.0.0.1:${(server.address() as any).port}/chat/completions`;
    try {
      for (const enabled of [true, false]) for (const effort of enabled ? ["max", "off"] as const : ["off"] as const) {
        const provider: RuntimeProviderConfig = {
          id: "d7f51b98-32b4-4fab-a91b-bacdd1dab492", name: "Local capture only",
          baseUrl: "https://api.deepseek.com", modelId: "deepseek-flash", apiKey: "fake-local-test-key",
          authKind: "api_key_and_base_url", apiStyle: "openai_completions",
          supportsReasoning: enabled, supportedThinkingLevels: enabled ? ["off", "max"] : ["off"],
          modelConfig: { source: "generic", name: "Configured alias", baseUrl: "https://api.deepseek.com",
            input: ["text"], reasoning: enabled, contextWindow: 500000, maxTokens: 384000,
            supportedThinkingLevels: enabled ? ["off", "max"] : ["off"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
        };
        const model = buildProviderModel(provider), models = createProviderModels(provider, model);
        const context: Context = { tools: [{ name: "inspect", description: "Inspect source", parameters: { type: "object", properties: {} } }], messages: [
          { role: "user", content: "Inspect the existing scene.", timestamp: 1 },
          { role: "assistant", api: model.api, model: model.id, provider: model.provider, timestamp: 2,
            content: [{ type: "toolCall", id: "inspect-one", name: "inspect", arguments: {} }], stopReason: "toolUse",
            usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } },
          { role: "toolResult", toolCallId: "inspect-one", toolName: "inspect", content: [{ type: "text", text: "The scene is unchanged." }], isError: false, timestamp: 3 },
        ] };
        const answer = await models.streamSimple(model, context, { reasoning: effort as ThinkingLevel, maxTokens: 384000, maxRetries: 0,
          fetch: async (input, init) => {
            // Preserve the official URL for SDK compatibility detection, but
            // redirect every actual network byte to this fixture's localhost.
            const original = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
            expect(original.hostname).toBe("api.deepseek.com");
            return fetch(localUrl, init);
          },
        }).result();
        expect(answer.errorMessage).toBeUndefined();
        const payload = payloads.at(-1), assistant = payload.messages.find((message: any) => message.role === "assistant");
        report.push({ configuredReasoning: enabled, selectedEffort: effort, modelReasoning: model.reasoning,
          model: payload.model, thinking: payload.thinking ?? null, effort: payload.reasoning_effort ?? null,
          maxTokens: payload.max_tokens ?? payload.max_completion_tokens,
          requiredReasoningContentPresent: Object.hasOwn(assistant, "reasoning_content"), reasoningContent: assistant.reasoning_content });
      }
      if (process.env.CRAFTMINE_ALIAS_WIRE_REPORT) {
        const path = resolve(process.env.CRAFTMINE_ALIAS_WIRE_REPORT);
        mkdirSync(resolve(path, ".."), { recursive: true }); writeFileSync(path, JSON.stringify(report, null, 2));
      }
      expect(report[0]).toMatchObject({ thinking: { type: "enabled" }, effort: "max", maxTokens: 384000, requiredReasoningContentPresent: true });
      expect(report[1]).toMatchObject({ thinking: { type: "disabled" }, effort: null, maxTokens: 384000, requiredReasoningContentPresent: true });
      expect(report[2]).toMatchObject({ thinking: { type: "disabled" }, effort: null, maxTokens: 384000, requiredReasoningContentPresent: true });
    } finally { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
  });
});
