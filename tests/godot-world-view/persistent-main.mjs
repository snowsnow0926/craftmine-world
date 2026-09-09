// Authored managed-base + real Electron host + real Rust; no page input or model execution.
import {app,BrowserWindow,ipcMain} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CoreClient} from '../../plugins/craftmine-world/core-client.cjs';
import {GodotWorldViewHost} from '../../vendor/pi-desktop/apps/desktop/electron/main/godot-world-view-host';
import {createGodotRuntimeAdapter} from '../../vendor/pi-desktop/apps/desktop/electron/main/godot-runtime-adapter';
const out=process.env.CRAFTMINE_NATIVE_OUT,exportRoot=process.env.CRAFTMINE_NATIVE_EXPORT;
const baseId=process.env.CRAFTMINE_NATIVE_BASE_ID||'first-person';
if(!['first-person','top-down','side-view'].includes(baseId))throw Error('Unsupported authored base');
const hash=b=>createHash('sha256').update(b).digest('hex');
let window,host,adapter,core,selected='alpha',failSave=false;
const guardCounts={'pointer-lock':0,'window-focus':0};
const consoleMessages=[];
app.on('web-contents-created',(_event,contents)=>contents.on('console-message',(_event,details,...legacy)=>{const entry=typeof details==='object'?{level:details.level,message:details.message}:{level:details,message:legacy[0]};consoleMessages.push(entry);fs.appendFileSync(path.join(out,'renderer-console.jsonl'),JSON.stringify(entry)+'\n');}));
app.disableHardwareAcceleration();app.commandLine.appendSwitch('enable-unsafe-swiftshader');app.commandLine.appendSwitch('use-angle','swiftshader');
app.on('session-created',ses=>{ses.registerPreloadScript({type:'frame',filePath:path.join(__dirname,'pointer-guard.cjs')});ses.setPermissionRequestHandler((_a,_b,cb)=>cb(false));ses.setPermissionCheckHandler(()=>false);});
ipcMain.on('pi-desktop/godot-world/guard',(_e,kind)=>{if(kind in guardCounts)guardCounts[kind]++;});
const call=(method,args)=>core.call(method,args);
const files=root=>fs.readdirSync(root,{recursive:true}).filter(p=>fs.lstatSync(path.join(root,p)).isFile()).map(p=>{const b=fs.readFileSync(path.join(root,p));return {path:p.replaceAll('\\','/'),bytes:b.length,sha256:hash(b)};});
async function seed(snapshot){
 await call('world.create',{id:'alpha',title:'Authored native acceptance',world:{build:{id:'base-a',scene:{format:'craftmine.godot-scene/1',baseId},godot:{}},snapshot,extensions:[]}});
 const context={projectId:'native-fixture',sessionId:'native-fixture',turnId:'one'};await call('workspace.open',{context,selectedWorld:'alpha'});
 const project=await call('godotProject.create',{context,worldId:'alpha',toolCallId:'source',baseBuild:'base-a',baseId,files:[{path:'project.godot',text:'config_version=5\n'}]});
 await call('godotExecutor.register',{executorId:'authored-fixture',attestation:{format:'craftmine.godot-executor/1',isolation:'authored-test-fixture',evidenceHash:hash('fixed-repository-base'),engineVersion:'4.7.2-stable',capabilities:{import:true,build:true,check:true}}});
 const job=await call('godotBuild.start',{context,worldId:'alpha',toolCallId:'check',revision:project.revision,manifestHash:project.manifestHash,mode:'check'});
 const claim=await call('godotJob.claim',{jobId:job.jobId,token:'native-fixture',executorId:'authored-fixture'});
 fs.cpSync(exportRoot,path.join(claim.artifactsRoot,'web'),{recursive:true});
 const finished=await call('godotJob.finish',{jobId:job.jobId,token:'native-fixture',output:{format:'craftmine.godot-job-result/1',inputHash:claim.inputHash,passed:true,import:{passed:true,log:'fixed base real import/export log in acceptance directory'},compile:{passed:true,errors:[],warnings:[]},check:{passed:true,assertions:[{id:'fixed-native-bootstrap',passed:true}]},artifacts:files(claim.artifactsRoot),engine:{version:'4.7.2-stable',isolation:'authored-test-fixture',evidenceHash:claim.evidenceHash}}});
 const prepared=await call('godotApplication.prepare',{id:'native-apply',token:'native-apply-token',worldId:'alpha',candidateId:finished.candidateId,revision:0,snapshot});
 await call('godotApplication.commit',{id:'native-apply',token:'native-apply-token',evidence:{format:'craftmine.godot-application/2',inputHash:prepared.inputHash,launch:{passed:true,buildId:prepared.buildId,instanceId:'authored-bootstrap',stateHash:hash(JSON.stringify(snapshot))},player:null,snapshot}});
}
async function start(){
 window=new BrowserWindow({show:false,focusable:false,width:1280,height:860,webPreferences:{offscreen:true,contextIsolation:true,nodeIntegration:false,sandbox:true}});await window.loadFile(path.join(__dirname,'panel.html'));
 core=new CoreClient(process.env.CRAFTMINE_CORE_BIN,path.join(out,'data'));await core.start();
 adapter=createGodotRuntimeAdapter({domain:async(m,p)=>{if(failSave&&m==='godotRuntime.saveProgress')throw Object.assign(Error('injected durable storage failure'),{errorCode:'TEST_STORAGE_FAILURE'});return call(m,p);},selection:async()=>selected,instance:()=>host?.instance??null});
 host=new GodotWorldViewHost({window:()=>window,allowedRoots:adapter.allowedRoots,descriptor:adapter.descriptor,progress:adapter.progress});
}
const methods={
 async bootstrap(){
  const probe=new GodotWorldViewHost({window:()=>window,allowedRoots:()=>[exportRoot]});
  try{await probe.ensure({worldId:'alpha',buildId:'authored-bootstrap',root:exportRoot,artifacts:files(exportRoot),entry:'index.html',revision:0,snapshot:null,timeoutMs:90000});const result=await probe.snapshot();await seed(result.state);return {baseId:result.state.baseId,format:result.state.format,state:result.state};}finally{await probe.close();}
 },
 async open(){const descriptor=await adapter.describe('alpha');await host.ensure({...descriptor,timeoutMs:90000});host.setBounds({x:0,y:0,width:1200,height:800});host.setVisible(true);return {instance:host.instance,state:host.state};},
 async snapshot(){return host.snapshot();},
 async equip(){return host.request('equip',{value:'practice_sword'});},
 async request({op,args={}}){return host.request(op,args);},
 async pause(){await host.pause();return {state:host.state};},
 async resume(){await host.resume();return {state:host.state};},
 async save(){return host.save();},
 async failSave(value){failSave=value;return true;},
 async depart(){return host.switchWorld(null);},
 async quitCheck(){return host.prepareForQuit();},
 async inspect({sampleColors=[]}={}){const child=window.contentView.children.find(v=>v.webContents?.getURL().startsWith('http://127.0.0.1:'));const isolation=await child.webContents.executeJavaScript('({isolated:crossOriginIsolated,node:typeof require,origin:location.origin,statusHidden:document.getElementById("status")?.hidden,statusText:document.getElementById("status")?.textContent})',false);const image=await child.webContents.capturePage();fs.writeFileSync(path.join(out,'native-world.png'),image.toPNG());const bitmap=image.toBitmap(),histogram=new Map(),colorCounts=sampleColors.map(()=>0);for(let pixel=0;pixel<bitmap.length;pixel+=4)sampleColors.forEach((rgb,i)=>{if(Math.abs(bitmap[pixel+2]-rgb[0])<=4&&Math.abs(bitmap[pixel+1]-rgb[1])<=4&&Math.abs(bitmap[pixel]-rgb[2])<=4)colorCounts[i]++;});let sampled=0;for(let i=0;i<bitmap.length;i+=4*Math.max(1,Math.floor(bitmap.length/4/8192))){const key=[bitmap[i],bitmap[i+1],bitmap[i+2]].join(',');histogram.set(key,(histogram.get(key)||0)+1);sampled++;}return {isolation,guardCounts,consoleMessages,attached:window.contentView.children.length,...image.getSize(),pixels:{colorCounts,colors:histogram.size,sampled,nonDominant:sampled-Math.max(...histogram.values())}};},
 async surface(value){host.setSurfaceVisible(value);return window.contentView.children.length;},
 async close(){await host.close();await core.stop();host.dispose();app.exit(0);}
};
process.on('message',async m=>{if(m?.kind!=='native')return;try{if(!Object.hasOwn(methods,m.method))throw Error('unknown method');const result=await methods[m.method](m.payload);process.send?.({kind:'native',id:m.id,result});}catch(error){process.send?.({kind:'native',id:m.id,error:String(error.stack||error)});}});
app.whenReady().then(start).then(()=>process.send?.({kind:'ready'})).catch(error=>{process.send?.({kind:'fatal',error:String(error.stack||error)});app.exit(1);});
