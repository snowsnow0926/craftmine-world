import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DesktopAgentRuntime } from "./runtime.js";

afterEach(() => vi.useRealTimers());
function runtime(onEvent: (event: any) => void) {
  return new DesktopAgentRuntime({ sessionId: "stream-fixture", turnId: "original-turn", mode: "agent", thinkingLevel: "off",
    commandShell: { id: "bash", label: "Bash", dialect: "posix", available: true, isDefault: true },
    provider: { id: "fixture", name: "Fixture", modelId: "fixture", baseUrl: "http://127.0.0.1:1", apiKey: "", authKind: "none",
      supportsReasoning: false, supportedThinkingLevels: ["off"] },
    host: { call: vi.fn(async () => ({})), onNotification: () => () => {} } as any, onEvent,
  });
}
function message(thinking = "", text = "") {
  return { role: "assistant", api: "openai-completions", provider: "fixture", model: "fixture", timestamp: Date.now(),
    content: [{ type: "thinking", thinking }, { type: "text", text }], stopReason: "stop",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}

describe("PI assistant publication before IPC serialization", () => {
  it("coalesces 34000 partials before flattening without losing final text or cumulative deltas", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-14T00:00:00Z"));
    let count = 0, bytes = 0, assembledThinking = "", latest: any, terminal: any;
    const agent = runtime(envelope => {
      if (envelope.event.type === "message_update") {
        count++; bytes += Buffer.byteLength(JSON.stringify(envelope)); latest = envelope;
        assembledThinking += envelope.event.deltaThinking ?? "";
      }
      if (envelope.event.type === "message_end") terminal = envelope.event.message;
    }), internal = agent as any;
    const flatten = vi.spyOn(internal, "publishAssistantUpdate");
    try {
      await internal.handleAgentEvent({ type: "message_start", message: message() });
      let thinking = "";
      for (let i = 0; i < 34000; i++) {
        thinking += "x";
        await internal.handleAgentEvent({ type: "message_update", message: message(thinking) });
        vi.advanceTimersByTime(5);
      }
      await internal.handleAgentEvent({ type: "message_end", message: message(thinking, "Done") });
      expect(count).toBeLessThanOrEqual(1702);
      expect(flatten).toHaveBeenCalledTimes(count);
      expect(assembledThinking).toBe(thinking);
      expect(terminal).toMatchObject({ thinking, content: "Done", status: "complete", usage: { totalTokens: 2 } });
      const durable = internal.fullEntries.at(-1).message;
      expect(durable.content).toEqual(message(thinking, "Done").content);
      const baselineEmpty = { ...latest, event: { ...latest.event, message: { ...latest.event.message, thinking: "" }, deltaThinking: "x" } };
      // Exact JSON byte arithmetic for the same ASCII accumulation without
      // retaining or serializing 34000 increasingly long baseline snapshots.
      const uncoalescedBytes = 34000 * Buffer.byteLength(JSON.stringify(baselineEmpty)) + 34000 * 34001 / 2;
      expect(bytes).toBeLessThan(uncoalescedBytes * 0.06);
      expect(vi.getTimerCount()).toBe(0);
      if (process.env.CRAFTMINE_STREAM_PUBLICATION_REPORT) {
        const path = resolve(process.env.CRAFTMINE_STREAM_PUBLICATION_REPORT); mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify({ syntheticProviderUpdates: 34000, virtualIntervalMs: 5, publishedUpdates: count,
          flattenCalls: flatten.mock.calls.length, serializedPublishedBytes: bytes, computedUncoalescedBytes: uncoalescedBytes,
          finalThinkingCharacters: thinking.length, finalText: terminal.content, terminalUsage: terminal.usage,
          timersRemaining: vi.getTimerCount(), scope: "controlled-runtime-no-model-no-GPU" }, null, 2));
      }
    } finally { await agent.dispose(); }
  });

  it("publishes the first partial immediately, merges all deltas, and snapshots mutable provider blocks", async () => {
    vi.useFakeTimers(); const events: any[] = [], agent = runtime(e => events.push(e)), internal = agent as any;
    try {
      await internal.handleAgentEvent({ type: "message_start", message: message() });
      await internal.handleAgentEvent({ type: "message_update", message: message("a", "1") });
      expect(events.at(-1).event.message.thinking).toBe("a");
      await internal.handleAgentEvent({ type: "message_update", message: message("ab", "12") });
      const mutable = message("abc", "123");
      await internal.handleAgentEvent({ type: "message_update", message: mutable });
      mutable.content[0].thinking = "ERASED";
      expect(events.filter(e => e.event.type === "message_update")).toHaveLength(1);
      vi.advanceTimersByTime(100);
      expect(events.at(-1).event).toMatchObject({ deltaThinking: "bc", deltaText: "23", message: { thinking: "abc", content: "123" } });
      await internal.handleAgentEvent({ type: "message_update", message: message("replacement", "new") });
      vi.advanceTimersByTime(100);
      expect(events.at(-1).event).toMatchObject({ deltaThinking: "replacement", deltaText: "new" });
    } finally { await agent.dispose(); }
  });

  for (const type of ["tool_start", "tool_end", "error", "status", "model_call", "agent_end"]) {
    it(`flushes the pending partial before ${type} without dropping that event`, async () => {
      vi.useFakeTimers(); const events: any[] = [], agent = runtime(e => events.push(e)), internal = agent as any;
      try {
        await internal.handleAgentEvent({ type: "message_start", message: message() });
        await internal.handleAgentEvent({ type: "message_update", message: message("a") });
        await internal.handleAgentEvent({ type: "message_update", message: message("abc") });
        const control = { type, marker: "unchanged-control-fixture" };
        internal.emit(control);
        expect(events.at(-2).event).toMatchObject({ type: "message_update", message: { thinking: "abc" } });
        expect(events.at(-1).event).toEqual(control);
        expect(vi.getTimerCount()).toBe(0);
      } finally { await agent.dispose(); }
    });
  }

  for (const action of ["abort", "dispose"] as const) it(`${action} flushes accepted text and leaves no delayed partial`, async () => {
    vi.useFakeTimers(); const events: any[] = [], agent = runtime(e => events.push(e)), internal = agent as any;
    try {
      await internal.handleAgentEvent({ type: "message_start", message: message() });
      await internal.handleAgentEvent({ type: "message_update", message: message("first") });
      await internal.handleAgentEvent({ type: "message_update", message: message("accepted before cancellation") });
      await agent[action]();
      expect([...events].reverse().find(e => e.event.type === "message_update").event.message.thinking).toBe("accepted before cancellation");
      const count = events.length;
      await internal.handleAgentEvent({ type: "message_update", message: message("late provider output") });
      vi.advanceTimersByTime(1000);
      expect(events).toHaveLength(count); expect(vi.getTimerCount()).toBe(0);
    } finally { await agent.dispose(); }
  });

  it("flushes an old message before a new bubble and preserves old turn ownership when prompting again", async () => {
    vi.useFakeTimers(); const events: any[] = [], agent = runtime(e => events.push(e)), internal = agent as any;
    try {
      await internal.handleAgentEvent({ type: "message_start", message: message() });
      const firstId = events[0].event.message.id;
      await internal.handleAgentEvent({ type: "message_update", message: message("old") });
      await internal.handleAgentEvent({ type: "message_update", message: message("old completed") });
      await internal.handleAgentEvent({ type: "message_start", message: message() });
      expect(events.at(-2).event.message).toMatchObject({ id: firstId, thinking: "old completed" });
      expect(events.at(-1).event.message.id).not.toBe(firstId);
      await internal.handleAgentEvent({ type: "message_update", message: message("new") });
      await internal.handleAgentEvent({ type: "message_update", message: message("new accepted") });
      internal.agent.prompt = vi.fn(async () => undefined);
      internal.runPendingRecoveries = vi.fn(async () => false);
      await agent.prompt("Next player request", "next-user", "next-turn");
      const update = [...events].reverse().find(e => e.event.type === "message_update");
      expect(update.turnId).toBe("original-turn"); expect(update.event.message.thinking).toBe("new accepted");
      const count = events.filter(e => e.event.type === "message_update").length;
      vi.advanceTimersByTime(1000);
      expect(events.filter(e => e.event.type === "message_update")).toHaveLength(count);
      expect(vi.getTimerCount()).toBe(0);
    } finally { await agent.dispose(); }
  });

  it("keeps an actual failed terminal message and its complete partial content", async () => {
    vi.useFakeTimers(); const events: any[] = [], agent = runtime(e => events.push(e)), internal = agent as any;
    try {
      await internal.handleAgentEvent({ type: "message_start", message: message() });
      await internal.handleAgentEvent({ type: "message_update", message: message("a") });
      await internal.handleAgentEvent({ type: "message_update", message: message("accepted reasoning", "partial answer") });
      await internal.handleAgentEvent({ type: "message_end", message: { ...message("accepted reasoning", "partial answer"), stopReason: "error", errorMessage: "401 invalid api key" } });
      expect([...events].reverse().find(e => e.event.type === "message_end").event.message).toMatchObject({ thinking: "accepted reasoning", content: "partial answer", status: "error" });
      expect(vi.getTimerCount()).toBe(0);
    } finally { await agent.dispose(); }
  });
});
