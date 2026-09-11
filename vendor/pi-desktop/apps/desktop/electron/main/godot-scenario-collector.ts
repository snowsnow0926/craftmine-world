import {adjudicateGodotScenario,scenarioRequirementsHash,type ScenarioPlan} from './godot-scenario-verdict.ts';

/** In-process host binding, constructed only after checkDescriptor validation. */
export type ScenarioCheckBinding = {jobId:string;inputHash:string;worldId:string;buildId:string;baseId:string;checkRequirementsHash?:string};
export type ScenarioRuntimeAccess = {worldId:string;buildId:string;instanceId:string;request(op:string,args?:Record<string,unknown>):Promise<any>};
export type ScenarioDiagnosticSelector = (binding:Readonly<ScenarioCheckBinding>)=>ScenarioPlan|null;
const record=(v:any)=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function projectAssertions(plan:ScenarioPlan,step:number,value:any){
 const projected:Record<string,any>={};
 for(const assertion of plan.assertions.filter(a=>a.step===step)){
  let actual=value;
  for(const key of assertion.path){if(!(record(actual)||Array.isArray(actual))||!Object.prototype.hasOwnProperty.call(actual,key)){actual=undefined;break;}actual=actual[key];}
  if(!(typeof actual==='boolean'||typeof actual==='number'&&Number.isFinite(actual)||typeof actual==='string'&&actual.length<=240))continue;
  let target=projected;
  for(const key of assertion.path.slice(0,-1)){if(!record(target[key]))target[key]={};target=target[key];}
  target[assertion.path.at(-1)!]=actual;
 }
 return projected;
}

/** Only the disposable check runtime may be passed here. No load/save/ack/cancel
 * state operations, arbitrary paths or script execution are exposed by this API.
 * The extension plan is NOT core-authoritative; its verdict is diagnostic only. */
export async function collectGodotScenarioDiagnostic(options:{binding:ScenarioCheckBinding;runtime:ScenarioRuntimeAccess;plan:ScenarioPlan;signal:AbortSignal}) {
 const {runtime,signal}=options;
 const binding=Object.freeze({...options.binding});
 const identity=Object.freeze({worldId:binding.worldId,buildId:binding.buildId,instanceId:runtime.instanceId});
 let plan:ScenarioPlan|undefined,requirementsHash:string|null=null;
 const transcript:any={format:'craftmine.godot-scenario-transcript/1',identity,fixtureRef:null,requirementsHash:null,steps:[]};
 const finish=(status:'passed'|'failed'|'inconclusive',reason:string,verdict?:ReturnType<typeof adjudicateGodotScenario>)=>({format:'craftmine.godot-scenario-diagnostic/1',authority:'diagnostic-only',affectsCandidateReadiness:false,binding,identity,requirementsHash,status,reason,transcript,...(verdict?{verdict}:{}),trust:'untrusted-project-data'});
 const assertActive=()=>{
  if(signal.aborted)throw Error('SCENARIO_CANCELLED');
  if(runtime.worldId!==identity.worldId||runtime.buildId!==identity.buildId||runtime.instanceId!==identity.instanceId)throw Error('SCENARIO_RUNTIME_IDENTITY_CHANGED');
 };
 // Races pending transport work; the owner disposes the whole isolated runtime
 // on cancellation. An in-flight action may finish there, but no next action is
 // sent and no late result is appended or used for readiness.
 const request=async(op:string,args:Record<string,unknown>={})=>{
  assertActive();
  let abort=()=>{};
  const stopped=new Promise<never>((_,reject)=>{abort=()=>reject(Error('SCENARIO_CANCELLED'));signal.addEventListener('abort',abort,{once:true});});
  try{const response=await Promise.race([runtime.request(op,args),stopped]);assertActive();if(!record(response)||typeof response.error==='string')throw Error('SCENARIO_RUNTIME_REQUEST_FAILED');return response;}
  finally{signal.removeEventListener('abort',abort);}
 };
 const observe=async()=>{
  const raw=(await request('observe-envelope')).result;
  if(!record(raw)||raw.format!=='craftmine.godot-observation/1'||Object.entries(identity).some(([k,v])=>raw[k]!==v)||raw.baseId!==binding.baseId||!record(raw.payload))throw Error('SCENARIO_OBSERVATION_IDENTITY_INVALID');
  const age=Date.now()-Date.parse(raw.sampledAt);
  if(!Number.isFinite(age)||age< -5000||age>30000)throw Error('SCENARIO_OBSERVATION_STALE');
  if(!Number.isSafeInteger(raw.payload.creation?.physicsTick))throw Error('SCENARIO_PHYSICS_CLOCK_UNSUPPORTED');
  if(JSON.stringify(raw.payload).length>262144)throw Error('SCENARIO_OBSERVATION_TOO_LARGE');
  return raw;
 };
 try{
  if(!/^gjob-[a-f0-9]{64}$/.test(binding.jobId)||!/^gbd-[a-f0-9]{64}$/.test(binding.buildId)||!/^[a-f0-9]{64}$/.test(binding.inputHash)||binding.checkRequirementsHash!==undefined&&!/^[a-f0-9]{64}$/.test(binding.checkRequirementsHash))throw Error('SCENARIO_CHECK_BINDING_INVALID');
  if(binding.baseId!=='creation-sandbox')throw Error('SCENARIO_BASE_UNSUPPORTED');
  plan=structuredClone(options.plan);requirementsHash=scenarioRequirementsHash(plan);
  transcript.fixtureRef=plan.fixtureRef;transcript.requirementsHash=requirementsHash;
  let before=await observe();
  for(const action of plan.steps){
   // Fresh identity and tick before *every* action; callback/wire data is never
   // used as an action or assertion source.
   before=await observe();
   const response=await request(action.op,{...action.args});
   let after=await observe();
   // look/interact are instantaneous. Wait by read-only sampling for the next
   // real physics tick rather than injecting an unrecorded gameplay operation.
   const sampleDeadline=Date.now()+1000;
   while(after.payload.creation.physicsTick<=before.payload.creation.physicsTick){
    if(Date.now()>sampleDeadline)throw Error('SCENARIO_PHYSICS_CLOCK_STALLED');
    await new Promise(resolve=>setTimeout(resolve,10));assertActive();after=await observe();
   }
   const actionResult=response.result??null;
   if(JSON.stringify(actionResult).length>262144)throw Error('SCENARIO_ACTION_RESULT_TOO_LARGE');
   transcript.steps.push({action,identity,requirementsHash,physicsTick:after.payload.creation.physicsTick,sampledAt:after.sampledAt,ok:true,observation:projectAssertions(plan,transcript.steps.length,{state:after.payload,actionResult})});
  }
  assertActive();
  const verdict=adjudicateGodotScenario(plan,identity,transcript);
  return finish(verdict.status,verdict.reason,verdict);
 }catch(error){return finish('inconclusive',error instanceof Error?error.message.slice(0,300):'SCENARIO_COLLECTION_FAILED');}
}
