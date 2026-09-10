// Actual target/creation components and app store with fixture transport.
// All transitions call page-script functions; no browser input APIs or microphone.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {playwright,browserOptions} from '../app/browser-tools.mjs';
const desktop=path.resolve('vendor/pi-desktop/apps/desktop');
fs.mkdirSync('test-results',{recursive:true});
const output=fs.mkdtempSync(path.resolve('test-results/creation-ui-'));
const require=createRequire(path.join(desktop,'package.json'));
const script=`
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import i18n from'i18next';import{initReactI18next}from'react-i18next';import{catalogs,flattenCatalog}from'@pi-desktop/i18n';
import{useCreationTarget}from'./src/hooks/use-creation-target';import{CreationTargetContext}from'./src/components/CreationTargetContext';
import{WorldCreatePanel}from'./src/components/craftmine/WorldCreatePanel';import{CraftmineOverlayControls}from'./src/components/CraftmineOverlayControls';
import{parseWorldCapabilities}from'./src/lib/craftmine-worlds';import{creationRequestContext}from'./src/lib/creation-target';
import{useAppStore}from'./src/stores/app-store';import{api}from'./src/lib/api';
let selected={captureId:'capture-a',worldId:'world-a',target:{entityId:'tree-a',position:[1,0,2],normal:[0,1,0],surface:'entity',revision:1}};
let policies=new Map(),reads=0,writes=[],sent=[],hold=false,release=null,controller,changeSession,changeEnabled;
globalThis.__craftmineWorldBridge={invoke:async(_,channel,payload)=>{
 if(channel==='godot.creationTarget'){reads++;const value=structuredClone(selected);if(hold){hold=false;return new Promise(resolve=>{release=()=>resolve(value);});}return value;}
 if(channel==='godot.creationPolicy'){if('autoApply'in payload){if(payload.worldId!==selected.worldId)throw Error('WORLD_CHANGED');writes.push(payload);policies.set(selected.worldId,payload.autoApply);}return{worldId:selected.worldId,autoApply:policies.get(selected.worldId)??false};}
 return{};
},onChanged:()=>()=>{}};
api.prompt=async input=>{sent.push(structuredClone(input));return{};};
useAppStore.setState({activeSessionId:'session-a',sessions:[{id:'session-a',title:'Fixture conversation',mode:'agent',projectPath:'D:/fixture'}],messages:[],pendingPlans:{},runningSessions:{'session-a':true},isRunning:true,agentStatuses:{'session-a':{sessionId:'session-a',isRunning:true,pendingToolConfirmations:0,activity:{phase:'waiting-model',since:0}}}});
const capabilities=parseWorldCapabilities({bases:[{id:'creation-sandbox',label:'Creation sandbox',delivered:true,starters:[{id:'blank',label:'Blank',delivered:true}]},{id:'future-base',label:'Future',delivered:false,starters:[]}],starters:[{id:'wrong-template',label:'Wrong template',delivered:true}]});
function Fixture(){const[session,setSession]=useState('session-a');const[enabled,setEnabled]=useState(true);controller=useCreationTarget(enabled,session);changeSession=setSession;changeEnabled=setEnabled;return <main style={{maxWidth:700,margin:'30px auto'}}><CraftmineOverlayControls/><CreationTargetContext controller={controller}/><WorldCreatePanel controller={{capabilities,busy:false,create:async()=>true}} lang="zh" onClose={()=>{}}/></main>;}
globalThis.fixture={get:()=>({capture:controller.capture,reads,writes,sent,policy:controller.policy}),refresh:()=>controller.refresh(),policy:value=>controller.changePolicy(value),target:value=>{selected=value;},enable:value=>changeEnabled(value),session:value=>changeSession(value),hold:()=>{hold=true;},release:()=>release?.(),
 async queue(){const context=creationRequestContext(controller.capture);await useAppStore.getState().sendPrompt('Create here',{text:'Create here',fileReferences:[]},'session-a',context);context.creationTarget.captureId='mutated-after-submit';return useAppStore.getState().queuedPrompts['session-a'][0];},
 async sendQueued(){useAppStore.setState({runningSessions:{},isRunning:false});const queued=useAppStore.getState().queuedPrompts['session-a'][0];await useAppStore.getState().sendQueuedNow(queued.id);},
 stage:()=>useAppStore.setState({isRunning:true,agentStatuses:{'session-a':{sessionId:'session-a',isRunning:true,pendingToolConfirmations:1}}}),
};
async function mount(){await i18n.use(initReactI18next).init({lng:'zh-CN',fallbackLng:'en',resources:Object.fromEntries(Object.entries(catalogs).map(([key,value])=>[key,{translation:flattenCatalog(value)}])),interpolation:{escapeValue:false}});createRoot(document.getElementById('root')).render(<Fixture/>);}void mount();
`;
await require('esbuild').build({stdin:{contents:script,resolveDir:desktop,loader:'jsx'},outfile:path.join(output,'fixture.js'),bundle:true,platform:'browser',format:'iife',target:'chrome130',define:{'process.env.NODE_ENV':'"production"'}});
const assets=path.join(desktop,'out/renderer/assets'),css=fs.readdirSync(assets).find(name=>/^index-.*\.css$/.test(name));
assert.ok(css,'build desktop stylesheet first');
fs.writeFileSync(path.join(output,'index.html'),`<!doctype html><html lang="zh-CN" data-theme="dark" data-platform="win32"><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(path.join(assets,css)).href}"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`);
const errors=[],checks=[];
const check=(name,value)=>{checks.push({name,passed:!!value});assert.ok(value,name);console.log('PASS '+name);};
const browser=await playwright().chromium.launchPersistentContext(path.join(output,'profile'),{...browserOptions(),headless:true,viewport:{width:1100,height:900},reducedMotion:'reduce'});
try{
 await browser.addInitScript(()=>{globalThis.inputRequests=0;Element.prototype.requestPointerLock=()=>{inputRequests++;throw Error('Pointer lock disabled');};window.focus=()=>{inputRequests++;};window.piDesktop={platform:'win32',on:()=>()=>{},invoke:async()=>({ok:true,data:{}})};});
 const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(pathToFileURL(path.join(output,'index.html')).href);
 await page.waitForFunction(()=>fixture.get().policy&&document.querySelector('[data-creation-target="entity"]'));
 check('actual creation UI exposes only delivered creation-world choice and one blank starter',await page.evaluate(()=>document.querySelector('[data-world-base-option="creation-sandbox"]').textContent.includes('造物世界')&&document.querySelector('[data-world-base-option="future-base"] input').disabled&&document.querySelectorAll('[data-world-starter-option="blank"]').length===1&&!document.querySelector('[data-world-starter-option="wrong-template"]')));
 check('actual target shows the sampled entity and coordinates',await page.evaluate(()=>document.querySelector('.creation-target-row').textContent.includes('tree-a · 1.0, 0.0, 2.0')));
 await page.screenshot({path:path.join(output,'creation-target-selected.png')});
 check('world auto-apply starts off and viewing UI does not grant consent',await page.evaluate(()=>!document.querySelector('.creation-policy input').checked&&fixture.get().writes.length===0));
 const queued=await page.evaluate(()=>fixture.queue());check('store queues an immutable opaque capture',queued.requestContext.creationTarget.captureId==='capture-a');
 await page.evaluate(()=>{fixture.target({captureId:'capture-b',worldId:'world-a',target:{entityId:null,position:[8,0,9],normal:[0,1,0],surface:'ground',revision:2}});return fixture.refresh();});
 await page.waitForFunction(()=>document.querySelector('[data-creation-target="ground"]'));
 await page.evaluate(()=>fixture.sendQueued());
 check('queued send uses original target after subsequent camera snapshot',await page.evaluate(()=>fixture.get().sent.length===1&&fixture.get().sent[0].requestContext.creationTarget.captureId==='capture-a'&&fixture.get().sent[0].sessionId==='session-a'));
 await page.evaluate(()=>fixture.policy(true));
 await page.waitForFunction(()=>document.querySelector('.creation-policy input').checked);
 check('consent mutation explicitly names its world',await page.evaluate(()=>fixture.get().writes.length===1&&fixture.get().writes[0].worldId==='world-a'&&fixture.get().writes[0].autoApply===true));
 await page.evaluate(()=>{fixture.hold();void fixture.refresh();});
 await page.waitForFunction(()=>fixture.get().capture===null);
 await page.evaluate(()=>{fixture.target({captureId:'capture-c',worldId:'world-b',target:null});fixture.session('session-b');});
 await page.waitForFunction(()=>fixture.get().capture?.captureId==='capture-c');
 await page.evaluate(()=>fixture.release());
  check('late old-session sample never replaces new world capture',await page.evaluate(()=>fixture.get().capture.worldId==='world-b'));
 check('consent does not carry over to another world',await page.evaluate(()=>!document.querySelector('.creation-policy input').checked));
 check('no hit remains no selected location without an invented origin',await page.evaluate(()=>document.querySelector('[data-creation-target="none"]').textContent.includes('未选中位置')&&!document.querySelector('.creation-target-row').textContent.includes('0.0')));
 await page.evaluate(()=>{fixture.target({captureId:null,worldId:'world-b',target:null,reason:'UNSUPPORTED_BASE'});return fixture.refresh();});
 check('unsupported target is visibly unavailable',await page.evaluate(()=>document.querySelector('.creation-target-note').textContent.includes('暂不可用')));
 await page.evaluate(()=>fixture.stage());
 await page.waitForFunction(()=>document.querySelector('[data-task-stage="approval"]'));
 check('closed-mode task indicator uses actual approval state',true);
 await page.screenshot({path:path.join(output,'creation-target.png')});
 await page.evaluate(()=>fixture.enable(false));
 await page.waitForFunction(()=>fixture.get().capture===null);
 check('closing context releases renderer capture',true);
 check('no input or focus requests',await page.evaluate(()=>inputRequests===0));
 check('no unhandled UI errors',errors.length===0);
}catch(error){errors.push(error.stack);console.error(error);process.exitCode=1;}finally{await browser.close();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({scope:'Actual React components/store with fixture native transport; no live engine, task, or microphone',checks,errors},null,2));console.log('Report: '+output);}
