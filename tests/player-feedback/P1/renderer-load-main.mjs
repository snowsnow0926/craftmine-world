// Fixed authored runtime probe. Hidden owner, no input/focus/Pointer Lock.
import {app,BrowserWindow,ipcMain} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {GodotWorldViewHost} from '../../../vendor/pi-desktop/apps/desktop/electron/main/godot-world-view-host';
const config=JSON.parse(fs.readFileSync(process.env.P1_CONFIG,'utf8'));
const events=[],guards=[],loads=[];
let host,window,view;
const record=(kind,detail={})=>events.push({at:Date.now(),kind,...detail});
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('use-angle','swiftshader');
app.on('session-created',ses=>{ses.registerPreloadScript({type:'frame',filePath:path.join(__dirname,'pointer-guard.cjs')});ses.setPermissionRequestHandler((_a,_b,cb)=>cb(false));ses.setPermissionCheckHandler(()=>false);});
ipcMain.on('pi-desktop/godot-world/guard',(_e,kind)=>guards.push(kind));
app.whenReady().then(async()=>{
 const result={baseId:config.baseId,mode:config.mode,events,guards,loads,passed:false};
 try{
  window=new BrowserWindow({show:false,focusable:false,width:1280,height:800,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false}});
  host=new GodotWorldViewHost({window:()=>window,allowedRoots:()=>[config.exportRoot]});
  const create=host.createView.bind(host);
  host.createView=runtime=>{
   view=create(runtime);
   if(config.mode.includes('unthrottled'))view.webContents.setBackgroundThrottling(false);
   if(config.mode.startsWith('attached'))window.contentView.addChildView(view,0);
   record('view-created',{bounds:view.getBounds(),throttling:view.webContents.getBackgroundThrottling()});
   const load=runtime.load.bind(runtime);
   runtime.load=async args=>{const response=await load(args);loads.push({instanceId:runtime.instanceId,response});return response;};
   const send=view.webContents.send.bind(view.webContents);
   view.webContents.send=(channel,message)=>{record('ipc-send',{type:message?.type,id:message?.id,op:message?.op});return send(channel,message);};
   const receive=runtime.receive.bind(runtime);
   runtime.receive=message=>{record('ipc-receive',{type:message?.type,id:message?.id,error:message?.error});return receive(message);};
   view.webContents.on('console-message',event=>record('console',{level:event.level,message:String(event.message).slice(0,800)}));
   view.webContents.on('render-process-gone',(_event,detail)=>record('renderer-gone',detail));
   view.webContents.on('destroyed',()=>record('destroyed'));
   return view;
  };
  record('ensure-start');
  const request={worldId:'alpha',buildId:'p1-'+config.baseId,root:config.exportRoot,artifacts:config.artifacts,entry:'index.html',revision:0,snapshot:config.snapshot,timeoutMs:15000};
  result.state=await host.ensure(request);
  result.snapshot=await host.request('snapshot');
  result.observation=await host.request('observe-envelope');
  record('load-confirmed');
  result.snapshotEqual=isDeepStrictEqual(loads[0]?.response?.result?.snapshot?.state,config.snapshot);
  result.initialRunningSnapshot=result.snapshot;
  await host.pause();result.snapshot=await host.request('snapshot');host.setSurfaceVisible(false);
  result.hiddenSnapshotEqual=isDeepStrictEqual((await host.request('snapshot'))?.state,result.snapshot.state);
  host.setBounds({x:0,y:0,width:1280,height:796});host.setVisible(true);host.setSurfaceVisible(true);
  if(config.mode==='offscreen'){
   const capture=await host.headlessCapture(1280,720);
   fs.writeFileSync(path.join(path.dirname(config.result),'world.png'),Buffer.from(capture.pngBase64,'base64'));
   const {pngBase64,...details}=capture;result.capture=details;
   result.capturePassed=capture.width===1280&&capture.height===720&&capture.pixelStats.sampledColors>4&&isDeepStrictEqual(capture.viewportObservation?.payload?.surfaceSize,[1280,720]);
  }
  await host.close();record('first-instance-closed');
  const reopened=await host.ensure({...request,snapshot:result.snapshot.state});
  result.reopenedSnapshotEqual=isDeepStrictEqual(loads.at(-1)?.response?.result?.snapshot?.state,result.snapshot.state);
  result.reopenedInstanceChanged=reopened.instanceId!==result.state.instanceId;
  result.passed=result.state.state==='ready'&&result.snapshotEqual&&result.hiddenSnapshotEqual&&result.reopenedSnapshotEqual&&result.reopenedInstanceChanged&&(config.mode!=='offscreen'||result.capturePassed)&&guards.length===0;
 }catch(error){result.error=String(error.stack||error);record('failure',{error:String(error.message||error)});}
 finally{
  try{await host?.dispose();record('host-disposed');}catch(error){result.cleanupError=String(error);result.passed=false;}
  window?.destroy();
  result.finishedAt=new Date().toISOString();fs.writeFileSync(config.result,JSON.stringify(result,null,2));
  app.exit(result.passed?0:1);
 }
}).catch(error=>{fs.writeFileSync(config.result,JSON.stringify({passed:false,error:String(error)}));app.exit(1);});
