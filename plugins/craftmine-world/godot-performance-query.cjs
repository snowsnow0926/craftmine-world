'use strict';
const {describeRuntime,normalizeLiveSample}=require('./godot-observe.cjs');

// Read the task binding without opening a workspace or cancelling other jobs.
// Neither game payloads nor durable snapshots belong in performance responses.
async function queryPerformance({core,context,samplePerformance,sampleLiveState,assertActive=()=>{}}){
  const helper=await import('./godot-performance-observation.mjs');
  const unavailable=reason=>helper.unavailablePerformance(reason);
  assertActive();
  if(typeof samplePerformance!=='function'||typeof sampleLiveState!=='function')return unavailable('PERFORMANCE_OBSERVATION_NOT_WIRED');
  const binding=await core.call('task.context',{context});assertActive();
  const worldId=binding?.world?.id;
  if(typeof worldId!=='string'||!worldId)return unavailable('WORLD_BINDING_UNRESOLVED');
  const descriptor=await describeRuntime(core,{worldId});assertActive();
  if(!descriptor.available)return unavailable(descriptor.reason||'NO_RUNNABLE_BUILD');
  const identity={worldId,buildId:descriptor.buildId};
  let sample,live;
  try{
    sample=await samplePerformance(identity);assertActive();
    if(!sample)return unavailable('LIVE_INSTANCE_NOT_RUNNING');
    if(sample.available===false)return unavailable('PERFORMANCE_SAMPLE_UNAVAILABLE');
    // Independently sample the current instance, rejecting late/old readings.
    live=normalizeLiveSample(await sampleLiveState(identity),identity);assertActive();
  }catch(error){assertActive();return unavailable('PERFORMANCE_SAMPLE_FAILED');}
  if(!live.available||live.stale)return unavailable('PERFORMANCE_LIVE_IDENTITY_UNVERIFIED');
  const finalBinding=await core.call('task.context',{context});assertActive();
  if(finalBinding?.world?.id!==worldId)return unavailable('PERFORMANCE_WORLD_CHANGED');
  const current=await describeRuntime(core,{worldId});assertActive();
  if(!current.available||current.buildId!==identity.buildId)return unavailable('PERFORMANCE_BUILD_CHANGED');
  try{
    return helper.observeGodotPerformance({scope:{...identity,instanceId:live.instanceId},sample});
  }catch(error){return unavailable('PERFORMANCE_SAMPLE_INVALID');}
}
module.exports={queryPerformance};
