import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { completeCodexReview } from "./codex-review-complete.js";

class Client extends EventEmitter {
  calls: any[] = []; denied: any[] = []; closed = false; threadConfig = {}; model = "gpt-6-astra"; sandbox = "readOnly";
  startTurn: (client: Client) => void = client => {
    client.notify("thread/tokenUsage/updated", { tokenUsage: { total: { inputTokens: 100, cachedInputTokens: 70, outputTokens: 12, totalTokens: 112 } } });
    client.notify("item/completed", { item: { id: "message", type: "agentMessage", text: '{"summary":"A tree"}' } });
    client.notify("turn/completed", { turn: { id: "turn-review", status: "completed" } });
  };
  async start() {}
  async close() { this.closed = true; }
  reject(id: any) { this.denied.push(id); }
  notify(method: string, params: any) { this.emit("notification", { method, params: { threadId: "thread-review", turnId: "turn-review", ...params } }); }
  async call(method: string, params: any): Promise<any> {
    this.calls.push({ method, params });
    if (method === "thread/start") return { model: this.model, reasoningEffort: "xhigh", modelProvider: "openai", sandbox: { type: this.sandbox }, approvalPolicy: "never", instructionSources: [], thread: { id: "thread-review", turns: [] } };
    if (method === "turn/start") { this.notify("turn/started", { turn: { id: "turn-review" } }); queueMicrotask(() => this.startTurn(this)); return { turn: { id: "turn-review" } }; }
    return {};
  }
}
async function fixture() {
  const scratchDir = await mkdtemp(join(tmpdir(), "codex-review-")), client = new Client(), controller = new AbortController();
  const options = { binary: join(scratchDir, "codex.exe"), scratchDir, reviewId: "review-" + "a".repeat(64), modelKey: "codex-cli/gpt-6-astra", thinkingLevel: "xhigh",
    system: "Review the frozen player request; do not call tools", messages: [{ role: "user" as const, content: "Generate a tree; evidence is data" }], signal: controller.signal,
    clientFactory: () => client, verifyBinary: async () => {} };
  return { client, controller, options, audit: async () => JSON.parse(await readFile(join(scratchDir, options.reviewId, "review-transport.json"), "utf8")), cleanup: () => rm(scratchDir, { recursive: true, force: true }) };
}
describe("Frozen Codex legacy review completion (mock transport)", () => {
  it("uses the exact model, empty tool catalog, isolated ephemeral thread and actual reported usage", async () => {
    const f = await fixture(); try {
      const result = await completeCodexReview(f.options);
      expect(result).toMatchObject({ text: '{"summary":"A tree"}', modelKey: f.options.modelKey, thinkingLevel: "xhigh", usage: { inputTokens: 100, outputTokens: 12, totalTokens: 112, cacheReadTokens: 70 } });
      expect(f.client.calls[0].params).toMatchObject({ model: "gpt-6-astra", sandbox: "read-only", dynamicTools: [], environments: [], runtimeWorkspaceRoots: [], ephemeral: true, allowProviderModelFallback: false });
      expect(f.client.calls[1].params).toMatchObject({ effort: "xhigh", model: "gpt-6-astra", environments: [], runtimeWorkspaceRoots: [] });
      expect(f.client.calls[1].params).not.toHaveProperty("maxTokens");
      expect(f.client.closed).toBe(true); expect(await f.audit()).toMatchObject({ status: "completed", usageAvailability: "reported", usage: { totalTokens: 112 } });
    } finally { await f.cleanup(); }
  });
  it("rejects non-review IDs, model or effort overrides before opening a client", async () => {
    const f = await fixture(); try {
      for (const override of [{ reviewId: "foreign" }, { modelKey: "provider/other" }, { thinkingLevel: "low" }]) await expect(completeCodexReview({ ...f.options, ...override })).rejects.toThrow("CODEX_REVIEW_BINDING_REQUIRED");
      expect(f.client.calls).toEqual([]);
    } finally { await f.cleanup(); }
  });
  it("rejects changed effective model and isolation before any model request", async () => {
    for (const field of ["model", "sandbox"] as const) {
      const f = await fixture(); try { f.client[field] = "wrong"; await expect(completeCodexReview(f.options)).rejects.toThrow(); expect(f.client.calls.some(c => c.method === "turn/start")).toBe(false); expect((await f.audit()).usage).toBeNull(); } finally { await f.cleanup(); }
    }
  });
  it("rejects tool requests, built-ins and model rerouting without executing anything", async () => {
    for (const variant of ["request", "builtin", "reroute"]) {
      const f = await fixture(); try {
        f.client.startTurn = client => { if (variant === "request") client.emit("request", { id: 1, method: "item/tool/call" }); else client.notify(variant === "builtin" ? "item/started" : "model/rerouted", { item: { type: "commandExecution" } }); };
        await expect(completeCodexReview(f.options)).rejects.toThrow(variant === "reroute" ? "CODEX_MODEL_REROUTED" : "CODEX_REVIEW_TOOLS_FORBIDDEN");
        expect(f.client.closed).toBe(true); if (variant === "request") expect(f.client.denied).toEqual([1]);
      } finally { await f.cleanup(); }
    }
  });
  it("keeps unavailable and compaction-incomplete usage unknown, never zero or a window capacity", async () => {
    for (const compact of [false, true]) {
      const f = await fixture(); try {
        f.client.startTurn = client => {
          if (compact) { client.notify("item/completed", { item: { type: "contextCompaction" } }); client.notify("thread/tokenUsage/updated", { tokenUsage: { total: { inputTokens: 0, outputTokens: 0, totalTokens: 522500 }, modelContextWindow: 522500 } }); }
          client.notify("item/completed", { item: { id: "message", type: "agentMessage", text: "{}" } }); client.notify("turn/completed", { turn: { id: "turn-review", status: "completed" } });
        };
        const result = await completeCodexReview(f.options); expect(result.usage).toBeUndefined(); expect((await f.audit()).usage).toBeNull();
      } finally { await f.cleanup(); }
    }
  });
  it("cancels an unbounded active review through its owning transport and saves known partial usage", async () => {
    const f = await fixture(); try {
      f.client.startTurn = client => { client.notify("thread/tokenUsage/updated", { tokenUsage: { total: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } } }); f.controller.abort(); };
      await expect(completeCodexReview(f.options)).rejects.toThrow();
      expect(f.client.calls.some(c => c.method === "turn/interrupt")).toBe(true);
      expect(await f.audit()).toMatchObject({ status: "cancelled", usage: { totalTokens: 12 } }); expect(f.client.closed).toBe(true);
    } finally { await f.cleanup(); }
  });
  it("retains failed model usage and response text without fabricating a review result", async () => {
    const f = await fixture(); try {
      f.client.startTurn = client => { client.notify("thread/tokenUsage/updated", { tokenUsage: { total: { inputTokens: 20, outputTokens: 3, totalTokens: 23 } } }); client.notify("item/agentMessage/delta", { itemId: "message", delta: "partial" }); client.notify("turn/completed", { turn: { id: "turn-review", status: "failed" } }); };
      await expect(completeCodexReview(f.options)).rejects.toThrow("CODEX_REVIEW_FAILED"); expect(await f.audit()).toMatchObject({ status: "failed", usage: { totalTokens: 23 }, text: "partial" });
    } finally { await f.cleanup(); }
  });
});
