// Private Electron process. All durable operations return to the parent's CoreClient.
import {app,BrowserWindow} from 'electron';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {configureHeadlessAcceptance} from '../../vendor/pi-desktop/apps/desktop/electron/main/craftmine-headless';
import {GodotWorldViewHost} from '../../vendor/pi-desktop/apps/desktop/electron/main/godot-world-view-host';
import {createGodotRuntimeAdapter} from '../../vendor/pi-desktop/apps/desktop/electron/main/godot-runtime-adapter';
import {createGodotCandidateCoordinator} from '../../vendor/pi-desktop/apps/desktop/electron/main/godot-candidate-coordinator';
import {GodotBuildVerifier} from '../../vendor/pi-desktop/apps/desktop/electron/main/godot-build-verifier';
import {createCraftmineLiveSampler} from '../../vendor/pi-desktop/apps/desktop/electron/main/craftmine-live-sample';
import {createCraftminePerformanceSampler} from '../../vendor/pi-desktop/apps/desktop/electron/main/craftmine-performance-sample';
import {createGameplayController,validateInputSegment} from './codex-gameplay-controller';

type Data=Record<string,any>;
const worldId=process.env.CRAFTMINE_CODEX_LIVE_WORLD;
if(!worldId||!process.send)throw Error('PRIVATE_LIVE_HOST_REQUIRED');
configureHeadlessAcceptance();
app.setPath('userData',process.env.CRAFTMINE_DATA_DIR!);
// Use the same graphics backend as the desktop. Offscreen controls window
// presentation; forcing SwiftShader can stall simultaneous retained/candidate
// city runtimes even when either immutable export passes an isolated check.
app.on('window-all-closed',()=>{});
const pending=new Map<string,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();
const domain=(method:string,params:Data):Promise<any>=>new Promise((resolve,reject)=>{
  const id=randomUUID();pending.set(id,{resolve,reject});process.send!({kind:'codex-live-domain',id,method,params});
});
let window:BrowserWindow,host:GodotWorldViewHost,adapter:ReturnType<typeof createGodotRuntimeAdapter>,candidates:ReturnType<typeof createGodotCandidateCoordinator>;
const verifier=new GodotBuildVerifier();
let closing=false,queue=Promise.resolve();
let opened=false;
const sample=createCraftmineLiveSampler(()=>host);
const performance=createCraftminePerformanceSampler(()=>host.performanceProcess,()=>app.getAppMetrics());
const consoleLines:Array<{contents:number;at:string;text:string}>=[];
app.on('web-contents-created',(_event,contents)=>contents.on('console-message',event=>{
  consoleLines.push({contents:contents.id,at:new Date().toISOString(),text:event.message.slice(0,2000)});
  if(consoleLines.length>200)consoleLines.shift();
}));
const gameplay=createGameplayController({instance:()=>host?.instance??null,
  dispatch:(identity,events)=>host.headlessGameInput(identity,events),wait:frames=>host.request('wait',{frames}),
  snapshot:()=>host.snapshot(),observe:()=>sample(),capture:identity=>capture(identity),
  diagnostics:()=>diagnostics(),hold:()=>host.holdSelectionSync()});
async function diagnostics(){
  const views=window.contentView.children.filter((view:any)=>view.webContents) as any[];
  const ids=new Set(views.map(view=>view.webContents.id));
  return {hidden:!window.isVisible(),focusable:window.isFocusable(),offscreen:window.webContents.isOffscreen(),
    graphics:{hardwareAcceleration:app.isHardwareAccelerationEnabled(),angle:app.commandLine.getSwitchValue('use-angle')||'platform-default',features:app.getGPUFeatureStatus()},
    console:consoleLines.filter(line=>ids.has(line.contents)),
    views:await Promise.all(views.map(async view=>({url:view.webContents.getURL(),runtime:await view.webContents.executeJavaScript('({guard:globalThis.__craftmineHeadless??null,node:typeof require,isolated:crossOriginIsolated})',false)})))};
}

