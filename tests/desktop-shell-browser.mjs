// Visual verification of the actual PI/Craftmine React components. Session
// data and native-window transport are fixtures; this is not Electron E2E.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {playwright,browserOptions} from '../app/browser-tools.mjs';

const root=process.cwd(),desktop=path.resolve('vendor/pi-desktop/apps/desktop');
fs.mkdirSync('test-results',{recursive:true});
const dir=fs.mkdtempSync(path.resolve('test-results/desktop-shell-'));
const require=createRequire(path.resolve('vendor/pi-desktop/packages/agent-runtime/package.json'));
const {build}=require('esbuild');
const worldUrl=pathToFileURL(path.resolve('desktop/build/craftmine.world/views/world.html')).href;
const script=`
import React from 'react';import {createRoot} from 'react-dom/client';
import i18n from 'i18next';import {initReactI18next} from 'react-i18next';
import {catalogs,flattenCatalog} from '@pi-desktop/i18n';
import App from './src/App';import {useAppStore} from './src/stores/app-store';
import {api} from './src/lib/api';
const view={pluginId:'craftmine.world',viewId:'world',ref:'craftmine.world/world',title:'世界',icon:'target'};
const plugins=[{id:'craftmine.world',name:'Craftmine World',version:'0.1.0',enabled:true,status:'ready',source:'builtin',permissions:['ui.view']}];
const settings={language:'zh-CN',theme:'dark',defaultMode:'agent',enterToSend:true,onboardingDismissed:true};
const frame=document.createElement('iframe');frame.title='世界';frame.src=${JSON.stringify(worldUrl)};
Object.assign(frame.style,{position:'fixed',border:'0',display:'none',zIndex:'100'});document.body.append(frame);
api.listPlugins=async()=>({plugins});api.listPluginViews=async()=>[view];api.listPluginThemes=async()=>[];
api.getSettings=async()=>settings;api.setSettings=async next=>{Object.assign(settings,next);return settings;};
api.listNotifications=async()=>({notifications:[],unreadCount:0});api.setNotificationViewingSession=async()=>({ok:true});
api.updatesGetState=async()=>({mode:'disabled',status:'idle',currentVersion:'0.14.3',releasesUrl:''});
api.pluginViewOpen=async()=>({ok:true});api.pluginViewSetBounds=async bounds=>{Object.assign(frame.style,{left:bounds.x+'px',top:bounds.y+'px',width:bounds.width+'px',height:bounds.height+'px'});return{ok:true};};
api.pluginViewSetVisible=async(_,__,visible)=>{frame.style.display=visible?'block':'none';return{ok:true};};
async function mountShell() {
await i18n.use(initReactI18next).init({lng:'zh-CN',fallbackLng:'en',resources:Object.fromEntries(Object.entries(catalogs).map(([key,value])=>[key,{translation:flattenCatalog(value)}])),interpolation:{escapeValue:false}});
useAppStore.setState({ready:true,bootstrap:async()=>{},settings,plugins,pluginViews:[view],version:{appName:'craftmine world',version:'0.14.3',protocolVersion:11},healthOk:true,onboarding:{needed:false,dismissed:true},workPanelOpen:true,workPanelWidth:560,workPanelTabs:[{id:'plugin:craftmine.world/world',kind:'plugin',resource:'craftmine.world/world'}],activeWorkPanelTabId:'plugin:craftmine.world/world'});
globalThis.shellFixture={theme(value){settings.theme=value;useAppStore.setState({settings:{...settings}});},panel(open){useAppStore.setState({workPanelOpen:open});}};
createRoot(document.getElementById('root')).render(<App/>);
} void mountShell();
`;
await build({stdin:{contents:script,resolveDir:desktop,loader:'jsx',sourcefile:'craftmine-layout-probe.jsx'},outfile:path.join(dir,'shell.js'),bundle:true,platform:'browser',format:'iife',target:'chrome130',loader:{'.gif':'file','.png':'file','.svg':'file','.woff2':'file','.woff':'file','.ttf':'file'},define:{'process.env.NODE_ENV':'"production"'}});
const assets=path.join(desktop,'out/renderer/assets');
const css=fs.readdirSync(assets).find(name=>/^index-.*\.css$/.test(name));
assert.ok(css,'built desktop stylesheet');
fs.writeFileSync(path.join(dir,'index.html'),`<!doctype html><html lang="zh-CN" data-theme="dark" data-platform="win32"><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(path.join(assets,css)).href}"></head><body><div id="root"></div><script src="shell.js"></script></body></html>`);
const checks=[],errors=[];
const browser=await playwright().chromium.launchPersistentContext(path.join(dir,'profile'),{...browserOptions(),viewport:{width:1440,height:960},reducedMotion:'reduce',colorScheme:'dark'});
const check=(name,value)=>{checks.push({name,passed:!!value});assert.ok(value,name);console.log('PASS '+name);};
try {
  await browser.addInitScript(()=>{
    globalThis.__inputRequests=0;Element.prototype.requestPointerLock=()=>{globalThis.__inputRequests++;throw Error('Pointer lock disabled');};window.focus=()=>{globalThis.__inputRequests++;};
    if(window===top)window.piDesktop={platform:'win32',locale:'zh-CN',on:()=>()=>{},invoke:async()=>({ok:true,data:{ok:true,maximized:false,fullScreen:false}})};
  });
  const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(pathToFileURL(path.join(dir,'index.html')).href);
  await page.waitForFunction(()=>document.querySelector('[data-nav="world"]')&&!document.querySelector('[data-testid="startup-splash"]'),{},{timeout:15000});
  const world=page.frames().find(frame=>frame.url()===worldUrl);
  assert.ok(world,'native view adapter');await world.waitForFunction(()=>document.body.dataset.worldLoaded==='true');
  check('实际 React 桌面保留会话侧栏和世界入口',await page.evaluate(()=>!!document.querySelector('.sidebar [data-nav="world"]')&&!!document.querySelector('[data-sidebar-session-section]')));
  check('桌面保留聊天输入与可调工作面板',await page.evaluate(()=>!!document.querySelector('.composer-input')&&!!document.querySelector('.work-panel-resize')));
  const geometry=await page.evaluate(()=>{const panel=document.querySelector('.work-panel').getBoundingClientRect();return{width:panel.width,right:panel.right,scroll:document.documentElement.scrollWidth};});
  check('世界面板达到 560 像素且未超出窗口',geometry.width>=559&&geometry.right<=1441&&geometry.scroll<=1440);
  check('世界画面位于工作面板的可见表面',await page.evaluate(()=>{const frame=document.querySelector('body>iframe');const rect=frame.getBoundingClientRect();return rect.width>500&&document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)===frame;}));
  await page.screenshot({path:path.join(dir,'desktop-dark.png')});
  await page.evaluate(()=>shellFixture.theme('light'));
  await page.emulateMedia({colorScheme:'light'});
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  await page.screenshot({path:path.join(dir,'desktop-light.png')});
  check('保留深浅主题切换',true);
  check('没有请求真实输入或焦点',(await Promise.all(page.frames().map(frame=>frame.evaluate(()=>globalThis.__inputRequests||0)))).every(count=>count===0));
  check('实际前端组件无未处理异常',errors.length===0);
}catch(error){errors.push(error.stack);process.exitCode=1;console.error(error);}
finally{await browser.close();fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify({scope:'Real React components with fixture session data and native-view transport; not Electron E2E',checks,errors},null,2));console.log('Report: '+path.join(dir,'report.json'));}
