import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { CodexAppServer, MODEL, EFFORT, CLI_VERSION, processEnvironment, protocolDiagnostic } from "./codex-app-server.mjs";
import { validCodexUsageTotal } from "./codex-desktop-runtime.js";

type Client = { start(): Promise<unknown>; call(method: string, params: any): Promise<any>; close(): Promise<void>;
  on(event: string, handler: (...args: any[]) => void): unknown; reject(id: unknown): void; threadConfig?: unknown };
type Usage = { inputTokens: number; outputTokens: number; totalTokens: number; cachedInputTokens?: number; reasoningOutputTokens?: number };
export type CodexReviewOptions = {
  binary: string; scratchDir: string; reviewId: string; modelKey: string; thinkingLevel: string;
  system: string; messages: Array<{ role: "user" | "assistant"; content: string }>; signal: AbortSignal;
  clientFactory?: (cwd: string) => Client; verifyBinary?: () => Promise<void>;
};
const fail = (code: string): never => { throw Object.assign(Error(code), { errorCode: code }); };
const forbidden = new Set(["commandExecution", "fileChange", "mcpToolCall", "webSearch", "imageGeneration", "dynamicToolCall"]);

/** A host-owned frozen review only. No author tools, world writes or provider fallback. */
export async function completeCodexReview(options: CodexReviewOptions) {
  if (!/^review-[a-f0-9]{64}$/.test(options.reviewId) || options.modelKey !== `codex-cli/${MODEL}` || options.thinkingLevel !== EFFORT) fail("CODEX_REVIEW_BINDING_REQUIRED");
  if (!isAbsolute(options.binary) || !isAbsolute(options.scratchDir)) fail("CODEX_ABSOLUTE_PATH_REQUIRED");
  options.signal.throwIfAborted();
  const cwd = join(options.scratchDir, options.reviewId);
  await mkdir(cwd, { recursive: true });
  const audit: Record<string, any> = { format: "craftmine.codex-review/1", reviewId: options.reviewId,
    model: MODEL, effort: EFFORT, startedAt: new Date().toISOString(), modelStarted: false, usage: null, status: "starting" };
  const save = () => writeFile(join(cwd, "review-transport.json"), JSON.stringify(audit, null, 2));
  let client: Client | undefined, threadId: string | undefined, turnId: string | undefined, usage: Usage | undefined, usageIncomplete = false;
  const text = new Map<string, string>(); let settled = false, stage = "binary-verify";
  let resolve!: () => void, reject!: (error: unknown) => void;
  const done = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  // A cancellation may arrive while startup awaits RPC; consume that rejection
  // immediately, then await the same terminal promise after turn/start.
  void done.catch(() => {});
  const rejectOnce = (error: unknown) => { if (!settled) { settled = true; reject(error); } };
  const aborted = () => {
    rejectOnce(Object.assign(Error("CODEX_REVIEW_CANCELLED"), { errorCode: "CODEX_REVIEW_CANCELLED" }));
    if (client && threadId && turnId) void client.call("turn/interrupt", { threadId, turnId }).catch(() => {});
    void client?.close().catch(() => {});
  };
  options.signal.addEventListener("abort", aborted, { once: true });
  try {
    await save();
    if (options.verifyBinary) await options.verifyBinary();
    else await new Promise<void>((yes, no) => execFile(options.binary, ["--version"], { cwd, windowsHide: true, env: processEnvironment(), signal: options.signal },
      (error, stdout) => error ? no(Error("CODEX_PROCESS_START_FAILED")) : stdout.trim() === CLI_VERSION ? yes() : no(Error("CODEX_CLI_VERSION_MISMATCH"))));
    options.signal.throwIfAborted(); stage = "app-server-start";
    client = options.clientFactory?.(cwd) ?? new CodexAppServer({ binary: options.binary, cwd });
    const owner = client;
    client.on("failure", () => rejectOnce(Error("CODEX_TRANSPORT_FAILED")));
    client.on("request", request => { owner.reject(request.id); rejectOnce(Error("CODEX_REVIEW_TOOLS_FORBIDDEN")); });
    client.on("notification", ({ method, params: p = {} }: any) => {
      if (settled || p.threadId !== threadId) return;
      if (method === "model/rerouted") { rejectOnce(Error("CODEX_MODEL_REROUTED")); return; }
      if (method === "turn/started" && !turnId) turnId = p.turn?.id;
      if (!turnId || (p.turnId && p.turnId !== turnId)) return;
      if ((method === "item/started" || method === "item/completed") && forbidden.has(p.item?.type)) { rejectOnce(Error("CODEX_REVIEW_TOOLS_FORBIDDEN")); return; }
      if (p.item?.type === "contextCompaction" || (method === "thread/tokenUsage/updated" &&
          p.tokenUsage?.total?.inputTokens === 0 && p.tokenUsage?.total?.outputTokens === 0 && p.tokenUsage?.total?.totalTokens === p.tokenUsage?.modelContextWindow)) {
        usageIncomplete = true; usage = undefined;
      }
      if (method === "thread/tokenUsage/updated" && !usageIncomplete && validCodexUsageTotal(p.tokenUsage?.total)) usage = p.tokenUsage.total;
      if (method === "item/agentMessage/delta" && typeof p.delta === "string") text.set(p.itemId, (text.get(p.itemId) ?? "") + p.delta);
      if (method === "item/completed" && p.item?.type === "agentMessage") text.set(p.item.id, p.item.text ?? text.get(p.item.id) ?? "");
      if (method === "turn/completed" && p.turn?.id === turnId) {
        if (p.turn.status === "completed") { settled = true; resolve(); }
        else rejectOnce(Error(p.turn.status === "interrupted" ? "CODEX_REVIEW_CANCELLED" : "CODEX_REVIEW_FAILED"));
      }
    });
    await client.start(); options.signal.throwIfAborted(); if (settled) await done; stage = "thread-start";
    const result = await client.call("thread/start", { model: MODEL, modelProvider: "openai", config: client.threadConfig, cwd,
      approvalPolicy: "never", sandbox: "read-only", baseInstructions: options.system, developerInstructions: "",
      runtimeWorkspaceRoots: [], environments: [], allowProviderModelFallback: false, dynamicTools: [], ephemeral: true });
    options.signal.throwIfAborted();
    if (result.model !== MODEL || result.reasoningEffort !== EFFORT || result.modelProvider !== "openai") fail("CODEX_MODEL_CONFIGURATION_MISMATCH");
    if (result.sandbox?.type !== "readOnly" || result.approvalPolicy !== "never" || result.instructionSources?.length) fail("CODEX_ISOLATION_CONFIGURATION_MISMATCH");
    if (!result.thread?.id || result.thread.turns?.some((turn: any) => turn.status === "inProgress")) fail("CODEX_THREAD_IDENTITY_MISMATCH");
    threadId = result.thread.id; audit.threadId = threadId; if (settled) await done; stage = "turn-start";
    // Review messages are the frozen request/source/evidence plus an optional
    // schema-repair record, not historical author turns to execute again.
    const input = options.messages.map(message => ({ type: "text", text: JSON.stringify({ role: message.role, content: message.content }) }));
    const started = await client.call("turn/start", { threadId, model: MODEL, effort: EFFORT, approvalPolicy: "never",
      runtimeWorkspaceRoots: [], environments: [], input });
    if (!started.turn?.id || (turnId && turnId !== started.turn.id)) fail("CODEX_TURN_IDENTITY_MISMATCH");
    turnId = started.turn.id; audit.turnId = turnId; audit.modelStarted = true; audit.status = "running"; await save();
    await done; options.signal.throwIfAborted();
    const response = [...text.values()].join("\n").trim();
    if (!response) fail("CODEX_REVIEW_EMPTY");
    audit.status = "completed";
    return { text: response, modelKey: `codex-cli/${MODEL}`, thinkingLevel: EFFORT,
      ...(usage ? { usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens,
        ...(usage.cachedInputTokens !== undefined ? { cacheReadTokens: usage.cachedInputTokens } : {}),
        ...(usage.reasoningOutputTokens !== undefined ? { reasoningTokens: usage.reasoningOutputTokens } : {}) } } : {}) };
  } catch (error) {
    audit.status = options.signal.aborted ? "cancelled" : "failed";
    const code = (error as any)?.errorCode ?? (error as any)?.message;
    audit.errorCode = typeof code === "string" && /^[A-Z][A-Z0-9_]{2,100}$/.test(code) ? code : "CODEX_REVIEW_FAILED";
    audit.diagnostic = protocolDiagnostic(error, stage);
    throw error;
  } finally {
    options.signal.removeEventListener("abort", aborted);
    await client?.close().catch(() => {});
    audit.threadId = threadId ?? null; audit.turnId = turnId ?? null;
    audit.usage = usage ?? null; audit.usageAvailability = usageIncomplete ? "incomplete-native-compaction" : usage ? "reported" : "unreported";
    audit.text = [...text.values()].join("\n"); audit.finishedAt = new Date().toISOString();
    await save();
  }
}
