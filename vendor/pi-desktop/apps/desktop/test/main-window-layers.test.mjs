import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
register(new URL('./helpers/ts-import-hooks.mjs',import.meta.url));
const {registerMainLayers,setMainImmersion,raiseMainOverlay,mainInputContents}=await import('../electron/main/main-window-layers.ts');
const state=(overlay='closed',blocked=false)=>({active:true,overlay,blocked,overlayBounds:null});
function fixture() {
  const contents=name=>({name,isDestroyed:()=>false});
  const ui={webContents:contents('ui')};
  const world={webContents:contents('world'),bounds:{x:0,y:0,width:1280,height:800}};
  const window={isDestroyed:()=>false,contentView:{children:[ui,world],addChildView(view,index=this.children.length){
    const old=this.children.indexOf(view);if(old>=0)this.children.splice(old,1);this.children.splice(index,0,view);
  }}};
  registerMainLayers(window,ui);
  return {window,world,ui};
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
