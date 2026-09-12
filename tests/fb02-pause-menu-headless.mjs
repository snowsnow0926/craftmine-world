// Real React pause menu + immersion hook. Finite callbacks only, no native input.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {playwright,browserOptions} from '../app/browser-tools.mjs';
const desktop=path.resolve('vendor/pi-desktop/apps/desktop'),require=createRequire(path.join(desktop,'package.json'));
const {build}=require('esbuild'),out=fs.mkdtempSync(path.resolve('test-results/fb02-pause-'));
const report={checks:[],limits:['Real component, DOM and immersion hook with finite host fixture','No OS keyboard/mouse, pointer lock or activation; native compositing is tested separately']};
const entry=`import React,{useState,useRef,useCallback} from 'react';import {createRoot} from 'react-dom/client';
import {CraftminePauseMenu} from ${JSON.stringify(path.join(desktop,'src/components/CraftminePauseMenu.tsx'))};
import {useCraftmineLayout,useCraftmineImmersionSurface} from ${JSON.stringify(path.join(desktop,'src/lib/use-craftmine-immersion.ts'))};
localStorage.setItem('craftmine.desktop.layout.v1',JSON.stringify({mode:'play',overlay:'closed'}));
globalThis.fixture={hostStates:[],actions:[],listener:null};
function Fixture(){const [paused,setPaused]=useState(false),surface=useRef(null),layout=useCraftmineLayout();
const pause=useCallback(()=>setPaused(true),[]),resume=useCallback(()=>setPaused(false),[]);
useCraftmineImmersionSurface(true,layout.overlay,paused,surface,pause);
return <div data-overlay={layout.overlay} data-paused={String(paused)}><section ref={surface} role={layout.overlay==='closed'?undefined:'dialog'} hidden={layout.overlay==='closed'}>Chat overlay</section>{paused&&<CraftminePauseMenu onResume={resume} onWorkbench={()=>fixture.actions.push('workbench')} onSettings={()=>fixture.actions.push('settings')}/>}</div>}
createRoot(document.getElementById('root')).render(<Fixture/>);`;
await build({stdin:{contents:entry,resolveDir:desktop,loader:'tsx'},outfile:path.join(out,'fixture.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',plugins:[{name:'finite-host',setup(b){
  b.onResolve({filter:/^(react|react-dom)(\/.*)?$/},args=>({path:require.resolve(args.path)}));
  b.onResolve({filter:/(^|\/)api$/},()=>({path:'api',namespace:'fixture'}));
  b.onResolve({filter:/stores\/app-store$/},()=>({path:'store',namespace:'fixture'}));
  b.onResolve({filter:/^react-i18next$/},()=>({path:'i18n',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},({path:kind})=>({loader:'js',contents:kind==='api'?`export const api={craftmineSetImmersion:async state=>{fixture.hostStates.push(state)},onCraftmineImmersionShortcut:fn=>{fixture.listener=fn;return()=>{fixture.listener=null}},nativeMenuAction:async action=>{fixture.actions.push(action)}};`:kind==='i18n'?`export const useTranslation=()=>({i18n:{language:'zh-CN'}});`:`export const useAppStore={getState:()=>({workPanelWidth:500,setPage(){},openWorkPanel(){},setWorkPanelWidth(){},workPanelTabs:[]})};`}));
}}]});
fs.writeFileSync(path.join(out,'index.html'),'<html><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><style>body{background:#315940}</style><div id="root"></div><script src="fixture.js"></script></html>');
let browser;
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);};
try{
  browser=await playwright().chromium.launchPersistentContext(path.join(out,'profile'),browserOptions());
  await browser.addInitScript(()=>{window.inputViolations=[];Element.prototype.requestPointerLock=()=>{inputViolations.push('pointer');throw Error('disabled')};window.focus=()=>inputViolations.push('focus');});
  const page=await browser.newPage();report.errors=[];page.on('pageerror',e=>report.errors.push(String(e)));
  await page.goto(pathToFileURL(path.join(out,'index.html')).href);await page.waitForFunction(()=>!!fixture.listener);
  await page.evaluate(()=>fixture.listener('compact'));await page.waitForFunction(()=>document.querySelector('[data-overlay]').dataset.overlay==='compact');
  check('F2 bridge opens actual chat overlay',await page.locator('section').isVisible());
  await page.evaluate(()=>fixture.listener('escape'));await page.waitForFunction(()=>document.querySelector('[data-overlay]').dataset.overlay==='closed');
  await page.evaluate(()=>fixture.listener('exit-play'));await page.waitForSelector('[data-craftmine-pause]');
  await page.waitForFunction(()=>fixture.hostStates.at(-1)?.blocked===true);
  check('closed-world Escape shows pause menu and blocks gameplay',await page.locator('[data-craftmine-pause]').isVisible());
  check('four expected pause actions are visible',await page.locator('[data-pause-action]').count()===4);
  await page.screenshot({path:path.join(out,'pause-menu.png')});
  for(const name of ['settings','workbench','exit'])await page.evaluate(name=>{const b=document.querySelector('[data-pause-action="'+name+'"]');b[Object.keys(b).find(k=>k.startsWith('__reactProps$'))].onClick();},name);
  check('settings/workbench are finite callbacks and exit uses ordered quit',await page.evaluate(()=>fixture.actions.join(',')==='settings,workbench,quit'));
  await page.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
  await page.waitForFunction(()=>!document.querySelector('[data-craftmine-pause]')&&fixture.hostStates.at(-1)?.blocked===false);
  check('Escape resumes gameplay without changing the retained play layout',await page.evaluate(()=>JSON.parse(localStorage.getItem('craftmine.desktop.layout.v1')).mode==='play'));
  check('no input ownership changes or renderer failures',await page.evaluate(()=>inputViolations.length===0)&&report.errors.length===0);
  report.passed=true;
}catch(error){report.error=String(error.stack??error);throw error;}
finally{await browser?.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(out);}
