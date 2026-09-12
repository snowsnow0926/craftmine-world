import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {planCreationGroundUpgrade,verifyCreationGroundUpgrade} from './creation-ground-upgrade.ts';
type Data=Record<string,any>;
type Instance={worldId:string;buildId:string;instanceId:string};
type Dependencies={domain:(method:string,args:Data)=>Promise<any>;selection:()=>Promise<string|null>;instance:()=>Instance|null;resourcesRoot:string;
 applyVerified:(worldId:string,candidateId:string,expected:{buildId:string;instanceId:string},authorize:()=>Promise<void>)=>Promise<any>;
 applySavedVerified?:(worldId:string,candidateId:string,expected:{buildId:string;revision:number;snapshot:unknown},authorize:()=>Promise<void>)=>Promise<any>;
 sourceUpgrade?:{plan:typeof planCreationGroundUpgrade;branchPrefix:string;projectId:string;description:string};
 changed?:(worldId:string,status:Data)=>void;shouldYield?:()=>boolean;pause?:(ms:number)=>Promise<void>;deadlineMs?:number};
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
/** Lifecycle reconciliation (close/state) and reopening the current world are
 * emitted during mount and are not new player work. Only real writes/switches
 * preempt automatic maintenance. */
export function interruptsCreationGroundMaintenance(channel:string,payload:Data,currentWorldId:string|null):boolean{
 if(channel==='world.open'||channel==='world.switch')return typeof payload?.id==='string'&&payload.id!==currentWorldId;
 return ['world.create','world.copy','godot.exportWindows','godot.candidatePreview','godot.candidateApply'].includes(channel);
}
export function creationGroundCheckFailure(job:Data):string{
 const precise=[job.errorCode,job.reason,job.error,job.blockedReason,job.interruptReason,job.output?.reason,job.output?.error,job.output?.check?.error]
  .find(value=>typeof value==='string'&&value.trim());
 if(precise)return precise.slice(0,2000);
 const failed=job.output?.check?.assertions?.filter((value:Data)=>value.passed===false).map((value:Data)=>[value.id,value.detail].filter(Boolean).join(': '));
 return Array.isArray(failed)&&failed.length?'GROUND_UPGRADE_CHECK_FAILED: '+failed.join('; ').slice(0,1800):'GROUND_UPGRADE_CHECK_FAILED';
}
/** Host-only, model-free retained-world maintenance. Source changes live on an
 * isolated branch rooted at formal content, never on main or its draft. Core
 * owns Git writes/build receipts; the existing coordinator owns progress
 * checkpointing, trial load, apply CAS and rollback. No direct profile writes. */
