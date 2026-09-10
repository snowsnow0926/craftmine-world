// Source data contract for the official creation sandbox; no IO or execution.
export const CREATION_SCENE_FORMAT='craftmine.creation-scene/1';
export const CREATION_ENTITY_LIMIT=128;
export const CREATION_ID_PATTERN=/^[a-z][a-z0-9_-]{0,63}$/;
export const CREATION_HALF_EXTENTS=Object.freeze({tree:[0.6,2,0.6],rock:[0.7,0.7,0.7],chest:[0.6,0.55,0.5],door:[0.8,1.3,0.25],marker:[0.3,0.7,0.3]});
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const finite=(value,min,max)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const exact=(value,required,optional=[])=>object(value)&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>[...required,...optional].includes(key));
const id=value=>typeof value==='string'&&CREATION_ID_PATTERN.test(value);
export function validateCreationScene(scene){
  const issues=[];
  const fail=(at,message)=>issues.push({code:'CREATION_SCENE_INVALID',at,message});
  if(!exact(scene,['format','revision','defaults','entities'],['rules'])||scene.format!==CREATION_SCENE_FORMAT){fail('scene','Unsupported scene format or fields');return {ok:false,issues};}
  if(!integer(scene.revision,1,2147483647))fail('revision','Revision must be an integer 1..2147483647');
  if(!exact(scene.defaults,['timeOfDay'])||!finite(scene.defaults.timeOfDay,0,24))fail('defaults','timeOfDay must be finite 0..24');
  if(!Array.isArray(scene.entities)||scene.entities.length>CREATION_ENTITY_LIMIT){fail('entities','At most 128 entities are supported');return {ok:false,issues};}
  const entities=new Map();
  for(const [index,entity] of scene.entities.entries()){
    const at=`entities[${index}]`;
    if(!exact(entity,['id','kind','position','rotationY','scale','color','parameters'])){fail(at,'Unsupported entity fields');continue;}
    if(!id(entity.id)||entities.has(entity.id))fail(at+'.id','Entity IDs must be unique stable identifiers');
    entities.set(entity.id,entity);
    if(!['tree','rock','chest','door','marker'].includes(entity.kind))fail(at+'.kind','Unsupported entity kind');
    if(!Array.isArray(entity.position)||entity.position.length!==3||!finite(entity.position[0],-28,28)||!finite(entity.position[1],0,16)||!finite(entity.position[2],-28,28))fail(at+'.position','Position must be x/z -28..28 and y 0..16');
    if(!finite(entity.rotationY,-180,180))fail(at+'.rotationY','rotationY is degrees -180..180');
    if(!Array.isArray(entity.scale)||entity.scale.length!==3||!entity.scale.every(value=>finite(value,0.25,4)))fail(at+'.scale','Scale must have three finite values 0.25..4');
    if(typeof entity.color!=='string'||!/^#[a-fA-F0-9]{6}$/.test(entity.color))fail(at+'.color','Color must be #RRGGBB');
    const keys=entity.kind==='chest'?['rewardId','rewardCount']:entity.kind==='door'?['initiallyOpen']:entity.kind==='marker'?['label']:[];
    if(!exact(entity.parameters,[],keys)){fail(at+'.parameters','Unsupported parameter keys');continue;}
    const p=entity.parameters;
    if(p.rewardId!==undefined&&!id(p.rewardId))fail(at+'.parameters.rewardId','Reward is a source-local stable identifier');
    if(p.rewardCount!==undefined&&!integer(p.rewardCount,1,99))fail(at+'.parameters.rewardCount','Reward count must be 1..99');
    if(p.initiallyOpen!==undefined&&typeof p.initiallyOpen!=='boolean')fail(at+'.parameters.initiallyOpen','Expected boolean');
    if(p.label!==undefined&&(typeof p.label!=='string'||[...p.label].length>80))fail(at+'.parameters.label','Label must be at most 80 characters');
  }
  const rules=scene.rules??[];
  if(!Array.isArray(rules)||rules.length>8){fail('rules','At most eight authored rules are supported');return {ok:false,issues};}
  const ruleIds=new Set(),owned=new Set();
  for(const [index,rule] of rules.entries()){
    const at=`rules[${index}]`;
    if(!exact(rule,rule?.kind==='entity-behavior'?['id','kind','entityIds','script','sha256']:['id','kind','doorId','sequence','script','sha256'])){fail(at,'Unsupported rule fields');continue;}
    if(!id(rule.id)||ruleIds.has(rule.id))fail(at+'.id','Rule IDs must be unique stable identifiers');
    ruleIds.add(rule.id);
    if(rule.kind==='entity-behavior'){
      if(!Array.isArray(rule.entityIds)||rule.entityIds.length<1||rule.entityIds.length>16||new Set(rule.entityIds).size!==rule.entityIds.length||!rule.entityIds.every(key=>entities.has(key)&&!owned.has(key)))fail(at+'.entityIds','Behavior requires 1..16 declared entities with one owner');
      else rule.entityIds.forEach(key=>owned.add(key));
    }else{
      if(rule.kind!=='sequence-door'||entities.get(rule.doorId)?.kind!=='door')fail(at,'Rule requires sequence-door kind and a declared door');
      if(!Array.isArray(rule.sequence)||rule.sequence.length<2||rule.sequence.length>16||new Set(rule.sequence).size!==rule.sequence.length||!rule.sequence.every(key=>entities.get(key)?.kind==='marker'))fail(at+'.sequence','Sequence requires 2..16 distinct declared markers');
    }
    if(rule.script!==`scripts/creation/rules/${rule.id}.gd`)fail(at+'.script','Rule source must use its exact generated path');
    if(typeof rule.sha256!=='string'||!/^[a-f0-9]{64}$/.test(rule.sha256))fail(at+'.sha256','Rule source requires a SHA-256 hash');
  }
  return {ok:issues.length===0,issues};
}
export function assertCreationScene(value){const result=validateCreationScene(value);if(!result.ok)throw Object.assign(Error(result.issues.map(issue=>`${issue.at}: ${issue.message}`).join('; ')),{errorCode:'CREATION_SCENE_INVALID'});return value;}
