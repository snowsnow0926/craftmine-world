import {isDeepStrictEqual} from 'node:util';
import type {CreationRequirement,CreationEntity} from './creation-check-requirements';
export type CreationHarvestTrace=Array<{step:string;inventory:Record<string,number>;visible:boolean;solid:boolean;progressRestored:boolean;elapsedTicks:number}>;
export async function verifyCreationHarvest(runtime:any,r:CreationRequirement,defaults:any,bounded:<T>(p:Promise<T>)=>Promise<T>):Promise<CreationHarvestTrace>{
 const wanted=r.harvest;if(!wanted)return [];
 const trace:CreationHarvestTrace=[];let initialTick:number|undefined;
 const call=async(op:string,args:any={})=>{const result:any=await bounded(runtime.request(op,args));if(result.error)throw Error('CREATION_HARVEST_PROBE:'+result.error);return result.result;};
 const load=async(snapshot:any)=>{await call('pause');const result:any=await bounded(runtime.load({build:null,snapshot}));if(result.error)throw Error('CREATION_HARVEST_RESTORE:'+result.error);};
 const observe=async()=>{const raw=await call('observe-envelope');const entity=raw?.payload?.creation?.entities?.find((e:CreationEntity)=>e.id===wanted.entityId);if(!entity||typeof entity.visible!=='boolean'||typeof entity.solid!=='boolean'||!raw.payload.inventory)throw Error('CREATION_HARVEST_OBSERVATION');const tick=raw.payload.creation.physicsTick;if(!Number.isSafeInteger(tick))throw Error('CREATION_HARVEST_CLOCK_UNAVAILABLE');return {entity,inventory:raw.payload.inventory,tick};};
 const record=async(step:string,progressRestored=false)=>{const actual=await observe();initialTick??=actual.tick;trace.push({step,elapsedTicks:actual.tick-initialTick!,inventory:structuredClone(actual.inventory),visible:actual.entity.visible,solid:actual.entity.solid,progressRestored});};
 const target=async()=>{const {entity}=await observe(),saved=await call('snapshot');
  for(const [dx,dz,yaw]of [[0,2,0],[2,0,Math.PI/2],[0,-2,Math.PI],[-2,0,-Math.PI/2]]){
   const state=structuredClone(saved.state),[x,y,z]=entity.position;state.body.player={position:[x+dx,y+0.9,z+dz],yaw,pitch:Math.atan2(entity.scale[1]*0.6-1.55,2),onFloor:true};
   await call('pause');const restored:any=await bounded(runtime.load({build:null,snapshot:state}));await call('resume');if(restored.error)continue;
   await call('wait',{frames:2});const raw=await call('observe-envelope');if(raw?.payload?.creation?.target?.entityId===wanted.entityId)return;
  }
  throw Error('CREATION_HARVEST_TARGET_UNREACHABLE');
 };
 await load(defaults);await call('resume');await target();await record('initial');
 const hit=await call('interact');if(hit?.entityId!==wanted.entityId||hit.interacted!==true)throw Error('CREATION_HARVEST_INTERACTION');await call('wait',{frames:2});await record('harvested');
 await call('interact');await record('repeat');
 await call('wait',{frames:100});await call('pause');const midway=await call('snapshot');await record('midway');
 await load(defaults);await load(midway.state);const restored=await call('snapshot');
 if(!isDeepStrictEqual(restored.state,midway.state))throw Error('CREATION_HARVEST_PROGRESS_MISMATCH');await record('restored',true);
 await call('resume');let elapsed=(await observe()).tick-initialTick!;if(elapsed>=280)throw Error('CREATION_HARVEST_PROBE_TIMING');await call('wait',{frames:Math.max(1,280-elapsed)});await record('before-regrowth');
 elapsed=(await observe()).tick-initialTick!;await call('wait',{frames:Math.max(1,330-elapsed)});await record('regrown');await target();const second=await call('interact');if(second?.entityId!==wanted.entityId||second.interacted!==true)throw Error('CREATION_HARVEST_SECOND_INTERACTION');await call('wait',{frames:2});await record('second-harvest');
 if(!creationHarvestTraceMatches(r,trace))throw Object.assign(Error('CREATION_HARVEST_REQUIREMENTS_MISMATCH'),{trace});return trace;
}
export function creationHarvestTraceMatches(r:CreationRequirement,trace:CreationHarvestTrace|undefined):boolean{
 if(!r.harvest)return trace===undefined;
 const steps=['initial','harvested','repeat','midway','restored','before-regrowth','regrown','second-harvest'];
 if(!trace||trace.length!==steps.length)return false;
 const baseline=trace[0].inventory;if(!baseline||typeof baseline!=='object'||Array.isArray(baseline)||Object.values(baseline).some(n=>!Number.isSafeInteger(n)||n<0||n>999999))return false;
 return trace.every((entry,i)=>{
  const expected={...baseline};if(i>0)expected.wood=(baseline.wood??0)+(i===7?2:1);
  return Number.isSafeInteger(entry.elapsedTicks)&&entry.elapsedTicks>=0&&(i!==5||entry.elapsedTicks>=270&&entry.elapsedTicks<300)&&(i!==6||entry.elapsedTicks>=300&&entry.elapsedTicks<=360)&&entry.step===steps[i]&&entry.visible===(i===0||i===6)&&entry.solid===(i===0||i===6)&&entry.progressRestored===(i===4)&&isDeepStrictEqual(entry.inventory,expected);
 });
}
