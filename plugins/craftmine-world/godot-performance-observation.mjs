import {createHash} from 'node:crypto';

const ID=/^[A-Za-z0-9._-]{1,128}$/;
const UNITS={frameTimeMs:'ms',physicsStepMs:'ms',objectCount:'count',memoryWorkingSetMb:'MiB',gpuTimeMs:'ms'};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const unknowns=()=>Object.fromEntries(Object.entries(UNITS).map(([key,unit])=>[key,{
  status:'unknown',unit,source:'not-observed',reason:'No trusted runtime measurement channel is available for this field',
}]));

export function unavailablePerformance(reason){
  return {format:'craftmine.godot-performance-observation/1',available:false,reason,measured:unknowns()};
}

// The wired collector measures the whole renderer through Electron independently
// of editable game scripts. Engine metrics need their own trusted collector.
export function observeGodotPerformance({scope,sample,now=()=>new Date().toISOString()}){
  if(!plain(scope)||![scope.worldId,scope.buildId,scope.instanceId].every(value=>typeof value==='string'&&ID.test(value)))throw Error('INVALID_PERFORMANCE_SCOPE');
  const identity={worldId:scope.worldId,buildId:scope.buildId,instanceId:scope.instanceId};
  if(!plain(sample)||Object.keys(identity).some(key=>sample[key]!==identity[key]))throw Error('PERFORMANCE_SCOPE_MISMATCH');
  const observedAt=now(),sampleTime=Date.parse(sample.sampledAt),currentTime=Date.parse(observedAt);
  if(typeof sample.sampledAt!=='string'||!Number.isFinite(sampleTime)||!Number.isFinite(currentTime))throw Error('INVALID_PERFORMANCE_SAMPLE_TIME');
  if(currentTime-sampleTime>30000||sampleTime-currentTime>5000)throw Error('PERFORMANCE_SAMPLE_STALE');
  if(sample.provenance!=='electron-app-metrics'||sample.measurementScope!=='renderer-process'||!Number.isSafeInteger(sample.rendererProcessId)||sample.rendererProcessId<=0)throw Error('PERFORMANCE_PROVENANCE_UNVERIFIED');
  const measured=unknowns(),value=sample.memoryWorkingSetMb;
  if(value===undefined)return unavailablePerformance('PERFORMANCE_MEMORY_UNAVAILABLE');
  if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw Error('INVALID_PERFORMANCE_VALUE:memoryWorkingSetMb');
  measured.memoryWorkingSetMb={status:'measured',value,unit:'MiB',source:'electron-app-metrics',
    measurementScope:'renderer-process',note:'Whole OS renderer process working set including runtime overhead; not exclusive world or GPU memory'};
  const measurement={scope:identity,sampledAt:sample.sampledAt,rendererProcessId:sample.rendererProcessId,measured};
  return {format:'craftmine.godot-performance-observation/1',available:true,...measurement,observedAt,measurementHash:hash(measurement)};
}
export function performanceFieldNames(){return Object.keys(UNITS);}
