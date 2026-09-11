/** Context for ordinary source editing, never a creation_operation entity. */
export type SceneNodeRef={objectId:string;nodePath:string;nodeClass:string;scriptPath:string|null;scenePath:string|null};
export type SceneObjectTarget=SceneNodeRef&{position:number[];normal:number[];ancestors:SceneNodeRef[];identityScope:'runtime-instance';sourceUse:'context-only'};
const fail=():never=>{throw Error('SCENE_OBJECT_OBSERVATION_INVALID');};
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
const nodePath=(v:unknown):v is string=>text(v,512)&&!v.startsWith('/')&&!v.includes(':')&&v.split('/').every(p=>p!=='.'&&p!=='..'&&p.length>0);
const vector=(v:unknown):v is number[]=>Array.isArray(v)&&v.length===3&&v.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=100000);
function reference(raw:any,files?:Set<string>):SceneNodeRef {
 if(!raw||!text(raw.objectId,20)||!/^\d{1,20}$/.test(raw.objectId)||raw.objectId==='0'||!nodePath(raw.nodePath)||!text(raw.nodeClass,80))return fail();
 const resource=(v:unknown)=>{
  if(v===''||v===null||v===undefined)return null;
  if(!text(v,512)||!v.startsWith('res://')||!nodePath(v.slice(6)))return null;
  return files?.has(v.slice(6))?v:null;
 };
 return {objectId:raw.objectId,nodePath:raw.nodePath,nodeClass:raw.nodeClass,scriptPath:resource(raw.scriptPath),scenePath:resource(raw.scenePath)};
}
export function readSceneObjectTarget(raw:any,files:Set<string>):SceneObjectTarget|null {
 if(raw==null)return null;
 if(!vector(raw.position)||!vector(raw.normal)||!Array.isArray(raw.ancestors)||raw.ancestors.length>4)return fail();
 return {...reference(raw,files),position:[...raw.position],normal:[...raw.normal],ancestors:raw.ancestors.map((v:any)=>reference(v,files)),identityScope:'runtime-instance',sourceUse:'context-only'};
}
export function currentSceneObjectPath(target:SceneObjectTarget,refs:unknown):string {
 if(!Array.isArray(refs)||refs.length>32)throw Error('SCENE_OBJECT_RECAPTURE_REQUIRED');
 const found=refs.filter(v=>v?.objectId===target.objectId);
 if(found.length!==1)throw Error('SCENE_OBJECT_RECAPTURE_REQUIRED');
 const fresh=found[0];
 const sameSource=(before:SceneNodeRef,raw:any)=>{
  // Compare only source paths already admitted by the formal source manifest.
  const allowed=new Set([before.scriptPath,before.scenePath].filter((p):p is string=>p!==null).map(p=>p.slice(6)));
  const after=reference(raw,allowed);
  if(after.objectId!==before.objectId||after.nodeClass!==before.nodeClass||after.scriptPath!==before.scriptPath||after.scenePath!==before.scenePath)throw Error('SCENE_OBJECT_RECAPTURE_REQUIRED');
  return after;
 };
 const current=sameSource(target,fresh),ancestors=fresh.ancestors??[];
 if(!Array.isArray(ancestors)||ancestors.length!==target.ancestors.length)throw Error('SCENE_OBJECT_RECAPTURE_REQUIRED');
 target.ancestors.forEach((ancestor,index)=>sameSource(ancestor,ancestors[index]));
 return current.nodePath;
}
