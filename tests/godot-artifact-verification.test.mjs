import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {lstat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {PassThrough} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createArtifactVerificationProgress,verifyArtifacts} from '../vendor/pi-desktop/apps/desktop/electron/main/godot-artifact-verification.ts';
import {createGodotCheckPhases} from '../vendor/pi-desktop/apps/desktop/electron/main/godot-check-phases.ts';
const {diagnosticLog}=createRequire(import.meta.url)('../plugins/craftmine-world/godot-runtime-diagnostic-log.cjs');
const hash=b=>createHash('sha256').update(b).digest('hex');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'artifact-await-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'web'));fs.writeFileSync(path.join(root,'web/index.html'),'abc');
 return{root,artifacts:[{path:'web/index.html',bytes:3,sha256:hash('abc')}]};
}
const decode=log=>JSON.parse(log.find(s=>s.startsWith('[artifact-verification] ')).slice('[artifact-verification] '.length));
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve:value=>resolve(value)};};
async function failure(descriptor,io){
 const progress=createArtifactVerificationProgress(descriptor.artifacts.length),log=[];
 try{await verifyArtifacts(descriptor,Date.now()+30000,progress,io);assert.fail('expected actual verification failure');}
 catch(error){progress.fail(log,error.message);return{error:error.message,diagnostic:decode(log)};}
}
test('real asynchronous files retain exact size/hash and missing checks without success logging',async t=>{
 const d=fixture(t),log=[],progress=createArtifactVerificationProgress(1);
 await verifyArtifacts(d,Date.now()+30000,progress);progress.fail(log,'late noise');assert.deepEqual(log,[]);
 d.artifacts[0].sha256=hash('xyz');let r=await failure(d);assert.equal(r.error,'GODOT_CHECK_ARTIFACT_MISMATCH');assert.equal(r.diagnostic.operation,'hash-compare');assert.equal(r.diagnostic.bytesRead,3);
 d.artifacts[0].bytes=4;r=await failure(d);assert.equal(r.error,'GODOT_CHECK_ARTIFACT_MISMATCH');assert.equal(r.diagnostic.operation,'size-compare');assert.equal(r.diagnostic.bytesRead,0);
 fs.unlinkSync(path.join(d.root,'web/index.html'));r=await failure(d);assert.equal(r.error,'GODOT_CHECK_ARTIFACT_MISSING');assert.equal(r.diagnostic.operation,'entry-lstat');assert.equal(r.diagnostic.path,'web/index.html');assert(!JSON.stringify(r).includes(d.root));
});
test('root type, missing nested artifact and symbolic path checks remain failures',async t=>{
 const d=fixture(t),rootFile={...d,root:path.join(d.root,'web/index.html')};let r=await failure(rootFile);assert.equal(r.error,'INVALID_GODOT_CHECK_DESCRIPTOR');assert.equal(r.diagnostic.operation,'root-lstat');
 const nested={...d,artifacts:[{path:'web/missing/code.wasm',bytes:0,sha256:hash('')}]};r=await failure(nested);assert.equal(r.diagnostic.operation,'path-lstat');assert.equal(r.diagnostic.path,'web/missing');
 // A real directory junction is sufficient to exercise no-link traversal on Windows.
 fs.mkdirSync(path.join(d.root,'target'));fs.writeFileSync(path.join(d.root,'target/file'),'abc');fs.symlinkSync(path.join(d.root,'target'),path.join(d.root,'web/link'),process.platform==='win32'?'junction':'dir');
 try{r=await failure({...d,artifacts:[{path:'web/link/file',bytes:3,sha256:hash('abc')}]});assert.equal(r.error,'GODOT_CHECK_ARTIFACT_MISMATCH');assert.equal(r.diagnostic.path,'web/link');}
 finally{fs.unlinkSync(path.join(d.root,'web/link'));}
});
test('a hung root/entry/path/size lstat records its exact awaiting operation, and late completion cannot rewrite it',async t=>{
 const expected=['root-lstat','entry-lstat','path-lstat','path-lstat','size-lstat'];
 for(let target=1;target<=5;target++){
  const d=fixture(t),entered=deferred(),release=deferred();let calls=0,time=0;
  const progress=createArtifactVerificationProgress(1,()=>time),log=[];
  const work=verifyArtifacts(d,Date.now()+30000,progress,{lstat:async file=>{if(++calls===target){entered.resolve();await release.promise;}return lstat(file);},createReadStream:fs.createReadStream});
  await entered.promise;time=30000;
  await assert.rejects(Promise.race([work,Promise.reject(Error('GODOT_CHECK_TIMEOUT'))]),/GODOT_CHECK_TIMEOUT/);
  progress.fail(log,'GODOT_CHECK_TIMEOUT');const before=JSON.stringify(log),diag=decode(log);
  assert.equal(diag.operation,expected[target-1]);assert.equal(diag.errorCode,'GODOT_CHECK_TIMEOUT');assert.equal(diag.elapsedMs,30000);assert.equal(diag.bytesRead,0);
  release.resolve();await work;assert.equal(JSON.stringify(log),before);
 }
});
test('stream open hang differs from partial read hang and cancellation keeps byte progress',async t=>{
 for(const mode of ['open','read']){
  const d=fixture(t),entered=deferred(),stream=new PassThrough();let time=0;
  const progress=createArtifactVerificationProgress(1,()=>time),originalBytes=progress.bytes;
  progress.bytes=count=>{originalBytes(count);entered.resolve();};
  const work=verifyArtifacts(d,Date.now()+30000,progress,{lstat,createReadStream:()=>{queueMicrotask(()=>{if(mode==='open')entered.resolve();else{stream.emit('open',123);stream.write(Buffer.from('ab'));}});return stream;}});
  await entered.promise;time=1234;const reason=mode==='open'?'GODOT_CHECK_TIMEOUT':'GODOT_CHECK_CANCELLED';
  await assert.rejects(Promise.race([work,Promise.reject(Error(reason))]),new RegExp(reason));
  const log=[];progress.fail(log,reason);const before=JSON.stringify(log),diag=decode(log);
  assert.equal(diag.operation,mode==='open'?'stream-open':'stream-read');assert.equal(diag.bytesRead,mode==='open'?0:2);assert.equal(diag.totalBytesRead,diag.bytesRead);assert.equal(diag.errorCode,reason);
  stream.end(mode==='open'?'abc':'c');await work;assert.equal(JSON.stringify(log),before);
 }
});
test('4096 artifacts keep a single final operation and survive the existing bounded diagnostic transport',()=>{
 let time=0;const log=[],phases=createGodotCheckPhases(log,()=>time),progress=createArtifactVerificationProgress(4096,()=>time);phases.begin('artifact-verification');
 for(let i=1;i<=4096;i++){progress.artifact('web/'+i+'.pck',i,99);progress.operation('stream-read');progress.bytes(11);if(i<4096)progress.verified();}
 assert.equal(log.length,1);while(log.length<64)log.push('old bounded noise');time=30141;progress.fail(log,'GODOT_CHECK_TIMEOUT');phases.fail();
 assert.equal(log.length,64);const diag=decode(log);assert.equal(diag.artifactIndex,4096);assert.equal(diag.verifiedFiles,4095);assert.equal(diag.bytesRead,11);assert.equal(diag.totalBytesRead,4096*11);assert.equal(log.filter(s=>s.startsWith('[artifact-verification]')).length,1);
 const claim={jobId:'job',worldId:'world',buildId:'build',inputHash:'input'};
 const persisted=JSON.parse(diagnosticLog({format:'craftmine.godot-runtime-check/1',scope:'base-startup',...claim,diagnostics:log},claim));
 assert(persisted.diagnostics.some(s=>s.includes('"artifactIndex":4096')));assert(persisted.diagnostics.some(s=>s.includes('artifact-verification failed')));
});
test('production wiring keeps the original timeout race and records artifact failure before phase failure',()=>{
 const source=fs.readFileSync(new URL('../vendor/pi-desktop/apps/desktop/electron/main/godot-build-verifier.ts',import.meta.url),'utf8');
 assert.match(source,/CHECK_DEADLINE_MS = 30_000/);assert.match(source,/await bounded\(verifyArtifacts\(descriptor, deadline,artifactProgress\)\)/);
 assert(source.indexOf('artifactProgress.fail(diagnostics,messageOf(failure))')<source.indexOf('phases.fail()'));
});
test('diagnostic paths are bounded relative labels and never include private absolute IO filenames',()=>{
 const p=createArtifactVerificationProgress(1),log=[];p.artifact('web/'+'🐶'.repeat(4096)+'.pck',1,Number.MAX_SAFE_INTEGER);p.operation('stream-read');p.fail(log,'C:/Private/Artifacts/file.pck ENOENT');
 assert(log[0].length<=1024);assert(!log[0].includes('C:/Private'));assert.equal(decode(log).errorCode,'ARTIFACT_IO_ERROR');assert(decode(log).artifactPath.endsWith('…'));
 const q=createArtifactVerificationProgress(1),other=[];q.operation('root-lstat','D:/Secret/root');q.fail(other,'GODOT_CHECK_TIMEOUT');assert.equal(decode(other).path,'[invalid-relative-path]');
});
const runtimeSummary=log=>JSON.parse(log.find(s=>s.startsWith('[artifact-verification-runtime] ')).slice('[artifact-verification-runtime] '.length));
test('heartbeat is stage-local and disposed once on success, failure and cancellation; only resource types are retained',()=>{
 for(const outcome of ['completed','GODOT_CHECK_TIMEOUT','GODOT_CHECK_CANCELLED']){
  let time=0,created=0,disposed=0,reads=0,tick;const log=[];
  const progress=createArtifactVerificationProgress(1,()=>time,{schedule:sample=>{created++;tick=sample;return()=>disposed++;},resources:()=>{reads++;return ['FSReqPromise','FSReqPromise','Timeout','D:/private/root','pid=77'];}});
  assert.equal(created,0);progress.operation('root-lstat','.');assert.equal(created,1);time=100;tick();time=450;tick();
  if(outcome==='completed'){progress.complete();progress.report(log);}else progress.fail(log,outcome);
  const summary=runtimeSummary(log);assert.equal(summary.diagnosticOnly,true);assert.equal(summary.heartbeat.samples,2);assert.equal(summary.heartbeat.maxLagMs,250);assert.deepEqual(summary.resources.start.counts,{FSReqPromise:2,Other:2,Timeout:1});assert.equal(disposed,1);assert.equal(reads,2);
  const before=JSON.stringify(log);time=1000;tick();progress.complete();progress.fail(log,'late');progress.report(log);assert.equal(disposed,1);assert.equal(JSON.stringify(log),before);assert(!before.includes('private'));assert(!before.includes('pid='));
 }
});
test('a paused filesystem await still permits real heartbeat samples without per-tick logging',async t=>{
 const d=fixture(t),entered=deferred(),release=deferred(),progress=createArtifactVerificationProgress(1),log=[];let count=0;
 const work=verifyArtifacts(d,Date.now()+30000,progress,{lstat:async file=>{if(++count===1){entered.resolve();await release.promise;}return lstat(file);},createReadStream:fs.createReadStream});
 await entered.promise;await delay(250);assert.equal(log.length,0);progress.fail(log,'GODOT_CHECK_CANCELLED');
 assert.equal(decode(log).operation,'root-lstat');assert(runtimeSummary(log).heartbeat.samples>=1);assert.equal(log.length,2);
 const before=JSON.stringify(log);release.resolve();await work;await delay(110);assert.equal(JSON.stringify(log),before);
});
test('deadline-first final gap is observed and resource summary is bounded; default timer is unref',()=>{
 let time=0;const log=[],p=createArtifactVerificationProgress(1,()=>time,{schedule:()=>()=>{},resources:()=>Array.from({length:100},(_,i)=>'Resource'+String(i).padStart(2,'0'))});p.operation('root-lstat','.');time=30141;p.fail(log,'GODOT_CHECK_TIMEOUT');
 const summary=runtimeSummary(log);assert.equal(summary.heartbeat.samples,0);assert.equal(summary.heartbeat.maxLagMs,30041);assert.equal(summary.resources.start.omittedTypes,94);assert(log.every(line=>line.length<=1024));
 const moduleUrl=new URL('../vendor/pi-desktop/apps/desktop/electron/main/godot-artifact-verification.ts',import.meta.url).href;
 const result=spawnSync(process.execPath,['--input-type=module','-e',`import {createArtifactVerificationProgress} from ${JSON.stringify(moduleUrl)};createArtifactVerificationProgress(1).operation('root-lstat','.');console.log('unref-timer-started');`],{encoding:'utf8',windowsHide:true,timeout:3000});
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/unref-timer-started/);
});
