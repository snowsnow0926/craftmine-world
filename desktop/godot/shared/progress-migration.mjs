import {createHash} from 'node:crypto';
const fail=code=>{throw Object.assign(Error(code),{code});};
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
 envelope(previousSnapshot);envelope(defaultsSnapshot);
 for(const key of ['format','worldId','baseId','baseVersion','stateVersion'])if(previousSnapshot[key]!==defaultsSnapshot[key])fail('MIGRATION_IDENTITY_CHANGED');
 const snapshot=JSON.parse(canonicalProgressJson(previousSnapshot)),added=[];
 for(const key of ['targets','interactables']){
  const old=collection(previousSnapshot.body[key]),defaults=collection(defaultsSnapshot.body[key]);
  for(const [id,entry]of old){const fresh=defaults.get(id);if(!fresh)fail('MIGRATION_ENTITY_REMOVED');if(canonicalProgressJson(Object.keys(entry).sort())!==canonicalProgressJson(Object.keys(fresh).sort()))fail('MIGRATION_ENTITY_SHAPE_CHANGED');for(const field of Object.keys(entry)){if(Array.isArray(entry[field])!==Array.isArray(fresh[field])||object(entry[field])!==object(fresh[field])||typeof entry[field]!==typeof fresh[field])fail('MIGRATION_ENTITY_SHAPE_CHANGED');}}
  // Follow real candidate scene order. Existing entries retain every value;
  // new identities use only values captured from that scene, never old clones.
  snapshot.body[key]=defaultsSnapshot.body[key].map(entry=>{if(old.has(entry.id))return JSON.parse(canonicalProgressJson(old.get(entry.id)));added.push({path:'/body/'+key,id:entry.id});return JSON.parse(canonicalProgressJson(entry));});
 }
 if(Buffer.byteLength(canonicalProgressJson(snapshot))>1048576)fail('MIGRATION_SIZE_LIMIT');
 return {format:'craftmine.godot-additive-progress/1',previousSnapshotHash:hashProgress(previousSnapshot),defaultsSnapshotHash:hashProgress(defaultsSnapshot),snapshotHash:hashProgress(snapshot),added,snapshot};
}
