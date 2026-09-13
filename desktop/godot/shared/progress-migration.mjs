import {createHash} from 'node:crypto';
// A failure keeps one stable code so callers, ledgers and tests never parse prose,
// and may carry bounded JSON-safe diagnostics: which snapshot failed, which path,
// which field and which key set or value shape. Never echo a whole snapshot back.
const DIAGNOSTIC_LIMIT=6,DIAGNOSTIC_FIELD=48;
const fail=(code,detail)=>{throw Object.assign(Error(detail===undefined?code:code+' '+canonicalProgressJson(detail)),{code,...(detail===undefined?{}:{detail})});};
const boundedName=value=>{const text=String(value);return text.length<=DIAGNOSTIC_FIELD?text:text.slice(0,DIAGNOSTIC_FIELD)+'...';};
const boundedNames=values=>[...values].sort().slice(0,DIAGNOSTIC_LIMIT).map(boundedName);
const valueKind=value=>typeof value==='number'?(Number.isFinite(value)?'number('+String(value)+')':'number(non-finite)'):value===null?'null':Array.isArray(value)?'array':typeof value;
const keyDetail=(problem,expected,actual)=>({problem,expectedKeys:boundedNames(expected),actualKeys:boundedNames(actual),unexpectedKeys:boundedNames([...actual].filter(key=>!expected.includes(key))),missingKeys:boundedNames([...expected].filter(key=>!actual.includes(key)))});
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function canonicalProgressJson(value,depth=0){
 if(depth>48)fail('MIGRATION_DEPTH_LIMIT');
 if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(item=>canonicalProgressJson(item,depth+1)).join(',')+']';
 if(object(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value)))return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalProgressJson(value[key],depth+1)).join(',')+'}';
 fail('MIGRATION_INVALID_JSON');
}
export const hashProgress=value=>createHash('sha256').update(canonicalProgressJson(value)).digest('hex');
const bodyKeys=['format','stateVersion','base','baseVersion','worldId','savedAt','player','equipment','inventory','targets','interactables','quests'].sort();
function envelope(value){
 if(!object(value)||canonicalProgressJson(Object.keys(value).sort())!==canonicalProgressJson(['format','worldId','baseId','baseVersion','stateVersion','body'].sort()))fail('MIGRATION_UNKNOWN_ENVELOPE');
 if(value.format!=='craftmine.godot-progress/1'||value.baseId!=='first-person'||value.baseVersion!=='0.1.0'||value.stateVersion!==1||typeof value.worldId!=='string'||!value.worldId)fail('MIGRATION_UNSUPPORTED_BASE');
 const body=value.body;if(!object(body)||canonicalProgressJson(Object.keys(body).sort())!==canonicalProgressJson(bodyKeys)||body.format!=='craftmine.godot-base-state/1'||body.base!==value.baseId||body.baseVersion!==value.baseVersion||body.worldId!==value.worldId||body.stateVersion!==1)fail('MIGRATION_UNKNOWN_NATIVE_SHAPE');
 if(Buffer.byteLength(canonicalProgressJson(value))>1048576)fail('MIGRATION_SIZE_LIMIT');
}
function collection(entries){
 if(!Array.isArray(entries)||entries.length>4096)fail('MIGRATION_INVALID_COLLECTION');const ids=new Map();
 for(const entry of entries){if(!object(entry)||typeof entry.id!=='string'||!entry.id||entry.id.length>256||ids.has(entry.id))fail('MIGRATION_INVALID_ENTITY_ID');ids.set(entry.id,entry);}
 return ids;
}
/** Pure derivation only. Defaults must come from a separately verified fresh
 * candidate runtime. The caller still must load and compare the entire result.
 * No supplied rules, paths or deletion semantics are accepted. */
