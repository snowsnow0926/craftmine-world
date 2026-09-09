// Real Electron host + real Godot Web runtime: repeated candidate staging lifecycle.
// No Rust, no model, no page input, no window activation, no pointer lock.
import {app,BrowserWindow,ipcMain} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {GodotWorldViewHost} from '../../../../vendor/pi-desktop/apps/desktop/electron/main/godot-world-view-host';
const out=process.env.CRAFTMINE_RENDERER_OUT,exportRoot=process.env.CRAFTMINE_RENDERER_EXPORT;
const hash=b=>createHash('sha256').update(b).digest('hex');
let window,host,stageCount=0;
const guardCounts={'pointer-lock':0,'window-focus':0};
const diagnostics=[];
/** Electron 43 passes one event object; older builds pass (event,level,message,line,source). */
function consoleMessage(contents,args){
  const first=args[0];
  const message=typeof first?.message==='string'?first.message:typeof args[2]==='string'?args[2]:'';
  const level=typeof first?.level==='string'?first.level:typeof args[1]==='number'?String(args[1]):'unknown';
  const source=typeof first?.sourceId==='string'?first.sourceId:typeof args[4]==='string'?args[4]:'';
  const line=Number.isInteger(first?.lineNumber)?first.lineNumber:Number.isInteger(args[3])?args[3]:null;
  const record={kind:'renderer-console',webContents:contents.id,level,message:String(message).slice(0,2000),source,line};
  diagnostics.push(record);console.log(JSON.stringify(record));
}
app.on('web-contents-created',(_event,contents)=>{
  contents.on('console-message',(...args)=>consoleMessage(contents,args));
  contents.on('did-fail-load',(_event,code,description,url,isMainFrame)=>console.log(JSON.stringify({kind:'load-failed',webContents:contents.id,code,description,url,isMainFrame})));
  contents.on('render-process-gone',(_event,details)=>console.log(JSON.stringify({kind:'renderer-gone',webContents:contents.id,details})));
  contents.on('did-finish-load',()=>console.log(JSON.stringify({kind:'finished-load',webContents:contents.id,url:contents.getURL()})));
  contents.on('destroyed',()=>console.log(JSON.stringify({kind:'renderer-destroyed',webContents:contents.id})));
});
app.disableHardwareAcceleration();app.commandLine.appendSwitch('enable-unsafe-swiftshader');app.commandLine.appendSwitch('use-angle','swiftshader');
app.on('session-created',ses=>{ses.registerPreloadScript({type:'frame',filePath:path.join(__dirname,'pointer-guard.cjs')});ses.setPermissionRequestHandler((_a,_b,cb)=>cb(false));ses.setPermissionCheckHandler(()=>false);});
ipcMain.on('pi-desktop/godot-world/guard',(_e,kind)=>{if(kind in guardCounts)guardCounts[kind]++;});
const files=root=>fs.readdirSync(root,{recursive:true}).filter(p=>fs.lstatSync(path.join(root,p)).isFile()).map(p=>{const b=fs.readFileSync(path.join(root,p));return {path:p.replaceAll('\\','/'),bytes:b.length,sha256:hash(b)};});
const artifacts=files(exportRoot);
async function start(){
  window=new BrowserWindow({show:false,focusable:false,width:1280,height:860,webPreferences:{offscreen:true,contextIsolation:true,nodeIntegration:false,sandbox:true}});
  await window.loadFile(path.join(__dirname,'panel.html'));
  host=new GodotWorldViewHost({window:()=>window,allowedRoots:()=>[exportRoot]});
  // Harness seam: keep the created views so bounds and a real renderer crash
  // can be observed without adding any production API.
  const create=host.createView.bind(host);
  host.createView=runtime=>{const view=create(runtime);created.push(view);return view;};
}
const created=[];
let pendingStage=null,crashBaseViews=0;
const waitUntil=async predicate=>{for(let i=0;i<600;i++){if(predicate())return true;await new Promise(resolve=>setTimeout(resolve,10));}return false;};
const methods={
  async open(){await host.ensure({worldId:'alpha',buildId:'formal-build',root:exportRoot,artifacts,entry:'index.html',revision:0,snapshot:null,timeoutMs:90000});host.setBounds({x:0,y:0,width:1200,height:800});host.setVisible(true);return {instance:host.instance,state:host.state,views:created.length};},
  async stage(){const buildId='candidate-'+(++stageCount);const started=Date.now();const state=await host.stageCandidate({worldId:'alpha',buildId,root:exportRoot,artifacts,entry:'index.html',revision:0,snapshot:null,timeoutMs:45000});return {buildId,elapsedMs:Date.now()-started,state,instance:host.candidateInstance,formal:host.instance};},
  async stageBegin(){const buildId='candidate-'+(++stageCount);crashBaseViews=created.length;pendingStage=host.stageCandidate({worldId:'alpha',buildId,root:exportRoot,artifacts,entry:'index.html',revision:0,snapshot:null,timeoutMs:45000}).then(state=>({ok:true,state})).catch(error=>({ok:false,error:String(error?.message??error)}));return {buildId,views:created.length};},
  async stageCrash(){const createdNew=await waitUntil(()=>created.length>crashBaseViews);if(!createdNew)return {crashed:false,views:created.length};await new Promise(resolve=>setTimeout(resolve,300));const starting=!host.candidateInstance;created[created.length-1].webContents.forcefullyCrashRenderer();return {crashed:true,starting,views:created.length};},
  async stageSettle(){const result=await pendingStage;pendingStage=null;return result;},
  async discard(){await host.discardCandidate();return {instance:host.instance,candidate:host.candidateInstance};},
  async identities(){return {formal:host.instance,candidate:host.candidateInstance,state:host.state};},
  async bounds(){return {children:window.contentView.children.length,views:created.map(view=>({attached:window.contentView.children.includes(view),bounds:view.getBounds()}))};},
  async surface(value){host.setSurfaceVisible(value);return {children:window.contentView.children.length,attached:created.filter(view=>window.contentView.children.includes(view)).length};},
  async diagnostics(){return {diagnostics,guardCounts,children:window.contentView.children.length,host:host.diagnostics('formal'),candidate:host.diagnostics('candidate')};},
  async close(){await host.close();host.dispose();app.exit(0);}
};
process.on('message',async m=>{if(m?.kind!=='native')return;try{if(!Object.hasOwn(methods,m.method))throw Error('unknown method');const result=await methods[m.method](m.payload);process.send?.({kind:'native',id:m.id,result});}catch(error){process.send?.({kind:'native',id:m.id,error:String(error.stack||error)});}});
app.whenReady().then(start).then(()=>process.send?.({kind:'ready'})).catch(error=>{process.send?.({kind:'fatal',error:String(error.stack||error)});app.exit(1);});
