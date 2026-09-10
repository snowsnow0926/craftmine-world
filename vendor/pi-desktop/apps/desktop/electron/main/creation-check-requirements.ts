import {createHash} from 'node:crypto';
export type CreationEntity = {id:string;kind:string;position:number[];scale:number[];color?:string;open?:boolean;visible?:boolean;solid?:boolean;bounds?:{min:number[];max:number[]}};
export type CreationRequirement = {format:'craftmine.creation-requirements/1';requestHash:string;entities:Array<{id?:string;kind?:string;position?:number[];scale?:number[];color?:string;absent?:boolean;excludeIds?:string[]}>;counts:Array<{kind:string;count:number}>;doorSequence?:{doorId:string;steps:string[]};harvest?:{entityId:string;inventoryId:"wood";reward:1;regrowFrames:300};timeOfDay?:18;duplicates?:{kind:string;count:2;scale:number[];color:string;priorIds:string[]}};
export type FrozenCreationRequirement = {status:'verifiable';requirements:CreationRequirement}|{status:'unverified';reason:string};
export type DirectCreationIntent = {action:'modify';targetId:string;changes:{scale?:number[];color?:string}}|{action:'delete';targetId:string}|{action:'undo';undoOperationId:string;formalJournal:unknown};
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const kinds=['tree','rock','chest','door','marker'];
const vector=(value:unknown):value is number[]=>Array.isArray(value)&&value.length===3&&value.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=100000);
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v);
export function validCreationRequirement(value:any):value is CreationRequirement {
 if(!value||value.format!=='craftmine.creation-requirements/1'||!/^[a-f0-9]{64}$/.test(value.requestHash)||!Array.isArray(value.entities)||!Array.isArray(value.counts)||value.entities.length>256||value.counts.length>5||value.entities.length+value.counts.length===0&&!value.doorSequence&&!value.harvest&&value.timeOfDay===undefined&&!value.duplicates)return false;
 if(Object.keys(value).some(k=>!['format','requestHash','entities','counts','doorSequence','harvest','timeOfDay','duplicates'].includes(k)))return false;
 for(const key of ['doorSequence','harvest','duplicates'])if(value[key]!==undefined&&(!value[key]||typeof value[key]!=='object'||Array.isArray(value[key])))return false;
 if(value.timeOfDay!==undefined&&value.timeOfDay!==18)return false;
 if(value.duplicates&&(!kinds.includes(value.duplicates.kind)||value.duplicates.count!==2||(!vector(value.duplicates.scale)||!value.duplicates.scale.every((n:number)=>n>0&&n<=20))||!/^#[a-fA-F0-9]{6}$/.test(value.duplicates.color)||!Array.isArray(value.duplicates.priorIds)||value.duplicates.priorIds.length>256||!value.duplicates.priorIds.every(id)||Object.keys(value.duplicates).sort().join(',')!=='color,count,kind,priorIds,scale'))return false;
 if(value.harvest&&(!id(value.harvest.entityId)||value.harvest.inventoryId!=='wood'||value.harvest.reward!==1||value.harvest.regrowFrames!==300||Object.keys(value.harvest).sort().join(',')!=='entityId,inventoryId,regrowFrames,reward'))return false;
 if(value.doorSequence&&(!id(value.doorSequence.doorId)||!Array.isArray(value.doorSequence.steps)||value.doorSequence.steps.length<2||value.doorSequence.steps.length>8||!value.doorSequence.steps.every(id)||new Set(value.doorSequence.steps).size!==value.doorSequence.steps.length||Object.keys(value.doorSequence).sort().join(',')!=='doorId,steps'))return false;
 return value.entities.every((e:any)=>e&&Object.keys(e).every(k=>['id','kind','position','scale','color','absent','excludeIds'].includes(k))&&(e.id===undefined||id(e.id))&&(e.kind===undefined||kinds.includes(e.kind))&&(e.id!==undefined||e.kind!==undefined)&&(e.position===undefined||vector(e.position))&&(e.scale===undefined||vector(e.scale)&&e.scale.every((n:number)=>n>0&&n<=20))&&(e.color===undefined||/^#[a-fA-F0-9]{6}$/.test(e.color))&&(e.absent===undefined||e.absent===true&&id(e.id))&&(e.excludeIds===undefined||Array.isArray(e.excludeIds)&&e.excludeIds.length<=256&&e.excludeIds.every(id)))&&value.counts.every((c:any)=>c&&Object.keys(c).sort().join(',')==='count,kind'&&kinds.includes(c.kind)&&Number.isInteger(c.count)&&c.count>=0&&c.count<=256);
}
// Only exact, bounded sentences are recognized. A trailing extra wish is never dropped.
export function freezeCreationRequirements(capture:{target:{entityId:string|null;position:number[]|null};entities?:CreationEntity[]},input:string|DirectCreationIntent):FrozenCreationRequirement {
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
  const color=/^这棵树的颜色改成(#[a-fA-F0-9]{6})，其他东西保持原样$/.exec(text);
  const place=/^(?:请)?在这里放(?:置)?(?:一棵树|一块石头|一个箱子|一扇门|一个标记)$/.exec(text);
  const enlarge=/^(?:请)?把(?:这棵树|这个对象|它)(?:放大到|变为)([2-9])倍$/.exec(text);
  if(text==='让这棵树可以按E砍伐，砍掉时给背包增加一块木头，5秒后重新长出来。保存重开后保留木头和树的生长状态'&&selected?.kind==='tree'){r.harvest={entityId:selected.id,inventoryId:'wood',reward:1,regrowFrames:300};r.entities.push({id:selected.id,kind:'tree',position:[...selected.position],scale:[...selected.scale]});}
  else if(text==='把时间设为18点'){r.timeOfDay=18;}
  else if(color&&selected?.kind==='tree'){r.entities.push({id:selected.id,kind:'tree',position:selected.position,scale:selected.scale,color:color[1]});}
  else if(text==='复制这棵树两个，排开一点'&&selected?.kind==='tree'&&selected.color){r.duplicates={kind:'tree',count:2,scale:[...selected.scale],color:selected.color,priorIds:all.map(e=>e.id)};r.counts.push({kind:'tree',count:all.filter(e=>e.kind==='tree').length+2});}
  else if(place&&capture.target.position){const kind=text.endsWith('树')?'tree':text.endsWith('石头')?'rock':text.endsWith('箱子')?'chest':text.endsWith('门')?'door':'marker';r.entities.push({kind,position:capture.target.position.map(n=>Math.round(n*1000)/1000),excludeIds:all.map(e=>e.id)});r.counts.push({kind,count:all.filter(e=>e.kind===kind).length+1});}
  else if(enlarge&&selected){r.entities.push({id:selected.id,kind:selected.kind,position:[...selected.position],...(selected.color?{color:selected.color}:{}),scale:selected.scale.map(n=>n*Number(enlarge[1]))});}
  else if(/^(?:请)?删除(?:这个对象|这棵树|它)$/.test(text)&&selected){r.entities.push({id:selected.id,absent:true});r.counts.push({kind:selected.kind,count:all.filter(e=>e.kind===selected.kind).length-1});}
  else {const sequence=/^依次触碰([A-Za-z0-9._-]+(?:、[A-Za-z0-9._-]+){1,7})后打开([A-Za-z0-9._-]+)$/.exec(text);if(!sequence)return unknown;const steps=sequence[1].split('、'),doorId=sequence[2];if(!all.some(e=>e.id===doorId&&e.kind==='door')||!steps.every(id=>all.some(e=>e.id===id&&e.kind==='marker')))return unknown;r.doorSequence={doorId,steps};r.entities.push({id:doorId,kind:'door'},...steps.map(id=>({id,kind:'marker'})));}
 }else{
  if(!selected||input.targetId!==selected.id)return unknown;
  if(input.action==='delete'){r.entities.push({id:selected.id,absent:true});r.counts.push({kind:selected.kind,count:all.filter(e=>e.kind===selected.kind).length-1});}
  else if(input.action==='modify'&&Object.keys(input.changes).length&&Object.keys(input.changes).every(k=>['scale','color'].includes(k)))r.entities.push({id:selected.id,kind:selected.kind,position:[...selected.position],scale:[...selected.scale],...(selected.color?{color:selected.color}:{}),...input.changes});else return unknown;
 }
 const changedIds=new Set(r.entities.map(e=>e.id).filter(Boolean));
 for(const e of all)if(!changedIds.has(e.id))r.entities.push({id:e.id,kind:e.kind,position:[...e.position],scale:[...e.scale],...(e.color?{color:e.color}:{})});
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
 return r.counts.every(c=>entities.filter(e=>e.kind===c.kind).length===c.count)&&r.entities.every(w=>w.absent?!entities.some(e=>e.id===w.id):entities.filter(e=>(w.id===undefined||e.id===w.id)&&(w.kind===undefined||e.kind===w.kind)&&!w.excludeIds?.includes(e.id)&&(w.position===undefined||close(e.position,w.position))&&(w.scale===undefined||close(e.scale,w.scale))&&(w.color===undefined||e.color?.toLowerCase()===w.color.toLowerCase())).length===1);
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
 if(actual.length!==inverse.after.length||inverse.after.some((e:any)=>!actual.some(a=>a.id===e.id&&a.kind===e.kind&&a.position.every((n,i)=>Math.abs(n-e.position[i])<=0.00001)&&a.scale.every((n,i)=>Math.abs(n-e.scale[i])<=0.00001)&&a.color?.toLowerCase()===e.color?.toLowerCase())))return unknown;
 const r:CreationRequirement={format:'craftmine.creation-requirements/1',requestHash:hash(JSON.stringify(['undo',operationId,inverse])),entities:ids.map(id=>{const before=inverse.before.find((e:any)=>e.id===id);return before?{id,kind:before.kind,position:before.position,scale:before.scale,...(before.color?{color:before.color}:{})}:{id,absent:true};}),counts:kinds.map(kind=>({kind,count:capture.entities!.filter(e=>e.kind===kind&&!ids.includes(e.id)).length+inverse.before.filter((e:any)=>e.kind===kind).length}))};
 return validCreationRequirement(r)?{status:'verifiable',requirements:r}:unknown;
}
