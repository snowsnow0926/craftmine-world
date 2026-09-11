import { app, BaseWindow, BrowserWindow, ipcMain } from 'electron';
import { createMainWindow } from '../../electron/main/main-window';
import { setMainImmersion, raiseMainOverlay } from '../../electron/main/main-window-layers';
import { WebContentsView } from 'electron';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

// Deliberately separate from application E2E: no real profile, game, input or shown window.
const root=process.argv[2];
if(!root || !isAbsolute(root)) throw Error('An absolute isolated fixture directory is required');
mkdirSync(root,{recursive:true});
app.setPath('userData',join(root,'profile'));
process.env.CRAFTMINE_HEADLESS_TEST='1';
const violations=[];
const deny=(object,name)=>Object.defineProperty(object,name,{value:()=>{violations.push(name);throw Error(`Forbidden native fixture action: ${name}`);}});
app.on('web-contents-created',(_event,contents)=>{deny(contents,'focus');deny(contents,'sendInputEvent');contents.setWindowOpenHandler(()=>({action:'deny'}));});
const timer=setTimeout(()=>{process.stderr.write('Native fixture timeout\n');app.exit(2);},15000);
const guardPath=join(root,'guard.cjs');
writeFileSync(guardPath,`const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('nativeProbe',{identity:()=>ipcRenderer.invoke('native-owner-probe')});window.addEventListener('DOMContentLoaded',()=>{Element.prototype.requestPointerLock=()=>{throw Error('Pointer Lock prohibited in fixture')};});`);
void app.whenReady().then(async()=>{
  const options={width:640,height:480,show:false,focusable:false,frame:false,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false,preload:guardPath}};
  const owner=createMainWindow(options),ui=owner.contentView.children[0];
  const world=new WebContentsView({webPreferences:{...options.webPreferences,preload:guardPath}});
  owner.contentView.addChildView(world);world.setBounds({x:0,y:0,width:640,height:480});
  ipcMain.handle('native-owner-probe',event=>event.sender===owner.webContents);
  await owner.loadURL('data:text/html,<style>html,body{margin:0;background:transparent}div{position:absolute;left:80px;top:80px;width:160px;height:120px;background:red}</style><div></div>');
  await world.webContents.loadURL('data:text/html,<style>html,body{margin:0;background:lime}</style><p>world</p>');
  assert.equal(await owner.webContents.executeJavaScript('nativeProbe.identity()'),true);
  assert.equal(await world.webContents.executeJavaScript('nativeProbe.identity()'),false);
  assert.equal(BaseWindow.fromId(owner.id),owner);
  const identity=owner.webContents.id,bounds=world.getBounds();
  for(const overlay of ['compact','full']) {
    setMainImmersion(owner,{active:true,overlay,overlayBounds:null});
    assert.equal(owner.contentView.children.at(-1),ui);
    assert.deepEqual(world.getBounds(),bounds);
  }
  // Allow offscreen surfaces to produce a frame, without showing their owner.
  await new Promise(resolve=>setTimeout(resolve,300));
  const capture=await owner.webContents.capturePage(),size=capture.getSize(),pixels=capture.toBitmap();
  assert.equal(capture.isEmpty(),false);assert.deepEqual(size,{width:640,height:480});
  assert.equal(pixels[(10*size.width+10)*4+3],0,'the UI surface outside the floating dialog must be transparent');
  assert.equal(pixels[(90*size.width+90)*4+3],255,'the floating dialog remains opaque');
  const candidate=new WebContentsView({webPreferences:{...options.webPreferences}});owner.contentView.addChildView(candidate);raiseMainOverlay(owner);
  assert.equal(owner.contentView.children.at(-1),ui);
  owner.contentView.removeChildView(candidate);candidate.webContents.close();
  setMainImmersion(owner,{active:true,overlay:'closed',overlayBounds:null});
  assert.equal(owner.contentView.children.at(-1),world);assert.deepEqual(world.getBounds(),bounds);assert.equal(owner.webContents.id,identity);
  assert.equal(owner.isVisible(),false);assert.equal(owner.isFocused(),false);assert.equal(owner.isFocusable(),false);
  const primary=owner.webContents;const closed=new Promise(resolve=>primary.once('destroyed',resolve));world.webContents.close();owner.destroy();
  await closed;assert.equal(primary.isDestroyed(),true);assert.deepEqual(violations,[]);
  const result={ok:true,electron:process.versions.electron,ipcIdentity:true,nativeLayerOrder:true,preservedBounds:bounds,transparentUi:true,stableRenderer:true,closedRenderer:true,violations,compositeScreenshot:false};
  writeFileSync(join(root,'result.json'),JSON.stringify(result,null,2));process.stdout.write(JSON.stringify(result)+'\n');clearTimeout(timer);app.exit(0);
}).catch(error=>{process.stderr.write(String(error.stack||error)+'\n');app.exit(1);});
