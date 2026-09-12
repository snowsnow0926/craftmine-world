import {createHash,randomBytes} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {loadEnginePerformancePins,hasEnginePerformanceSource,verifyEnginePerformancePack} from '../../../../../../plugins/craftmine-world/godot-engine-profile.cjs';
import {validateEnginePerformance} from '../../../../../../plugins/craftmine-world/godot-engine-performance.mjs';

type Data=Record<string,any>;
export type EnginePerformanceIdentity={worldId:string;buildId:string;instanceId:string};
export type EnginePerformanceHost={
  instance:EnginePerformanceIdentity|null;
  enginePerformance:(identity:EnginePerformanceIdentity,nonce:string)=>Promise<unknown>;
};
export type EnginePerformanceDependencies={
  host:()=>EnginePerformanceHost;
  resourcesRoot:string;
  actualVersion:string;
  describe:(worldId:string)=>Promise<unknown>;
  exportSource:(worldId:string)=>Promise<unknown>;
  // Constructed by Main from its trusted Core artifact resolver, never a model path.
  readPack:(descriptor:Data,artifact:{path:string;bytes:number;sha256:string})=>Promise<Buffer>;
  assertActive?:()=>void;
  now?:()=>number;
};
const ID=/^[A-Za-z0-9._-]{1,128}$/,HASH=/^[a-f0-9]{64}$/,OID=/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const identityKeys=['worldId','buildId','instanceId'] as const;
const plain=(value:unknown):value is Data=>!!value&&typeof value==='object'&&!Array.isArray(value);
const fail=(code:string):never=>{throw Object.assign(Error(code),{errorCode:code});};
const requireThat=(value:unknown,code:string)=>{if(!value)fail(code);};
const hash=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const unknown=(reason:string)=>({available:false,reason,format:'craftmine.host-engine-performance/1',status:'unknown'});
const safePath=(value:unknown)=>typeof value==='string'&&value.length>0&&!/[\\:\x00-\x1f\x7f]/.test(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..');

/** Main-only source/PCK/instance binding, not isolation from scripts sharing an engine. */
export function createCraftmineEnginePerformanceSampler(deps:EnginePerformanceDependencies){
  const now=deps.now??Date.now;
  let previous:{identity:string;sequence:number}|null=null;
  return async(input:Partial<EnginePerformanceIdentity>={},controls:{signal?:AbortSignal}={})=>{
    const check=()=>{if(controls.signal?.aborted)fail('ENGINE_PERFORMANCE_CANCELLED');deps.assertActive?.();};
    // Cancellation discards pending reads; it never cancels world jobs or mutates progress.
    const read=async<T>(action:()=>Promise<T>):Promise<T>=>{
      check();const signal=controls.signal;
      return new Promise<T>((resolve,reject)=>{
        let settled=false;
        const finish=(error:unknown,value?:T)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',abort);error?reject(error):resolve(value as T);};
        const abort=()=>finish(Object.assign(Error('ENGINE_PERFORMANCE_CANCELLED'),{errorCode:'ENGINE_PERFORMANCE_CANCELLED'}));
        signal?.addEventListener('abort',abort,{once:true});
        Promise.resolve().then(()=>{check();return action();}).then(value=>{try{check();finish(null,value);}catch(error){finish(error);}},error=>finish(error));
      });
    };
    check();
    requireThat(plain(input)&&Object.entries(input).every(([key,value])=>identityKeys.includes(key as typeof identityKeys[number])&&typeof value==='string'&&ID.test(value)),'ENGINE_PERFORMANCE_INVALID_REQUEST');
    const live=deps.host(),initial=live.instance;
    if(!initial)return unknown('LIVE_INSTANCE_NOT_RUNNING');
    const identity=Object.fromEntries(identityKeys.map(key=>[key,initial[key]])) as EnginePerformanceIdentity;
    requireThat(identityKeys.every(key=>typeof identity[key]==='string'&&ID.test(identity[key])),'ENGINE_PERFORMANCE_INSTANCE_INVALID');
    for(const key of identityKeys)if(input[key]!==undefined&&input[key]!==identity[key])fail('ENGINE_PERFORMANCE_IDENTITY_MISMATCH');
    const current=()=>{
      check();const host=deps.host(),instance=host.instance;
      requireThat(host===live&&instance&&identityKeys.every(key=>instance[key]===identity[key]),'ENGINE_PERFORMANCE_INSTANCE_CHANGED');
    };
    const pins=loadEnginePerformancePins(deps.resourcesRoot);
    if(!pins)return unknown('ENGINE_MONITOR_PROFILE_UNAVAILABLE');

    async function binding(){
      current();
      const descriptor=await read(()=>deps.describe(identity.worldId));current();
      requireThat(plain(descriptor)&&descriptor.format==='craftmine.godot-runtime-descriptor/1'&&descriptor.phase==='formal'&&descriptor.worldId===identity.worldId&&descriptor.buildId===identity.buildId,'ENGINE_PERFORMANCE_DESCRIPTOR_IDENTITY');
      const d=descriptor as Data;
      requireThat(Number.isSafeInteger(d.sourceRevision)&&d.sourceRevision>=1&&HASH.test(d.manifestHash)&&HASH.test(d.artifactManifestHash)&&typeof d.root==='string'&&d.root.length>0&&Array.isArray(d.artifacts)&&d.artifacts.length>0&&d.artifacts.length<=4096,'ENGINE_PERFORMANCE_DESCRIPTOR_INVALID');
      const artifacts=d.artifacts.map((file:unknown)=>{
        requireThat(plain(file)&&safePath(file.path)&&Number.isSafeInteger(file.bytes)&&file.bytes>=0&&HASH.test(file.sha256),'ENGINE_PERFORMANCE_ARTIFACT_INVALID');
        const f=file as Data;return {path:f.path as string,bytes:f.bytes as number,sha256:f.sha256 as string};
      });
      requireThat(new Set(artifacts.map((file:{path:string})=>file.path)).size===artifacts.length,'ENGINE_PERFORMANCE_ARTIFACT_INVALID');
      const packs=artifacts.filter((file:{path:string})=>file.path.startsWith('web/')&&file.path.toLowerCase().endsWith('.pck'));
      requireThat(packs.length===1&&packs[0].bytes>=112&&packs[0].bytes<=256*1024*1024,'ENGINE_PERFORMANCE_PACK_REQUIRED');
      const exported=await read(()=>deps.exportSource(identity.worldId));current();
      requireThat(plain(exported)&&exported.format==='craftmine.godot-export-source/1'&&exported.worldId===identity.worldId&&exported.buildId===identity.buildId&&exported.sourceRevision===d.sourceRevision&&OID.test(exported.contentOid)&&typeof exported.repoId==='string'&&Array.isArray(exported.files)&&exported.files.length<=8192,'ENGINE_PERFORMANCE_SOURCE_IDENTITY');
      const s=exported as Data;
      const files=s.files.map((file:unknown)=>{
        requireThat(plain(file)&&safePath(file.path)&&Number.isSafeInteger(file.bytes)&&file.bytes>=0&&HASH.test(file.sha256),'ENGINE_PERFORMANCE_SOURCE_INVALID');
        const f=file as Data;return {path:f.path as string,bytes:f.bytes as number,sha256:f.sha256 as string};
      }).sort((a:{path:string},b:{path:string})=>a.path<b.path?-1:a.path>b.path?1:0);
      requireThat(new Set(files.map((file:{path:string})=>file.path)).size===files.length,'ENGINE_PERFORMANCE_SOURCE_INVALID');
      const pack=packs[0];
      // No snapshot/build body escapes these deliberately selected descriptors.
      return {descriptor:{worldId:identity.worldId,buildId:identity.buildId,root:d.root,entry:d.entry,
        sourceRevision:d.sourceRevision,manifestHash:d.manifestHash,artifactManifestHash:d.artifactManifestHash,artifacts},
        source:{sourceRevision:s.sourceRevision,sourceWorldId:s.sourceWorldId,repoId:s.repoId,contentOid:s.contentOid,files},pack};
    }
    const before=await binding();
    if(!hasEnginePerformanceSource(before.source.files,pins))return unknown('ENGINE_MONITOR_SOURCE_UNVERIFIED');
    const prove=async(state:typeof before)=>{
      const buffer=await read(()=>deps.readPack(state.descriptor,state.pack));current();
      requireThat(Buffer.isBuffer(buffer)&&buffer.length===state.pack.bytes&&hash(buffer)===state.pack.sha256,'ENGINE_PERFORMANCE_PACK_HASH');
      const proof=verifyEnginePerformancePack(buffer,state.source.files,pins);
      requireThat(proof.packSha256===state.pack.sha256&&proof.packBytes===state.pack.bytes,'ENGINE_PERFORMANCE_PACK_PROOF');
      return proof;
    };
    const proof=await prove(before);current();
    const nonce=randomBytes(32).toString('hex'),startedAt=now();
    const envelope=await read(()=>live.enginePerformance(identity,nonce));current();
    requireThat(plain(envelope)&&Object.keys(envelope).sort().join(',')==='buildId,format,instanceId,nonce,profile,sample,worldId'&&
      envelope.format==='craftmine.godot-engine-performance-envelope/1'&&envelope.profile==='engine-monitor/1'&&envelope.nonce===nonce&&identityKeys.every(key=>envelope[key]===identity[key]),'ENGINE_PERFORMANCE_ENVELOPE');
    const payload=(envelope as Data).sample;
    const sampledAt=plain(payload)&&typeof payload.sampledAt==='string'?Date.parse(payload.sampledAt):NaN;
    requireThat(Number.isFinite(sampledAt)&&sampledAt>=startedAt-5000&&sampledAt<=now()+5000,'ENGINE_PERFORMANCE_SAMPLE_TIME');
    const after=await binding();
    requireThat(isDeepStrictEqual(before,after),'ENGINE_PERFORMANCE_BINDING_CHANGED');
    const afterProof=await prove(after);current();
    requireThat(isDeepStrictEqual(proof,afterProof),'ENGINE_PERFORMANCE_PACK_CHANGED');
    const finishedAt=now();requireThat(finishedAt-sampledAt<=30000,'ENGINE_PERFORMANCE_SAMPLE_STALE');
    const key=JSON.stringify(identity);
    const validated=validateEnginePerformance(payload,{actualVersion:deps.actualVersion,previousSequence:previous?.identity===key?previous.sequence:null});
    current();previous={identity:key,sequence:validated.sequence};
    return {format:'craftmine.host-engine-performance/1',available:true,...identity,profile:'engine-monitor/1',nonce,
      sourceRevision:before.descriptor.sourceRevision,manifestHash:before.descriptor.manifestHash,
      sourceContentOid:before.source.contentOid,sourceFilesHash:hash(JSON.stringify(before.source.files)),
      artifactManifestHash:before.descriptor.artifactManifestHash,packSha256:proof.packSha256,
      hostSampledAt:new Date(finishedAt).toISOString(),observation:validated,
      authority:'host-bound-source-and-pack-verified',
      boundary:'Fixed source/PCK and host instance binding; not isolation from arbitrary scripts sharing the engine process.'};
  };
}
