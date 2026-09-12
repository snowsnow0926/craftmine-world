import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {playwright,browserOptions} from '../app/browser-tools.mjs';

const desktop=path.resolve('vendor/pi-desktop/apps/desktop');
const require=createRequire(path.join(desktop,'package.json'));
const out=fs.mkdtempSync(path.resolve('test-results/fb03-input-'));
const report={checks:[],errors:[],scope:'Real React immersion/layout and cursor DOM, deliberately stalled animation frames, pure normal host layer objects; no native input claim'};
const entry=`
import React,{useRef} from 'react';import {createRoot} from 'react-dom/client';
import {useCraftmineLayout,useCraftmineImmersionSurface} from ${JSON.stringify(path.join(desktop,'src/lib/use-craftmine-immersion.ts'))};
import {setCraftmineOverlay} from ${JSON.stringify(path.join(desktop,'src/lib/craftmine-layout.ts'))};
import {attachWorldCursor} from ${JSON.stringify(path.join(desktop,'shared/world-cursor-presentation.ts'))};
import {registerMainLayers,setMainImmersion} from ${JSON.stringify(path.join(desktop,'electron/main/main-window-layers.ts'))};
import {deliverImmersionShortcut} from ${JSON.stringify(path.join(desktop,'electron/main/immersion-shortcut-dispatch.ts'))};
localStorage.setItem('craftmine.desktop.layout.v1',JSON.stringify({mode:'play',overlay:'closed'}));
const f=globalThis.fixture={calls:[],frames:new Map(),violations:[],focused:null,published:[],blocked:false,hasFocus:true,visible:true};
let frameId=0;window.requestAnimationFrame=callback=>{const id=++frameId;f.frames.set(id,callback);return id;};window.cancelAnimationFrame=id=>f.frames.delete(id);
window.focus=()=>f.violations.push('window.focus');HTMLElement.prototype.focus=()=>f.violations.push('element.focus');Element.prototype.requestPointerLock=()=>{f.violations.push('pointerLock');throw Error('disabled');};
const contents=name=>({name,isDestroyed:()=>false,isFocused:()=>f.focused===name,focus(){f.calls.push(name);f.focused=name;}});
const ui={webContents:contents('ui')},world={webContents:contents('world')};
const host={webContents:ui.webContents,isDestroyed:()=>false,isFocused:()=>true,contentView:{children:[ui,world],addChildView(view,index=this.children.length){const previous=this.children.indexOf(view);if(previous>=0)this.children.splice(previous,1);this.children.splice(index,0,view);}}};
registerMainLayers(host,ui,{headless:false});f.host=host;
Object.defineProperty(document,'hasFocus',{value:()=>f.hasFocus});Object.defineProperty(document,'visibilityState',{get:()=>f.visible?'visible':'hidden'});
f.disposeCursor=attachWorldCursor(window,callback=>{f.cursor=callback;return()=>{f.cursor=null;};});
f.publish=state=>{f.published.push(state);f.state=state;setMainImmersion(host,state);f.cursor?.(state.active&&!state.blocked&&!state.covered&&state.overlay==='closed');};
f.dispatch=action=>deliverImmersionShortcut(action,{state:f.state,window:host,send:message=>{f.beforeDispatch=[...f.calls];f.shortcut(message);f.afterDispatch=[...f.calls];}});
f.close=()=>setCraftmineOverlay('closed');
function Root(){const layout=useCraftmineLayout(),surface=useRef(null);useCraftmineImmersionSurface(true,layout.overlay,f.blocked,surface,()=>{});return <section ref={surface} data-overlay={layout.overlay}><canvas style={{cursor:'crosshair'}}/></section>;}
f.root=createRoot(document.getElementById('root'));f.render=()=>f.root.render(<Root/>);f.render();`;
await require('esbuild').build({stdin:{contents:entry,resolveDir:desktop,loader:'tsx'},outfile:path.join(out,'fixture.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',plugins:[{name:'finite-host',setup(b){
 b.onResolve({filter:/^(react|react-dom)(\/.*)?$/},a=>({path:require.resolve(a.path)}));
 b.onResolve({filter:/(^|\/)api$/},()=>({path:'api',namespace:'fixture'}));
 b.onResolve({filter:/(^|\/)craftmine-mode$/},()=>({path:'mode',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},({path:kind})=>({contents:kind==='api'?`export const api={craftmineSetImmersion:async state=>fixture.publish(state),onCraftmineImmersionShortcut:callback=>{fixture.shortcut=callback;return()=>{fixture.shortcut=null;};}};`:`export const enterCraftmineMode=()=>{throw Error('unexpected mode exit');};`}));
}}]});
fs.writeFileSync(path.join(out,'index.html'),'<html><meta charset="utf-8"><div id="root"></div><script src="fixture.js"></script></html>');
let browser;
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log(name);};
try {
 browser=await playwright().chromium.launchPersistentContext(path.join(out,'profile'),browserOptions());
 const page=await browser.newPage();page.on('pageerror',error=>report.errors.push(String(error)));
 await page.goto(pathToFileURL(path.join(out,'index.html')).href);
 const wait=fn=>page.waitForFunction(fn,null,{polling:25});
 const cursor=()=>page.evaluate(()=>getComputedStyle(document.querySelector('canvas')).cursor);
 await wait(()=>fixture.state?.overlay==='closed'&&fixture.shortcut);
 check('initial play ownership publishes without a single animation frame',await page.evaluate(()=>fixture.published.length>0&&fixture.focused==='world'));
 check('focused play hides authored canvas cursor without pointer lock',await cursor()==='none');
 for(const action of ['compact','full']) {
   await page.evaluate(action=>fixture.dispatch(action),action);
   await wait(()=>fixture.state?.overlay!=='closed');
   check(action+' dispatch does not prematurely focus the covered renderer',await page.evaluate(()=>JSON.stringify(fixture.beforeDispatch)===JSON.stringify(fixture.afterDispatch)));
   check(action+' commits visible native UI ownership while rAF is still stalled',await page.evaluate(action=>fixture.state.overlay===action&&fixture.focused==='ui'&&fixture.host.contentView.children.at(-1).webContents.name==='ui'&&fixture.state.overlayBounds===null,action));
   check(action+' restores the world cursor',await cursor()==='auto');
   await page.evaluate(()=>fixture.close());await wait(()=>fixture.state.overlay==='closed');
 }
 await page.evaluate(()=>{fixture.hasFocus=false;window.dispatchEvent(new Event('blur'));});
 check('blur restores cursor while play remains selected',await cursor()==='auto');
 await page.evaluate(()=>{fixture.hasFocus=true;window.dispatchEvent(new Event('focus'));});
 check('focus fact restores play cursor policy',await cursor()==='none');
 await page.evaluate(()=>{fixture.visible=false;document.dispatchEvent(new Event('visibilitychange'));});
 check('hidden document never retains the hidden cursor',await cursor()==='auto');
 await page.evaluate(()=>{fixture.visible=true;document.dispatchEvent(new Event('visibilitychange'));fixture.blocked=true;fixture.render();});
 await wait(()=>fixture.state.blocked);
 check('pause/settings block restores cursor',await cursor()==='auto');
 check('blocked play ignores incoming shortcut dispatch',await page.evaluate(()=>fixture.dispatch('compact')===false));
 await page.evaluate(()=>{fixture.disposeCursor();});
 check('teardown removes trusted override and restores authored cursor',await cursor()==='crosshair');
 check('no physical input, focus call, pointer lock or page failure',await page.evaluate(()=>fixture.violations.length===0)&&report.errors.length===0);
 report.passed=true;
} catch(error) {report.error=String(error.stack??error);throw error;}
finally {await browser?.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(out);}
