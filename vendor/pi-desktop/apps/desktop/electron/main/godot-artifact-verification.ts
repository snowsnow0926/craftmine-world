import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat} from 'node:fs/promises';
import {join} from 'node:path';

type Descriptor = {root:string;artifacts:Array<{path:string;bytes:number;sha256:string}>};
type Operation = 'root-lstat'|'entry-lstat'|'path-lstat'|'size-lstat'|'size-compare'|'stream-open'|'stream-read'|'hash-update'|'hash-digest'|'hash-compare';
// No absolute filenames or OS error messages enter this diagnostic. The full
// descriptor remains private; long relative paths are explicitly abbreviated.
const relativeLabel=(value:string|null)=>value===null?null:(value==='.'||value==='web'||value.startsWith('web/'))&&!/[\\:\u0000-\u001f]/.test(value)?Array.from(value).slice(0,96).join('')+(Array.from(value).length>96?'…':''):'[invalid-relative-path]';
type RuntimeObservation={resources?:()=>string[];schedule?:(sample:()=>void)=>()=>void};
function resourceTypes(read:()=>string[]){
  try{
    const counts:Record<string,number>={};
    for(const raw of read()){const type=/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(raw)?raw:'Other';counts[type]=(counts[type]??0)+1;}
    const entries=Object.entries(counts).sort(([a],[b])=>a.localeCompare(b));
    return {available:true,counts:Object.fromEntries(entries.slice(0,6)),omittedTypes:Math.max(0,entries.length-6)};
  }catch{return {available:false,counts:{},omittedTypes:0};}
}
export function createArtifactVerificationProgress(totalFiles:number,now=Date.now,observation:RuntimeObservation={}){
  const started=now();let operationStarted=started,lastProgress=started,closed=false,active=false;
  const resources=observation.resources??(()=>process.getActiveResourcesInfo());
  let dispose:(()=>void)|null=null,samples=0,maxLagMs=0,lastTick=0,emitted=false;
  let startResources:ReturnType<typeof resourceTypes>|null=null,summary:Record<string,unknown>|null=null;
  const startRuntime=()=>{
    if(startResources)return;startResources=resourceTypes(resources);lastTick=now();
    const sample=()=>{if(closed)return;const time=now();samples++;maxLagMs=Math.max(maxLagMs,Math.max(0,time-lastTick-100));lastTick=time;};
    dispose=observation.schedule?observation.schedule(sample):(()=>{const timer=setInterval(sample,100);timer.unref();return()=>clearInterval(timer);})();
  };
  const stopRuntime=(state:'completed'|'failed')=>{
    // Deadline may run before a delayed heartbeat callback on the same loop.
    // Include the final overdue interval rather than falsely reporting zero lag.
    maxLagMs=Math.max(maxLagMs,Math.max(0,now()-lastTick-100));
    dispose?.();dispose=null;
    summary={diagnosticOnly:true,state,elapsedMs:Math.max(0,now()-started),heartbeat:{periodMs:100,samples,maxLagMs},resources:{start:startResources,end:resourceTypes(resources)}};
  };
  const reportRuntime=(log:string[])=>{if(!summary||emitted)return;emitted=true;if(log.length>62)log.splice(62);log.push('[artifact-verification-runtime] '+JSON.stringify(summary));};
  let current: {operation:Operation;path:string|null;artifactPath:string|null;artifactIndex:number;totalFiles:number;expectedBytes:number|null;bytesRead:number;totalBytesRead:number;verifiedFiles:number}={operation:'root-lstat',path:null,artifactPath:null,artifactIndex:0,totalFiles,expectedBytes:null,bytesRead:0,totalBytesRead:0,verifiedFiles:0};
  return {
    artifact(path:string,index:number,bytes:number){if(closed)return;current={...current,artifactPath:relativeLabel(path),artifactIndex:index,expectedBytes:bytes,bytesRead:0};},
    operation(operation:Operation,path:string|null=current.artifactPath){if(closed)return;active=true;startRuntime();operationStarted=now();current={...current,operation,path:relativeLabel(path)};},
    bytes(count:number){if(closed)return;lastProgress=now();current.bytesRead+=count;current.totalBytesRead+=count;},
    verified(){if(!closed)current.verifiedFiles++;},
    complete(){if(closed)return;closed=true;active=false;stopRuntime('completed');},
    report:reportRuntime,
    fail(log:string[],reason:string){
      if(closed||!active)return;closed=true;stopRuntime('failed');const time=now();
      const errorCode=reason.match(/\b(?:GODOT_CHECK_[A-Z_]+|INVALID_GODOT_CHECK_DESCRIPTOR)\b/)?.[0]??'ARTIFACT_IO_ERROR';
      // Two fixed observations and one phase failure, never one line per file/tick.
      if(log.length>61)log.splice(61);
      log.push('[artifact-verification] '+JSON.stringify({...current,errorCode,elapsedMs:Math.max(0,time-started),operationElapsedMs:Math.max(0,time-operationStarted),lastByteProgressAgoMs:Math.max(0,time-lastProgress)}));
      reportRuntime(log);
    },
  };
}
type Progress=ReturnType<typeof createArtifactVerificationProgress>;
type IO={lstat:typeof lstat;createReadStream:typeof createReadStream};

