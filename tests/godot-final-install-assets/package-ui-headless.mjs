import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import {playwright,browserOptions} from '../../app/browser-tools.mjs';
const out=await fs.mkdtemp(path.join(os.tmpdir(),'package-ui-')),source=await fs.readFile(new URL('../../plugins/craftmine-world/godot-package-ui.mjs',import.meta.url));
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/ui.mjs'?'text/javascript':'text/html');res.end(req.url==='/ui.mjs'?source:'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body><main id="ui"></main></body></html>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
 browser=await playwright().chromium.launch(browserOptions());const context=await browser.newContext();
 await context.addInitScript(()=>{globalThis.inputGuards={pointerLock:0,focus:0};Element.prototype.requestPointerLock=()=>{inputGuards.pointerLock++;throw Error('Pointer Lock forbidden');};window.focus=()=>{inputGuards.focus++;throw Error('Focus forbidden');};});
 const page=await context.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
 await page.evaluate(async()=>{
  const {createGodotPackageUI}=await import('/ui.mjs');window.calls=[];window.errors=[];window.world='alpha';window.failImport=true;
  window.ui=createGodotPackageUI({element:document.getElementById('ui'),getWorldId:()=>world,action:run=>run().catch(error=>errors.push(error.message)),request:async(channel,input)=>{calls.push({channel,input});const {method,params}=input;if(method==='sourceList')return{worldId:world,revision:4,manifestHash:'a'.repeat(64),mainScene:'world.tscn',items:[{nodePath:'Door',name:'Door <script>safe</script>',entityId:'door',supported:true}]};if(method==='exportSource')return{status:'completed',files:4};if(method==='importSource'&&failImport){failImport=false;throw Error('TRANSPORT_LOST');}return{status:'check-queued',grantId:'opaque-import-grant',instanceIds:[params.operationId],job:{id:'job-'+params.operationId}};}});await ui.show();
 });
 const submit=async label=>{await page.evaluate(label=>{const button=[...document.querySelectorAll('button')].find(button=>button.textContent===label);if(!button||button.disabled)throw Error('button unavailable');button.form.requestSubmit();},label);};
 await submit('导出所选对象为 ZIP');await page.waitForFunction(()=>calls.some(call=>call.input.method==='exportSource'));
 await submit('导入作品 ZIP 并检查');await page.waitForFunction(()=>errors.includes('TRANSPORT_LOST'));
 await submit('导入作品 ZIP 并检查');await page.waitForFunction(()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='再次安装为独立对象')?.disabled===false);
 await submit('再次安装为独立对象');await page.waitForFunction(()=>calls.some(call=>call.input.method==='repeatImportSource'));
 const result=await page.evaluate(()=>({calls,errors,guard:inputGuards,text:document.body.textContent,scriptCount:document.querySelectorAll('script').length}));
 const imports=result.calls.filter(call=>call.input.method==='importSource');assert.equal(imports.length,2);assert.equal(imports[0].input.params.operationId,imports[1].input.params.operationId);
 const repeat=result.calls.find(call=>call.input.method==='repeatImportSource');assert.notEqual(repeat.input.params.operationId,imports[0].input.params.operationId);assert.equal(repeat.input.params.grantId,'opaque-import-grant');assert.equal(result.scriptCount,0);assert.deepEqual(result.guard,{pointerLock:0,focus:0});assert.match(result.text,/检查记录/);
 await page.screenshot({path:path.join(out,'package-ui.png')});await fs.writeFile(path.join(out,'report.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({passed:true,out,checks:['native request routing','exact operation retry after lost result','new identity operation on repeat','opaque grant','safe text rendering','no input/focus/Pointer Lock']}));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
