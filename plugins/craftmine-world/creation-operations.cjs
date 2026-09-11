'use strict';
const {createHash}=require('node:crypto');
const {generateSequenceDoorRule}=require('./creation-sequence-rule.cjs');
const {summarizeCreationChange}=require('./creation-change-summary.cjs');
const {CREATION_OPERATION_LIMIT,CREATION_JOURNAL_BYTES}=require('./creation-operation-schema.cjs');
const SCENE_PATH='world/creation.json', JOURNAL_PATH='world/creation-operations.json';
const ID=/^[a-z][a-z0-9_-]{0,63}$/, HASH=/^[a-f0-9]{64}$/;
const KINDS=new Set(['tree','rock','chest','door','marker']);
const identifier=value=>typeof value==='string'&&ID.test(value);
const MAX_OPERATIONS=CREATION_OPERATION_LIMIT;
const fail=code=>{throw Object.assign(Error(code),{errorCode:code});};
const check=(value,code)=>{if(!value)fail(code);};
const hash=value=>createHash('sha256').update(value).digest('hex');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const finite=(value,min,max)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
function keys(value,allowed,required=allowed){check(object(value)&&Object.keys(value).every(key=>allowed.includes(key))&&required.every(key=>Object.hasOwn(value,key)),'CREATION_INVALID_FIELDS');}
function vector(value,min,max){return Array.isArray(value)&&value.length===3&&value.every((n,i)=>finite(n,Array.isArray(min)?min[i]:min,Array.isArray(max)?max[i]:max));}
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(object(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));return value;}
const creationOperationHash=request=>hash(JSON.stringify(canonical(request)));
function entity(value){
  keys(value,['id','kind','position','rotationY','scale','color','parameters']);
  check(identifier(value.id)&&KINDS.has(value.kind)&&vector(value.position,[-28,0,-28],[28,16,28])&&finite(value.rotationY,-180,180)&&vector(value.scale,.25,4)&&typeof value.color==='string'&&/^#[a-fA-F0-9]{6}$/.test(value.color),'CREATION_INVALID_ENTITY');
  const p=value.parameters;
  if(value.kind==='chest'){keys(p,['rewardId','rewardCount'],[]);check((p.rewardId===undefined||identifier(p.rewardId))&&(p.rewardCount===undefined||(Number.isInteger(p.rewardCount)&&finite(p.rewardCount,1,99))),'CREATION_INVALID_CHEST');}
  else if(value.kind==='door'){keys(p,['initiallyOpen'],[]);check(p.initiallyOpen===undefined||typeof p.initiallyOpen==='boolean','CREATION_INVALID_DOOR');}
  else if(value.kind==='marker'){keys(p,['label'],[]);check(p.label===undefined||(typeof p.label==='string'&&p.label.length<=80&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(p.label)),'CREATION_INVALID_MARKER');}
  else keys(p,[]);
  return value;
}
function scene(value){
  keys(value,['format','revision','defaults','entities','rules'],['format','revision','defaults','entities']);
  check(value.format==='craftmine.creation-scene/1'&&Number.isSafeInteger(value.revision)&&value.revision>=1,'CREATION_INVALID_DOCUMENT');
  keys(value.defaults,['timeOfDay']);check(finite(value.defaults.timeOfDay,0,24),'CREATION_INVALID_DEFAULTS');
  check(Array.isArray(value.entities)&&value.entities.length<=128,'CREATION_ENTITY_LIMIT');
  const ids=new Set();for(const item of value.entities){entity(item);check(!ids.has(item.id),'CREATION_DUPLICATE_ID');ids.add(item.id);}
  if(value.rules!==undefined){
    check(Array.isArray(value.rules)&&value.rules.length<=8,'CREATION_RULE_LIMIT');const rules=new Set();
    const owned=new Set();
    for(const rule of value.rules){
      keys(rule,rule?.kind==='entity-behavior'?['id','kind','entityIds','script','sha256']:['id','kind','doorId','sequence','script','sha256']);
      check(identifier(rule.id)&&!rules.has(rule.id)&&rule.script===`scripts/creation/rules/${rule.id}.gd`&&HASH.test(rule.sha256),'CREATION_RULE_INVALID');rules.add(rule.id);
      if(rule.kind==='entity-behavior'){
        check(Array.isArray(rule.entityIds)&&rule.entityIds.length>=1&&rule.entityIds.length<=16&&new Set(rule.entityIds).size===rule.entityIds.length&&rule.entityIds.every(id=>!owned.has(id)&&value.entities.some(item=>item.id===id)),'CREATION_RULE_TARGET_INVALID');
        rule.entityIds.forEach(id=>owned.add(id));
      }else check(rule.kind==='sequence-door'&&value.entities.some(item=>item.id===rule.doorId&&item.kind==='door')&&Array.isArray(rule.sequence)&&rule.sequence.length>=2&&rule.sequence.length<=16&&new Set(rule.sequence).size===rule.sequence.length&&rule.sequence.every(id=>value.entities.some(item=>item.id===id&&item.kind==='marker')),'CREATION_RULE_TARGET_INVALID');
    }
  }
  return value;
}
function readFile(source,path,required=false){
  const file=source.files[path];if(!file){check(!required,'CREATION_SOURCE_FILE_MISSING');return null;}
  check(object(file)&&typeof file.text==='string'&&Buffer.byteLength(file.text)<=(path===JOURNAL_PATH?CREATION_JOURNAL_BYTES:120000)&&HASH.test(file.sha256)&&hash(file.text)===file.sha256,'CREATION_SOURCE_FILE_HASH_MISMATCH');return file;
}
function readJson(file,empty){if(!file)return empty;try{return JSON.parse(file.text);}catch{fail('CREATION_SOURCE_JSON_INVALID');}}
function bounds(item){
  const widths={tree:[.6,2,.6],rock:[.7,.7,.7],chest:[.6,.55,.5],door:[.8,1.3,.25],marker:[.3,.7,.3]}[item.kind];
  const angle=item.rotationY*Math.PI/180,c=Math.abs(Math.cos(angle)),s=Math.abs(Math.sin(angle));
  const x=widths[0]*item.scale[0],z=widths[2]*item.scale[2];
  return {id:item.id,position:[item.position[0],item.position[1]+widths[1]*item.scale[1],item.position[2]],halfExtents:[x*c+z*s,widths[1]*item.scale[1],x*s+z*c]};
}
function overlap(a,b){return [0,1,2].every(i=>Math.abs(a.position[i]-b.position[i])<a.halfExtents[i]+b.halfExtents[i]-.001);}
function placementChanged(before,after){
  return !before||before.kind!==after.kind||before.rotationY!==after.rotationY||['position','scale'].some(key=>before[key].some((n,i)=>n!==after[key][i]));
}
function validatePlacement(item,others,snapshot){
  const box=bounds(item);
  check(box.position[0]-box.halfExtents[0]>=-28&&box.position[0]+box.halfExtents[0]<=28&&box.position[2]-box.halfExtents[2]>=-28&&box.position[2]+box.halfExtents[2]<=28&&box.position[1]+box.halfExtents[1]<=16,'CREATION_OUT_OF_BOUNDS');
  const player={position:[...snapshot.playerPosition],halfExtents:[.5,.9,.5]};
  check(!overlap(box,player),'CREATION_PLAYER_OVERLAP');
  for(const other of others)if(other.id!==item.id)check(!overlap(box,bounds(other)),'CREATION_OCCUPIED');
  for(const obstacle of snapshot.obstacles??[])if(obstacle.id!==item.id)check(!overlap(box,obstacle),'CREATION_OCCUPIED');
}
function compileCreationOperation({source,targetSnapshot,request}) {
  check(object(source)&&object(source.files)&&typeof source.worldId==='string'&&source.worldId.length>0&&typeof source.buildId==='string'&&typeof source.instanceId==='string'&&Number.isSafeInteger(source.revision)&&HASH.test(source.manifestHash),'CREATION_SOURCE_BINDING_INVALID');
  check(object(request)&&typeof request.operationId==='string'&&/^[a-zA-Z0-9_-]{1,120}$/.test(request.operationId),'CREATION_OPERATION_ID_INVALID');
  const sceneFile=readFile(source,SCENE_PATH), journalFile=readFile(source,JOURNAL_PATH);
  // A newly created Godot base has no authored creation scene yet. Treat that
  // state as the durable blank world and materialize the scene on first use.
  const document=scene(readJson(sceneFile,{format:'craftmine.creation-scene/1',revision:1,defaults:{timeOfDay:12},entities:[]}));
  const journal=readJson(journalFile,{format:'craftmine.creation-operations/1',operations:[]});
  keys(journal,['format','operations']);check(journal.format==='craftmine.creation-operations/1'&&Array.isArray(journal.operations)&&journal.operations.length<=MAX_OPERATIONS,'CREATION_JOURNAL_INVALID');
  const journalIds=new Set();for(const entry of journal.operations){
    check(object(entry)&&typeof entry.operationId==='string'&&!journalIds.has(entry.operationId)&&typeof entry.requestHash==='string'&&HASH.test(entry.requestHash)&&object(entry.receipt)&&entry.receipt.operationId===entry.operationId&&entry.receipt.requestHash===entry.requestHash&&entry.receipt.worldId===source.worldId&&Array.isArray(entry.receipt.createdIds)&&entry.receipt.createdIds.every(identifier),'CREATION_JOURNAL_INVALID');journalIds.add(entry.operationId);
  }
  const requestHash=creationOperationHash(request),previous=journal.operations.find(item=>item.operationId===request.operationId);
  check(request.expected?.worldId===source.worldId,'CREATION_WORLD_MISMATCH');
  if(previous){
    check(previous.requestHash===requestHash&&previous.receipt?.worldId===source.worldId,'CREATION_OPERATION_REPLAY_CONFLICT');
    // Never use today's scene to reconstruct yesterday's before-state. Old
    // non-invertible operations have no original detail and remain unknown.
    let before,after;
    const inverse=previous.inverse;
    try{
      check(inverse?.format==='craftmine.creation-inverse/1'&&Array.isArray(inverse.before)&&Array.isArray(inverse.after)&&inverse.before.length<=8&&inverse.after.length<=8,'INVALID_INVERSE');
      for(const list of [inverse.before,inverse.after]){list.forEach(entity);check(new Set(list.map(e=>e.id)).size===list.length,'INVALID_INVERSE');}
      const ids=new Set([...inverse.before,...inverse.after].map(e=>e.id));
      check(Array.isArray(previous.receipt.affectedIds)&&ids.size===previous.receipt.affectedIds.length&&previous.receipt.affectedIds.every(id=>ids.has(id)),'INVALID_INVERSE');
      before={entities:inverse.before};after={entities:inverse.after};
    }catch{/* Missing or invalid advisory detail cannot change receipt replay. */}
    return {document,operations:[],receipt:previous.receipt,changeSummary:summarizeCreationChange({before,after,receipt:previous.receipt,provenance:'journal-inverse'}),sourceBinding:{worldId:source.worldId,revision:source.revision,manifestHash:source.manifestHash},replayed:true};
  }
  check(journal.operations.length<MAX_OPERATIONS,'CREATION_OPERATION_JOURNAL_FULL');
  const expected=request.expected,snapshot=targetSnapshot;
  check(object(expected)&&object(snapshot),'CREATION_TARGET_REQUIRED');
  keys(expected,['worldId','buildId','instanceId','revision','manifestHash','targetSnapshotId']);
  for(const name of ['worldId','buildId','instanceId','revision','manifestHash'])check(expected[name]===source[name],'CREATION_STALE_SOURCE');
  check(snapshot.worldId===source.worldId&&snapshot.buildId===source.buildId&&snapshot.instanceId===source.instanceId&&snapshot.sourceRevision===source.revision&&snapshot.manifestHash===source.manifestHash&&snapshot.snapshotId===expected.targetSnapshotId,'CREATION_STALE_TARGET');
  check(snapshot.target?.revision===document.revision&&vector(snapshot.playerPosition,[-32,0,-32],[32,32,32]),'CREATION_TARGET_INVALID');
  check(snapshot.obstacles===undefined||(Array.isArray(snapshot.obstacles)&&snapshot.obstacles.length<=128&&snapshot.obstacles.every(item=>object(item)&&typeof item.id==='string'&&vector(item.position,-100,100)&&vector(item.halfExtents,0,20))),'CREATION_OBSTACLES_INVALID');
  const next=structuredClone(document), createdIds=[], affectedIds=[], extra=[];
  const minted=index=>`created-${hash(`${source.worldId}:${request.operationId}:${index}`).slice(0,24)}`;
  const used=id=>next.entities.some(item=>item.id===id)||journal.operations.some(op=>(op.receipt?.createdIds??[]).includes(id));
  const selected=()=>{check(typeof request.targetId==='string'&&request.targetId===snapshot.target.entityId,'CREATION_TARGET_ID_MISMATCH');const item=next.entities.find(value=>value.id===request.targetId);check(item,'CREATION_TARGET_REMOVED');return item;};
  if(request.action==='place'){
    // Recent selections authorize an object, never a placement point. Keep
    // this after exact journal replay above: a receipt read cannot write.
    check(snapshot.source!=='recent','CREATION_PLACEMENT_GROUND_REQUIRED');
    keys(request,['operationId','expected','action','kind','position','offset','id','color','scale','rotationY','parameters'],['operationId','expected','action','kind']);
    check(KINDS.has(request.kind),'CREATION_INVALID_KIND');
    let position=request.position;
    if(position!==undefined)check(vector(position,[-28,0,-28],[28,16,28]),'CREATION_INVALID_POSITION');
    if(position===undefined){check(['ground','entity'].includes(snapshot.target.surface)&&vector(snapshot.target.position,[-28,0,-28],[28,16,28]),'CREATION_TARGET_HAS_NO_POSITION');position=[...snapshot.target.position];}
    if(request.offset!==undefined){check(vector(request.offset,-8,8),'CREATION_INVALID_OFFSET');position=position.map((value,i)=>value+request.offset[i]);}
    const item=entity({id:request.id??minted(0),kind:request.kind,position,rotationY:request.rotationY??0,scale:request.scale??[1,1,1],color:request.color??'#84A866',parameters:request.parameters??{}});
    check(!used(item.id),'CREATION_DUPLICATE_ID');validatePlacement(item,next.entities,snapshot);next.entities.push(item);createdIds.push(item.id);affectedIds.push(item.id);
  } else if(request.action==='modify'){
    keys(request,['operationId','expected','action','targetId','changes']);const item=selected();
    keys(request.changes,['position','rotationY','scale','color','parameters'],[]);check(Object.keys(request.changes).length>0,'CREATION_EMPTY_CHANGE');
    const updated=entity({...item,...request.changes});
    if(item.kind==='chest')check((updated.parameters.rewardId??'creation-token')===(item.parameters.rewardId??'creation-token')&&(updated.parameters.rewardCount??1)===(item.parameters.rewardCount??1),'CREATION_CHEST_REWARD_IMMUTABLE');
    // An unchanged declared placement needs no new placement approval. Requiring
    // the conservative margin for a color edit prevents repainting a door while
    // standing next to its actual smaller player capsule. Geometry edits still
    // run the original checks; live identity and formal validation are retained.
    if(placementChanged(item,updated))validatePlacement(updated,next.entities,snapshot);Object.assign(item,updated);affectedIds.push(item.id);
  } else if(request.action==='duplicate'){
    keys(request,['operationId','expected','action','targetId','count','offset']);const original=selected();
    check(Number.isInteger(request.count)&&request.count>=1&&request.count<=8&&vector(request.offset,-8,8)&&Math.hypot(...request.offset)>=.5,'CREATION_DUPLICATE_LIMIT');
    check(next.entities.length+request.count<=128,'CREATION_ENTITY_LIMIT');
    for(let index=1;index<=request.count;index++){
      const item=entity({...structuredClone(original),id:minted(index),position:original.position.map((value,i)=>value+request.offset[i]*index)});
      check(!used(item.id),'CREATION_DUPLICATE_ID');validatePlacement(item,next.entities,snapshot);next.entities.push(item);createdIds.push(item.id);affectedIds.push(item.id);
    }
  } else if(request.action==='delete'){
    keys(request,['operationId','expected','action','targetId']);const item=selected();
    // Authored scripts may reference entities beyond declaration fields. Until
    // a rule supplies a trusted dependency contract, deletion fails closed.
    check(!(next.rules??[]).length,'CREATION_DELETE_RULE_DEPENDENCY');
    next.entities=next.entities.filter(value=>value.id!==item.id);affectedIds.push(item.id);
  } else if(request.action==='undo'){
    keys(request,['operationId','expected','action','undoOperationId']);
    const original=journal.operations.find(op=>op.operationId===request.undoOperationId);
    check(original&&original.inverse?.format==='craftmine.creation-inverse/1','CREATION_UNDO_UNSUPPORTED');
    check(!journal.operations.some(op=>op.receipt.undoOperationId===request.undoOperationId),'CREATION_ALREADY_UNDONE');
    const inverse=original.inverse;
    check(['place','modify','duplicate','delete'].includes(original.receipt.action)&&Array.isArray(inverse.before)&&Array.isArray(inverse.after),'CREATION_UNDO_UNSUPPORTED');
    keys(inverse,['format','before','after']);
    const ids=new Set([...inverse.before,...inverse.after].map(item=>entity(item).id));
    check(Array.isArray(original.receipt.affectedIds)&&ids.size===original.receipt.affectedIds.length&&original.receipt.affectedIds.every(id=>ids.has(id))&&new Set(inverse.before.map(item=>item.id)).size===inverse.before.length&&new Set(inverse.after.map(item=>item.id)).size===inverse.after.length,'CREATION_UNDO_INVALID');
    for(const before of inverse.before){const after=inverse.after.find(item=>item.id===before.id);if(after){check(before.kind===after.kind,'CREATION_UNDO_INVALID');if(before.kind==='chest')check(JSON.stringify(canonical(before.parameters))===JSON.stringify(canonical(after.parameters)),'CREATION_CHEST_REWARD_IMMUTABLE');}}
    check(ids.size>0&&ids.size<=8,'CREATION_UNDO_INVALID');
    const actual=next.entities.filter(item=>ids.has(item.id));
    const sorted=items=>JSON.stringify(canonical([...items].sort((a,b)=>a.id.localeCompare(b.id))));
    check(sorted(actual)===sorted(inverse.after),'CREATION_UNDO_CONFLICT');
    if(inverse.after.some(item=>!inverse.before.some(before=>before.id===item.id)))check(!(next.rules??[]).length,'CREATION_DELETE_RULE_DEPENDENCY');
    const rest=[...next.entities.filter(item=>!ids.has(item.id)),...structuredClone(inverse.before)];
    // Validate against the complete final set, including unchanged peers which
    // need no placement check of their own. Journal order must not hide them.
    for(const item of inverse.before)if(placementChanged(actual.find(current=>current.id===item.id),item))validatePlacement(item,rest,snapshot);
    next.entities=rest;affectedIds.push(...ids);
  } else if(request.action==='environment'){
    keys(request,['operationId','expected','action','timeOfDay']);check(finite(request.timeOfDay,0,24),'CREATION_INVALID_DEFAULTS');next.defaults.timeOfDay=request.timeOfDay;
  } else if(request.action==='sequence-door'){
    keys(request,['operationId','expected','action','ruleId','doorId','sequence']);check((next.rules??[]).every(rule=>rule.id!==request.ruleId),'CREATION_RULE_ID_IMMUTABLE');
    const generated=generateSequenceDoorRule({id:request.ruleId,doorId:request.doorId,sequence:request.sequence});
    check(!source.files[generated.declaration.script],'CREATION_RULE_SOURCE_EXISTS');
    next.rules=[...(next.rules??[]),generated.declaration];extra.push({op:'put',path:generated.declaration.script,text:generated.text,expectedHash:null});affectedIds.push(request.doorId,...new Set(request.sequence));
  } else fail('CREATION_ACTION_UNSUPPORTED');
  next.revision++;scene(next);
  const receipt={format:'craftmine.creation-operation/1',operationId:request.operationId,action:request.action,worldId:source.worldId,buildId:source.buildId,instanceId:source.instanceId,sourceRevision:source.revision,manifestHash:source.manifestHash,targetSnapshotId:snapshot.snapshotId,operationCount:journal.operations.length+1,operationLimit:MAX_OPERATIONS,operationsRemaining:MAX_OPERATIONS-journal.operations.length-1,beforeRevision:document.revision,afterRevision:next.revision,affectedIds,createdIds,requestHash};
  if(request.action==='undo')receipt.undoOperationId=request.undoOperationId;
  const reversible=['place','modify','duplicate','delete'].includes(request.action);
  const inverse=reversible?{format:'craftmine.creation-inverse/1',before:document.entities.filter(item=>affectedIds.includes(item.id)),after:next.entities.filter(item=>affectedIds.includes(item.id))}:undefined;
  receipt.undoSupported=reversible;
  journal.operations.push({operationId:request.operationId,requestHash,receipt,...(inverse?{inverse}: {})});
  const operations=[{op:'put',path:SCENE_PATH,text:JSON.stringify(next,null,2)+'\n',expectedHash:sceneFile?.sha256??null},{op:'put',path:JOURNAL_PATH,text:JSON.stringify(journal,null,2)+'\n',expectedHash:journalFile?.sha256??null},...extra];
  check(operations.every(op=>Buffer.byteLength(op.text)<=(op.path===JOURNAL_PATH?CREATION_JOURNAL_BYTES:120000))&&Buffer.byteLength(JSON.stringify(operations))<=8*1024*1024,'CREATION_PATCH_TOO_LARGE');
  return {document:next,operations,receipt,changeSummary:summarizeCreationChange({before:document,after:next,receipt}),sourceBinding:{worldId:source.worldId,buildId:source.buildId,instanceId:source.instanceId,revision:source.revision,manifestHash:source.manifestHash},replayed:false};
}
module.exports={compileCreationOperation,creationOperationHash,SCENE_PATH,JOURNAL_PATH,MAX_OPERATIONS};
