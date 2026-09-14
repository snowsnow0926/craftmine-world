// Actual React usage projection with fixed protocol-shaped data; no model calls.
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';import {createRequire} from 'node:module';
import {codexUsageCoverageText} from '../vendor/pi-desktop/apps/desktop/src/lib/codex-usage-coverage.ts';
const root=path.resolve(import.meta.dirname,'..'),desktop=path.join(root,'vendor/pi-desktop/apps/desktop'),require=createRequire(path.join(desktop,'package.json'));
const out=await fs.mkdtemp(path.join(root,'test-results/codex-usage-test-'));
await require('esbuild').build({stdin:{contents:`import React from 'react';import{renderToStaticMarkup}from'react-dom/server';import{TaskMetricsView}from'./src/components/TaskMetrics';import i18n from'i18next';import{initReactI18next}from'react-i18next';await i18n.use(initReactI18next).init({lng:'en',resources:{en:{translation:{}}},initImmediate:false});export function render(props){return renderToStaticMarkup(<TaskMetricsView {...props}/>);}`,loader:'tsx',resolveDir:desktop},outfile:path.join(out,'fixture.mjs'),bundle:true,platform:'node',format:'esm',jsx:'automatic',loader:{'.css':'empty'},banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"}});
const {render}=await import(pathToFileURL(path.join(out,'fixture.mjs')));
test.after(()=>fs.rm(out,{recursive:true,force:true}));
test('Codex turn totals render with actual model and unknown request count/cost, not a false zero-call claim',()=>{
  const html=render({metrics:{status:'completed',turnId:'turn',wallTimeMs:1000,coverage:'unknown',usage:null,models:[],calls:{observed:0,reported:0,pending:0},tps:{value:null,coverage:'unknown'}},codex:{modelId:'gpt-6-astra',usage:{inputTokens:100,cacheReadTokens:800,outputTokens:10,totalTokens:910}}});
  assert.match(html,/data-metric="tokens">910/);assert.match(html,/data-metric="model"[^>]*>gpt-6-astra/);
  assert.match(html,/current-turn token totals/);assert.match(html,/cost are unavailable/);assert.doesNotMatch(html,/Reported calls: 0\/0/);
});
test('unreported maintenance keeps the total unknown even if a stale caller supplies a numeric usage',()=>{
  const html=render({metrics:{status:'completed',turnId:'turn',wallTimeMs:1000,coverage:'complete',usage:{inputTokens:0,outputTokens:0,totalTokens:0},models:[],calls:{observed:0,reported:0,pending:0},tps:{value:null,coverage:'unknown'}},codex:{modelId:'gpt-6-astra',usage:{inputTokens:0,outputTokens:0,totalTokens:0},coverage:{status:'incomplete',reason:'native-maintenance-usage-unreported',maintenanceTurns:3,maintenanceElapsedMs:521303,reportedCreationUsage:{inputTokens:5,outputTokens:1,totalTokens:6}}}});
  assert.match(html,/data-metric="tokens">—/);assert.match(html,/data-task-coverage="partial"/);
  assert.match(html,/CLI-reported creation counters: 6 tokens/);assert.match(html,/maintenance usage is unreported, so total usage is incomplete/);
  assert.doesNotMatch(html,/current-turn token totals|data-metric="tokens">0/);
});
test('the persisted 033 context-capacity marker is not displayed as consumed tokens and is never rewritten',()=>{
  const original={modelId:'gpt-6-astra',modelContextWindow:522500,usage:{inputTokens:0,outputTokens:0,cacheReadTokens:0,cacheWriteTokens:0,reasoningTokens:0,totalTokens:522500}};
  const before=JSON.stringify(original),html=render({metrics:null,codex:original});
  assert.match(html,/data-metric="tokens">—/);assert.match(html,/context capacity marker, not token consumption/);
  assert.doesNotMatch(html,/data-metric="tokens">522/);assert.equal(JSON.stringify(original),before);
});
test('Chinese coverage wording distinguishes unknown maintenance from reported creation counters',()=>{
  const coverage={status:'incomplete',reason:'native-maintenance-usage-unreported',maintenanceTurns:3,maintenanceElapsedMs:null};
  assert.match(codexUsageCoverageText(coverage,'zh-CN'),/创作计数：未报告；维护用量未报告，总量不完整/);
  assert.match(codexUsageCoverageText({...coverage,reportedCreationUsage:{inputTokens:5,outputTokens:1,totalTokens:6}},'zh-CN'),/创作计数：6 tokens；维护用量未报告，总量不完整/);
});
