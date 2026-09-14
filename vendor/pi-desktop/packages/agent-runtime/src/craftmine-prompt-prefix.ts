import { createHash } from "node:crypto";
import type { Api, Context, Model, Usage } from "@earendil-works/pi-ai";

const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const estimate = (value: unknown): number => Math.ceil(Buffer.byteLength(JSON.stringify(value), "utf8") / 2);
type View = { base: string; messages: string[]; tail: unknown[] };
export type DeepSeekPrefixReceipt = { native: View; wire: View };
type Anchor = DeepSeekPrefixReceipt & { promptTokens: number };

/** The pinned completions adapter is the only transport verified here. */
export function supportsDeepSeekPromptPrefix(model: Model<Api>): boolean {
  try {
    const url = new URL(model.baseUrl);
    return model.api === "openai-completions" && model.id === "deepseek-flash"
      && url.protocol === "https:" && url.hostname === "api.deepseek.com" && !url.port
      && !url.username && !url.password && !url.search && !url.hash && /^\/(?:v1\/?)?$/.test(url.pathname);
  } catch { return false; }
}

function nativeView(model: Model<Api>, context: Context, output: number, scope: unknown): View | undefined {
  if (!supportsDeepSeekPromptPrefix(model)) return undefined;
  const messages: unknown[] = [];
  for (const message of context.messages) {
    // Media and unknown blocks retain the original full encoded estimate.
    if (Array.isArray(message.content) && message.content.some(block => !["text", "thinking", "toolCall"].includes(block.type))) return undefined;
    messages.push({ role: message.role, content: message.content,
      ...(message.role === "toolResult" ? { toolCallId: message.toolCallId, toolName: message.toolName, isError: message.isError } : {}),
      ...(message.role === "assistant" ? { api: message.api, provider: message.provider, model: message.model, stopReason: message.stopReason } : {}),
    });
  }
  return { base: hash({ model, output, scope, system: context.systemPrompt, tools: context.tools }), messages: messages.map(hash), tail: messages };
}

function wireView(payload: unknown, transportKey?: string): View | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const { messages, ...rest } = payload as Record<string, unknown>;
  if (!Array.isArray(messages) || messages.length < 2) return undefined;
  for (const message of messages) {
    if (!message || typeof message !== "object" || Array.isArray(message)) return undefined;
    const content = (message as Record<string, unknown>).content;
    if (content !== undefined && content !== null && typeof content !== "string"
      && (!Array.isArray(content) || content.some(block => !block || block.type !== "text" || typeof block.text !== "string"))) return undefined;
    // Unknown media-bearing message extensions must not become cheap text.
    if (Object.keys(message).some(key => !["role", "content", "name", "tool_call_id", "tool_calls", "reasoning_content", "refusal"].includes(key))) return undefined;
  }
  return { base: hash({ rest, transportKey }), messages: messages.map(hash), tail: messages };
}

function appendBound(previous: View, current: View, promptTokens: number): number | undefined {
  if (previous.base !== current.base || previous.messages.length < 1 || current.messages.length < previous.messages.length) return undefined;
  if (previous.messages.some((entry, index) => entry !== current.messages[index])) return undefined;
  // The whole previous prompt upper-bounds its retained prefix. Count the
  // entire new tail, including the volatile host snapshot, again. No ratio.
  return promptTokens + estimate(current.tail.slice(previous.messages.length)) + 1024;
}

/** In-memory receipt only. No token counts inferred from elapsed or total use. */
export class DeepSeekPromptPrefix {
  private anchor?: Anchor;
  clear(): void { this.anchor = undefined; }

  estimateNative(model: Model<Api>, context: Context, output: number, scope: unknown): number | undefined {
    const current = nativeView(model, context, output, scope);
    return current && this.anchor ? appendBound(this.anchor.native, current, this.anchor.promptTokens) : undefined;
  }

  estimateWire(model: Model<Api>, context: Context, output: number, scope: unknown, payload: unknown, transportKey?: string): number | undefined {
    const current = wireView(payload, transportKey);
    if (this.estimateNative(model, context, output, scope) === undefined || !current || !this.anchor) return undefined;
    return appendBound(this.anchor.wire, current, this.anchor.promptTokens);
  }

  remember(model: Model<Api>, context: Context, output: number, scope: unknown, payload: unknown, usage: Usage, transportKey?: string): boolean {
    return this.rememberCaptured(this.capture(model, context, output, scope, payload, transportKey), usage);
  }

  capture(model: Model<Api>, context: Context, output: number, scope: unknown, payload: unknown, transportKey?: string): DeepSeekPrefixReceipt | undefined {
    const native = nativeView(model, context, output, scope), wire = wireView(payload, transportKey);
    if (!native || !wire || native.messages.length < 2) return undefined;
    return { native: { ...native, messages: native.messages.slice(0, -1), tail: [] },
      wire: { ...wire, messages: wire.messages.slice(0, -1), tail: [] } };
  }

  rememberCaptured(receipt: DeepSeekPrefixReceipt | undefined, usage: Usage): boolean {
    this.clear();
    const counts = [usage.input, usage.cacheRead, usage.cacheWrite, usage.output, usage.totalTokens];
    if (!receipt || counts.some(value => !Number.isSafeInteger(value) || value < 0)) return false;
    const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
    if (promptTokens < 1 || promptTokens + usage.output !== usage.totalTokens) return false;
    // The final native/wire message contains request-only host data. It is
    // deliberately excluded from both exact-prefix keys, but its measured
    // cost remains included in promptTokens as conservative spare capacity.
    this.anchor = { ...receipt, promptTokens };
    return true;
  }
}
