// Actual create form and worlds controller. Host RPCs are deferred to exercise
// acknowledgement/cancellation ordering; no native or model acceptance claim.
import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {playwright,browserOptions} from '../app/browser-tools.mjs';
const root=path.resolve(import.meta.dirname,'..'),desktop=path.join(root,'vendor/pi-desktop/apps/desktop'),require=createRequire(path.join(desktop,'package.json'));
const out=fs.mkdtempSync(path.join(root,'test-results/create-form-cancel-')),report={out,checks:[],errors:[],scope:'real React form/controller with deferred host calls; no native runtime'};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
let selected='world-old',created=false,newState='initializing',cancelled=false,creationGate=deferred(),cancelGate=deferred(),cancelCalls=0;
const calls=[];
const invoke=async(channel,payload)=>{
 if(channel==='world.list')return {activeWorldId:selected,worlds:[{id:'world-old',title:'Original world',state:'ready'},...(created?[{id:'world-new',title:'Keep this name',state:newState,creation:{operationId:'new-op',stage:cancelled?'cancelled':'build',stages:[],progress:0,error:newState==='failed'?{code:cancelled?'GODOT_INITIALIZATION_CANCELLED':'CHECK_FAILED',message:'Preparation stopped',stage:'build',recoverable:true}:null,actions:['retry']}}]:[])]};
 if(channel==='world.createOptions')return {create:true,switch:true,bases:[{id:'creation-sandbox',label:'3D',delivered:true,starters:[{id:'blank',label:'Blank',delivered:true}]}]};
 if(channel==='workbench.capabilities')return {};if(channel==='task.current')return null;
 if(channel==='world.create'){calls.push(['create',payload]);await creationGate.promise;created=true;selected='world-new';return {id:'world-new',title:payload.title,state:newState};}
 if(channel==='world.creationCancel'){calls.push(['cancel',payload.worldId]);assert.equal(payload.worldId,'world-new');if(++cancelCalls===1)await cancelGate.promise;cancelled=true;newState='failed';return {worldId:payload.worldId,status:'cancelled'};}
 if(channel==='world.switch'){calls.push(['switch',payload.id]);assert.equal(cancelled,true,'return must wait for cancellation');selected=payload.id;return {ok:true,activeWorldId:selected};}
 throw Error('UNEXPECTED:'+channel);
};
const entry=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {useCraftmineWorlds} from './src/hooks/use-craftmine-worlds';import {WorldCreatePanel} from './src/components/craftmine/WorldCreatePanel';globalThis.__craftmineWorldBridge={invoke:(_p,c,a)=>productInvoke(c,a),onChanged:()=>()=>{}};function Test(){const c=useCraftmineWorlds('zh');const[open,setOpen]=useState(true);globalThis.controller=c;return <div data-ready={c.status} data-open={String(open)}>{open&&<WorldCreatePanel controller={c} lang="zh" onClose={()=>setOpen(false)} onCreated={async()=>{}}/>}{c.error&&<p role="alert">{c.error}</p>}{c.notice&&<p role="status">{c.notice}</p>}</div>}createRoot(document.getElementById('root')).render(<Test/>);`;
await require('esbuild').build({stdin:{contents:entry,resolveDir:desktop,loader:'tsx'},outfile:path.join(out,'form.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic'});
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/form.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/form.js'?fs.readFileSync(path.join(out,'form.js')):'<meta charset="utf-8"><div id="root"></div><script src="/form.js"></script>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);};
try{
 browser=await playwright().chromium.launchPersistentContext(path.join(out,'profile'),{...browserOptions(),headless:true});await browser.addInitScript(()=>{globalThis.inputViolations=[];window.focus=()=>inputViolations.push('focus');Element.prototype.requestPointerLock=()=>{inputViolations.push('pointer');throw Error('disabled');};});
 const page=await browser.newPage();page.on('pageerror',error=>report.errors.push(String(error)));await page.exposeFunction('productInvoke',invoke);
 const url='http://127.0.0.1:'+server.address().port;
 const submit=async()=>{await page.waitForSelector('[data-ready="ready"]');await page.evaluate(()=>{const input=document.querySelector('[data-world-create=name]');input[Object.keys(input).find(key=>key.startsWith('__reactProps$'))].onChange({target:{value:'Keep this name'}});});await page.waitForFunction(()=>document.querySelector('[data-world-create=name]').value==='Keep this name');await page.evaluate(()=>{const form=document.querySelector('form');form[Object.keys(form).find(key=>key.startsWith('__reactProps$'))].onSubmit({preventDefault(){}});});};
 const cancel=()=>page.evaluate(()=>{const button=document.querySelector('[data-action=cancel-world-create]');if(button.disabled)throw Error('CANCEL_DISABLED');button[Object.keys(button).find(key=>key.startsWith('__reactProps$'))].onClick();});
 await page.goto(url);await submit();await page.waitForFunction(()=>controller.busy);await cancel();
 check('Cancel before create ACK keeps the named form open and does not return early',await page.locator('[data-open=true]').count()===1&&!calls.some(([op])=>op==='switch'||op==='cancel'));
 creationGate.resolve();await page.waitForFunction(()=>document.querySelector('[role=status]')?.textContent.includes('取消'));
 while(cancelCalls===0)await new Promise(resolve=>setTimeout(resolve,10));
 check('the owned world cancellation runs before any return navigation',!calls.some(([op])=>op==='switch'));
 cancelGate.reject(Error('GODOT_INITIALIZATION_CANCEL_UNCONFIRMED'));await page.waitForFunction(()=>!controller.busy&&!!controller.error);
 check('failed cancellation retains the form and exact name for retry',await page.locator('[data-open=true]').count()===1&&await page.locator('[data-world-create=name]').inputValue()==='Keep this name');
 await cancel();await page.waitForSelector('[data-open=false]');check('retrying Cancel uses the same world and returns only after success',cancelCalls===2&&selected==='world-old'&&calls.filter(([op])=>op==='create').length===1&&calls.at(-1)[0]==='switch');
 selected='world-old';created=false;newState='failed';cancelled=false;creationGate=deferred();creationGate.resolve();cancelCalls=1;calls.length=0;
 await page.goto(url);await submit();await page.waitForFunction(()=>!controller.busy&&!!controller.error);await cancel();await page.waitForSelector('[data-open=false]');
 check('closing a form after preparation failed still cancels the retained attempt before returning',calls.some(([op])=>op==='cancel')&&calls.at(-1)[0]==='switch'&&selected==='world-old'&&created);
 check('no focus, pointer lock or page errors',await page.evaluate(()=>inputViolations.length===0)&&report.errors.length===0);report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));report.calls=calls;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.passed,error:report.error}));}
