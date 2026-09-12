// Actual React list/dialogue hooks, private navigation coordinator and factory.
// Deferred Core-shaped lifecycle replies isolate the observed ACK race. This
// proves observer behavior, not engine success or a real model creation.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire,register} from 'node:module';import {pathToFileURL} from 'node:url';
import {playwright,browserOptions} from '../app/browser-tools.mjs';
register(new URL('../vendor/pi-desktop/apps/desktop/test/helpers/ts-import-hooks.mjs',import.meta.url));
const {createGodotWorldFactory}=await import('../vendor/pi-desktop/apps/desktop/electron/main/godot-world-creation.ts');
const {createGodotPanelCoordinator}=await import('../vendor/pi-desktop/apps/desktop/electron/main/godot-panel-coordinator.ts');
const {invokeCraftmineNavigation}=await import('../vendor/pi-desktop/apps/desktop/electron/main/craftmine-navigation-host.ts');
const root=path.resolve(import.meta.dirname,'..'),desktop=path.join(root,'vendor/pi-desktop/apps/desktop'),require=createRequire(path.join(desktop,'package.json'));
const out=fs.mkdtempSync(path.join(root,'test-results/fb03-retry-observer-')),report={out,checks:[],errors:[],scope:'actual two React entry hooks/coordinator/factory; finite lifecycle replies, no native or model claim'};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const cancelled={worldId:'retry-world',initId:'init-one',status:'cancelled',playable:false,reason:'GODOT_INITIALIZATION_CANCELLED',cancelled:true};
let selected='old-world',current,preparation,gate,coordinator,page,factory,reads=0,notificationWork=[];
const configure=()=>{
 selected='old-world';current=structuredClone(cancelled);preparation={attempt:1,pending:false,error:null,status:current,cancelled:true};gate=deferred();reads=0;notificationWork=[];
 factory=createGodotWorldFactory({worldsRoot:'D:/not-accessed',catalogFile:'D:/not-accessed',basesRoot:'D:/not-accessed',materialize:()=>assert.fail('do not recreate failed source'),
  domain:async method=>{assert.equal(method,'godotWorld.initStatus');reads++;return structuredClone(current);},
  initialization:{running:()=>false,error:()=>null,preparation:()=>preparation,start:()=>gate.promise},
  changed:id=>{assert.equal(id,'retry-world');notificationWork.push(page.evaluate(()=>window.dispatchEvent(new CustomEvent('craftmine-world-changed'))));},
 });
 coordinator=createGodotPanelCoordinator({creation:()=>factory,host:{instance:null},selection:async()=>selected,adapter:{},invoke:async(channel)=>{
  if(channel==='world.list')return {activeWorldId:selected,worlds:[{id:'old-world',title:'Original',state:'ready'},{id:'retry-world',title:'Preserved failed world',runtimeKind:'godot'}]};
  if(channel==='world.createOptions')return {createActions:true,switch:true};if(channel==='workbench.capabilities')return {};if(channel==='task.current')return null;
  throw Error('UNEXPECTED_CHANNEL:'+channel);
 }});
};
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {useCraftmineWorlds} from './src/hooks/use-craftmine-worlds';import {WorldListPanel} from './src/components/craftmine/WorldListPanel';import {useDialogueWorld} from './src/lib/use-dialogue-world';import {DialoguePreparationComposer} from './src/components/DialoguePreparationComposer';import {useAppStore} from './src/stores/app-store';
globalThis.fixture={};globalThis.__craftmineWorldBridge={invoke:(_p,c,a)=>productInvoke(c,a),onChanged:()=>()=>{}};
function Root(){const controller=useCraftmineWorlds('zh'),dialogue=useDialogueWorld();fixture.controller=controller;fixture.dialogue=dialogue;fixture.store=useAppStore;return <><section data-list><WorldListPanel controller={controller} lang="zh" onOpenWorld={()=>{}}/></section><section data-dialogue={dialogue.state?.phase??'none'}>{dialogue.state&&dialogue.state.phase!=='chat'&&<DialoguePreparationComposer draft={dialogue.state.draft} queued={false} failed={dialogue.state.phase==='error'} cancelling={false} onDraft={dialogue.setDraft} onQueue={dialogue.queue} onEdit={dialogue.editQueued} onRetry={dialogue.canRetry?()=>void dialogue.retry():undefined}/>}</section></>;}createRoot(document.getElementById('root')).render(<Root/>);`;
await require('esbuild').build({stdin:{contents:entry,resolveDir:desktop,loader:'tsx'},outfile:path.join(out,'fixture.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',plugins:[{name:'session-seam',setup(b){
 b.onResolve({filter:/^(react|react-dom|zustand)(\/.*)?$/},a=>({path:require.resolve(a.path)}));
 b.onResolve({filter:/app-store(?:\.ts)?$/},()=>({path:'store',namespace:'fixture'}));b.onResolve({filter:/(^|\/)api$/},()=>({path:'api',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},({path:kind})=>({contents:kind==='api'?`export const api={pluginPanelInvoke:(p,c,a)=>productInvoke(c,a)};`:`import {create} from 'zustand';export const useAppStore=create(set=>({activeSessionId:'old-session',isRunning:false,workPanelTabs:[],workPanelWidth:480,setPage(){},setWorkPanelWidth(){},openWorkPanel(){},openWorkPanelTab(){},showToast(){},sendPrompt:async()=>{throw Error('UNEXPECTED_MODEL_REQUEST');}}));export const createCopiedWorldSession=async id=>{useAppStore.setState({activeSessionId:'session-'+id});return 'session-'+id;};export const restoreWorldEntrySession=async id=>useAppStore.setState({activeSessionId:id});`}));
}}]});
fs.writeFileSync(path.join(out,'index.html'),'<meta charset="utf-8"><div id="root"></div><script src="fixture.js"></script>');
let browser;const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);};
try {
 browser=await playwright().chromium.launchPersistentContext(path.join(out,'profile'),{...browserOptions(),headless:true});
 await browser.addInitScript(()=>{globalThis.violations=[];window.focus=()=>violations.push('focus');Element.prototype.requestPointerLock=()=>{violations.push('pointer');throw Error('disabled');};});
 page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));
 await page.exposeFunction('productInvoke',(channel,payload={})=>invokeCraftmineNavigation({pluginId:'craftmine.world',channel,payload},{invoke:async(c,p)=>{
  if(c==='world.create'){selected='retry-world';return {id:selected,title:'Preserved failed world',state:'failed'};}
  if(c==='godot.runtimeState')return {worldId:p.worldId,state:current.playable?'ready':'loading'};
  return coordinator.invoke(c,p);
 },navigate:async request=>{selected=request.operation==='create'?'retry-world':request.id;return {id:selected,title:'Preserved failed world',state:current.playable?'ready':'failed',activeWorldId:selected,ok:true};}}));
 const action=selector=>page.evaluate(selector=>{const button=document.querySelector(selector);if(!button||button.disabled)throw Error('BUTTON_UNAVAILABLE:'+selector);button[Object.keys(button).find(k=>k.startsWith('__reactProps$'))].onClick();},selector);
 for(const mode of ['list','dialogue']) {
  configure();await page.goto(pathToFileURL(path.join(out,'index.html')).href);await page.waitForSelector('[data-world-list-state="ready"]');
  if(mode==='dialogue') {await page.evaluate(()=>fixture.dialogue.start());await page.waitForSelector('[data-dialogue="error"]');await action('[data-dialogue="error"] button');}
  else await action('[data-world-recovery="retry-world"] [data-world-recovery-action="retry"]');
  await page.waitForFunction(()=>fixture.controller.worlds.find(w=>w.id==='retry-world')?.creation?.stage==='retry');
  check(mode+': retry ACK displays preparation while wrapper still has previous cancelled attempt',true);
  preparation={attempt:2,pending:true,error:null,status:null};let before=reads;
  await page.waitForFunction(()=>fixture.controller.worlds.find(w=>w.id==='retry-world')?.state==='initializing');
  await page.evaluate(()=>fixture.controller.refresh());
  assert.ok(reads>before);check(mode+': null first-read baseline remains initializing',await page.evaluate(()=>fixture.controller.worlds.find(w=>w.id==='retry-world').state==='initializing'));
  preparation.previousStatus=cancelled;preparation.status={...cancelled,status:'failed',reason:'GODOT_JOB_ENDED',cancelled:undefined};
  await page.evaluate(()=>fixture.controller.refresh());
  check(mode+': late old-cancelled response after marker-clear does not terminate preparation',await page.evaluate(()=>fixture.controller.worlds.find(w=>w.id==='retry-world').state==='initializing'&&fixture.dialogue.state?.phase!=='error'));
  current={...current,status:'confirmed',playable:true,reason:null,cancelled:undefined};preparation.pending=false;gate.resolve();
  await Promise.all(notificationWork);
  await page.waitForFunction(()=>fixture.controller.worlds.find(w=>w.id==='retry-world')?.state==='ready');
  if(mode==='dialogue'){await page.waitForSelector('[data-dialogue="chat"]',{state:'attached'});assert.equal(await page.evaluate(()=>fixture.store.getState().activeSessionId),'session-retry-world');}
  check(mode+': settled notification reads authoritative ready and resumes the correct entry',true);
 }
 check('no input ownership changes or page exceptions',await page.evaluate(()=>violations.length===0)&&report.errors.length===0);report.passed=true;
} catch(error){report.error=String(error.stack??error);report.lastState=await page?.evaluate(()=>({dialogue:fixture.dialogue.state,worlds:fixture.controller.worlds,text:document.body.innerText})).catch(()=>null);process.exitCode=1;}
finally{await browser?.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.passed,error:report.error}));}

