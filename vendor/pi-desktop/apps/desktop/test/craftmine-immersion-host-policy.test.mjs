import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
register(pathToFileURL(fileURLToPath(new URL('./helpers/ts-import-hooks.mjs',import.meta.url))));
const {parseImmersion,excludeImmersion,immersionShortcut,attachImmersionInput,immersionBlocksInput,NO_IMMERSION}=await import('../shared/craftmine-immersion.ts');
const world={x:100,y:40,width:1000,height:700};
const compact={active:true,overlay:'compact',overlayBounds:{x:100,y:540,width:1000,height:200}};
const full={active:true,overlay:'full',overlayBounds:{x:700,y:40,width:400,height:700}};

test('native overlays preserve the complete world rectangle including blocked and unmeasured states',()=>{
  for (const state of [compact, full, {...compact,overlay:'full'}, NO_IMMERSION,
    {...compact,overlayBounds:null}, {...NO_IMMERSION,active:true,blocked:true}]) {
    assert.strictEqual(excludeImmersion(world,state),world);
  }
  assert.deepEqual(world,{x:100,y:40,width:1000,height:700});
});
test('invalid states and hostile numeric geometry fail before native mutation',()=>{
  for(const value of [null,{}, {...compact,active:'true'}, {...compact,blocked:1}, {...compact,overlay:'other'},
    ...[NaN,Infinity,-1,100001].map(x=>({...compact,overlayBounds:{...compact.overlayBounds,x}}))]) assert.throws(()=>parseImmersion(value));
  const parsed=parseImmersion(compact);compact.overlayBounds.height=201;
  assert.equal(parsed.overlayBounds.height,200);compact.overlayBounds.height=200;
  assert.equal(immersionBlocksInput({...NO_IMMERSION,active:true,blocked:true}),true);
  assert.equal(immersionBlocksInput({...compact,active:false}),false);
});
test('finite native shortcuts layer Escape from overlay to workbench',()=>{
  assert.equal(immersionShortcut({type:'keyDown',key:'F2'},false),'compact');
  assert.equal(immersionShortcut({type:'keyDown',key:'F2',shift:true},false),'full');
  assert.equal(immersionShortcut({type:'keyDown',key:'Escape'},true),'escape');
  // A closed overlay has nothing left to dismiss, so the same key returns to
  // the workbench instead of being swallowed.
  assert.equal(immersionShortcut({type:'keyDown',key:'Escape'},false),'exit-play');
  assert.equal(immersionShortcut({type:'keyDown',key:'Escape',shift:true},false),null);
  assert.equal(immersionShortcut({type:'keyDown',key:'F11'},false),null);
  for(const patch of [{isAutoRepeat:true},{isComposing:true},{keyCode:229},{control:true},{meta:true},{alt:true},{type:'keyUp'}])
    assert.equal(immersionShortcut({type:'keyDown',key:'F2',...patch},true),null);
});
function inputFixture(gameFramesOnly=false){
  let notify,observed,disconnected=false;
  const saved=globalThis.MutationObserver;
  globalThis.MutationObserver=class {constructor(fn){observed=fn;}observe(){}disconnect(){disconnected=true;}};
  const listeners=new Map(),frame={inert:false,style:{pointerEvents:'auto'}},frames=[frame];
  const target={document:{querySelectorAll:()=>frames,pointerLockElement:null},
    addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
  const dispose=attachImmersionInput(target,fn=>{notify=fn;return()=>{notify=null;}},{gameFramesOnly});
  const invoke=type=>{let stopped=0;listeners.get(type)?.({type,preventDefault:()=>stopped++,stopImmediatePropagation:()=>stopped++});return stopped;};
  return {frame,frames,notify:value=>notify(value),invoke,mutate:()=>observed(),dispose:()=>{dispose();globalThis.MutationObserver=saved;assert.equal(disconnected,true);assert.equal(listeners.size,0);}};
}
test('game guard blocks pointer/key press but restores iframe policy on release',()=>{
  const f=inputFixture();assert.equal(f.invoke('keydown'),0);f.notify(true);
  assert.equal(f.invoke('keydown'),2);assert.equal(f.invoke('wheel'),2);assert.equal(f.frame.inert,true);assert.equal(f.frame.style.pointerEvents,'none');
  const dynamic={inert:true,style:{pointerEvents:'all'}};f.frames.push(dynamic);f.mutate();assert.equal(dynamic.style.pointerEvents,'none');
  f.notify(false);assert.equal(f.frame.inert,false);assert.equal(dynamic.inert,true);assert.equal(dynamic.style.pointerEvents,'all');f.dispose();
});
test('plugin guard blocks opaque game frames while preserving workbench controls',()=>{
  const f=inputFixture(true);f.notify(true);assert.equal(f.frame.inert,true);assert.equal(f.invoke('click'),0);assert.equal(f.invoke('keydown'),0);
  f.dispose();assert.equal(f.frame.inert,false);assert.equal(f.frame.style.pointerEvents,'auto');
});
