import assert from "node:assert/strict";
import Module, { register } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { resolveCraftmineConfiguredBudget, calculateContextUsage } = await import("../src/lib/context-usage.ts");
const { latestTurnContextInspector } = await import("../src/lib/latest-turn-context.ts");
const selection = { worldCreation: true, codex: false, providerId: "deepseek", modelId: "deepseek-flash", usageProviderId: "deepseek", usageModelId: "deepseek-flash" };
const providers = [{ id: "deepseek", models: [{ id: "deepseek-flash", contextWindow: 500000, maxTokens: 384000 }] }];
const usage = { inputTokens: 10000, outputTokens: 5000, totalTokens: 15000 };
const row = { id: "one", role: "assistant", content: "Done", createdAt: "2026-09-14T00:00:00Z", status: "complete", providerId: "deepseek", modelId: "deepseek-flash", usage };

test("world PI budget preserves the actual bound configuration without changing the reported ring", () => {
  const result = resolveCraftmineConfiguredBudget(selection, {}, providers);
  assert.equal(result.maxOutputTokens, 384000);
  assert.equal(result.inputCapacity, 113952);
  assert.equal(result.compactionThreshold, 96859);
  assert.equal(calculateContextUsage(usage, result.contextWindow).remainingPercent, 97);
  const inspector = latestTurnContextInspector([row], {}, providers);
  assert.equal(inspector.usageProviderId, "deepseek"); assert.equal(inspector.usageModelId, "deepseek-flash");
  assert.deepEqual(inspector.usage, usage);
});

for (const override of [
  { worldCreation: false }, { codex: true }, { usageProviderId: "codex-cli" },
  { usageProviderId: "another-endpoint" }, { usageModelId: "another-model" },
  { usageProviderId: undefined }, { usageModelId: undefined },
]) test(`hides configuration for unmatched scope ${JSON.stringify(override)}`, () => {
  assert.equal(resolveCraftmineConfiguredBudget({ ...selection, ...override }, {}, providers), undefined);
});

test("missing bindings or invalid output limits never fall back to cumulative usage or catalog output", () => {
  assert.equal(resolveCraftmineConfiguredBudget(selection, {}, [{ id: "deepseek", models: [] }]), undefined);
  const catalog = { deepseek: [{ modelId: "deepseek-flash", maxTokens: 999999, contextWindow: 1000000 }] };
  assert.equal(resolveCraftmineConfiguredBudget(selection, catalog, providers).maxOutputTokens, 384000);
  assert.equal(resolveCraftmineConfiguredBudget(selection, catalog, [{ id: "deepseek", models: [{ ...providers[0].models[0], maxTokens: NaN }] }]), undefined);
});

const component = fileURLToPath(new URL("../src/components/ContextUsageInspector.tsx", import.meta.url));
const translations = fileURLToPath(new URL("../../../packages/i18n/src/locales/player-budget.ts", import.meta.url));
const bundle = await build({ stdin: { contents: `
  import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
  import {ConfiguredContextBudget,ContextUsageInspector} from ${JSON.stringify(component)};
  import {setLanguage} from 'react-i18next';
  export const render=(budget,language)=>{setLanguage(language);return renderToStaticMarkup(React.createElement(ConfiguredContextBudget,{budget}));};
  export const ring=(usage,language)=>{setLanguage(language);return renderToStaticMarkup(React.createElement(ContextUsageInspector,{usage,turnUsage:usage,contextWindow:500000,tools:[]}));};
`, resolveDir: fileURLToPath(new URL("..", import.meta.url)) }, bundle: true, write: false, format: "cjs", platform: "node", jsx: "automatic", plugins: [{ name: "isolated-context-inspector", setup(b) {
  b.onResolve({ filter: /^(react-i18next)$|stores\/app-store$/ }, args => ({ path: args.path, namespace: "fixture" }));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "react-i18next" ? `
    import {playerBudgetEn,playerBudgetZhCN} from ${JSON.stringify(translations)};
    let language='en';export const setLanguage=value=>{language=value};
    export const useTranslation=()=>({t:(key,args={})=>Object.entries(args).reduce((text,[name,value])=>text.replaceAll('{{'+name+'}}',String(value)),(language==='zh-CN'?playerBudgetZhCN:playerBudgetEn)[key.replace('playerBudget.','')]??key)});
  ` : `export const useAppStore=()=>undefined;`, loader: "js", resolveDir: fileURLToPath(new URL("..", import.meta.url)) }));
} }] });
const compiled = new Module(component); compiled.filename = component;
compiled.paths = Module._nodeModulePaths(fileURLToPath(new URL("..", import.meta.url)));
compiled._compile(bundle.outputFiles[0].text, component);

test("rendered Chinese and English separate configuration estimates from the unchanged 97% ring", () => {
  const budget = resolveCraftmineConfiguredBudget(selection, {}, providers);
  for (const language of ["en", "zh-CN"]) {
    const html = compiled.exports.render(budget, language);
    assert.match(html, /384k/); assert.match(html, /≈114k/); assert.match(html, /≈97k/);
    assert.match(html, language === "en" ? /not live occupancy/ : /非实时占用/);
    assert.match(html, language === "en" ? /tools and world information/ : /工具和世界信息/);
    const ring = compiled.exports.ring(usage, language);
    assert.match(ring, />97%<\/span>/);
    assert.match(ring, language === "en" ? /Last request window remaining/ : /上次请求的窗口剩余/);
  }
});
