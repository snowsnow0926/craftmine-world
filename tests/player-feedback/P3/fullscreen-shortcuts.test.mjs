// Synthetic objects call policy/listener functions directly; no OS/DOM input.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
const deps=process.env.CRAFTMINE_NATIVE_DEPENDENCY_ROOT||'C:/cm-plan-next-20260910';
const {buildSync}=createRequire(path.join(deps,'vendor/pi-desktop/apps/desktop/package.json'))('esbuild');
const result=buildSync({entryPoints:[path.resolve('vendor/pi-desktop/apps/desktop/shared/world-fullscreen-shortcuts.ts')],bundle:true,platform:'node',format:'cjs',write:false});
const module={exports:{}};vm.runInNewContext(result.outputFiles[0].text,{module,exports:module.exports,Promise,WeakMap,Array});
const {nativeFullscreenKeyDecision,mayExitFullscreen,attachFullscreenEscape}=module.exports;
const key={type:'keyDown',key:'F11'};
test('native F11 is finite and repeat-safe',()=>{
 assert.equal(nativeFullscreenKeyDecision(key).action,'toggle');
 assert.equal(nativeFullscreenKeyDecision({...key,isAutoRepeat:true}).action,null);
 assert.equal(nativeFullscreenKeyDecision({...key,isAutoRepeat:true}).preventDefault,true);
 for(const patch of [{type:'keyUp'},{key:'Escape'},{key:'F12'},{isComposing:true},{keyCode:229},{alt:true},{control:true},{meta:true},{shift:true}])assert.equal(nativeFullscreenKeyDecision({...key,...patch}).preventDefault,false);
});
const event={key:'Escape',isTrusted:true,isComposing:false,keyCode:27,repeat:false,altKey:false,ctrlKey:false,metaKey:false,shiftKey:false,defaultPrevented:false};
const context={pointerLocked:false,overlayOpen:false,editing:false,composing:false};
test('escape policy accepts only an unconsumed trusted unmodified first press',()=>{
 assert.equal(mayExitFullscreen(event,context),true);
 for(const patch of [{key:'F11'},{isTrusted:false},{isComposing:true},{keyCode:229},{repeat:true},{altKey:true},{ctrlKey:true},{metaKey:true},{shiftKey:true},{defaultPrevented:true}])assert.equal(mayExitFullscreen({...event,...patch},context),false);
 for(const name of Object.keys(context))assert.equal(mayExitFullscreen(event,{...context,[name]:true}),false);
});
function harness(){
 const listeners=new Map(),actions=[],errors=[];let visible=false,editing=false;
 const overlay={closest:()=>null,getClientRects:()=>visible?[{}]:[]};
 const document={pointerLockElement:null,defaultView:{getComputedStyle:()=>({display:'block',visibility:'visible'})},activeElement:{matches:()=>editing,closest:()=>null},querySelectorAll:()=>[overlay]};
 const target={document,queueMicrotask,addEventListener(type,fn,capture=false){listeners.set(type+':'+capture,fn)},removeEventListener(type,fn,capture=false){assert.equal(listeners.get(type+':'+capture),fn);listeners.delete(type+':'+capture)}};
 let hold=null;
 const dispose=attachFullscreenEscape(target,{onExit:()=>{actions.push('exit');return hold;},onError:error=>errors.push(String(error))});
 const capture=e=>listeners.get('keydown:true')?.(e),bubble=e=>listeners.get('keydown:false')?.(e);
 return {listeners,actions,errors,document,dispose,capture,bubble,setVisible:v=>visible=v,setEditing:v=>editing=v,setHold:v=>hold=v};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('unconsumed escape invokes only exit, never toggle/close/navigation',async()=>{const h=harness(),e={...event};h.capture(e);h.bubble(e);await tick();assert.deepEqual(h.actions,['exit']);h.dispose();assert.equal(h.listeners.size,0);});
test('menu present at capture blocks exit even if its handler removes it',async()=>{const h=harness(),e={...event};h.setVisible(true);h.capture(e);h.setVisible(false);h.bubble(e);await tick();assert.equal(h.actions.length,0);h.dispose();});
test('same Escape cannot release pointer capture and exit fullscreen',async()=>{const h=harness(),e={...event};h.document.pointerLockElement={};h.capture(e);h.document.pointerLockElement=null;h.bubble(e);await tick();assert.equal(h.actions.length,0);const next={...event};h.capture(next);h.bubble(next);await tick();assert.deepEqual(h.actions,['exit']);h.dispose();});
test('late bubble consumer wins before deferred fullscreen request',async()=>{const h=harness(),e={...event};h.capture(e);h.bubble(e);e.defaultPrevented=true;await tick();assert.equal(h.actions.length,0);h.dispose();});
test('new overlay before deferred decision blocks fullscreen exit',async()=>{const h=harness(),e={...event};h.capture(e);h.bubble(e);h.setVisible(true);await tick();assert.equal(h.actions.length,0);h.dispose();});
test('composition lifecycle suppresses Escape even without event flag',async()=>{const h=harness(),e={...event};h.listeners.get('compositionstart:true')();h.capture(e);h.listeners.get('compositionend:true')();h.bubble(e);await tick();assert.equal(h.actions.length,0);h.dispose();});
test('native editing-control context is retained until the next key',async()=>{const h=harness(),e={...event};h.setEditing(true);h.capture(e);h.setEditing(false);h.bubble(e);await tick();assert.equal(h.actions.length,0);h.dispose();});
test('untrusted synthetic key never requests a window action',async()=>{const h=harness(),e={...event,isTrusted:false};h.capture(e);h.bubble(e);await tick();assert.equal(h.actions.length,0);h.dispose();});
test('disposing view cancels queued action and removes all handlers',async()=>{const h=harness(),e={...event};h.capture(e);h.bubble(e);h.dispose();await tick();assert.equal(h.actions.length,0);assert.equal(h.listeners.size,0);});
test('focus departure invalidates a queued action',async()=>{const h=harness(),e={...event};h.capture(e);h.bubble(e);h.listeners.get('blur:false')();await tick();assert.equal(h.actions.length,0);h.dispose();});
test('pending window action is single-flight; failure permits a later request',async()=>{const h=harness();let reject;h.setHold(new Promise((_,r)=>reject=r));for(let i=0;i<2;i++){const e={...event};h.capture(e);h.bubble(e)}await tick();assert.equal(h.actions.length,1);reject(Error('window unavailable'));await tick();assert.equal(h.errors.length,1);h.setHold(null);const next={...event};h.capture(next);h.bubble(next);await tick();assert.equal(h.actions.length,2);h.dispose();});
