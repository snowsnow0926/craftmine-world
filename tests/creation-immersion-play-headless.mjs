// Real creation components, the real layout/immersion policy and the real
// world bridge seam. Every transition is a page-script call: no mouse, keyboard,
// click or fill input, no pointer lock, no window activation.
//
// Scope: the renderer contract for entering a world, summoning creation and
// returning to the workbench. Native view geometry, the installed client and
// physical play remain separate acceptance items.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {playwright,browserOptions} from '../app/browser-tools.mjs';

const root=path.resolve(import.meta.dirname,'..');
const desktop=path.join(root,'vendor/pi-desktop/apps/desktop');
const require=createRequire(path.join(desktop,'package.json'));
const {build}=require('esbuild');
const slash=value=>value.replaceAll('\\','/');
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const output=fs.mkdtempSync(path.join(root,'test-results/immersion-play-'));
const module_=name=>JSON.stringify(slash(path.join(desktop,name)));

const report={format:'craftmine.immersion-play-headless/1',native:false,checks:[],errors:[],
  limits:['Actual React components, real layout/key policy and the real world bridge seam with a fixture host',
    'No mouse/keyboard/click/fill input, no pointer lock, no OS fullscreen, no window activation',
    'Native Godot view bounds, the installed client and physical play remain separate acceptance items']};
const check=(name,value)=>{report.checks.push({name,passed:!!value});assert.ok(value,name);console.log('PASS '+name);};

const storeStub=`
import {useSyncExternalStore} from 'react';
import {pluginWorkPanelTab} from ${module_('src/lib/work-panel-tabs.ts')};
const WORLD=pluginWorkPanelTab('craftmine.world','world');
// The copied-world helper is a host concern; the fixture only has to satisfy
// the import graph of the components under test.
export const createCopiedWorldSession=async()=>'session-copy';
const listeners=new Set();
const emit=()=>{for(const fn of listeners)fn();};
export const state={
  ready:true,pluginViews:[{ref:WORLD.resource}],
  page:'chat',workPanelOpen:true,activeWorkPanelTabId:WORLD.id,
  workPanelTabs:[{id:WORLD.id,kind:'plugin',ref:WORLD.resource}],
  workPanelWidth:480,activeSessionId:'session-a',
  sessions:[{id:'session-a',title:'Fixture conversation',mode:'agent',projectPath:'D:/fixture'}],
  isRunning:false,agentStatuses:{},
  setPage(value){this.page=value;emit();},
  openWorkPanelTab(tab){if(!this.workPanelTabs.some(entry=>entry.id===tab.id))this.workPanelTabs.push({id:tab.id,kind:'plugin',ref:tab.resource});this.activeWorkPanelTabId=tab.id;this.workPanelOpen=true;emit();},
  setWorkPanelWidth(width){this.workPanelWidth=width;emit();},
};
export const useAppStore=selector=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>selector(state));
useAppStore.getState=()=>state;
useAppStore.setState=patch=>{Object.assign(state,patch);emit();};
`;

