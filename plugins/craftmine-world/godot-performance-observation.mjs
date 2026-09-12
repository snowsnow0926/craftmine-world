import {createHash} from 'node:crypto';
const ID=/^[A-Za-z0-9._-]{1,128}$/;
const FIELD_RULES={
  frameTimeMs:{unit:'ms',source:'real-engine'}, physicsStepMs:{unit:'ms',source:'real-engine'},
  objectCount:{unit:'count',source:'real-engine'}, memoryWorkingSetMb:{unit:'MB',source:'real-process'}, gpuTimeMs:{unit:'ms',source:'unavailable'}
};
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const finite=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
export function observeGodotPerformance({scope,sample,now=()=>new Date().toISOString()}){
  if(!scope||typeof scope!=='object'||![scope.worldId,scope.buildId,scope.instanceId].every(v=>typeof v==='string'&&ID.test(v)))throw Error('INVALID_PERFORMANCE_SCOPE');
  if(!sample||typeof sample!=='object'||sample.worldId!==scope.worldId||sample.buildId!==scope.buildId||sample.instanceId!==scope.instanceId)throw Error('PERFORMANCE_SCOPE_MISMATCH');
  if(typeof sample.sampledAt!=='string'||!sample.sampledAt)throw Error('INVALID_PERFORMANCE_SAMPLE_TIME');
  const measured={};
  for(const [key,rule] of Object.entries(FIELD_RULES)){
    const value=sample[key];
    if(rule.source==='unavailable'){measured[key]={status:'unknown',unit:rule.unit,source:'unavailable',reason:'Runtime channel does not expose GPU timing'};continue;}
    if(value===undefined){measured[key]={status:'unknown',unit:rule.unit,source:'not-observed',reason:'No runtime observation was published'};continue;}
    if(!finite(value))throw Error('INVALID_PERFORMANCE_VALUE:'+key);
    measured[key]={status:'measured',value,unit:rule.unit,source:rule.source};
  }
  return {format:'craftmine.godot-performance-observation/1',scope:{...scope},sampledAt:sample.sampledAt,observedAt:now(),measured,measurementHash:hash({scope,sampledAt:sample.sampledAt,measured})};
}
export function performanceFieldNames(){return Object.keys(FIELD_RULES)}
