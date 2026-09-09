import {createHash, randomUUID} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import type {GodotWorldViewHost} from "./godot-world-view-host";
import type {createGodotRuntimeAdapter, GodotCandidateDescriptor} from "./godot-runtime-adapter";
type Data = Record<string, any>;
type Session = {worldId:string;candidateId:string;id:string;token:string;phase:"preparing"|"preview"|"applying"|"uncertain"|"committed";prepared?:Data;descriptor?:GodotCandidateDescriptor;evidence?:Data;contentOperation?:string};
const object=(value:unknown):value is Data=>!!value&&typeof value==="object"&&!Array.isArray(value);
const sha=(text:string)=>createHash("sha256").update(text,"utf8").digest("hex");
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
    const session:Session={worldId,candidateId,id:randomUUID(),token:randomUUID(),phase};active=session;
    const prepared=applicationMatches(session,await rpc("godotApplication.prepare",{id:session.id,token:session.token,candidateId,worldId,revision,snapshot}));
    if(prepared.status!=="prepared"||!isDeepStrictEqual(prepared.input.snapshot,snapshot)||prepared.input.revision!==revision||!/^[a-f0-9]{64}$/.test(prepared.inputHash))throw new Error("GODOT_APPLICATION_PREPARE_MISMATCH");
    session.prepared=prepared;
    const descriptor=await options.adapter.describeCandidate(worldId,session.id,session.token);
    if(descriptor.buildId!==prepared.buildId||descriptor.applicationInputHash!==prepared.inputHash||!isDeepStrictEqual(descriptor.snapshot,snapshot))throw new Error("GODOT_CANDIDATE_DESCRIPTOR_MISMATCH");
    session.descriptor=descriptor;
    await options.host.stageCandidate(descriptor,{first});
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
  async function commit(session:Session) {
    const status=await rpc("content.status",{worldId:session.worldId});
    if(status.backend==="git") {
      const candidate=await rpc("godotCandidate.read",{worldId:session.worldId,candidateId:session.candidateId});
      const content=candidate.content;
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
        await options.host.discardCandidate();drop();await options.host.resume();return {status:"aborted",worldId:session.worldId};
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
    await options.host.discardCandidate();drop();await options.host.resume();return {status:"aborted",worldId:session.worldId};
  }
  async function failed(error:unknown):Promise<Data> {
    const session=active;
    if(session) {
      try {const result=await recover(session);if(result.status==="applied")return result;}catch(recovery){session.phase="uncertain";await options.host.candidateRequest("pause").catch(()=>undefined);options.host.setCandidateVisible(false);options.host.setSurfaceVisible(false);throw new Error(`${String(error)}; application recovery pending: ${String(recovery)}`);}
    } else {release?.();release=null;await options.host.resume().catch(()=>undefined);}
    throw error;
  }
  async function open(worldId:string,candidateId:string) {
    if(active)throw new Error("GODOT_CANDIDATE_ACTIVE");await identity(worldId);release=await options.host.holdSelectionSync();
    try {
      await options.host.pause();const formal=await options.adapter.describe(worldId);if(!formal)throw new Error("GODOT_FORMAL_WORLD_REQUIRED");
      const session=await prepare(worldId,candidateId,formal.revision,formal.snapshot,"preparing");
      await confirm(session);await options.host.candidateRequest("resume");session.phase="preview";
      options.host.setSurfaceVisible(true);options.host.setCandidateVisible(true);
      return {status:"preview",worldId,candidateId,buildId:session.prepared!.buildId};
    }catch(error){return failed(error);}
  }
  async function apply(worldId:string,candidateId:string) {
    const preview=active;if(!preview||preview.phase!=="preview"||preview.worldId!==worldId||preview.candidateId!==candidateId)throw new Error("GODOT_PREVIEW_REQUIRED");
    await identity(worldId);
    try {
      // Discard all preview changes and release its prepare lock before saving formal play.
      const aborted=applicationMatches(preview,await rpc("godotApplication.abort",{id:preview.id}));
      if(aborted.status!=="aborted")throw new Error("GODOT_PREVIEW_ABORT_REQUIRED");
      await options.host.discardCandidate();active=null;
      const checkpoint=await options.host.checkpoint();if(checkpoint.status!=="persisted")throw new Error(checkpoint.error);
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
    if(await options.adapter.describe(worldId))throw new Error("GODOT_FORMAL_WORLD_EXISTS");
    release=await options.host.holdSelectionSync();
    try {
      const record=await rpc("world.read",{id:worldId});
      if(record.id!==worldId||!Number.isSafeInteger(record.revision)||record.revision<0||!object(record.world))throw new Error("GODOT_WORLD_RECORD_INVALID");
      const session=await prepare(worldId,candidateId,record.revision,record.world.snapshot,"applying",true);
      session.evidence=await confirm(session);
      return await commit(session);
    }catch(error){return failed(error);}
  }
  async function close(){if(!active)return {status:"closed"};const session=active;try{const result=await recover(session);options.host.setSurfaceVisible(true);return result;}catch(error){session.phase="uncertain";await options.host.candidateRequest("pause").catch(()=>undefined);options.host.setCandidateVisible(false);options.host.setSurfaceVisible(false);throw error;}}
  return {
    get blocking(){return busy||!!active;},
    async closeForDeparture(){if(busy)throw new Error("WORLD_BUSY");busy=true;try{return await close();}finally{busy=false;}},
    /** Private first-load entry for the initialization transaction; not a page route. */
    async firstLoad(worldId:string,candidateId:string) {
      if(typeof worldId!=="string"||typeof candidateId!=="string")throw new Error("INVALID_GODOT_CANDIDATE_ACTION");
      if(busy)throw new Error("WORLD_BUSY");
      busy=true;
      try{return await firstLoadInner(worldId,candidateId);}finally{busy=false;}
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
