import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {DIRECT_CHECK_STAGES,validateDirectLibraryRequest} from '../../src/components/craftmine/assets/direct-library-contract';
import type {DirectLibraryRequest,DirectLibraryInspection,DirectLibraryOperation} from '../../src/components/craftmine/assets/direct-library-contract';

type Data=Record<string,any>;
type Target={buildId:string;instanceId:string};
type Stored={format:'craftmine.direct-library/1';request:Extract<DirectLibraryRequest,{action:'start'}>;operation:DirectLibraryOperation;target:Target;source:{revision:number;manifestHash:string};startedAt?:number;cancelRequested?:boolean;restarted?:boolean};
type Starting={request:Stored['request'];startedAt:number;cancelRequested:boolean;ownsSlot:boolean;promise:Promise<Stored>;record?:Stored};
type Dependencies={directory:string;domain:(method:string,args:Data)=>Promise<any>;
  prepare?:(worldId:string)=>Promise<void>;
  captureTarget:(worldId:string)=>Promise<Target>;assertTarget:(worldId:string,target:Target)=>Promise<void>;
  applyVerified:(worldId:string,candidateId:string,target:Target,authorize:()=>Promise<void>)=>Promise<Data>};
const terminal=new Set(['applied','cancelled','failed']);
const codeOf=(error:any)=>/^[A-Z][A-Z0-9_]{0,100}$/.test(error?.code??error?.errorCode??error?.message??'')?String(error.code??error.errorCode??error.message):'DIRECT_LIBRARY_OPERATION_FAILED';
const messages:Record<string,string>={DIRECT_LIBRARY_SOURCE_CHANGED:'世界草稿已改变，请检查保留的草稿后重新选择素材。',GODOT_WORLD_CHANGED:'当前世界已切换，原世界和草稿已保留。',CREATION_TARGET_STALE:'世界运行状态已改变，请重新打开素材操作。',DIRECT_LIBRARY_CANCELLED:'已取消；已经生成的草稿仍然保留。',DIRECT_LIBRARY_OPERATION_FAILED:'操作未完成，原世界和已有草稿仍然保留。',DIRECT_LIBRARY_CHECK_FAILED:'检查未通过，原世界保持不变，草稿已保留。',DIRECT_LIBRARY_INTERRUPTED:'应用关闭时操作尚未完成，可检查保留结果。'};

/** Explicit player installation uses the existing native installer and candidate
 * transaction. No Composer, agent, credentials or arbitrary source are involved. */
