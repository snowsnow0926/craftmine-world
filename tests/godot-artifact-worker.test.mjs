import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {EventEmitter} from 'node:events';
import {spawnSync} from 'node:child_process';
import {loadPackageAsar} from '../desktop/package-asar.mjs';
import {installedCreationElectron} from './helpers/creation-native-launch.mjs';
const root=path.resolve(import.meta.dirname,'..'),app=path.join(root,'vendor/pi-desktop/apps/desktop'),require=createRequire(path.join(app,'package.json'));
const {rollup}=createRequire(require.resolve('vite/package.json'))('rollup'),{transform}=require('esbuild');
const out=fs.mkdtempSync(path.join(root,'test-results/artifact-worker-')),compiled=path.join(out,'compiled');fs.mkdirSync(compiled);fs.writeFileSync(path.join(compiled,'package.json'),'{"type":"module"}');
const report={format:'craftmine.artifact-worker-test/1',out,checks:[],limits:['Real compiled Node worker and Electron Node-only ASAR checks; no application window, GPU, model, original profile or ordinary Godot acceptance.']};
const hash=v=>createHash('sha256').update(v).digest('hex');
const entry=path.join(app,'electron/main/godot-artifact-worker.ts');
const bundle=await rollup({input:{index:path.join(app,'electron/main/godot-artifact-worker-host.mjs'),'godot-artifact-worker':entry},external:id=>id.startsWith('node:'),plugins:[{name:'source-typescript-only',resolveId(source,importer){if(importer&&source.startsWith('.')){const p=path.resolve(path.dirname(importer),source);if(fs.existsSync(p))return p;if(fs.existsSync(p+'.ts'))return p+'.ts';}},async transform(code,id){if(id.endsWith('.ts')){const result=await transform(code,{loader:'ts',format:'esm',target:'node22'});return {code:result.code,map:null};}}}]});
try{const result=await bundle.write({dir:compiled,format:'es',entryFileNames:'[name].js',chunkFileNames:'chunks/[name]-[hash].js'});report.files=result.output.filter(f=>f.type==='chunk').map(f=>({path:f.fileName,sha256:hash(f.code),bytes:Buffer.byteLength(f.code),modules:Object.keys(f.modules)}));}finally{await bundle.close();}
const {startArtifactVerification}=await import(pathToFileURL(path.join(compiled,'index.js')));
function fixture(t){
 const dir=fs.mkdtempSync(path.join(out,'files-'));fs.mkdirSync(path.join(dir,'web'));const files={'web/index.html':Buffer.from('<html>fixture</html>'),'web/index.pck':Buffer.alloc(13_478_360,37)};
 for(const [p,b]of Object.entries(files))fs.writeFileSync(path.join(dir,p),b);
 t.after(()=>{assert(fs.realpathSync(dir).startsWith(out+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
 return{jobId:'gjob-'+'a'.repeat(64),buildId:'gbd-'+'b'.repeat(64),worldId:'world-fixture',inputHash:'c'.repeat(64),root:dir,artifacts:Object.entries(files).map(([p,b])=>({path:p,bytes:b.length,sha256:hash(b)}))};
}
const details=task=>{const log=[];task.report(log);return{log,worker:JSON.parse(log.find(x=>x.startsWith('[artifact-worker] ')).slice('[artifact-worker] '.length))};};
test('fixed compiled entry hashes full real artifacts and only succeeds after worker exit',async t=>{
 const d=fixture(t);let owned;
 class Observed extends Worker{constructor(file,options){super(file,options);owned=this;assert.equal(path.basename(file),'godot-artifact-worker.js');assert.deepEqual(options.env,{});assert.deepEqual(options.execArgv,[]);}}
 const task=startArtifactVerification(d,Date.now()+30000,{WorkerClass:Observed});await task.result;await task.closed;assert.equal(owned.threadId,-1);
 const result=details(task);assert.equal(result.worker.exitConfirmed,true);assert.equal(result.worker.status,'completed');assert(result.worker.progressMessages<=122);assert(result.log.every(line=>line.length<=1024));assert(!result.log.join('').includes(d.root));
 for(const file of report.files){assert(file.modules.every(m=>!m.endsWith('/main/index.ts')));assert(!fs.readFileSync(path.join(compiled,file.path),'utf8').includes('from "electron"'));}
 assert.match(fs.readFileSync(path.join(app,'electron.vite.config.ts'),'utf8'),/"godot-artifact-worker": resolve\(__dirname, "electron\/main\/godot-artifact-worker.ts"\)/);
 report.checks.push({name:'real-worker-success',...result.worker});
});
test('a parent event-loop pause does not skip worker verification and reports separate timings',async t=>{
 const d=fixture(t);let blocked=false;
 class ParentPause extends Worker{constructor(file,options){super(file,options);this.on('message',m=>{if(!blocked&&m.kind==='progress'){blocked=true;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250);}});}}
 const task=startArtifactVerification(d,Date.now()+30000,{WorkerClass:ParentPause});await task.result;const result=details(task);assert(blocked);assert.equal(result.worker.status,'completed');assert.equal(result.worker.exitConfirmed,true);assert(result.worker.mainElapsedMs>=250);
 report.checks.push({name:'controlled-parent-pause',...result.worker,notOrdinaryClientTiming:true});
});
test('same-size tail corruption, missing file and linked path remain real worker failures',async t=>{
 for(const mode of ['tail','missing','link']){
  const d=fixture(t),file=path.join(d.root,'web/index.pck');let link;
  if(mode==='tail'){const fd=fs.openSync(file,'r+');try{fs.writeSync(fd,Buffer.from([99]),0,1,d.artifacts[1].bytes-1);}finally{fs.closeSync(fd);}}
  if(mode==='missing')fs.unlinkSync(file);
  if(mode==='link'){const target=path.join(d.root,'other');fs.mkdirSync(target);fs.writeFileSync(path.join(target,'file'),'abc');link=path.join(d.root,'web/linked');fs.symlinkSync(target,link,process.platform==='win32'?'junction':'dir');d.artifacts.push({path:'web/linked/file',bytes:3,sha256:hash('abc')});}
  const task=startArtifactVerification(d,Date.now()+30000);try{await assert.rejects(task.result,new RegExp(mode==='missing'?'GODOT_CHECK_ARTIFACT_MISSING':'GODOT_CHECK_ARTIFACT_MISMATCH'));await task.closed;assert.equal(details(task).worker.exitConfirmed,true);}finally{if(link)fs.unlinkSync(link);}
 }
 report.checks.push({name:'real-corrupt-missing-link',passed:true});
});
test('actual worker cancel, deadline and silent/crashed exit do not return before termination',async t=>{
 const d=fixture(t);
 for(const mode of ['cancel','deadline','silent','crash']){
  let owned;const alternate=path.join(out,mode+'.cjs');if(mode==='silent')fs.writeFileSync(alternate,'/* exit without a result */');if(mode==='crash')fs.writeFileSync(alternate,"throw Error('untrusted private worker path');");if(mode==='deadline')fs.writeFileSync(alternate,'setInterval(()=>{},1000);');
  class Observed extends Worker{constructor(file,options){super(['silent','crash','deadline'].includes(mode)?alternate:file,options);owned=this;}}
  const stop=new AbortController(),task=startArtifactVerification(d,Date.now()+(mode==='deadline'?200:30000),{WorkerClass:Observed,signal:stop.signal});if(mode==='cancel')stop.abort(Error('GODOT_CHECK_CANCELLED'));
  await assert.rejects(task.result,new RegExp(mode==='cancel'?'GODOT_CHECK_CANCELLED':mode==='deadline'?'GODOT_CHECK_TIMEOUT':mode==='silent'?'WORKER_NO_RESULT':'WORKER_FAILED'));await task.closed;
  const result=details(task);if(owned){assert.equal(owned.threadId,-1);assert.equal(result.worker.exitConfirmed,true);}else{assert.equal(mode,'deadline');assert.equal(result.worker.workerStarted,false);}assert(!result.log.join('').includes('untrusted private'));report.checks.push({name:mode,...result.worker});
 }
});
test('foreign reply and unconfirmed termination are explicit failures with bounded cleanup evidence',async t=>{
 const d=fixture(t),scheduled=[];let instance;
 const timers={setTimeout(fn,ms){const timer={fn,ms,unref(){}};scheduled.push(timer);return timer;},clearTimeout(t){t.cleared=true;},setInterval(){return{unref(){}};},clearInterval(){}};
 class MissingExit extends EventEmitter{constructor(){super();instance=this;}terminate(){return Promise.resolve(1);}}
 const task=startArtifactVerification(d,Date.now()+30000,{WorkerClass:MissingExit,timers});instance.emit('message',{format:'craftmine.artifact-worker/1',kind:'result',binding:{attemptId:'foreign'}});
 const stopped=scheduled.find(t=>t.ms===5000);assert(stopped);stopped.fn();await assert.rejects(task.result,/WORKER_STOP_TIMEOUT/);await assert.rejects(task.closed,/WORKER_STOP_TIMEOUT/);
 const result=details(task);assert.equal(result.worker.errorCode,'GODOT_CHECK_ARTIFACT_WORKER_PROTOCOL');assert.equal(result.worker.shutdownErrorCode,'GODOT_CHECK_ARTIFACT_WORKER_STOP_TIMEOUT');assert.equal(result.worker.exitConfirmed,false);assert.equal(result.worker.messageReceived,false);report.checks.push({name:'finite-missing-exit',...result.worker});
});
test('preflight, spawn and post-construction failures do not leak a worker or raw failure text',async t=>{
 const d=fixture(t);let spawned=0;
 class SpawnFails{constructor(){spawned++;throw Error('C:/Private/account');}}
 const aborted=new AbortController();aborted.abort(Error('C:/Private/abort'));
 const preflight=startArtifactVerification(d,Date.now()+30000,{signal:aborted.signal,WorkerClass:SpawnFails});await assert.rejects(preflight.result,/GODOT_CHECK_CANCELLED/);await preflight.closed;assert.equal(spawned,0);
 assert.throws(()=>startArtifactVerification({...d,artifacts:[...d.artifacts,{...d.artifacts[0],path:'web/../other'}]},Date.now()+30000,{WorkerClass:SpawnFails}),/WORKER_PROTOCOL/);assert.equal(spawned,0);
 const spawn=startArtifactVerification(d,Date.now()+30000,{WorkerClass:SpawnFails});await assert.rejects(spawn.result,/WORKER_START_FAILED/);await spawn.closed;assert.equal(spawned,1);
 let terminated=false;
 class SetupFails extends EventEmitter{constructor(){super();this.stdout={resume(){throw Error('C:/Private/setup');}};}terminate(){terminated=true;queueMicrotask(()=>this.emit('exit',1));return Promise.resolve(1);}}
 const setup=startArtifactVerification(d,Date.now()+30000,{WorkerClass:SetupFails});await assert.rejects(setup.result,/WORKER_START_FAILED/);await setup.closed;assert(terminated);assert.equal(details(setup).worker.exitConfirmed,true);
 assert(![preflight,spawn].flatMap(task=>details(task).log).join('').includes('C:/Private'));
 report.checks.push({name:'preflight-spawn-setup-cleanup',passed:true});
});
test('a matching but incomplete success and excessive progress cannot certify artifacts',async t=>{
 const d=fixture(t);
 for(const mode of ['incomplete-success','progress-flood']){
  let instance,request;
  class Controlled extends EventEmitter{constructor(_file,options){super();instance=this;request=options.workerData;}terminate(){queueMicrotask(()=>this.emit('exit',1));return Promise.resolve(1);}}
  const task=startArtifactVerification(d,Date.now()+30000,{WorkerClass:Controlled});
  const snapshot={progress:{operation:'root-lstat',path:'.',artifactPath:null,artifactIndex:0,totalFiles:2,expectedBytes:null,bytesRead:0,totalBytesRead:0,verifiedFiles:0,elapsedMs:0,operationElapsedMs:0,lastByteProgressAgoMs:0},runtime:{diagnosticOnly:true,state:mode==='incomplete-success'?'completed':'running',elapsedMs:0,heartbeat:{periodMs:100,samples:0,maxLagMs:0},resources:{start:null,end:null}}};
  const message={format:request.format,binding:request.binding,kind:mode==='incomplete-success'?'result':'progress',ok:true,snapshot};
  for(let i=0;i<(mode==='incomplete-success'?1:123);i++)instance.emit('message',message);
  await assert.rejects(task.result,/WORKER_PROTOCOL/);await task.closed;const evidence=details(task);assert.equal(evidence.worker.exitConfirmed,true);assert(evidence.log.length<=3);
 }
 report.checks.push({name:'incomplete-success-progress-bound',passed:true});
});
test('actual compiled ASAR worker and dependency chunks run under Electron Node-only with no app or GPU',async t=>{
 const d=fixture(t),archive=path.join(out,'actual-worker.asar');await loadPackageAsar(app).createPackage(compiled,archive);
 const runner=path.join(out,'electron-node-runner.cjs');fs.writeFileSync(runner,`(async()=>{const {startArtifactVerification}=await import(${JSON.stringify(pathToFileURL(path.join(archive,'index.js')).href)});const task=startArtifactVerification(${JSON.stringify(d)},Date.now()+30000);await task.result;await task.closed;const log=[];task.report(log);console.log(JSON.stringify({ok:true,log}));})().catch(e=>{console.error(e.message);process.exitCode=1;});`);
 const electron=installedCreationElectron(path.dirname(require.resolve('electron/package.json')));
 const result=spawnSync(electron,[runner],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8',windowsHide:true,timeout:40000});assert.equal(result.status,0,result.stderr);const evidence=JSON.parse(result.stdout.trim());assert.equal(evidence.ok,true);assert(evidence.log.some(line=>line.includes('"exitConfirmed":true')));
 report.checks.push({name:'electron-node-asar',passed:true,archiveSha256:hash(fs.readFileSync(archive)),log:evidence.log});
});
test.after(()=>{report.passed=report.checks.length===11;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({out,checks:report.checks.length,passed:report.passed}));});
