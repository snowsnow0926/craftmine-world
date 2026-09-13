// Actual React usage projection with fixed protocol-shaped data; no model calls.
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';import {createRequire} from 'node:module';
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
