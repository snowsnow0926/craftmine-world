import {app,BrowserWindow,webContents} from 'electron';import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {GodotWorldViewHost} from '../../../vendor/pi-desktop/apps/desktop/electron/main/godot-world-view-host';
import {createCraftmineEnginePerformanceSampler} from '../../../vendor/pi-desktop/apps/desktop/electron/main/craftmine-engine-performance-sample';
import {createHash} from 'node:crypto';
const out=process.env.CRAFTMINE_ENGINE_WEB_OUT;let host,owner;
const report={passed:false,scope:'Actual opt-in Godot Web export and production host/transport; authored descriptor, not Core-issued authority or model benchmark'};
const finish=async error=>{if(error)report.error=String(error.stack||error);fs.writeFileSync(path.join(out,'web-report.json'),JSON.stringify(report,null,2));try{await host?.dispose();owner?.destroy();}finally{app.exit(error?1:0);}};
process.on('uncaughtException',finish);process.on('unhandledRejection',finish);app.on('window-all-closed',()=>{});
app.commandLine.appendSwitch('enable-unsafe-swiftshader');app.commandLine.appendSwitch('use-angle','swiftshader');
app.on('session-created',s=>{s.registerPreloadScript({type:'frame',filePath:path.join(__dirname,'../preload/craftmine-headless.cjs')});s.setPermissionRequestHandler((_w,_p,cb)=>cb(false));});
app.whenReady().then(async()=>{
 const descriptor=JSON.parse(fs.readFileSync(path.join(out,'descriptor.json')));
 owner=new BrowserWindow({show:false,focusable:false,width:900,height:650,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false}});await owner.loadFile(path.join(__dirname,'owner.html'));
 host=new GodotWorldViewHost({window:()=>owner,allowedRoots:()=>[descriptor.root],progress:async()=>{throw Error('FIXTURE_PROGRESS_WRITE_FORBIDDEN');}});host.setBounds({x:0,y:0,width:860,height:600});host.setVisible(true);
 await host.ensure(descriptor);await host.pause();report.capabilities=await host.request('capabilities',{});
 assert.equal(report.capabilities.enginePerformanceProfile,'engine-monitor/1');assert.ok(report.capabilities.ops.includes('engine-performance'));
 const before=await host.snapshot(),identity=Object.fromEntries(['worldId','buildId','instanceId'].map(key=>[key,host.instance[key]]));
 await assert.rejects(host.request('engine-performance',{nonce:'a'.repeat(64)}),/PRIVATE_ROUTE/);
 report.paused=await host.enginePerformance(identity,'a'.repeat(64));
 for(const key of ['worldId','buildId','instanceId'])assert.equal(report.paused[key],host.instance[key]);
 assert.equal(report.paused.nonce,'a'.repeat(64));assert.equal(report.paused.sample.paused,true);assert.equal(report.paused.sample.metrics.processTime.status,'unknown');
 for(const nonce of ['', 'short', 'A'.repeat(64)])await assert.rejects(host.enginePerformance(identity,nonce),/ENGINE_PERFORMANCE_REQUEST_INVALID/);
 assert.deepEqual(await host.snapshot(),before);report.snapshotUnchanged=true;
 const source=JSON.parse(fs.readFileSync(path.join(out,'source-manifest.json')));
 const digest=value=>createHash('sha256').update(value).digest('hex');
 const formal={...descriptor,format:'craftmine.godot-runtime-descriptor/1',phase:'formal',sourceRevision:1,
   manifestHash:digest(JSON.stringify(source)),artifactManifestHash:digest(JSON.stringify(descriptor.artifacts))};
 const exported={format:'craftmine.godot-export-source/1',worldId:descriptor.worldId,buildId:descriptor.buildId,
   sourceWorldId:descriptor.worldId,sourceRevision:1,repoId:'fixture-repo',contentOid:'a'.repeat(40),files:source.files};
 const service=createCraftmineEnginePerformanceSampler({host:()=>host,resourcesRoot:process.env.CRAFTMINE_ENGINE_RESOURCE_ROOT,
   actualVersion:'4.7.2.stable.official.ed1daf0bf',describe:async()=>formal,exportSource:async()=>exported,
   readPack:async(desc,artifact)=>fs.readFileSync(path.join(desc.root,artifact.path))});
 report.servicePaused=await service(identity);
 assert.equal(report.servicePaused.available,true);assert.equal(report.servicePaused.observation.metrics.processTime.status,'unknown');
 assert.deepEqual(await host.snapshot(),before);
 await host.resume();await new Promise(r=>setTimeout(r,1600));report.active=await host.enginePerformance(identity,'b'.repeat(64));
 assert.equal(report.active.nonce,'b'.repeat(64));assert.equal(report.active.sample.paused,false);assert.equal(report.active.sample.debugBuild,false);
 assert.equal(report.active.sample.metrics.objectCount.status,'measured');assert.equal(report.active.sample.metrics.nodeCount.status,'measured');assert.equal(report.active.sample.metrics.gpuTime.status,'unknown');
 assert.ok(report.active.sample.sequence>report.paused.sample.sequence);
 report.serviceActive=await service(identity);
 assert.equal(report.serviceActive.available,true);assert.equal(report.serviceActive.observation.metrics.nodeCount.status,'measured');
 assert.equal(report.serviceActive.observation.metrics.gpuTime.status,'unknown');
 assert.equal(report.serviceActive.packSha256,descriptor.artifacts.find(file=>file.path.endsWith('.pck')).sha256);
 report.serviceScope='Real production service, app source pins and exported PCK; Core descriptor/source responses are fixtures, no model or product IPC.';
 report.guards=[];for(const contents of webContents.getAllWebContents()){if(contents.isDestroyed()||!contents.getURL().startsWith('http'))continue;const guard=await contents.executeJavaScript('globalThis.__craftmineHeadless',false);assert.deepEqual(guard,{pointerLock:0,focus:0});assert.equal(contents.isOffscreen(),true);report.guards.push(guard);}
 assert.ok(report.guards.length);assert.equal(owner.isVisible(),false);assert.equal(owner.isFocusable(),false);report.passed=true;await finish();
}).catch(finish);
