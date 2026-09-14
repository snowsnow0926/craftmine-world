import { describe, expect, it } from "vitest";
import type { Api, Context, Model, Usage } from "@earendil-works/pi-ai";
import { DeepSeekPromptPrefix, supportsDeepSeekPromptPrefix } from "./craftmine-prompt-prefix.js";

const model: Model<Api> = { id: "deepseek-flash", name: "Flash", provider: "uuid", api: "openai-completions", baseUrl: "https://api.deepseek.com/",
  reasoning: true, input: ["text", "image"], contextWindow: 1000000, maxTokens: 384000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const context: Context = { systemPrompt: "system", tools: [], messages: [
  { role: "user", content: "stable source".repeat(1000), timestamp: 1 },
  { role: "user", content: "previous host snapshot", timestamp: 2 },
] };
const payload = { model: "deepseek-flash", max_tokens: 384000, thinking: { type: "enabled" }, reasoning_effort: "max",
  messages: [{ role: "system", content: "system" }, { role: "user", content: "stable source".repeat(1000) }, { role: "user", content: "previous host snapshot" }] };
const usage: Usage = { input: 1000, cacheRead: 2000, cacheWrite: 3000, output: 100, totalTokens: 6100, reasoning: 80,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const scope = { task: "task", world: "world", generation: 1 };
function fixture() { const prefix = new DeepSeekPromptPrefix(); expect(prefix.remember(model, context, 384000, scope, payload, usage)).toBe(true); return prefix; }

describe("measured prompt exact-prefix upper bound", () => {
  it("counts cached prompt once, keeps old host cost and estimates all new multilingual tail", () => {
    const prefix = fixture();
    const next = { ...context, messages: [context.messages[0], { role: "user" as const, content: "新世界快照🐕", timestamp: 3 }] };
    const wire = { ...payload, messages: [payload.messages[0], payload.messages[1], { role: "user", content: "新世界快照🐕" }] };
    expect(prefix.estimateWire(model, next, 384000, scope, wire)).toBe(6000 + Math.ceil(Buffer.byteLength(JSON.stringify(wire.messages.slice(2))) / 2) + 1024);
    expect(prefix.estimateNative(model, next, 384000, scope)).toBeGreaterThan(7024);
    expect(model.contextWindow).toBe(1000000); expect(model.maxTokens).toBe(384000);
  });
  it("requires every prefix byte, not message count or matching last content", () => {
    const prefix = fixture();
    const changed = structuredClone(context); changed.messages[0].content = "changed";
    expect(prefix.estimateNative(model, changed, 384000, scope)).toBeUndefined();
    const wire = structuredClone(payload); wire.messages[1].content += "!";
    expect(prefix.estimateWire(model, context, 384000, scope, wire)).toBeUndefined();
    expect(prefix.estimateNative(model, { ...context, messages: [] }, 384000, scope)).toBeUndefined();
  });
  it("invalidates all model, host scope, system, tool and output changes", () => {
    const prefix = fixture();
    for (const patch of [{ provider: "other" }, { contextWindow: 500000 }, { id: "deepseek-v4.1-flash" }, { thinkingLevelMap: { max: "high" } }]) {
      expect(prefix.estimateNative({ ...model, ...patch }, context, 384000, scope)).toBeUndefined();
    }
    for (const changed of [{ ...context, systemPrompt: "changed" }, { ...context, tools: [{ name: "new", description: "new", parameters: { type: "object" } }] }]) {
      expect(prefix.estimateNative(model, changed, 384000, scope)).toBeUndefined();
    }
    expect(prefix.estimateNative(model, context, 32000, scope)).toBeUndefined();
    expect(prefix.estimateNative(model, context, 384000, { ...scope, generation: 2 })).toBeUndefined();
  });
  it("revalidates every final wire option and unknown attachment shape", () => {
    const prefix = fixture();
    for (const patch of [{ reasoning_effort: "high" }, { temperature: 0 }, { tools: [{}] }, { max_tokens: 32000 }]) {
      expect(prefix.estimateWire(model, context, 384000, scope, { ...payload, ...patch })).toBeUndefined();
    }
    const media = structuredClone(context); media.messages[1].content = [{ type: "image", data: "opaque", mimeType: "image/png" }];
    expect(prefix.estimateNative(model, media, 384000, scope)).toBeUndefined();
    const wire = structuredClone(payload) as any; wire.messages[2].audio = { data: "opaque" };
    expect(prefix.estimateWire(model, context, 384000, scope, wire)).toBeUndefined();
  });
  it("refuses missing, inconsistent, negative or double-counted usage and has no restored receipt", () => {
    for (const patch of [{ input: undefined }, { cacheRead: -1 }, { totalTokens: 8100 }, { input: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 100 }]) {
      const prefix = fixture(); expect(prefix.remember(model, context, 384000, scope, payload, { ...usage, ...patch } as Usage)).toBe(false);
      expect(prefix.estimateNative(model, context, 384000, scope)).toBeUndefined();
    }
    expect(new DeepSeekPromptPrefix().estimateNative(model, context, 384000, scope)).toBeUndefined();
    const prefix = fixture(); prefix.clear(); expect(prefix.estimateNative(model, context, 384000, scope)).toBeUndefined();
  });
  it("does not widen eligibility to gateways, media APIs or unrelated aliases", () => {
    for (const patch of [{ baseUrl: "https://proxy.example" }, { baseUrl: "https://api.deepseek.com/proxy" }, { api: "openai-responses" as const }, { id: "deepseek-chat" }]) {
      expect(supportsDeepSeekPromptPrefix({ ...model, ...patch })).toBe(false);
    }
  });
});
