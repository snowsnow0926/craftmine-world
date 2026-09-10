import {setTimeout as delay} from 'node:timers/promises';

export function isExpectedRuntime(value, worldId) {
  return value?.format==='craftmine.godot-observation/1' &&
    value.protocol==='craftmine.godot-runtime/2' && value.worldId===worldId &&
    typeof value.buildId==='string' && value.buildId.length>0 &&
    typeof value.instanceId==='string' && value.instanceId.length>0;
}

/** Read-only observation; no replay of a navigation or mutation. */
export async function waitForInitialRuntime({observe,worldId,deadlineMs=120000,now=Date.now,pause=()=>delay(250)}) {
  if(!Number.isFinite(deadlineMs)||deadlineMs<=0||typeof worldId!=='string'||!worldId)throw Error('INVALID_RUNTIME_WAIT');
  const deadline=now()+deadlineMs;
  while(now()<deadline) {
    let value;
    try {value=await observe();}
    catch(error) {
      if(error?.message!=='No world runtime is running'&&error?.message!=='Error: No world runtime is running')throw error;
    }
    if(isExpectedRuntime(value,worldId))return value;
    await pause();
  }
  throw Error('INITIAL_RUNTIME_READY_TIMEOUT');
}
