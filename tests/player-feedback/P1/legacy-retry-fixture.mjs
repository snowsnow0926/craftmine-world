// Actual broker/Core/check/coordinator fixture. Never called inside the product.
import {app,BrowserWindow,ipcMain} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createGodotWorldFactory} from '../../../vendor/pi-desktop/apps/desktop/electron/main/godot-world-creation';
import {GodotBuildVerifier} from '../../../vendor/pi-desktop/apps/desktop/electron/main/godot-build-verifier';
import {GodotWorldViewHost} from '../../../vendor/pi-desktop/apps/desktop/electron/main/godot-world-view-host';
import {createGodotRuntimeAdapter} from '../../../vendor/pi-desktop/apps/desktop/electron/main/godot-runtime-adapter';
import {createGodotCandidateCoordinator} from '../../../vendor/pi-desktop/apps/desktop/electron/main/godot-candidate-coordinator';
import {BRIDGE,OLD_BRIDGE,sha,inventory,assertNativeFailure} from './legacy-retry-contract.mjs';
const config=JSON.parse(fs.readFileSync(process.env.CRAFTMINE_LEGACY_FIXTURE,'utf8'));
const {out,root,profile,worldId}=config;
const require=createRequire(path.join(root,'package.json'));
const {CoreClient}=require(path.join(config.plugin,'core-client.cjs'));
const {createGodotExecutor}=require(path.join(config.plugin,'godot-executor.cjs'));
const dataPath=path.join(profile,'plugins/data/craftmine.world');
const core=new CoreClient(config.core,dataPath);
const report={format:'craftmine.legacy-native-failure/1',worldId,startedAt:new Date().toISOString(),guards:[],events:[],passed:false};
const save=()=>fs.writeFileSync(path.join(out,'native-failure.json'),JSON.stringify(report,null,2));
const event=(kind,data={})=>{report.events.push({kind,...data,at:new Date().toISOString()});save();};
let host,executor,window,coreClosed;
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('use-angle','swiftshader');
app.on('window-all-closed',()=>{});
app.on('session-created',s=>{s.registerPreloadScript({type:'frame',filePath:path.join(__dirname,'pointer-guard.cjs')});s.setPermissionRequestHandler((_a,_b,cb)=>cb(false));s.setPermissionCheckHandler(()=>false);});
ipcMain.on('pi-desktop/godot-world/guard',(_event,kind)=>report.guards.push(kind));
const call=(m,p)=>core.call(m,p,120000);
async function index(context, binding={}) {
  let result,offset=0;const files=[];
  do {result=await call('godotProject.index',{context,worldId,...binding,offset,limit:32});files.push(...result.files);offset=result.nextOffset??0;}while(offset);
  return {revision:result.revision,manifestHash:result.manifestHash,files};
}
app.whenReady().then(async()=>{
  try {
    await core.start();coreClosed=new Promise(resolve=>core.child.once('close',(code,signal)=>resolve({code,signal})));
    const materialize=(await import(config.materializerUrl)).materializeBase;
    const factory=createGodotWorldFactory({worldsRoot:path.join(profile,'godot-worlds'),catalogFile:path.join(config.bases,'bases/base-catalog.json'),basesRoot:path.join(config.bases,'bases'),domain:call,makeWorldId:()=>worldId,
      materialize:input=>{
        const result=materialize(input),bytes=fs.readFileSync(config.oldBridge);assert.equal(sha(bytes),OLD_BRIDGE);
        const target=path.join(input.out,BRIDGE),metadataFile=path.join(input.out,'managed-base.json');
        fs.writeFileSync(target,bytes);
        const metadata=JSON.parse(fs.readFileSync(metadataFile));const item=metadata.files.find(f=>f.path===BRIDGE);assert.ok(item);
        item.sha256=sha(bytes);item.bytes=bytes.length;fs.writeFileSync(metadataFile,JSON.stringify(metadata,null,2));
        return result;
      }});
    const created=await factory.create({operationId:config.operationId,baseId:'first-person',starterId:'training-range',title:'Owned legacy first-load recovery'});
    assert.equal(created.id,worldId);
    const source=path.join(profile,'godot-worlds',worldId),metadata=JSON.parse(fs.readFileSync(path.join(source,'managed-base.json')));
    report.managedFiles=inventory(source);
    const context={projectId:'legacy-fixture',sessionId:worldId,turnId:worldId};report.context=context;
    const workspace=await call('workspace.open',{context,selectedWorld:worldId});
    const accepted=new Set(['.godot','.gd','.tscn','.tres','.gdshader','.gdshaderinc','.json','.cfg','.txt','.md','.csv','.svg','.obj','.mtl','.uid','.png','.jpg','.jpeg','.webp','.glb','.ogg','.wav']);
    const files=metadata.files.filter(f=>accepted.has(path.extname(f.path))&&!['export_presets.cfg','shell.txt','bridge.js'].includes(f.path)).map(f=>({path:f.path,bytesBase64:fs.readFileSync(path.join(source,f.path)).toString('base64')}));
    let project=await call('godotProject.create',{context,worldId,toolCallId:'legacy-create',baseBuild:workspace.task.binding.baseBuild,baseId:'first-person',files:[{path:'project.godot',text:Buffer.from(files.find(f=>f.path==='project.godot').bytesBase64,'base64').toString()}]});
    project=await call('godotProject.applyFiles',{context,worldId,toolCallId:'legacy-files',revision:project.revision,manifestHash:project.manifestHash,files:files.filter(f=>f.path!=='project.godot').map(f=>({...f,expectedHash:null}))});
    await call('content.migrate.apply',{worldId});project=await index(context);report.project=project;
    const verifier=new GodotBuildVerifier({deadlineMs:120000});
    executor=createGodotExecutor(core,{dataPath,toolchain:config.toolchain,verifier:{godotCheck:descriptor=>verifier.check(descriptor)},logger:{log:(...args)=>event('executor',{args}),warn:(...args)=>event('executor-warning',{args})}});
    assert.equal((await executor.start()).available,true);
    const job=await call('godotBuild.start',{context,worldId,toolCallId:'legacy-check',revision:project.revision,manifestHash:project.manifestHash,mode:'check'});
    assert.equal(executor.enqueue(job).enqueued,true);
    const deadline=Date.now()+600000;
    while(executor.status().jobs.length){assert.ok(Date.now()<deadline,'Check completion deadline');await new Promise(r=>setTimeout(r,100));}
    report.job=await call('godotBuild.read',{worldId,jobId:job.jobId});assert.equal(report.job.status,'passed',JSON.stringify(report.job));report.candidateId=report.job.candidateId;
    await call('workspace.endTurn',{sessionId:context.sessionId,turnId:context.turnId,status:'completed'});
    window=new BrowserWindow({show:false,focusable:false,width:1280,height:800,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false}});
    const selection=async()=>worldId;
    const adapter=createGodotRuntimeAdapter({domain:call,selection,instance:()=>host.instance});
    host=new GodotWorldViewHost({window:()=>window,allowedRoots:adapter.allowedRoots,progress:adapter.progress});
    const original=host.createView.bind(host);
    host.createView=runtime=>{const view=original(runtime);event('native-child',{offscreen:view.webContents.isOffscreen(),bounds:view.getBounds()});assert.equal(view.webContents.isOffscreen(),false);
      const receive=runtime.receive.bind(runtime);runtime.receive=message=>{event('runtime-receive',{type:message?.type,id:message?.id});return receive(message);};
      view.webContents.on('console-message',e=>event('console',{message:String(e.message).slice(0,800)}));return view;};
    const coordinator=createGodotCandidateCoordinator({host,adapter,domain:call,selection});
    try {await coordinator.firstLoad(worldId,report.candidateId);assert.fail('Legacy native load unexpectedly succeeded');}catch(error){report.loadError=String(error);}
    report.init=await call('godotWorld.initStatus',{worldId});
    assert.ok(report.init.launchFailure,JSON.stringify(report));
    report.application=await call('godotApplication.read',{id:report.init.launchFailure.applicationId});
    report.world=await call('world.read',{id:worldId});
    await host.dispose();host=null;window.destroy();window=null;await executor.stop();executor=null;
    await core.stop();report.coreClose=await coreClosed;report.passed=true;assertNativeFailure(report);
  }catch(error){report.passed=false;report.error=String(error.stack??error);}
  finally {
    try{await host?.dispose();window?.destroy();await executor?.stop();await core.stop();if(coreClosed)report.coreClose=await coreClosed;}catch(error){report.passed=false;report.cleanupError=String(error);}
    report.finishedAt=new Date().toISOString();save();app.exit(report.passed?0:1);
  }
});
