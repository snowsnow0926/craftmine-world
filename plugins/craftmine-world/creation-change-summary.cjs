'use strict';
// Source-level explanation only. No script evaluation, save writes, or new
// authority to skip the existing candidate and progress checks.
const {isDeepStrictEqual}=require('node:util');
const fields=['position','rotationY','scale','color','parameters'];
const clone=value=>JSON.parse(JSON.stringify(value));
function summarizeCreationChange({before,after,receipt,provenance='compiled-source'}){
 const envelope={format:'craftmine.creation-change-summary/1',provenance,authority:'advisory-source-diff',
  source:{worldId:receipt.worldId,buildId:receipt.buildId,instanceId:receipt.instanceId,revision:receipt.sourceRevision,manifestHash:receipt.manifestHash},
  operationId:receipt.operationId,requestHash:receipt.requestHash,
  progress:{written:false,adoptionCompatibility:'not-assessed',instanceInitialization:'requires-formal-application'},
  checks:{canSkipFormalCheck:false,recommended:['engine-import','candidate-runtime-check','progress-migration-check']},
  limitations:['Source declarations do not establish runtime behavior or persisted progress.','Arbitrary scripts and shared external resources are not analyzed.']};
 if(!before||!after)return {...envelope,status:'unknown',reason:'ORIGINAL_CHANGE_DETAILS_NOT_RECORDED',entities:null,defaults:null,
  dependencies:{coverage:'not-recorded',rules:null,runtimeBehavior:'unknown'}};
 const old=new Map(before.entities.map(e=>[e.id,e])),next=new Map(after.entities.map(e=>[e.id,e]));
 const entities=[];
 for(const id of new Set([...old.keys(),...next.keys()])){
  const a=old.get(id),b=next.get(id);
  if(!a||!b){entities.push({id,kind:(b??a).kind,change:a?'removed':'added',declaration:clone(b??a)});continue;}
  const changes=fields.filter(field=>!isDeepStrictEqual(a[field],b[field])).map(field=>({field,before:clone(a[field]),after:clone(b[field])}));
  if(changes.length)entities.push({id,kind:b.kind,change:'modified',fields:changes});
 }
 const affected=new Set(receipt.affectedIds??[]),rules=new Map();
 for(const rule of [...(before.rules??[]),...(after.rules??[])]){
  const refs=rule.kind==='sequence-door'?[rule.doorId,...rule.sequence]:rule.entityIds;
  if(refs.some(id=>affected.has(id)))rules.set(rule.id,{id:rule.id,kind:rule.kind,script:rule.script,entityIds:[...new Set(refs)].filter(id=>affected.has(id))});
 }
 const defaults=before.defaults&&after.defaults?Object.keys(after.defaults).filter(field=>!isDeepStrictEqual(before.defaults[field],after.defaults[field]))
  .map(field=>({field,before:clone(before.defaults[field]),after:clone(after.defaults[field])})):null;
 return {...envelope,status:'known',entities,defaults,
  dependencies:{coverage:provenance==='journal-inverse'?'not-recorded':'creation-rule-declarations-only',
   rules:provenance==='journal-inverse'?null:[...rules.values()],runtimeBehavior:'unknown'}};
}
module.exports={summarizeCreationChange};
