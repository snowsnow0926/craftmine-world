// Fixed host-owned passage protocol, never an arbitrary scenario evaluator.
import type {CreationRequirement} from './creation-check-requirements';
type Vec = number[];
type Motion = {before:Vec;after:Vec;startedTick:number;finishedTick:number;targetId:string|null};
export type DoorPassage = {format:'craftmine.creation-door-passage/1';doorId:string;instanceId:string;setup:'snapshot-player-only';boundsSource:'collision'|'declaration-fallback';bounds:{min:Vec;max:Vec};axis:0|2;frames:240;closed:Motion;opened?:Motion};
const vec=(v:any):v is Vec=>Array.isArray(v)&&v.length===3&&v.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=100000);
const close=(a:number,b:number,tolerance=.02)=>Math.abs(a-b)<=tolerance;
const fields=(v:any,keys:string[])=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
function geometry(p:DoorPassage,r:CreationRequirement):boolean {
 const door=r.entities.find(e=>e.id===p.doorId&&e.kind==='door');
 if(p.format!=='craftmine.creation-door-passage/1'||p.doorId!==r.doorSequence?.doorId||p.setup!=='snapshot-player-only'||p.frames!==240||!['collision','declaration-fallback'].includes(p.boundsSource)||!p.bounds||!vec(p.bounds.min)||!vec(p.bounds.max)||!p.bounds.min.every((v,i)=>v<p.bounds.max[i])||![0,2].includes(p.axis)||!door?.position||!vec(door.position))return false;
 const b=p.bounds,axis=b.max[0]-b.min[0]<b.max[2]-b.min[2]?0:2;
 return p.axis===axis&&b.max[axis]-b.min[axis]<=16&&close((b.min[0]+b.max[0])/2,door.position[0])&&close((b.min[2]+b.max[2])/2,door.position[2])&&close(b.min[1],door.position[1]);
}
function motionMatches(p:DoorPassage,m:Motion|undefined,closed:boolean):boolean {
 if(!fields(m,['before','after','startedTick','finishedTick','targetId'])||!m||!vec(m.before)||!vec(m.after)||!Number.isSafeInteger(m.startedTick)||!Number.isSafeInteger(m.finishedTick)||m.startedTick<0||m.finishedTick-m.startedTick<240||m.finishedTick-m.startedTick>360)return false;
 const a=p.axis,other=a===0?2:0,b=p.bounds;
 if(!close(m.before[a],b.max[a]+1)||!close(m.before[other],(b.min[other]+b.max[other])/2)||!close(m.before[1],b.min[1]+.9,.05)||!close(m.after[other],m.before[other],.05)||!close(m.after[1],m.before[1],.05))return false;
 return closed?m.targetId===p.doorId&&m.after[a]>=b.max[a]+.28&&m.after[a]<=b.max[a]+.45:m.after[a]<=b.min[a]-.4&&m.after[a]>=m.before[a]-24;
}
export function doorPassageMatches(r:CreationRequirement,p:DoorPassage|undefined,instanceId?:string):boolean {
 if(r.doorSequence?.verifyPassage!==true)return p===undefined;
 return !!p&&fields(p,['format','doorId','instanceId','setup','boundsSource','bounds','axis','frames','closed','opened'])&&fields(p.bounds,['min','max'])&&typeof p.instanceId==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(p.instanceId)&&(!instanceId||p.instanceId===instanceId)&&p.boundsSource==='collision'&&geometry(p,r)&&motionMatches(p,p.closed,true)&&motionMatches(p,p.opened,false)&&p.opened!.startedTick>p.closed.finishedTick;
}
export async function measureDoorPassage(runtime:any,r:CreationRequirement,bounded:<T>(p:Promise<T>)=>Promise<T>,closed?:DoorPassage):Promise<DoorPassage>{
 const identity={worldId:runtime.worldId,buildId:runtime.buildId,instanceId:runtime.instanceId};
 const call=async(op:string,args:any={})=>{const v:any=await bounded(runtime.request(op,args));if(v.error)throw Error('CREATION_PASSAGE_RUNTIME:'+v.error);return v.result;};
 const observe=async()=>{
  const raw=await call('observe-envelope'),age=Date.now()-Date.parse(raw?.sampledAt);
  if(raw?.format!=='craftmine.godot-observation/1'||raw.baseId!=='creation-sandbox'||raw.baseVersion!=='1.0.0'||Object.entries(identity).some(([k,v])=>typeof v!=='string'||raw[k]!==v)||!Number.isFinite(age)||age< -5000||age>30000||!Number.isSafeInteger(raw.payload?.creation?.physicsTick)||!vec(raw.payload?.player?.position))throw Error('CREATION_PASSAGE_OBSERVATION_INVALID');
  return raw.payload;
 };
 const initial=await observe();let p:DoorPassage;
 if(closed)p=structuredClone(closed);
 else{
  const door=initial.creation.entities?.find((e:any)=>e.id===r.doorSequence!.doorId&&e.kind==='door');
  const expected=r.entities.find(e=>e.id===r.doorSequence!.doorId&&e.kind==='door');
  // A missing collider can still be exercised at the frozen base doorway. This
  // fallback is failure evidence only and is never eligible for a passed proof.
  const fallback=expected?.position&&expected.scale?{min:expected.position.map((n,i)=>n-(i===1?0:[.8,0,.25][i]*expected.scale![i])),max:expected.position.map((n,i)=>n+[.8,2.6,.25][i]*expected.scale![i])}:null;
  const bounds=door?.collisionBounds??fallback;
  if(!bounds||!vec(bounds.min)||!vec(bounds.max))throw Error('CREATION_PASSAGE_BOUNDS_UNAVAILABLE');
  p={format:'craftmine.creation-door-passage/1',doorId:r.doorSequence!.doorId,instanceId:identity.instanceId,setup:'snapshot-player-only',boundsSource:door?.collisionBounds?'collision':'declaration-fallback',bounds:structuredClone(bounds),axis:bounds.max[0]-bounds.min[0]<bounds.max[2]-bounds.min[2]?0:2,frames:240,closed:null as any};
 }
 if(!geometry(p,r)||p.instanceId!==identity.instanceId)throw Error('CREATION_PASSAGE_LAYOUT_UNSUPPORTED');
 const b=p.bounds,a=p.axis,position=[(b.min[0]+b.max[0])/2,b.min[1]+.9,(b.min[2]+b.max[2])/2];position[a]=b.max[a]+1;
 const state=structuredClone((await call('snapshot')).state);
 // Explicit setup in the disposable verifier only. Neither this placement nor
 // snapshot restoration counts as movement or grants a formal save write.
 state.body.player={position,yaw:a===2?0:Math.PI/2,pitch:Math.atan2((b.min[1]+b.max[1])/2-position[1]-.65,position[a]-(b.min[a]+b.max[a])/2),onFloor:true};
 await call('pause');const loaded:any=await bounded(runtime.load({build:null,snapshot:state}));if(loaded.error)throw Error('CREATION_PASSAGE_SETUP_UNREACHABLE:'+loaded.error);
 await call('resume');await call('wait',{frames:2});const before=await observe();
 await call('walk',{forward:1,right:0,frames:240});await call('wait',{frames:2});const after=await observe();
 const motion:Motion={before:before.player.position,after:after.player.position,startedTick:before.creation.physicsTick,finishedTick:after.creation.physicsTick,targetId:before.creation.target?.entityId??null};
 if(closed)p.opened=motion;else p.closed=motion;
 if(!motionMatches(p,motion,!closed)||p.boundsSource!=='collision'||closed&&!doorPassageMatches(r,p,identity.instanceId))throw Object.assign(Error('CREATION_PASSAGE_'+(closed?'OPENED_NOT_TRAVERSABLE':'CLOSED_NOT_BLOCKING')),{passage:p});
 return p;
}