async function open() {
  if(host.instance)return report();
  let descriptor;
  try{descriptor=await adapter.describe(worldId!);}catch(error){
    if((error as any).errorCode!=='GODOT_WORLD_NOT_INITIALIZED')throw error;
    return {status:'source-only',worldId,applied:false,reason:'GODOT_WORLD_NOT_INITIALIZED'};
  }
  if(!descriptor)throw Error('GODOT_FORMAL_WORLD_REQUIRED');
  const release=await host.holdSelectionSync();
  try{await host.ensure(descriptor);opened=true;host.setVisible(true);}
  finally{release();}
  return report();
}
async function report() {
  const initialization=await domain('godotWorld.initStatus',{worldId});
  return {format:'craftmine.codex-live-state/1',worldId,status:host.instance?'formal-running':initialization.playable?'closed':'source-only',
    instance:host.instance,candidate:host.candidateInstance,view:host.state,initialization,
    applied:initialization.playable===true,gameplayAssessment:'not-performed-by-live-host'};
}
async function capture(args:Data={}) {
  const candidate=args.candidateId!==undefined;
  const instance=candidate?host.candidateInstance:host.instance;
  if(!instance)throw Error('GODOT_VIEW_CAPTURE_UNAVAILABLE');
  if(args.worldId!==undefined&&args.worldId!==worldId)throw Error('LIVE_WORLD_MISMATCH');
  if(args.buildId!==undefined&&args.buildId!==instance.buildId)throw Error('LIVE_BUILD_MISMATCH');
  if(args.instanceId!==undefined&&args.instanceId!==instance.instanceId)throw Error('LIVE_INSTANCE_MISMATCH');
  return host.captureView({worldId:worldId!,buildId:instance.buildId,instanceId:instance.instanceId,
    ...(candidate?{candidateId:args.candidateId}:{})});
}
async function operate(method:string,args:Data):Promise<unknown> {
  if(closing)throw Error('LIVE_HOST_CLOSING');
  if(method==='open')return open();
  if(method==='openPaused') {
    // Use the existing covered-chat pause ownership before attachment so a
    // restored simulation cannot advance between open and a later pause RPC.
    await host.setImmersion({active:false,overlay:'closed',overlayBounds:null,covered:true});
    try {await open();await host.pause();}
    finally {await host.setImmersion({active:false,overlay:'closed',overlayBounds:null});}
    return report();
  }
  if(method==='status')return report();
  if(method==='observe')return sample(args);
  if(method==='performance')return performance(args);
  if(method==='capture')return capture(args);
  if(method==='snapshot')return host.snapshot();
  if(method==='save'){await gameplay.drain();return host.save();}
  if(method==='pause'){await gameplay.drain();await host.pause();return report();}
  if(method==='resume'){await host.resume();return report();}
  // Trusted component tests may exercise real physics through the existing
  // base command. This private host call is not an author tool or OS input.
  if(method==='walk')return host.request('walk',args);
  if(method==='look') {
    if(Object.keys(args).sort().join(',')!=='pitch,yaw'||!Number.isFinite(args.yaw)||!Number.isFinite(args.pitch)||Math.abs(args.yaw)>Math.PI||Math.abs(args.pitch)>89*Math.PI/180)throw Error('LIVE_LOOK_INVALID');
    return host.request('look',args);
  }
  if(method==='diagnostics')return diagnostics();
  if(method==='inputSegment')return gameplay.segment(args.identity,args.segment);
  if(method==='validateInputPlan'){if(!Array.isArray(args.segments)||!args.segments.length)throw Error('GAMEPLAY_PLAN_INVALID');for(const segment of args.segments)validateInputSegment(segment);return {valid:true};}
  if(method==='preview') {
    await open();
    return candidates.invoke('godot.candidatePreview',{worldId,candidateId:args.candidateId});
  }
  if(method==='previewClose')return candidates.invoke('godot.candidateClose',{worldId});
  if(method==='apply') {
    const initial=await domain('godotWorld.initStatus',{worldId});
    if(initial.playable===false){
      // The real product first-load path validates the checked candidate,
      // stages/restores it, obtains a runner receipt and commits via Core.
      const result=await candidates.firstLoad(worldId!,args.candidateId);
      opened=true;host.setVisible(true);return result;
    }
    await open();
    if(!host.candidateInstance)await candidates.invoke('godot.candidatePreview',{worldId,candidateId:args.candidateId});
    return candidates.invoke('godot.candidateApply',{worldId,candidateId:args.candidateId});
  }
  if(method==='retryFirstLoad') {
    const status=await domain('godotWorld.initStatus',{worldId});
    const failure=status.launchFailure;
    if(!failure||failure.candidateId!==args.candidateId)throw Error('GODOT_INITIAL_LOAD_RETRY_REQUIRED');
    return domain('godotWorld.initLaunchRetry',{worldId,initId:status.initId,candidateId:failure.candidateId,applicationId:failure.applicationId});
  }
  if(method==='close') {
    await gameplay.drain();
    await candidates.invoke('godot.candidateClose',{worldId});
    const saved=host.instance?await host.save():null;
    if(saved&&saved.status!=='persisted')throw Error(saved.error);
    await host.close();opened=false;return {status:'closed',worldId,saved};
  }
  if(method==='shutdown') {
    const result=await operate('close',{});closing=true;verifier.cancelAll();await host.dispose();window.destroy();
    return result;
  }
  throw Error('LIVE_OPERATION_NOT_ALLOWED');
}
process.on('message',(message:any)=>{
  if(message?.kind==='codex-live-domain-result') {
    const call=pending.get(message.id);if(!call)return;pending.delete(message.id);
    if(message.error)call.reject(Object.assign(Error(message.error.message),{errorCode:message.error.code}));else call.resolve(message.result);
    return;
  }
  if(message?.kind!=='codex-live-command')return;
  const reply=(data:Data)=>process.send?.({kind:'codex-live-result',id:message.id,...data});
  // Checks have their own isolated verifier window; they may run while the
  // already-applied formal instance remains available for author observations.
  if(message.method==='check') {
    void verifier.check(message.args.descriptor).then(result=>reply({result}),error=>reply({error:String(error.message)}));return;
  }
  if(message.method==='cancelCheck'){verifier.cancelAll();reply({result:{cancelled:true}});return;}
  if(message.method==='cancelFirstLoad'){
    void candidates.cancelFirstLoad(worldId!).then(result=>reply({result}),error=>reply({error:String(error.message)}));return;
  }
  if(message.method==='cancelInputs'){
    void gameplay.cancel(message.args.identity).then(result=>reply({result}),error=>reply({error:String(error.message)}));return;
  }
  if(message.method==='inputSegment'&&gameplay.busy){reply({error:'GAMEPLAY_BUSY'});return;}
  queue=queue.then(async()=>{
    try{const result=await operate(message.method,message.args??{});reply({result});if(message.method==='shutdown')app.quit();}
    catch(error){reply({error:error instanceof Error?error.message:'LIVE_OPERATION_FAILED'});}
  });
});
process.on('disconnect',()=>{
  closing=true;verifier.cancelAll();
  for(const call of pending.values())call.reject(Error('LIVE_PARENT_DISCONNECTED'));pending.clear();
  void gameplay.drain().catch(()=>{}).finally(()=>host?.dispose().finally(()=>app.exit(1)));
});
void app.whenReady().then(async()=>{
  window=new BrowserWindow({show:false,focusable:false,width:1280,height:860,webPreferences:{offscreen:true,contextIsolation:true,nodeIntegration:false,sandbox:true}});
  await window.loadFile(path.join(__dirname,'../surface.html'));
  adapter=createGodotRuntimeAdapter({domain,selection:async()=>worldId!,instance:()=>host?.instance??null});
  host=new GodotWorldViewHost({window:()=>window,allowedRoots:adapter.allowedRoots,descriptor:async()=>opened?adapter.describe(worldId!):null,progress:adapter.progress});
  host.setBounds({x:0,y:0,width:1280,height:860});
  candidates=createGodotCandidateCoordinator({host,adapter,domain,selection:async()=>worldId!});
  process.send?.({kind:'codex-live-ready'});
});
