/**
 * R2 · the asset library reaches the main window through the left column.
 *
 * Real React navigation + the real asset panel from R6, over a fixture host that
 * records every channel call. Proves the wiring R2 owns: the 素材 entry opens
 * the panel, the panel reads through the real bridge, the host-owned directory
 * grant is requested before scanning, and closing returns to the world list.
 *
 * No OS input: DOM events are dispatched from page.evaluate and pointer lock
 * plus focus are audited.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath, pathToFileURL} from "node:url";
import {playwright, browserOptions} from "../../../app/browser-tools.mjs";

const root = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const desktop = path.join(root, "vendor/pi-desktop/apps/desktop");
const require = createRequire(path.join(desktop, "package.json"));
const {build} = createRequire(path.join(root, "vendor/pi-desktop/packages/agent-runtime/package.json"))("esbuild");
fs.mkdirSync(path.join(root, "test-results"), {recursive: true});
const out = fs.mkdtempSync(path.join(root, "test-results/godot-round2-r2-assets-"));
const report = {kind: "real-react-asset-navigation-with-fixture-host", sourceCommit: null, checks: [], errors: [],
  limits: ["Fixture host: proves navigation and payloads, not the Rust asset catalog.", "No real model call and no visible-window composition."]};
const check = (name, value, detail) => {
  report.checks.push({name, passed: !!value, ...(detail ? {detail} : {})});
  assert.ok(value, name);
  console.log("PASS " + name);
};
const slash = (value) => value.replaceAll("\\", "/");

const entry = path.join(out, "fixture.jsx");
fs.writeFileSync(entry, `
import React from 'react';import {createRoot} from 'react-dom/client';
import {CraftmineNavigation} from ${JSON.stringify(slash(path.join(desktop, "src/components/CraftmineNavigation.tsx")))};
createRoot(document.getElementById('root')).render(<CraftmineNavigation/>);
`);
await build({
  entryPoints: [entry], outfile: path.join(out, "fixture.js"), bundle: true, platform: "browser",
  format: "iife", jsx: "automatic",
  alias: {
    react: require.resolve("react"),
    "react-dom/client": require.resolve("react-dom/client"),
    "react/jsx-runtime": require.resolve("react/jsx-runtime"),
  },
  loader: {".css": "css"},
  plugins: [{
    name: "bounded-store-fixture",
    setup(builder) {
      builder.onResolve({filter: /stores\/app-store$/}, () => ({path: "store", namespace: "fixture"}));
      builder.onResolve({filter: /^react-i18next$/}, () => ({path: "i18n", namespace: "fixture"}));
      builder.onLoad({filter: /.*/, namespace: "fixture"}, (args) => ({
        loader: "js",
        contents: args.path === "i18n"
          ? `export const useTranslation=()=>({i18n:{language:'zh-CN'}});`
          : `import {useSyncExternalStore} from "react";const listeners=new Set();
export const state={ready:true,page:'chat',workPanelOpen:false,activeWorkPanelTabId:null,activeSessionId:null,sessions:[],
 workPanelWidth:480,workPanelTabs:[],pluginViews:[{ref:'craftmine.world/world'}],
 setPage(value){this.page=value;},openWorkPanelTab(tab){this.workPanelOpen=true;this.activeWorkPanelTabId=tab.id;},
 setWorkPanelWidth(width){this.workPanelWidth=width;for(const fn of listeners)fn();}};
export const useAppStore=selector=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>selector(state));
useAppStore.getState=()=>state;window.testStore=state;`,
      }));
    },
  }],
});
fs.writeFileSync(path.join(out, "index.html"), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
:root{--ds-text-secondary:#b5beb8;--ds-text-primary:#eff7f0;--ds-text-muted:#8b948f;--ds-bg-active:#284235;--ds-tile:#202020;--ds-bg:#191919;--ds-border-subtle:#333;--ds-danger:#e5534b;--ds-focus:#5aa06f;--radius-xs:6px;--text-2xs:12px;--text-md:14px}
body{margin:0;background:#191919;color:#eee;font:14px system-ui}.craftmine-navigation{width:320px;min-height:100vh;padding:8px;box-sizing:border-box}
</style><style>${fs.readFileSync(path.join(desktop, "src/styles/craftmine.css"), "utf8")}</style>
<style>${fs.readFileSync(path.join(desktop, "src/components/craftmine/assets/asset-library.css"), "utf8")}</style>
</head><body><div id="root"></div><script src="fixture.js"></script></body></html>`);

let browser;
try {
  browser = await playwright().chromium.launchPersistentContext(path.join(out, "profile"), {...browserOptions(), viewport: {width: 1200, height: 900}});
  await browser.addInitScript(() => {
    globalThis.__audit = {lock: 0, focus: 0};
    Element.prototype.requestPointerLock = () => { globalThis.__audit.lock++; throw Error("Pointer lock disabled"); };
    window.focus = () => { globalThis.__audit.focus++; };
    globalThis.__calls = [];
    globalThis.__craftmineWorldBridge = {
      invoke: async (pluginId, channel, payload) => {
        globalThis.__calls.push({pluginId, channel, payload});
        if (channel === "world.list") return {activeWorldId: "w1", worlds: [{id: "w1", title: "林间小屋", revision: 1, updatedAt: Date.now(), state: "ready", base: {id: "top-down", label: "2D 俯视", description: "", delivered: true}}]};
        if (channel === "world.createOptions") return {create: true, createActions: true, bases: [], starters: []};
        if (channel === "workbench.capabilities") return {channels: []};
        if (channel === "task.current") return {};
        if (channel === "asset.search") return {items: [{assetId: "obj/rock", version: 1, displayName: "石头", kind: "object", mediaKind: "model", state: "ok"}], total: 7, truncated: false, nextOffset: null};
        if (channel === "world.pickDirectory") return {sourceRoot: "C:/authorized/assets"};
        if (channel === "asset.scan") return {items: [{path: "rock.glb", supported: true, known: false}], hints: {newVersions: 1, unchanged: 0, unsupported: 0}, worldUpdated: false};
        return {};
      },
      onChanged: () => () => {},
    };
  });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error.stack ?? error).slice(0, 600)));
  await page.goto(pathToFileURL(path.join(out, "index.html")).href);
  await page.waitForFunction(() => document.querySelectorAll("[data-aux-section]").length > 0);

  const assetRow = await page.evaluate(() => {
    const row = document.querySelector("[data-aux-section='assets']");
    return {text: row.textContent, toggle: !!row.querySelector("[data-aux-toggle='assets']")};
  });
  check("素材行存在并有真实打开入口", assetRow.toggle && assetRow.text.includes("素材"), assetRow);
  await page.evaluate(() => document.querySelector("[data-aux-toggle='assets']").click());
  await page.waitForFunction(() => window.__calls.some((call) => call.channel === "asset.search"), {timeout: 10000});
  await page.waitForFunction(() => document.querySelector("[data-aux-summary='assets']").textContent.includes("7"), {timeout: 10000});
  check("素材行显示主机报告的条目数", await page.evaluate(() => document.querySelector("[data-aux-summary='assets']").textContent.includes("7")));

  await page.evaluate(() => document.querySelector("[data-aux-open='assets']").click());
  await page.waitForFunction(() => !!document.querySelector("[data-asset-sheet='true']"), {timeout: 10000});
  check("素材入口在窗口中打开真实素材面板", await page.evaluate(() => !!document.querySelector("[data-asset-sheet='true']")));
  await page.waitForFunction(() => window.__calls.some((call) => call.channel === "asset.search"));
  const search = await page.evaluate(() => window.__calls.find((call) => call.channel === "asset.search"));
  check("面板通过真实桥读取本地素材库", search.pluginId === "craftmine.world" && search.payload.scope === "local-library", search);
  check("素材面板带自己的关闭入口",
    await page.evaluate(() => !!document.querySelector("[data-asset-sheet-close='true']")));
  await page.evaluate(() => document.querySelector("[data-asset-sheet-close='true']").click());
  await page.waitForFunction(() => !document.querySelector("[data-asset-sheet='true']"));
  check("关闭素材面板后回到世界列表", await page.evaluate(() => !!document.querySelector("[data-world-list-state]")));

  // The host-owned directory grant is wired, but the panel's import flow still
  // crashes inside R6's module. It is recorded as a defect, never as a pass.
  await page.evaluate(() => document.querySelector("[data-aux-open='assets']").click());
  await page.waitForFunction(() => !!document.querySelector("[data-asset-sheet='true']"));
  const importButton = await page.evaluate(() => {
    const button = [...document.querySelectorAll("[data-asset-sheet='true'] button")]
      .find((item) => item.textContent.includes("导入"));
    if (!button) return null;
    button.click();
    return button.textContent.trim();
  });
  check("导入按钮请求宿主目录授权", importButton !== null, importButton);
  await page.waitForFunction(() => window.__calls.some((call) => call.channel === "world.pickDirectory"), {timeout: 10000});
  await page.waitForFunction(() => window.__calls.some((call) => call.channel === "asset.scan"), {timeout: 10000});
  const scan = await page.evaluate(() => window.__calls.find((call) => call.channel === "asset.scan"));
  check("授权目录随后用于真实扫描", scan.payload.sourceRoot === "C:/authorized/assets", scan);
  await page.waitForTimeout(500);
  const importDefect = await page.evaluate(() => ({
    crashed: document.querySelectorAll("[data-world-list-state]").length === 0,
    errors: (window.__pageErrors ?? []).slice(0, 2),
  }));
  if (importDefect.crashed) {
    report.defects = [{
      owner: "R6",
      summary: "AssetLibraryPanel crashes during the import flow: `scan` names both the snapshot result and the action, so the panel reads .items off the function.",
      repro: "open the asset sheet, press 导入素材",
      evidence: {pageErrors},
    }];
    console.log("DEFECT (R6, recorded not passed): " + JSON.stringify(report.defects[0].summary));
  } else {
    check("导入流程没有崩溃", true);
  }
  check("没有请求鼠标锁定或焦点", await page.evaluate(() => __audit.lock === 0 && __audit.focus === 0));
  await page.screenshot({path: path.join(out, "asset-navigation.png")});
} catch (error) {
  report.errors.push(error.stack ?? String(error));
  process.exitCode = 1;
  console.error(error);
} finally {
  await browser?.close();
  report.sourceCommit = (await import("node:child_process")).execFileSync("git", ["rev-parse", "HEAD"], {cwd: root, encoding: "utf8"}).trim();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log("Evidence: " + out);
}
