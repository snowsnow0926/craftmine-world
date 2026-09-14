import {isAbsolute} from 'node:path';
export const ARTIFACT_WORKER_FORMAT='craftmine.artifact-worker/1';
export const ARTIFACT_WORKER_ERRORS=new Set(['INVALID_GODOT_CHECK_DESCRIPTOR','GODOT_CHECK_ARTIFACT_MISSING','GODOT_CHECK_ARTIFACT_MISMATCH','GODOT_CHECK_ARTIFACT_IO_ERROR','GODOT_CHECK_TIMEOUT','GODOT_CHECK_CANCELLED']);
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const fail=()=>{throw Error('GODOT_CHECK_ARTIFACT_WORKER_PROTOCOL');};
export function artifactWorkerRequest(input){
  if(!plain(input)||input.format!==ARTIFACT_WORKER_FORMAT||!plain(input.binding)||!plain(input.descriptor)||!integer(input.deadline))fail();
  const b=input.binding,d=input.descriptor;
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(b.attemptId)||!/^gjob-[a-f0-9]{64}$/.test(b.jobId)||!/^gbd-[a-f0-9]{64}$/.test(b.buildId)||! /^[a-f0-9]{64}$/.test(b.inputHash)||! /^[a-zA-Z0-9._-]{1,128}$/.test(b.worldId))fail();
  if(typeof d.root!=='string'||!isAbsolute(d.root)||d.root.includes('\0')||!Array.isArray(d.artifacts)||d.artifacts.length<1||d.artifacts.length>4096)fail();
  const seen=new Set();for(const f of d.artifacts){
    if(!plain(f)||typeof f.path!=='string'||f.path.length>4096||!f.path.startsWith('web/')||/[\\:\0]/.test(f.path)||f.path.split('/').some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p))||!integer(f.bytes)||! /^[a-f0-9]{64}$/.test(f.sha256)||seen.has(f.path.toLowerCase()))fail();
    seen.add(f.path.toLowerCase());
  }
  if(!seen.has('web/index.html'))fail();return input;
}
const relative=p=>p===null||typeof p==='string'&&p.length<=193&&!/[\\:\u0000-\u001f]/.test(p)&&(p==='.'||p==='web'||p.startsWith('web/'));
function resources(v){return v===null||plain(v)&&typeof v.available==='boolean'&&integer(v.omittedTypes)&&plain(v.counts)&&Object.entries(v.counts).length<=6&&Object.entries(v.counts).every(([name,count])=>/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(name)&&integer(count));}
const resourceProjection=v=>v===null?null:{available:v.available,counts:Object.fromEntries(Object.entries(v.counts)),omittedTypes:v.omittedTypes};
export function artifactWorkerMessage(message,request){
  if(!plain(message)||JSON.stringify(message).length>8192||message.format!==ARTIFACT_WORKER_FORMAT||!['progress','result'].includes(message.kind)||!plain(message.binding)||Object.keys(request.binding).some(k=>message.binding[k]!==request.binding[k]))fail();
  const snapshot=message.snapshot,p=snapshot?.progress,r=snapshot?.runtime;
  if(!plain(p)||!plain(r)||!relative(p.path)||!relative(p.artifactPath)||!['root-lstat','entry-lstat','path-lstat','size-lstat','size-compare','stream-open','stream-read','hash-update','hash-digest','hash-compare'].includes(p.operation))fail();
  if(!['artifactIndex','totalFiles','bytesRead','totalBytesRead','verifiedFiles','elapsedMs','operationElapsedMs','lastByteProgressAgoMs'].every(k=>integer(p[k]))||p.totalFiles!==request.descriptor.artifacts.length||p.artifactIndex>p.totalFiles||p.verifiedFiles>p.totalFiles||p.expectedBytes!==null&&!integer(p.expectedBytes))fail();
  if(r.diagnosticOnly!==true||!['running','completed','failed'].includes(r.state)||!integer(r.elapsedMs)||r.heartbeat?.periodMs!==100||!integer(r.heartbeat?.samples)||!integer(r.heartbeat?.maxLagMs)||!resources(r.resources?.start)||!resources(r.resources?.end))fail();
  if(message.kind==='result'){
    if(typeof message.ok!=='boolean')fail();
    if(message.ok&&(r.state!=='completed'||p.verifiedFiles!==p.totalFiles||p.totalBytesRead!==request.descriptor.artifacts.reduce((n,f)=>n+f.bytes,0)))fail();
    if(!message.ok&&(!ARTIFACT_WORKER_ERRORS.has(message.error)||r.state!=='failed'))fail();
  }
  // Only these exact fields can reach bounded public diagnostics.
  return {kind:message.kind,ok:message.ok,error:message.error,snapshot:{progress:Object.fromEntries(['operation','path','artifactPath','artifactIndex','totalFiles','expectedBytes','bytesRead','totalBytesRead','verifiedFiles','elapsedMs','operationElapsedMs','lastByteProgressAgoMs'].map(k=>[k,p[k]])),runtime:{diagnosticOnly:true,state:r.state,elapsedMs:r.elapsedMs,heartbeat:{periodMs:100,samples:r.heartbeat.samples,maxLagMs:r.heartbeat.maxLagMs},resources:{start:resourceProjection(r.resources.start),end:resourceProjection(r.resources.end)}}}};
}
