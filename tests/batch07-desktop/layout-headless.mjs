import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {playwright,browserOptions} from '../../app/browser-tools.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),desktop=path.join(root,'vendor/pi-desktop/apps/desktop');
const require=createRequire(path.join(desktop,'package.json')),{build}=createRequire(path.join(root,'vendor/pi-desktop/packages/agent-runtime/package.json'))('esbuild');
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});const out=fs.mkdtempSync(path.join(root,'test-results/batch07-layout-'));
const slash=value=>value.replaceAll('\\','/'),component=slash(path.join(desktop,'src/components/CraftmineLayoutControls.tsx')),layout=slash(path.join(desktop,'src/lib/craftmine-layout.ts'));
const immersion=slash(path.join(desktop,'src/lib/use-craftmine-immersion.ts'));
const entry=path.join(out,'fixture.jsx');fs.writeFileSync(entry,`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {CraftmineLayoutControls} from ${JSON.stringify(component)};import * as layout from ${JSON.stringify(layout)};import {useCraftmineImmersion} from ${JSON.stringify(immersion)};window.layout=layout;function Fixture(){const [view,setView]=useState({page:'chat',open:true,tab:'plugin:craftmine.world/world'});window.setView=setView;const immersive=useCraftmineImmersion(view.page,view.open,view.tab);return <div className={'app-shell'+(immersive?' craftmine-play':'')}><aside className="sidebar">Original sessions</aside><section className="main-pane"><textarea defaultValue="Unsaved conversation"/></section><aside className="work-panel" style={{width:480}}><div className="work-panel-header"><CraftmineLayoutControls/></div><div className="world-surface">World surface fixture</div></aside></div>;}createRoot(document.getElementById('root')).render(<Fixture/>);`);
await build({entryPoints:[entry],outfile:path.join(out,'fixture.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',alias:{react:require.resolve('react'),'react-dom/client':require.resolve('react-dom/client'),'react/jsx-runtime':require.resolve('react/jsx-runtime')},plugins:[{name:'bounded-store-fixture',setup(builder){
  builder.onResolve({filter:/stores\/app-store$/},()=>({path:'store',namespace:'fixture'}));builder.onResolve({filter:/^react-i18next$/},()=>({path:'i18n',namespace:'fixture'}));
  builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',contents:args.path==='i18n'?`export const useTranslation=()=>({i18n:{language:'zh-CN'}});`:`import {useSyncExternalStore} from "react";const listeners=new Set();export const state={workPanelWidth:480,page:'chat',activeSessionId:'kept-session',tabs:['file','review'],setPage(value){this.page=value;},openWorkPanelTab(tab){if(!this.tabs.includes(tab.id))this.tabs.push(tab.id);},setWorkPanelWidth(width){this.workPanelWidth=width;window.layout.rememberCraftmineWidth(localStorage,width);for(const fn of listeners)fn();}};export const useAppStore=selector=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>selector(state));useAppStore.getState=()=>state;window.testStore=state;`}));
}}]});
fs.writeFileSync(path.join(out,'index.html'),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>:root{--ds-text-secondary:#b5beb8;--ds-text-primary:#eff7f0;--ds-bg-active:#284235;--radius-xs:6px;--text-2xs:13px}body{margin:0;background:#191919;color:#eee;font:14px system-ui}.app-shell{display:flex;width:100vw;height:100vh}.sidebar{width:100px}.main-pane{flex:1}.work-panel{flex-shrink:0}.work-panel-header{display:flex}.world-surface{height:200px}button{cursor:pointer}h1{font-size:16px}${fs.readFileSync(path.join(desktop,'src/styles/work-panel.css'),'utf8')}${fs.readFileSync(path.join(desktop,'src/styles/craftmine.css'),'utf8')}</style></head><body><h1>工作台布局 · React 组件夹具</h1><div id="root"></div><script src="fixture.js"></script></body></html>`);
const report={kind:'actual-react-layout-with-store-fixture',sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),checks:[],errors:[]};
const check=(name,value)=>{report.checks.push({name,passed:!!value});assert.ok(value,name);console.log('PASS '+name);};let context;
try{
  context=await playwright().chromium.launchPersistentContext(path.join(out,'profile'),{...browserOptions(),viewport:{width:1280,height:600}});await context.addInitScript(()=>{window.__audit={lock:0,focus:0};Element.prototype.requestPointerLock=()=>{__audit.lock++;throw Error('Input lock disabled');};window.focus=()=>{__audit.focus++;};HTMLElement.prototype.focus=function(){__audit.focus++;};});
  const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));await page.goto(pathToFileURL(path.join(out,'index.html')).href);await page.waitForFunction(()=>document.querySelectorAll('form').length===2);
  await page.evaluate(()=>document.querySelectorAll('form')[1].requestSubmit());
  check('play mode uses the existing work panel with wider saved size',await page.evaluate(()=>testStore.workPanelWidth===720&&layout.loadCraftmineLayout(localStorage).mode==='play'));
  await page.waitForFunction(()=>document.querySelector('.app-shell.craftmine-play'));
  check('play fills the actual available workspace and hides mounted chat',await page.evaluate(()=>Math.abs(document.querySelector('.work-panel').getBoundingClientRect().width-innerWidth)<1&&getComputedStyle(document.querySelector('.main-pane')).display==='none'&&document.querySelector('textarea').value==='Unsaved conversation'));
  await page.evaluate(()=>setView({page:'settings',open:true,tab:'plugin:craftmine.world/world'}));await page.waitForFunction(()=>!document.querySelector('.craftmine-play'));
  check('settings exits immersion without changing saved play preference',await page.evaluate(()=>layout.loadCraftmineLayout(localStorage).mode==='play'));
  await page.evaluate(()=>setView({page:'chat',open:true,tab:'file:notes'}));await page.waitForFunction(()=>!document.querySelector('.craftmine-play'));
  check('other PI workpanel tabs keep ordinary desktop layout',await page.evaluate(()=>getComputedStyle(document.querySelector('.main-pane')).display!=='none'));
  await page.evaluate(()=>setView({page:'chat',open:true,tab:'plugin:craftmine.world/world'}));await page.waitForFunction(()=>document.querySelector('.craftmine-play'));
  await page.evaluate(()=>testStore.setWorkPanelWidth(670));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
  await page.evaluate(()=>document.querySelectorAll('form')[0].requestSubmit());
  check('returning to creation restores its previous size',await page.evaluate(()=>testStore.workPanelWidth===480&&layout.loadCraftmineLayout(localStorage).widths.play===670));
  check('layout switch preserves session and other resource tabs',await page.evaluate(()=>testStore.activeSessionId==='kept-session'&&testStore.tabs.includes('file')&&testStore.tabs.includes('review')));
  await page.evaluate(()=>document.querySelectorAll('form')[1].requestSubmit());await page.reload();await page.waitForFunction(()=>document.querySelectorAll('form').length===2);
  check('layout preference persists after renderer reload',await page.evaluate(()=>layout.loadCraftmineLayout(localStorage).mode==='play'&&layout.loadCraftmineLayout(localStorage).widths.play===670));
  await page.setViewportSize({width:560,height:600});await page.evaluate(()=>document.documentElement.dataset.theme='light');
  check('narrow light appearance preserves full workspace and return action',await page.evaluate(()=>Math.abs(document.querySelector('.work-panel').getBoundingClientRect().width-innerWidth)<1&&document.querySelector('button').textContent.includes('回到创作')&&getComputedStyle(document.querySelector('.work-panel-header')).backgroundColor==='rgb(255, 255, 255)'));
  const clamps=await page.evaluate(()=>[layout.loadCraftmineLayout({getItem:()=>'{"widths":{"create":-8,"play":999999}}'}),layout.loadCraftmineLayout({getItem:()=>'{broken'})]);
  check('corrupt or unsafe stored widths use bounded defaults',clamps[0].widths.create===244&&clamps[0].widths.play===720&&clamps[1].widths.create===480);
  await page.screenshot({path:path.join(out,'react-layout.png')});
  check('no pointer lock focus or component errors',await page.evaluate(()=>__audit.lock===0&&__audit.focus===0)&&report.errors.length===0);
}catch(error){report.errors.push(error.stack);process.exitCode=1;console.error(error.message);}
finally{await context?.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log('Evidence: '+out);}
