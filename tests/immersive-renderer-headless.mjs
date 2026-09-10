// Actual React shell with fixture IPC/native geometry. No input simulation,
// real world execution, microphone capture, or Electron acceptance claim.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { playwright, browserOptions } from '../app/browser-tools.mjs';

const desktop = path.resolve('vendor/pi-desktop/apps/desktop');
fs.mkdirSync('test-results', { recursive: true });
const output = fs.mkdtempSync(path.resolve('test-results/immersive-renderer-'));
const require = createRequire(path.join(desktop, 'package.json'));
const { build } = require('esbuild');
const script = `
import React from 'react'; import {createRoot} from 'react-dom/client';
import i18n from 'i18next'; import {initReactI18next} from 'react-i18next';
import {catalogs,flattenCatalog} from '@pi-desktop/i18n';
import App from './src/App'; import {useAppStore} from './src/stores/app-store';
import {api} from './src/lib/api';
import {loadCraftmineLayout,saveCraftmineLayout,changeCraftmineLayout,setCraftmineOverlay} from './src/lib/craftmine-layout';
import {writeComposerDraft, HOME_DRAFT_KEY} from './src/lib/composer-draft-cache';
async function mount() {
const view={pluginId:'craftmine.world',viewId:'world',ref:'craftmine.world/world',title:'World',icon:'target'};
const plugins=[{id:'craftmine.world',name:'Craftmine World',version:'0.1.0',enabled:true,status:'ready',source:'builtin',permissions:['ui.view']}];
const settings={language:'en',theme:'dark',defaultMode:'agent',enterToSend:true,onboardingDismissed:true};
let nativeBounds=null,immersion=null,shortcut=null,presentations=[];
api.listPlugins=async()=>({plugins}); api.listPluginViews=async()=>[view]; api.listPluginThemes=async()=>[];
api.getSettings=async()=>settings; api.listNotifications=async()=>({notifications:[],unreadCount:0}); api.setNotificationViewingSession=async()=>({ok:true});
api.updatesGetState=async()=>({mode:'disabled',status:'idle',currentVersion:'fixture',releasesUrl:''});
api.pluginViewOpen=async()=>({ok:true}); api.pluginViewSetBounds=async bounds=>{nativeBounds=bounds;}; api.pluginViewSetVisible=async()=>({ok:true});
api.craftmineSetImmersion=async state=>{immersion=state;presentations.push(state);}; api.onCraftmineImmersionShortcut=callback=>{shortcut=callback;return()=>{shortcut=null;};};
await i18n.use(initReactI18next).init({lng:'en',fallbackLng:'en',resources:Object.fromEntries(Object.entries(catalogs).map(([key,value])=>[key,{translation:flattenCatalog(value)}])),interpolation:{escapeValue:false}});
writeComposerDraft(HOME_DRAFT_KEY,{text:'Keep this unsent wish',fileReferences:[]});
useAppStore.setState({ready:true,bootstrap:async()=>{},settings,plugins,pluginViews:[view],version:{appName:'Craftmine World',version:'fixture',protocolVersion:11},healthOk:true,onboarding:{needed:false,dismissed:true},workPanelOpen:false,workPanelWidth:560,workPanelTabs:[],activeWorkPanelTabId:null});
globalThis.fixture={
 mode(mode){saveCraftmineLayout(localStorage,changeCraftmineLayout(loadCraftmineLayout(localStorage),mode,560));window.dispatchEvent(new CustomEvent('craftmine-layout-changed'));},
 overlay:setCraftmineOverlay, shortcut(action){shortcut?.(action);},
 state:()=>({nativeBounds,immersion,presentations,session:useAppStore.getState().activeSessionId,running:useAppStore.getState().isRunning}),
 run(){useAppStore.setState({isRunning:true});},
};
createRoot(document.getElementById('root')).render(<App/>);
} void mount();
`;
await build({ stdin: { contents: script, resolveDir: desktop, loader: 'jsx' }, outfile: path.join(output, 'shell.js'), bundle: true, platform: 'browser', format: 'iife', target: 'chrome130', loader: { '.gif':'file','.png':'file','.svg':'file','.woff2':'file','.woff':'file','.ttf':'file' }, define: { 'process.env.NODE_ENV':'"production"' }, plugins:[{name:'vite-file-url',setup(builder){builder.onResolve({filter:/\?url&no-inline$/},args=>({path:path.resolve(args.resolveDir,args.path.split('?')[0]),namespace:'file-url'}));builder.onLoad({filter:/.*/,namespace:'file-url'},args=>({contents:'export default '+JSON.stringify(pathToFileURL(args.path).href),loader:'js'}));}}] });
const assets = path.join(desktop, 'out/renderer/assets');
const css = fs.readdirSync(assets).find(name => /^index-.*\.css$/.test(name));
assert.ok(css, 'Build the desktop first to produce the real stylesheet');
fs.writeFileSync(path.join(output,'index.html'), `<!doctype html><html lang="en" data-theme="dark" data-platform="win32"><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(path.join(assets,css)).href}"><link rel="stylesheet" href="shell.css"></head><body><div id="root"></div><script src="shell.js"></script></body></html>`);
const errors = [], checks = [];
const browser = await playwright().chromium.launchPersistentContext(path.join(output,'profile'), { ...browserOptions(), headless:true, viewport:{width:1440,height:960}, reducedMotion:'reduce' });
const check = (name,value) => { checks.push({name,passed:!!value}); assert.ok(value,name); console.log('PASS '+name); };
try {
  await browser.addInitScript(() => {
    globalThis.inputRequests=0;
    Element.prototype.requestPointerLock=()=>{globalThis.inputRequests++;throw Error('Pointer lock disabled');};
    window.focus=()=>{globalThis.inputRequests++;};
    window.piDesktop={platform:'win32',locale:'en',on:()=>()=>{},invoke:async channel=>({ok:true,data:channel.includes('voice')?{available:false,provider:'windows-local',locales:[]}:{ok:true,maximized:false,fullScreen:false}})};
  });
  const page=await browser.newPage(); page.on('pageerror',error=>errors.push(error.message)); page.on('console',message=>{if(message.type()==='error')console.error(message.text());});
  await page.goto(pathToFileURL(path.join(output,'index.html')).href);
  await page.waitForFunction(()=>document.querySelector('.composer-input')&&document.querySelector('.work-plugin-view-surface')&&!document.querySelector('[data-testid="startup-splash"]'));
  await page.evaluate(()=>{globalThis.composer=document.querySelector('.composer-input');globalThis.world=document.querySelector('.work-plugin-view-surface');fixture.mode('play');fixture.run();});
  for(const overlay of ['closed','compact','full','closed','compact']) {
    await page.evaluate(state=>fixture.overlay(state),overlay);
    await page.waitForFunction(state=>document.querySelector('.craftmine-overlay-'+state)&&fixture.state().immersion?.overlay===state,overlay);
    if(overlay!=='closed') await page.waitForFunction(()=>{const a=fixture.state().nativeBounds,b=fixture.state().immersion.overlayBounds;return a&&b&&(a.x+a.width<=b.x+1||a.y+a.height<=b.y+1);});
    check(overlay+' retains the same composer, unsent draft and world surface',await page.evaluate(()=>composer===document.querySelector('.composer-input')&&world===document.querySelector('.work-plugin-view-surface')&&composer.textContent==='Keep this unsent wish'));
    check(overlay+' preserves task execution and creates no session',await page.evaluate(()=>fixture.state().running&&!fixture.state().session));
    if(overlay!=='closed') check(overlay+' keeps input inside the viewport',await page.evaluate(()=>{const r=composer.getBoundingClientRect();return r.width>0&&r.height>0&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;}));
    if(overlay==='full') check('unavailable voice keeps text composer usable',await page.evaluate(()=>document.querySelector('.voice-input-button')?.disabled&&composer.contentEditable==='true'));
  }
  await page.evaluate(()=>{const menu=document.createElement('div');menu.id='fixture-picker';menu.setAttribute('role','menu');Object.assign(menu.style,{position:'absolute',top:'-80px',left:'20px',width:'120px',height:'100px'});document.querySelector('.main-pane').append(menu);});
  await page.waitForFunction(()=>fixture.state().immersion.overlayBounds.y<document.querySelector('.main-pane').getBoundingClientRect().y);
  check('picker extending above compact is included in native exclusion bounds',true);
  await page.evaluate(()=>document.getElementById('fixture-picker').remove());
  await page.evaluate(()=>fixture.shortcut('full'));
  await page.waitForFunction(()=>document.querySelector('.craftmine-overlay-full'));
  check('native shortcut uses the same full surface',true);
  await page.evaluate(()=>{globalThis.transitionStart=fixture.state().presentations.length;fixture.overlay('compact');});
  await page.waitForFunction(()=>fixture.state().immersion.overlay==='compact');
  check('full to compact never releases the host input boundary',await page.evaluate(()=>fixture.state().presentations.slice(transitionStart).every(state=>state.active)));
  await page.evaluate(()=>{fixture.overlay('closed');window.dispatchEvent(new CustomEvent('craftmine-sheet-visibility',{detail:{open:true}}));});
  await page.waitForFunction(()=>fixture.state().immersion.blocked===true);
  check('a sheet over closed play retains active immersion and blocks input',await page.evaluate(()=>fixture.state().immersion.active&&fixture.state().immersion.overlay==='closed'));
  await page.evaluate(()=>{window.dispatchEvent(new CustomEvent('craftmine-sheet-visibility',{detail:{open:false}}));fixture.overlay('full');});
  await page.waitForFunction(()=>fixture.state().immersion.overlay==='full'&&!fixture.state().immersion.blocked);
  await page.screenshot({path:path.join(output,'full.png')});
  await page.setViewportSize({width:620,height:800});
  await page.waitForFunction(()=>{const a=fixture.state().nativeBounds,b=fixture.state().immersion.overlayBounds;return a&&b&&a.y+a.height<=b.y+1;});
  check('narrow full workbench reserves two non-overlapping rows',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&composer.getBoundingClientRect().bottom<=innerHeight));
  await page.screenshot({path:path.join(output,'narrow-full.png')});
  await page.evaluate(()=>fixture.mode('create'));
  await page.waitForFunction(()=>!document.querySelector('.craftmine-play')&&fixture.state().immersion?.active===false);
  check('return to create releases immersion and keeps draft',await page.evaluate(()=>composer===document.querySelector('.composer-input')&&composer.textContent==='Keep this unsent wish'));
  check('no input or focus requests',await page.evaluate(()=>inputRequests===0));
  check('no unhandled renderer errors',errors.length===0);
} catch(error) { errors.push(error.stack); console.error(error); process.exitCode=1; }
finally { await browser.close();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({scope:'Headless React with fixture IPC/native geometry; not Electron acceptance',checks,errors},null,2));console.log('Report: '+output); }