export function createCreationGroundMaintenance(deps:Dependencies){
 const running=new Map<string,Promise<Data>>(),states=new Map<string,Data>();
 type Control={cancelled:boolean;context?:Data;jobId?:string;checkComplete?:boolean;cancelPromise?:Promise<void>};
 const controls=new Map<string,Control>();
 const ownedChecks=new Map<string,{projectId:string;sessionId:string;turnId:string}>();
 const {domain}=deps,pause=deps.pause??(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
 const planner=deps.sourceUpgrade?.plan??planCreationGroundUpgrade;
 const publish=(worldId:string,value:Data)=>{const state={worldId,...value};states.set(worldId,state);deps.changed?.(worldId,state);return state;};
 const cancelJob=async(worldId:string,control:Control)=>{
  if(!control.jobId||control.checkComplete)return;
  control.cancelPromise??=domain('godotBuild.cancel',{worldId,jobId:control.jobId,...(control.context?{context:control.context}:{})}).then(()=>undefined);
  await control.cancelPromise;
 };
 async function maintain(worldId:string,control:Control):Promise<Data>{
  if(await deps.selection()!==worldId)throw Error('GROUND_UPGRADE_SELECTION_CHANGED');
  const instance=deps.instance();
  if(instance?instance.worldId!==worldId:!deps.applySavedVerified)throw Error('GROUND_UPGRADE_RUNTIME_REQUIRED');
  const descriptor=await domain('godotRuntime.describe',{worldId});
  if(descriptor?.baseId!=='creation-sandbox')return publish(worldId,{status:'skipped',reason:'different-base'});
  if(control.cancelled)throw Error('GROUND_UPGRADE_CANCELLED');
  let content=await domain('content.status',{worldId});
  if(content.backend!=='git'){await domain('content.migrate.apply',{worldId});content=await domain('content.status',{worldId});}
  const formal=await domain('godotRuntime.exportSource',{worldId});
  if(formal.worldId!==worldId||formal.buildId!==(instance?.buildId??descriptor?.buildId)||!Array.isArray(formal.files)||!/^[a-f0-9]{40,64}$/.test(formal.contentOid??''))throw Error('GROUND_UPGRADE_FORMAL_CHANGED');
  const saved=instance?null:await domain('world.read',{id:worldId});
  if(saved&&(saved.id!==worldId||saved.world?.build?.id!==formal.buildId||saved.revision!==descriptor.revision||!isDeepStrictEqual(saved.world.snapshot,descriptor.snapshot)))throw Error('GROUND_UPGRADE_SAVED_PROGRESS_CHANGED');
  // The planner compares the isolated branch baseline with formal, NOT main.
  // A player's unadopted main draft must remain untouched and need not block.
  const plan=planner({baseId:formal.baseId,formalFiles:formal.files,draftFiles:formal.files,resourcesRoot:deps.resourcesRoot});
  if(plan.status==='skipped')return publish(worldId,plan);
  const branchId=(deps.sourceUpgrade?.branchPrefix??'host-ground-')+hash(JSON.stringify([plan.id,worldId,formal.contentOid])).slice(0,32);
  const guard=async()=>{
   if(control.cancelled)throw Error('GROUND_UPGRADE_CANCELLED');
   if(deps.shouldYield?.()){control.cancelled=true;throw Error('GROUND_UPGRADE_PLAYER_WORK_STARTED');}
   if(await deps.selection()!==worldId)throw Error('GROUND_UPGRADE_SELECTION_CHANGED');
   const live=deps.instance(),current=await domain('godotRuntime.exportSource',{worldId});
   if((instance?(!live||live.worldId!==worldId||live.buildId!==instance.buildId||live.instanceId!==instance.instanceId):!!live)||current.buildId!==formal.buildId||current.contentOid!==formal.contentOid)throw Error('GROUND_UPGRADE_FORMAL_CHANGED');
   if(saved){const currentSaved=await domain('world.read',{id:worldId});if(currentSaved.revision!==saved.revision||!isDeepStrictEqual(currentSaved.world,saved.world))throw Error('GROUND_UPGRADE_SAVED_PROGRESS_CHANGED');}
   const fresh=await domain('content.status',{worldId});
   if(fresh.repoId!==content.repoId||fresh.headOid!==content.headOid)throw Error('GROUND_UPGRADE_DRAFT_CHANGED');
  };
  await guard();publish(worldId,{status:'upgrading',stage:'source',branchId});
  // A stable branch identity supports retry after an interrupted/lost reply.
  // Existing branch content is verified below before it can be reused.
  try{await domain('content.branch.create',{worldId,branchId,fromRev:formal.contentOid,requestId:plan.id,taskId:deps.sourceUpgrade?.projectId??'host-ground-maintenance',title:deps.sourceUpgrade?.description??'Repair stock ground lighting while retaining player drafts'});}
  catch(error){const branches=await domain('content.branch.list',{worldId});if(!(branches.branches??[]).some((b:Data)=>b.branchId===branchId||b.name===branchId||b.name==='refs/heads/'+branchId))throw error;}
  const id=randomUUID(),context={projectId:deps.sourceUpgrade?.projectId??'craftmine-ground-maintenance',sessionId:(deps.sourceUpgrade?.branchPrefix??'ground-')+id,turnId:id};
  await domain('turn.begin',{context,selectedWorld:worldId,request:{id,text:deps.sourceUpgrade?.description??'Repair the released stock ground lighting on a separate branch, preserving all player content, drafts, history and progress.'}});
  control.context=context;
  let completed=false;
  const index=async()=>{
   const files:Data[]=[],first:any={};let offset:number|null=0;
   do{const page=await domain('godotProject.index',{context,worldId,branchId,offset,limit:32});
    if(!Object.keys(first).length)Object.assign(first,page);
    if(page.worldId!==worldId||page.branchId!==branchId||page.revision!==first.revision||page.manifestHash!==first.manifestHash||!Array.isArray(page.files))throw Error('GROUND_UPGRADE_INDEX_CHANGED');
    files.push(...page.files);const next=page.nextOffset;if(next!=null&&(!Number.isSafeInteger(next)||next<=offset||next>512))throw Error('GROUND_UPGRADE_INDEX_INVALID');offset=next;
   }while(offset!=null);
   return {...first,files};
  };
  try{
   let project=await index();let alreadyPatched=false;
   try{verifyCreationGroundUpgrade(plan,project.files);alreadyPatched=true;}catch{}
   if(!alreadyPatched){
    const branchPlan=planner({baseId:formal.baseId,formalFiles:formal.files,draftFiles:project.files,resourcesRoot:deps.resourcesRoot});
    if(branchPlan.status!=='planned')throw Error('GROUND_UPGRADE_BRANCH_CONFLICT');
    if(project.content?.branchId!==branchId||project.content?.repoId!==content.repoId)throw Error('GROUND_UPGRADE_BRANCH_INVALID');
    await guard();const operationId='ground-'+hash(JSON.stringify([branchId,project.content.contentOid])).slice(0,40);
    try{await domain('godotProject.patch',{context,worldId,toolCallId:operationId,revision:project.revision,manifestHash:project.manifestHash,operations:plan.operations,
     operation:{operationId,worldId,repoId:content.repoId,branchId,expectedHeadOid:project.content.contentOid,expectedAppliedOid:content.appliedOid??null,expectedProgressRevision:null}});}
    catch(error){const after=await index();try{verifyCreationGroundUpgrade(plan,after.files);}catch{throw error;}}
    project=await index();
   }
   verifyCreationGroundUpgrade(plan,project.files);await guard();
   const contentOid=project.content?.contentOid;if(!/^[a-f0-9]{40,64}$/.test(contentOid??''))throw Error('GROUND_UPGRADE_BRANCH_INVALID');
   const candidates=await domain('godotCandidate.list',{worldId});
   let candidateId=(candidates.items??[]).find((c:Data)=>c.status==='ready'&&c.manifestHash===project.manifestHash&&c.content?.branchId===branchId&&c.content?.contentOid===contentOid)?.candidateId;
   let jobId:string|undefined;
   if(!candidateId){
    await guard();
    const started=await domain('godotBuild.start',{context,worldId,branchId,toolCallId:'ground-check-'+id,revision:project.revision,manifestHash:project.manifestHash,mode:'check'});
    jobId=started.jobId;control.jobId=jobId;if(!jobId)throw Error('GROUND_UPGRADE_CHECK_NOT_STARTED');
    ownedChecks.set(jobId,{...context});
    if(ownedChecks.size>128)ownedChecks.delete(ownedChecks.keys().next().value!);
    const deadline=Date.now()+(deps.deadlineMs??900000);
    while(true){await guard();const job=await domain('godotBuild.read',{worldId,jobId});
     publish(worldId,{status:'upgrading',stage:job.stage??'check',branchId,jobId,progress:job.progress});
     if(job.status==='passed'){control.checkComplete=true;candidateId=job.candidateId;break;}
     if(['failed','cancelled','blocked','interrupted'].includes(job.status)){control.checkComplete=true;throw Error(creationGroundCheckFailure(job));}
     if(Date.now()>deadline)throw Error('GROUND_UPGRADE_CHECK_TIMEOUT');await pause(500);
    }
   }
   if(typeof candidateId!=='string')throw Error('GROUND_UPGRADE_CANDIDATE_REQUIRED');
   const raw=await domain('godotCandidate.read',{worldId,candidateId}),candidate=raw.candidate??raw;
   if(candidate.content?.repoId!==content.repoId||candidate.content?.branchId!==branchId||candidate.content?.contentOid!==contentOid||candidate.manifestHash!==project.manifestHash)throw Error('GROUND_UPGRADE_CANDIDATE_MISMATCH');
   const authorize=async()=>{await guard();const fresh=await index();verifyCreationGroundUpgrade(plan,fresh.files);if(fresh.content?.contentOid!==contentOid)throw Error('GROUND_UPGRADE_BRANCH_CHANGED');};
   await authorize();publish(worldId,{status:'upgrading',stage:'apply',branchId,jobId,candidateId});
   const applied=instance?await deps.applyVerified(worldId,candidateId,{buildId:instance.buildId,instanceId:instance.instanceId},authorize)
    :await deps.applySavedVerified!(worldId,candidateId,{buildId:formal.buildId,revision:saved.revision,snapshot:saved.world.snapshot},authorize);
   if(applied?.status!=='applied')throw Error('GROUND_UPGRADE_APPLY_UNCONFIRMED');
   const after=await domain('content.status',{worldId});if(after.headOid!==content.headOid)throw Error('GROUND_UPGRADE_DRAFT_CHANGED');
   completed=true;return publish(worldId,{status:'applied',branchId,jobId,candidateId});
  }finally{
   try{if(!completed)await cancelJob(worldId,control);}
   finally{await domain('workspace.endTurn',{sessionId:context.sessionId,turnId:context.turnId,status:completed?'completed':control.cancelled?'aborted':'error'});}
  }
 }
 return {get busy(){return running.size>0;},running:(worldId:string)=>running.has(worldId),status:(worldId:string)=>states.get(worldId)??null,
  ownsCompletion(input:{jobId:string;context:Data}):boolean{const owner=ownedChecks.get(input?.jobId);return !!owner&&!!input.context&&Object.keys(input.context).length===3&&(['projectId','sessionId','turnId'] as const).every(key=>owner[key]===input.context[key]);},
  async stop(worldId:string){const control=controls.get(worldId);if(!control)return;control.cancelled=true;await Promise.allSettled([cancelJob(worldId,control),running.get(worldId)]);},
  async stopAll(){for(const control of controls.values())control.cancelled=true;await Promise.allSettled([...controls].map(([worldId,control])=>cancelJob(worldId,control)));await Promise.allSettled([...running.values()]);},
  start(worldId:string):Promise<Data>{if(!/^[a-zA-Z0-9._-]{1,128}$/.test(worldId))return Promise.reject(Error('INVALID_WORLD_ID'));const existing=running.get(worldId);if(existing)return existing;
   const control:Control={cancelled:false};controls.set(worldId,control);
   const work=maintain(worldId,control).catch(error=>{publish(worldId,{status:control.cancelled?'cancelled':'failed',reason:String(error)});throw error;}).finally(()=>{running.delete(worldId);controls.delete(worldId);});running.set(worldId,work);return work;}};
}
