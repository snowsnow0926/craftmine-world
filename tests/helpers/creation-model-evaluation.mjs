import {isDeepStrictEqual} from 'node:util';

export const CREATION_MODEL_SUITE='craftmine.creation-next-model/1';
// New benchmark inputs intentionally have a separate identity from the Alpha fixtures.
export const CREATION_MODEL_CASES=[
  {id:'CA01',request:'在这里放一棵树',aim:'aim-ground'},
  {id:'CA02',request:'把这棵树变大一倍',aim:'aim-tree'},
  {id:'CA03',request:'复制这棵树两个，排开一点',aim:'aim-tree'},
  {id:'CA04',request:'把时间设为18点',aim:'aim-ground'},
  {id:'CA05',request:'让这棵树可以按E砍伐，砍掉时给背包增加一块木头，5秒后重新长出来。保存重开后保留木头和树的生长状态。',aim:'aim-tree'},
  {id:'CA06',request:'在这里再放一块石头，保留已有物体和游玩进度',aim:'aim-ground'},
  {id:'CA07',request:'在这个副本的这里放一棵树，保留之前的内容',aim:'aim-ground'},
  {id:'HOLDOUT01',request:'这棵树的颜色改成#88bb44，其他东西保持原样',aim:'aim-tree'},
];
export const MODEL_LIMITS={maxRequests:40,maxCaseMs:600000,maxRepairs:3,maxCases:10};
export const successfulOutcomes=new Set(['first_attempt_pass','model_repaired_pass','human_assisted_pass']);
const environmentCodes=/EVALUATION_(?:EXPLICIT_MODEL|WINDOW|CONTROLLER|NOT_INITIALIZED)|GODOT_EXECUTOR_UNAVAILABLE|EXECUTOR_(?:NOT|UN)AVAILABLE|API_KEY|INVALID_API_KEY|AUTHENTICATION|INSUFFICIENT_(?:BALANCE|QUOTA)|RATE_LIMIT|MODEL_NOT_FOUND|DEPENDENCY_NOT_WIRED|EVALUATION_BUILD_REQUIRED|ENOENT/i;
export function classifyModelCase({submitted=false,checks=[],modelRequests=0,repairAttempts=0,humanIntervention=false,error='',environmentFailure=false}){
  if(environmentFailure||environmentCodes.test(error))return 'environment_blocked';
  if(!submitted)return 'not_run';
  if(modelRequests<1||checks.length===0||checks.some(item=>item.passed!==true)||error)return 'failed';
  if(humanIntervention)return 'human_assisted_pass';
  return repairAttempts>0?'model_repaired_pass':'first_attempt_pass';
}
export function summarizeModelCases(cases){
  const counts=Object.fromEntries(['first_attempt_pass','model_repaired_pass','human_assisted_pass','failed','environment_blocked','not_run'].map(key=>[key,0]));
  for(const item of cases)counts[item.outcome]=(counts[item.outcome]??0)+1;
  const runs=cases.filter(item=>item.modelRequests>0),unassisted=runs.filter(item=>!item.humanIntervention&&item.outcome!=='environment_blocked');
  return {counts,realModelRuns:runs.length,denominator:unassisted.length,firstAttemptRate:unassisted.length?unassisted.filter(item=>item.outcome==='first_attempt_pass').length/unassisted.length:null,
    autonomousCompletionRate:unassisted.length?unassisted.filter(item=>['first_attempt_pass','model_repaired_pass'].includes(item.outcome)).length/unassisted.length:null,
    requestCount:cases.reduce((sum,item)=>sum+(item.modelRequests??0),0),cost:null,costReason:'No verified monetary price or billed cost in the product usage ledger'};
}
export function completeCreationProgress(value){
  if(value?.format==='craftmine.godot-progress/1'&&value.baseId==='creation-sandbox'&&value.body?.format==='craftmine.creation-progress/1')return structuredClone(value);
  for(const key of ['state','snapshot','result'])if(value?.[key]){try{return completeCreationProgress(value[key]);}catch{}}
  throw Error('COMPLETE_CREATION_PROGRESS_REQUIRED');
}
export function observationCreation(value){
  if(value?.baseId!=='creation-sandbox'||!value.instanceId||!value.worldId||!value.buildId||!Array.isArray(value.payload?.creation?.entities))throw Error('ACTUAL_CREATION_OBSERVATION_REQUIRED');
  return value.payload.creation;
}
const near=(a,b,epsilon=.02)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,index)=>Number.isFinite(value)&&Math.abs(value-b[index])<=epsilon);
const strictOverlap=(a,b)=>[0,1,2].every(index=>a.min[index]<b.max[index]-.001&&b.min[index]<a.max[index]-.001);
export function inspectCreationOutcome({caseId,before,after,target,beforeProgress,afterProgress,job,reopened,restoredProgress,copySourceUnchanged,behavior}){
  const checks=[];const add=(name,passed,detail)=>checks.push({name,passed:!!passed,...(detail===undefined?{}:{detail})});
  const old=observationCreation(before),live=observationCreation(after),prior=completeCreationProgress(beforeProgress),current=completeCreationProgress(afterProgress);
  const selected=target?.target?.entityId,newEntities=live.entities.filter(entity=>!old.entities.some(item=>item.id===entity.id)),original=old.entities.find(entity=>entity.id===selected),changed=live.entities.find(entity=>entity.id===selected);
  add('same-world',after.worldId===before.worldId&&current.worldId===after.worldId);
  add('actual-checked-and-applied-build',job?.kind==='check'&&job.status==='passed'&&job.worldId===after.worldId&&job.buildId===after.buildId&&after.buildId!==before.buildId&&Array.isArray(job.output?.check?.assertions)&&job.output.check.assertions.length>0&&job.output.check.assertions.every(item=>item.passed===true));
  const expectedInventory=structuredClone(prior.body.inventory);
  if(caseId==='CA05')expectedInventory.wood=(expectedInventory.wood??0)+1;
  add('unrelated-inventory-and-reward-ledgers-preserved',isDeepStrictEqual(expectedInventory,current.body.inventory)&&isDeepStrictEqual(prior.body.openedChests,current.body.openedChests));
  add('player-position-preserved',near(prior.body.player?.position,current.body.player?.position));
  for(const entity of old.entities)if(entity.id!==selected||!['CA02','CA05','HOLDOUT01'].includes(caseId))add('preserve-object:'+entity.id,isDeepStrictEqual(entity,live.entities.find(item=>item.id===entity.id)));
  if(['CA01','CA06','CA07'].includes(caseId)){
    const kind=caseId==='CA06'?'rock':'tree';add('exactly-one-new-'+kind,newEntities.length===1&&newEntities[0].kind===kind);
    add('captured-ground-position',target?.target?.surface==='ground'&&newEntities.length===1&&near(newEntities[0].position,target.target.position));
    add('actual-new-collision',newEntities.length===1&&live.obstacles?.some(item=>item.entityId===newEntities[0].id));
    if(caseId==='CA07')add('original-world-unchanged',copySourceUnchanged===true);
  }else if(caseId==='CA02'){
    add('same-selected-tree',original?.kind==='tree'&&changed?.kind==='tree'&&newEntities.length===0&&old.entities.length===live.entities.length);
    const a=old.obstacles?.find(item=>item.entityId===selected),b=live.obstacles?.find(item=>item.entityId===selected);
    add('actual-double-height',a&&b&&Math.abs((b.max[1]-b.min[1])-2*(a.max[1]-a.min[1]))<.03);
    add('same-tree-position',original&&changed&&near(original.position,changed.position));
  }else if(caseId==='CA03'){
    add('two-independent-tree-copies',newEntities.length===2&&newEntities.every(item=>item.kind==='tree')&&new Set(live.entities.map(item=>item.id)).size===live.entities.length);
    add('selected-original-unchanged',original&&isDeepStrictEqual(original,changed));
    add('copies-spaced-apart',newEntities.every(entity=>{const box=live.obstacles?.find(item=>item.entityId===entity.id);return box&&live.obstacles.every(other=>other.entityId===entity.id||!strictOverlap(box,other));}));
  }else if(caseId==='CA04'){
    add('authored-and-actual-time-18',Math.abs(live.timeOfDay-18)<.01&&current.body.sourceTimeOfDay===18&&current.body.timeOfDay===18);
    add('no-extra-objects',newEntities.length===0);
  }else if(caseId==='HOLDOUT01'){
    add('same-tree-new-color',original?.kind==='tree'&&changed?.kind==='tree'&&changed.color?.toLowerCase()==='#88bb44');
    add('color-only-edit',original&&changed&&isDeepStrictEqual({...original,color:changed.color},changed)&&newEntities.length===0);
  }else if(caseId==='CA05'){
    add('ordinary-script-behavior-executed',behavior?.ordinaryScript===true);
    add('chop-rewards-one-wood',behavior?.woodAfter===behavior?.woodBefore+1);
    add('tree-absent-before-regrowth',behavior?.treeAbsent===true);
    add('partial-regrowth-state-restores',behavior?.partialRestored===true);
    add('tree-regrows-after-five-seconds',behavior?.treeReturned===true);
    add('wood-retained-after-reopen',behavior?.woodRestored===behavior?.woodAfter);
  }else add('known-case',false);
  add('fresh-process-runtime-restored',!!reopened&&reopened.worldId===after.worldId&&reopened.buildId===after.buildId&&reopened.instanceId!==after.instanceId);
  if(reopened)add('fresh-process-entities-and-dimensions',isDeepStrictEqual(live.entities,observationCreation(reopened).entities)&&isDeepStrictEqual(live.obstacles,observationCreation(reopened).obstacles));
  add('full-persistent-progress-restored',!!restoredProgress&&isDeepStrictEqual(current,completeCreationProgress(restoredProgress)));
  return checks;
}

/** A failed real tool/build followed by additional model work counts as repair. Polling is not an attempt. */
function toolBody(value,depth=0){
  if(depth>4)return value;
  if(typeof value==='string'){try{return toolBody(JSON.parse(value),depth+1);}catch{return value;}}
  if(value?.status)return value;
  if(value?.details)return toolBody(value.details,depth+1);
  const texts=value?.content?.filter?.(part=>part.type==='text'&&typeof part.text==='string');
  if(texts?.length===1)return toolBody(texts[0].text,depth+1);
  return value;
}
export function countModelRepairs(messages){
  let repairs=0,failed=false;const seen=new Set();
  for(const item of messages??[]){
    if(item.role!=='tool'||seen.has(item.toolCallId??item.id))continue;seen.add(item.toolCallId??item.id);
    const value=toolBody(item.toolResult??item.content);
    const isRead=/godot_build_read$/.test(item.toolName??''),bad=item.toolStatus==='error'||item.toolStatus==='denied'||(isRead&&['failed','blocked','interrupted'].includes(value?.status));
    if(bad){failed=true;continue;}
    if(failed&&/creation_operation|godot_project_patch|godot_build_start/.test(item.toolName??'')){repairs++;failed=false;}
  }
  return repairs;
}
