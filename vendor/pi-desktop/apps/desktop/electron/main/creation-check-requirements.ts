import {createHash} from 'node:crypto';
import {parseCreationWishIntent} from './creation-wish-intent.ts';
import {resolveCreationSequenceIntent} from './creation-sequence-intent.ts';
export type CreationEntity = {id:string;kind:string;position:number[];rotationY?:number;scale:number[];color?:string;parameters?:{label?:unknown};open?:boolean;visible?:boolean;solid?:boolean;presenceMutable?:boolean;solidMutable?:boolean;bounds?:{min:number[];max:number[]}};
export type CreationRequirement = {format:'craftmine.creation-requirements/1';requestHash:string;entities:Array<{id?:string;kind?:string;position?:number[];rotationY?:number;scale?:number[];color?:string;declaredLabel?:string;visible?:boolean;solid?:boolean;absent?:boolean;excludeIds?:string[]}>;counts:Array<{kind:string;count:number}>;doorSequence?:{doorId:string;steps:string[];verifyPassage?:true;controllerProfile?:'creation-fixed-controller/1'};harvest?:{entityId:string;inventoryId:"wood";reward:1;regrowFrames:300};timeOfDay?:18;duplicates?:{kind:string;count:2;scale:number[];color:string;priorIds:string[]}};
export type FrozenCreationRequirement = {status:'verifiable';requirements:CreationRequirement}|{status:'unverified';reason:string};
export type DirectCreationIntent = {action:'modify';targetId:string;changes:{scale?:number[];color?:string;position?:number[];rotationY?:number}}|{action:'delete';targetId:string}|{action:'undo';undoOperationId:string;formalJournal:unknown}|{action:'place';kind:'tree'|'rock'|'chest'|'door'|'marker';scale:number[];color:string;position?:number[];rotationY?:number}|{action:'duplicate';targetId:string;count:number;offset:number[]};
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const kinds=['tree','rock','chest','door','marker'];
const vector=(value:unknown):value is number[]=>Array.isArray(value)&&value.length===3&&value.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=100000);
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v);
// Runtime progress owns presence for declared entity behaviors; keep static objects exact.
const frozenPresence=(e:CreationEntity)=>e.presenceMutable===true?{}:{...(typeof e.visible==='boolean'?{visible:e.visible}:{}),...(e.solidMutable!==true&&typeof e.solid==='boolean'?{solid:e.solid}:{})};
export function validCreationRequirement(value:any):value is CreationRequirement {
 if(!value||value.format!=='craftmine.creation-requirements/1'||!/^[a-f0-9]{64}$/.test(value.requestHash)||!Array.isArray(value.entities)||!Array.isArray(value.counts)||value.entities.length>256||value.counts.length>5||value.entities.length+value.counts.length===0&&!value.doorSequence&&!value.harvest&&value.timeOfDay===undefined&&!value.duplicates)return false;
 if(Object.keys(value).some(k=>!['format','requestHash','entities','counts','doorSequence','harvest','timeOfDay','duplicates'].includes(k)))return false;
 for(const key of ['doorSequence','harvest','duplicates'])if(value[key]!==undefined&&(!value[key]||typeof value[key]!=='object'||Array.isArray(value[key])))return false;
 if(value.timeOfDay!==undefined&&value.timeOfDay!==18)return false;
 if(value.duplicates&&(!kinds.includes(value.duplicates.kind)||value.duplicates.count!==2||(!vector(value.duplicates.scale)||!value.duplicates.scale.every((n:number)=>n>0&&n<=20))||!/^#[a-fA-F0-9]{6}$/.test(value.duplicates.color)||!Array.isArray(value.duplicates.priorIds)||value.duplicates.priorIds.length>256||!value.duplicates.priorIds.every(id)||Object.keys(value.duplicates).sort().join(',')!=='color,count,kind,priorIds,scale'))return false;
 if(value.harvest&&(!id(value.harvest.entityId)||value.harvest.inventoryId!=='wood'||value.harvest.reward!==1||value.harvest.regrowFrames!==300||Object.keys(value.harvest).sort().join(',')!=='entityId,inventoryId,regrowFrames,reward'))return false;
 if(value.doorSequence&&(!id(value.doorSequence.doorId)||!Array.isArray(value.doorSequence.steps)||value.doorSequence.steps.length<2||value.doorSequence.steps.length>8||!value.doorSequence.steps.every(id)||new Set(value.doorSequence.steps).size!==value.doorSequence.steps.length||Object.keys(value.doorSequence).some(k=>!['doorId','steps','verifyPassage','controllerProfile'].includes(k))||(Object.hasOwn(value.doorSequence,'verifyPassage')&&value.doorSequence.verifyPassage!==true)))return false;
 if(value.doorSequence&&Object.hasOwn(value.doorSequence,'controllerProfile')&&(value.doorSequence.controllerProfile!=='creation-fixed-controller/1'||value.doorSequence.verifyPassage!==true))return false;
 if(value.doorSequence?.verifyPassage===true&&value.entities.filter((e:any)=>e?.id===value.doorSequence.doorId&&e.kind==='door'&&vector(e.position)&&vector(e.scale)).length!==1)return false;
 return value.entities.every((e:any)=>e&&Object.keys(e).every(k=>['id','kind','position','rotationY','scale','color','declaredLabel','visible','solid','absent','excludeIds'].includes(k))&&(e.id===undefined||id(e.id))&&(e.kind===undefined||kinds.includes(e.kind))&&(e.id!==undefined||e.kind!==undefined)&&(e.position===undefined||vector(e.position))&&(e.rotationY===undefined||typeof e.rotationY==='number'&&Number.isFinite(e.rotationY)&&Math.abs(e.rotationY)<=180)&&(e.scale===undefined||vector(e.scale)&&e.scale.every((n:number)=>n>0&&n<=20))&&(e.color===undefined||/^#[a-fA-F0-9]{6}$/.test(e.color))&&(e.declaredLabel===undefined||e.kind==='marker'&&typeof e.declaredLabel==='string'&&e.declaredLabel.length<=80)&&(e.visible===undefined||typeof e.visible==='boolean')&&(e.solid===undefined||typeof e.solid==='boolean')&&(e.absent===undefined||e.absent===true&&id(e.id))&&(e.excludeIds===undefined||Array.isArray(e.excludeIds)&&e.excludeIds.length<=256&&e.excludeIds.every(id)))&&value.counts.every((c:any)=>c&&Object.keys(c).sort().join(',')==='count,kind'&&kinds.includes(c.kind)&&Number.isInteger(c.count)&&c.count>=0&&c.count<=256);
}
// Only exact, bounded sentences are recognized. A trailing extra wish is never dropped.
export function freezeCreationRequirements(capture:{target:{entityId:string|null;position:number[]|null};source?:'ray'|'recent';entities?:CreationEntity[]},input:string|DirectCreationIntent):FrozenCreationRequirement {
 if(typeof input!=='string'&&input.action==='undo')return freezeUndoRequirements(capture,input.formalJournal,input.undoOperationId);
 const unknown:FrozenCreationRequirement={status:'unverified',reason:'CREATION_REQUIREMENTS_NEED_REVIEW'};
 if(!Array.isArray(capture.entities)||capture.entities.length>256||capture.entities.some(e=>!id(e?.id)||!kinds.includes(e.kind)||!vector(e.position)||!vector(e.scale)))return unknown;
 const all=capture.entities,selected=all.find(e=>e.id===capture.target.entityId);
 const r:CreationRequirement={format:'craftmine.creation-requirements/1',requestHash:hash(typeof input==='string'?input:JSON.stringify(input)),entities:[],counts:[]};
 if(typeof input==='string'){
  let text=input.trim().replace(/[。！!]$/,'');
  if(text==='把这棵树变大一倍')text='把这棵树放大到2倍';
  if(text.includes('这棵树')&&selected?.kind!=='tree')return unknown;
  if(text==='在这里再放一块石头，保留已有物体和游玩进度')text='在这里放一块石头';
  if(text==='在这个副本的这里放一棵树，保留之前的内容')text='在这里放一棵树';
  const wish=parseCreationWishIntent(text);
  if(wish?.action==='place'&&capture.source==='recent')return unknown;
  if(text==='让这棵树可以按E砍伐，砍掉时给背包增加一块木头，5秒后重新长出来。保存重开后保留木头和树的生长状态'&&selected?.kind==='tree'){r.harvest={entityId:selected.id,inventoryId:'wood',reward:1,regrowFrames:300};r.entities.push({id:selected.id,kind:'tree',position:[...selected.position],...(Number.isFinite(selected.rotationY)?{rotationY:selected.rotationY}:{}),scale:[...selected.scale]});}
  else if(text==='把时间设为18点'){r.timeOfDay=18;}
  else if(wish?.action==='modify'&&selected){
   if(wish.referenceKind!==undefined&&selected.kind!==wish.referenceKind)return unknown;
   const scale=wish.scaleFactor===undefined?[...selected.scale]:selected.scale.map(n=>n*wish.scaleFactor!);
   if(scale.some(n=>n<.25||n>4))return unknown;
   r.entities.push({id:selected.id,kind:selected.kind,position:[...selected.position],scale,...(selected.color?{color:selected.color}:{}),...(wish.color?{color:wish.color}:{}),...frozenPresence(selected)});
  }
  else if(text==='复制这棵树两个，排开一点'&&selected?.kind==='tree'&&selected.color){r.duplicates={kind:'tree',count:2,scale:[...selected.scale],color:selected.color,priorIds:all.map(e=>e.id)};r.counts.push({kind:'tree',count:all.filter(e=>e.kind==='tree').length+2});}
  else if(wish?.action==='place'&&capture.target.position){const kind=wish.kind;r.entities.push({kind,position:capture.target.position.map(n=>Math.round(n*1000)/1000),...(wish.color?{color:wish.color}:{}),...(wish.scale?{scale:wish.scale}:{}),excludeIds:all.map(e=>e.id),visible:true,solid:true});r.counts.push({kind,count:all.filter(e=>e.kind===kind).length+1});}
  else if(/^(?:请)?删除(?:这个对象|这棵树|它)$/.test(text)&&selected){r.entities.push({id:selected.id,absent:true});r.counts.push({kind:selected.kind,count:all.filter(e=>e.kind===selected.kind).length-1});}
  else {const sequence=resolveCreationSequenceIntent(input,capture);if(!sequence)return unknown;const {steps,doorId}=sequence;r.doorSequence={doorId,steps,verifyPassage:true,controllerProfile:'creation-fixed-controller/1'};r.entities.push(...[doorId,...steps].map(id=>{const e=all.find(e=>e.id===id)!;return {id,kind:e.kind,position:[...e.position],...(Number.isFinite(e.rotationY)?{rotationY:e.rotationY}:{}),scale:[...e.scale],...(e.color?{color:e.color}:{}),...(e.kind==='marker'&&typeof e.parameters?.label==='string'?{declaredLabel:e.parameters.label}:{}),...frozenPresence(e)};}));}
 }else{
  if(input.action==='place'){
   if(capture.source==='recent')return unknown;
   if(!kinds.includes(input.kind)||!vector(capture.target.position)||!vector(input.scale)||!/^#[a-fA-F0-9]{6}$/.test(input.color))return unknown;
   r.entities.push({kind:input.kind,position:[...(input.position??capture.target.position)],...(input.rotationY!==undefined?{rotationY:input.rotationY}:{}),scale:[...input.scale],color:input.color,excludeIds:all.map(e=>e.id),visible:true,solid:true});r.counts.push({kind:input.kind,count:all.filter(e=>e.kind===input.kind).length+1});
  }else{
  if(!selected||input.targetId!==selected.id)return unknown;
  if(input.action==='duplicate'){
   if(!Number.isInteger(input.count)||input.count<1||input.count>8||!vector(input.offset)||input.offset.some(n=>Math.abs(n)>8)||Math.hypot(...input.offset)<.5||!selected.color)return unknown;
   // Duplicates inherit the source declaration, not another entity's played state.
   const initiallyOpen=(selected as CreationEntity&{parameters?:{initiallyOpen?:boolean}}).parameters?.initiallyOpen===true;
   for(let i=1;i<=input.count;i++)r.entities.push({kind:selected.kind,position:selected.position.map((n,axis)=>n+input.offset[axis]*i),scale:[...selected.scale],color:selected.color,excludeIds:all.map(e=>e.id),visible:true,solid:selected.kind==='door'?!initiallyOpen:true});
   r.counts.push({kind:selected.kind,count:all.filter(e=>e.kind===selected.kind).length+input.count});
  }else if(input.action==='delete'){r.entities.push({id:selected.id,absent:true});r.counts.push({kind:selected.kind,count:all.filter(e=>e.kind===selected.kind).length-1});}
  else if(input.action==='modify'&&Object.keys(input.changes).length&&Object.keys(input.changes).every(k=>['scale','color','position','rotationY'].includes(k)))r.entities.push({id:selected.id,kind:selected.kind,position:[...selected.position],scale:[...selected.scale],...(selected.color?{color:selected.color}:{}),...frozenPresence(selected),...input.changes});else return unknown;
  }
 }
 const changedIds=new Set(r.entities.map(e=>e.id).filter(Boolean));
 for(const e of all)if(!changedIds.has(e.id))r.entities.push({id:e.id,kind:e.kind,position:[...e.position],...(Number.isFinite(e.rotationY)?{rotationY:e.rotationY}:{}),scale:[...e.scale],...(e.color?{color:e.color}:{}),...frozenPresence(e)});
 for(const kind of kinds)if(!r.counts.some(c=>c.kind===kind))r.counts.push({kind,count:all.filter(e=>e.kind===kind).length});
 return validCreationRequirement(r)?{status:'verifiable',requirements:r}:unknown;
}
export function creationRequirementsHash(r:CreationRequirement):string{const canonical=(v:any):any=>{if(typeof v==='number'){const b=Buffer.alloc(8);b.writeDoubleBE(v===0?0:v);return {$f64:b.toString('hex')};}return Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;};return hash(JSON.stringify(canonical(r)));}
export function creationEntitiesMatch(r:CreationRequirement,entities:CreationEntity[]):boolean {
 if(!Array.isArray(entities)||entities.length>256||entities.some(e=>!id(e?.id)||!kinds.includes(e.kind)||!vector(e.position)||!vector(e.scale))||new Set(entities.map(e=>e.id)).size!==entities.length)return false;
 const close=(a:number[],b:number[])=>a.every((n,i)=>Math.abs(n-b[i])<=0.005);
 if(r.duplicates){const d=r.duplicates,copies=entities.filter(e=>!d.priorIds.includes(e.id)&&e.kind===d.kind);
  const bounds=(e:CreationEntity)=>e.bounds&&vector(e.bounds.min)&&vector(e.bounds.max)&&e.bounds.min.every((n,i)=>n<e.bounds!.max[i]);
  if(copies.length!==d.count||copies.some(e=>!close(e.scale,d.scale)||e.color?.toLowerCase()!==d.color.toLowerCase()||e.visible!==true||e.solid!==true||!bounds(e)||entities.some(other=>other.id!==e.id&&other.solid===true&&(!bounds(other)||[0,1,2].every(i=>e.bounds!.min[i]<other.bounds!.max[i]-0.001&&e.bounds!.max[i]>other.bounds!.min[i]+0.001)))))return false;
 }
 return r.counts.every(c=>entities.filter(e=>e.kind===c.kind).length===c.count)&&r.entities.every(w=>w.absent?!entities.some(e=>e.id===w.id):entities.filter(e=>(w.id===undefined||e.id===w.id)&&(w.kind===undefined||e.kind===w.kind)&&!w.excludeIds?.includes(e.id)&&(w.position===undefined||close(e.position,w.position))&&(w.rotationY===undefined||typeof e.rotationY==='number'&&Math.abs((((e.rotationY-w.rotationY)%360)+540)%360-180)<=0.005)&&(w.scale===undefined||close(e.scale,w.scale))&&(w.color===undefined||e.color?.toLowerCase()===w.color.toLowerCase())&&(w.declaredLabel===undefined||e.parameters?.label===w.declaredLabel)&&(w.visible===undefined||e.visible===w.visible)&&(w.solid===undefined||e.solid===w.solid)).length===1);
}

export function assertCreationJobRequirements(capture:{creationRequirements?:FrozenCreationRequirement},job:any):void {
 const frozen=capture.creationRequirements;
 if(frozen?.status!=='verifiable')throw Error('CREATION_REQUIREMENTS_NEED_REVIEW');
 if(job?.checkRequirementsHash!==creationRequirementsHash(frozen.requirements)||!job.checkRequirements?.creation||creationRequirementsHash(job.checkRequirements.creation)!==creationRequirementsHash(frozen.requirements))throw Error('CREATION_REQUIREMENTS_NOT_BOUND');
}

// The caller must obtain this journal from the formal build before the edit
// task can write; a model-provided working journal is not authoritative.
export function freezeUndoRequirements(capture:{entities?:CreationEntity[]},formalJournal:any,operationId:string):FrozenCreationRequirement {
 const unknown:FrozenCreationRequirement={status:'unverified',reason:'CREATION_UNDO_REQUIREMENTS_UNAVAILABLE'};
 if(formalJournal?.format!=='craftmine.creation-operations/1'||!Array.isArray(formalJournal.operations)||formalJournal.operations.length>4096||!capture.entities)return unknown;
 const entries=formalJournal.operations.filter((entry:any)=>entry.operationId===operationId);
 if(entries.length!==1||formalJournal.operations.some((entry:any)=>entry.receipt?.undoOperationId===operationId))return unknown;
 const entry=entries[0],inverse=entry.inverse;
 if(entry.receipt?.undoSupported!==true||inverse?.format!=='craftmine.creation-inverse/1'||!Array.isArray(inverse.before)||!Array.isArray(inverse.after)||inverse.before.length>8||inverse.after.length>8)return unknown;
 if([...inverse.before,...inverse.after].some(e=>!id(e?.id)||!kinds.includes(e.kind)||!vector(e.position)||!vector(e.scale)))return unknown;
 const ids=[...new Set<string>([...inverse.before,...inverse.after].map((e:any)=>e.id))];
 if(!ids.length||ids.length>8||ids.some(i=>!id(i)))return unknown;
 const actual=capture.entities.filter(e=>ids.includes(e.id));
 if(actual.length!==inverse.after.length||inverse.after.some((e:any)=>!actual.some(a=>a.id===e.id&&a.kind===e.kind&&a.position.every((n,i)=>Math.abs(n-e.position[i])<=0.00001)&&a.scale.every((n,i)=>Math.abs(n-e.scale[i])<=0.00001)&&a.color?.toLowerCase()===e.color?.toLowerCase()&&(e.rotationY===undefined||typeof a.rotationY==='number'&&Math.abs((((a.rotationY-e.rotationY)%360)+540)%360-180)<=0.005))))return unknown;
 const r:CreationRequirement={format:'craftmine.creation-requirements/1',requestHash:hash(JSON.stringify(['undo',operationId,inverse])),entities:ids.map(id=>{const before=inverse.before.find((e:any)=>e.id===id);return before?{id,kind:before.kind,position:before.position,...(Number.isFinite(before.rotationY)?{rotationY:before.rotationY}:{}),scale:before.scale,...(before.color?{color:before.color}:{})}:{id,absent:true};}),counts:kinds.map(kind=>({kind,count:capture.entities!.filter(e=>e.kind===kind&&!ids.includes(e.id)).length+inverse.before.filter((e:any)=>e.kind===kind).length}))};
 for(const e of capture.entities)if(!ids.includes(e.id))r.entities.push({id:e.id,kind:e.kind,position:[...e.position],...(Number.isFinite(e.rotationY)?{rotationY:e.rotationY}:{}),scale:[...e.scale],...(e.color?{color:e.color}:{}),...frozenPresence(e)});
 return validCreationRequirement(r)?{status:'verifiable',requirements:r}:unknown;
}
