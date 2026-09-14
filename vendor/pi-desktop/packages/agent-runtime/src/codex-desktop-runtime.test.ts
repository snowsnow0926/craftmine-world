import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexDesktopRuntime, codexTurnUsage, type CodexCheckpoint } from "./codex-desktop-runtime.js";
import { MODEL, EFFORT, protocolDiagnostic } from "./codex-app-server.mjs";

class Client extends EventEmitter {
  calls: any[] = []; replies: any[] = []; closed = false; threadConfig = {}; model = MODEL;
  started?: () => void;
  async start() {}
  async call(method: string, params: any): Promise<any> {
    this.calls.push({ method, params });
    if (method.startsWith("thread/")) return { model: this.model, modelProvider: "openai", reasoningEffort: EFFORT,
      sandbox: { type: "readOnly" }, approvalPolicy: "never", instructionSources: [], thread: { id: "thread-1", turns: [] } };
    if (method === "turn/start") { this.notify("turn/started", { turn: { id: "turn-cli" } }); this.started?.(); return { turn: { id: "turn-cli" } }; }
    return {};
  }
  notify(method: string, params: any) { this.emit("notification", { method, params: { threadId: "thread-1", turnId: "turn-cli", ...params } }); }
  request(fields: any = {}) { this.emit("request", { id: 1, method: "item/tool/call", params: { threadId: "thread-1", turnId: "turn-cli", namespace: "craftmine", tool: "godot_project_facts", callId: "call", arguments: {}, ...fields } }); }
  respond(id: any, result: any) { this.replies.push({ id, result }); }
  reject(id: any) { this.replies.push({ id, rejected: true }); }
  async close() { this.closed = true; }
}
const next = () => new Promise(resolve => setImmediate(resolve));
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCfoAAAAASUVORK5CYII=";
async function fixture() {
  const scratch = await mkdtemp(join(tmpdir(), "codex-desktop-"));
  const events: any[] = [], calls: any[] = [];
  let checkpoint: CodexCheckpoint | undefined, transcriptMatches = true;
  let execute = async (_params: any): Promise<any> => ({ ok: true, content: { world: { id: "host-world" }, images: [{ mimeType: "image/png", data: png }] } });
  const make = (client = new Client()) => {
    let start!: () => void; const ready = new Promise<void>(resolve => { start = resolve; }); client.started = start;
    const runtime = new CodexDesktopRuntime({ sessionId: "host-session", binary: "C:/codex.exe", scratchDir: scratch,
      tools: [{ name: "plugin_craftmine_world_godot_project_facts", description: "facts", parameters: { type: "object" }, risk: "medium" }],
      verifyBinary: async () => {}, clientFactory: () => client, onEvent: event => events.push(event),
      history: async () => [{ id: "old", role: "user", content: "Preserve my tree", createdAt: "today", status: "complete" },
        {id:"old-capture",role:"tool",content:JSON.stringify({images:[{mimeType:"image/png",data:png}]}),toolResult:{images:[{mimeType:"image/png",data:png}],scope:"formal"},createdAt:"today",status:"complete"}],
      host: { async call(method, params): Promise<any> {
        calls.push({ method, params });
        if (method === "craftmine.context") return { world: { id: "host-world", runtimeKind: "godot" } };
        if (method === "codex.checkpoint.load") return { checkpoint, transcriptMatches };
        if (method === "codex.checkpoint.save") { checkpoint = structuredClone(params.checkpoint) as CodexCheckpoint; return {}; }
        if (method === "codex.fence") return {};
        if (method === "tools.execute") return execute(params);
        throw Error("Unexpected host operation " + method);
      } },
    });
    return { runtime, client, ready };
  };
  return { make, events, calls, get checkpoint() { return checkpoint; }, set execute(fn: typeof execute) { execute = fn; },
    diverge: () => { transcriptMatches = false; }, cleanup: () => rm(scratch, { recursive: true, force: true }) };
}