/** Same asynchronous file/link/size/hash checks; the observer never scores them. */
export async function verifyArtifacts(descriptor:Descriptor,deadline:number,progress:Progress,io:IO={lstat,createReadStream}):Promise<void>{
  progress.operation('root-lstat','.');
  const rootInfo=await io.lstat(descriptor.root).catch(()=>null);
  if(!rootInfo||!rootInfo.isDirectory()||rootInfo.isSymbolicLink())throw Error('INVALID_GODOT_CHECK_DESCRIPTOR');
  const entry=join(descriptor.root,'web','index.html');progress.operation('entry-lstat','web/index.html');
  const entryInfo=await io.lstat(entry).catch(()=>null);
  if(!entryInfo||!entryInfo.isFile())throw Error('GODOT_CHECK_ARTIFACT_MISSING');
  for(const [index,artifact]of descriptor.artifacts.entries()){
    if(Date.now()>=deadline)throw Error('GODOT_CHECK_TIMEOUT');
    progress.artifact(artifact.path,index+1,artifact.bytes);
    const parts=artifact.path.split('/');let cursor=descriptor.root;
    for(const [partIndex,part]of parts.entries()){
      cursor=join(cursor,part);progress.operation('path-lstat',parts.slice(0,partIndex+1).join('/'));
      const info=await io.lstat(cursor).catch(()=>null);
      if(!info)throw Error('GODOT_CHECK_ARTIFACT_MISSING');
      if(info.isSymbolicLink())throw Error('GODOT_CHECK_ARTIFACT_MISMATCH');
      if(cursor!==join(descriptor.root,...parts)&&!info.isDirectory())throw Error('INVALID_GODOT_CHECK_DESCRIPTOR');
    }
    const file=join(descriptor.root,...parts);progress.operation('size-lstat');
    const info=await io.lstat(file).catch(()=>null);
    if(!info||!info.isFile())throw Error('GODOT_CHECK_ARTIFACT_MISSING');
    progress.operation('size-compare');
    if(info.size!==artifact.bytes)throw Error('GODOT_CHECK_ARTIFACT_MISMATCH');
    const hash=createHash('sha256');progress.operation('stream-open');
    const stream=io.createReadStream(file);
    stream.once('open',()=>progress.operation('stream-read'));
    for await(const chunk of stream){
      progress.bytes((chunk as Buffer).length);progress.operation('hash-update');hash.update(chunk as Buffer);progress.operation('stream-read');
    }
    progress.operation('hash-digest');const actualHash=hash.digest('hex');progress.operation('hash-compare');
    if(actualHash!==artifact.sha256)throw Error('GODOT_CHECK_ARTIFACT_MISMATCH');
    progress.verified();
  }
  progress.complete();
}
