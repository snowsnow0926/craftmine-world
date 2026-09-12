// Actual React worlds controller -> main navigation gateway -> retained view
// -> actual Godot coordinator. A finite native/domain fixture records saves
// and selection; no simulated physical input or claim of a real engine build.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import http from 'node:http';
import {createRequire,register} from 'node:module';import {playwright,browserOptions} from '../app/browser-tools.mjs';
const root=path.resolve(import.meta.dirname,'..'),desktop=path.join(root,'vendor/pi-desktop/apps/desktop'),require=createRequire(path.join(desktop,'package.json'));
register(new URL('../vendor/pi-desktop/apps/desktop/test/helpers/ts-import-hooks.mjs',import.meta.url));
const {invokeCraftmineNavigation}=await import('../vendor/pi-desktop/apps/desktop/electron/main/craftmine-navigation-host.ts');
const {createGodotPanelCoordinator}=await import('../vendor/pi-desktop/apps/desktop/electron/main/godot-panel-coordinator.ts');
const out=fs.mkdtempSync(path.join(root,'test-results/world-retry-')),report={out,checks:[],errors:[],scope:'real controller, gateway, retained view and coordinator; finite native/domain fixture'};
const record=id=>({id,title:id,revision:1,runtimeKind:'godot',base:{id:'creation-sandbox',delivered:true},world:{build:{id:'build-'+id,engine:{kind:'godot-web'}},snapshot:{coins:12}}});
const worlds=[record('world-live'),record('world-failed')];let selected='world-live',instance={worldId:selected,buildId:'build-'+selected,instanceId:'instance-live'},failSave=null,failRead=null,retries=0;
// This is the core's durable placeholder marker (godot_worlds.rs), not a
// failed already-built runtime. The retained view uses it for safe return.
worlds[1].world.build.godot={baseBuild:'creation-sandbox-1.0.0',initializing:true};
const calls=[];let failedState='failed';
const native={get instance(){return instance;},get state(){return instance?{...instance,state:'ready'}:null;},holdSelectionSync:async()=>()=>{},
  checkpoint:async()=>{calls.push('checkpoint:'+selected);if(failSave)return{status:'failed',error:failSave};return{status:'persisted',receipt:{worldId:selected,buildId:instance.buildId,revision:1}};},
  save:async()=>native.checkpoint(),pause:async()=>{},resume:async()=>{},setSurfaceVisible:()=>{},switchWorld:async next=>{calls.push('native:'+(next?.worldId??'none'));instance=next?{worldId:next.worldId,buildId:next.buildId,instanceId:'instance-'+next.worldId}:null;}};
const creation={options:{bases:[]},status:async id=>id==='world-failed'?{state:failedState,creation:{operationId:'init-failed',stage:'check',progress:0,actions:['retry'],error:{code:'CHECK_FAILED',message:'check failed',stage:'check',recoverable:true}}}:null,
  retry:async id=>{calls.push('retry:'+id);assert.equal(selected,id);retries++;failedState='initializing';}};