export function deriveAdditiveProgress(previousSnapshot,defaultsSnapshot){
 if(previousSnapshot?.baseId==='creation-sandbox'||defaultsSnapshot?.baseId==='creation-sandbox')return deriveCreationProgress(previousSnapshot,defaultsSnapshot);
 envelope(previousSnapshot);envelope(defaultsSnapshot);
 for(const [side,state] of [['previous',previousSnapshot],['candidateDefaults',defaultsSnapshot]]){
  const equipment=state.body.equipment;
  if(!object(equipment))fail('MIGRATION_EQUIPMENT_SHAPE',{side,path:'/body/equipment',problem:'block-not-object',actual:valueKind(equipment)});
  const blockKeys=Object.keys(equipment).sort(),allowedKeys=['active','items'];
  if(canonicalProgressJson(blockKeys)!==canonicalProgressJson(allowedKeys))fail('MIGRATION_EQUIPMENT_SHAPE',{side,path:'/body/equipment',...keyDetail('block-keys',allowedKeys,blockKeys)});
  if(typeof equipment.active!=='string')fail('MIGRATION_EQUIPMENT_SHAPE',{side,path:'/body/equipment.active',problem:'active-not-string',actual:valueKind(equipment.active)});
  const items=collection(equipment.items);
  if(!items.has(equipment.active))fail('MIGRATION_EQUIPMENT_ACTIVE');
  for(const item of items.values()){
   const itemKeys=Object.keys(item).sort(),itemFields=['id','magazine','reserve'];
   if(canonicalProgressJson(itemKeys)!==canonicalProgressJson(itemFields))fail('MIGRATION_EQUIPMENT_SHAPE',{side,path:'/body/equipment/items',itemId:boundedName(item.id),...keyDetail('item-keys',itemFields,itemKeys)});
   for(const field of ['magazine','reserve'])if(!(Number.isSafeInteger(item[field])&&item[field]>=0&&item[field]<=99999))fail('MIGRATION_EQUIPMENT_SHAPE',{side,path:'/body/equipment/items',itemId:boundedName(item.id),problem:'item-ammunition',field:boundedName(field),expected:'safe integer 0..99999',actual:valueKind(item[field])});
  }
 }
 for(const key of ['format','worldId','baseId','baseVersion','stateVersion'])if(previousSnapshot[key]!==defaultsSnapshot[key])fail('MIGRATION_IDENTITY_CHANGED');
 const snapshot=JSON.parse(canonicalProgressJson(previousSnapshot)),added=[];
 for(const key of ['targets','interactables','equipment/items']){
  const keys=key.split('/'),read=state=>keys.reduce((value,part)=>value[part],state.body);
  const old=collection(read(previousSnapshot)),defaults=collection(read(defaultsSnapshot));
  for(const [id,entry]of old){const fresh=defaults.get(id);if(!fresh)fail('MIGRATION_ENTITY_REMOVED');if(canonicalProgressJson(Object.keys(entry).sort())!==canonicalProgressJson(Object.keys(fresh).sort()))fail('MIGRATION_ENTITY_SHAPE_CHANGED');for(const field of Object.keys(entry)){if(Array.isArray(entry[field])!==Array.isArray(fresh[field])||object(entry[field])!==object(fresh[field])||typeof entry[field]!==typeof fresh[field])fail('MIGRATION_ENTITY_SHAPE_CHANGED');}}
  // Follow real candidate scene order. Existing entries retain every value;
  // new identities use only values captured from that scene, never old clones.
  const entries=read(defaultsSnapshot).map(entry=>{if(old.has(entry.id))return JSON.parse(canonicalProgressJson(old.get(entry.id)));added.push({path:'/body/'+key,id:entry.id});return JSON.parse(canonicalProgressJson(entry));});
  if(keys.length===2)snapshot.body[keys[0]][keys[1]]=entries;else snapshot.body[key]=entries;
 }
 if(Buffer.byteLength(canonicalProgressJson(snapshot))>1048576)fail('MIGRATION_SIZE_LIMIT');
 return {format:'craftmine.godot-additive-progress/1',previousSnapshotHash:hashProgress(previousSnapshot),defaultsSnapshotHash:hashProgress(defaultsSnapshot),snapshotHash:hashProgress(snapshot),added,snapshot};
}

