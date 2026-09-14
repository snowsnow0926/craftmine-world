// Actual React row, controller callback, retained-view navigation and host
// coordinator/factory. No engine, browser, model or existing profile is used.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';
import {register,stripTypeScriptTypes,createRequire} from 'node:module';
register(new URL('../vendor/pi-desktop/apps/desktop/test/helpers/ts-import-hooks.mjs',import.meta.url));
const {createCraftmineWorldBridge,planWorldSwitch,isWorldPlayable,worldErrorMessage}=await import('../vendor/pi-desktop/apps/desktop/src/lib/craftmine-worlds.ts');
const {CRAFTMINE_WORLD_TEXT}=await import('../vendor/pi-desktop/apps/desktop/src/lib/craftmine-worlds-text.ts');
const {createGodotPanelCoordinator}=await import('../vendor/pi-desktop/apps/desktop/electron/main/godot-panel-coordinator.ts');
const {createGodotWorldFactory}=await import('../vendor/pi-desktop/apps/desktop/electron/main/godot-world-creation.ts');
const root=path.resolve(import.meta.dirname,'..'),desktop=path.join(root,'vendor/pi-desktop/apps/desktop'),require=createRequire(path.join(desktop,'package.json'));
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});const out=fs.mkdtempSync(path.join(root,'test-results/selected-initialization-'));
const hook=fs.readFileSync(path.join(desktop,'src/hooks/use-craftmine-worlds.ts'),'utf8'),selectSource=hook.slice(hook.indexOf('  const select = useCallback('),hook.indexOf('  const cancelCreatedWorld = useCallback'));
const view=fs.readFileSync(path.join(root,'plugins/craftmine-world/view.mjs'),'utf8'),navigateSource=view.slice(view.indexOf('async function navigate(request) {'),view.indexOf('const checkLabels='));
const bundle=path.join(out,'react-row.cjs');
await require('esbuild').build({stdin:{contents:`import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {WorldListPanel} from './src/components/craftmine/WorldListPanel.tsx';export const render=controller=>renderToStaticMarkup(createElement(WorldListPanel,{controller,lang:'zh',onOpenWorld(){},showCreate:false}));`,resolveDir:desktop,loader:'tsx'},outfile:bundle,bundle:true,platform:'node',format:'cjs',jsx:'automatic',logLevel:'silent',
  plugins:[{name:'unused-create-dialog',setup(build){build.onResolve({filter:/^\.\/WorldCreatePanel$/},()=>({path:'unused',namespace:'fixture'}));build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const WorldCreatePanel=()=>null;'}));}}]});
const {render}=require(bundle);
const entry=state=>({id:'retained-world',title:'Retained blank',state,revision:0,updatedAt:1,base:{id:'creation-sandbox',delivered:true,label:'3D'},creation:{operationId:'init',stage:'build',progress:50,stages:[{id:'build',label:'First build',status:state==='failed'?'failed':'running'}],error:null,actions:state==='failed'?['retry','details']:['details']}});
test('selected initializing React row exposes the ordinary continuation; ready and failed rows do not',()=>{
  for(const state of ['initializing','ready','failed']){
    const controller={status:'ready',worlds:[entry(state)],activeWorldId:'retained-world',capabilities:{switch:true,createActions:true},activeTask:null,archivedWorlds:[],busy:false,select(){},continuePreparation(){},creationAction(){},refresh(){}};
    const html=render(controller);assert.equal(html.includes('data-world-continue="retained-world"'),state==='initializing');
    assert.equal(html.includes('data-world-recovery-action="retry"'),state==='failed');
    if(state==='initializing')assert.match(render({...controller,busy:true}),/data-world-continue="retained-world" disabled/);
  }
});
function fixture({state='initializing',busy=false,supported=true}={}){
  const worldId='retained-world',worldsRoot=fs.mkdtempSync(path.join(out,'worlds-'));fs.mkdirSync(path.join(worldsRoot,worldId));fs.writeFileSync(path.join(worldsRoot,worldId,'.creation-owner.json'),'{}');
  let starts=0,running=false,switches=0;const calls=[],notices=[];
  const factory=createGodotWorldFactory({worldsRoot,catalogFile:path.join(root,'desktop/godot/bases/base-catalog.json'),basesRoot:path.join(root,'desktop/godot/bases'),
    domain:async(method,args)=>{calls.push([method,args]);assert.equal(method,'godotWorld.initStatus');return {worldId,initId:'init',status:'drafting',playable:false,worldRevision:0};},
    initialization:{running:()=>running,error:()=>null,start:()=>{starts++;running=true;return new Promise(()=>{});}}});
  const coordinator=createGodotPanelCoordinator({host:{instance:null},adapter:{},selection:async()=>worldId,creation:()=>factory,invoke:async()=>{throw Error('unexpected write');}});
  const page={busy:false,closing:false,preview:null,applicationAttempt:null,workbench:null,bridge:{invoke:(channel,payload)=>coordinator.invoke(channel,payload)},loaded:false,godot:true,current:{id:worldId},controls(){}};
  vm.runInNewContext(navigateSource+';globalThis.navigate=navigate;',page);
  const bridge=createCraftmineWorldBridge(async(plugin,channel,payload)=>{assert.equal(channel,'world.switch');switches++;return page.navigate({operation:'switch',id:payload.id});});
  const context={useCallback:fn=>fn,bridge,busyRef:{current:busy},setNotice:value=>notices.push(value),setActionError:()=>{},worlds:[entry(state)],activeWorldId:worldId,activeTask:null,capabilities:{switch:supported},lang:'zh',refresh:async()=>{},setActiveWorldId:id=>assert.equal(id,worldId),setBusy:()=>{},isWorldPlayable,planWorldSwitch,worldErrorMessage,CRAFTMINE_WORLD_TEXT,window:{dispatchEvent(){}},CustomEvent:class{}};
  vm.runInNewContext(stripTypeScriptTypes(selectSource)+';globalThis.select=select;',context);
  return {factory,select:context.select,get starts(){return starts;},get switches(){return switches;},calls,notices};
}
test('cold selected initialization makes no progress from list reads; explicit controller continuation reaches the existing host initializer once',async()=>{
  const f=fixture();await f.factory.status('retained-world',{resume:false});assert.equal(f.starts,0);
  await f.select('retained-world');assert.equal(f.switches,0);assert.equal(f.starts,0);
  await f.select('retained-world',true);assert.equal(f.switches,1);assert.equal(f.starts,1);
  await f.select('retained-world',true);assert.equal(f.switches,2);assert.equal(f.starts,1,'running initializer is not restarted');
  assert(f.calls.every(([method])=>method==='godotWorld.initStatus'),'no source/task/DB mutation bypass is introduced');
});
test('ready same-world keeps its original no-op; failed and unknown worlds cannot use continuation to bypass explicit recovery',async()=>{
  for(const state of ['ready','failed','unsupported']){const f=fixture({state});await f.select('retained-world',true);await f.select('retained-world');assert.equal(f.switches,0);assert.equal(f.starts,0);}
});
test('busy and unsupported continuation retain their guards even for the already selected world',async()=>{
  for(const options of [{busy:true},{supported:false}]){const f=fixture(options);await f.select('retained-world',true);assert.equal(f.switches,0);assert.equal(f.starts,0);}
});
