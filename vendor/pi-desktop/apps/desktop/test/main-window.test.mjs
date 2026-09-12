import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {registerHooks} from 'node:module';
const fixture={headless:false,guards:[],views:[]};
class Contents extends EventEmitter {
  destroyed=false;focusCount=0;loads=[];
  isDestroyed(){return this.destroyed;}
  isFocused(){return fixture.focusedContents===this;}
  focus(){this.focusCount++;fixture.focusedContents=this;}
  close(options){this.closeOptions=options;this.destroyed=true;this.emit('destroyed');}
  loadURL(...args){this.loads.push(['url',...args]);return Promise.resolve();}
  loadFile(...args){this.loads.push(['file',...args]);return Promise.resolve();}
}
class BaseWindow extends EventEmitter {
  destroyed=false;focused=false;size=[1280,800];
  contentView={children:[],addChildView(view,index=this.children.length){const old=this.children.indexOf(view);if(old>=0)this.children.splice(old,1);this.children.splice(index,0,view);}};
  constructor(options){super();this.options=options;}
  isDestroyed(){return this.destroyed;}
  isFocused(){return this.focused;}
  getContentSize(){return this.size;}
  destroy(){this.destroyed=true;this.emit('closed');}
}
class WebContentsView {
  webContents=new Contents();
  constructor(options){this.options=options;fixture.views.push(this);}
  setBackgroundColor(color){this.color=color;}
  setBounds(bounds){this.bounds=bounds;}
}
globalThis.__mainWindowFixture={BaseWindow,WebContentsView,fixture};
const moduleUrl=code=>'data:text/javascript,'+encodeURIComponent(code);
const hooks=registerHooks({resolve(specifier,context,next){
  if(specifier==='electron')return {url:moduleUrl('export const {BaseWindow,WebContentsView}=globalThis.__mainWindowFixture;'),shortCircuit:true};
  if(specifier==='./craftmine-headless')return {url:moduleUrl('const f=globalThis.__mainWindowFixture.fixture;export const isHeadlessAcceptance=()=>f.headless;export const guardHeadlessWindow=w=>f.guards.push(w);'),shortCircuit:true};
  if(specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier)){try{return next(specifier+'.ts',context);}catch{}}
  return next(specifier,context);
}});
const {createMainWindow}=await import('../electron/main/main-window.ts');
const {setMainImmersion}=await import('../electron/main/main-window-layers.ts');
test('composite main window preserves isolated renderer preferences and delegates loading to one stable owner',async()=>{
  const webPreferences={sandbox:true,contextIsolation:true,nodeIntegration:false,preload:'/trusted/index.cjs',session:{partition:'test-only'}};
  const window=createMainWindow({width:1280,height:800,show:false,focusable:false,webPreferences});
  const renderer=fixture.views.at(-1);assert.equal(renderer.options.webPreferences,webPreferences);
  assert.equal(window.options.webPreferences,undefined);assert.equal(window.webContents,renderer.webContents);
  assert.equal(renderer.color,'#00000000');assert.deepEqual(renderer.bounds,{x:0,y:0,width:1280,height:800});
  await window.loadURL('app://shell');await window.loadFile('/shell/index.html');
  assert.deepEqual(window.webContents.loads,[['url','app://shell'],['file','/shell/index.html']]);
  assert.equal(fixture.guards.at(-1),window);
});
test('actual window resize updates UI bounds, closing releases renderer, and renderer destruction closes owner',()=>{
  const window=createMainWindow({show:false});const renderer=fixture.views.at(-1);
  window.size=[960,640];window.emit('resize');assert.deepEqual(renderer.bounds,{x:0,y:0,width:960,height:640});
  window.destroy();assert.equal(window.webContents.isDestroyed(),true);assert.deepEqual(window.webContents.closeOptions,{waitForBeforeUnload:false});
  assert.equal(window.listenerCount('resize'),0);
  const other=createMainWindow({show:false});other.webContents.close({});assert.equal(other.isDestroyed(),true);
});
test('user window focus follows overlay ownership while headless validation cannot focus any renderer',()=>{
  const window=createMainWindow({show:false});const game=new WebContentsView({});window.contentView.addChildView(game);
  const active={active:true,overlay:'closed',overlayBounds:null};setMainImmersion(window,active);
  window.focused=true;window.emit('focus');assert.equal(game.webContents.focusCount,1);assert.equal(window.webContents.focusCount,0);
  setMainImmersion(window,{...active,overlay:'compact'});window.emit('focus');assert.equal(window.webContents.focusCount,1);
  fixture.headless=true;const hidden=createMainWindow({show:false,focusable:false});hidden.focused=true;hidden.emit('focus');assert.equal(hidden.webContents.focusCount,0);fixture.headless=false;
});