// Only declared ledgers gain fresh runtime defaults. Old ledger keys are kept,
// including removed objects, so a later reinstall cannot mint the reward again.
function deriveCreationProgress(previous,defaults){
 const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
 const id=key=>/^[a-z][a-z0-9_-]{0,63}$/.test(key);
 const number=(n,min,max)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
 const ledger=(value,valid)=>object(value)&&Object.keys(value).length<=4096&&Object.entries(value).every(([key,v])=>id(key)&&valid(v));
 for(const value of [previous,defaults]){
  if(!exact(value,['format','worldId','baseId','baseVersion','stateVersion','body'])||value.format!=='craftmine.godot-progress/1'||value.baseId!=='creation-sandbox'||value.baseVersion!=='1.0.0'||value.stateVersion!==1||typeof value.worldId!=='string'||!value.worldId)fail('MIGRATION_UNSUPPORTED_BASE');
  const b=value.body;
  if(!exact(b,['format','worldId','baseVersion','player','timeOfDay','sourceTimeOfDay','inventory','openedChests','doors','rules',...(Object.hasOwn(b??{},'components')?['components']:[])])||b.format!=='craftmine.creation-progress/1'||b.worldId!==value.worldId||b.baseVersion!==value.baseVersion)fail('MIGRATION_UNKNOWN_NATIVE_SHAPE');
  validateComponentLedger(Object.hasOwn(b,'components')?b.components:{});
  // Creation source owns world geometry. Derivation preserves a finite pose;
  // the actual candidate restore still validates its bounds and collision.
  if(!exact(b.player,['position','yaw','pitch','onFloor'])||!Array.isArray(b.player.position)||b.player.position.length!==3||!b.player.position.every(n=>typeof n==='number'&&Number.isFinite(n))||!number(b.player.yaw,-Math.PI,Math.PI)||!number(b.player.pitch,-89*Math.PI/180,89*Math.PI/180)||typeof b.player.onFloor!=='boolean'||!number(b.timeOfDay,0,24)||!number(b.sourceTimeOfDay,0,24))fail('MIGRATION_CREATION_STATE_INVALID');
  if(!ledger(b.inventory,n=>Number.isSafeInteger(n)&&n>=0&&n<=999999)||!ledger(b.openedChests,n=>n===true)||!ledger(b.doors,n=>typeof n==='boolean')||!ledger(b.rules,object))fail('MIGRATION_CREATION_STATE_INVALID');
  if(Buffer.byteLength(canonicalProgressJson(value))>1048576)fail('MIGRATION_SIZE_LIMIT');
 }
 if(previous.worldId!==defaults.worldId)fail('MIGRATION_IDENTITY_CHANGED');
 const snapshot=JSON.parse(canonicalProgressJson(previous)),added=[];
 for(const key of ['doors','rules'])for(const id of Object.keys(defaults.body[key]).sort()){
  if(!Object.hasOwn(snapshot.body[key],id)){snapshot.body[key][id]=structuredClone(defaults.body[key][id]);added.push({path:'/body/'+key,id});}
 }
 if(Object.hasOwn(previous.body,'components')||Object.hasOwn(defaults.body,'components')){
  snapshot.body.components=structuredClone(previous.body.components??{});
  for(const [id,fresh] of Object.entries(defaults.body.components??{}).sort(([a],[b])=>a<b?-1:a>b?1:0)){
   const old=Object.hasOwn(snapshot.body.components,id)?snapshot.body.components[id]:null;
   if(!old){snapshot.body.components[id]=structuredClone(fresh);added.push({path:'/body/components',id});continue;}
   if(old.format!==fresh.format||canonicalProgressJson(Object.keys(old.sourceSettings).sort())!==canonicalProgressJson(Object.keys(fresh.sourceSettings).sort()))fail('MIGRATION_COMPONENT_SCHEMA_CHANGED');
   for(const key of Object.keys(fresh.sourceSettings)){
    if(typeof old.sourceSettings[key]!==typeof fresh.sourceSettings[key])fail('MIGRATION_COMPONENT_SCHEMA_CHANGED');
    if(canonicalProgressJson(old.sourceSettings[key])!==canonicalProgressJson(fresh.sourceSettings[key]))old.settings[key]=structuredClone(fresh.settings[key]);
   }
   old.sourceSettings=structuredClone(fresh.sourceSettings);
  }
  validateComponentLedger(snapshot.body.components);
 }
 if(previous.body.sourceTimeOfDay!==defaults.body.sourceTimeOfDay){snapshot.body.timeOfDay=defaults.body.sourceTimeOfDay;snapshot.body.sourceTimeOfDay=defaults.body.sourceTimeOfDay;}
 if(Buffer.byteLength(canonicalProgressJson(snapshot))>1048576)fail('MIGRATION_SIZE_LIMIT');
 return {format:'craftmine.godot-additive-progress/1',previousSnapshotHash:hashProgress(previous),defaultsSnapshotHash:hashProgress(defaults),snapshotHash:hashProgress(snapshot),added,snapshot};
}

function validateComponentLedger(ledger){
 const validId=id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id);
 const textFits=(v,max)=>v.length<=max*2&&[...v].length<=max;
 const safe=(v,depth=0)=>depth<=8&&(v===null||typeof v==='boolean'||typeof v==='string'&&textFits(v,4096)||typeof v==='number'&&Number.isFinite(v)||Array.isArray(v)&&v.length<=1024&&v.every(x=>safe(x,depth+1))||object(v)&&Object.keys(v).length<=128&&Object.entries(v).every(([k,x])=>textFits(k,128)&&safe(x,depth+1)));
 if(!object(ledger)||Object.keys(ledger).length>64)fail('MIGRATION_COMPONENT_STATE_INVALID');
 for(const [id,state]of Object.entries(ledger)){
  if(!validId(id)||!object(state)||!safe(state)||Buffer.byteLength(canonicalProgressJson(state))>65536||state.entityId!==id||typeof state.format!=='string'||!state.format||!textFits(state.format,128)||!object(state.settings)||!object(state.sourceSettings)||Object.keys(state.sourceSettings).length>16||canonicalProgressJson(Object.keys(state.settings).sort())!==canonicalProgressJson(Object.keys(state.sourceSettings).sort()))fail('MIGRATION_COMPONENT_STATE_INVALID');
  for(const key of Object.keys(state.sourceSettings))if(!validId(key)||object(state.sourceSettings[key])||Array.isArray(state.sourceSettings[key])||object(state.settings[key])||Array.isArray(state.settings[key])||typeof state.sourceSettings[key]!==typeof state.settings[key])fail('MIGRATION_COMPONENT_STATE_INVALID');
 }
}
