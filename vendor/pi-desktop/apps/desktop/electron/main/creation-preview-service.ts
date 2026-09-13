import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {CreationCapture} from './creation-target-service';
import {validateCreationEdit} from './creation-edit-service';
export type PreviewInput={sessionId:string;captureId:string;previewId:string;sequence:number;action:'place'|'modify'|'cancel';kind?:'tree'|'rock'|'chest'|'door'|'marker';position?:number[];rotationY?:number;scale?:number[];color?:string};
type Identity={worldId:string;buildId:string;instanceId:string};
type Dependencies={resourcesRoot:string;capture(owner:number,sessionId:string,captureId:string):Promise<CreationCapture>;source(worldId:string):Promise<any>;dispatch(identity:Identity,args:Record<string,unknown>):Promise<any>};
const fail=(code:string):never=>{throw Error(code);};
export function validateCreationPreview(value:any):PreviewInput {
 if(!value||Object.keys(value).some(k=>!['sessionId','captureId','previewId','sequence','action','kind','position','rotationY','scale','color'].includes(k))||![value.sessionId,value.captureId,value.previewId].every(s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,120}$/.test(s))||!Number.isSafeInteger(value.sequence)||value.sequence<0)fail('CREATION_PREVIEW_INVALID');
 if(value.action==='cancel'){if(Object.keys(value).length!==5)fail('CREATION_PREVIEW_INVALID');return structuredClone(value);}
 const transform={position:value.position,rotationY:value.rotationY,scale:value.scale,color:value.color};
 if(Object.values(transform).some(v=>v===undefined))fail('CREATION_PREVIEW_INVALID');
 validateCreationEdit({sessionId:value.sessionId,captureId:value.captureId,operationId:value.previewId,action:value.action,...(value.action==='place'?{kind:value.kind,placement:transform}:{changes:transform})});
 if(!['place','modify'].includes(value.action)||value.action==='modify'&&value.kind!==undefined)fail('CREATION_PREVIEW_INVALID');
 return structuredClone(value);
}
/** Ephemeral owner-scoped transport; the source compiler remains commit authority. */
export function createCreationPreviewService(deps:Dependencies){
 const retired=new Map<number,Set<string>>();
 const retire=(owner:number,id:string)=>{const ids=retired.get(owner)??new Set<string>();ids.add(id);if(ids.size>128)ids.delete(ids.values().next().value!);retired.set(owner,ids);};
 const active=new Map<number,{input:PreviewInput;identity:Identity}>();let queue:Promise<unknown>=Promise.resolve();
 const serial=<T>(operation:()=>Promise<T>):Promise<T>=>{const task=queue.then(operation,operation);queue=task.catch(()=>{});return task;};
 const hashes=(resource:string)=>{const text=fs.readFileSync(path.join(deps.resourcesRoot,resource),'utf8').replace(/\r\n/g,'\n');return [text,text.replace(/\n/g,'\r\n')].map(v=>createHash('sha256').update(v).digest('hex'));};
 const clearInner=async(owner:number)=>{const prior=active.get(owner);if(!prior)return;active.delete(owner);retire(owner,prior.input.previewId);await deps.dispatch(prior.identity,{previewId:prior.input.previewId,sequence:prior.input.sequence+1,action:'cancel'}).catch(()=>{});};
 return {
  clear:(owner:number)=>serial(()=>clearInner(owner)),
  request:(owner:number,value:unknown)=>{const input=validateCreationPreview(value);return serial(async()=>{
   const prior=active.get(owner);
   if(input.action==='cancel'){
    retire(owner,input.previewId);
    if(prior?.input.previewId===input.previewId){if(input.sequence<=prior.input.sequence)fail('CREATION_PREVIEW_SUPERSEDED');await clearInner(owner);}
    return {status:'cancelled',previewId:input.previewId};
   }
   if(retired.get(owner)?.has(input.previewId))fail('CREATION_PREVIEW_SUPERSEDED');
   if(prior?.input.previewId===input.previewId&&input.sequence<=prior.input.sequence)fail('CREATION_PREVIEW_SUPERSEDED');
   const capture=await deps.capture(owner,input.sessionId,input.captureId);
   if(input.action==='place'&&(capture.source==='recent'||capture.target.surface!=='ground'))fail('CREATION_PLACEMENT_GROUND_REQUIRED');
   if(input.action==='modify'&&!capture.target.entityId)fail('CREATION_OBJECT_REQUIRED');
   const source=await deps.source(capture.worldId);
   if(source?.worldId!==capture.worldId||source.buildId!==capture.buildId||source.sourceRevision!==capture.sourceRevision||source.baseId!=='creation-sandbox'||!Array.isArray(source.files))fail('CREATION_TARGET_STALE');
   for(const [name,resource] of [['scripts/creation_world.gd','bases/creation-sandbox/scripts/creation_world.gd'],['craftmine_shared/runtime_bridge.gd','shared/runtime_bridge_engine_v1.gd']]){
    const matches=source.files.filter((f:any)=>f.path===name);
    if(matches.length!==1||!hashes(resource!).includes(matches[0].sha256)||source.files.some((f:any)=>f.path!==name&&typeof f.path==='string'&&(f.path.toLowerCase()===name||f.path.toLowerCase().startsWith(name+'.'))))fail('CREATION_PREVIEW_SOURCE_UNSUPPORTED');
   }
   await deps.capture(owner,input.sessionId,input.captureId);
   const identity={worldId:capture.worldId,buildId:capture.buildId,instanceId:capture.instanceId};
   if(prior&&(prior.input.previewId!==input.previewId||JSON.stringify(prior.identity)!==JSON.stringify(identity)))await clearInner(owner);
   const args={previewId:input.previewId,sequence:input.sequence,action:input.action,position:input.position,rotationY:input.rotationY,scale:input.scale,color:input.color,...(input.action==='place'?{kind:input.kind}:{targetId:capture.target.entityId})};
   const result=await deps.dispatch(identity,args);active.set(owner,{input,identity});try{await deps.capture(owner,input.sessionId,input.captureId);}catch(error){await clearInner(owner);throw error;}return result;
  });},
 };
}