const entry=`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {CraftmineNavigation} from ${module_('src/components/CraftmineNavigation.tsx')};
import {CraftmineOverlayControls} from ${module_('src/components/CraftmineOverlayControls.tsx')};
import {isCraftmineWorldWorkspace,loadCraftmineLayout,setCraftmineOverlay} from ${module_('src/lib/craftmine-layout.ts')};
import {applyImmersionKey,immersionKeyAction} from ${module_('src/lib/craftmine-immersion-keys.ts')};
import {enterCraftmineMode} from ${module_('src/lib/craftmine-mode.ts')};
import {useCraftmineLayout} from ${module_('src/lib/use-craftmine-immersion.ts')};
import {api} from ${module_('src/lib/api.ts')};
import {useAppStore} from './store';

const KEY='craftmine.desktop.layout.v1';
const baseWorld=id=>({id,title:id,revision:1,updatedAt:1,origin:'created',state:'ready',base:{id:'creation-sandbox',label:'造物世界',delivered:true}});
let worlds=[],activeWorldId=null;
globalThis.__craftmineWorldBridge={invoke:async(_plugin,channel,payload)=>{
  if(channel==='world.list')return structuredClone({activeWorldId,worlds});
  if(channel==='workbench.capabilities')return {bases:[{id:'creation-sandbox',label:'造物世界',delivered:true}],starters:[{id:'blank',label:'空白',delivered:true}]};
  if(channel==='world.createOptions')return {};
  if(channel==='task.current')return {};
  if(channel==='world.switch'){activeWorldId=payload.id;return {ok:true,activeWorldId};}
  return {};
},onChanged:()=>()=>{}};
api.onWindowFullScreen=()=>()=>{};
api.nativeMenuAction=async()=>({fullScreen:false,maximized:false});

function Fixture(){
  const layout=useCraftmineLayout();
  const page=useAppStore(s=>s.page);
  const open=useAppStore(s=>s.workPanelOpen);
  const tab=useAppStore(s=>s.activeWorkPanelTabId);
  const immersive=layout.mode==='play'&&isCraftmineWorldWorkspace(page,open,tab);
  return <div className={'app-shell'+(immersive?' craftmine-play ':' ')+(immersive?'craftmine-overlay-'+layout.overlay:'')} data-mode={layout.mode} data-overlay={layout.overlay} data-playing={immersive?'true':'false'}>
    <aside className="sidebar"><CraftmineNavigation/></aside>
    <section className="main-pane" inert={immersive&&layout.overlay==='closed'?true:undefined}>
      {immersive&&layout.overlay!=='closed'?<CraftmineOverlayControls/>:null}
    </section>
    <aside className="work-panel" style={{width:480,flexShrink:0}}>
      <div className="work-panel-header" style={{height:46}}/>
      <div className="world-surface" style={{height:300}}/>
    </aside>
  </div>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
const settle=()=>new Promise(resolve=>setTimeout(resolve,80));

globalThis.fixture={
  stored:()=>JSON.parse(localStorage.getItem(KEY)??'null'),
  // The same decision and application path the renderer hook runs.
  key:(key,shift)=>{const action=immersionKeyAction({key,shiftKey:!!shift},loadCraftmineLayout(localStorage).overlay,false);
    applyImmersionKey(action,{setOverlay:setCraftmineOverlay,exitPlay:()=>enterCraftmineMode('create')});return action;},
  addWorld:async id=>{worlds=[...worlds,baseWorld(id)];activeWorldId=id;window.dispatchEvent(new CustomEvent('craftmine-world-changed'));await settle();},
  legacy:async value=>{localStorage.setItem(KEY,JSON.stringify(value));window.dispatchEvent(new CustomEvent('craftmine-layout-changed'));await settle();},
  listed:()=>worlds.length,
  mode:()=>useAppStore.getState().activeWorkPanelTabId,
  session:()=>useAppStore.getState().activeSessionId,
  tabs:()=>useAppStore.getState().workPanelTabs.map(entry=>entry.id),
  workPanelWidth:()=>useAppStore.getState().workPanelWidth,
  isRunning:()=>useAppStore.getState().isRunning,
};
`;
fs.writeFileSync(path.join(output,'store.js'),storeStub);
fs.writeFileSync(path.join(output,'fixture.jsx'),entry);
await build({entryPoints:[path.join(output,'fixture.jsx')],outfile:path.join(output,'fixture.js'),bundle:true,
  platform:'browser',format:'iife',target:'chrome130',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},
  alias:{react:require.resolve('react'),'react-dom/client':require.resolve('react-dom/client'),'react/jsx-runtime':require.resolve('react/jsx-runtime')},
  plugins:[{name:'fixture-boundaries',setup(builder){
    builder.onResolve({filter:/stores\/app-store$/},()=>({path:path.join(output,'store.js')}));
    builder.onResolve({filter:/^react-i18next$/},()=>({path:'i18n',namespace:'fixture'}));
    builder.onResolve({filter:/use-creation-task-status$/},()=>({path:'task',namespace:'fixture'}));
    builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',contents:args.path==='i18n'
      ?`export const useTranslation=()=>({i18n:{language:'zh-CN'},t:(key,opts)=>opts&&'attempt'in opts?key+':'+opts.attempt:key});`
      :`export const useCreationTaskStatus=()=>({status:null,unavailable:false});`}));
  }}]});

