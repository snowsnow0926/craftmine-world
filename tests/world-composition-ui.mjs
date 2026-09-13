// Real React forms in independent headless Chromium. Host fixture evidence is
// limited to UI ownership/handoff; it does not certify gameplay or native calls.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {playwright,browserOptions} from '../app/browser-tools.mjs';
const root=path.resolve(import.meta.dirname,'..'),desktop=path.join(root,'vendor/pi-desktop/apps/desktop'),require=createRequire(path.join(desktop,'package.json'));
const catalog=createRequire(import.meta.url)('../plugins/craftmine-world/world-composition.cjs').compositionCatalog();
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});const out=fs.mkdtempSync(path.join(root,'test-results/world-composition-ui-'));
const code=`import React from 'react';import {createRoot} from 'react-dom/client';
import {AssetLibraryPanel} from './src/components/craftmine/assets/AssetLibraryPanel';
const app=createRoot(document.getElementById('root')),catalog=${JSON.stringify(catalog)},hash='a'.repeat(64);
const f=window.fixture={calls:[],handoffs:[],revision:1,hold:false};
f.bridge={call:async(channel,args)=>{f.calls.push({channel,args:structuredClone(args)});
if(channel==='asset.search')return {items:[],total:0,nextOffset:null};
if(channel==='package.request'&&args.method==='compositionCatalog')return {...catalog,worldId:args.worldId};
if(channel==='package.request'&&args.method==='compositionPlan'){
 const r=args.params.request,plan={format:'craftmine.world-composition-plan/1',worldId:args.worldId,request:r,source:{revision:f.revision,manifestHash:hash},planHash:String(f.revision).repeat(64),applied:false,compatibility:'not-runtime-verified',components:[{archiveRef:{assetId:'cw.module.approved-pomeranian',version:1,contentHash:hash},archiveSha256:hash,rootContentHash:hash,displayName:'白色博美',source:{licenseStatus:'unverified'},sourceRequirements:{status:'adaptation-required'},existingSource:'not-observed'}],checks:[{id:'physical-runway',status:'runtime-verification-required',detail:'Real runway required'}],missingLogic:r.recipeId==='collect-unlock-flight'?[{id:'collection-objective',detail:'Build quest'}]:[]};
 if(f.hold)await new Promise(resolve=>f.release=resolve);return plan;}
throw Error('Unexpected call: '+channel);}};
f.render=(world='world-one',lang='zh')=>app.render(<AssetLibraryPanel key={world+lang} worldId={world} lang={lang} bridge={f.bridge} onUseComposition={async value=>f.handoffs.push(value)}/>);
f.change=(selector,value)=>{const node=document.querySelector(selector),prop=node.type==='checkbox'?'checked':'value';Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node),prop).set.call(node,value);node.dispatchEvent(new Event('change',{bubbles:true}));node.dispatchEvent(new Event('input',{bubbles:true}));};
f.unmount=()=>app.render(<p data-unmounted>Closed</p>);f.render();`;
await require('esbuild').build({stdin:{contents:code,resolveDir:desktop,sourcefile:'world-composition-ui.tsx',loader:'tsx'},bundle:true,format:'esm',outfile:path.join(out,'fixture.js'),define:{'process.env.NODE_ENV':'"production"'},logLevel:'error'});
fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><html><meta charset="utf-8"><style>body{margin:20px;font:14px system-ui;background:#171717;color:#eee}button,input,select,textarea{font:inherit;color:inherit;background:#282828;padding:6px;border:1px solid #555}label{display:block;margin:10px 0}pre{max-width:100%}</style><link rel="stylesheet" href="./fixture.css"><div id="root"></div><script type="module" src="./fixture.js"></script></html>');
const browser=await playwright().chromium.launch({...browserOptions(),args:['--allow-file-access-from-files']}),context=await browser.newContext({viewport:{width:1100,height:1000}}),page=await context.newPage();
const report={out,checks:[],errors:[]},check=(label,value)=>{assert(value,label);report.checks.push(label);};
page.on('pageerror',error=>report.errors.push(String(error)));
await page.addInitScript(()=>{window.violations=[];Element.prototype.requestPointerLock=function(){violations.push('pointerLock');throw Error('BLOCKED');};window.focus=()=>violations.push('focus');HTMLElement.prototype.focus=function(){};});
const submit=selector=>page.evaluate(selector=>document.querySelector(selector).requestSubmit(),selector),change=(selector,value)=>page.evaluate(args=>fixture.change(...args),[selector,value]);
try{
  await page.goto(pathToFileURL(path.join(out,'index.html')).href);await page.waitForSelector('[data-library-tab="composition"]');
  check('composition is a fourth tab in the existing asset library',await page.locator('[data-library-tab]').count()===4);
  await submit('[data-library-tab="composition"]');await page.waitForSelector('[data-composition-recipe]');
  check('opening composition only reads catalog and does not submit AI',await page.evaluate(()=>fixture.handoffs.length===0&&fixture.calls.filter(row=>row.channel==='package.request').every(row=>row.args.method==='compositionCatalog')));
  await change('[data-composition-recipe]','collect-unlock-flight');await page.waitForSelector('[data-composition-count]');
  await change('[data-composition-count]','5');await change('[data-composition-scenery]','city-street');await change('[data-composition-weather]','rain');await change('[data-composition-wish]','保留整座城市和已有存档');
  await submit('[data-composition-plan-form]');await page.waitForSelector('[data-composition-plan]');
  check('explicit choices and original wish reach read-only plan',await page.evaluate(()=>{const r=fixture.calls.at(-1).args.params.request;return r.choices.collectionCount===5&&r.choices.weather==='rain'&&r.choices.scenery==='city-street'&&r.wish==='保留整座城市和已有存档';}));
  check('missing logic, runway and remaining checks are visible without claiming completion',await page.evaluate(()=>!!document.querySelector('[data-composition-missing]')&&document.querySelector('[data-composition-runway]').textContent.includes('2400')&&fixture.handoffs.length===0));
  await page.screenshot({path:path.join(out,'composition-zh.png')});
  await page.evaluate(()=>fixture.revision=2);await submit('[data-composition-handoff-form]');await page.waitForSelector('[data-composition-error]');
  check('source changes refresh plan and require renewed explicit handoff',await page.evaluate(()=>fixture.handoffs.length===0&&document.querySelector('[data-composition-plan]').dataset.compositionPlan==='2'.repeat(64)));
  await submit('[data-composition-handoff-form]');await page.waitForFunction(()=>fixture.handoffs.length===1);
  check('confirmed handoff preserves wish, exact version and source without auto-sending',await page.evaluate(()=>fixture.handoffs[0].text.includes('保留整座城市和已有存档')&&fixture.handoffs[0].text.includes('collectionCount')&&fixture.handoffs[0].plan.source.revision===2));
  await change('[data-composition-count]','4');check('changing a choice invalidates old plan immediately',await page.evaluate(()=>!document.querySelector('[data-composition-plan]')));
  await page.evaluate(()=>fixture.hold=true);await submit('[data-composition-plan-form]');await page.waitForFunction(()=>fixture.release);await page.evaluate(()=>fixture.render('world-two'));await page.waitForSelector('[data-library-tab="composition"]');await page.evaluate(()=>fixture.release());
  check('late source reads cannot install a previous world plan after navigation',await page.evaluate(()=>!document.querySelector('[data-composition-plan]')&&fixture.handoffs.length===1));
  await page.evaluate(()=>{fixture.hold=false;fixture.render('world-two','en');});await submit('[data-library-tab="composition"]');await page.waitForSelector('[data-composition-recipe]');
  check('English recipe labels retain original PI library',await page.evaluate(()=>document.body.textContent.includes('Companion exploration')&&document.body.textContent.includes('Save world template')));
  check('no focus, pointer lock or page errors',await page.evaluate(()=>violations.length===0)&&report.errors.length===0);
  report.passed=true;
}finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report));}
