// Independent browser DOM checks. All actions use page script/requestSubmit;
// no mouse, keyboard, input simulation, focus, Pointer Lock, engine or model.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {playwright,browserOptions} from '../../app/browser-tools.mjs';
register(new URL('../../vendor/pi-desktop/apps/desktop/test/helpers/ts-import-hooks.mjs',import.meta.url));
const {createCraftminePanelGateway}=await import('../../vendor/pi-desktop/apps/desktop/electron/main/craftmine-panel-gateway.ts');
const root=path.resolve(import.meta.dirname,'../..');
await fs.mkdir(path.join(root,'test-results'),{recursive:true});
const out=await fs.mkdtemp(path.join(root,'test-results/catalog-source-ui-'));
const modules=new Map(await Promise.all(['godot-package-ui.mjs','godot-windows-export-ui.mjs'].map(async name=>['/'+name,await fs.readFile(path.join(root,'plugins/craftmine-world',name))])));
const server=http.createServer((req,res)=>{const script=modules.get(req.url);res.setHeader('Content-Type',script?'text/javascript':'text/html');res.end(script??'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body><main id="ui"></main></body></html>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const calls=[],a={assetId:'kenney-city-building-trial',version:1,contentHash:'a'.repeat(64)},newer={...a,version:2,contentHash:'b'.repeat(64)},archive='c'.repeat(64),jobId='gjob-'+'d'.repeat(64);
let lost=true;
const gateway=createCraftminePanelGateway({viewingSession:()=>null,session:async()=>null,activeTurn:()=>undefined,
 domain:async(method,params)=>{
  if(method==='selection.read')return {worldId:'alpha'};
  assert.equal(method,'asset.request');
  if(params.method==='search'){assert.equal(params.args.latestOnly,false);return {items:[{...newer,displayName:'城市建筑新版'},{...a,displayName:'城市建筑 <script>safe</script>'}],total:2,nextOffset:null,truncated:false};}
  assert.equal(params.method,'read');assert.deepEqual(params.args,{assetId:a.assetId,version:1});
  return {version_:{...a,mediaKind:'package',fileCount:1,displayName:'城市建筑 <script>safe</script>',source:{origin:'https://github.com/KenneyNL/Starter-Kit-City-Builder',author:'Kenney',license:'MIT / CC0',licenseStatus:'unverified'},files:[{path:'building.zip',sha256:archive,mediaType:'application/zip',bytes:23409}]}};
 },
 packages:async(channel,input)=>{
  if(input.method==='sourceList')return {revision:1,items:[]};
  if(input.method==='sourceJob')return {worldId:'alpha',jobId,status:'passed'};
  assert.equal(input.method,'importCatalogSource');assert.deepEqual(input.params.ref,a);
  if(lost){lost=false;throw Error('TRANSPORT_LOST');}
  return {worldId:'alpha',operationId:input.params.operationId,status:'check-queued',applied:false,catalogRef:a,archiveSha256:archive,grantId:'opaque-catalog',instanceIds:['instance'],job:{id:jobId,status:'queued'}};
 }});
let browser;
try{
 browser=await playwright().chromium.launchPersistentContext(path.join(out,'profile'),{...browserOptions(),headless:true,viewport:{width:1200,height:1400}});
 await browser.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await browser.addInitScript(()=>{globalThis.guard={pointerLock:0,focus:0};Element.prototype.requestPointerLock=()=>{guard.pointerLock++;throw Error('Pointer Lock forbidden');};HTMLElement.prototype.focus=()=>{guard.focus++;throw Error('Focus forbidden');};window.focus=()=>{guard.focus++;throw Error('Focus forbidden');};});
 const page=await browser.newPage(),pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
 await page.exposeFunction('hostRequest',async(channel,input)=>{calls.push({channel,input:structuredClone(input)});return gateway(channel,input);});
 await page.goto(origin);
 await page.evaluate(async()=>{
  const {createGodotPackageUI}=await import('/godot-package-ui.mjs');
  globalThis.errors=[];globalThis.currentAction=Promise.resolve();
  globalThis.ui=createGodotPackageUI({element:document.getElementById('ui'),getWorldId:()=> 'alpha',request:hostRequest,action:run=>(currentAction=run().catch(error=>errors.push(error.message)))});
  await ui.show();
 });
 const submit=label=>page.evaluate(async label=>{const button=[...document.querySelectorAll('button')].find(n=>n.textContent===label);if(!button||button.disabled||button.form.hidden)throw Error('button unavailable: '+label);button.form.requestSubmit();await currentAction;},label);
 await page.evaluate(()=>{const label=[...document.querySelectorAll('label')].find(n=>n.firstChild.textContent==='作品名称或编号');label.querySelector('input').value='kenney-city-building-trial';});
 await submit('检索资源库');
 await page.evaluate(()=>{const label=[...document.querySelectorAll('label')].find(n=>n.firstChild.textContent==='资源库固定版本'),select=label.querySelector('select');select.value='1';select.dispatchEvent(new Event('change'));});
 await submit('核对所选版本');
 assert.equal(calls.filter(c=>c.input.method==='importCatalogSource').length,0);
 await submit('安装所选资源库 ZIP 并检查');
 assert.ok((await page.evaluate(()=>errors)).some(error=>error.includes('TRANSPORT_LOST')));
 await submit('重试确认上次安装');
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].find(n=>n.textContent==='再次安装为独立对象')?.disabled===false);
 await submit('再次安装为独立对象');
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].find(n=>n.textContent==='再次安装为独立对象')?.disabled===false);
 const display=await page.evaluate(()=>({guard,errors,text:document.body.textContent,scriptCount:document.querySelectorAll('script').length}));
 assert.deepEqual(display.guard,{pointerLock:0,focus:0});assert.equal(display.scriptCount,0);assert.deepEqual(pageErrors,[]);
 assert.match(display.text,/固定版本 v1/);assert.match(display.text,/本次安装已提交检查/);
 const imports=calls.filter(c=>c.input.method==='importCatalogSource').map(c=>c.input.params);
 assert.equal(imports.length,3);assert.deepEqual(imports[0],imports[1]);assert.notEqual(imports[1].operationId,imports[2].operationId);
 assert.ok(imports.every(input=>JSON.stringify(input.ref)===JSON.stringify(a)));
 await page.screenshot({path:path.join(out,'catalog-ui.png'),fullPage:true});
 await fs.writeFile(path.join(out,'report.json'),JSON.stringify({passed:true,scope:'real isolated DOM with actual Main read/gateway contract; fake package executor, no engine or model',calls,display,pageErrors},null,2));
 console.log(JSON.stringify({passed:true,out,checks:['actual Main ownerWorldId read contract','v1 selected while v2 exists','explicit requestSubmit only','same operation/ref lost-receipt retry','fresh repeat acceptance','safe text','zero focus/Pointer Lock/model/engine']}));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
