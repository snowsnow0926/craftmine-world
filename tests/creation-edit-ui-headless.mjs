// Real React callbacks and host bridge transport; no input simulation or focus.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
import {playwright,browserOptions} from '../app/browser-tools.mjs';
import {createCompleteOutput} from './godot-final/complete-contract.mjs';
const desktop=path.resolve('vendor/pi-desktop/apps/desktop'),require=createRequire(path.join(desktop,'package.json'));
const out=createCompleteOutput(process.cwd(),process.env.CRAFTMINE_CREATION_OUTPUT_ROOT);
const script=`import React from 'react';import{createRoot}from'react-dom/client';import i18n from'i18next';import{initReactI18next}from'react-i18next';import{CreationObjectEditor}from'./src/components/CreationObjectEditor';
const calls=[],statuses=new Map();let refreshes=0,dropNext=false,render;globalThis.__craftmineWorldBridge={invoke:async(_,channel,payload)=>{calls.push({channel,payload});if(channel==='godot.creationEditHistory')return{latestUndoOperationId:'previous-edit'};if(channel==='godot.creationEdit'){const status={...payload,phase:'checking'};statuses.set(payload.operationId,status);if(dropNext){dropNext=false;throw Error("transport reply lost");}return status;}if(channel==='godot.creationEditStatus')return{...statuses.get(payload.operationId),phase:'applied',receipt:{operationId:payload.operationId,undoSupported:true}};return{};},onChanged:()=>()=>{}};
const controller={sessionId:'session-a',capture:{captureId:'capture-a',worldId:'world-a',target:{entityId:'tree-a',entityName:'树',scale:[1,1,1],color:'#84a866'}},refresh:async()=>{refreshes++;}};
globalThis.fixture={calls,selection:(source,surface)=>{controller.capture={...controller.capture,source,captureId:'capture-'+source+'-'+surface,target:{...controller.capture.target,surface,entityId:surface==='ground'?null:'tree-a',position:[5,0,0]}};render();},world:value=>{controller.capture={...controller.capture,worldId:value,captureId:"capture-"+value};render();},drop:()=>{dropNext=true;},getRefreshes:()=>refreshes,action:text=>{const element=[...document.querySelectorAll('button')].find(el=>el.textContent===text);if(!element||element.disabled)throw Error('Action unavailable '+text);element[Object.keys(element).find(key=>key.startsWith('__reactProps'))].onClick();},change:(label,value)=>{const element=document.querySelector('[aria-label="'+label+'"]');element[Object.keys(element).find(key=>key.startsWith('__reactProps'))].onChange({target:{value}});}};
void i18n.use(initReactI18next).init({lng:'zh-CN',resources:{}}).then(()=>{const root=createRoot(document.getElementById('root'));render=()=>root.render(<CreationObjectEditor controller={controller}/>);render();});`;
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
 await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent==='编辑已应用');
 await page.evaluate(()=>fixture.world('world-b'));await page.waitForFunction(()=>!document.querySelector('[role="status"]'));
 check('同会话切换世界不显示旧世界采用结果',true);
 await page.evaluate(()=>fixture.action('编辑对象'));await page.waitForFunction(()=>document.querySelector('fieldset'));
 await page.evaluate(()=>{fixture.drop();fixture.action('检查并应用');fixture.action('检查并应用');});
 await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent==='编辑已应用');
 check('丢回复和同帧双提交仍只产生一个操作编号',await page.evaluate(()=>{const edits=fixture.calls.filter(call=>call.channel==='godot.creationEdit');return edits.length===3&&fixture.calls.some(call=>call.channel==='godot.creationEditStatus'&&call.payload.operationId===edits[2].payload.operationId&&call.payload.worldId==='world-b'&&call.payload.sessionId==='session-a');}));
 check('原回执恢复后不再显示传输错误',await page.evaluate(()=>!document.querySelector('[role="alert"]')));
 await page.evaluate(()=>fixture.selection('recent','ground'));await page.waitForFunction(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='在此放置')?.disabled);
 check('最近对象不可伪装为放置落点',true);
 await page.evaluate(()=>fixture.selection('ray','ground'));await page.waitForFunction(()=>![...document.querySelectorAll('button')].find(b=>b.textContent==='在此放置')?.disabled);
 await page.evaluate(()=>fixture.action('在此放置'));await page.waitForSelector('[aria-label="放置类型"]');await page.evaluate(()=>fixture.action('取消'));
 check('取消放置不提交操作',await page.evaluate(()=>fixture.calls.filter(c=>c.channel==='godot.creationEdit').length===3));
 for(const kind of ['tree','rock','chest','door','marker']){
  await page.evaluate(()=>fixture.action('在此放置'));await page.waitForSelector('[aria-label="放置类型"]');await page.evaluate(kind=>fixture.change('放置类型',kind),kind);await page.waitForFunction(kind=>document.querySelector('[aria-label="放置类型"]').value===kind,kind);
  await page.evaluate(()=>{fixture.drop();fixture.action('放置并检查');fixture.action('放置并检查');});await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent==='编辑已应用');
 }
 check('五种放置丢回包和双提交只各写一次且没有renderer目标坐标',await page.evaluate(()=>{const items=fixture.calls.filter(c=>c.channel==='godot.creationEdit'&&c.payload.action==='place');return items.length===5&&new Set(items.map(c=>c.payload.kind)).size===5&&items.every(c=>!('position'in c.payload)&&!('targetId'in c.payload));}));
 await page.evaluate(()=>fixture.selection('ray','entity'));await page.waitForFunction(()=>![...document.querySelectorAll('button')].find(b=>b.textContent==='编辑对象')?.disabled);await page.evaluate(()=>fixture.action('编辑对象'));await page.waitForSelector('[aria-label="复制数量"]');
 await page.evaluate(()=>fixture.change('复制数量','9'));await page.waitForFunction(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='复制并检查')?.disabled);check('复制数量越界不允许提交',true);
 await page.evaluate(()=>{fixture.change('复制数量','2');fixture.change('复制偏移 X','3');});await page.waitForFunction(()=>![...document.querySelectorAll('button')].find(b=>b.textContent==='复制并检查')?.disabled);await page.evaluate(()=>{fixture.drop();fixture.action('复制并检查');fixture.action('复制并检查');});await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent==='编辑已应用');
 check('有限复制复用原操作状态不重复写入',await page.evaluate(()=>{const items=fixture.calls.filter(c=>c.channel==='godot.creationEdit'&&c.payload.action==='duplicate');return items.length===1&&items[0].payload.count===2&&items[0].payload.offset[0]===3&&!('targetId'in items[0].payload);}));
 check('没有输入锁定或焦点请求',await page.evaluate(()=>inputRequests===0));check('没有页面错误',errors.length===0);
 await page.screenshot({path:path.join(out,'editor.png')});
}catch(error){errors.push(String(error.stack));process.exitCode=1;}finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({checks,errors,scope:'真实React与fixture传输；生产host集成另验收'},null,2));console.log(JSON.stringify({out,checks,errors}));}
