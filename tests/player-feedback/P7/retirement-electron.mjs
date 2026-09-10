import {app} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {GodotBuildVerifier} from '../../../vendor/pi-desktop/apps/desktop/electron/main/godot-build-verifier';
const config=JSON.parse(fs.readFileSync(process.env.CRAFTMINE_P7_CONFIG,'utf8'));
const {out,root}=config,require=createRequire(path.join(root,'package.json'));
const {CoreClient}=require(path.join(root,'plugins/craftmine-world/core-client.cjs'));
const {createGodotExecutor}=require(path.join(root,'plugins/craftmine-world/godot-executor.cjs'));
const hash=x=>createHash('sha256').update(x).digest('hex');
const dataPath=path.join(out,'data'),tasksRoot=path.join(dataPath,'godot/tasks');fs.mkdirSync(dataPath);
const core=new CoreClient(config.core,path.join(out,'core'));
const report={format:'craftmine.p7-native-retirement/1',sourceCommit:config.sourceCommit,sourceFiles:config.sourceFiles,workingTree:config.workingTree,identities:config.identities,startedAt:new Date().toISOString(),events:[],runs:[],ackBoundaries:[],cases:[],restarts:[],passed:false};
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
const event=(kind,data={})=>{report.events.push({kind,...data,at:new Date().toISOString(),monotonicMs:performance.now()});save();};
const free=()=>{const s=fs.statfsSync('D:/');return s.bavail*s.bsize;};
function inventory(directory){
 const files=[],directories=[];
 function visit(dir,relative=''){for(const name of fs.readdirSync(dir).sort()){const file=path.join(dir,name),rel=relative?relative+'/'+name:name,stat=fs.lstatSync(file);assert.ok(!stat.isSymbolicLink(),'No link traversal');if(stat.isDirectory()){directories.push(rel);visit(file,rel);}else{assert.ok(stat.isFile());const bytes=fs.readFileSync(file);files.push({path:rel,bytes:bytes.length,sha256:hash(bytes)});}}}
 visit(directory);return {files,directories,logicalBytes:files.reduce((n,f)=>n+f.bytes,0)};
}
const taskIds=()=>fs.existsSync(tasksRoot)?fs.readdirSync(tasksRoot).filter(x=>/^(pf|im|ex)-[a-f0-9]{24}$/.test(x)):[];
let executor;const runs=new Map();
function spawnBroker(binary,args,settings){
 assert.equal(binary,config.broker);assert.deepEqual(args,['run']);assert.equal(settings.windowsHide,true);
 const child=spawn(binary,args,settings);let request,stdout='',stderr='';
 const write=child.stdin.write;child.stdin.write=function(frame,...rest){if(!request){request=JSON.parse(String(frame));const record={taskId:request.taskId,pid:child.pid,operation:request.operation,request,events:[]};report.runs.push(record);runs.set(request.taskId,record);event('broker-request',{taskId:request.taskId});}else event('broker-control',{taskId:request.taskId});return write.call(this,frame,...rest);};
 for(const name of ['stdout','stderr']){child[name].on('data',bytes=>{if(name==='stdout')stdout+=bytes;else stderr+=bytes;event('broker-'+name,{taskId:request?.taskId,bytes:bytes.length});});child[name].once('close',()=>event(name+'-close',{taskId:request?.taskId}));}
 child.once('exit',(code,signal)=>{const r=runs.get(request.taskId);r.exit={code,signal,monotonicMs:performance.now()};event('broker-exit',{taskId:request.taskId,code,signal});});
 child.once('close',(code,signal)=>{const r=runs.get(request.taskId);r.close={code,signal,monotonicMs:performance.now()};try{r.response=JSON.parse(stdout);}catch(error){r.parseError=String(error);}fs.writeFileSync(path.join(out,request.taskId+'.stdout.log'),stdout);fs.writeFileSync(path.join(out,request.taskId+'.stderr.log'),stderr);event('broker-close',{taskId:request.taskId,code,signal});});
 return child;
}
const observedCore={call:async(method,args,timeout)=>{
 let boundary;
 if(method==='godotExecutor.register'||method==='godotJob.finish'){
  const ids=method==='godotExecutor.register'?taskIds().filter(id=>id.startsWith('pf-')&&!fs.existsSync(path.join(tasksRoot,id,'bin-retirement-ack.json'))):(executor.ledger.jobs[args.jobId]?.attempts??[]).map(x=>x.requestId);
  boundary={method,jobId:args.jobId??null,beforeAt:performance.now(),tasks:ids.map(id=>({taskId:id,before:inventory(path.join(tasksRoot,id))}))};
  for(const task of boundary.tasks){assert.ok(task.before.files.some(f=>f.path==='bin/Godot_v4.7.2-stable_win64.exe'));assert.ok(!task.before.files.some(f=>f.path==='bin-retirement-ack.json'));assert.ok(runs.get(task.taskId)?.close,'Broker close must precede domain acknowledgment');}
  report.ackBoundaries.push(boundary);save();
 }
 const result=await core.call(method,args,timeout);
 if(boundary){boundary.replyAt=performance.now();boundary.reply=result;event('core-ack',{method,jobId:args.jobId??null});}
 return result;
}};
const verifier=new GodotBuildVerifier({deadlineMs:120000});
const make=()=>createGodotExecutor(observedCore,{dataPath,spawnBroker,verifier:{godotCheck:async descriptor=>{const result=await verifier.check(descriptor);report.cases.at(-1).runtime=result;save();return result;}},logger:{log:(...args)=>event('executor-log',{args}),warn:(...args)=>event('executor-warn',{args})},toolchain:{broker:config.broker,brokerIdentity:config.identity,engineRoot:config.engineRoot,toolchainLock:path.join(root,'desktop/godot/toolchain.lock.json'),bridgePath:path.join(root,'desktop/godot/web/bridge.js')}});
const wait=async predicate=>{const deadline=Date.now()+360000;while(!predicate()){assert.ok(Date.now()<deadline,'bounded job completion');await new Promise(r=>setTimeout(r,100));}};
function verifyBoundary(boundary,retired){
 for(const task of boundary.tasks){
  const after=inventory(path.join(tasksRoot,task.taskId));task.after=after;
  const allowed=new Set(['bin/Godot_v4.7.2-stable_win64.exe','bin/broker-preflight.exe']);
  assert.deepEqual(after.directories,task.before.directories);
  for(const file of task.before.files){const actual=after.files.find(f=>f.path===file.path);if(retired&&allowed.has(file.path))assert.equal(actual,undefined);else assert.deepEqual(actual,file);}
  const extras=after.files.filter(f=>!task.before.files.some(b=>b.path===f.path));
  assert.deepEqual(extras.map(f=>f.path).sort(),retired?['bin-retirement-ack.json','bin-retirement-result.json']:[]);
  if(retired){const ack=JSON.parse(fs.readFileSync(path.join(tasksRoot,task.taskId,'bin-retirement-ack.json'))),result=JSON.parse(fs.readFileSync(path.join(tasksRoot,task.taskId,'bin-retirement-result.json')));assert.equal(result.state,'retired');assert.equal(ack.brokerTransport.stdioClosed,true);assert.equal(ack.brokerReceipt.binRetirement.engineJobActiveProcesses,0);assert.equal(ack.brokerReceipt.binRetirement.nativeJobActiveProcesses,0);task.logicalRemoved=result.logicalBytes;}
 }
}
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 let coreClose;
 try{
  report.initialFreeBytes=free();await core.start();coreClose=new Promise(resolve=>core.child.once('close',(code,signal)=>resolve({code,signal})));
  for(const item of config.cases){
   const record={name:item.name,worldId:item.worldId,freeBefore:free()};report.cases.push(record);executor=make();
   record.discovery=await executor.start();assert.equal(record.discovery.available,true,JSON.stringify(record.discovery));
   verifyBoundary(report.ackBoundaries.at(-1),true);
   const context={projectId:'p7',sessionId:item.worldId,turnId:item.worldId};
   await core.call('godotWorld.initialize',{worldId:item.worldId,title:item.name,baseId:'first-person',baseBuild:'base-a',snapshot:item.snapshot});
   await core.call('workspace.open',{context,selectedWorld:item.worldId});
   const configFile=item.files.find(x=>x.path==='project.godot');
   let project=await core.call('godotProject.create',{context,worldId:item.worldId,toolCallId:'create',baseBuild:'base-a',baseId:'first-person',files:[{path:'project.godot',text:Buffer.from(configFile.bytesBase64,'base64').toString()}]});
   project=await core.call('godotProject.applyFiles',{context,worldId:item.worldId,toolCallId:'files',revision:project.revision,manifestHash:project.manifestHash,files:item.files.filter(x=>x.path!=='project.godot').map(({path,bytesBase64})=>({path,bytesBase64,expectedHash:null}))},30000);
   const before=await core.call('world.read',{id:item.worldId});
   const job=await core.call('godotBuild.start',{context,worldId:item.worldId,toolCallId:'check',revision:project.revision,manifestHash:project.manifestHash,mode:'check'});record.jobId=job.jobId;assert.equal(executor.enqueue(job).enqueued,true);
   await wait(()=>executor.status().jobs.length===0);
   record.job=await core.call('godotBuild.read',{worldId:item.worldId,jobId:job.jobId});record.ledger=executor.ledger.jobs[job.jobId];
   const success=item.name!=='syntax-failure';assert.equal(record.job.status,success?'passed':'failed',JSON.stringify(record.job));
   const boundary=report.ackBoundaries.find(b=>b.jobId===job.jobId);assert.ok(boundary);verifyBoundary(boundary,success);
   if(success){assert.equal(boundary.tasks.length,2);assert.equal(record.runtime.passed,true);assert.equal(record.ledger.binRetirements.length,2);}else{assert.equal(boundary.tasks.length,1);assert.ok(record.job.output.compile.errors.length>0);}
   assert.deepEqual(await core.call('world.read',{id:item.worldId}),before);
   await core.call('workspace.endTurn',{sessionId:context.sessionId,turnId:context.turnId,status:success?'completed':'error'});
   await executor.stop();record.freeAfter=free();save();
  }
  const retained=inventory(tasksRoot);executor=make();const status=await executor.start();assert.equal(status.available,true);
  const after=inventory(tasksRoot);for(const file of retained.files)assert.deepEqual(after.files.find(f=>f.path===file.path),file);
  report.restarts.push({oldFilesUnchanged:retained.files.length,oldLogicalBytes:retained.logicalBytes,status});verifyBoundary(report.ackBoundaries.at(-1),true);
  await executor.stop();await core.stop();report.coreClose=await coreClose;assert.equal(report.coreClose.code,0);report.finalFreeBytes=free();report.passed=true;
 }catch(error){report.error=String(error.stack??error);}
 finally{await executor?.stop().catch(error=>{report.shutdownError=String(error);report.passed=false;});await core.stop().catch(error=>{report.shutdownError=String(error);report.passed=false;});report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({out,passed:report.passed,error:report.error}));app.exit(report.passed?0:1);}
});