export function createDirectLibraryService(deps:Dependencies){
  if(!path.isAbsolute(deps.directory))throw Error('DIRECT_LIBRARY_DIRECTORY_REQUIRED');
  const records=new Map<string,Stored>(),loads=new Map<string,Promise<Stored>>(),writes=new Map<string,Promise<void>>(),running=new Map<string,Promise<unknown>>();
  const starting=new Map<string,Starting>();
  const inspections=new Map<string,Promise<DirectLibraryInspection & {source?:Stored['source']}>>(),reconciliations=new Map<string,Promise<void>>();
  let stopping=false;
  const key=(worldId:string,operationId:string)=>createHash('sha256').update(JSON.stringify([worldId,operationId])).digest('hex');
  const output=(r:Stored)=>structuredClone(r.operation);
  const packageCall=(method:string,args:Data)=>deps.domain('package.request',{method,args});
  async function persist(r:Stored){
    r.operation.updatedAt=Date.now();const id=key(r.operation.worldId,r.operation.operationId),bytes=JSON.stringify(r);
    const previous=writes.get(id)??Promise.resolve();const pending=previous.catch(()=>undefined).then(async()=>{
      await fs.mkdir(deps.directory,{recursive:true});const target=path.join(deps.directory,id+'.json'),tmp=target+'.'+randomUUID()+'.tmp';
      const fd=await fs.open(tmp,'wx');try{await fd.writeFile(bytes);await fd.sync();}finally{await fd.close();}await fs.rename(tmp,target);
    });writes.set(id,pending);await pending;
  }
  async function load(worldId:string,operationId:string):Promise<Stored>{
    const id=key(worldId,operationId);if(records.has(id))return records.get(id)!;if(loads.has(id))return loads.get(id)!;
    const pending=(async()=>{let text:string;try{text=await fs.readFile(path.join(deps.directory,id+'.json'),'utf8');}catch(error:any){if(error.code==='ENOENT')throw Error('DIRECT_LIBRARY_OPERATION_NOT_FOUND');throw error;}const r=JSON.parse(text) as Stored;
      if(r.format!=='craftmine.direct-library/1'||r.operation.worldId!==worldId||r.operation.operationId!==operationId)throw Error('DIRECT_LIBRARY_OPERATION_CORRUPT');
      validateDirectLibraryRequest(r.request);r.restarted=true;
      if(['preparing','checking','applying'].includes(r.operation.status)){r.operation.status='interrupted';r.operation.stage='interrupted';r.operation.error={code:'DIRECT_LIBRARY_INTERRUPTED',message:messages.DIRECT_LIBRARY_INTERRUPTED};}
      records.set(id,r);await persist(r);return r;
    })().finally(()=>loads.delete(id));loads.set(id,pending);return pending;
  }
  function fail(r:Stored,error:unknown){const code=codeOf(error);r.operation.status=r.cancelRequested?'cancelled':'failed';r.operation.stage=r.operation.status;r.operation.error={code,message:messages[code]??messages.DIRECT_LIBRARY_OPERATION_FAILED};}
  async function assertActive(r:Stored){if(stopping||r.cancelRequested)throw Error('DIRECT_LIBRARY_CANCELLED');await deps.assertTarget(r.operation.worldId,r.target);if(stopping||r.cancelRequested)throw Error('DIRECT_LIBRARY_CANCELLED');}
  async function inspectOnce(worldId:string,ref:Data):Promise<DirectLibraryInspection & {source?:Stored['source']}>{
    try{return await packageCall('directInspect',{worldId,ref});}
    catch(error){const code=codeOf(error);if(['SOURCE_LIBRARY_NOT_SOURCE_PACKAGE','WORLD_TEMPLATE_REQUIRES_NEW_WORLD','DIRECT_LIBRARY_SINGLE_SCENE_REQUIRED'].includes(code))return {eligible:false,reason:code,compatibility:'unchecked',positionSupported:false};throw error;}
  }
  function inspect(worldId:string,ref:Data){
    const id=JSON.stringify([worldId,ref.assetId,ref.version,ref.contentHash]);
    if(inspections.has(id))return inspections.get(id)!;
    const task=inspectOnce(worldId,ref).finally(()=>inspections.delete(id));inspections.set(id,task);return task;
  }
  function reconcile(r:Stored){
    const id=key(r.operation.worldId,r.operation.operationId);
    if(reconciliations.has(id))return reconciliations.get(id)!;
    const task=reconcileOnce(r).finally(()=>reconciliations.delete(id));reconciliations.set(id,task);return task;
  }
  async function reconcileOnce(r:Stored){
    const state=await packageCall('directStatus',{worldId:r.operation.worldId,operationId:r.operation.operationId});
    if(state.status==='unknown')return;
    r.operation.draftRetained=state.draftRetained===true;
    r.operation.instanceIds=state.instanceIds??[];
    if(state.jobId)r.operation.jobId=state.jobId;
    if(state.candidateId)r.operation.candidateId=state.candidateId;
    if(DIRECT_CHECK_STAGES.includes(state.checkProgress?.stage)&&Number.isInteger(state.checkProgress.percent)&&state.checkProgress.percent>=0&&state.checkProgress.percent<=100)r.operation.checkProgress={stage:state.checkProgress.stage,percent:state.checkProgress.percent};
    if(r.startedAt&&Number.isSafeInteger(state.checkFinishedAt)&&state.checkFinishedAt>=r.startedAt)r.operation.timings={...r.operation.timings,preparationMs:state.checkFinishedAt-r.startedAt};
    // Domain adoption evidence wins over an acknowledgement lost at commit.
    if(state.status==='applied'){r.operation.status='applied';r.operation.stage='applied';delete r.operation.error;return;}
    if(r.cancelRequested){
      if(state.jobId&&!['ready','passed','failed','cancelled','interrupted','historical'].includes(state.status))await deps.domain('godotBuild.cancel',{worldId:r.operation.worldId,jobId:state.jobId});
      r.operation.status='cancelled';r.operation.stage='cancelled';return;
    }
    if(terminal.has(r.operation.status))return;
    if(state.status==='ready'){
      // Finalize the install turn through its existing owner before adoption.
      await deps.domain('package.sourceJob',{worldId:r.operation.worldId,jobId:state.jobId});
      if(r.cancelRequested){r.operation.status='cancelled';r.operation.stage='cancelled';return;}
      r.operation.status='ready';r.operation.stage='ready';delete r.operation.error;
    }else if(['failed','blocked','cancelled','historical'].includes(state.status))fail(r,Error('DIRECT_LIBRARY_CHECK_FAILED'));
    else if(state.status==='interrupted'){r.operation.status='interrupted';r.operation.stage='interrupted';}
    else {r.operation.status='checking';r.operation.stage='checking';}
  }
  async function prepare(r:Stored){
    try{
      await assertActive(r);
      const result=await packageCall('directInstall',{worldId:r.operation.worldId,operationId:r.operation.operationId,ref:r.operation.ref,expectedSource:r.source,...(r.operation.position?{position:r.operation.position}:{})});
      if(result.worldId!==r.operation.worldId||result.applied!==false)throw Error('DIRECT_LIBRARY_INSTALL_MISMATCH');
      r.operation.draftRetained=true;r.operation.instanceIds=result.instanceIds??[];r.operation.jobId=result.job?.id??result.job?.jobId;
      r.operation.status=r.cancelRequested?'cancelled':'checking';r.operation.stage=r.operation.status;
      await reconcile(r);
    }catch(error){
      // The installer persists its intent before writing source. Recover that
      // exact intent after a lost reply instead of performing a second install.
      try{await reconcile(r);if(!r.operation.jobId&&!['ready','applied','cancelled'].includes(r.operation.status))fail(r,error);}catch{fail(r,error);}
    }finally{await persist(r);}
  }
  async function apply(r:Stored){
    const requestedAt=performance.now();
    let appliedStartedAt:number|undefined;
    try{
      await deps.prepare?.(r.operation.worldId);
      await reconcile(r);if(r.operation.status==='applied')return output(r);
      if(r.operation.status!=='ready'||!r.operation.candidateId)throw Error('DIRECT_LIBRARY_CHECK_REQUIRED');
      if(r.restarted){const target=await deps.captureTarget(r.operation.worldId);if(target.buildId!==r.target.buildId)throw Error('CREATION_TARGET_STALE');r.target=target;r.restarted=false;}
      const authorize=async()=>{await assertActive(r);const state=await packageCall('directStatus',{worldId:r.operation.worldId,operationId:r.operation.operationId});if(state.status!=='ready'||state.candidateId!==r.operation.candidateId)throw Error('DIRECT_LIBRARY_SOURCE_CHANGED');await assertActive(r);};
      // configurationRequired concerns another new installation. Adoption uses
      // this already materialized operation's exact check/source evidence.
      await authorize();const info=await inspect(r.operation.worldId,r.operation.ref);if(!info.eligible)throw Error(info.reason??'DIRECT_LIBRARY_UNSUPPORTED');await authorize();
      r.operation.status='applying';r.operation.stage='applying';await persist(r);
      appliedStartedAt=requestedAt;
      const result=await deps.applyVerified(r.operation.worldId,r.operation.candidateId,r.target,authorize);
      if(result.status!=='applied'||result.worldId!==r.operation.worldId||result.candidateId!==r.operation.candidateId)throw Error('DIRECT_LIBRARY_APPLY_UNCERTAIN');
      r.operation.status='applied';r.operation.stage='applied';delete r.operation.error;
    }catch(error){try{await reconcile(r);}catch{/* Keep original failure; never invent adoption. */}if(r.operation.status!=='applied')fail(r,error);}
    finally{if(appliedStartedAt!==undefined&&r.operation.status==='applied')r.operation.timings={...r.operation.timings,applyMs:Math.round(performance.now()-appliedStartedAt)};await persist(r);}return output(r);
  }
  async function initialize(input:Stored['request'],pending:Starting):Promise<Stored>{
    const id=key(input.worldId,input.operationId);
    let r:Stored|undefined;try{r=await load(input.worldId,input.operationId);}catch(error:any){if(error.message!=='DIRECT_LIBRARY_OPERATION_NOT_FOUND')throw error;}
    if(r){if(!isDeepStrictEqual(r.request,input))throw Error('DIRECT_LIBRARY_OPERATION_CONFLICT');pending.record=r;
      if(pending.cancelRequested)r.cancelRequested=true;
      if(!running.has(id)){try{await reconcile(r);}catch(error){fail(r,error);}await persist(r);}return r;
    }
    if(stopping||!pending.ownsSlot||running.size)throw Error('WORLD_BUSY');
    await deps.prepare?.(input.worldId);
    const info=await inspect(input.worldId,input.ref);if(!info.eligible||info.configurationRequired||!info.source)throw Error(info.reason??'DIRECT_LIBRARY_UNSUPPORTED');
    const target=await deps.captureTarget(input.worldId);await deps.assertTarget(input.worldId,target);
    const now=Date.now();r={format:'craftmine.direct-library/1',request:input,target,source:info.source,startedAt:pending.startedAt,cancelRequested:pending.cancelRequested,operation:{operationId:input.operationId,worldId:input.worldId,ref:input.ref,...(input.position?{position:input.position}:{}),status:pending.cancelRequested?'cancelled':'preparing',stage:pending.cancelRequested?'cancelled':'preparing',instanceIds:[],draftRetained:false,modelCalls:0,createdAt:now,updatedAt:now}};
    pending.record=r;records.set(id,r);await persist(r);
    if(pending.cancelRequested){r.cancelRequested=true;r.operation.status='cancelled';r.operation.stage='cancelled';await persist(r);return r;}
    const task=prepare(r).catch(()=>undefined).finally(()=>{if(running.get(id)===task)running.delete(id);});running.set(id,task);return r;
  }
  async function handle(value:unknown):Promise<DirectLibraryInspection|DirectLibraryOperation>{
      const input=validateDirectLibraryRequest(value);
      if(input.action==='inspect'){const {source,...publicResult}=await inspect(input.worldId,input.ref);return publicResult;}
      const id=key(input.worldId,input.operationId);
      if(input.action==='start'){
        let pending=starting.get(id);
        if(pending){if(!isDeepStrictEqual(pending.request,input))throw Error('DIRECT_LIBRARY_OPERATION_CONFLICT');return output(await pending.promise);}
        // Register before even the first disk read. A remounted page may poll
        // or cancel immediately after sending start, before its file exists.
        pending={request:input,startedAt:Date.now(),cancelRequested:false,ownsSlot:starting.size===0&&running.size===0,promise:Promise.resolve(null as unknown as Stored)};
        starting.set(id,pending);
        pending.promise=Promise.resolve().then(()=>initialize(input,pending!)).finally(()=>starting.delete(id));
        return output(await pending.promise);
      }
      const pending=starting.get(id);
      if(pending&&input.action==='cancel'){pending.cancelRequested=true;if(pending.record)pending.record.cancelRequested=true;}
      const r=pending?await pending.promise:await load(input.worldId,input.operationId);
      if(input.action==='cancel'){
        if(r.operation.status==='applied')return output(r);
        r.cancelRequested=true;r.operation.status='cancelled';r.operation.stage='cancelled';await persist(r);
        if(r.operation.jobId)await deps.domain('godotBuild.cancel',{worldId:r.operation.worldId,jobId:r.operation.jobId}).catch(()=>undefined);
        try{await reconcile(r);}catch{/* Durable cancellation fence remains authoritative. */}await persist(r);return output(r);
      }
      if(input.action==='apply'){
        if(running.has(id)){await running.get(id);return output(r);}
        if(stopping||starting.size||running.size)throw Error('WORLD_BUSY');
        const task=apply(r).finally(()=>running.delete(id));running.set(id,task);return task;
      }
      if(!running.has(id)){try{await reconcile(r);}catch(error){fail(r,error);}await persist(r);}return output(r);
  }
  return {
    isBusy:()=>starting.size>0||running.size>0,
    async handle(value:unknown):Promise<DirectLibraryInspection|DirectLibraryOperation>{
      try{return await handle(value);}catch(error:any){
        // Filesystem/transport messages may contain profile paths. The public
        // product boundary returns only a stable bounded code, without cause.
        const code=codeOf(error);
        throw Object.assign(Error(code),{code,stack:code});
      }
    },
    async stop(){stopping=true;for(const pending of starting.values()){pending.cancelRequested=true;if(pending.record)pending.record.cancelRequested=true;}await Promise.allSettled([...starting.values()].map(pending=>pending.promise));for(const r of records.values())if(['preparing','checking','applying'].includes(r.operation.status)){r.cancelRequested=true;await persist(r);if(r.operation.jobId)await deps.domain('godotBuild.cancel',{worldId:r.operation.worldId,jobId:r.operation.jobId}).catch(()=>undefined);}await Promise.allSettled([...running.values()]);await Promise.allSettled([...inspections.values(),...reconciliations.values()]);await Promise.allSettled([...writes.values()]);},
  };
}
