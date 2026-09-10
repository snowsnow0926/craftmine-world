// Real React in an independent headless browser; transport delays are fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {playwright,browserOptions} from '../../app/browser-tools.mjs';
const root=path.resolve(fileURLToPath(new URL('../../',import.meta.url))),deps=process.env.CRAFTMINE_NATIVE_DEPENDENCY_ROOT||root;
const desktop=path.join(deps,'vendor/pi-desktop/apps/desktop'),require=createRequire(path.join(desktop,'package.json'));
const {build}=createRequire(path.join(deps,'vendor/pi-desktop/packages/agent-runtime/package.json'))('esbuild');
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});const out=fs.mkdtempSync(path.join(root,'test-results/version-diff-ui-'));
const component=path.join(root,'vendor/pi-desktop/apps/desktop/src/components/craftmine/GodotVersionComparison.tsx').replaceAll('\\','/');
fs.writeFileSync(path.join(out,'entry.jsx'),`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{GodotVersionComparison}from ${JSON.stringify(component)};
window.pending=[];const bridge={call:(channel,args)=>new Promise((resolve,reject)=>window.pending.push({channel,args,resolve,reject}))};
function App(){const[props,setProps]=useState({worldId:'world-a',viewId:'view-a',targetOid:'a'.repeat(40)});window.changeComparison=setProps;return <GodotVersionComparison bridge={bridge} {...props}/>;}createRoot(document.getElementById('root')).render(<App/>);`);
await build({entryPoints:[path.join(out,'entry.jsx')],outfile:path.join(out,'ui.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',alias:{react:require.resolve('react'),'react-dom/client':require.resolve('react-dom/client'),'react/jsx-runtime':require.resolve('react/jsx-runtime')}});
const server=http.createServer((req,res)=>{res.setHeader('content-type',req.url==='/ui.js'?'text/javascript':'text/html; charset=utf-8');res.end(req.url==='/ui.js'?fs.readFileSync(path.join(out,'ui.js')):'<div id="root"></div><script src="/ui.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;const report={kind:'headless-react-response-races',checks:[],errors:[]};const check=(name,passed)=>{report.checks.push({name,passed:!!passed});assert.ok(passed,name);console.log('PASS '+name);};
try{
  browser=await playwright().chromium.launchPersistentContext(path.join(out,'profile'),browserOptions());
  await browser.addInitScript(()=>{window.inputAttempts=0;Element.prototype.requestPointerLock=()=>{window.inputAttempts++;};HTMLElement.prototype.focus=()=>{window.inputAttempts++;};window.focus=()=>{window.inputAttempts++;};});
  const page=await browser.newPage();page.on('pageerror',error=>report.errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.pending.length===1);
  await page.evaluate(()=>window.changeComparison({worldId:'world-b',viewId:'view-b',targetOid:'b'.repeat(40)}));await page.waitForFunction(()=>window.pending.length===2);
  await page.evaluate(()=>{const request=window.pending[0];request.resolve({worldId:'world-a',viewId:'view-a',toOid:'a'.repeat(40),fromOid:'old-a',changes:[{path:'old-world-secret.gd',status:'M'}],total:1,offset:0,nextOffset:null});});
  check('late old-world response cannot render after a world switch',await page.evaluate(()=>!document.body.textContent.includes('old-world-secret')));
  await page.evaluate(()=>window.pending[1].resolve({worldId:'world-b',viewId:'view-b',toOid:'b'.repeat(40),fromOid:'formal-b',changes:[{path:'current.gd',status:'M'}],total:1,offset:0,nextOffset:null}));await page.waitForFunction(()=>document.querySelector('[data-compare-path="current.gd"]'));
  await page.evaluate(()=>document.querySelector('[data-compare-path="current.gd"]').click());await page.waitForFunction(()=>window.pending.length===3);
  await page.evaluate(()=>window.changeComparison({worldId:'world-b',viewId:'view-b',targetOid:'c'.repeat(40)}));await page.waitForFunction(()=>window.pending.length===4);
  await page.evaluate(()=>window.pending[2].reject(Error('late old-version failure')));
  await page.evaluate(()=>window.pending[3].resolve({worldId:'world-b',viewId:'view-b',toOid:'c'.repeat(40),fromOid:'formal-b',changes:[],total:0,offset:0,nextOffset:null}));await page.waitForFunction(()=>document.querySelector('[data-compare-count]')?.textContent.includes('内容相同'));
  check('late old-version failures cannot replace the new comparison',await page.evaluate(()=>!document.querySelector('[role="alert"]')&&!document.querySelector('[data-compare-detail]')));
  await page.evaluate(()=>window.changeComparison({worldId:'world-b',viewId:'view-new',targetOid:'d'.repeat(40)}));await page.waitForFunction(()=>window.pending.length===5);
  await page.evaluate(()=>window.pending[4].resolve({worldId:'world-a',viewId:'view-new',toOid:'d'.repeat(40),changes:[]}));await page.waitForFunction(()=>document.querySelector('[role="alert"]'));
  check('mismatched response identity is rejected in the renderer',await page.locator('[role="alert"]').textContent().then(text=>text.includes('GODOT_HISTORY_VIEW_STALE')));
  check('no input, focus, pointer lock or page errors',await page.evaluate(()=>window.inputAttempts===0)&&report.errors.length===0);
  await page.screenshot({path:path.join(out,'ui-races.png')});
}catch(error){report.errors.push(String(error));throw error;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log('Evidence: '+out);}
