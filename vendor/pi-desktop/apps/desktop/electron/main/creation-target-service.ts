import {freezeCreationRequirements, type CreationEntity, type FrozenCreationRequirement, type DirectCreationIntent} from "./creation-check-requirements.ts";
import fs from "node:fs";
import path from "node:path";
import {createHash, randomUUID} from "node:crypto";
import type {CreationMigrationAdvance} from './creation-source-migration';
import {recentCreationResults} from './creation-recent-results.ts';

type Context = {projectId:string;sessionId:string;turnId:string};
type Vector = [number,number,number];
type Target = {entityId:string|null;position:Vector|null;normal:Vector|null;surface:string;revision:number};
type CaptureSession = {projectId:string;sessionId:string|null};
export type CreationTargetSelection={worldId:string;entityId:string}|null;
export type CreationCapture = {
  format:"craftmine.creation-target/1";snapshotId:string;worldId:string;buildId:string;instanceId:string;
  sourceRevision:number;manifestHash:string;sampledAt:string;capturedAt:number;
  playerPosition:Vector;target:Target;source?:'ray'|'recent';autoApply:boolean;entities?:CreationEntity[];creationRequirements?:FrozenCreationRequirement;sourceMigration?:CreationMigrationAdvance;
};
type Dependencies = {
  directory:string;
  selection():Promise<string|null>;
  instance():{worldId:string;buildId:string;instanceId:string}|null;
  descriptor(worldId:string):Promise<any>;
  sample(input:{worldId:string;buildId:string;instanceId:string}):Promise<any>;
  journal?(capture:CreationCapture):Promise<unknown>;
  now?:()=>number;
};
const id=(value:unknown):value is string=>typeof value==="string"&&/^[a-zA-Z0-9._-]{1,128}$/.test(value);
const vec=(value:unknown):value is Vector=>Array.isArray(value)&&value.length===3&&value.every(x=>typeof x==="number"&&Number.isFinite(x)&&Math.abs(x)<=100000);
function fail(code:string):never{throw Object.assign(Error(code),{errorCode:code});}
const digest=(text:string)=>createHash("sha256").update(text).digest("hex");

