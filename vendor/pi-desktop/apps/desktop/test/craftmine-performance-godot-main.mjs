import {app,BrowserWindow,webContents} from 'electron';
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {GodotWorldViewHost} from '../electron/main/godot-world-view-host';
import {createCraftminePerformanceSampler} from '../electron/main/craftmine-performance-sample';
const out=process.env.CRAFTMINE_PERFORMANCE_OUT,phase=process.env.CRAFTMINE_PERFORMANCE_PHASE;
const report={phase,passed:false,scope:'Actual exported Godot Web scene, production GodotWorldViewHost and OS sampler; local fixture progress store, no Core/plugin/model/player benchmark'};
let host,owner;
const write=()=>fs.writeFileSync(path.join(out,phase+'-report.json'),JSON.stringify(report,null,2));
const finish=async error=>{if(error)report.error=String(error.stack||error);write();try{await host?.dispose();owner?.destroy();}finally{app.exit(error?1:0);}};
process.on('uncaughtException',finish);process.on('unhandledRejection',finish);app.on('window-all-closed',()=>{});
app.commandLine.appendSwitch('enable-unsafe-swiftshader');app.commandLine.appendSwitch('use-angle','swiftshader');
app.on('session-created',ses=>{ses.registerPreloadScript({type:'frame',filePath:path.join(__dirname,'../preload/craftmine-headless.cjs')});ses.setPermissionRequestHandler((_a,_b,cb)=>cb(false));});
app.whenReady().then(async()=>{
  const descriptor=JSON.parse(fs.readFileSync(path.join(out,'descriptor.json')));
  const savedPath=path.join(out,'saved-progress.json');
  if(phase==='reopen'){
    const saved=JSON.parse(fs.readFileSync(savedPath));descriptor.snapshot=saved.snapshot;descriptor.revision=saved.receipt.revision;
  }
  let inputEvents=0;
  app.on('web-contents-created',(_e,contents)=>{contents.on('before-input-event',()=>{inputEvents++;throw Error('INPUT_FORBIDDEN');});});
  owner=new BrowserWindow({show:false,focusable:false,width:1000,height:700,webPreferences:{offscreen:true,contextIsolation:true,nodeIntegration:false,sandbox:true}});
  await owner.loadFile(path.join(__dirname,'owner.html'));
  host=new GodotWorldViewHost({window:()=>owner,allowedRoots:()=>[descriptor.root],progress:async request=>{
    const receipt={format:'craftmine.godot-progress-receipt/1',worldId:request.worldId,buildId:request.buildId,revision:request.revision+1,
      contentHash:createHash('sha256').update(JSON.stringify(request.snapshot)).digest('hex'),persistedAt:Date.now()};
    fs.writeFileSync(savedPath,JSON.stringify({snapshot:request.snapshot,receipt}));return {receipt};
  }});
  host.setBounds({x:0,y:0,width:960,height:640});host.setVisible(true);await host.ensure(descriptor);
  await host.pause();report.observation=await host.request('observe-envelope',{});
  const sample=createCraftminePerformanceSampler(()=>host?.performanceProcess??null,()=>app.getAppMetrics());
  report.sample=await sample({worldId:descriptor.worldId,buildId:descriptor.buildId});
  for(const key of ['worldId','buildId','instanceId'])assert.equal(report.sample[key],report.observation[key]);
  assert.ok(report.sample.memoryWorkingSetMb>0);assert.equal(report.sample.measurementScope,'renderer-process');
  for(const key of ['frameTimeMs','physicsStepMs','objectCount'])assert.equal(report.sample[key],undefined);
  report.snapshot=(await host.snapshot()).state;
  if(phase==='first'){
    report.save=await host.save();assert.equal(report.save.status,'persisted');
    assert.deepEqual(report.save.snapshot,report.snapshot);
  }else{
    const previous=JSON.parse(fs.readFileSync(path.join(out,'first-report.json')));
    assert.notEqual(report.sample.instanceId,previous.sample.instanceId);
    assert.deepEqual(report.snapshot,JSON.parse(fs.readFileSync(savedPath)).snapshot);
    await assert.rejects(sample({instanceId:previous.sample.instanceId}),/MISMATCH/);report.staleInstanceRejected=true;
  }
  report.guards=[];
  for(const contents of webContents.getAllWebContents()){
    if(contents.isDestroyed()||!contents.getURL().startsWith('http'))continue;
    const guard=await contents.executeJavaScript('globalThis.__craftmineHeadless',false);
    assert.deepEqual(guard,{pointerLock:0,focus:0});assert.equal(contents.isOffscreen(),true);report.guards.push(guard);
  }
  assert.ok(report.guards.length>0);assert.equal(owner.isVisible(),false);assert.equal(owner.isFocusable(),false);assert.equal(inputEvents,0);
  report.inputEvents=inputEvents;report.ownerVisible=owner.isVisible();report.ownerFocusable=owner.isFocusable();
  await assert.rejects(createCraftminePerformanceSampler(()=>host?.performanceProcess??null,async()=>{
    const metrics=app.getAppMetrics();await host.dispose();host=null;return metrics;
  })(),/PERFORMANCE_INSTANCE_CHANGED/);report.disposalDuringSampleRejected=true;
  assert.equal(await sample(),null);report.passed=true;await finish();
}).catch(finish);
