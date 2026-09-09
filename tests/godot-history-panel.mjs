// Real React -> private panel service -> actual Rust/Git, isolated headless profile.
// No Godot executor is registered: the check must truthfully report blocked.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {playwright,browserOptions} from '../app/browser-tools.mjs';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const dependencies=process.env.CRAFTMINE_NATIVE_DEPENDENCY_ROOT||root;
const desktop=path.join(root,'vendor/pi-desktop/apps/desktop');
const depsDesktop=path.join(dependencies,'vendor/pi-desktop/apps/desktop');
const require=createRequire(import.meta.url);
const depsRequire=createRequire(path.join(depsDesktop,'package.json'));
const {build}=createRequire(path.join(dependencies,'vendor/pi-desktop/packages/agent-runtime/package.json'))('esbuild');
const {CoreClient}=require('../plugins/craftmine-world/core-client.cjs');
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const out=fs.mkdtempSync(path.join(root,'test-results/history-panel-'));
fs.copyFileSync(path.join(dependencies,'plugins/craftmine-world/host-requests.cjs'),path.join(out,'host-requests.cjs'));
fs.copyFileSync(path.join(dependencies,'desktop/build/craftmine.world/domain.cjs'),path.join(out,'domain.cjs'));
const {createHostRequests}=require(path.join(out,'host-requests.cjs'));
const binary=process.env.CRAFTMINE_CORE_BIN||path.join(root,'test-restore-core.exe');
const report={kind:'real-react-private-service-rust-git',binarySha256:createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),checks:[],errors:[],limits:['No real Godot executor or model: truthful blocked check required.','Electron navigation routing is integrated separately; HTTP replaces only its transport.']};
const check=(name,condition)=>{report.checks.push({name,passed:!!condition});assert.ok(condition,name);console.log('PASS '+name);};
await build({entryPoints:[path.join(desktop,'electron/main/godot-history-panel-service.ts')],outfile:path.join(out,'service.mjs'),bundle:true,platform:'node',format:'esm'});
const {createGodotHistoryPanelService}=await import(pathToFileURL(path.join(out,'service.mjs')));
let core=new CoreClient(binary,path.join(out,'core'));await core.start();
let selected='world-a';
let host=createHostRequests(core,{getSettings:async()=>({activeWorldId:selected})});
const calls=[];
let service=createGodotHistoryPanelService({selection:async()=>selected,domain:async(method,args)=>{calls.push({method,args});return host(method,args);}});
let browser;let server;let activePage;
try {
  await core.call('world.create',{id:'world-a',title:'History fixture',world:{build:{id:'base-a',scene:{format:'craftmine.scene/3',objects:[]}},snapshot:{format:'craftmine.progress/1',player:{x:0.5,y:7.6,z:0.5,yaw:0,pitch:0}},extensions:[]}});
  const context={projectId:'seed',sessionId:'seed',turnId:'seed'};
  await host('turn.begin',{context,selectedWorld:'world-a',request:{id:'seed',text:'Seed source fixture'}});
  await core.call('godotProject.create',{context,worldId:'world-a',toolCallId:'seed',baseBuild:'base-a',baseId:'first-person',files:[
    {path:'project.godot',text:'config_version=5\n[application]\nrun/main_scene="res://main.tscn"\n'},
    {path:'main.tscn',text:'[gd_scene format=3]\n[node name="Main" type="Node3D"]\n'},
    {path:'world.gd',text:'extends Node3D\nvar damage := 12\n'}]});
  await core.call('workspace.endTurn',{sessionId:'seed',turnId:'seed',status:'completed'});
  await core.call('content.migrate.apply',{worldId:'world-a'});
  const original=await core.call('content.status',{worldId:'world-a'});
  await assert.rejects(service.invoke('godot.historyLoad',{worldId:'world-a',context:{}}),/INVALID_HISTORY_ACTION/);
  selected='world-b';await assert.rejects(service.invoke('godot.historyLoad',{worldId:'world-a'}),/GODOT_WORLD_CHANGED/);selected='world-a';
  check('forged context and cross-world selection rejected',true);
  const entry=path.join(out,'entry.jsx');
  fs.writeFileSync(entry,`import React from 'react';import{createRoot}from'react-dom/client';import{GodotHistoryPanel}from ${JSON.stringify(path.join(desktop,'src/components/craftmine/GodotHistoryPanel.tsx').replaceAll('\\','/'))};const bridge={call:async(channel,payload)=>{const response=await fetch('/invoke',{method:'POST',body:JSON.stringify({channel,payload})});const value=await response.json();if(value.error)throw Error(value.error);return value.result;}};createRoot(document.getElementById('root')).render(<GodotHistoryPanel bridge={bridge} worldId="world-a" onOpenChecks={()=>window.openedChecks=true}/>);`);
  await build({entryPoints:[entry],outfile:path.join(out,'ui.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',nodePaths:[path.join(depsDesktop,'node_modules')],alias:{react:depsRequire.resolve('react'),'react-dom/client':depsRequire.resolve('react-dom/client'),'react/jsx-runtime':depsRequire.resolve('react/jsx-runtime')}});
  server=http.createServer(async(req,res)=>{
    if(req.url==='/invoke') {try {let text='';for await(const chunk of req)text+=chunk;const {channel,payload}=JSON.parse(text);res.end(JSON.stringify({result:await service.invoke(channel,payload)}));}catch(error){console.log('PANEL_ERROR '+String(error));res.end(JSON.stringify({error:String(error)}));}return;}
    if(req.url==='/ui.js'){res.setHeader('content-type','text/javascript');res.end(fs.readFileSync(path.join(out,'ui.js')));return;}
    res.end('<html><meta charset="utf-8"><div id="root"></div><script src="/ui.js"></script></html>');
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await playwright().chromium.launchPersistentContext(path.join(out,'profile'),{...browserOptions(),viewport:{width:900,height:850}});
  await browser.addInitScript(()=>{window.inputAttempts=0;Element.prototype.requestPointerLock=()=>{window.inputAttempts++;};HTMLElement.prototype.focus=()=>{window.inputAttempts++;};window.focus=()=>{window.inputAttempts++;};});
  const page=await browser.newPage();activePage=page;page.on('pageerror',error=>report.errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(()=>document.querySelector('[data-history-branch]'));
  check('real Git versions and source list rendered',await page.locator('[data-history-records] li').count()>0&&await page.locator('[data-history-files] li').count()>=3);
  await page.evaluate(()=>{const input=document.querySelector('[data-history-name]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'forest');input.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.waitForFunction(()=>!document.querySelector('[data-history-create]').disabled);
  await page.evaluate(()=>document.querySelector('[data-history-create]').click());
  await page.waitForFunction(()=>document.querySelector('[data-history-branch]')?.value==='forest');
  check('new branch is real and selected', (await core.call('content.branch.list',{worldId:'world-a'})).branches.some(branch=>branch.name==='refs/heads/forest'));
  await page.evaluate(()=>[...document.querySelectorAll('[data-history-files] button')].find(button=>button.textContent==='world.gd').click());
  await page.waitForFunction(()=>document.querySelector('[data-history-text]'));
  await page.evaluate(()=>{const input=document.querySelector('[data-history-text]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'extends Node3D\nvar damage := 21\n');input.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.waitForFunction(()=>!document.querySelector('[data-history-save]').disabled);
  await page.evaluate(()=>document.querySelector('[data-history-save]').click());
  await page.waitForFunction(()=>!document.querySelector('[data-history-text]')&&!document.querySelector('[data-history-check]').disabled);
  const changed=await core.call('content.status',{worldId:'world-a'});
  check('save changes forest while preserving main and applied',changed.headOid===original.headOid&&changed.appliedOid===original.appliedOid&&changed.branches.find(branch=>branch.name==='refs/heads/forest').oid!==original.headOid);
  const oldRead=calls.findLast(call=>call.method==='godotProject.read').args;
  await assert.rejects(service.invoke('godot.historyCheck',{worldId:'world-a',branchId:'forest',revision:oldRead.revision,manifestHash:oldRead.manifestHash}),/GODOT_SOURCE_STALE/);
  check('stale source cannot be checked as latest branch',true);
  await page.evaluate(()=>document.querySelector('[data-history-check]').click());
  await page.waitForFunction(()=>document.querySelector('[data-history-job]')?.textContent.includes('blocked'));
  const buildCall=calls.findLast(call=>call.method==='godotBuild.start');
  check('check binds forest source and reports missing executor honestly',buildCall.args.branchId==='forest'&&buildCall.args.mode==='check'&&await page.locator('[data-history-job]').textContent().then(text=>text.includes('GODOT_EXECUTION_UNAVAILABLE')));
  await page.evaluate(()=>document.querySelector('[data-history-candidates]').click());
  check('candidate entry reuses existing checks without applying refs',await page.evaluate(()=>window.openedChecks===true)&&!calls.some(call=>call.method.startsWith('content.apply')||call.method.startsWith('godotApplication.')));
  await page.evaluate(()=>{const select=document.querySelector('[data-history-branch]');select.value='main';select.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.waitForFunction(()=>document.querySelector('[data-history-branch]')?.value==='main'&&!document.querySelector('[data-history-check]').disabled);
  await page.evaluate(()=>[...document.querySelectorAll('[data-history-files] button')].find(button=>button.textContent==='world.gd').click());
  await page.waitForFunction(()=>document.querySelector('[data-history-text]'));
  check('switch back reads main original source',await page.locator('[data-history-text]').inputValue()==='extends Node3D\nvar damage := 12\n');
  check('no input focus pointer lock or page errors',await page.evaluate(()=>window.inputAttempts===0)&&report.errors.length===0);
  await page.screenshot({path:path.join(out,'history.png')});
  await browser.close();browser=null;
  await core.stop();core=new CoreClient(binary,path.join(out,'core'));await core.start();
  host=createHostRequests(core,{getSettings:async()=>({activeWorldId:selected})});
  const reopened=await service.invoke('godot.historyLoad',{worldId:'world-a',branchId:'forest'});
  const source=await service.invoke('godot.historyReadSource',{worldId:'world-a',branchId:'forest',revision:reopened.index.revision,manifestHash:reopened.index.manifestHash,path:'world.gd'});
  check('full Rust restart restores branch edit',source.text==='extends Node3D\nvar damage := 21\n');
}catch(error){report.errors.push(String(error));if(activePage&&!activePage.isClosed()){fs.writeFileSync(path.join(out,'failure.html'),await activePage.content());await activePage.screenshot({path:path.join(out,'failure.png')});}throw error;}
finally {await browser?.close();await new Promise(resolve=>server?server.close(resolve):resolve());await core.stop();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(out,'calls.json'),JSON.stringify(calls,null,2));console.log('Evidence: '+out);}