/** Editable values come from the same observed entity as the fixed ray target. */
export function creationTargetDisplay(target:Target,entities:unknown){
  const matches=Array.isArray(entities)?entities.filter(item=>item?.id===target.entityId):[];
  if(target.surface!=="entity"||matches.length!==1)return structuredClone(target);
  const entity=matches[0],names:Record<string,string>={tree:"树",rock:"石头",chest:"宝箱",door:"门",marker:"标记"};
  if(!Object.hasOwn(names,entity.kind)||!vec(entity.scale)||entity.scale.some((n:number)=>n<.25||n>4)||typeof entity.color!=="string"||!/^#[a-fA-F0-9]{6}$/.test(entity.color))return structuredClone(target);
  const label=entity.kind==="marker"?entity.parameters?.label:undefined;
  const entityName=typeof label==="string"&&label.length>0&&label.length<=80&&!/[\x00-\x1f]/.test(label)?label:names[entity.kind];
  return {...structuredClone(target),entityName,entityKind:entity.kind,scale:[...entity.scale],color:entity.color};
}

/** Host-owned capture coordinates are immutable; a renderer receives only a handle. */
export function createCreationTargetService(deps:Dependencies) {
  const now=deps.now??Date.now;
  const pending=new Map<string,{owner:number;session:CaptureSession;capture:CreationCapture;bound?:string}>();
  const captureEpochs=new Map<number,number>();
  const file=(kind:string,key:string)=>path.join(deps.directory,kind,digest(key)+".json");
  const read=(target:string):any=>{try{if(fs.statSync(target).size>131072)fail("CREATION_CONTEXT_TOO_LARGE");return JSON.parse(fs.readFileSync(target,"utf8"));}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return null;throw error;}};
  const write=(target:string,value:unknown)=>{
    const data=JSON.stringify(value);if(Buffer.byteLength(data)>131072)fail("CREATION_CONTEXT_TOO_LARGE");
    fs.mkdirSync(path.dirname(target),{recursive:true});
    const temporary=target+"."+randomUUID()+".tmp";
    try{fs.writeFileSync(temporary,data,{flag:"wx"});fs.renameSync(temporary,target);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
  };
  const contextKey=(context:Context)=>{
    if(![context.projectId,context.sessionId,context.turnId].every(value=>typeof value==="string"&&value.length>0&&value.length<=240))fail("CREATION_CONTEXT_INVALID");
    return JSON.stringify([context.projectId,context.sessionId,context.turnId]);
  };
  const policyFor=(worldId:string)=>{if(!id(worldId))fail("CREATION_WORLD_INVALID");const record=read(file("policy",worldId));return {worldId,autoApply:record?.worldId===worldId&&record.autoApply===true};};
  const assertLive=(capture:CreationCapture)=>{
    const current=deps.instance();
    if(!current||current.worldId!==capture.worldId||current.buildId!==capture.buildId||current.instanceId!==capture.instanceId)fail("CREATION_TARGET_STALE");
  };
  const assertFormal=async(capture:CreationCapture)=>{
    assertLive(capture);
    const descriptor=await deps.descriptor(capture.worldId);
    if(await deps.selection()!==capture.worldId || descriptor?.worldId!==capture.worldId || descriptor?.buildId!==capture.buildId ||
      descriptor.sourceRevision!==capture.sourceRevision || descriptor.manifestHash!==capture.manifestHash)fail("CREATION_TARGET_STALE");
    assertLive(capture);
  };
  return {
    async policy(input:Record<string,unknown>={}) {
      const worldId=await deps.selection();if(!worldId)fail("CREATION_WORLD_UNAVAILABLE");
      if(Object.keys(input).some(key=>key!=="worldId"&&key!=="autoApply"))fail("CREATION_POLICY_INVALID");
      if(Object.hasOwn(input,"autoApply")){
        if(input.worldId!==worldId||typeof input.autoApply!=="boolean")fail("CREATION_POLICY_WORLD_CHANGED");
        const descriptor=await deps.descriptor(worldId);
        if(descriptor?.baseId!=="creation-sandbox"||await deps.selection()!==worldId)fail("CREATION_WORLD_UNAVAILABLE");
        write(file("policy",worldId),{worldId,autoApply:input.autoApply,updatedAt:now()});
      }
      return policyFor(worldId);
    },
    async capture(owner:number,session:CaptureSession,selection?:CreationTargetSelection) {
      contextKey({...session,sessionId:session.sessionId??"new-draft",turnId:"capture"});
      if(selection!==undefined&&selection!==null&&(!selection||Object.keys(selection).sort().join(',')!=='entityId,worldId'||!id(selection.worldId)||!id(selection.entityId)))fail('CREATION_SELECTION_INVALID');
      const generation=(captureEpochs.get(owner)??0)+1;captureEpochs.set(owner,generation);
      const instance=deps.instance(),selected=await deps.selection();
      if(!instance||instance.worldId!==selected)return {captureId:null,target:null,reason:"CREATION_WORLD_UNAVAILABLE"};
      if(selection&&selection.worldId!==instance.worldId)fail('CREATION_SELECTION_WORLD_CHANGED');
      const descriptor=await deps.descriptor(instance.worldId);
      if(descriptor?.baseId!=="creation-sandbox")return {captureId:null,target:null,reason:"CREATION_BASE_UNSUPPORTED"};
      const sample=await deps.sample(instance);
      const creation=sample?.payload?.creation,target=creation?.target;
      const player=sample?.payload?.player?.position??creation?.playerPosition;
      if(descriptor?.worldId!==instance.worldId||descriptor?.buildId!==instance.buildId||sample?.baseId!=="creation-sandbox"||sample?.worldId!==instance.worldId||sample?.buildId!==instance.buildId||sample?.instanceId!==instance.instanceId||
        !vec(player)||!target||!Number.isSafeInteger(target.revision)||target.revision<0||!Number.isSafeInteger(descriptor.sourceRevision)||descriptor.sourceRevision<0||
        typeof sample.sampledAt!=="string"||!Number.isFinite(Date.parse(sample.sampledAt))||
        typeof descriptor.manifestHash!=="string"||!/^[a-f0-9]{64}$/.test(descriptor.manifestHash)||
        !["ground","entity","boundary","none"].includes(target.surface)||
        (target.surface!=="none"&&(!vec(target.position)||!vec(target.normal)))||
        (target.entityId!==null&&(!id(target.entityId)||target.surface!=="entity"))||(target.surface==="entity"&&!id(target.entityId)))fail("CREATION_OBSERVATION_INVALID");
      const capture:CreationCapture={format:"craftmine.creation-target/1",snapshotId:randomUUID(),worldId:instance.worldId,buildId:instance.buildId,instanceId:instance.instanceId,
        sourceRevision:descriptor.sourceRevision,manifestHash:descriptor.manifestHash,sampledAt:sample.sampledAt,capturedAt:now(),
        entities:Array.isArray(creation.entities)?structuredClone(creation.entities):undefined,playerPosition:[...player] as Vector,target:{entityId:target.entityId,position:target.surface==="none"?null:[...target.position] as Vector,
          normal:target.surface==="none"?null:[...target.normal] as Vector,surface:target.surface,revision:target.revision},source:'ray',autoApply:false};
      await assertFormal(capture);
      const recent=recentCreationResults(capture.worldId,await deps.journal?.(capture),capture.entities);
      await assertFormal(capture);
      if(captureEpochs.get(owner)!==generation)fail('CREATION_CAPTURE_SUPERSEDED');
      const selectionFile=file('selection',JSON.stringify([session.projectId,session.sessionId??'new-draft',capture.worldId]));
      const saved=selection===undefined?read(selectionFile):selection;
      const choice=saved?.worldId===capture.worldId&&id(saved?.entityId)?saved:null;
      let reason:string|undefined;
      if(choice){
        const result=recent.find(item=>item.entityId===choice.entityId);
        if(selection&&(!result||!result.available))fail(result?.reason??'CREATION_RECENT_UNAVAILABLE');
        capture.source='recent';
        if(result?.available){
          const entity=capture.entities!.find(item=>item.id===choice.entityId)!;
          // An explicit object selection has an observed origin, not a ray hit.
          // The normal is only an object-up convention; placement must require ray source.
          capture.target={entityId:entity.id,position:[...entity.position] as Vector,normal:[0,1,0],surface:'entity',revision:target.revision};
        }else{reason=result?.reason??'CREATION_RECENT_UNAVAILABLE';capture.target={entityId:null,position:null,normal:null,surface:'none',revision:target.revision};}
      }
      if(selection!==undefined)write(selectionFile,selection);
      for(const [key,value] of pending)if(now()-value.capture.capturedAt>300000)pending.delete(key);
      if(pending.size>=64)pending.delete(pending.keys().next().value!);
      pending.set(capture.snapshotId,{owner,session:{...session},capture});
      return {captureId:capture.snapshotId,worldId:capture.worldId,buildId:capture.buildId,instanceId:capture.instanceId,
        sourceRevision:capture.sourceRevision,manifestHash:capture.manifestHash,sampledAt:capture.sampledAt,source:capture.source,recent,reason,
        target:capture.target.surface==="none"?null:creationTargetDisplay(capture.target,creation.entities)};
    },
    async validate(owner:number,value:unknown,session:CaptureSession):Promise<CreationCapture|null> {
      if(value===undefined)return null;
      if(!value||typeof value!=="object"||Object.keys(value).length!==1)fail("CREATION_REQUEST_CONTEXT_INVALID");
      const ref=(value as any).creationTarget;
      if(!ref||Object.keys(ref).length!==1||typeof ref.captureId!=="string")fail("CREATION_REQUEST_CONTEXT_INVALID");
      const item=pending.get(ref.captureId);
      if(!item||item.owner!==owner||now()-item.capture.capturedAt>300000||item.bound)fail("CREATION_TARGET_EXPIRED");
      if((item.session.sessionId!==null&&item.session.sessionId!==session.sessionId)||item.session.projectId!==session.projectId)fail("CREATION_SESSION_CHANGED");
      await assertFormal(item.capture);
      // The first send materializes a new chat. Claim its host-resolved session
      // once, without allowing a previously existing session capture to move.
      if(item.session.sessionId===null){
        item.session.sessionId=session.sessionId;
        if(item.capture.source==='recent'&&item.capture.target.entityId)write(file('selection',JSON.stringify([session.projectId,session.sessionId,item.capture.worldId])),{worldId:item.capture.worldId,entityId:item.capture.target.entityId});
      }
      if(item.session.sessionId!==session.sessionId)fail("CREATION_SESSION_CHANGED");
      return structuredClone(item.capture);
    },
    async bind(owner:number,capture:CreationCapture|null,context:Context,worldId:string,requestText?:string|DirectCreationIntent) {
      if(!capture)return null;
      const key=contextKey(context),item=pending.get(capture.snapshotId);
      if(!item||item.owner!==owner||item.bound||capture.worldId!==worldId)fail("CREATION_TARGET_STALE");
      if(item.session.sessionId!==context.sessionId||item.session.projectId!==context.projectId)fail("CREATION_SESSION_CHANGED");
      await assertFormal(item.capture);
      if(item.bound||now()-item.capture.capturedAt>300000)fail("CREATION_TARGET_EXPIRED");
      const frozen={...structuredClone(item.capture),autoApply:(requestText===undefined||typeof requestText==="string")&&policyFor(worldId).autoApply,creationRequirements:freezeCreationRequirements(item.capture,requestText??"")};
      write(file("turns",key),{context,capture:frozen});item.bound=key;return structuredClone(frozen);
    },
    bound(context:Context,worldId:string):CreationCapture|null {
      const record=read(file("turns",contextKey(context)));
      if(!record)return null;
      if(contextKey(record.context)!==contextKey(context)||record.capture?.worldId!==worldId||record.capture?.format!=="craftmine.creation-target/1")fail("CREATION_CONTEXT_INVALID");
      return {...structuredClone(record.capture),autoApply:record.capture.autoApply===true&&policyFor(worldId).autoApply};
    },
    recordSourceMigration(context:Context,capture:CreationCapture,advance:CreationMigrationAdvance){
      const name=file("turns",contextKey(context)),record=read(name);
      if(!record||contextKey(record.context)!==contextKey(context)||record.capture?.snapshotId!==capture.snapshotId||record.capture.worldId!==capture.worldId||advance.format!=="craftmine.creation-migration-advance/1"||advance.formalBuildId!==capture.buildId||advance.formalSourceRevision!==capture.sourceRevision||advance.formalManifestHash!==capture.manifestHash||!Number.isSafeInteger(advance.revision)||!/^[a-f0-9]{64}$/.test(advance.manifestHash))fail("CREATION_MIGRATION_CONTEXT_INVALID");
      write(name,{...record,capture:{...record.capture,sourceMigration:structuredClone(advance)}});
    },
    policyFor,
    revokeOwner(owner:number){captureEpochs.set(owner,(captureEpochs.get(owner)??0)+1);for(const [key,item]of pending)if(item.owner===owner&&!item.bound)pending.delete(key);},
  };
}
