// Authored managed-base + real Electron host + real Rust; no page input or model execution.
import {app,BrowserWindow,ipcMain} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CoreClient} from '../../../../plugins/craftmine-world/core-client.cjs';
import {GodotWorldViewHost} from '../../../../vendor/pi-desktop/apps/desktop/electron/main/godot-world-view-host';
import {createGodotRuntimeAdapter} from '../../../../vendor/pi-desktop/apps/desktop/electron/main/godot-runtime-adapter';
import {createGodotCandidateCoordinator} from '../../../../vendor/pi-desktop/apps/desktop/electron/main/godot-candidate-coordinator';
const out=process.env.CRAFTMINE_NATIVE_OUT,exportRoot=process.env.CRAFTMINE_NATIVE_EXPORT;
const hash=b=>createHash('sha256').update(b).digest('hex');
let window,host,adapter,core,coordinator,candidateId,selected='alpha',failSave=false,commitLost=false,commitCalls=0;
const guardCounts={'pointer-lock':0,'window-focus':0};
/** Electron 43 passes one event object; older builds pass (event,level,message,line,source). */
function consoleRecord(contents,args){
 const first=args[0];
 const message=typeof first?.message==='string'?first.message:typeof args[2]==='string'?args[2]:'';
 const level=typeof first?.level==='string'?first.level:typeof args[1]==='number'?String(args[1]):'unknown';
 const line=Number.isInteger(first?.lineNumber)?first.lineNumber:Number.isInteger(args[3])?args[3]:null;
 return {kind:'renderer-console',webContents:contents.id,level,message:String(message).slice(0,2000),line};
}
app.on('web-contents-created',(_event,contents)=>{
 contents.on('console-message',(...args)=>console.log(JSON.stringify(consoleRecord(contents,args))));
 contents.on('did-fail-load',(_event,code,description,url,isMainFrame)=>console.log(JSON.stringify({kind:'load-failed',webContents:contents.id,code,description,url,isMainFrame})));
 contents.on('render-process-gone',(_event,details)=>console.log(JSON.stringify({kind:'renderer-gone',webContents:contents.id,details})));
 contents.on('destroyed',()=>console.log(JSON.stringify({kind:'renderer-destroyed',webContents:contents.id})));
});
app.disableHardwareAcceleration();app.commandLine.appendSwitch('enable-unsafe-swiftshader');app.commandLine.appendSwitch('use-angle','swiftshader');
app.on('session-created',ses=>{ses.registerPreloadScript({type:'frame',filePath:path.join(__dirname,'pointer-guard.cjs')});ses.setPermissionRequestHandler((_a,_b,cb)=>cb(false));ses.setPermissionCheckHandler(()=>false);});
ipcMain.on('pi-desktop/godot-world/guard',(_e,kind)=>{if(kind in guardCounts)guardCounts[kind]++;});
const call=(method,args)=>core.call(method,args);
const files=root=>fs.readdirSync(root,{recursive:true}).filter(p=>fs.lstatSync(path.join(root,p)).isFile()).map(p=>{const b=fs.readFileSync(path.join(root,p));return {path:p.replaceAll('\\','/'),bytes:b.length,sha256:hash(b)};});
async function seed(snapshot){
 await call('world.create',{id:'alpha',title:'Authored native acceptance',world:{build:{id:'base-a',scene:{format:'craftmine.godot-scene/1',baseId:'first-person'},godot:{}},snapshot,extensions:[]}});
 const context={projectId:'native-fixture',sessionId:'native-fixture',turnId:'one'};await call('workspace.open',{context,selectedWorld:'alpha'});
 const project=await call('godotProject.create',{context,worldId:'alpha',toolCallId:'source',baseBuild:'base-a',baseId:'first-person',files:[{path:'project.godot',text:'config_version=5\n'}]});
 await call('godotExecutor.register',{executorId:'authored-fixture',attestation:{format:'craftmine.godot-executor/1',isolation:'authored-test-fixture',evidenceHash:hash('fixed-repository-base'),engineVersion:'4.7.2-stable',capabilities:{import:true,build:true,check:true}}});
 const job=await call('godotBuild.start',{context,worldId:'alpha',toolCallId:'check',revision:project.revision,manifestHash:project.manifestHash,mode:'check'});
 const claim=await call('godotJob.claim',{jobId:job.jobId,token:'native-fixture',executorId:'authored-fixture'});
 fs.cpSync(exportRoot,path.join(claim.artifactsRoot,'web'),{recursive:true});
 const finished=await call('godotJob.finish',{jobId:job.jobId,token:'native-fixture',output:{format:'craftmine.godot-job-result/1',inputHash:claim.inputHash,passed:true,import:{passed:true,log:'fixed base real import/export log in acceptance directory'},compile:{passed:true,errors:[],warnings:[]},check:{passed:true,assertions:[{id:'fixed-native-bootstrap',passed:true}]},artifacts:files(claim.artifactsRoot),engine:{version:'4.7.2-stable',isolation:'authored-test-fixture',evidenceHash:claim.evidenceHash}}});
 const prepared=await call('godotApplication.prepare',{id:'native-apply',token:'native-apply-token',worldId:'alpha',candidateId:finished.candidateId,revision:0,snapshot});
 await call('godotApplication.commit',{id:'native-apply',token:'native-apply-token',evidence:{format:'craftmine.godot-application/2',inputHash:prepared.inputHash,launch:{passed:true,buildId:prepared.buildId,instanceId:'authored-bootstrap',stateHash:hash(JSON.stringify(snapshot))},player:null,snapshot}});
}
async function makeCandidate(){
 const context={projectId:'native-fixture',sessionId:'native-fixture',turnId:'two'};
 await call('workspace.open',{context,selectedWorld:'alpha'});
 const index=await call('godotProject.index',{context,worldId:'alpha'});
 const project=await call('godotProject.patch',{context,worldId:'alpha',toolCallId:'candidate-source',revision:index.revision,manifestHash:index.manifestHash,operations:[{op:'put',path:'candidate.gd',text:'extends Node3D\n# Explicit fixed-export coordination fixture.\n',expectedHash:null}]});
 const job=await call('godotBuild.start',{context,worldId:'alpha',toolCallId:'candidate-check',revision:project.revision,manifestHash:project.manifestHash,mode:'check'});
 const claim=await call('godotJob.claim',{jobId:job.jobId,token:'candidate-fixture',executorId:'authored-fixture'});
 fs.cpSync(exportRoot,path.join(claim.artifactsRoot,'web'),{recursive:true});
 const finished=await call('godotJob.finish',{jobId:job.jobId,token:'candidate-fixture',output:{format:'craftmine.godot-job-result/1',inputHash:claim.inputHash,passed:true,import:{passed:true,log:'fixed export copied for coordinator test; not production builder attestation'},compile:{passed:true,errors:[],warnings:[]},check:{passed:true,assertions:[{id:'authored-coordination-fixture',passed:true}]},artifacts:files(claim.artifactsRoot),engine:{version:'4.7.2-stable',isolation:'authored-test-fixture',evidenceHash:claim.evidenceHash}}});
 candidateId=finished.candidateId;return candidateId;
}
async function start(){
 window=new BrowserWindow({show:false,focusable:false,width:1280,height:860,webPreferences:{offscreen:true,contextIsolation:true,nodeIntegration:false,sandbox:true}});await window.loadFile(path.join(__dirname,'panel.html'));
 core=new CoreClient(process.env.CRAFTMINE_CORE_BIN,path.join(out,'data'));await core.start();
 adapter=createGodotRuntimeAdapter({domain:async(m,p)=>{if(failSave&&m==='godotRuntime.saveProgress')throw Object.assign(Error('injected durable storage failure'),{errorCode:'TEST_STORAGE_FAILURE'});return call(m,p);},selection:async()=>selected,instance:()=>host?.instance??null});
 host=new GodotWorldViewHost({window:()=>window,allowedRoots:adapter.allowedRoots,descriptor:adapter.descriptor,progress:adapter.progress});
 coordinator=createGodotCandidateCoordinator({host,adapter,selection:async()=>selected,domain:async(method,args)=>{const result=await call(method,args);if(method==='godotApplication.commit'){commitCalls++;if(commitLost){commitLost=false;throw Error('injected lost committed reply');}}return result;}});
}
const methods={
 async preview(){return coordinator.invoke('godot.candidatePreview',{worldId:'alpha',candidateId});},
 async cancelPreview(){return coordinator.invoke('godot.candidateClose',{worldId:'alpha'});},
 async apply(){return coordinator.invoke('godot.candidateApply',{worldId:'alpha',candidateId});},
 async candidateEquip(){return host.candidateRequest('equip',{value:'practice_sword'});},
 async candidateSnapshot(){return host.candidateRequest('snapshot');},
 async identities(){return {formal:host.instance,candidate:host.candidateInstance,commitCalls};},
 async loseCommit(){commitLost=true;return true;},
 async formal(){return call('world.read',{id:'alpha'});},
 async bootstrap(){
  const probe=new GodotWorldViewHost({window:()=>window,allowedRoots:()=>[exportRoot]});
  try{await probe.ensure({worldId:'alpha',buildId:'authored-bootstrap',root:exportRoot,artifacts:files(exportRoot),entry:'index.html',revision:0,snapshot:null,timeoutMs:90000});const result=await probe.snapshot();await seed(result.state);await makeCandidate();return {baseId:result.state.baseId,format:result.state.format};}finally{await probe.close();}
 },
 async open(){const descriptor=await adapter.describe('alpha');await host.ensure({...descriptor,timeoutMs:90000});host.setBounds({x:0,y:0,width:1200,height:800});host.setVisible(true);return {instance:host.instance,state:host.state};},
 async snapshot(){return host.snapshot();},
 async equip(){return host.request('equip',{value:'practice_sword'});},
 async save(){return host.save();},
 async failSave(value){failSave=value;return true;},
 async depart(){return host.switchWorld(null);},
 async quitCheck(){return host.prepareForQuit();},
 async inspect(){const child=window.contentView.children.find(v=>v.webContents?.getURL().startsWith('http://127.0.0.1:'));const isolation=await child.webContents.executeJavaScript('({isolated:crossOriginIsolated,node:typeof require,origin:location.origin})',false);const image=await child.webContents.capturePage();fs.writeFileSync(path.join(out,'native-world.png'),image.toPNG());return {isolation,guardCounts,attached:window.contentView.children.length,width:image.getSize().width};},
 async surface(value){host.setSurfaceVisible(value);return window.contentView.children.length;},
 async close(){await coordinator.closeForDeparture();await host.close();await core.stop();host.dispose();app.exit(0);}
};
process.on('message',async m=>{if(m?.kind!=='native')return;try{if(!Object.hasOwn(methods,m.method))throw Error('unknown method');const result=await methods[m.method](m.payload);process.send?.({kind:'native',id:m.id,result});}catch(error){process.send?.({kind:'native',id:m.id,error:String(error.stack||error)});}});
app.whenReady().then(start).then(()=>process.send?.({kind:'ready'})).catch(error=>{process.send?.({kind:'fatal',error:String(error.stack||error)});app.exit(1);});
