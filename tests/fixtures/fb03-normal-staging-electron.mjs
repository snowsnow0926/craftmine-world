import {app,BaseWindow,WebContentsView,session,webContents} from 'electron';
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {GodotWorldViewHost} from '../../vendor/pi-desktop/apps/desktop/electron/main/godot-world-view-host';
import {registerMainLayers,setMainImmersion,mainInputContents} from '../../vendor/pi-desktop/apps/desktop/electron/main/main-window-layers';
const out=process.env.FB03_STAGING_OUT,cancelMode=process.env.FB03_STAGING_CANCEL==='1',report={normalRenderer:true,cancelMode,violations:[],samples:[],passed:false};let host,owner;
app.on('window-all-closed',()=>{});
app.commandLine.appendSwitch('enable-unsafe-swiftshader');app.commandLine.appendSwitch('use-angle','swiftshader');
app.on('web-contents-created',(_event,contents)=>{for(const name of ['focus','sendInputEvent'])contents[name]=()=>{report.violations.push('webContents.'+name);throw Error('INPUT_FORBIDDEN');};});
app.focus=()=>{report.violations.push('app.focus');throw Error('FOCUS_FORBIDDEN');};
for(const name of ['show','showInactive','focus'])BaseWindow.prototype[name]=function(){report.violations.push(name);throw Error('WINDOW_ACTIVATION_FORBIDDEN');};
app.on('session-created',ses=>{ses.registerPreloadScript({type:'frame',filePath:path.join(__dirname,'../preload/craftmine-headless.cjs')});ses.setPermissionRequestHandler((_a,_b,callback)=>callback(false));ses.setPermissionCheckHandler(()=>false);});
app.whenReady().then(async()=>{
 const descriptor=JSON.parse(fs.readFileSync(path.join(out,'descriptor.json')));
 owner=new BaseWindow({show:false,focusable:false,width:1000,height:700});
 const ui=new WebContentsView({webPreferences:{offscreen:false,contextIsolation:true,nodeIntegration:false,sandbox:true}});
 ui.setBounds({x:0,y:0,width:1000,height:700});owner.contentView.addChildView(ui);registerMainLayers(owner,ui,{headless:false});
 await ui.webContents.loadFile(path.join(__dirname,'owner.html'));
 host=new GodotWorldViewHost({window:()=>owner,allowedRoots:()=>[descriptor.root],onState:state=>{report.lastState=state;},progress:async()=>{throw Error('NO_PROGRESS_WRITE');}});
 host.setBounds({x:0,y:0,width:960,height:640});host.setVisible(true);
 if(cancelMode) {await host.ensure(descriptor);await host.pause();report.original=host.instance;report.originalSnapshot=await host.snapshot();}
 const start=Date.now();
 const sample=async()=>{for(const c of webContents.getAllWebContents()) {if(c.isDestroyed()||!c.getURL().startsWith('http'))continue;try {const view=owner.contentView.children.find(v=>v.webContents===c);const dom=await c.executeJavaScript(`(()=>{if(!globalThis.frameProbe){globalThis.frameProbe={frames:0};const tick=()=>{frameProbe.frames++;requestAnimationFrame(tick);};requestAnimationFrame(tick);}return {frames:frameProbe.frames,visibility:document.visibilityState,focused:document.hasFocus(),canvas:[document.querySelector('canvas')?.width,document.querySelector('canvas')?.height],status:document.querySelector('#status')?.textContent};})()`,false);report.samples.push({at:Date.now()-start,id:c.id,attached:!!view,bounds:view?.getBounds(),throttled:c.getBackgroundThrottling(),...dom});}catch(error){report.samples.push({at:Date.now()-start,error:String(error)});}}};
 const sampler=setInterval(()=>{void sample();},1000);
 let mutations=0;
 const mutate=setInterval(()=>{
  mutations++;host.setBounds({x:0,y:0,width:mutations%2?960:940,height:640});host.setVisible(mutations%2===0);host.setSurfaceVisible(mutations%3===0);
  const state={active:true,overlay:mutations%2?'compact':'closed',blocked:cancelMode,overlayBounds:null};setMainImmersion(owner,state);void host.setImmersion(state).catch(error=>report.violations.push(String(error)));
  assert.equal(mainInputContents(owner),ui.webContents,'preparing world must never own input');
 },150);
 try {
  if(cancelMode) {
   const early=host.stageCandidate(descriptor,{candidateId:'cancel-before-runtime'}).then(()=>{throw Error('Early cancellation did not interrupt');},error=>String(error));
   assert.equal(await host.cancelStaging(descriptor.worldId),true);assert.match(await early,/cancelled/);assert.deepEqual(host.instance,report.original);report.earlyCancelled=true;
   let cancelling=false;let finishCancel;const cancelled=new Promise(resolve=>{finishCancel=resolve;});
   const poll=setInterval(async()=>{if(cancelling)return;for(const c of webContents.getAllWebContents()) {
    if(c.isDestroyed()||!c.getURL().startsWith('http')||c.getURL()===report.original.url)continue;
    try {if(!await c.executeJavaScript(`document.querySelector('#status')?.textContent.includes('恢复世界进度')`,false))continue;
     cancelling=true;clearInterval(poll);report.cancelAt=Date.now()-start;assert.equal(await host.cancelStaging('other-world'),false);
     report.cancelAccepted=await host.cancelStaging(descriptor.worldId);finishCancel();break;
    }catch(error){report.violations.push(String(error));finishCancel();}
   }},20);
   try {await host.stageCandidate(descriptor,{candidateId:'cancel-during-real-load'});throw Error('Cancellation did not interrupt stage');}
   catch(error){report.cancelError=String(error);assert.match(String(error),/cancelled/);}
   finally {clearInterval(poll);}
   await cancelled;assert.equal(report.cancelAccepted,true);assert.deepEqual(host.instance,report.original);assert.deepEqual(await host.snapshot(),report.originalSnapshot);
   assert.equal(host.candidateInstance,null);assert.equal(await host.cancelStaging(descriptor.worldId),false);
   report.currentPreserved=true;
   await host.stageCandidate(descriptor,{candidateId:'retry-after-cancel'});report.retrySnapshot=await host.candidateRequest('snapshot');assert.deepEqual(report.retrySnapshot.state,descriptor.snapshot);
   await host.discardCandidate();assert.deepEqual(host.instance,report.original);report.loaded=true;report.retryPassed=true;
  } else {
   await host.stageCandidate(descriptor,{first:true,candidateId:'original-fb03-candidate'});report.loaded=true;report.snapshot=await host.candidateRequest('snapshot');assert.deepEqual(report.snapshot.state,descriptor.snapshot);await sample();
  }
 }
 catch(error){report.loaded=false;report.error=String(error.stack??error);}
 clearInterval(sampler);
 clearInterval(mutate);report.layoutUpdates=mutations;
 if(report.loaded&&!cancelMode) {
  const state={active:true,overlay:'closed',blocked:false,overlayBounds:null};setMainImmersion(owner,state);await host.setImmersion(state);host.setVisible(true);host.setSurfaceVisible(true);
  host.setCandidateVisible(true);const candidate=host.candidateInstance;assert.ok(candidate);assert.notEqual(mainInputContents(owner),ui.webContents);
  host.setCandidateVisible(false);assert.equal(mainInputContents(owner),ui.webContents);
  report.promoted=await host.promoteCandidate({...descriptor,revision:descriptor.revision+1});assert.equal(host.instance.instanceId,candidate.instanceId);assert.equal(report.promoted.state,'ready');
 }
 report.elapsedMs=Date.now()-start;
 report.native=webContents.getAllWebContents().filter(c=>!c.isDestroyed()).map(c=>({id:c.id,url:c.getURL(),offscreen:c.isOffscreen(),backgroundThrottling:c.getBackgroundThrottling()}));
 for(const c of webContents.getAllWebContents()){if(c.isDestroyed()||!c.getURL().startsWith('http'))continue;const guard=await c.executeJavaScript('globalThis.__craftmineHeadless',false);assert.deepEqual(guard,{pointerLock:0,focus:0});}
 assert.equal(owner.isVisible(),false);assert.equal(owner.isFocusable(),false);assert.ok(report.native.every(c=>c.offscreen===false));assert.deepEqual(report.violations,[]);
 await host.dispose();assert.deepEqual(owner.contentView.children,[ui],'retired pending view must detach');assert.equal(webContents.getAllWebContents().filter(c=>!c.isDestroyed()&&c.getURL().startsWith('http')).length,0);report.worldRenderersRetired=true;ui.webContents.close();owner.destroy();report.passed=report.loaded;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));app.exit(report.loaded?0:1);
}).catch(async error=>{report.error=String(error.stack??error);try{await host?.dispose();owner?.destroy();}finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));app.exit(1);}});
