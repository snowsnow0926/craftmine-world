// Actual React components; all usage, sessions and IPC are authored fixtures.
// This does not replace model, native-host or packaged acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {playwright,browserOptions} from '../../../app/browser-tools.mjs';

const root=process.cwd(),desktop=path.join(root,'vendor/pi-desktop/apps/desktop');
const parent=path.join(root,'test-results/P5');fs.mkdirSync(parent,{recursive:true});
const dir=fs.mkdtempSync(path.join(parent,'metrics-'));
const require=createRequire(path.join(desktop,'package.json'));
const script=`
import React from 'react';import {createRoot} from 'react-dom/client';
import i18n from 'i18next';import {initReactI18next} from 'react-i18next';
import {catalogs,flattenCatalog} from '@pi-desktop/i18n';
import {TaskMetricsView,TaskMetricsPanel,TaskMetricsSession} from './src/components/TaskMetrics';
import {Sidebar} from './src/components/Sidebar';
import {useAppStore} from './src/stores/app-store';import {api} from './src/lib/api';
import {taskMetricsFixtures as fixtures} from '../../packages/shared/src/task-metrics-fixtures';
import './src/styles/tokens.css';
await i18n.use(initReactI18next).init({lng:'zh-CN',resources:Object.fromEntries(Object.entries(catalogs).map(([key,value])=>[key,{translation:flattenCatalog(value)}])),interpolation:{escapeValue:false}});
api.listNotifications=async()=>({notifications:[],unreadCount:0});
api.setNotificationViewingSession=async()=>({ok:true});
useAppStore.setState({ready:true,settings:{language:'zh-CN',theme:'dark'},version:{appName:'craftmine world',version:'9.8.7-fixture',protocolVersion:11}});
const component=createRoot(document.getElementById('metrics'));
const sidebar=createRoot(document.getElementById('sidebar'));
sidebar.render(<Sidebar onOpenSearch={()=>{}} onToggleSidebar={()=>{}} sidebarToggleShortcut="" sidebarWidth={260} onWidthChange={()=>{}} onWidthCommit={()=>{}}/>);
const pending=[];let requestId=0;const read=query=>new Promise((resolve,reject)=>pending.push({id:++requestId,query,resolve,reject}));
window.fixture={fixtures,pending,show(name){component.render(<TaskMetricsView metrics={name===null?null:structuredClone(fixtures[name])}/>);},showValue(value){component.render(<TaskMetricsView metrics={value}/>);},panel(sessionId,messageId,running){component.render(<TaskMetricsSession value={sessionId}><TaskMetricsPanel messageId={messageId} running={running} read={read}/></TaskMetricsSession>);},resolve(id,name,override={}){const item=pending.find(p=>p.id===id);item.resolve(name===null?null:{...structuredClone(fixtures[name]),...override});},reject(id){pending.find(p=>p.id===id).reject(Error('fixture offline'));},language(value){return i18n.changeLanguage(value);},version(value){useAppStore.setState({version:value?{appName:'craftmine world',version:value,protocolVersion:11}:undefined});}};
fixture.show('complete');
`;
await require('esbuild').build({stdin:{contents:script,sourcefile:'metrics-fixture.tsx',resolveDir:desktop,loader:'tsx'},outfile:path.join(dir,'fixture.js'),bundle:true,platform:'browser',format:'esm',target:'chrome130',define:{'process.env.NODE_ENV':'"production"'},loader:{'.png':'file','.gif':'file','.svg':'file','.woff2':'file'}});
const assets=path.join(desktop,'out/renderer/assets');
const stylesheet=fs.readdirSync(assets).find(name=>/^index-.*\.css$/.test(name));
assert.ok(stylesheet,'Build the matching desktop styles before visual verification');
fs.copyFileSync(path.join(assets,stylesheet),path.join(dir,'product.css'));
fs.writeFileSync(path.join(dir,'index.html'),'<!doctype html><html lang="zh-CN" data-theme="dark"><head><meta charset="utf-8"><link rel="stylesheet" href="product.css"><link rel="stylesheet" href="fixture.css"><style>body{margin:0;display:block;background:var(--ds-bg);color:var(--ds-text-primary)}#metrics{width:352px;padding:16px}#sidebar{display:none}.task-metrics{background:var(--ds-bg)}</style></head><body><main id="metrics"></main><aside id="sidebar"></aside><script type="module" src="fixture.js"></script></body></html>');
const checks=[],errors=[];let browser;
const server=createServer((request,response)=>{
  const name=request.url==='/'?'index.html':path.basename(new URL(request.url,'http://localhost').pathname);
  const file=fs.existsSync(path.join(dir,name))?path.join(dir,name):path.join(assets,name);
  if(!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404);response.end();return;}
  response.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.woff2')?'font/woff2':'text/html');
  response.end(fs.readFileSync(file));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const check=(name,value)=>{checks.push({name,passed:!!value});assert.ok(value,name);console.log('PASS '+name);};
try{
  browser=await playwright().chromium.launchPersistentContext(path.join(dir,'profile'),{...browserOptions(),viewport:{width:620,height:900}});
  await browser.addInitScript(()=>{globalThis.__inputRequests=0;Element.prototype.requestPointerLock=()=>{__inputRequests++;throw Error('Pointer lock disabled');};window.focus=()=>{__inputRequests++;};window.piDesktop={platform:'win32',locale:'zh-CN',on:()=>()=>{},invoke:async()=>({ok:true,data:null})};});
  const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/');
  const text=key=>page.locator('[data-metric="'+key+'"]').textContent();
  await page.waitForFunction(()=>document.querySelector('[data-metric="tokens"]')?.textContent==='300');
  check('Host totals, TPS, duration and actual model appear',await text('tps')==='100'&&await text('time')==='5s'&&await text('model')==='fixture-model');
  check('Build label is static, reports host version and has no navigation semantics',await page.evaluate(()=>{const label=document.querySelector('[data-nav="build"]');return label?.tagName==='SPAN'&&label.textContent.trim()==='v9.8.7-fixture'&&!label.closest('a,button')&&!label.hasAttribute('role')&&label.tabIndex===-1;}));
  await page.evaluate(()=>fixture.version(undefined));await page.waitForFunction(()=>!document.querySelector('[data-nav="build"]').textContent.includes('9.8.7'));
  check('Missing host version has no invented release number',!(await page.locator('[data-nav="build"]').textContent()).match(/\d+\.\d+/));
  await page.evaluate(()=>fixture.show('unknown'));await page.waitForFunction(()=>document.querySelector('[data-task-coverage="unknown"]'));
  check('Missing usage and speed are unknown, not zero',await text('tokens')==='—'&&await text('tps')==='—'&&await text('model')==='未报告');
  await page.evaluate(()=>fixture.show('partial'));await page.waitForFunction(()=>document.querySelector('[data-task-coverage="partial"]'));
  check('Partial sums and partial TPS are explicitly marked',await page.locator('#metrics').textContent().then(value=>value.includes('部分统计'))&&await text('tps')==='100 (部分统计)');
  await page.evaluate(()=>{const value=structuredClone(fixture.fixtures.complete);value.usage={inputTokens:0,outputTokens:0,totalTokens:0};value.tps.value=0;fixture.showValue(value);});
  await page.waitForFunction(()=>document.querySelector('[data-metric="tokens"]').textContent==='0');
  check('Genuine zero usage remains zero',await text('tps')==='0');
  await page.evaluate(()=>{const value=structuredClone(fixture.fixtures.complete);value.models.push({...structuredClone(value.models[0]),providerId:'second-provider',modelId:'very-long-actual-model-name-from-a-runtime-fallback-binding'});fixture.showValue(value);});
  await page.waitForFunction(()=>document.querySelector('[data-metric="model"]').textContent.includes('very-long'));
  check('Multiple runtime models remain separately identifiable',await text('model')==='fixture-model / very-long-actual-model-name-from-a-runtime-fallback-binding');
  check('Long model identities stay within a 320px chat column',await page.evaluate(()=>{const section=document.querySelector('.task-metrics');return section.scrollWidth<=section.clientWidth&&document.documentElement.scrollWidth<=innerWidth;}));
  await page.evaluate(()=>document.querySelector('details').open=true);await page.screenshot({path:path.join(dir,'metrics-dark-narrow.png')});
  await page.evaluate(()=>fixture.panel('session-A','message-A',true));await page.waitForFunction(()=>fixture.pending.length===1);
  check('Read uses the durable message/session identity',await page.evaluate(()=>JSON.stringify(fixture.pending[0].query)===JSON.stringify({sessionId:'session-A',messageId:'message-A'})));
  await page.evaluate(()=>fixture.panel('session-B','message-B',false));await page.waitForFunction(()=>fixture.pending.length===2);
  await page.evaluate(()=>fixture.resolve(2,'complete',{sessionId:'session-B',turnId:'turn-B'}));await page.waitForFunction(()=>document.querySelector('[data-task-id="turn-B"]'));
  await page.evaluate(()=>fixture.resolve(1,'complete',{sessionId:'session-A',turnId:'turn-A'}));
  check('Late previous-session result cannot overwrite the current operation',await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve(!!document.querySelector('[data-task-id="turn-B"]'))))));
  await page.evaluate(()=>fixture.panel('session-C','message-C',false));await page.waitForFunction(()=>fixture.pending.length===3);
  await page.evaluate(()=>fixture.resolve(3,'complete',{sessionId:'wrong-session'}));await page.waitForFunction(()=>document.getElementById('metrics').textContent.includes('用量读取失败'));
  check('Mismatched response identity is rejected without fabricated totals',await text('tokens')==='—');
  await page.evaluate(()=>fixture.panel('session-D','message-D',true));await page.waitForFunction(()=>fixture.pending.length===4);
  await page.evaluate(()=>fixture.resolve(4,'running',{sessionId:'session-D',turnId:'turn-D'}));await page.waitForFunction(()=>document.querySelector('[data-task-id="turn-D"]'));
  await page.evaluate(()=>fixture.panel('session-D','message-D',false));await page.waitForFunction(()=>fixture.pending.length===5);
  await page.evaluate(()=>fixture.resolve(5,'running',{sessionId:'session-D',turnId:'turn-D'}));await page.waitForFunction(()=>fixture.pending.length===6);
  await page.evaluate(()=>fixture.resolve(6,'complete',{sessionId:'session-D',turnId:'turn-D',wallTimeMs:92000}));await page.waitForFunction(()=>document.querySelector('[data-metric="time"]').textContent==='1m 32s');
  check('Stop-before-persistence race refetches final durable metrics',await text('tokens')==='300');
  await page.evaluate(()=>fixture.panel('session-E','message-E',false));await page.waitForFunction(()=>fixture.pending.length===7);
  await page.evaluate(()=>fixture.reject(7));await page.waitForFunction(()=>document.getElementById('metrics').textContent.includes('用量读取失败'));
  check('Read failure remains a readable unavailable state',await text('tokens')==='—');
  await page.evaluate(()=>fixture.show('aborted'));await page.waitForFunction(()=>document.getElementById('metrics').textContent.includes('已停止'));
  check('Aborted operations remain visible',true);
  await page.evaluate(async()=>{await fixture.language('en');fixture.show('complete');document.documentElement.dataset.theme='light';});
  await page.waitForFunction(()=>document.getElementById('metrics').textContent.includes('Total tokens'));
  await page.screenshot({path:path.join(dir,'metrics-light-english.png')});check('English labels retain actual totals',await text('tokens')==='300');
  check('No real input, focus or Pointer Lock requested',await page.evaluate(()=>__inputRequests===0));
  check('No unhandled component errors',errors.length===0);
}catch(error){errors.push(error.stack);process.exitCode=1;console.error(error);}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify({scope:'Actual TaskMetrics and Sidebar React with authored DTO and IPC fixtures; no provider or native acceptance',checks,errors},null,2));console.log('Report: '+path.join(dir,'report.json'));}
