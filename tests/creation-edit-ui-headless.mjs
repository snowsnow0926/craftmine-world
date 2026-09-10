// Real React callbacks and host bridge transport; no input simulation or focus.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
import {playwright,browserOptions} from '../app/browser-tools.mjs';
const desktop=path.resolve('vendor/pi-desktop/apps/desktop'),require=createRequire(path.join(desktop,'package.json'));
fs.mkdirSync('test-results',{recursive:true});const out=fs.mkdtempSync(path.resolve('test-results/creation-edit-ui-'));
const script=`import React from 'react';import{createRoot}from'react-dom/client';import i18n from'i18next';import{initReactI18next}from'react-i18next';import{CreationObjectEditor}from'./src/components/CreationObjectEditor';
const calls=[],statuses=new Map();let refreshes=0;globalThis.__craftmineWorldBridge={invoke:async(_,channel,payload)=>{calls.push({channel,payload});if(channel==='godot.creationEditHistory')return{latestUndoOperationId:'previous-edit'};if(channel==='godot.creationEdit'){const status={...payload,phase:'checking'};statuses.set(payload.operationId,status);return status;}if(channel==='godot.creationEditStatus')return{...statuses.get(payload.operationId),phase:'applied',receipt:{operationId:payload.operationId,undoSupported:true}};return{};},onChanged:()=>()=>{}};
const controller={sessionId:'session-a',capture:{captureId:'capture-a',worldId:'world-a',target:{entityId:'tree-a',entityName:'树',scale:[1,1,1],color:'#84a866'}},refresh:async()=>{refreshes++;}};
globalThis.fixture={calls,getRefreshes:()=>refreshes,action:text=>{const element=[...document.querySelectorAll('button')].find(el=>el.textContent===text);if(!element||element.disabled)throw Error('Action unavailable '+text);element[Object.keys(element).find(key=>key.startsWith('__reactProps'))].onClick();},change:(label,value)=>{const element=document.querySelector('[aria-label="'+label+'"]');element[Object.keys(element).find(key=>key.startsWith('__reactProps'))].onChange({target:{value}});}};
void i18n.use(initReactI18next).init({lng:'zh-CN',resources:{}}).then(()=>createRoot(document.getElementById('root')).render(<CreationObjectEditor controller={controller}/>));`;
await require('esbuild').build({stdin:{contents:script,resolveDir:desktop,loader:'jsx'},outfile:path.join(out,'fixture.js'),bundle:true,platform:'browser',format:'iife',target:'chrome130'});
fs.writeFileSync(path.join(out,'index.html'),'<html lang="zh-CN"><meta charset="utf-8"><div id="root"></div><script src="fixture.js"></script></html>');
const checks=[],errors=[];const check=(name,passed)=>{checks.push({name,passed});assert.ok(passed,name);};
const browser=await playwright().chromium.launchPersistentContext(path.join(out,'profile'),{...browserOptions(),headless:true});
try{
 await browser.addInitScript(()=>{globalThis.inputRequests=0;Element.prototype.requestPointerLock=()=>{inputRequests++;throw Error('disabled');};window.focus=()=>{inputRequests++;};});
 const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(pathToFileURL(path.join(out,'index.html')).href);await page.waitForFunction(()=>document.querySelector('button'));
 await page.evaluate(()=>fixture.action('编辑对象'));await page.waitForFunction(()=>document.querySelector('fieldset'));
 check('对象名称与真实尺寸显示',await page.evaluate(()=>document.querySelector('legend').textContent==='树'&&document.querySelector('[aria-label="尺寸 X"]').value==='1'));
 await page.evaluate(()=>fixture.action('取消'));await page.waitForFunction(()=>!document.querySelector('fieldset'));
 check('取消没有写入请求',await page.evaluate(()=>!fixture.calls.some(call=>call.channel==='godot.creationEdit')));
 await page.evaluate(()=>fixture.action('编辑对象'));await page.waitForFunction(()=>document.querySelector('fieldset'));
 await page.evaluate(()=>{fixture.change('尺寸 X','2');fixture.change('对象颜色','#123456');});
 await page.waitForFunction(()=>document.querySelector('[aria-label="尺寸 X"]').value==='2');await page.evaluate(()=>fixture.action('检查并应用'));
 await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent==='编辑已应用');
 check('真实按钮提交有界参数与opaque目标',await page.evaluate(()=>{const p=fixture.calls.find(call=>call.channel==='godot.creationEdit').payload;return p.changes.scale[0]===2&&p.changes.color==='#123456'&&p.captureId==='capture-a'&&!('worldId'in p)&&!('targetId'in p)&&fixture.getRefreshes()===1;}));
 await page.evaluate(()=>fixture.action('撤销上次操作'));await page.waitForFunction(()=>fixture.calls.filter(call=>call.channel==='godot.creationEdit').length===2);
 check('撤销发送原始回执编号',await page.evaluate(()=>{const edits=fixture.calls.filter(call=>call.channel==='godot.creationEdit');return edits[1].payload.action==='undo'&&edits[1].payload.undoOperationId===edits[0].payload.operationId;}));
 check('没有输入锁定或焦点请求',await page.evaluate(()=>inputRequests===0));check('没有页面错误',errors.length===0);
 await page.screenshot({path:path.join(out,'editor.png')});
}catch(error){errors.push(String(error.stack));process.exitCode=1;}finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({checks,errors,scope:'真实React与fixture传输；生产host集成另验收'},null,2));console.log(JSON.stringify({out,checks,errors}));}
