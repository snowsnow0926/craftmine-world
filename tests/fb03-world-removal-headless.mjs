// Real list component/controller -> navigation gate -> deletion service ->
// private JS router -> actual Rust process. Native navigation is a finite
// callback fixture; this test does not claim Electron/Godot input acceptance.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import http from 'node:http';
import {createRequire,register} from 'node:module';import {playwright,browserOptions} from '../app/browser-tools.mjs';
import {createCraftmineWorldRemoval} from '../vendor/pi-desktop/apps/desktop/electron/main/craftmine-world-removal.ts';
register(new URL('../vendor/pi-desktop/apps/desktop/test/helpers/ts-import-hooks.mjs',import.meta.url));
const {invokeCraftmineNavigation}=await import('../vendor/pi-desktop/apps/desktop/electron/main/craftmine-navigation-host.ts');
const {PluginRuntime}=await import('../vendor/pi-desktop/apps/desktop/electron/main/plugin-runtime.ts');
const root=path.resolve(import.meta.dirname,'..'),desktop=path.join(root,'vendor/pi-desktop/apps/desktop'),require=createRequire(path.join(desktop,'package.json'));
const out=fs.mkdtempSync(path.join(root,'test-results/fb03-world-removal-')),report={out,checks:[],errors:[],scope:'actual React list/controller, navigation service and Rust persistence; no native engine claim'};
const coreFile=path.resolve(process.env.CRAFTMINE_CORE_BINARY??path.join(root,'test-results/cargo-target/debug/craftmine-core.exe'));
const {CoreClient}=createRequire(import.meta.url)('../plugins/craftmine-world/core-client.cjs');
await require('esbuild').build({entryPoints:[path.join(root,'plugins/craftmine-world/host-requests.cjs')],outfile:path.join(out,'host-router.cjs'),bundle:true,platform:'node',format:'cjs',plugins:[{name:'domain',setup(build){build.onResolve({filter:/^\.\/domain\.cjs$/},()=>({path:path.join(root,'plugins/craftmine-world/domain-adapter.mjs')}));}}]});
const {createHostRequests}=createRequire(import.meta.url)(path.join(out,'host-router.cjs'));
const core=new CoreClient(coreFile,path.join(out,'domain'));await core.start();
let selected='healthy',blocked=false;const calls=[],selectionFile=path.join(out,'selection.json');
const select=id=>{selected=id;fs.writeFileSync(selectionFile,JSON.stringify({activeWorldId:id}));};select(selected);
const privateRouter=createHostRequests(core,{getSettings:async()=>({activeWorldId:selected})});
const pluginRuntime=new PluginRuntime({});
const loaded={manifest:{id:'craftmine.world'},pending:new Map(),nextCallId:1,child:{postMessage(message){
  Promise.resolve().then(()=>privateRouter(message.payload.method,message.payload.params)).then(value=>pluginRuntime.handleChildMessage(loaded,{t:'res',id:message.id,ok:true,value}),error=>pluginRuntime.handleChildMessage(loaded,{t:'res',id:message.id,ok:false,error:{code:error.code??'FAILED',message:error.message}}));
}}};pluginRuntime.loaded.set('craftmine.world',loaded);
const host=(method,params)=>pluginRuntime.requestCraftmineHost(method,params);
const worldId='failed-world',context={projectId:'archive-test',sessionId:'failed-session',turnId:'failed-turn'};
const snapshot={format:'craftmine.godot-progress/1',worldId,baseId:'first-person',baseVersion:'0.1.0',stateVersion:1,body:{worldId,player:{position:[0,0,0]},inventory:{}}};
const healthyWorld={build:{id:'healthy-build',scene:{format:'craftmine.scene/3',objects:[]}},snapshot:{format:'craftmine.progress/1',player:{x:.5,y:6,z:12.5,yaw:0,pitch:0}},extensions:[]};
await core.call('world.create',{id:'healthy',title:'Healthy world',world:healthyWorld});
await core.call('godotWorld.initialize',{worldId,title:'Failed generated world',baseId:'first-person',baseBuild:'base-a',snapshot});
await host('turn.begin',{context,selectedWorld:worldId,request:{id:'failed-request',text:'Create a world'}});
const project=await core.call('godotProject.create',{context,worldId,toolCallId:'create-source',baseBuild:'base-a',baseId:'first-person',files:[{path:'project.godot',text:'config_version=5\n[application]\nrun/main_scene="res://main.tscn"\n'},{path:'main.tscn',text:'[gd_scene format=3]\n[node name="Main" type="Node3D"]\n'},{path:'world.gd',text:'extends Node3D\nvar valuable_draft := 12\n'}]});
await core.call('content.migrate.apply',{worldId});
report.fixtureJob=await core.call('godotBuild.start',{context,worldId,toolCallId:'check-source',revision:project.revision,manifestHash:project.manifestHash,mode:'check'});
assert.equal(report.fixtureJob.status,'blocked','real core execution gate, no fabricated engine result');
await core.call('workspace.endTurn',{sessionId:context.sessionId,turnId:context.turnId,status:'error'});
report.before={world:await host('world.read',{id:worldId}),content:await host('content.status',{worldId})};
const list=async()=>({activeWorldId:selected,worlds:await Promise.all((await core.call('world.list')).map(async world=>{if(world.id===worldId){const state=await core.call('godotWorld.initStatus',{worldId});assert.ok(['failed','blocked'].includes(state.status));return {...world,state:'failed',creation:{operationId:'fixture-init',stage:'check',stages:[],progress:0,actions:['retry'],error:{code:state.reason,message:state.reason,stage:'check',recoverable:true}}};}return {...world,state:'ready'};}))});
const service=createCraftmineWorldRemoval({domain:host,list,selection:async()=>selected,blocked:()=>blocked?'WORLD_REMOVAL_BUSY':null,settleMaintenance:async()=>{},createFallback:async()=>{throw Error('UNEXPECTED_FALLBACK');},navigate:async id=>{calls.push(['navigate',id]);assert.ok(service.permitsOpen(id));assert.equal((await host('world.archiveStatus',{id})).archived,false);select(id);},changed:()=>calls.push(['changed'])});
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {useCraftmineWorlds} from './src/hooks/use-craftmine-worlds';import {WorldListPanel} from './src/components/craftmine/WorldListPanel';globalThis.__craftmineWorldBridge={invoke:(_p,c,a)=>productInvoke(c,a),onChanged:()=>()=>{}};function Test(){const c=useCraftmineWorlds('zh');globalThis.controller=c;return <WorldListPanel controller={c} lang="zh" onOpenWorld={()=>{}}/>}createRoot(document.getElementById('root')).render(<Test/>);`;
await require('esbuild').build({stdin:{contents:entry,resolveDir:desktop,loader:'tsx'},outfile:path.join(out,'controller.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic'});
fs.writeFileSync(path.join(out,'index.html'),'<html><meta charset="utf-8"><div id="root"></div><script src="controller.js"></script></html>');
const server=http.createServer((req,res)=>{const file=path.join(out,path.basename(req.url));if(!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/html;charset=utf-8');res.end(fs.readFileSync(file));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);};
try{
 browser=await playwright().chromium.launchPersistentContext(path.join(out,'browser-profile'),{...browserOptions(),headless:true});
 await browser.addInitScript(()=>{globalThis.inputViolations=[];window.focus=()=>inputViolations.push('focus');Element.prototype.requestPointerLock=()=>{inputViolations.push('pointer');throw Error('disabled');};});
 const page=await browser.newPage();page.on('pageerror',error=>report.errors.push(String(error)));
 await page.exposeFunction('productInvoke',(channel,payload={})=>invokeCraftmineNavigation({pluginId:'craftmine.world',channel,payload},{invoke:async(c,p)=>{
  if(c==='world.list')return list();if(c==='world.createOptions')return {create:true,switch:true,createActions:true,archiveFailed:true};if(c==='workbench.capabilities')return {};if(c==='task.current')return null;return service.invoke(c,p);
 }}));
 const url='http://127.0.0.1:'+server.address().port+'/index.html';await page.goto(url);await page.waitForSelector('[data-world-list-state="ready"]');
 const click=selector=>page.evaluate(selector=>{const button=document.querySelector(selector);if(!button||button.disabled)throw Error('BUTTON_UNAVAILABLE:'+selector);return button[Object.keys(button).find(key=>key.startsWith('__reactProps$'))].onClick();},selector);
 check('failed row offers Delete with the reversible-files explanation',await page.locator('[data-world-delete="failed-world"]').textContent()==='删除'&&(await page.locator('[data-world-delete="failed-world"]').getAttribute('title')).includes('原文件暂保留'));
 blocked=true;await click('[data-world-delete="failed-world"]');await page.waitForSelector('[role="alert"]');check('active work refusal remains visible and does not remove the row',!(await host('world.archiveStatus',{id:worldId})).archived&&await page.locator('[data-world-id="failed-world"]').count()===1);blocked=false;
 await click('[data-world-delete="failed-world"]');await page.waitForSelector('[data-deleted-world-id="failed-world"]',{state:'attached'});check('actual list button reaches Rust and moves the failed world to Recently deleted',await page.locator('[data-world-id="failed-world"]').count()===0&&(await host('world.archiveStatus',{id:worldId})).archived===true);
 await core.stop();await core.start();selected=JSON.parse(fs.readFileSync(selectionFile)).activeWorldId;await page.reload();await page.waitForSelector('[data-deleted-world-id="failed-world"]',{state:'attached'});check('removed status survives a real Rust restart and controller reload',await page.locator('[data-world-id="failed-world"]').count()===0);
 await page.evaluate(()=>{document.querySelector('[data-recently-deleted]').open=true;});await click('[data-world-restore="failed-world"]');await page.waitForSelector('[data-world-delete="failed-world"]');check('Restore returns the original failed row without switching worlds or retrying it',selected==='healthy'&&(await core.call('godotBuild.latest',{worldId})).jobId===report.fixtureJob.jobId);
 select(worldId);await page.evaluate(()=>controller.refresh());calls.length=0;await click('[data-world-delete="failed-world"]');await page.waitForSelector('[data-deleted-world-id="failed-world"]',{state:'attached'});check('deleting the selected failed world first navigates to an available world',selected==='healthy'&&calls[0][0]==='navigate');
 assert.deepEqual((await host('world.read',{id:worldId})),report.before.world);assert.equal((await host('content.status',{worldId})).headOid,report.before.content.headOid);check('complete saved world and original Git draft remain byte-identical',true);
 await assert.rejects(host('world.archiveFailed',{id:worldId,revision:0,baseBuild:'base-a',deleteFiles:true}));await assert.rejects(host('world.restoreArchived',{id:worldId,activate:true}));check('real private router rejects unsupported destructive or activation fields',true);
 check('no real input ownership changes or page exceptions',await page.evaluate(()=>inputViolations.length===0)&&report.errors.length===0);
 await page.screenshot({path:path.join(out,'recently-deleted.png')});report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await core.stop();report.calls=calls;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.passed,error:report.error}));}
