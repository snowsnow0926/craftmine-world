// Actual host methods and preload bootstrap with controlled lifecycle events; no OS input.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {stripTypeScriptTypes} from 'node:module';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import vm from 'node:vm';
const root=new URL('../../../vendor/pi-desktop/apps/desktop/',import.meta.url);
const strip=s=>stripTypeScriptTypes(s,{mode:'transform'}).replace(/^import[\s\S]*?from ["'][^"']+["'];\s*/gm,'').replace(/^export /gm,'');
const source=strip(await fs.readFile(new URL('electron/main/plugin-view-host.ts',root),'utf8'));
const helper=strip(await fs.readFile(new URL('shared/world-fullscreen-shortcuts.ts',root),'utf8'));
const constants={PLUGIN_PANEL_EMBEDDED_ARGUMENT:'--embedded',PLUGIN_PANEL_LOCALE_ARGUMENT_PREFIX:'--locale=',PLUGIN_WORLD_SHORTCUT_SCOPE_PREFIX:'--scope=',PLUGIN_WORLD_FULLSCREEN_EXIT_CHANNEL:'world-exit'};
function fixture(pluginId='craftmine.world',viewId='world'){
 const views=[],actions=[],window={isDestroyed:()=>false,contentView:{children:[],addChildView(v){this.children.push(v);},removeChildView(v){this.children=this.children.filter(x=>x!==v);}}};
 class View{constructor(options){this.options=options;this.webContents=Object.assign(new EventEmitter(),{ipc:new EventEmitter(),mainFrame:{},isDestroyed:()=>false,loadURL:async()=>{},setWindowOpenHandler(){},close(){}});views.push(this);}setBounds(){}}
 const Host=vm.runInNewContext(source+'\nPluginViewHost',{...constants,randomUUID,pathToFileURL,join,__dirname:'owned',WebContentsView:View,isHeadlessAcceptance:()=>true,session:{fromPartition:()=>({})},pluginSessionPartition:id=>id,applyPluginEgressPolicy(){},nativeFullscreenKeyDecision:vm.runInNewContext(helper+'\nnativeFullscreenKeyDecision')});
 const host=new Host();host.onWorldFullscreenShortcut=a=>actions.push(a);host.setWindow(window);host.setBounds({x:0,y:0,width:100,height:100});
 const request={pluginId,viewId,htmlPath:'D:/owned/world.html',locale:'en',theme:'dark'};host.open(request);host.setVisible(pluginId,viewId,true);
 const view=views[0],wc=view.webContents,scope=view.options.webPreferences.additionalArguments.find(x=>x.startsWith('--scope='))?.slice(8);
 const key=(input={type:'keyDown',key:'F11'})=>{let prevented=0;wc.emit('before-input-event',{preventDefault(){prevented++;}},input);return prevented;};
 const escape=(payload={scope},senderFrame=wc.mainFrame)=>wc.ipc.emit('world-exit',{senderFrame},payload);
 return {host,view,wc,window,actions,scope,key,escape,request};
}
test('only displayed Craftmine world gets a private shortcut scope',()=>{
 const f=fixture();assert.match(f.scope,/^[\da-f-]{36}$/);assert.equal(f.key(),1);assert.deepEqual(f.actions,['toggle']);
 assert.equal(f.key({type:'keyDown',key:'F11',isAutoRepeat:true}),1);f.escape();assert.deepEqual(f.actions,['toggle','exit']);
 for(const ids of [['other.plugin','world'],['craftmine.world','other']]){const x=fixture(...ids);assert.equal(x.scope,undefined);assert.equal(x.key(),0);x.escape();assert.deepEqual(x.actions,[]);}
});
test('stale, hidden, zero-size, detached and subframe messages cannot exit',()=>{
 for(const mutate of [f=>f.host.setVisible('craftmine.world','world',false),f=>f.host.setBounds({width:0,height:0}),f=>f.host.setWindow(null),f=>{f.host.closePlugin('craftmine.world');f.host.open(f.request);f.host.setVisible('craftmine.world','world',true);}]){const f=fixture();mutate(f);assert.equal(f.key(),0);f.escape();assert.deepEqual(f.actions,[]);}
 const f=fixture();for(const value of [null,{}, {scope:'old'}, {scope:f.scope,action:'toggle'}])f.escape(value);f.escape({scope:f.scope},{});assert.deepEqual(f.actions,[]);
});
test('preload bootstrap requires host scope and exposes no fullscreen method',async()=>{
 const raw=await fs.readFile(new URL('electron/preload/plugin-panel.ts',root),'utf8');
 const bootstrap=strip(raw.slice(0,raw.indexOf('type ChromeLabels')));
 for(const argv of [[],['--embedded'],['--scope='+randomUUID()],['--embedded','--scope=invalid'],['--embedded','--scope='+randomUUID()]]){
  let installed=0,handler,disposed=0,exposed;const sent=[],listeners={};
  vm.runInNewContext(bootstrap,{...constants,process:{argv},window:{addEventListener(n,cb){listeners[n]=cb;}},ipcRenderer:{send:(...a)=>sent.push(a)},contextBridge:{exposeInMainWorld(n,b){exposed=b;}},attachFullscreenEscape(w,o){installed++;handler=o.onExit;return()=>disposed++;}});
  assert.deepEqual(Object.keys(exposed).sort(),['invoke','on','send']);assert.equal(installed,argv.length===2&&argv[1]!=='--scope=invalid'?1:0);
  if(installed){handler();assert.equal(sent[0][0],'world-exit');assert.deepEqual(Object.keys(sent[0][1]),['scope']);listeners.pagehide();assert.equal(disposed,1);}
 }
});
