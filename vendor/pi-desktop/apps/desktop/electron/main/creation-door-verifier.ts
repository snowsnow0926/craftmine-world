import type {CreationRequirement,CreationEntity} from './creation-check-requirements';
export type CreationDoorTrace=Array<{step:string;doorOpen:boolean;interacted:boolean}>;
// Gameplay commands run only inside the verifier's disposable engine. Positioning
// uses its snapshot/restore API; interaction still needs a real raycast hit.
export async function verifyCreationDoorSequence(runtime:any,r:CreationRequirement,defaults:any,bounded:<T>(p:Promise<T>)=>Promise<T>):Promise<CreationDoorTrace>{
 const rule=r.doorSequence;if(!rule)return [];
 const trace:CreationDoorTrace=[];
 const call=async(op:string,args:any={})=>{const result:any=await bounded(runtime.request(op,args));if(result.error)throw Error('CREATION_DOOR_PROBE:'+result.error);return result.result;};
 const observe=async()=>{const raw=await call('observe-envelope');const entities=raw?.payload?.creation?.entities;if(!Array.isArray(entities))throw Error('CREATION_DOOR_OBSERVATION');return entities as CreationEntity[];};
 const record=async(step:string,interacted:boolean)=>{const door=(await observe()).find(e=>e.id===rule.doorId);if(typeof door?.open!=='boolean')throw Error('CREATION_DOOR_OBSERVATION');trace.push({step,doorOpen:door.open,interacted});};
 const reset=async()=>{await call('pause');const loaded:any=await bounded(runtime.load({build:null,snapshot:defaults}));if(loaded.error)throw Error('CREATION_DOOR_RESET:'+loaded.error);await call('resume');};
 const interact=async(id:string)=>{
  const entity=(await observe()).find(e=>e.id===id);if(!entity)throw Error('CREATION_DOOR_TARGET_MISSING');
  const snapshot=await call('snapshot');let placed=false;
  for(const [dx,dz,yaw] of [[0,2,0],[2,0,Math.PI/2],[0,-2,Math.PI],[-2,0,-Math.PI/2]]){
   const state=structuredClone(snapshot.state),[x,y,z]=entity.position;
   state.body.player={position:[x+dx,y+0.9,z+dz],yaw,pitch:Math.atan2(entity.scale[1]*0.6-1.55,2),onFloor:true};
   await call('pause');let restored:any;
   try{restored=await bounded(runtime.load({build:null,snapshot:state}));}
   catch(error){if(!String(error).includes('Saved player overlaps candidate entity:'))throw error;await call('resume');continue;}
   await call('resume');
   if(restored.error)continue;
   await call('wait',{frames:2});
   const aimed=await call('observe-envelope');if(aimed?.payload?.creation?.target?.entityId!==id)continue;
   const result=await call('interact');if(result?.interacted===true&&result.entityId===id){placed=true;break;}
  }
  if(!placed)throw Error('CREATION_DOOR_TARGET_UNREACHABLE:'+id);
  // Door collisions update with set_deferred; inspect after actual physics
  // ticks rather than immediately after the interaction promise resolves.
  await call('wait',{frames:2});
  await record(id,true);
 };
 await reset();await call('wait',{frames:2});await record('initial',false);
 if(trace[0].doorOpen)throw Error('CREATION_DOOR_OPEN_TOO_EARLY');
 await interact(rule.steps[1]);if(trace.at(-1)!.doorOpen)throw Error('CREATION_DOOR_WRONG_ORDER');
 await reset();
 for(let i=0;i<rule.steps.length;i++){await interact(rule.steps[i]);if(trace.at(-1)!.doorOpen!==(i===rule.steps.length-1))throw Error('CREATION_DOOR_SEQUENCE_MISMATCH');}
 return trace;
}
export function creationDoorTraceMatches(r:CreationRequirement,trace:CreationDoorTrace|undefined):boolean{
 if(!r.doorSequence)return trace===undefined;
 const steps=['initial',r.doorSequence.steps[1],...r.doorSequence.steps];
 return Array.isArray(trace)&&trace.length===steps.length&&trace.every((entry,i)=>entry.step===steps[i]&&entry.interacted===(i!==0)&&entry.doorOpen===(i===steps.length-1));
}
