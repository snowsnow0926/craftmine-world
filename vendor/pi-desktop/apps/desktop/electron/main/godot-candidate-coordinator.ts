import {createHash, randomUUID} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import type {GodotWorldViewHost} from "./godot-world-view-host";
import type {createGodotRuntimeAdapter, GodotCandidateDescriptor} from "./godot-runtime-adapter";
import {deriveAdditiveProgress} from "../../../../../../desktop/godot/shared/progress-migration.mjs";
type Data = Record<string, any>;
type Session = {worldId:string;candidateId:string;id:string;token:string;phase:"preparing"|"preview"|"applying"|"uncertain"|"committed";prepared?:Data;descriptor?:GodotCandidateDescriptor;evidence?:Data;contentOperation?:string};
const object=(value:unknown):value is Data=>!!value&&typeof value==="object"&&!Array.isArray(value);
const sha=(text:string)=>createHash("sha256").update(text,"utf8").digest("hex");
const canonical=(value:any):string=>Array.isArray(value)?`[${value.map(canonical).join(",")}]`:object(value)?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`:JSON.stringify(value);
/** Main-only candidate lifecycle. Pages choose an id, never a token, state or launch proof. */
export function createGodotCandidateCoordinator(options:{
  host:GodotWorldViewHost;adapter:ReturnType<typeof createGodotRuntimeAdapter>;
  domain:(method:string,params:Data)=>Promise<unknown>;selection:()=>Promise<string|null>;
}) {
  let active:Session|null=null, busy=false, release:(()=>void)|null=null;
  const completed=new Map<string,{worldId:string;candidateId:string;buildId:string}>();
  const completionKey=(worldId:string,candidateId:string)=>JSON.stringify([worldId,candidateId]);
  const rpc=async(method:string,args:Data):Promise<Data>=>{
    const result=await options.domain(method,args);if(!object(result))throw new Error("INVALID_GODOT_APPLICATION_RESPONSE");return result;
  };
  const identity=async(worldId:string,allowEmpty=false)=>{
    if(await options.selection()!==worldId)throw new Error("GODOT_WORLD_CHANGED");
    const current=options.host.instance;
    if(!current){if(!allowEmpty)throw new Error("GODOT_WORLD_CHANGED");return;}
    if(current.worldId!==worldId)throw new Error("GODOT_WORLD_CHANGED");
  };
  const drop=()=>{active=null;release?.();release=null;};
  const applicationMatches=(session:Session,result:Data)=>{
    if(result.id!==session.id||result.worldId!==session.worldId||result.candidateId!==session.candidateId||
       (session.prepared&&(result.inputHash!==session.prepared.inputHash||result.buildId!==session.prepared.buildId||!isDeepStrictEqual(result.input,session.prepared.input))))throw new Error("GODOT_APPLICATION_RECEIPT_MISMATCH");
    return result;
  };
  async function prepare(worldId:string,candidateId:string,revision:number,snapshot:unknown,phase:Session["phase"],first=false) {
    const candidate=await rpc("godotCandidate.read",{worldId,candidateId});
    const defaults=candidate.job?.check?.defaultsSnapshot;
    const expected=defaults ? deriveAdditiveProgress(snapshot,defaults).snapshot : snapshot;
    const session:Session={worldId,candidateId,id:randomUUID(),token:randomUUID(),phase};active=session;
    const prepared=applicationMatches(session,await rpc("godotApplication.prepare",{id:session.id,token:session.token,candidateId,worldId,revision,snapshot}));
    if(prepared.status!=="prepared"||!isDeepStrictEqual(prepared.input.snapshot,expected)||(defaults&&!isDeepStrictEqual(prepared.input.previousSnapshot,snapshot))||prepared.input.revision!==revision||!/^[a-f0-9]{64}$/.test(prepared.inputHash))throw new Error("GODOT_APPLICATION_PREPARE_MISMATCH");
    session.prepared=prepared;
    const descriptor=await options.adapter.describeCandidate(worldId,session.id,session.token);
    if(descriptor.buildId!==prepared.buildId||descriptor.applicationInputHash!==prepared.inputHash||!isDeepStrictEqual(descriptor.snapshot,expected))throw new Error("GODOT_CANDIDATE_DESCRIPTOR_MISMATCH");
    session.descriptor=descriptor;
    await options.host.stageCandidate(descriptor,{first,candidateId});
    return session;
  }
  async function confirm(session:Session) {
    const result=await options.host.candidateRequest("save"),receipt=result.runnerReceipt,instance=options.host.candidateInstance;
    if(result.status!=="confirmed"||!object(receipt)||!instance||receipt.format!=="craftmine.godot-runner-receipt/1"||receipt.worldId!==session.worldId||receipt.buildId!==instance.buildId||receipt.instanceId!==instance.instanceId||typeof receipt.snapshotText!=="string"||Buffer.byteLength(receipt.snapshotText)>1024*1024||receipt.bytes!==Buffer.byteLength(receipt.snapshotText)||receipt.snapshotSha256!==sha(receipt.snapshotText))throw new Error("GODOT_CANDIDATE_CONFIRMATION_INVALID");
    const snapshot=JSON.parse(receipt.snapshotText);
    if(!isDeepStrictEqual(snapshot,result.state)||!isDeepStrictEqual(snapshot,session.descriptor?.snapshot))throw new Error("GODOT_CANDIDATE_PROGRESS_CHANGED");
    return {format:"craftmine.godot-application/2",inputHash:session.prepared!.inputHash,launch:{passed:true,buildId:instance.buildId,instanceId:instance.instanceId,stateHash:receipt.snapshotSha256},player:null,snapshot};
  }
  async function finishApplied(session:Session,result:Data) {
    applicationMatches(session,result);
    if(result.status!=="applied"||!session.evidence||!isDeepStrictEqual(result.output,session.evidence))throw new Error("GODOT_APPLICATION_COMMIT_UNCERTAIN");
    if(session.contentOperation) {
      const content=await rpc("content.apply.confirm",{operationId:session.contentOperation,applicationId:session.id,detail:"Confirmed by the durable Godot deployment and first-load receipt."});
      if(content.state!=="committed")throw Error("CONTENT_APPLICATION_CONFIRM_UNCERTAIN");
    }
    session.phase="committed";
    const descriptor=await options.adapter.describe(session.worldId);
    if(!descriptor||descriptor.buildId!==session.prepared!.buildId||!isDeepStrictEqual(descriptor.snapshot,session.evidence.snapshot)||descriptor.revision!==session.prepared!.input.revision+1)throw new Error("GODOT_FORMAL_COMMIT_MISMATCH");
    if(options.host.candidateInstance)await options.host.promoteCandidate(descriptor);
    else if(options.host.instance?.buildId!==descriptor.buildId)throw new Error("GODOT_COMMITTED_RUNTIME_UNAVAILABLE");
    const record=await rpc("world.read",{id:session.worldId});
    if(record.id!==session.worldId||record.world?.build?.id!==descriptor.buildId||record.revision!==descriptor.revision)throw new Error("GODOT_FORMAL_RECORD_MISMATCH");
    completed.set(completionKey(session.worldId,session.candidateId),{worldId:session.worldId,candidateId:session.candidateId,buildId:descriptor.buildId});
    if(completed.size>32)completed.delete(completed.keys().next().value!);
    drop();return {status:"applied",worldId:session.worldId,candidateId:session.candidateId,record};
  }
  async function commit(session:Session,authorize?:()=>Promise<void>) {
    const status=await rpc("content.status",{worldId:session.worldId});
    await authorize?.();
    if(status.backend==="git") {
      const candidate=await rpc("godotCandidate.read",{worldId:session.worldId,candidateId:session.candidateId});
      const content=candidate.candidate?.content;
      if(!object(content)||content.repoId!==status.repoId||typeof content.contentOid!=="string"||typeof content.branchId!=="string")throw Error("GODOT_CANDIDATE_CONTENT_UNKNOWN");
      const branch=(status.branches??[]).find((item:Data)=>item.branchId===content.branchId||item.name===content.branchId||item.name===`refs/heads/${content.branchId}`);
      const context={operationId:session.id,worldId:session.worldId,repoId:content.repoId,branchId:content.branchId,
        expectedHeadOid:content.branchId==="main"?status.headOid:branch?.headOid??branch?.oid,
        expectedAppliedOid:status.appliedOid,expectedProgressRevision:session.prepared!.input.revision};
      if(context.expectedHeadOid===undefined)throw Error("CONTENT_BRANCH_NOT_FOUND");
      // Remember before the request, so a lost prepare reply remains recoverable.
      session.contentOperation=session.id;
      await rpc("content.apply.prepare",{worldId:session.worldId,context,kind:"apply",targetOid:content.contentOid,detail:"Apply the checked Godot candidate."});
      await rpc("content.apply.advance",{operationId:session.id});
    }
    await authorize?.();
    let result;
    try {result=await rpc("godotApplication.commit",{id:session.id,token:session.token,evidence:session.evidence});}
    catch {result=await rpc("godotApplication.read",{id:session.id});}
    return finishApplied(session,result);
  }
  async function recover(session:Session):Promise<Data> {
    let raw;
    try { raw=await rpc("godotApplication.read",{id:session.id}); }
    catch(error) {
      if(object(error)&&error.errorCode==="GODOT_APPLICATION_NOT_FOUND"&&!session.prepared) {
        await options.host.discardCandidate();drop();if(options.host.instance)await options.host.resume();return {status:"aborted",worldId:session.worldId};
      }
      throw error;
    }
    const result=applicationMatches(session,raw);
    if(result.status==="applied")return finishApplied(session,result);
    if(result.status==="prepared") {
      const aborted=applicationMatches(session,await rpc("godotApplication.abort",{id:session.id}));
      if(aborted.status==="applied")return finishApplied(session,aborted);
      if(!["aborted","interrupted"].includes(aborted.status))throw new Error("GODOT_APPLICATION_ABORT_UNCERTAIN");
    } else if(!["aborted","interrupted"].includes(result.status))throw new Error("GODOT_APPLICATION_STATE_UNKNOWN");
    if(session.contentOperation) {
      const operation=await rpc("content.operation.read",{worldId:session.worldId,operationId:session.contentOperation});
      if(operation.state!=="aborted")await rpc("content.apply.rollback",{operationId:session.contentOperation,reason:"Godot deployment was not committed."});
    }
    await options.host.discardCandidate();drop();if(options.host.instance)await options.host.resume();return {status:"aborted",worldId:session.worldId};
  }
  async function failed(error:unknown):Promise<Data> {
    const session=active;
    if(session) {
      try {const result=await recover(session);if(result.status==="applied")return result;}catch(recovery){session.phase="uncertain";await options.host.candidateRequest("pause").catch(()=>undefined);options.host.setCandidateVisible(false);options.host.setSurfaceVisible(false);throw new Error(`${String(error)}; application recovery pending: ${String(recovery)}`);}
    } else {release?.();release=null;if(options.host.instance)await options.host.resume().catch(()=>undefined);}
    throw error;
  }
  async function open(worldId:string,candidateId:string) {
    if(active)throw new Error("GODOT_CANDIDATE_ACTIVE");await identity(worldId);release=await options.host.holdSelectionSync();
    let checkpointPersisted=false;
    try {
      await identity(worldId);
      const instance=options.host.instance!;
      // Preview must start from the player's current progress, not the last
      // autosave. Checkpoint persists progress without adopting candidate code.
      const checkpoint=await options.host.checkpoint({fresh:true});if(checkpoint.status!=="persisted")throw new Error(checkpoint.error);
      checkpointPersisted=true;
      const formal=await options.adapter.describe(worldId);await identity(worldId);
      const current=options.host.instance;
      if(!formal||formal.worldId!==worldId||formal.buildId!==instance.buildId||checkpoint.receipt.worldId!==worldId||checkpoint.receipt.buildId!==instance.buildId||formal.revision!==checkpoint.receipt.revision||!isDeepStrictEqual(formal.snapshot,checkpoint.snapshot)||current?.buildId!==instance.buildId||current.instanceId!==instance.instanceId)throw new Error("GODOT_LATEST_PROGRESS_REQUIRED");
      const session=await prepare(worldId,candidateId,formal.revision,formal.snapshot,"preparing");
      await confirm(session);await options.host.candidateRequest("resume");session.phase="preview";
      options.host.setSurfaceVisible(true);options.host.setCandidateVisible(true);
      return {status:"preview",worldId,candidateId,buildId:session.prepared!.buildId};
    }catch(error){
      // A failed checkpoint owns restoration of its original pause intent.
      // No candidate exists yet; do not override that decision with resume().
      if(!checkpointPersisted){release?.();release=null;throw error;}
      return failed(error);
    }
  }
  async function apply(worldId:string,candidateId:string) {
    const preview=active;if(!preview||preview.phase!=="preview"||preview.worldId!==worldId||preview.candidateId!==candidateId)throw new Error("GODOT_PREVIEW_REQUIRED");
    await identity(worldId);
    try {
      // Discard all preview changes and release its prepare lock before saving formal play.
      const aborted=applicationMatches(preview,await rpc("godotApplication.abort",{id:preview.id}));
      if(aborted.status!=="aborted")throw new Error("GODOT_PREVIEW_ABORT_REQUIRED");
      await options.host.discardCandidate();active=null;
      const checkpoint=await options.host.checkpoint({fresh:true});if(checkpoint.status!=="persisted")throw new Error(checkpoint.error);
      const formal=await options.adapter.describe(worldId);if(!formal||formal.revision!==checkpoint.receipt.revision||!isDeepStrictEqual(formal.snapshot,checkpoint.snapshot))throw new Error("GODOT_LATEST_PROGRESS_REQUIRED");
      const session=await prepare(worldId,candidateId,formal.revision,formal.snapshot,"applying");
      session.evidence=await confirm(session);
      return await commit(session);
    }catch(error){return failed(error);}
  }
  /**
   * Confirm the very first native instance of a world that has no formal build
   * yet. It uses the world record itself as the prepared input, so the creation
   * flow never deadlocks on a formal world that only a commit could create.
   */
  async function firstLoadInner(worldId:string,candidateId:string) {
    if(active)throw new Error("GODOT_CANDIDATE_ACTIVE");
    await identity(worldId,true);
    if(options.host.instance?.worldId===worldId)throw new Error("GODOT_WORLD_ALREADY_RUNNING");
    let formal;
    try { formal = await options.adapter.describe(worldId); }
    catch (error) {
      if (!/GODOT_WORLD_NOT_INITIALIZED/.test(String(error))) throw error;
      const init = await rpc("godotWorld.initStatus", {worldId});
      if (init.playable !== false) throw error;
    }
    if(formal)throw new Error("GODOT_FORMAL_WORLD_EXISTS");
    const initialization = await rpc("godotWorld.initStatus", {worldId});
    if (initialization.worldId !== worldId || typeof initialization.initId !== "string" || initialization.playable !== false)
      throw Error("GODOT_WORLD_NOT_INITIALIZING");
    if (initialization.launchFailure) throw Error("GODOT_INITIAL_LOAD_RETRY_REQUIRED");
    release=await options.host.holdSelectionSync();
    try {
      const record=await rpc("world.read",{id:worldId});
      if(record.id!==worldId||!Number.isSafeInteger(record.revision)||record.revision<0||!object(record.world))throw new Error("GODOT_WORLD_RECORD_INVALID");
      const session=await prepare(worldId,candidateId,record.revision,record.world.snapshot,"applying",true);
      session.evidence=await confirm(session);
      return await commit(session);
    }catch(error){
      // prepare assigns active across an await; preserve the actual session
      // before recovery can drop it.
      const attempted = active as Session | null;
      let failure: unknown;
      try { return await failed(error); } catch (recovered) { failure = recovered; }
      if (attempted?.prepared) {
        try {
          const receipt = await rpc("godotWorld.initLaunchFailed", {worldId, initId: initialization.initId,
            candidateId, applicationId: attempted.id});
          if (receipt.worldId !== worldId || receipt.initId !== initialization.initId ||
            receipt.candidateId !== candidateId || receipt.applicationId !== attempted.id ||
            receipt.recorded !== true || typeof receipt.cleared !== "boolean") throw Error("GODOT_INIT_LAUNCH_RECEIPT_MISMATCH");
        } catch {
          // A still-uncertain application is never labelled settled, and failure
          // to persist is reported rather than silently claimed durable.
          throw Error(`${String(failure)}; GODOT_INITIAL_LOAD_FAILURE_RECORD_UNCONFIRMED`);
        }
      }
      throw failure;
    }
  }
  async function close(){if(!active)return {status:"closed"};const session=active;try{const result=await recover(session);options.host.setSurfaceVisible(true);return result;}catch(error){session.phase="uncertain";await options.host.candidateRequest("pause").catch(()=>undefined);options.host.setCandidateVisible(false);options.host.setSurfaceVisible(false);throw error;}}
  return {
    get blocking(){return busy||!!active;},
    /** Main-only checked creation completion; never exposed as a page route. */
    async autoApplyVerified(worldId:string,candidateId:string,expected:{buildId:string;instanceId:string},authorize:()=>Promise<void>) {
      if(busy||active)throw Error("GODOT_CANDIDATE_ACTIVE");
      busy=true;
      const guard=async()=>{
        await identity(worldId);
        const current=options.host.instance;
        if(current?.buildId!==expected.buildId||current.instanceId!==expected.instanceId)throw Error("CREATION_TARGET_STALE");
        await authorize();
      };
      try {
        await guard();
        release=await options.host.holdSelectionSync();
        await guard();
        await options.host.pause();
        const checkpoint=await options.host.checkpoint();
        if(checkpoint.status!=="persisted")throw Error(checkpoint.error);
        const formal=await options.adapter.describe(worldId);
        if(!formal||formal.buildId!==expected.buildId||formal.revision!==checkpoint.receipt.revision||!isDeepStrictEqual(formal.snapshot,checkpoint.snapshot))throw Error("GODOT_LATEST_PROGRESS_REQUIRED");
        await guard();
        const session=await prepare(worldId,candidateId,formal.revision,formal.snapshot,"applying");
        session.evidence=await confirm(session);
        // Consent, cancellation and source identity may change during launch.
        // Recheck immediately before entering the existing durable transaction.
        await guard();
        return await commit(session,guard);
      }catch(error){if(active||release)return failed(error);throw error;}finally{busy=false;}
    },
    /** Exact host-owned source maintenance after a retained runtime cannot
     * restore. Uses only the durable original snapshot; no page route or
     * invented checkpoint can call this entry. The normal trial/commit path
     * still proves the complete snapshot with the repaired runtime. */
    async applySavedMaintenance(worldId:string,candidateId:string,expected:{buildId:string;revision:number;snapshot:unknown},authorize:()=>Promise<void>) {
      if(busy||active)throw Error('GODOT_CANDIDATE_ACTIVE');
      busy=true;
      const guard=async()=>{
        await identity(worldId,true);
        if(options.host.instance)throw Error('GODOT_WORLD_ALREADY_RUNNING');
        const formal=await options.adapter.describe(worldId),record=await rpc('world.read',{id:worldId});
        if(!formal||formal.buildId!==expected.buildId||formal.revision!==expected.revision||!isDeepStrictEqual(formal.snapshot,expected.snapshot)
          ||record.id!==worldId||record.world?.build?.id!==expected.buildId||record.revision!==expected.revision||!isDeepStrictEqual(record.world?.snapshot,expected.snapshot))throw Error('GODOT_MAINTENANCE_SAVED_PROGRESS_CHANGED');
        await authorize();
      };
      try {
        await guard();release=await options.host.holdSelectionSync();await guard();
        const session=await prepare(worldId,candidateId,expected.revision,expected.snapshot,'applying',true);
        if(!isDeepStrictEqual(session.descriptor?.snapshot,expected.snapshot))throw Error('GODOT_MAINTENANCE_PROGRESS_CHANGED');
        session.evidence=await confirm(session);
        await guard();return await commit(session,guard);
      }catch(error){if(active||release)return failed(error);throw error;}finally{busy=false;}
    },
    async closeForDeparture(){if(busy)throw new Error("WORLD_BUSY");busy=true;try{return await close();}finally{busy=false;}},
    /** Private first-load entry for the initialization transaction; not a page route. */
    async firstLoad(worldId:string,candidateId:string) {
      if(typeof worldId!=="string"||typeof candidateId!=="string")throw new Error("INVALID_GODOT_CANDIDATE_ACTION");
      if(busy)throw new Error("WORLD_BUSY");
      busy=true;
      try{return await firstLoadInner(worldId,candidateId);}finally{busy=false;}
    },
    /** Only the native restore service can replace a missing export cache. */
    async restoreLoad(worldId:string,candidateId:string) {
      if(busy||active)throw Error("GODOT_CANDIDATE_ACTIVE");
      busy=true;
      try {
        await identity(worldId,true);
        if(options.host.instance)throw Error("GODOT_WORLD_ALREADY_RUNNING");
        const plan=await rpc("godotWorld.rebuildPlan",{worldId});
        if(plan.format!=="craftmine.godot-rebuild-plan/1"||plan.worldId!==worldId||!plan.rebuildRequired||!plan.rebuildContentOid)throw Error("GODOT_REBUILD_PLAN_REQUIRED");
        const raw=await rpc("godotCandidate.read",{worldId,candidateId});
        const content=raw.candidate?.content;
        if(content?.repoId!==plan.repoId||content?.branchId!==plan.rebuildBranchId||content?.contentOid!==plan.rebuildContentOid)throw Error("GODOT_REBUILD_CANDIDATE_MISMATCH");
        release=await options.host.holdSelectionSync();
        const record=await rpc("world.read",{id:worldId});
        if(record.id!==worldId||record.world?.build?.id!==plan.formalBuildId||record.revision!==plan.worldRevision||sha(canonical(record.world.snapshot))!==plan.snapshotHash)throw Error("GODOT_REBUILD_WORLD_CHANGED");
        const session=await prepare(worldId,candidateId,record.revision,record.world.snapshot,"applying",true);
        session.evidence=await confirm(session);
        return await commit(session);
      }catch(error){return failed(error);}finally{busy=false;}
    },
    async invoke(channel:string,payload:Data) {
      const fields=["godot.candidatePreview","godot.candidateApply","godot.candidateState"].includes(channel)?["worldId","candidateId"]:["worldId"];
      if(Object.keys(payload).some(key=>!fields.includes(key))||typeof payload.worldId!=="string"||fields.includes("candidateId")&&typeof payload.candidateId!=="string")throw new Error("INVALID_GODOT_CANDIDATE_ACTION");
      // Claim the mutex before any await: two overlapping page invokes must not
      // both pass the guard.
      if(busy)throw new Error("WORLD_BUSY");
      busy=true;
      try {
        if(fields.includes("candidateId"))await identity(payload.worldId);
        else if(await options.selection()!==payload.worldId)throw new Error("GODOT_WORLD_CHANGED");
        if(channel==="godot.candidatePreview")return await open(payload.worldId,payload.candidateId);
        if(channel==="godot.candidateApply")return await apply(payload.worldId,payload.candidateId);
        if(active&&active.worldId!==payload.worldId)throw new Error("GODOT_WORLD_CHANGED");
        if(channel==="godot.candidateState"&&!active){
          const known=completed.get(completionKey(payload.worldId,payload.candidateId));
          if(!known)return {status:"closed"};
          const record=await rpc("world.read",{id:known.worldId});
          // A later committed build supersedes this record: report closed
          // rather than a mismatch the page cannot act on.
          if(record.id!==known.worldId||record.world?.build?.id!==known.buildId){completed.delete(completionKey(payload.worldId,payload.candidateId));return {status:"closed"};}
          return {status:"applied",worldId:known.worldId,candidateId:known.candidateId,record};
        }
        if(channel==="godot.candidateState"&&active?.candidateId!==payload.candidateId)throw new Error("GODOT_CANDIDATE_CHANGED");
        if(channel==="godot.candidateState"&&active?.phase==="preview")return {status:"preview",worldId:active.worldId,candidateId:active.candidateId};
        if(channel==="godot.candidateClose"||channel==="godot.candidateState")return await close();
        throw new Error("INVALID_GODOT_CANDIDATE_ACTION");
      }finally{busy=false;}
    },
  };
}
