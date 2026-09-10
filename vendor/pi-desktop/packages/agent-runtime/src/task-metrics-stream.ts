import { randomUUID } from "node:crypto";
import { createAssistantMessageEventStream, type AssistantMessageEventStream, type AssistantMessage, type Api, type Model } from "@earendil-works/pi-ai";
import type { ModelCallObservation } from "@pi-desktop/shared";
import { usageFromPi } from "./agent-messages.js";

/** Wrap one actual provider attempt, inside retries and after request admission.
 * Emits before terminal forwarding, so Main can drain persistence before endTurn.
 * The callback must already capture the originating session/turn, not look it up.
 */
export function observeModelStream(options: {
  model: Model<Api>;
  providerId: string;
  source: ModelCallObservation["source"];
  create: () => AssistantMessageEventStream;
  emit: (call: ModelCallObservation) => void;
  clock?: () => number;
  id?: () => string;
}): AssistantMessageEventStream {
  const now = options.clock ?? Date.now;
  const initial: ModelCallObservation = {
    callId: (options.id ?? randomUUID)(), providerId: options.providerId, modelId: options.model.id,
    source: options.source, startedAtMs: now(), generationStartedAtMs: null,
    endedAtMs: null, outcome: "running", usage: null,
  };
  const outer = createAssistantMessageEventStream();
  let generationStartedAtMs: number | null = null, terminal = false;
  options.emit(initial);
  const finish = (message: AssistantMessage) => {
    if (terminal) return;
    terminal = true;
    const end = now();
    // Clock reversal keeps token facts but discards generation timing.
    options.emit({ ...initial, endedAtMs: Math.max(initial.startedAtMs, end),
      generationStartedAtMs: generationStartedAtMs !== null && end > generationStartedAtMs && generationStartedAtMs >= initial.startedAtMs ? generationStartedAtMs : null,
      outcome: message.stopReason === "error" ? "error" : message.stopReason === "aborted" ? "aborted" : "completed",
      usage: usageFromPi(message.usage) ?? null });
  };
  void (async () => {
    const stream = options.create();
    for await (const event of stream) {
      if (generationStartedAtMs === null && ["text_delta", "thinking_delta", "toolcall_delta"].includes(event.type)) generationStartedAtMs = now();
      if (event.type === "done") finish(event.message);
      if (event.type === "error") finish(event.error);
      outer.push(event);
    }
    const result = await stream.result();
    finish(result);
    outer.end(result);
  })().catch(error => {
    const message: AssistantMessage = { role: "assistant", content: [], api: options.model.api,
      provider: options.model.provider, model: options.model.id, timestamp: now(), stopReason: "error",
      errorMessage: error instanceof Error ? error.message : String(error),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    finish(message); outer.push({ type: "error", reason: "error", error: message }); outer.end(message);
  });
  return outer;
}
