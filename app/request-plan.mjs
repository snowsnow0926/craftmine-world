import {validateAssertion} from './harness/assertions.mjs';
import {BEHAVIOR_KEYS} from './behavior-contracts.mjs';

function fields(value,allowed) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))throw Error('REQUEST_PLAN_FIELDS');
}
export function validateRequestStep(step) {
  fields(step,['label','event','dt','player']);
  if(typeof step.label!=='string'||!step.label.trim()||step.label.length>80)throw Error('REQUEST_STEP_LABEL');
  fields(step.event,['type','targetId','code']);
  if(!['tick','interact','contact','attack','land','key'].includes(step.event.type))throw Error('REQUEST_STEP_EVENT');
  if(step.event.targetId!=null&&(typeof step.event.targetId!=='string'||step.event.targetId.length>80))throw Error('REQUEST_STEP_TARGET');
  if(step.event.type==='key'&&!BEHAVIOR_KEYS.includes(step.event.code))throw Error('REQUEST_STEP_KEY');
  if(step.event.type!=='key'&&step.event.code!==undefined)throw Error('REQUEST_STEP_KEY');
  if(step.dt!==undefined&&(!Number.isFinite(step.dt)||step.dt<0||step.dt>1))throw Error('REQUEST_STEP_DURATION');
  if(step.player!==undefined){
    fields(step.player,['x','y','z']);
    for(const [axis,min,max]of [['x',-47,47],['y',6,38],['z',-47,47]])if(!Number.isFinite(step.player[axis])||step.player[axis]<min||step.player[axis]>max)throw Error('REQUEST_STEP_PLAYER');
  }
  return step;
}
export function validateRequestPlan(plan) {
  fields(plan,['summary','verdict','suggestions','limitations','assertions','steps']);
  if(typeof plan.summary!=='string'||!plan.summary.trim()||plan.summary.length>2000)throw Error('REVIEW_SUMMARY_REQUIRED');
  if(!['ready','concerns','block'].includes(plan.verdict))throw Error('REVIEW_VERDICT');
  for(const key of ['suggestions','limitations'])if(!Array.isArray(plan[key])||plan[key].length>12||plan[key].some(value=>typeof value!=='string'||value.length>1500))throw Error('REVIEW_NOTES');
  if(!Array.isArray(plan.assertions)||!plan.assertions.length||plan.assertions.length>24)throw Error('REQUEST_ASSERTIONS_REQUIRED');
  if(!Array.isArray(plan.steps)||plan.steps.length>24)throw Error('REQUEST_STEPS_REQUIRED');
  plan.steps.forEach(validateRequestStep);
  const labels=plan.steps.map(step=>step.label);
  if(new Set(labels).size!==labels.length)throw Error('REQUEST_STEP_DUPLICATE');
  const ids=new Set();
  for(const assertion of plan.assertions){
    validateAssertion(assertion);
    if(ids.has(assertion.id))throw Error('REQUEST_ASSERTION_DUPLICATE');ids.add(assertion.id);
    if((assertion.step||assertion.label)&&!labels.includes(assertion.step||assertion.label))throw Error('REQUEST_ASSERTION_STEP_MISSING');
  }
  if(plan.assertions.every(a=>a.kind==='noErrors'))throw Error('REQUEST_EFFECT_ASSERTION_REQUIRED');
  if(!plan.assertions.some(a=>a.kind==='noErrors'))throw Error('REQUEST_ERROR_ASSERTION_REQUIRED');
  return plan;
}
