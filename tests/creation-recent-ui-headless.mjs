// Real React target controller and callbacks; isolated transport fixture, no input simulation.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
import {playwright,browserOptions} from '../app/browser-tools.mjs';
import {createCompleteOutput} from './godot-final/complete-contract.mjs';
const desktop=path.resolve('vendor/pi-desktop/apps/desktop'),require=createRequire(path.join(desktop,'package.json'));
const out=createCompleteOutput(process.cwd(),process.env.CRAFTMINE_CREATION_OUTPUT_ROOT);
const script=`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import i18n from'i18next';import{initReactI18next}from'react-i18next';import{CreationTargetContext}from'./src/components/CreationTargetContext';import{useCreationTarget}from'./src/hooks/use-creation-target';
let worldId='world-a',chosen=null,controller,remount;const calls=[];
const recent=[{entityId:'tree-a',entityName:'树',entityKind:'tree',operationId:'place-a',available:true},{entityId:'tree-b',entityName:'树',entityKind:'tree',operationId:'place-b',available:true},{entityId:'tree-hidden',entityName:'树',entityKind:'tree',operationId:'place-c',available:false,reason:'CREATION_RECENT_HIDDEN'}];
globalThis.__craftmineWorldBridge={invoke:async(_,channel,payload)=>{calls.push({channel,payload});if(channel==='godot.creationTarget'){if('selection'in payload){if(payload.selection&&payload.selection.worldId!==worldId)throw Error('CREATION_SELECTION_WORLD_CHANGED');chosen=payload.selection;}const active=chosen?.worldId===worldId?chosen:null;return{captureId:'capture-'+calls.length,worldId,source:active?'recent':'ray',recent:worldId==='world-a'?recent:[],target:active?{surface:'entity',entityId:active.entityId,position:[2,0,-3],normal:[0,1,0],revision:2,entityName:'树',scale:[1,1,1],color:'#84a866'}:null};}if(channel==='godot.creationPolicy')return{worldId,autoApply:false};return{};},onChanged:()=>()=>{}};
function Target(){controller=useCreationTarget(true,'session-a');return <CreationTargetContext controller={controller}/>;}function App(){const[key,setKey]=useState(0);remount=()=>setKey(value=>value+1);return <Target key={key}/>;}
globalThis.fixture={calls,state:()=>controller.capture,refresh:()=>controller.refresh(),remount:()=>remount(),world:value=>{worldId=value;window.dispatchEvent(new Event('craftmine-world-changed'));},action:text=>{const element=[...document.querySelectorAll('button')].find(el=>el.textContent===text);if(!element||element.disabled)throw Error('Action unavailable '+text);element[Object.keys(element).find(key=>key.startsWith('__reactProps'))].onClick();}};
void i18n.use(initReactI18next).init({lng:'zh-CN',resources:{}}).then(()=>createRoot(document.getElementById('root')).render(<App/>));`;
await require('esbuild').build({stdin:{contents:script,resolveDir:desktop,loader:'jsx'},outfile:path.join(out,'fixture.js'),bundle:true,platform:'browser',format:'iife',target:'chrome130'});
fs.writeFileSync(path.join(out,'index.html'),'<html lang="zh-CN"><meta charset="utf-8"><style>body{font:16px sans-serif;margin:32px;max-width:700px}button{padding:8px;margin:4px}span{display:block}</style><div id="root"></div><script src="fixture.js"></script></html>');
const checks=[],errors=[],check=(name,passed)=>{checks.push({name,passed});assert.ok(passed,name);};
const browser=await playwright().chromium.launchPersistentContext(path.join(out,'profile'),{...browserOptions(),headless:true});
try{
 await browser.addInitScript(()=>{globalThis.inputRequests=0;Element.prototype.requestPointerLock=()=>{inputRequests++;throw Error('disabled');};window.focus=()=>{inputRequests++;};});
 const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(pathToFileURL(path.join(out,'index.html')).href);await page.waitForFunction(()=>fixture.state()?.recent?.length===3);
 check('无射线命中仍显示采用结果，两个同名对象保留不同身份',await page.evaluate(()=>fixture.state().target===null&&document.querySelector('[role="list"]').textContent.includes('tree-a')&&document.querySelector('[role="list"]').textContent.includes('tree-b')));
 check('不可见对象有明确状态且不可选择',await page.evaluate(()=>[...document.querySelectorAll('button')].some(button=>button.disabled&&button.textContent.includes('tree-hidden（暂不可见）'))));
 await page.evaluate(()=>fixture.action('树 · tree-a'));await page.waitForFunction(()=>fixture.state()?.source==='recent');
 check('真实回调仅传world和稳定ID，显示目标来源',await page.evaluate(()=>{const call=fixture.calls.filter(item=>item.channel==='godot.creationTarget').at(-1);return call.payload.selection.worldId==='world-a'&&call.payload.selection.entityId==='tree-a'&&Object.keys(call.payload.selection).length===2&&document.body.textContent.includes('已选中最近结果');}));
 await page.evaluate(()=>fixture.remount());await page.waitForFunction(()=>fixture.state()?.target?.entityId==='tree-a'&&document.querySelector('[aria-pressed="true"]'));
 check('组件重开沿用宿主重新采样的显式选择',true);
 await page.evaluate(()=>fixture.action('树 · tree-b'));await page.waitForFunction(()=>fixture.state()?.target?.entityId==='tree-b');
 check('多结果由玩家显式选择，未按同名猜测',true);
 await page.evaluate(()=>fixture.action('使用当前指向'));await page.waitForFunction(()=>fixture.state()?.source==='ray');
 check('返回指向发送明确清除且不保留对象落点',await page.evaluate(()=>fixture.calls.filter(item=>item.channel==='godot.creationTarget').at(-1).payload.selection===null&&fixture.state().target===null));
 await page.evaluate(()=>fixture.action('树 · tree-a'));await page.waitForFunction(()=>fixture.state()?.source==='recent');
 await page.evaluate(()=>fixture.world('world-b'));await page.waitForFunction(()=>fixture.state()?.worldId==='world-b');
 check('切换世界清除旧结果呈现与旧对象选择',await page.evaluate(()=>fixture.state().target===null&&!document.querySelector('[role="list"]')));
 check('没有输入锁定或焦点请求',await page.evaluate(()=>inputRequests===0));check('没有页面错误',errors.length===0);
 await page.evaluate(()=>fixture.world('world-a'));await page.waitForFunction(()=>fixture.state()?.worldId==='world-a');await page.evaluate(()=>document.querySelector('details').open=true);await page.screenshot({path:path.join(out,'recent-results.png')});
}catch(error){errors.push(String(error.stack));process.exitCode=1;}finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({checks,errors,scope:'真实React与fixture传输；正式日志/宿主选择另有确定性测试，原生集成由总控验收'},null,2));console.log(JSON.stringify({out,checks,errors}));}