describe("Codex desktop adapter (mock app-server, no live model)", () => {
  it("uses host identities/registered permissions, actual images, exact config and cumulative deltas across fresh runtimes", async () => {
    const f = await fixture();
    try {
      for (let turn = 1; turn <= 2; turn++) {
        const { runtime, client, ready } = f.make();
        const running = runtime.prompt({ text: "Add flowers beside the same tree", attachments: [{ path: "attachments/reference.png", name: "reference", kind: "image", mimeType: "image/png", data: png }] }, "user-current", "native-" + turn);
        await ready;
        expect(client.calls[0].method).toBe(turn === 1 ? "thread/start" : "thread/resume");
        const input = client.calls.find(call => call.method === "turn/start").params;
        expect(input).toMatchObject({ model: MODEL, effort: EFFORT, environments: [], runtimeWorkspaceRoots: [], approvalPolicy: "never" });
        expect(input.input.at(-1)).toEqual({ type: "image", url: "data:image/png;base64," + png });
        expect(JSON.stringify(input)).not.toContain("maxTokens");
        if (turn === 1) {
          expect(JSON.stringify(input)).toContain("Preserve my tree");
          expect(input.input.filter((item: any) => item.type === "image")).toHaveLength(2);
          expect(input.input.filter((item: any) => item.type === "text").some((item: any) => item.text.includes(png))).toBe(false);
        }
        client.request(); await next();
        const tool = f.calls.filter(call => call.method === "tools.execute").at(-1).params;
        expect(tool).toMatchObject({ sessionId: "host-session", turnId: "native-" + turn, toolName: "plugin_craftmine_world_godot_project_facts", declaredRisk: "medium", mode: "agent" });
        expect(tool.toolCallId).toMatch(/^codex-[a-f0-9]{64}$/);
        expect(client.replies[0].result.contentItems[1].type).toBe("inputImage");
        client.notify("item/agentMessage/delta", { itemId: "reply", delta: "Actual results" });
        client.notify("thread/tokenUsage/updated", { tokenUsage: { total: { inputTokens: turn * 100, outputTokens: turn * 20, totalTokens: turn * 120, cacheWriteInputTokens: 0 },
          last: {inputTokens:40,outputTokens:10,totalTokens:50,cachedInputTokens:0,cacheWriteInputTokens:0},modelContextWindow:1000000 } });
        client.notify("turn/completed", { turn: { id: "turn-cli", status: "completed" } });
        await running;
        expect(client.closed).toBe(true);
        expect(f.checkpoint?.synchronized).toBe(true);
        expect(f.events.filter(e => e.event.type === "message_end" && e.turnId === "native-" + turn).at(-1).event.message.usage).toEqual({ inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheWriteTokens: 0 });
        expect(f.events.filter(e => e.event.type === "message_end" && e.turnId === "native-" + turn).at(-1).event.message.codexUsage).toMatchObject({scope:"current-turn",cost:null,modelContextWindow:1000000,lastRequest:{inputTokens:40,outputTokens:10,totalTokens:50}});
      }
    } finally { await f.cleanup(); }
  });
  it("refuses foreign/stale/replayed tools and drains in-flight work after a native fence", async () => {
    const f = await fixture(); let release!: () => void;
    f.execute = async () => { await new Promise<void>(resolve => { release = resolve; }); return { ok: true, content: "late" }; };
    try {
      const { runtime, client, ready } = f.make(); const running = runtime.prompt({ text: "create" }, "user", "native"); await ready;
      for (const fields of [{ threadId: "foreign" }, { turnId: "old" }, { namespace: "shell" }, { tool: "Bash" }]) client.request(fields);
      expect(f.calls.filter(call => call.method === "tools.execute")).toHaveLength(0);
      client.request(); await next(); client.request(); client.request({ arguments: { changed: true } });
      expect(f.calls.filter(call => call.method === "tools.execute")).toHaveLength(1);
      const abort = runtime.abort(); await next();
      expect(f.calls.some(call => call.method === "codex.fence")).toBe(true); expect(client.closed).toBe(true);
      client.request({ callId: "late" }); release(); await abort; await running;
      expect(f.calls.filter(call => call.method === "tools.execute")).toHaveLength(1);
      expect(f.events.find(e => e.event.type === "error").event.error.code).toBe("TURN_ABORTED");
      expect(f.checkpoint?.synchronized).toBe(false);
    } finally { await f.cleanup(); }
  });
  it("restores canonical history after an ended/interrupted transport, without replaying tools", async () => {
    const f = await fixture();
    try {
      const first = f.make(); const p = first.runtime.prompt({ text: "first" }, "user", "n1"); await first.ready; await first.runtime.abort(); await p;
      const second = f.make(); const p2 = second.runtime.prompt({ text: "continue" }, "user", "n2"); await second.ready;
      expect(second.client.calls[0].method).toBe("thread/start");
      expect(JSON.stringify(second.client.calls)).toContain("Historical Rust transcript");
      expect(f.calls.some(call => call.method === "tools.execute")).toBe(false);
      second.client.notify("turn/completed", { turn: { id: "turn-cli", status: "completed" } }); await p2;
      f.diverge(); const third = f.make(); const p3 = third.runtime.prompt({ text: "regenerated" }, "user", "n3"); await third.ready;
      expect(third.client.calls[0].method).toBe("thread/start"); await third.runtime.abort(); await p3;
    } finally { await f.cleanup(); }
  });
  it("does not fall back on model mismatch, reroute or process failure and never emits raw errors", async () => {
    for (const failure of ["model", "reroute", "process"]) {
      const f = await fixture();
      try {
        const client = new Client(); if (failure === "model") client.model = "other";
        const x = f.make(client); const p = x.runtime.prompt({ text: "build my world" }, "user", "native");
        if (failure !== "model") { await x.ready; failure === "reroute" ? client.notify("model/rerouted", {}) : client.emit("failure", Error("Bearer hidden-secret")); }
        await p;
        expect(f.events.some(e => e.event.type === "error")).toBe(true);
        expect(JSON.stringify(f.events)).not.toContain("hidden-secret");
        expect(f.calls.some(call => call.method === "codex.fence")).toBe(true);
        expect(client.calls.filter(call => call.method === "turn/start").length).toBe(failure === "model" ? 0 : 1);
      } finally { await f.cleanup(); }
    }
  });
  it("retains the failed restoration RPC stage and sanitized protocol cause without retrying or changing model", async () => {
    const f = await fixture();
    try {
      const client = new Client(); const original = client.call.bind(client);
      client.call = async (method, params) => {
        if (method !== 'turn/start') return original(method, params);
        client.calls.push({method,params});
        throw Object.assign(Error('CODEX_RPC_ERROR:-32602'), {rpcMethod:method,rpcCode:-32602,
          diagnostic:'Input rejected; api_key=private-key Bearer private-bearer; user@example.com https://example.test/?secret=private-query',
          rawRequest:params,stderr:'private-stderr'});
      };
      const {runtime}=f.make(client); await runtime.prompt({text:'preserve the world'},'user','native');
      const error=f.events.find(e=>e.event.type==='error').event.error;
      expect(error.code).toBe('CODEX_BACKEND_FAILED');
      expect(error.details).toMatchObject({stage:'turn-start',rpcMethod:'turn/start',rpcCode:-32602});
      expect(error.details.message).toContain('Input rejected');
      for(const secret of ['private-key','private-bearer','user@example.com','private-query','private-stderr','rawRequest'])expect(JSON.stringify(error)).not.toContain(secret);
      expect(client.calls.filter(call=>call.method==='turn/start')).toHaveLength(1);
      expect(client.calls.find(call=>call.method==='turn/start').params.model).toBe(MODEL);
      expect(client.calls.find(call=>call.method==='turn/start').params.effort).toBe(EFFORT);
      expect(runtime.getStatus().transportState).toBe('restored-from-transcript');
      expect(f.checkpoint?.synchronized).toBe(false);
      expect(client.closed).toBe(true);
    } finally { await f.cleanup(); }
  });
  it("bounds protocol diagnostics and does not project arbitrary exceptions or fields", () => {
    const result=protocolDiagnostic({rpcMethod:'turn/start',rpcCode:-32602,diagnostic:'犬'.repeat(1500),data:{secret:'private'}},'turn-start');
    expect((result as any).message).toHaveLength(1036);
    expect((result as any).message).toMatch(/\[truncated\]$/);
    expect(protocolDiagnostic({rpcMethod:'unknown/private',rpcCode:4,diagnostic:'secret'},'foreign')).toEqual({stage:'unknown'});
    expect(protocolDiagnostic(Error('private-account-path'),'history-restore')).toEqual({stage:'history-restore'});
    expect(protocolDiagnostic({rpcMethod:'turn/start',rpcCode:NaN,diagnostic:'secret'},'turn-start')).toEqual({stage:'turn-start'});
  });
  it("cancels during unacknowledged start and preserves a failed native fence as an error", async () => {
    const f = await fixture();
    try {
      const client = new Client(); let rejectStart!: (error: Error) => void;
      const normal = client.call.bind(client);
      client.call = async (method, params) => {
        if (method !== "turn/start") return normal(method, params);
        client.calls.push({ method, params }); client.notify("turn/started", { turn: { id: "turn-cli" } });
        client.started?.(); return new Promise((_resolve, reject) => { rejectStart = reject; });
      };
      client.close = async () => { client.closed = true; rejectStart?.(Error("CODEX_TRANSPORT_CLOSED")); };
      const x = f.make(client); const p = x.runtime.prompt({ text: "create" }, "user", "native"); await x.ready;
      await x.runtime.abort(); await p;
      expect(client.closed).toBe(true); expect(f.events.filter(e => e.event.type === "agent_end")).toHaveLength(1);
      expect(f.calls.some(call => call.method === "codex.fence")).toBe(true);
    } finally { await f.cleanup(); }
    const scratch = await mkdtemp(join(tmpdir(), "codex-fence-"));
    try {
      const events: any[] = [], client = new Client(); let ready!: () => void;
      const started = new Promise<void>(resolve => { ready = resolve; }); client.started = ready;
      const runtime = new CodexDesktopRuntime({ sessionId: "session", binary: "C:/codex.exe", scratchDir: scratch,
        tools: [{ name: "plugin_craftmine_world_godot_project_facts", parameters: { type: "object" } }],
        verifyBinary: async () => {}, clientFactory: () => client, onEvent: e => events.push(e), history: async () => [],
        host: { call: async (method): Promise<any> => {
          if (method === "craftmine.context") return { world: { runtimeKind: "godot" } };
          if (method === "codex.fence") throw Error("native unavailable");
          return {};
        } },
      });
      const p = runtime.prompt({ text: "create" }, "user", "native"); await started; await runtime.abort(); await p;
      expect(events.find(e => e.event.type === "error").event.error.code).toBe("CODEX_NATIVE_FENCE_FAILED");
    } finally { await rm(scratch, { recursive: true, force: true }); }
  });
  it("leaves absent/reset usage unknown instead of inventing token or cost zeros", () => {
    expect(codexTurnUsage({inputTokens:200,outputTokens:40,totalTokens:240,cachedInputTokens:160},
      {inputTokens:100,outputTokens:20,totalTokens:120,cachedInputTokens:80})).toEqual({inputTokens:20,outputTokens:20,totalTokens:120,cacheReadTokens:80});
    expect(codexTurnUsage(undefined, { inputTokens: 0, outputTokens: 0, totalTokens: 0 })).toBeUndefined();
    expect(codexTurnUsage({ inputTokens: 5, outputTokens: 2, totalTokens: 7 }, { inputTokens: 7, outputTokens: 3, totalTokens: 10 })).toBeUndefined();
  });
});
