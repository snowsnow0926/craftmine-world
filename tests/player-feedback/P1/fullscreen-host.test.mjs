// Real host/preload code with controlled event emitters, never OS input.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {join,resolve,sep} from 'node:path';
const strip=source=>stripTypeScriptTypes(source,{mode:'transform'}).replace(/^import[\s\S]*?from ["'][^"']+["'];\s*/gm,'').replace(/^export /gm,'');
const hostSource=strip(await fs.readFile(new URL('../../../vendor/pi-desktop/apps/desktop/electron/main/godot-world-view-host.ts',import.meta.url),'utf8'));
const helperSource=strip(await fs.readFile(new URL('../../../vendor/pi-desktop/apps/desktop/shared/world-fullscreen-shortcuts.ts',import.meta.url),'utf8'));
const nativeFullscreenKeyDecision=vm.runInNewContext(helperSource+'\nnativeFullscreenKeyDecision');
const channel='pi-desktop/godot-world/fullscreen-exit';
function fixture(){
 const actions=[],window={contentView:{children:[]},isDestroyed:()=>false};
 class View { constructor(){this.webContents=Object.assign(new EventEmitter(),{ipc:new EventEmitter(),mainFrame:{},isDestroyed:()=>false,setWindowOpenHandler(){}});} setBounds(){} }
 const Host=vm.runInNewContext(hostSource+'\nGodotWorldViewHost',{join,resolve,sep,console,__dirname:'owned',isHeadlessAcceptance:()=>true,WebContentsView:View,WORLD_CHROME_HEIGHT:76,nativeFullscreenKeyDecision,godotWorldScopeArgument:()=>'',GODOT_WORLD_MESSAGE_CHANNEL:'message',GODOT_WORLD_FULLSCREEN_EXIT_CHANNEL:channel});
 const host=new Host({window:()=>window,onFullscreenShortcut:action=>actions.push(action)});
 host.prepareSession=()=>({});
 const runtime={protocol:'craftmine.godot-runtime/2',worldId:'alpha',buildId:'build-alpha',instanceId:'instance-alpha',receive(){}};
 const view=host.createView(runtime);
 const live={runtime,view,alive:true,faults:[]};host.current=live;host.visible=true;host.surfaceVisible=true;window.contentView.children.push(view);
 const key=(input={type:'keyDown',key:'F11'})=>{let prevented=0;view.webContents.emit('before-input-event',{preventDefault(){prevented++;}},input);return prevented;};
 const escape=(payload=runtime,frame=view.webContents.mainFrame)=>view.webContents.ipc.emit(channel,{senderFrame:frame},payload);
 const scope={protocol:runtime.protocol,worldId:runtime.worldId,buildId:runtime.buildId,instanceId:runtime.instanceId};
 return {host,view,window,actions,key,escape,scope,live};
}
test('displayed view toggles only plain F11 and consumes repeats without toggling',()=>{
 const f=fixture();assert.equal(f.key(),1);assert.deepEqual(f.actions,['toggle']);
 assert.equal(f.key({type:'keyDown',key:'F11',isAutoRepeat:true}),1);assert.equal(f.actions.length,1);
 for(const input of [{type:'keyUp',key:'F11'},{type:'keyDown',key:'Escape'},{type:'keyDown',key:'F11',control:true},{type:'keyDown',key:'F11',isComposing:true}])assert.equal(f.key(input),0);
 assert.equal(f.actions.length,1);
});
test('old, hidden, detached and unshown candidate views cannot affect fullscreen',()=>{
 for(const mutate of [f=>f.host.visible=false,f=>f.host.surfaceVisible=false,f=>f.host.current=null,f=>f.live.alive=false,f=>f.window.contentView.children.length=0,f=>{f.host.current=null;f.host.pending=f.live;}]){
  const f=fixture();mutate(f);assert.equal(f.key(),0);f.escape(f.scope);assert.deepEqual(f.actions,[]);
 }
 const f=fixture();f.host.current=null;f.host.pending=f.live;f.host.stagedRequest={};f.host.candidateVisible=true;assert.equal(f.key(),1);assert.deepEqual(f.actions,['toggle']);
});
test('escape private channel accepts only its displayed top-frame exact scope',()=>{
 const f=fixture();
 for(const payload of [null,{}, {...f.scope,instanceId:'old'}, {...f.scope,worldId:'other'}, {...f.scope,action:'toggle'}, {...f.scope,script:'arbitrary'}])f.escape(payload);
 f.escape(f.scope,{});assert.deepEqual(f.actions,[]);
 f.escape(f.scope);assert.deepEqual(f.actions,['exit']);
 f.host.disposed=true;f.escape(f.scope);assert.deepEqual(f.actions,['exit']);
});
test('preload adds no page API and sends only fixed scope, with detach/pagehide disposal',async()=>{
 const source=strip(await fs.readFile(new URL('../../../vendor/pi-desktop/apps/desktop/electron/preload/godot-world.ts',import.meta.url),'utf8'));
 const scope={protocol:'craftmine.godot-runtime/2',worldId:'alpha',buildId:'build-alpha',instanceId:'instance-alpha'};
 const sent=[],listeners={};let handler,disposed=0,exposed;
 const ipcRenderer=Object.assign(new EventEmitter(),{send:(...args)=>sent.push(args)});
 vm.runInNewContext(source,{scope,process:{argv:['fixed']},parseGodotWorldScopeArgument:()=>scope,contextBridge:{exposeInMainWorld(_name,value){exposed=value;}},ipcRenderer,window:{addEventListener(name,callback){listeners[name]=callback;}},attachFullscreenEscape(_window,options){handler=options.onExit;return()=>disposed++;},GODOT_WORLD_FULLSCREEN_EXIT_CHANNEL:channel,GODOT_WORLD_MESSAGE_CHANNEL:'message',GODOT_WORLD_DETACH_CHANNEL:'detach'});
 assert.deepEqual(Object.keys(exposed).sort(),['on','onDetach','post','scope']);
 handler();assert.deepEqual(sent,[[channel,scope]]);ipcRenderer.emit('detach');listeners.pagehide();assert.equal(disposed,2);
});
