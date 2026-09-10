// Actual navigation/forms and finite helper over a bounded transport fixture.
// The separate asset-main-route test covers actual Main functions and Core.
import {createHash} from "node:crypto";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {register,createRequire} from "node:module";
import {fileURLToPath, pathToFileURL} from "node:url";
import {playwright, browserOptions} from "../../app/browser-tools.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const desktop = path.join(root, "vendor/pi-desktop/apps/desktop");
const require = createRequire(path.join(process.env.ASSET_TEST_DEPS, "package.json"));
const {build} = require("esbuild");
fs.mkdirSync(path.join(root, "test-results"), {recursive: true});
const out = fs.mkdtempSync(path.join(root, "test-results/asset-forms-"));
const report = {kind: "actual-navigation-forms-finite-probe-with-fixture-host", sourceCommit: null, checks: [], errors: [],
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
  nodePaths: [path.join(process.env.ASSET_TEST_DEPS,"node_modules")],
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


register(new URL("../../vendor/pi-desktop/apps/desktop/test/helpers/ts-import-hooks.mjs",import.meta.url));
const {assetsProbeScript,unwrapAssetsProbeResult}=await import("../../vendor/pi-desktop/apps/desktop/electron/main/craftmine-assets-acceptance.ts");
report.sourceFiles = ["electron/main/craftmine-assets-acceptance.ts", "src/components/CraftmineNavigation.tsx", "src/components/craftmine/WorldAuxSections.tsx", "src/components/craftmine/assets/AssetLibraryPanel.tsx", "src/components/craftmine/assets/AssetAnnotationEditor.tsx"].map(file=>({path:"vendor/pi-desktop/apps/desktop/"+file,sha256:createHash("sha256").update(fs.readFileSync(path.join(desktop,file))).digest("hex")}));
let browser;
try {
 browser=await playwright().chromium.launchPersistentContext(path.join(out,'profile'),{...browserOptions(),viewport:{width:1200,height:900}});
 await browser.addInitScript(()=>{
  globalThis.__craftmineHeadless={focus:0,pointerLock:0};window.focus=()=>{__craftmineHeadless.focus++;};HTMLElement.prototype.focus=()=>{__craftmineHeadless.focus++;};Element.prototype.requestPointerLock=()=>{__craftmineHeadless.pointerLock++;throw Error('DENIED');};
  const metadata={'asset-a':{favorite:false,tags:[]},'asset-b':{favorite:false,tags:[]}};
  const body=id=>({assetId:id,version:1,kind:'raw',mediaKind:'image',displayName:id,contentHash:'a'.repeat(64),bytes:2,fileCount:0,files:[],source:{origin:'fixture',author:'test',license:'unknown',licenseStatus:'unverified'}});
  globalThis.__calls=[];
  const previews={};
  globalThis.__craftmineWorldBridge={invoke:async(pluginId,channel,payload)=>{
   __calls.push({channel,payload});
   if(channel==='world.list')return {activeWorldId:'w1',worlds:[{id:'w1',title:'Fixture',revision:1,state:'ready'}]};
   if(channel==='world.createOptions')return {create:true,bases:[],starters:[]};
   if(channel==='workbench.capabilities')return {channels:[]};
   if(channel==='task.current')return {};
   if(channel==='world.pickDirectory')return {sourceRoot:'D:/owned-fixture-assets'};
   if(channel.startsWith('asset.')){if(payload.ownerWorldId!=='w1')throw Error('OWNER_MISSING');}
   if(channel==='asset.search')return {items:Object.keys(metadata).map(id=>({...body(id),...metadata[id],state:{indexed:true}})).filter(a=>!payload.favoritesOnly||a.favorite),total:2,nextOffset:null};
   if(channel==='asset.read')return {version_:body(payload.assetId),state:{indexed:true}};
   if(channel==='asset.versions')return {items:[{version_:body(payload.assetId),state:{indexed:true}}],nextOffset:null};
   if(channel==='asset.scan')return {root:'D:/owned-fixture-assets',scanned:1,truncated:false,items:[{path:'fixture.png',bytes:2,supported:true,mediaType:'image/png',known:false}],hints:{newVersions:1,unchanged:0,unsupported:0}};
   if(channel==='asset.import'){if(payload.sourcePath!=='D:/owned-fixture-assets/fixture.png')throw Error('EMPTY_OR_WRONG_IMPORT_PATH');metadata[payload.assetId]={favorite:false,tags:[]};return {assetId:payload.assetId,version:1,contentHash:'b'.repeat(64),version_:{displayName:payload.displayName}};}
   if(channel==='asset.preview'){previews[payload.assetId]={status:'ok',detail:'fixture decoder only',facts:{picture:true,width:1,height:1}};return previews[payload.assetId];}
   if(channel==='asset.previewRead')return {items:previews[payload.assetId]?[previews[payload.assetId]]:[]};
   if(channel==='asset.usage')return {items:[]};
   if(channel==='asset.annotate'){const m=metadata[payload.assetId];if(payload.favorite!==undefined)m.favorite=payload.favorite;if(payload.tags!==undefined)m.tags=payload.tags;return {assetId:payload.assetId,operationId:payload.operationId,metadata:{...m}};}
   throw Error('UNEXPECTED_CHANNEL '+channel);
  },onChanged:()=>()=>{}};
 });
 const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));await page.route(/^https?:/,r=>r.abort());await page.goto(pathToFileURL(path.join(out,'index.html')).href);
 const probe=(action,rest={})=>page.evaluate(assetsProbeScript({action,ownerWorldId:'w1',...rest})).then(unwrapAssetsProbeResult);
 const until=async(fn,predicate)=>{for(let n=0;n<100;n++){const value=await fn();if(predicate(value))return value;await new Promise(r=>setTimeout(r,20));}throw Error('DOM_NOT_SETTLED');};
 await page.waitForFunction(()=>!!document.querySelector('[data-world-active="true"]'));
 await assert.rejects(probe('read',{ownerWorldId:'other'}),/OWNER_CHANGED/);check('old owner rejected',true);
 await until(()=>probe('open'),r=>r.open);let state=await until(()=>probe('read'),r=>r.cards.length===2);check('actual auxiliary forms open actual navigation sheet',state.open);
 await assert.rejects(probe('select',{assetId:'not-observed',version:1}),/UNOBSERVED/);check('selection restricted to observed cards',true);
 await probe('select',{assetId:'asset-a',version:1});await until(()=>probe('read'),r=>r.selected?.assetId==='asset-a');
 await probe('favorite',{assetId:'asset-a'});state=await until(()=>probe('read'),r=>r.selected?.favorite&&!r.selected.pending);check('real favorite form updates acknowledgement',state.selected.favorite);
 await probe('filter',{favoritesOnly:true});state=await until(()=>probe('read'),r=>r.cards.length===1);check('favorites filter uses actual form',state.cards[0].assetId==='asset-a');
 await probe('favorite',{assetId:'asset-a'});state=await until(()=>probe('read'),r=>!r.selected?.favorite&&r.cards.length===0);check('unfavorite removes filtered card with detail retained',state.selected.assetId==='asset-a');
 await probe('saveTags',{assetId:'asset-a',tags:['建筑','常用']});state=await until(()=>probe('read'),r=>r.selected?.tags==='常用, 建筑'&&!r.selected.pending);check('tag form uses submitted DOM value without React internals',!state.error);
  await assert.rejects(probe('favorite',{assetId:'asset-b'}),/UNOBSERVED/);check('other asset cannot be annotated',true);
  await probe('filter',{favoritesOnly:false});await until(()=>probe('read'),r=>r.cards.length===2);
  await probe('importPick');await until(()=>probe('read'),r=>r.import.ready);check('actual directory import form scans the host-picked root',true);
  assert.equal(await page.locator('[data-import-source-hint="true"]').textContent(), '作者或许可可留空，系统会记为“未知”；许可留空时不会标记为已验证。');
  await probe('importConfirm');state=await until(()=>probe('read'),r=>r.cards.length===3&&!!r.import.done);check('actual confirm form supplies the selected scan path for an empty picker file path',!state.error);
  const importedSource=await page.evaluate(()=>__calls.find(c=>c.channel==='asset.import').payload.source);
  assert.deepEqual(importedSource,{origin:'player-import',author:'unknown',license:'unknown',licenseStatus:'unknown'});check('blank provenance is explicitly unknown without claiming a licence grant',true);
  await probe('select',{assetId:'fixture.png',version:1});await until(()=>probe('read'),r=>r.selected?.assetId==='fixture.png');
  await assert.rejects(probe('preview',{assetId:'asset-a',version:1}),/UNOBSERVED/);check('preview refuses a nonselected asset',true);
  await assert.rejects(probe('preview',{assetId:'fixture.png',version:2}),/UNOBSERVED_VERSION/);check('preview refuses a different version of the same asset',true);
  await probe('preview',{assetId:'fixture.png',version:1});state=await until(()=>probe('read'),r=>r.preview.tone==='success');check('actual preview form shows acknowledged fixture preview without writing metadata',!state.error);
  assert.throws(()=>probe('importPick',{sourceRoot:'D:/untrusted'}),/INVALID_ASSET_PROBE/);check('finite import probe cannot supply a filesystem path',true);
 await probe('close');state=await until(()=>probe('read'),r=>!r.open);check('close form unmounts sheet',!state.open);check('no focus or pointer lock',state.guard.focus===0&&state.guard.pointerLock===0);
 report.calls=await page.evaluate(()=>__calls);assert.equal(report.calls.filter(c=>c.channel==='asset.annotate').length,3);assert.equal(report.errors.length,0);report.passed=true;
} catch(e){report.error=String(e.stack??e);process.exitCode=1;}
finally{await browser?.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.passed,error:report.error}));}
