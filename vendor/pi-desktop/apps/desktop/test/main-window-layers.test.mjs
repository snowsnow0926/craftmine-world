import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
register(new URL('./helpers/ts-import-hooks.mjs',import.meta.url));
const {registerMainLayers,setMainImmersion,raiseMainOverlay,mainInputContents,syncMainInputFocus}=await import('../electron/main/main-window-layers.ts');
const state=(overlay='closed',blocked=false)=>({active:true,overlay,blocked,overlayBounds:null});
function fixture(headless=false) {
  const calls=[];let focused=null;
  // Pure objects only. No Electron window or actual focus operation exists.
  const contents=name=>({name,destroyed:false,isDestroyed(){return this.destroyed;},isFocused(){return focused===this;},focus(){calls.push(name);focused=this;}});
  const ui={webContents:contents('ui')};
  const world={webContents:contents('world'),bounds:{x:0,y:0,width:1280,height:800}};
  const window={focused:false,isFocused(){return this.focused;},isDestroyed:()=>false,contentView:{children:[ui,world],addChildView(view,index=this.children.length){
    const old=this.children.indexOf(view);if(old>=0)this.children.splice(old,1);this.children.splice(index,0,view);
  },removeChildView(view){this.children=this.children.filter(entry=>entry!==view);}}};
  registerMainLayers(window,ui,{headless});
  return {window,world,ui,calls,view:name=>({webContents:contents(name)})};
}
test('compact/full overlays reorder real native siblings without touching world or renderer geometry',()=>{
  const {window,ui,world}=fixture();const original=world.bounds;
  for(const overlay of ['compact','full']) {
    setMainImmersion(window,state(overlay));assert.deepEqual(window.contentView.children,[world,ui]);
    assert.equal(mainInputContents(window),ui.webContents);assert.strictEqual(world.bounds,original);
  }
  setMainImmersion(window,state());assert.deepEqual(window.contentView.children,[ui,world]);
  assert.equal(mainInputContents(window),world.webContents);
});
test('new candidates and blocking dialogs cannot cover the application overlay',()=>{
  const {window,ui,world}=fixture();setMainImmersion(window,state('closed',true));
  const candidate={webContents:{isDestroyed:()=>false}};window.contentView.addChildView(candidate);
  raiseMainOverlay(window);assert.deepEqual(window.contentView.children,[world,candidate,ui]);
  assert.equal(mainInputContents(window),ui.webContents);
  setMainImmersion(window,state());assert.equal(mainInputContents(window),candidate.webContents);
});
test('workbench restores UI input and reload recovery leaves native worlds intact',()=>{
  const {window,ui,world}=fixture();setMainImmersion(window,state('full'));
  setMainImmersion(window,{active:false,overlay:'closed',overlayBounds:null});
  assert.deepEqual(window.contentView.children,[ui,world]);assert.equal(mainInputContents(window),ui.webContents);
  window.isDestroyed=()=>true;setMainImmersion(window,state('full'));assert.equal(mainInputContents(window),null);
});

test('focused owner replacement and detach hand input to the displayed child once',()=>{
  const f=fixture();f.window.focused=true;setMainImmersion(f.window,state());
  assert.deepEqual(f.calls,['world']);
  const replacement=f.view('replacement');f.window.contentView.addChildView(replacement);raiseMainOverlay(f.window);
  assert.deepEqual(f.calls,['world','replacement']);
  for(let i=0;i<20;i++)raiseMainOverlay(f.window);
  assert.deepEqual(f.calls,['world','replacement'],'geometry updates do not refocus the same child');
  f.window.contentView.removeChildView(replacement);syncMainInputFocus(f.window);
  assert.deepEqual(f.calls,['world','replacement','world']);
});

test('dialog input priority survives a candidate attaching and is released only when the overlay closes',()=>{
  const f=fixture();f.window.focused=true;setMainImmersion(f.window,state());
  setMainImmersion(f.window,state('closed',true));
  const candidate=f.view('candidate');f.window.contentView.addChildView(candidate);raiseMainOverlay(f.window);
  assert.deepEqual(f.calls,['world','ui']);
  assert.equal(f.window.contentView.children.at(-1),f.ui);
  setMainImmersion(f.window,state());assert.deepEqual(f.calls,['world','ui','candidate']);
});

test('background attachments never focus; a later genuine window-focus event restores the latest owner',()=>{
  const f=fixture();setMainImmersion(f.window,state());
  const candidate=f.view('candidate');f.window.contentView.addChildView(candidate);raiseMainOverlay(f.window);
  assert.deepEqual(f.calls,[]);
  f.window.focused=true;syncMainInputFocus(f.window,'window-focus');assert.deepEqual(f.calls,['candidate']);
  f.window.focused=false;f.window.contentView.removeChildView(candidate);syncMainInputFocus(f.window);assert.deepEqual(f.calls,['candidate']);
  f.window.focused=true;syncMainInputFocus(f.window,'window-focus');assert.deepEqual(f.calls,['candidate','world']);
});

test('headless owners prohibit all handoffs even if a fixture incorrectly reports native focus',()=>{
  const f=fixture(true);f.window.focused=true;setMainImmersion(f.window,state());
  const candidate=f.view('candidate');f.window.contentView.addChildView(candidate);raiseMainOverlay(f.window);
  setMainImmersion(f.window,state('full'));syncMainInputFocus(f.window,'window-focus');
  f.window.contentView.removeChildView(candidate);syncMainInputFocus(f.window);
  assert.deepEqual(f.calls,[]);
});

test('destroyed contents are not selected and a destroyed owner cannot hand off input',()=>{
  const f=fixture();f.window.focused=true;f.world.webContents.destroyed=true;setMainImmersion(f.window,state());
  assert.deepEqual(f.calls,['ui']);
  f.window.isDestroyed=()=>true;const candidate=f.view('candidate');f.window.contentView.addChildView(candidate);syncMainInputFocus(f.window,'window-focus');
  assert.deepEqual(f.calls,['ui']);
});