const coordinator=createGodotPanelCoordinator({host:native,creation:()=>creation,selection:async()=>selected,
  adapter:{describe:async id=>({worldId:id,buildId:'build-'+id})},invoke:async(channel,args)=>{
    if(channel==='world.list')return{worlds,activeWorldId:selected};
    if(channel==='world.read'){if(failRead)throw Error(failRead);return worlds.find(w=>w.id===args.id);}
    if(channel==='world.open'){calls.push('select:'+args.id);selected=args.id;return worlds.find(w=>w.id===args.id);}
    if(channel==='godot.candidateClose')return{status:'none'};
    if(channel==='workbench.capabilities')return{switch:true,createActions:true};
    if(channel==='world.createOptions')return{switch:true,createActions:true};
    if(channel==='task.current')return null;
    return{};
  }});
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {useCraftmineWorlds} from './src/hooks/use-craftmine-worlds';
globalThis.__craftmineWorldBridge={invoke:(_plugin,channel,payload)=>productInvoke(channel,payload),onChanged:()=>()=>{}};
function Test(){const controller=useCraftmineWorlds('zh');globalThis.controller=controller;return <div data-state={controller.status} data-active={controller.activeWorldId} data-busy={String(controller.busy)}>{controller.error&&<p role="alert">{controller.error}</p>}{controller.notice&&<p role="status">{controller.notice}</p>}<button onClick={()=>controller.creationAction('world-failed','retry')}>重试失败世界</button></div>}
createRoot(document.getElementById('root')).render(<Test/>);`;
await require('esbuild').build({stdin:{contents:entry,resolveDir:desktop,loader:'tsx'},outfile:path.join(out,'controller.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',plugins:[{name:'react',setup(build){build.onResolve({filter:/^(react|react-dom)(\/.*)?$/},args=>({path:require.resolve(args.path)}));}}]});
await require('esbuild').build({entryPoints:[path.join(root,'plugins/craftmine-world/view.mjs')],outfile:path.join(out,'view.js'),bundle:true,platform:'browser',format:'iife',define:{CRAFTMINE_BOOT_WORLD:'{}',CRAFTMINE_GAME_DOCUMENT:'""',CRAFTMINE_INPUT_GUARD:'""'}});
fs.copyFileSync(path.join(root,'plugins/craftmine-world/world.html'),path.join(out,'world.html'));fs.writeFileSync(path.join(out,'index.html'),'<html><meta charset="utf-8"><div id="root"></div><script src="controller.js"></script></html>');
const server=http.createServer((req,res)=>{const file=path.join(out,path.basename(req.url));if(!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/html; charset=utf-8');res.end(fs.readFileSync(file));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);};
try{
 browser=await playwright().chromium.launchPersistentContext(path.join(out,'profile'),{...browserOptions(),headless:true});
 await browser.addInitScript(()=>{globalThis.inputViolations=[];window.focus=()=>inputViolations.push('focus');Element.prototype.requestPointerLock=()=>{inputViolations.push('pointer');throw Error('disabled');};});
 const product=await browser.newPage();product.on('pageerror',e=>report.errors.push(String(e)));
 await product.exposeFunction('nativeInvoke',(channel,args={})=>coordinator.invoke(channel,args));
 await product.addInitScript(()=>{globalThis.pluginBridge={invoke:(channel,args)=>nativeInvoke(channel,args),on(){}};});
 const url='http://127.0.0.1:'+server.address().port;await product.goto(url+'/world.html');await product.waitForFunction(()=>document.body.dataset.worldLoaded==='true');
 const main=await browser.newPage();main.on('pageerror',e=>report.errors.push(String(e)));
 await main.exposeFunction('productInvoke',(channel,payload={})=>invokeCraftmineNavigation({pluginId:'craftmine.world',channel,payload},{invoke:(c,p)=>coordinator.invoke(c,p),navigate:request=>product.evaluate(request=>craftmineView.navigate(request),request)}));
 await main.goto(url+'/index.html');await main.waitForSelector('[data-state="ready"]');
 const retry=()=>main.evaluate(()=>{const b=document.querySelector('button');return b[Object.keys(b).find(k=>k.startsWith('__reactProps$'))].onClick();});
 calls.length=0;await main.evaluate(()=>controller.select('world-failed'));
 check('ordinary selection still refuses failed worlds',selected==='world-live'&&retries===0&&calls.length===0);
 await retry();await main.waitForSelector('[data-busy="false"][data-active="world-failed"]');
 assert.ok(calls.indexOf('checkpoint:world-live')>=0&&calls.indexOf('checkpoint:world-live')<calls.indexOf('select:world-failed')&&calls.indexOf('select:world-failed')<calls.indexOf('retry:world-failed'));
 check('explicit retry saves the old world, opens the failed placeholder, then reaches scoped native retry',selected==='world-failed'&&retries===1&&instance===null);
 await product.evaluate(()=>craftmineView.navigate({operation:'switch',id:'world-live'}));await main.evaluate(()=>controller.refresh());await product.waitForFunction(()=>document.body.dataset.worldLoaded==='true');
 check('a failed/initializing placeholder can return to the old saved world without inventing a runtime',selected==='world-live'&&instance.worldId==='world-live');
 failSave='CURRENT_SAVE_FAILED';calls.length=0;await retry();await main.waitForSelector('[role="alert"]');
 check('current save failure prevents both failed-world selection and retry',selected==='world-live'&&retries===1&&!calls.includes('select:world-failed')&&(await main.locator('[role="alert"]').textContent()).includes('CURRENT_SAVE_FAILED'));
 failSave=null;failRead='UNKNOWN_STORAGE_FAILURE';calls.length=0;await retry();
 check('an unknown read failure is reported and never swallowed to retry',selected==='world-live'&&retries===1&&(await main.locator('[role="alert"]').textContent()).includes('UNKNOWN_STORAGE_FAILURE'));
 failRead=null;await retry();await main.waitForSelector('[data-busy="false"][data-active="world-failed"]');
 check('recovery can retry successfully after the actual failure is resolved',selected==='world-failed'&&retries===2);
 await assert.rejects(coordinator.invoke('world.creationRetry',{worldId:'world-live'}),/GODOT_WORLD_CHANGED/);
 check('host still refuses retry for an unselected identity',retries===2);
 check('no input ownership changes or page exceptions',await main.evaluate(()=>!inputViolations.length)&&await product.evaluate(()=>!inputViolations.length)&&report.errors.length===0);report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));report.calls=calls;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.passed,error:report.error}));}
