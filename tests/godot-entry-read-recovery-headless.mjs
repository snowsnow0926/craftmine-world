// Real entry React UI/controller; delayed optional reads must not block navigation.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {playwright,browserOptions} from '../app/browser-tools.mjs';
const repo=path.resolve(import.meta.dirname,'..'),desktop=path.join(repo,'vendor/pi-desktop/apps/desktop');
fs.mkdirSync(path.join(repo,'test-results'),{recursive:true});
const out=fs.mkdtempSync(path.join(repo,'test-results/godot-entry-read-'));
const require=createRequire(path.join(desktop,'package.json'));
const code=`import React from 'react';import{createRoot}from'react-dom/client';import i18n from'i18next';import{initReactI18next}from'react-i18next';import{CraftmineModeEntry}from'./src/components/CraftmineModeEntry';
i18n.use(initReactI18next).init({lng:'en',resources:{en:{translation:{}}},initImmediate:false});
const f=globalThis.fixture={calls:[],opened:[],selected:'world-a',serial:0,taskGate:null,archiveFailure:false,switchFailure:false};
const world=id=>({id,title:id==='world-a'?'Original world':'Other world',state:'ready'});
globalThis.__craftmineWorldBridge={onChanged:()=>()=>{},invoke:async(_plugin,channel,payload)=>{
 f.calls.push({channel,payload});
 if(channel==='world.list')return{activeWorldId:f.selected,worlds:[world('world-a'),world('world-b')]};
 if(channel==='world.createOptions')return{create:true,switch:true,createActions:true,archiveFailed:true,bases:[]};
 if(channel==='workbench.capabilities')return{};
 if(channel==='world.archivedList'){if(f.archiveFailure)throw Error('ARCHIVE_READ_UNAVAILABLE');return{activeWorldId:f.selected,worlds:[]};}
 if(channel==='task.current'){const gate=f.taskGate;if(gate)await gate;return{worldId:payload.worldId,sessionId:'session-'+payload.worldId,taskId:'task-'+payload.worldId,generation:1,running:true};}
 if(channel==='world.switch'){if(f.switchFailure)throw Error('SAVE_REJECTED_FOR_TEST');f.selected=payload.id;return{ok:true,activeWorldId:payload.id};}
 throw Error('UNEXPECTED:'+channel);
}};
window.piDesktop={platform:'win32',on:()=>()=>{},invoke:async()=>({ok:true,data:{}})};
f.holdTask=()=>{f.taskGate=new Promise(resolve=>f.releaseTask=resolve);};
const root=createRoot(document.getElementById('root'));
f.mount=()=>root.render(<CraftmineModeEntry key={++f.serial} onSelect={mode=>f.opened.push(mode)} onDialogue={()=>{}} onCancel={()=>{}}/>);
f.refresh=()=>window.dispatchEvent(new CustomEvent('craftmine-world-changed'));f.holdTask();f.mount();`;
await require('esbuild').build({stdin:{contents:code,resolveDir:desktop,loader:'tsx'},outfile:path.join(out,'fixture.js'),bundle:true,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
fs.writeFileSync(path.join(out,'index.html'),'<div id="root"></div><script src="fixture.js"></script>');
const report={checks:[],errors:[],scope:'Actual React entry and controller with delayed host read receipts; no native/player input claim'};
let browser;const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log(name);};
try{
 browser=await playwright().chromium.launchPersistentContext(path.join(out,'profile'),browserOptions());
 await browser.addInitScript(()=>{globalThis.violations=[];window.focus=()=>violations.push('focus');Element.prototype.requestPointerLock=()=>{violations.push('pointer-lock');throw Error('disabled');};});
 const page=await browser.newPage();page.on('pageerror',error=>report.errors.push(String(error)));
 await page.goto(pathToFileURL(path.join(out,'index.html')).href);
 const wait=fn=>page.waitForFunction(fn,null,{polling:20,timeout:5000});
 const click=selector=>page.evaluate(selector=>{const element=document.querySelector(selector);if(!element||element.disabled)throw Error('CONTROL_UNAVAILABLE:'+selector);return element[Object.keys(element).find(key=>key.startsWith('__reactProps$'))].onClick();},selector);
 await wait(()=>fixture.calls.some(call=>call.channel==='task.current'));
 await click('[data-mode="play"]');
 await wait(()=>document.querySelector('[data-world-list-state="ready"]'));
 check('the actual world entry stays available while the optional task read is pending',await page.evaluate(()=>!document.querySelector('.craftmine-mode-enter-world').disabled));
 await click('.craftmine-mode-enter-world');check('the normal Enter world control can open the verified ready world',await page.evaluate(()=>fixture.opened.at(-1)==='play'));
 await page.evaluate(()=>{fixture.releaseTask();fixture.taskGate=null;fixture.archiveFailure=true;fixture.refresh();});
 await wait(()=>fixture.calls.filter(call=>call.channel==='world.archivedList').length>=2);
 await wait(()=>!!document.querySelector('[data-world-notice="error"]'));
 check('failed archived-world reads preserve the current playable world and entry control',await page.evaluate(()=>document.querySelector('[data-world-list-state]').dataset.worldListState==='ready'&&!document.querySelector('.craftmine-mode-enter-world').disabled));
 await page.evaluate(()=>{fixture.archiveFailure=false;fixture.switchFailure=true;fixture.holdTask();});
 await click('[data-world-id="world-b"]');
 await wait(()=>document.querySelector('[data-world-notice="error"]')?.textContent.includes('SAVE_REJECTED_FOR_TEST'));
 await wait(()=>!document.querySelector('.craftmine-mode-back').disabled);
 check('a failed save/switch unlocks return and retry despite another pending task read',await page.evaluate(()=>document.querySelector('[data-world-id="world-a"]').dataset.worldActive==='true'&&!document.querySelector('[data-world-id="world-b"]').disabled));
 await page.evaluate(()=>{fixture.switchFailure=false;});
 await click('[data-world-id="world-b"]');
 await wait(()=>document.querySelector('.craftmine-mode-enter-world').dataset.activeWorld==='world-b'&&!document.querySelector('.craftmine-mode-enter-world').disabled);
 await click('.craftmine-mode-enter-world');check('the player can retry the original switch through the same world-row control',await page.evaluate(()=>fixture.selected==='world-b'&&fixture.opened.length===2));
 await page.evaluate(()=>{fixture.releaseTask();fixture.taskGate=null;});
 await wait(()=>document.querySelector('[data-world-id="world-b"]').textContent.includes('Task'));
 check('late metadata from the old selection cannot replace the newly entered world',await page.evaluate(()=>document.querySelector('[data-world-id="world-b"]').dataset.worldActive==='true'&&!document.querySelector('[data-world-id="world-a"]').textContent.includes('Task')));
 check('no input ownership violations or page errors',await page.evaluate(()=>violations.length===0)&&report.errors.length===0);report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{await browser?.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.passed,error:report.error}));}
