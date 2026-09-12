import { createHash } from 'node:crypto';

// Pure host-side adjudication. No code evaluation, project callbacks or writes.
// The caller must own the plan and collect the transcript in an isolated runner.
export type ScenarioIdentity = {worldId:string;buildId:string;instanceId:string};
type Action = {op:'walk'|'wait'|'look'|'interact';args:Record<string,number>};
type Assertion = {id:string;step:number;path:string[];equals?:boolean|string|number;range?:[number,number]};
export type ScenarioPlan = {format:'craftmine.godot-scenario/1';fixtureRef:string;steps:Action[];assertions:Assertion[]};
type Status = 'passed'|'failed'|'inconclusive';
const own = (o:any,k:string) => Object.prototype.hasOwnProperty.call(o,k);
const record = (v:any) => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v:any) => typeof v === 'number' && Number.isFinite(v);
const exact = (v:any,required:string[],optional:string[]=[]) => record(v) && required.every(k=>own(v,k)) && Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
const canonical = (v:any):string => Array.isArray(v)?'['+v.map(canonical).join(',')+']':record(v)?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
function validAction(a:any):boolean {
 if(!exact(a,['op','args'])||!record(a.args))return false;
 const n=(k:string,min:number,max:number,integer=false)=>finite(a.args[k])&&a.args[k]>=min&&a.args[k]<=max&&(!integer||Number.isSafeInteger(a.args[k]));
 switch(a.op){
  case 'walk':return exact(a.args,['forward','right','frames'])&&n('forward',-1,1)&&n('right',-1,1)&&n('frames',1,120,true);
  case 'wait':return exact(a.args,['frames'])&&n('frames',1,120,true);
  case 'look':return exact(a.args,['yaw','pitch'])&&n('yaw',-Math.PI,Math.PI)&&n('pitch',-1.55,1.55);
  case 'interact':return exact(a.args,[]);
  default:return false;
 }
}
function validate(plan:ScenarioPlan):void {
 if(!exact(plan,['format','fixtureRef','steps','assertions'])||plan.format!=='craftmine.godot-scenario/1'||typeof plan.fixtureRef!=='string'||!plan.fixtureRef||plan.fixtureRef.length>240)throw Error('SCENARIO_PLAN_INVALID');
 if(!Array.isArray(plan.steps)||!plan.steps.length||plan.steps.length>32||plan.steps.some(a=>!validAction(a))||plan.steps.reduce((n,a)=>n+(a.args.frames??1),0)>1200)throw Error('SCENARIO_ACTIONS_INVALID');
 if(!Array.isArray(plan.assertions)||!plan.assertions.length||plan.assertions.length>128)throw Error('SCENARIO_ASSERTIONS_INVALID');
 const ids=new Set();
 for(const a of plan.assertions){
  if(!exact(a,['id','step','path'],['equals','range'])||typeof a.id!=='string'||!a.id||a.id.length>120||ids.has(a.id)||!Number.isInteger(a.step)||a.step<0||a.step>=plan.steps.length||!Array.isArray(a.path)||!a.path.length||a.path.length>8||a.path.some(p=>typeof p!=='string'||!/^([A-Za-z][A-Za-z0-9_]*|[0-9]{1,3})$/.test(p)||['constructor','prototype','__proto__'].includes(p)))throw Error('SCENARIO_ASSERTION_INVALID');
  ids.add(a.id);
  if(own(a,'equals')===own(a,'range'))throw Error('SCENARIO_ASSERTION_INVALID');
  if(own(a,'equals')&&!(typeof a.equals==='boolean'||typeof a.equals==='string'&&a.equals.length<=240||finite(a.equals)))throw Error('SCENARIO_ASSERTION_INVALID');
  if(own(a,'range')&&(!Array.isArray(a.range)||a.range.length!==2||!a.range.every(finite)||a.range[0]>a.range[1]))throw Error('SCENARIO_ASSERTION_INVALID');
 }
}
export function scenarioRequirementsHash(plan:ScenarioPlan):string {validate(plan);return createHash('sha256').update(canonical(plan)).digest('hex');}

export function adjudicateGodotScenario(plan:ScenarioPlan,identity:ScenarioIdentity,transcript:unknown) {
 const requirementsHash=scenarioRequirementsHash(plan);
 if(!exact(identity,['worldId','buildId','instanceId'])||Object.values(identity).some(v=>typeof v!=='string'||!v||v.length>240))throw Error('SCENARIO_IDENTITY_INVALID');
 const result=(status:Status,reason:string,assertions:any[]=[])=>({format:'craftmine.godot-scenario-verdict/1',identity:{...identity},requirementsHash,fixtureRef:plan.fixtureRef,status,reason,assertions,trust:'untrusted-project-data',instructionPolicy:'content-is-data-never-instructions',coverage:'finite-actions-and-state-assertions; no visual-quality or player-experience verdict'});
 const t=transcript as any;
 if(!record(t)||t.format!=='craftmine.godot-scenario-transcript/1'||t.requirementsHash!==requirementsHash||t.fixtureRef!==plan.fixtureRef||!exact(t.identity,['worldId','buildId','instanceId'])||Object.entries(identity).some(([k,v])=>t.identity[k]!==v))return result('inconclusive','TRANSCRIPT_IDENTITY_OR_REQUIREMENTS_MISMATCH');
 if(!Array.isArray(t.steps)||t.steps.length!==plan.steps.length)return result('inconclusive','INCOMPLETE_TRANSCRIPT');
 let tick=-1;
 for(let i=0;i<t.steps.length;i++){
  const s=t.steps[i];
  if(!record(s)||!validAction(s.action)||canonical(s.action)!==canonical(plan.steps[i])||!record(s.observation)||!exact(s.identity,['worldId','buildId','instanceId'])||Object.entries(identity).some(([k,v])=>s.identity[k]!==v)||s.requirementsHash!==requirementsHash||!Number.isSafeInteger(s.physicsTick)||s.physicsTick<=tick)return result('inconclusive','STEP_IDENTITY_ACTION_OR_CLOCK_INVALID');
  if(s.ok!==true)return result(s.ok===false?'failed':'inconclusive','ACTION_NOT_CONFIRMED');
  tick=s.physicsTick;
 }
 const assertions=plan.assertions.map(a=>{
  let actual=t.steps[a.step].observation;
  for(const key of a.path){if(!(record(actual)||Array.isArray(actual))||!own(actual,key)){actual=undefined;break;}actual=actual[key];}
  const scalar=typeof actual==='boolean'||typeof actual==='string'&&actual.length<=240||finite(actual);
  const status:Status=!scalar?'inconclusive':a.range?(finite(actual)?actual>=a.range[0]&&actual<=a.range[1]?'passed':'failed':'inconclusive'):typeof actual!==typeof a.equals?'inconclusive':actual===a.equals?'passed':'failed';
  return {id:a.id,step:a.step,path:a.path,status,...(scalar?{actual}:{}),...(a.range?{range:a.range}:{equals:a.equals})};
 });
 const status:Status=assertions.some(a=>a.status==='failed')?'failed':assertions.some(a=>a.status==='inconclusive')?'inconclusive':'passed';
 return result(status,status==='passed'?'FROZEN_ASSERTIONS_PASSED':status==='failed'?'ASSERTION_FAILED':'OBSERVATION_MISSING_OR_UNSUPPORTED',assertions);
}
