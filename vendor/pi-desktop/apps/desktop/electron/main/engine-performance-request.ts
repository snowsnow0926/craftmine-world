type Identity={worldId:string;buildId:string;instanceId:string};
type Instance=Identity&{alive:boolean;runtime:{request:(op:string,args:Record<string,unknown>)=>Promise<{error?:string;result?:unknown}>}};
type Host={current:()=>Instance|null;busy:()=>boolean};
const keys=['worldId','buildId','instanceId'] as const;
/** Fixed Main-only read; frozen snapshots permit this read but transitions do not. */
export async function readEnginePerformance(host:Host,identity:Identity,nonce:string):Promise<Record<string,unknown>|null>{
  if(!identity||typeof identity!=='object'||Array.isArray(identity)||Object.keys(identity).length!==3||
    !keys.every(key=>typeof identity[key]==='string'&&/^[A-Za-z0-9._-]{1,128}$/.test(identity[key]))||typeof nonce!=='string'||!/^[a-f0-9]{64}$/.test(nonce))throw Error('ENGINE_PERFORMANCE_REQUEST_INVALID');
  const instance=host.current();
  if(!instance?.alive||!keys.every(key=>instance[key]===identity[key]))throw Error('ENGINE_PERFORMANCE_INSTANCE_CHANGED');
  if(host.busy())throw Error('WORLD_BUSY');
  const response=await instance.runtime.request('engine-performance',{nonce});
  if(host.current()!==instance||!instance.alive||!keys.every(key=>instance[key]===identity[key]))throw Error('ENGINE_PERFORMANCE_INSTANCE_CHANGED');
  if(host.busy())throw Error('WORLD_BUSY');
  if(response.error)throw Error(response.error);
  return (response.result??null) as Record<string,unknown>|null;
}
