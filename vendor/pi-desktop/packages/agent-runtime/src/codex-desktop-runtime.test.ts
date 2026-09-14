import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexDesktopRuntime, codexTurnUsage, type CodexCheckpoint } from "./codex-desktop-runtime.js";
import { MODEL, EFFORT, protocolDiagnostic } from "./codex-app-server.mjs";
import { readFileSync } from "node:fs";
import { CODEX_WORLD_TOOLS, CODEX_LEGACY_WORLD_TOOLS, CODEX_REGISTERED_WORLD_TOOLS } from "@pi-desktop/shared";

const registeredWorldTools = JSON.parse(readFileSync(new URL("../../../../../plugins/craftmine-world/manifest.json", import.meta.url), "utf8"))
  .contributes.agentTools.filter((tool: any) => CODEX_REGISTERED_WORLD_TOOLS.has(tool.name))
  .map((tool: any) => ({ name: "plugin_craftmine_world_" + tool.name, description: tool.description, parameters: tool.schema, risk: tool.risk }));

class Client extends EventEmitter {
  calls: any[] = []; replies: any[] = []; closed = false; threadConfig = {}; model = MODEL;
  started?: () => void;
  async start() {}
  async call(method: string, params: any): Promise<any> {
    this.calls.push({ method, params });
    if(method==='thread/compact/start'){
      const id='compact-'+this.calls.filter(c=>c.method===method).length;
      this.notify('turn/started',{turnId:id,turn:{id}});
      this.notify('item/completed',{turnId:id,item:{type:'contextCompaction'}});
      this.notify('turn/completed',{turnId:id,turn:{id,status:'completed'}});
      return {};
    }
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
async function fixture(historyMessages?: any[], config: { runtimeKind?: string | null; tools?: any[] } = {}) {
  const scratch = await mkdtemp(join(tmpdir(), "codex-desktop-"));
  const events: any[] = [], calls: any[] = [];
  let checkpoint: CodexCheckpoint | undefined, transcriptMatches = true, rejectSave=false,recovery:any;
  let facts: any = { world: { id: "host-world", runtimeKind: config.runtimeKind === undefined ? "godot" : config.runtimeKind } };
  let execute = async (_params: any): Promise<any> => ({ ok: true, content: { world: { id: "host-world" }, images: [{ mimeType: "image/png", data: png }] } });
  const make = (client = new Client()) => {
    let start!: () => void; const ready = new Promise<void>(resolve => { start = resolve; }); client.started = start;
    const runtime = new CodexDesktopRuntime({ sessionId: "host-session", binary: "C:/codex.exe", scratchDir: scratch,
      tools: config.tools ?? [{ name: "plugin_craftmine_world_godot_project_facts", description: "facts", parameters: { type: "object" }, risk: "medium" }],
      verifyBinary: async () => {}, interruptGraceMs:30, clientFactory: () => client, onEvent: event => events.push(event),
      history: async () => historyMessages ?? [{ id: "old", role: "user", content: "Preserve my tree", createdAt: "today", status: "complete" },
        {id:"old-capture",role:"tool",content:JSON.stringify({images:[{mimeType:"image/png",data:png}]}),toolResult:{images:[{mimeType:"image/png",data:png}],scope:"formal"},createdAt:"today",status:"complete"}],
      host: { async call(method, params): Promise<any> {
        calls.push({ method, params });
        if (method === "craftmine.context") return structuredClone(facts);
        if (method === "codex.checkpoint.load") return { checkpoint, transcriptMatches, recovery };
        if (method === "codex.checkpoint.save") { if(rejectSave)throw Error('CODEX_TEST_SAVE_FAILED'); checkpoint = structuredClone(params.checkpoint) as CodexCheckpoint; return {}; }
        if (method === "codex.fence") return {};
        if (method === "tools.execute") return execute(params);
        throw Error("Unexpected host operation " + method);
      } },
    });
    return { runtime, client, ready };
  };
  return { make, events, calls, scratch, get checkpoint() { return checkpoint; }, set execute(fn: typeof execute) { execute = fn; },
    setFacts: (value: any) => { facts = value; },
    diverge: () => { transcriptMatches = false; },setRecovery:(value:any)=>{recovery=value;},
    rejectSaves:()=>{rejectSave=true;}, cleanup: () => rm(scratch, { recursive: true, force: true }) };
}

describe("Codex desktop adapter (mock app-server, no live model)", () => {
  it("routes legacy tree requests through registered host tools with the selected Codex configuration and resumes that catalog", async () => {
    const f = await fixture([], { runtimeKind: "legacy", tools: registeredWorldTools });
    try {
      for (let turn = 1; turn <= 2; turn++) {
        const x = f.make(); const running = x.runtime.prompt({ text: turn === 1 ? "生成一个树" : "把树冠变大" }, "user-" + turn, "host-turn-" + turn);
        await x.ready;
        const launch = x.client.calls.find(c => c.method === (turn === 1 ? "thread/start" : "thread/resume"));
        expect(launch.params).toMatchObject({ model: MODEL, sandbox: "read-only", approvalPolicy: "never", runtimeWorkspaceRoots: [] });
        expect(launch.params.baseInstructions).toContain("legacy voxel world");
        expect(x.client.calls.find(c => c.method === "turn/start").params).toMatchObject({ model: MODEL, effort: EFFORT });
        if (turn === 1) {
          const advertised = launch.params.dynamicTools[0].tools;
          expect(new Set(advertised.map((tool: any) => tool.name))).toEqual(CODEX_LEGACY_WORLD_TOOLS);
          expect(advertised.find((tool: any) => tool.name === "workspace_patch").inputSchema.additionalProperties).toBe(false);
        }
        for (const [tool, args] of [["project_inspect", {}], ["capabilities_read", { section: "objects" }],
          ["workspace_patch", { workspaceRevision: 0, operations: [{ op: "add", kind: "object", id: "new-tree", expectedHash: null, value: { id: "new-tree" } }] }],
          ["verification_submit", { workspaceRevision: 1, summary: "Add a tree" }], ["verification_read", { id: "check-" + "a".repeat(64) }]] as const) {
          x.client.request({ tool, callId: tool, arguments: args }); await next();
          expect(x.client.replies.at(-1).result.success).toBe(true);
          expect(f.calls.at(-1)).toMatchObject({ method: "tools.execute", params: { sessionId: "host-session", turnId: "host-turn-" + turn,
            toolName: "plugin_craftmine_world_" + tool, args, mode: "agent" } });
          expect(f.calls.at(-1).params.declaredRisk).toBe(registeredWorldTools.find((entry: any) => entry.name.endsWith("_" + tool)).risk);
        }
        x.client.notify("turn/completed", { turn: { id: "turn-cli", status: "completed" } }); await running;
        expect(f.checkpoint?.synchronized).toBe(true);
      }
    } finally { await f.cleanup(); }
  });
  it("preserves the existing Godot dynamic catalog digest when legacy definitions are supplied", async () => {
    const godot = registeredWorldTools.filter((tool: any) => CODEX_WORLD_TOOLS.has(tool.name.slice("plugin_craftmine_world_".length)));
    const expected = createHash("sha256").update(JSON.stringify([{ type: "namespace", name: "craftmine", description: "Host-bound Craftmine world authoring tools",
      tools: godot.map((tool: any) => ({ type: "function", name: tool.name.slice("plugin_craftmine_world_".length), description: tool.description, inputSchema: tool.parameters })) }])).digest("hex");
    const f = await fixture([], { tools: registeredWorldTools });
    try {
      const x = f.make(); const running = x.runtime.prompt({ text: "Keep my world" }, "user", "turn"); await x.ready;
      expect(f.checkpoint?.toolDigest).toBe(expected);
      const count = f.calls.length;
      x.client.request({ tool: "workspace_patch", arguments: {} }); await next();
      expect(x.client.replies.at(-1).result.success).toBe(false); expect(f.calls).toHaveLength(count);
      await x.runtime.abort(); await running;
    } finally { await f.cleanup(); }
  });
  it("rejects native, filesystem and foreign-turn calls in a legacy conversation and preserves host refusals", async () => {
    const f = await fixture([], { runtimeKind: "legacy", tools: registeredWorldTools });
    try {
      const x = f.make(); const running = x.runtime.prompt({ text: "生成一个树" }, "user", "turn"); await x.ready;
      const before = f.calls.length;
      for (const fields of [{ tool: "godot_project_patch" }, { tool: "Bash" }, { tool: "workspace_patch", turnId: "foreign" }, { tool: "workspace_patch", namespace: "foreign" }]) {
        x.client.request(fields); await next(); expect(x.client.replies.at(-1).result.success).toBe(false);
      }
      expect(f.calls).toHaveLength(before);
      f.execute = async () => { throw Object.assign(Error("PERMISSION_DENIED"), { errorCode: "PERMISSION_DENIED" }); };
      x.client.request({ tool: "workspace_patch", callId: "denied", arguments: { worldId: "foreign" } }); await next();
      expect(x.client.replies.at(-1).result.success).toBe(false);
      expect(f.calls.at(-1).params).toMatchObject({ sessionId: "host-session", turnId: "turn", args: { worldId: "foreign" } });
      const count = f.calls.filter(c => c.method === "tools.execute").length;
      await x.runtime.abort(); await running;
      x.client.request({ tool: "workspace_patch", callId: "late" }); await next();
      expect(f.calls.filter(c => c.method === "tools.execute")).toHaveLength(count);
    } finally { await f.cleanup(); }
  });
  it("rejects unknown runtimes and incomplete legacy catalogs before starting a model", async () => {
    for (const config of [{ runtimeKind: "unknown", tools: registeredWorldTools }, { runtimeKind: null, tools: registeredWorldTools },
      { runtimeKind: "legacy", tools: registeredWorldTools.filter((tool: any) => !tool.name.endsWith("_verification_submit")) }]) {
      const f = await fixture([], config);
      try {
        const x = f.make(); await x.runtime.prompt({ text: "生成一个树" }, "user", "turn");
        expect(x.client.calls).toEqual([]);
        expect(f.events.some(e => e.event.type === "error")).toBe(true);
      } finally { await f.cleanup(); }
    }
  });
  it("rejects a changed legacy catalog checkpoint and unregistered or duplicate tool definitions", async () => {
    const tools = structuredClone(registeredWorldTools);
    const f = await fixture([], { runtimeKind: "legacy", tools });
    try {
      const x = f.make(); const running = x.runtime.prompt({ text: "生成一个树" }, "user", "turn"); await x.ready;
      x.client.notify("turn/completed", { turn: { id: "turn-cli", status: "completed" } }); await running;
      tools.find((tool: any) => tool.name.endsWith("_workspace_patch")).description += " changed";
      const changed = f.make(); await changed.runtime.prompt({ text: "Continue" }, "user-2", "turn-2");
      expect(changed.client.calls).toEqual([]);
      expect(f.events.filter(e => e.event.type === "error").at(-1).event.error.code).toBe("CODEX_TOOL_CATALOG_CHANGED");
    } finally { await f.cleanup(); }
    for (const entry of [{ name: "Bash", parameters: { type: "object" } }, registeredWorldTools[0]]) {
      const invalid = await fixture([], { tools: [...registeredWorldTools, entry] });
      try { expect(() => invalid.make()).toThrow("CODEX_TOOL_SCOPE_INVALID"); } finally { await invalid.cleanup(); }
    }
  });
  it("rejects a changed runtime or world after history restoration before submitting the player request", async () => {
    for (const world of [{ id: "host-world", runtimeKind: "godot" }, { id: "foreign", runtimeKind: "legacy" }]) {
      const f = await fixture([], { runtimeKind: "legacy", tools: registeredWorldTools });
      try {
        const client = new Client(), original = client.call.bind(client);
        client.call = async (method, params) => { const result = await original(method, params); if (method === "thread/start") f.setFacts({ world }); return result; };
        const x = f.make(client); await x.runtime.prompt({ text: "生成一个树" }, "user", "turn");
        expect(client.calls.some(c => c.method === "turn/start")).toBe(false);
        expect(f.events.filter(e => e.event.type === "error").at(-1).event.error.code).toBe("CODEX_WORLD_SOURCE_BINDING_CHANGED");
      } finally { await f.cleanup(); }
    }
  });
  it('keeps stdin open through both delayed interrupt response and matching terminal, then saves only confirmed idle tail',async()=>{
    const f=await fixture();try{
      const {runtime,client,ready}=f.make();const running=runtime.prompt({text:'work'},'user','prior');await ready;await next();
      const original=client.call.bind(client);let reply!:()=>void;
      client.call=async(method,params)=>{
        if(method!=='turn/interrupt')return original(method,params);
        client.calls.push({method,params});await new Promise<void>(resolve=>{reply=resolve;});return {};
      };
      const stopping=runtime.abort();await next();
      expect(client.closed).toBe(false);expect(f.calls.at(-1).method).toBe('codex.fence');
      client.notify('turn/completed',{turn:{id:'turn-cli',status:'interrupted'}});await next();
      expect(client.closed).toBe(false);reply();await stopping;await running;
      expect(client.closed).toBe(true);expect(f.checkpoint?.synchronized).toBe(true);
    }finally{await f.cleanup();}
  });
  it('recovers an unsynchronized interrupted thread only after two exact native tail reads and host revalidation',async()=>{
    for(const variant of ['matching','changed-tail','pending','read-error','read-exit','read-cancel','deferred','partial-inject']){
      const history:any[]=[{id:'old-user',role:'user',status:'complete',content:'Keep the complete city',createdAt:'yesterday'},
        {id:'abort',role:'assistant',content:'',status:'aborted',error:{code:'TURN_ABORTED'},createdAt:'yesterday'}];
      const f=await fixture(history);try{
        const seed=f.make();const first=seed.runtime.prompt({text:'seed'},'current','seed');await seed.ready;await seed.runtime.abort();await first;
        const saved=structuredClone(f.checkpoint),beforeSaves=f.calls.filter(c=>c.method==='codex.checkpoint.save').length;
        const recovery={hostTurnId:'prior',sessionId:'host-session',projectId:'p',worldId:'host-world',userMessageId:'old-user',tailEndMessageId:'abort',deferredMessageIds:[] as string[]};
        if(['deferred','partial-inject'].includes(variant)){
          history.push({id:'never-sent',role:'user',content:'Also preserve this request',status:'complete',createdAt:'now'},
            {id:'verify-error',role:'assistant',content:'',status:'error',error:{code:'CODEX_INTERRUPTED_RECOVERY_UNVERIFIED'},createdAt:'now'});
          recovery.deferredMessageIds=['never-sent','verify-error'];
        }
        f.setRecovery(recovery);
        const client=new Client(),original=client.call.bind(client);let reads=0,rejectRead:(e:Error)=>void=()=>{};
        let signalRead!:()=>void;const readEntered=new Promise<void>(resolve=>{signalRead=resolve;});
        client.call=async(method,params)=>{
          if(method==='thread/read'){
            client.calls.push({method,params});if(variant==='read-error')throw Object.assign(Error('CODEX_RPC_ERROR'),{rpcMethod:method,rpcCode:-1,diagnostic:'temporary unavailable'});
            if(variant==='read-exit'){client.emit('failure',Error('CODEX_PROCESS_EXIT'));throw Error('CODEX_TRANSPORT_CLOSED');}
            if(variant==='read-cancel'){signalRead();return await new Promise((_resolve,reject)=>{rejectRead=reject;});}
            return {thread:{id:'thread-1',cwd:join(f.scratch,'codex-empty'),status:{type:'notLoaded'},modelProvider:'openai',model:MODEL,reasoningEffort:EFFORT}};
          }
          if(method==='thread/turns/list'){
            client.calls.push({method,params});reads++;
            return {data:[{id:variant==='changed-tail'&&reads===2?'foreign':'old-native-turn',status:variant==='pending'?'inProgress':'interrupted',itemsView:'full',error:null,
              items:[{type:'userMessage',content:[{type:'text',text:'Current authoritative host facts: '+JSON.stringify({world:{id:'host-world'},binding:{sessionId:'host-session',projectId:'p',turnId:'prior'}})},{type:'text',text:'Keep the complete city'}]}]}]};
          }
          if(method==='thread/inject_items'&&variant==='partial-inject'){client.calls.push({method,params});throw Error('CODEX_TRANSPORT_CLOSED');}
          return original(method,params);
        };
        const x=f.make(client);const running=x.runtime.prompt({text:'Continue'},'new-user','new-turn');
        if(variant==='read-cancel'){
          client.close=async()=>{client.closed=true;rejectRead(Error('CODEX_TRANSPORT_CLOSED'));};
          await readEntered;await x.runtime.abort();
        }
        if(['matching','deferred'].includes(variant)){
          await x.ready;expect(reads).toBe(2);expect(client.calls.some(c=>c.method==='thread/start'||c.method==='thread/compact/start')).toBe(false);
          if(variant==='deferred')expect(JSON.stringify(client.calls.filter(c=>c.method==='thread/inject_items'))).toContain('Also preserve this request');
          else expect(client.calls.some(c=>c.method==='thread/inject_items')).toBe(false);
          expect(client.calls.filter(c=>c.method==='turn/start')).toHaveLength(1);
          client.notify('turn/completed',{turn:{id:'turn-cli',status:'completed'}});await running;
        }else{
          await running;expect(client.calls.some(c=>['thread/start','turn/start','thread/compact/start'].includes(c.method))).toBe(false);
          if(variant==='partial-inject')expect(f.checkpoint?.submitted).toBe(false);
          else{
            expect(f.checkpoint).toEqual(saved);expect(f.calls.filter(c=>c.method==='codex.checkpoint.save')).toHaveLength(beforeSaves);
            expect(f.events.filter(e=>e.event.type==='error').at(-1).event.error).toMatchObject(variant==='read-cancel'?
              {code:'TURN_ABORTED',details:{recoveryReadOnly:true}}:{code:'CODEX_INTERRUPTED_RECOVERY_UNVERIFIED',retriable:true});
          }
        }
      }finally{await f.cleanup();}
    }
  });
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
          const restored=client.calls.filter(call=>call.method==='thread/inject_items').flatMap(call=>call.params.items);
          expect(JSON.stringify(restored)).toContain("Preserve my tree");
          expect(restored.flatMap((item:any)=>item.content).filter((item:any)=>item.type==='input_image')).toHaveLength(1);
          expect(input.input.filter((item: any) => item.type === "image")).toHaveLength(1);
          expect(restored.flatMap((item:any)=>item.content).filter((item:any)=>item.type==='input_text').some((item:any)=>item.text.includes(png))).toBe(false);
          expect(input.input.filter((item: any) => item.type === "text").some((item: any) => item.text.includes(png))).toBe(false);
        } else expect(client.calls.some(call=>call.method==='thread/inject_items')).toBe(false);
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
  it("restores more than 1 Mi characters without losing player wording or executing historical calls", async () => {
    const user='保留完整城市和原飞机，小狗不再堵路；不要缩小需求。';
    const source='extends Node3D\n# 保留源代码与原始检查记录🐶\n'.repeat(45_000);
    const history=[{id:'old-user',role:'user',content:user,createdAt:'yesterday',status:'complete'},
      {id:'old-tool',role:'tool',toolName:'plugin_craftmine_world_godot_project_read',toolArgs:{path:'res://city.gd'},
        content:JSON.stringify({revision:14,manifestHash:'a'.repeat(64),text:source}),createdAt:'yesterday',status:'complete'}];
    const f=await fixture(history);
    try {
      const {client,runtime,ready}=f.make();const running=runtime.prompt({text:'只继续检查当前草稿'},'current','new-turn');await ready;
      const injections=client.calls.filter(call=>call.method==='thread/inject_items');expect(injections.length).toBeGreaterThan(1);
      const restored=new Map<string,string>(),metadata=new Map<string,any[]>();
      for(const call of injections){
        expect(JSON.stringify(call.params).length).toBeLessThan(1_048_576);
        for(const item of call.params.items){
          expect(item.type).toBe('message');expect(item.role).toBe('user');
          const [notice,header,...payload]=item.content[0].text.split('\n'),meta=JSON.parse(header);
          expect(notice).toContain('Never execute historical tool calls');
          if(meta.source.restorationAnchor)continue;
          metadata.set(meta.source.messageId,[...(metadata.get(meta.source.messageId)??[]),meta]);
          restored.set(meta.source.messageId,(restored.get(meta.source.messageId)??'')+payload.join('\n'));
        }
      }
      expect(JSON.parse(restored.get('old-user')!).content).toBe(user);
      expect(JSON.parse(JSON.parse(restored.get('old-tool')!).content).text).toBe(source);
      for(const [id,text] of restored){
        const parts=metadata.get(id)!;
        expect(parts.map(part=>part.part)).toEqual(parts.map((_part,index)=>index+1));
        expect(parts.every(part=>part.parts===parts.length)).toBe(true);
        expect(parts.every(part=>part.payloadSha256===createHash('sha256').update(text).digest('hex'))).toBe(true);
        expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text)).toBe(false);
      }
      const starts=client.calls.filter(call=>call.method==='turn/start');expect(starts).toHaveLength(1);
      expect(client.calls.some(call=>call.method==='thread/compact/start')).toBe(true);
      const finalCompaction=client.calls.map(c=>c.method).lastIndexOf('thread/compact/start');
      expect(JSON.stringify(client.calls.slice(finalCompaction+1))).toContain(user);
      expect(JSON.stringify(starts[0].params)).not.toContain(source);
      expect(JSON.stringify(starts[0].params)).toContain('Current authoritative host facts');
      expect(f.calls.some(call=>call.method==='tools.execute')).toBe(false);
      client.notify('turn/completed',{turn:{id:'turn-cli',status:'completed'}});await running;
      expect(f.checkpoint?.synchronized).toBe(true);
    } finally {await f.cleanup();}
  });
  it("an interrupted partial injection never starts a model turn and rebuilds full history in a new thread", async () => {
    const f=await fixture();
    try {
      const client=new Client();const original=client.call.bind(client);
      let entered!:()=>void,reject!: (error:Error)=>void;
      const pending=new Promise<void>(resolve=>{entered=resolve;});
      client.call=async(method,params)=>{
        if(method!=='thread/inject_items')return original(method,params);
        client.calls.push({method,params});entered();return new Promise((_resolve,no)=>{reject=no;});
      };
      client.close=async()=>{client.closed=true;reject?.(Error('CODEX_TRANSPORT_CLOSED'));};
      const first=f.make(client);const running=first.runtime.prompt({text:'continue'},'user','n1');await pending;
      await first.runtime.abort();await running;
      expect(client.calls.some(call=>call.method==='turn/start')).toBe(false);
      expect(f.checkpoint?.synchronized).toBe(false);expect(f.checkpoint?.submitted).toBe(false);
      const second=f.make();const resumed=second.runtime.prompt({text:'continue'},'user','n2');await second.ready;
      expect(second.client.calls[0].method).toBe('thread/start');
      expect(JSON.stringify(second.client.calls.filter(call=>call.method==='thread/inject_items'))).toContain('Preserve my tree');
      expect(f.calls.some(call=>call.method==='tools.execute')).toBe(false);
      await second.runtime.abort();await resumed;
    } finally {await f.cleanup();}
  });
  it('native compaction failure or cancellation never completes the player request or sends its turn',async()=>{
    for(const variant of ['failed','cancelled','rerouted']){
      const f=await fixture([{id:'large',role:'tool',content:'source'.repeat(100_000),createdAt:'past',status:'complete'}]);
      try{
        const client=new Client(),original=client.call.bind(client);let entered!:()=>void;const begun=new Promise<void>(yes=>{entered=yes;});
        client.call=async(method,params)=>{
          if(method==='turn/interrupt'&&variant==='cancelled'){
            const result=await original(method,params);
            client.notify('turn/completed',{turnId:params.turnId,turn:{id:params.turnId,status:'interrupted'}});
            return result;
          }
          if(method!=='thread/compact/start')return original(method,params);
          client.calls.push({method,params});client.notify('turn/started',{turnId:'maintenance',turn:{id:'maintenance'}});entered();
          client.request({turnId:'maintenance'});
          if(variant==='failed'){
            client.notify('error',{turnId:'maintenance',error:{message:'Native compact refused',codexErrorInfo:'contextWindowExceeded'},willRetry:false});
            client.notify('turn/completed',{turnId:'maintenance',turn:{id:'maintenance',status:'failed',error:{message:'Native compact refused',codexErrorInfo:'contextWindowExceeded'}}});
          }
          if(variant==='rerouted')client.notify('model/rerouted',{turnId:'maintenance'});
          return {};
        };
        const {runtime}=f.make(client);const running=runtime.prompt({text:'continue'},'current','native');await begun;
        if(variant==='cancelled')await runtime.abort();await running;
        if(variant==='cancelled')expect(client.calls.filter(c=>c.method==='turn/interrupt')).toEqual([
          {method:'turn/interrupt',params:{threadId:'thread-1',turnId:'maintenance'}},
        ]);
        expect(client.calls.some(c=>c.method==='turn/start')).toBe(false);expect(f.calls.some(c=>c.method==='tools.execute')).toBe(false);
        expect(f.checkpoint?.synchronized).toBe(false);expect(f.checkpoint?.submitted).toBe(false);expect(client.closed).toBe(true);
        if(variant==='failed')expect(f.events.find(e=>e.event.type==='error').event.error.details.terminalError.codexErrorInfo).toBe('contextWindowExceeded');
        if(variant==='rerouted')expect(f.events.find(e=>e.event.type==='error').event.error.code).toBe('CODEX_MODEL_REROUTED');
      }finally{await f.cleanup();}
    }
  });
  it('keeps native maintenance usage unknown and separates subsequently reported creation counters',async()=>{
    const f=await fixture([{id:'large',role:'tool',content:'source'.repeat(100_000),createdAt:'past',status:'complete'}]);
    try{
      const client=new Client(),original=client.call.bind(client);let count=0;
      client.call=async(method,params)=>{
        const result=await original(method,params);
        if(method==='thread/compact/start'){
          count++;const total={inputTokens:0,outputTokens:0,totalTokens:0,cachedInputTokens:0,cacheWriteInputTokens:0,reasoningOutputTokens:0};
          client.notify('thread/tokenUsage/updated',{turnId:'compact-'+count,tokenUsage:{total,last:{...total,totalTokens:75024},modelContextWindow:522500}});
        }
        return result;
      };
      const {runtime,ready}=f.make(client);const running=runtime.prompt({text:'continue'},'current','native');await ready;await next();
      expect(count).toBeGreaterThan(0);expect(runtime.getStatus().isRunning).toBe(true);
      expect(f.events.some(e=>e.event.type==='agent_end')).toBe(false);
      expect(runtime.getStatus().transportUsage).toBeUndefined();
      expect(runtime.getStatus().codexUsageCoverage).toMatchObject({status:'incomplete',reason:'native-maintenance-usage-unreported',maintenanceTurns:count});
      expect(runtime.getStatus().codexUsageCoverage?.reportedCreationUsage).toBeUndefined();
      expect(f.checkpoint?.usageTotal).toBeUndefined();
      client.notify('thread/tokenUsage/updated',{tokenUsage:{total:{inputTokens:5,outputTokens:1,totalTokens:6},last:{inputTokens:5,outputTokens:1,totalTokens:6},modelContextWindow:522500}});
      expect(runtime.getStatus().transportUsage).toBeUndefined();expect(runtime.getStatus().codexUsageCoverage?.reportedCreationUsage?.totalTokens).toBe(6);
      client.notify('turn/completed',{turn:{id:'turn-cli',status:'completed'}});await running;
      const message=f.events.filter(e=>e.event.type==='message_end').at(-1).event.message;
      expect(message.usage).toBeUndefined();expect(message.codexUsage.coverage.reportedCreationUsage.totalTokens).toBe(6);
      expect(message.codexUsage.coverage.status).toBe('incomplete');expect(f.events.filter(e=>e.event.type==='agent_end')).toHaveLength(1);
      expect(f.checkpoint?.usageTotal?.totalTokens).toBe(6);
    }finally{await f.cleanup();}
  });
  it('stopping after native reset persists unknown maintenance coverage without a zero usage baseline',async()=>{
    const f=await fixture([{id:'large',role:'tool',content:'source'.repeat(100_000),createdAt:'past',status:'complete'}]);
    try{
      const client=new Client(),original=client.call.bind(client);let count=0;
      client.call=async(method,params)=>{const result=await original(method,params);if(method==='thread/compact/start'){
        count++;const zero={inputTokens:0,outputTokens:0,totalTokens:0};client.notify('thread/tokenUsage/updated',{turnId:'compact-'+count,tokenUsage:{total:zero,last:{...zero,totalTokens:75024},modelContextWindow:522500}});
      }return result;};
      const {runtime,ready}=f.make(client);const running=runtime.prompt({text:'continue'},'current','native');await ready;await runtime.abort();await running;
      expect(f.checkpoint?.usageTotal).toBeUndefined();
      const final=f.events.filter(e=>e.event.type==='message_end').at(-1).event.message;
      expect(final.usage).toBeUndefined();expect(final.codexUsage.coverage.reportedCreationUsage).toBeUndefined();
      expect(final.codexUsage.coverage.maintenanceTurns).toBe(count);expect(final.codexUsage.coverage.status).toBe('incomplete');
    }finally{await f.cleanup();}
  });
  it("an injection rejection retains its own cause and never falls back to one oversized turn/start",async()=>{
    const f=await fixture();
    try {
      const client=new Client(),original=client.call.bind(client);
      client.call=async(method,params)=>{
        if(method!=='thread/inject_items')return original(method,params);
        client.calls.push({method,params});throw Object.assign(Error('CODEX_RPC_ERROR:-32602'),{rpcMethod:method,rpcCode:-32602,diagnostic:'Injection refused'});
      };
      const {runtime}=f.make(client);await runtime.prompt({text:'continue'},'current','native');
      expect(client.calls.some(call=>call.method==='turn/start')).toBe(false);
      expect(f.events.find(e=>e.event.type==='error').event.error.details).toEqual({stage:'history-restore',rpcMethod:'thread/inject_items',rpcCode:-32602,message:'Injection refused'});
      expect(f.checkpoint?.synchronized).toBe(false);
      expect(f.calls.some(call=>call.method==='tools.execute')).toBe(false);
    }finally{await f.cleanup();}
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
      expect(f.calls.some(call => call.method === "codex.fence")).toBe(true); expect(client.closed).toBe(false);
      client.request({ callId: "late" }); release(); await abort; await running;
      expect(f.calls.filter(call => call.method === "tools.execute")).toHaveLength(1);
      expect(f.events.find(e => e.event.type === "error").event.error.code).toBe("TURN_ABORTED");
      expect(f.checkpoint?.synchronized).toBe(false);
    } finally { await f.cleanup(); }
  });
  it('resumes acknowledged idle interruption but rejects missing/late/foreign ack and failed checkpoint save',async()=>{
    for(const variant of ['ack','missing','late','foreign','save-failed']){
      const f=await fixture();try{
        const {runtime,client,ready}=f.make();const running=runtime.prompt({text:'continue'},'user','n1');await ready;await next();
        const original=client.call.bind(client);client.call=async(method,params)=>{
          if(method==='turn/interrupt'&&variant!=='missing'&&variant!=='late')client.notify('turn/completed',{turn:{id:variant==='foreign'?'other':'turn-cli',status:'interrupted'}});
          return original(method,params);
        };
        if(variant==='save-failed')f.rejectSaves();
        await runtime.abort();await running;
        if(variant==='late')client.notify('turn/completed',{turn:{id:'turn-cli',status:'interrupted'}});
        expect(f.checkpoint?.synchronized).toBe(variant==='ack');
        if(variant==='save-failed')expect(f.events.find(e=>e.event.type==='error').event.error.code).toBe('CODEX_CHECKPOINT_PERSIST_FAILED');
        if(variant==='ack'){
          const second=f.make();const resumed=second.runtime.prompt({text:'next'},'user','n2');await second.ready;
          expect(second.client.calls[0].method).toBe('thread/resume');expect(second.client.calls.some(c=>c.method==='thread/inject_items')).toBe(false);
          await second.runtime.abort();await resumed;
        }
      }finally{await f.cleanup();}
    }
  });
  it('an interrupted acknowledgement with a pending tool cannot synchronize the native tail',async()=>{
    const f=await fixture();let release!:()=>void;f.execute=async()=>{await new Promise<void>(resolve=>{release=resolve;});return {ok:true,content:'late'};};
    try{
      const {runtime,client,ready}=f.make();const running=runtime.prompt({text:'continue'},'user','n1');await ready;await next();
      client.request();await next();const original=client.call.bind(client);client.call=async(method,params)=>{
        if(method==='turn/interrupt')client.notify('turn/completed',{turn:{id:'turn-cli',status:'interrupted'}});return original(method,params);
      };
      const aborted=runtime.abort();await next();release();await aborted;await running;
      expect(f.checkpoint?.synchronized).toBe(false);
    }finally{await f.cleanup();}
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
  it('retains bound notification/terminal errors and excludes the actual context-window usage marker',async()=>{
    const f=await fixture();
    try{
      const {runtime,client,ready}=f.make();const running=runtime.prompt({text:'continue'},'current','native');await ready;
      client.notify('error',{turnId:'foreign',error:{message:'foreign-message',codexErrorInfo:'badRequest'},willRetry:false});
      const marker={inputTokens:0,outputTokens:0,totalTokens:522500,cachedInputTokens:0,cacheWriteInputTokens:0,reasoningOutputTokens:0};
      client.notify('thread/tokenUsage/updated',{tokenUsage:{total:marker,last:marker,modelContextWindow:522500}});
      expect(runtime.getStatus().transportUsage).toBeUndefined();
      client.notify('error',{error:{message:'Context full Bearer hidden-secret',codexErrorInfo:'contextWindowExceeded',additionalDetails:'account=user@example.com'},willRetry:false});
      client.notify('turn/completed',{turn:{id:'turn-cli',status:'failed',error:{message:'Context full',codexErrorInfo:'contextWindowExceeded'}}});await running;
      const terminal=f.events.find(e=>e.event.type==='error').event.error;
      expect(terminal.code).toBe('CODEX_TURN_FAILED');
      expect(terminal.details).toMatchObject({stage:'model-turn',usageSignal:{kind:'context-window-marker',notTokenUsage:true,modelContextWindow:522500},notificationError:{codexErrorInfo:'contextWindowExceeded',willRetry:false},terminalError:{codexErrorInfo:'contextWindowExceeded'}});
      for(const secret of ['foreign-message','hidden-secret','user@example.com'])expect(JSON.stringify(terminal)).not.toContain(secret);
      const message=f.events.find(e=>e.event.type==='message_end').event.message;
      expect(message.error.details).toEqual(terminal.details);expect(message.usage).toBeUndefined();
      expect(f.checkpoint?.usageTotal).toBeUndefined();
      expect(codexTurnUsage(marker,{inputTokens:0,outputTokens:0,totalTokens:0})).toBeUndefined();
    }finally{await f.cleanup();}
  });
  it('an async retry notification does not terminate a turn that later succeeds',async()=>{
    const f=await fixture();try{
      const {runtime,client,ready}=f.make();const running=runtime.prompt({text:'continue'},'current','native');await ready;
      client.notify('error',{error:{message:'Temporary disconnect',codexErrorInfo:{responseStreamDisconnected:{httpStatusCode:502}}},willRetry:true});
      expect(runtime.getStatus().isRunning).toBe(true);
      client.notify('turn/completed',{turn:{id:'turn-cli',status:'completed'}});await running;
      expect(f.events.some(e=>e.event.type==='error')).toBe(false);
    }finally{await f.cleanup();}
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
