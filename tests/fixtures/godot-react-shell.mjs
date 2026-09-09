// Actual desktop components with fixture session data and native-view transport.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';

export async function buildGodotReactShell(root,out){
  const desktop=path.join(root,'vendor/pi-desktop/apps/desktop');
  const require=createRequire(path.join(root,'vendor/pi-desktop/packages/agent-runtime/package.json'));
  const {build}=require('esbuild');
  const script=`
import React from 'react';import {createRoot} from 'react-dom/client';
import i18n from 'i18next';import {initReactI18next} from 'react-i18next';
import {catalogs,flattenCatalog} from '@pi-desktop/i18n';
import App from './src/App';import {useAppStore} from './src/stores/app-store';import {api} from './src/lib/api';
import {connectGodotFrame} from ${JSON.stringify(path.join(root,'desktop/godot/web/host.mjs').replaceAll('\\','/'))};
const view={pluginId:'craftmine.world',viewId:'world',ref:'craftmine.world/world',title:'世界',icon:'target'};
const plugins=[{id:'craftmine.world',name:'Craftmine World',version:'0.1.0',enabled:true,status:'ready',source:'builtin',permissions:['ui.view']}];
const settings={language:'zh-CN',theme:'dark',defaultMode:'agent',enterToSend:true,onboardingDismissed:true};
let frame,handle,bounds,visible=false,loads=0;
function fit(){if(frame){Object.assign(frame.style,{display:visible?'block':'none',...(bounds?{left:bounds.x+'px',top:bounds.y+'px',width:bounds.width+'px',height:bounds.height+'px'}:{})});}}
api.listPlugins=async()=>({plugins});api.listPluginViews=async()=>[view];api.listPluginThemes=async()=>[];
api.getSettings=async()=>settings;api.setSettings=async next=>{Object.assign(settings,next);return settings;};
api.listNotifications=async()=>({notifications:[],unreadCount:0});api.setNotificationViewingSession=async()=>({ok:true});
api.updatesGetState=async()=>({mode:'disabled',status:'idle',currentVersion:'0.14.3',releasesUrl:''});
api.pluginViewOpen=async()=>({ok:true});api.pluginViewSetBounds=async value=>{bounds=value;fit();return{ok:true};};
api.pluginViewSetVisible=async(_,__,value)=>{visible=value;fit();return{ok:true};};
globalThis.previewFixture={
  loads:()=>loads, handle:()=>handle,
  connect:connectGodotFrame,
  async open(config){
    handle?.dispose();frame?.remove();
    frame=document.createElement('iframe');frame.title='Godot world';frame.sandbox='allow-scripts allow-same-origin';
    frame.setAttribute('allow','autoplay; cross-origin-isolated');Object.assign(frame.style,{position:'fixed',border:'0',zIndex:'100'});
    const loaded=new Promise(resolve=>frame.addEventListener('load',resolve,{once:true}));
    frame.src=config.url;document.body.append(frame);fit();await loaded;loads++;
    handle=connectGodotFrame(frame,config);await handle.ready;return true;
  },
};
async function mountShell(){
  await i18n.use(initReactI18next).init({lng:'zh-CN',fallbackLng:'en',resources:Object.fromEntries(Object.entries(catalogs).map(([key,value])=>[key,{translation:flattenCatalog(value)}])),interpolation:{escapeValue:false}});
  useAppStore.setState({ready:true,bootstrap:async()=>{},settings,plugins,pluginViews:[view],version:{appName:'craftmine world',version:'0.14.3',protocolVersion:11},healthOk:true,onboarding:{needed:false,dismissed:true},workPanelOpen:false,workPanelWidth:560,workPanelTabs:[],activeWorkPanelTabId:null});
  createRoot(document.getElementById('root')).render(<App/>);
}void mountShell();
`;
  fs.mkdirSync(out,{recursive:true});
  await build({stdin:{contents:script,resolveDir:desktop,loader:'jsx',sourcefile:'godot-web-fixture.jsx'},outfile:path.join(out,'shell.js'),bundle:true,platform:'browser',format:'iife',target:'chrome130',loader:{'.gif':'file','.png':'file','.svg':'file','.woff2':'file','.woff':'file','.ttf':'file'},define:{'process.env.NODE_ENV':'"production"'}});
  const assets=path.join(desktop,'out/renderer/assets');
  const css=fs.readdirSync(assets).find(name=>/^index-.*\.css$/.test(name));
  if(!css)throw Error('Build the desktop stylesheet first');
  fs.cpSync(assets,path.join(out,'assets'),{recursive:true});
  fs.writeFileSync(path.join(out,'index.html'),`<!doctype html><html lang="zh-CN" data-theme="dark" data-platform="win32"><head><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="assets/${css}"></head><body><div id="root"></div><script src="shell.js"></script></body></html>`);
}
