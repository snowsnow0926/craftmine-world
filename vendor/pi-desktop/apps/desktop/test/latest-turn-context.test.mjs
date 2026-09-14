import assert from "node:assert/strict";
import { register } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));
const { latestTurnContextInspector } = await import(
  "../src/lib/latest-turn-context.ts"
);

const providerModels = {
  provider: [
    {
      modelId: "catalog-model",
      displayName: "Catalog model",
      providerId: "provider",
      contextWindow: 256_000,
      capabilities: ["text"],
      source: "discovered",
    },
  ],
};
const providers = [{ id: "provider", contextWindow: 64_000, models: [] }];

test("Codex turn totals cannot masquerade as context occupancy or a generic provider window", () => {
  const aggregate={inputTokens:1000,outputTokens:100,cacheReadTokens:8000,totalTokens:9100};
  const row={id:"codex",role:"assistant",content:"Done",createdAt:"2026-09-13T00:00:00Z",status:"complete",providerId:"codex-cli",modelId:"gpt-6-astra",usage:aggregate};
  assert.equal(latestTurnContextInspector([row],{},[]),undefined);
  const last={inputTokens:100,outputTokens:10,cacheReadTokens:800,totalTokens:910};
  const actual=latestTurnContextInspector([{...row,codexUsage:{scope:"current-turn",lastRequest:last,modelContextWindow:1000000,cost:null}}],{},[]);
  assert.deepEqual(actual.usage,last);assert.deepEqual(actual.turnUsage,aggregate);assert.equal(actual.contextWindow,1000000);
});

test('legacy 033 capacity-only metadata is not projected as usage by the context inspector',()=>{
  const marker={inputTokens:0,outputTokens:0,cacheReadTokens:0,cacheWriteTokens:0,reasoningTokens:0,totalTokens:522500};
  const row={id:'legacy-033',role:'assistant',content:'',createdAt:'2026-09-14T02:16:35Z',status:'error',providerId:'codex-cli',modelId:'gpt-6-astra',usage:marker,
    codexUsage:{scope:'current-turn',cost:null,modelContextWindow:522500,lastRequest:marker}};
  const original=JSON.stringify(row);assert.equal(latestTurnContextInspector([row],{},[]),undefined);assert.equal(JSON.stringify(row),original);
});

function message(id, role, content, extra = {}) {
  return {
    id,
    role,
    content,
    createdAt: "2026-09-08T00:00:00.000Z",
    ...extra,
  };
}

test("latest turn inspector returns nothing without parent usage", () => {
  assert.equal(latestTurnContextInspector([], providerModels, providers), undefined);
  assert.equal(
    latestTurnContextInspector(
      [
        message("u1", "user", "hi"),
        message("a1", "assistant", "hello"),
        message("delegate", "assistant", "nested", {
          parentToolCallId: "task-1",
          usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
        }),
      ],
      providerModels,
      providers,
    ),
    undefined,
  );
});

test("latest turn inspector keeps the newest usage-bearing turn", () => {
  const completed = message("a1", "assistant", "hello", {
    createdAt: "2026-09-08T00:00:01.000Z",
    providerId: "provider",
    modelId: "catalog-model",
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    responseDurationMs: 1000,
    responseOutputTokens: 5,
  });
  const streaming = message("a2", "assistant", "partial", {
    createdAt: "2026-09-08T00:00:03.000Z",
    status: "streaming",
  });
  const inspector = latestTurnContextInspector(
    [
      message("u1", "user", "hi", { createdAt: "2026-09-08T00:00:00.000Z" }),
      completed,
      message("u2", "user", "again", { createdAt: "2026-09-08T00:00:02.000Z" }),
      streaming,
    ],
    providerModels,
    providers,
  );

  assert.equal(inspector?.usage.totalTokens, 15);
  assert.equal(inspector?.turnUsage.totalTokens, 15);
  assert.equal(inspector?.contextWindow, 256_000);
  assert.equal(inspector?.responseDurationMs, 1000);
  assert.equal(inspector?.tools.length, 0);
});

test("latest turn inspector ignores later subagent usage", () => {
  const inspector = latestTurnContextInspector(
    [
      message("u1", "user", "delegate"),
      message("a1", "assistant", "working", {
        providerId: "provider",
        modelId: "catalog-model",
        usage: { inputTokens: 80, outputTokens: 20, totalTokens: 100 },
        responseDurationMs: 2000,
        responseOutputTokens: 20,
      }),
      message("task", "tool", "spawned", {
        toolName: "Task",
        toolCallId: "task-1",
      }),
      message("delegate", "assistant", "done", {
        parentToolCallId: "task-1",
        providerId: "provider",
        modelId: "catalog-model",
        usage: { inputTokens: 4, outputTokens: 1, totalTokens: 5 },
        responseDurationMs: 100,
        responseOutputTokens: 1,
      }),
    ],
    providerModels,
    providers,
  );

  assert.equal(inspector?.usage.totalTokens, 100);
  assert.equal(inspector?.responseDurationMs, 2000);
  assert.equal(inspector?.tools.map((tool) => tool.toolName).join(","), "Task");
});

test("latest turn inspector keeps the usage-bearing turn's tools over a later stream", () => {
  const inspector = latestTurnContextInspector(
    [
      message("u1", "user", "read it"),
      message("a1", "assistant", "reading", {
        providerId: "provider",
        modelId: "catalog-model",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        responseDurationMs: 1000,
        responseOutputTokens: 5,
      }),
      message("read", "tool", "ok", { toolName: "Read", toolCallId: "read-1" }),
      message("u2", "user", "again"),
      message("a2", "assistant", "partial", { status: "streaming" }),
      message("bash", "tool", "", {
        toolName: "Bash",
        toolCallId: "bash-1",
        toolStatus: "running",
      }),
    ],
    providerModels,
    providers,
  );

  assert.equal(inspector?.usage.totalTokens, 15);
  assert.equal(inspector?.tools.map((tool) => tool.toolName).join(","), "Read");
  assert.equal(inspector?.responseDurationMs, 1000);
});

test("latest turn inspector does not merge compaction-split assistant turns", () => {
  const inspector = latestTurnContextInspector(
    [
      message("u1", "user", "overflow"),
      message("a1", "assistant", "failed", {
        providerId: "provider",
        modelId: "catalog-model",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      }),
      message("a2", "assistant", "retried", {
        providerId: "provider",
        modelId: "catalog-model",
        usage: { inputTokens: 20, outputTokens: 8, totalTokens: 28 },
        responseDurationMs: 1500,
        responseOutputTokens: 8,
      }),
    ],
    providerModels,
    providers,
    [
      {
        id: "mark-1",
        generation: 1,
        summaryTokens: 40,
        throughMessageId: "a1",
        summarized: true,
      },
    ],
  );

  assert.equal(inspector?.usage.totalTokens, 28);
  assert.equal(inspector?.turnUsage.totalTokens, 28);
  assert.equal(inspector?.responseDurationMs, 1500);
});