const styles=['work-panel.css','craftmine.css'].map(name=>fs.readFileSync(path.join(desktop,'src/styles',name),'utf8')).join('\n');
fs.writeFileSync(path.join(output,'index.html'),`<!doctype html><html lang="zh-CN" data-theme="dark"><head><meta charset="utf-8">
<style>:root{--ds-toolbar-height:46px;--ds-sidebar-width:230px;--ds-text-secondary:#b5beb8;--ds-text-primary:#eff7f0;--ds-bg-active:#284235;--ds-border-subtle:#2c3a33;--ds-tile:#1f2421;--ds-bg-primary:#191919;--radius-xs:6px;--text-2xs:13px;--ds-focus:#4f9d78}
body{margin:0;background:#191919;color:#eee;font:14px system-ui}.app-shell{display:flex;width:100vw;height:100vh;align-items:stretch}.sidebar{flex:0 0 var(--ds-sidebar-width);overflow:auto}.main-pane{flex:1 1 auto;min-width:0;overflow:auto}.work-panel{display:flex;flex-direction:column;overflow:hidden}button{cursor:pointer}
${styles}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`);

let context;
try{
  context=await playwright().chromium.launchPersistentContext(path.join(output,'profile'),{...browserOptions(),headless:true,viewport:{width:1440,height:900},reducedMotion:'reduce'});
  await context.addInitScript(()=>{globalThis.inputRequests=0;Element.prototype.requestPointerLock=()=>{inputRequests++;throw Error('Pointer lock disabled');};window.focus=()=>{inputRequests++;};});
  const page=await context.newPage();
  page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto(pathToFileURL(path.join(output,'index.html')).href);
  // The sidebar is display:none while playing, so presence, not visibility, is
  // the contract for these controls.
  await page.waitForSelector('[data-craftmine-layout]',{state:'attached'});
  const shell=()=>page.evaluate(()=>({mode:document.querySelector('.app-shell').dataset.mode,overlay:document.querySelector('.app-shell').dataset.overlay,
    playing:document.querySelector('.app-shell').dataset.playing==='true',
    sidebar:getComputedStyle(document.querySelector('.sidebar')).display,
    chat:getComputedStyle(document.querySelector('.main-pane')).display,
    world:Math.round(document.querySelector('.work-panel').getBoundingClientRect().width),width:innerWidth}));
  const press=(mode)=>page.evaluate(async value=>{document.querySelectorAll('[data-craftmine-layout] > form')[value].requestSubmit();await new Promise(r=>setTimeout(r,80));},mode);

  check('a fresh install without a world stays in the workbench view',!(await shell()).playing&&(await page.evaluate(()=>fixture.stored()))===null);

  const entered=await page.evaluate(async()=>{await fixture.addWorld('world-b');return fixture.stored();});
  check('entering a world fills the whole workspace without an explicit mode change',(await shell()).playing&&entered.mode==='play'&&entered.overlay==='closed');
  const filled=await shell();
  check('the world surface covers the client and both side columns are removed',filled.sidebar==='none'&&filled.chat==='none'&&Math.abs(filled.world-filled.width)<1);
  check('the automatic switch remembers exactly which world it filled for',entered.enteredWorldId==='world-b'&&entered.playWhenWorldActivates===true);
  await page.screenshot({path:path.join(output,'play-filled.png')});

  check('F2 summons compact creation instead of covering the game',await page.evaluate(()=>fixture.key('F2'))==='compact');
  const compact=await shell();
  check('compact reserves a real strip and the world stays visible',compact.overlay==='compact'&&compact.chat==='flex'&&compact.world>0);
  check('the summoned strip carries the visible return control',await page.evaluate(()=>!!document.querySelector('[data-action="exit-play"]')));
  await page.screenshot({path:path.join(output,'play-compact.png')});
  check('Shift+F2 opens the full workbench beside the world',await page.evaluate(()=>fixture.key('F2',true))==='full'&&(await shell()).overlay==='full');
  check('Escape closes the open overlay before anything else',await page.evaluate(()=>fixture.key('Escape'))==='closed'&&(await shell()).playing);
  check('a second Escape returns to the workbench',await page.evaluate(()=>fixture.key('Escape'))==='exit-play'&&!(await shell()).playing);
  check('returning keeps the world view, session, tabs and task running',await page.evaluate(()=>fixture.mode()==='plugin:craftmine.world/world'&&fixture.session()==='session-a'&&fixture.tabs().length===1&&fixture.isRunning()===false));
  check('the keyboard round trip states no preference',(await page.evaluate(()=>fixture.stored())).playWhenWorldActivates===true);


  // The visible controls are the mouse path to the same result.
  await press(1);
  await page.waitForFunction(()=>document.querySelector('.app-shell').dataset.playing==='true');
  check('the 游玩 control fills the workspace immediately and states the preference',await page.evaluate(()=>fixture.stored().playWhenWorldActivates===true&&fixture.workPanelWidth()===720));
  await page.evaluate(()=>fixture.key('F2'));
  await page.waitForFunction(()=>!!document.querySelector('[data-action="exit-play"]'));
  await page.evaluate(()=>document.querySelector('[data-action="exit-play"]').click());
  await page.waitForFunction(()=>document.querySelector('.app-shell').dataset.playing==='false');
  check('the visible return control leaves play and records the preference',await page.evaluate(()=>fixture.stored().playWhenWorldActivates===false&&fixture.mode()==='plugin:craftmine.world/world'&&document.querySelector('.app-shell').dataset.mode==='create'));

  const next=await page.evaluate(async()=>{await fixture.addWorld('world-c');return fixture.stored();});
  check('a later world respects the recorded preference while still being marked',!(await shell()).playing&&next.playWhenWorldActivates===false&&next.enteredWorldId==='world-c');
  await press(0);
  await page.waitForFunction(()=>document.querySelector('.app-shell').dataset.mode==='create');
  check('the 创作 control keeps the workbench and the recorded preference',await page.evaluate(()=>fixture.stored().playWhenWorldActivates===false&&fixture.stored().mode==='create'));

  // Filling the workspace again, then leaving it with the keyboard, must keep
  // the preference while the activation marker stays consumed.
  await press(1);
  await page.waitForFunction(()=>document.querySelector('.app-shell').dataset.playing==='true');
  await page.evaluate(()=>fixture.key('Escape'));
  await page.waitForFunction(()=>document.querySelector('.app-shell').dataset.playing==='false');
  const beforeReload=await page.evaluate(()=>fixture.stored());
  check('leaving play with the keyboard keeps the stated preference',beforeReload.playWhenWorldActivates===true&&beforeReload.mode==='create');
  await page.reload();
  await page.waitForSelector('[data-craftmine-layout]',{state:'attached'});
  await page.waitForFunction(()=>!!globalThis.fixture);
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,120)));
  check('a reload does not replay the activation for the same world',!(await shell()).playing&&(await page.evaluate(()=>fixture.stored())).enteredWorldId===beforeReload.enteredWorldId);

  await page.evaluate(()=>fixture.legacy({mode:'create',chatWidth:430,widths:{create:490,play:680}}));
  check('a layout stored before this option still opens the workbench',!(await shell()).playing);
  const legacyNext=await page.evaluate(async()=>{await fixture.addWorld('world-d');return {playing:document.querySelector('.app-shell').dataset.playing==='true',stored:fixture.stored()};});
  check('a legacy layout still enters the next world the documented way',legacyNext.playing&&legacyNext.stored.enteredWorldId==='world-d'&&legacyNext.stored.mode==='play');
  check('no pointer-lock or focus request and no page errors',await page.evaluate(()=>inputRequests===0)&&report.errors.length===0);
  report.passed=true;
}catch(error){report.failure=String(error.stack||error);report.passed=false;throw error;}
finally{await context?.close();report.evidence=output;fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log('Evidence: '+output);}
