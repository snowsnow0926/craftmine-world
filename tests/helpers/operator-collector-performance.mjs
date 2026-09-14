const number=value=>Number.isFinite(value)&&value>=0?value:null;
const maximum=(left,right)=>right===null?left??null:left===null||left===undefined?right:Math.max(left,right);
const pick=(value,keys)=>Object.fromEntries(keys.map(key=>[key,number(value?.[key])]));

// Metadata only; never retain renderer text, message bodies or the whole report.
export function operatorCollectorPerformanceSample(input){
  const rendererMemory=pick(input.renderer?.memory,['usedJSHeapSize','totalJSHeapSize','jsHeapSizeLimit']);
  return {format:'craftmine.operator-collector-performance/1',at:input.at,controllerRunId:input.controllerRunId,
    launchIndex:input.launchIndex,appPid:input.appPid,collectorId:input.collectorId??null,
    worldId:input.worldId??null,sessionId:input.sessionId??null,isRunning:input.isRunning===true,
    inspectElapsedMs:number(input.inspectElapsedMs),
    nodeMemory:pick(input.nodeMemory,['rss','heapTotal','heapUsed','external','arrayBuffers']),nodeCpu:pick(input.nodeCpu,['user','system']),
    rendererMemory:{availability:rendererMemory.usedJSHeapSize===null?'unknown':'reported',...rendererMemory},
    collector:pick(input.collector,['observedEvents','observedUpdates','drainedRecords','pendingRecords','peakPendingRecords','omittedUpdateBodyCharacters','maxUpdateBodyCharacters','collectedBytes'])};
}

export function accumulateOperatorCollectorPerformance(previous,sample){
  const result=previous?structuredClone(previous):{format:'craftmine.operator-collector-performance-summary/1',controllerRunId:sample.controllerRunId,samples:0,rendererHeapSamples:0,rendererHeapUnknownSamples:0,sampledMax:{},collectors:{}};
  if(result.controllerRunId!==sample.controllerRunId)throw Error('COLLECTOR_PERFORMANCE_CONTROLLER_CHANGED');
  result.samples++;result.lastSampleAt=sample.at;
  if(sample.rendererMemory.usedJSHeapSize===null)result.rendererHeapUnknownSamples++;else result.rendererHeapSamples++;
  const values={inspectElapsedMs:sample.inspectElapsedMs,nodeRssBytes:sample.nodeMemory.rss,nodeHeapUsedBytes:sample.nodeMemory.heapUsed,rendererHeapUsedBytes:sample.rendererMemory.usedJSHeapSize,rendererHeapTotalBytes:sample.rendererMemory.totalJSHeapSize,peakPendingRecords:sample.collector.peakPendingRecords,collectedBytesPerCollector:sample.collector.collectedBytes,maxUpdateBodyCharacters:sample.collector.maxUpdateBodyCharacters};
  for(const [key,value]of Object.entries(values))result.sampledMax[key]=maximum(result.sampledMax[key],value);
  if(sample.collectorId){
    const row=result.collectors[sample.collectorId]??={appPid:sample.appPid,launchIndex:sample.launchIndex,firstSampleAt:sample.at,samples:0,collectedBytes:null,observedEvents:null,peakPendingRecords:null};
    row.samples++;row.lastSampleAt=sample.at;
    for(const key of ['collectedBytes','observedEvents','peakPendingRecords'])row[key]=maximum(row[key],sample.collector[key]);
  }
  const collectors=Object.values(result.collectors);result.collectedBytesAcrossKnownCollectors=collectors.length&&collectors.every(row=>row.collectedBytes!==null)?collectors.reduce((sum,row)=>sum+row.collectedBytes,0):null;
  result.coverage='sampled maxima during this controller run; missing values are unknown and unsampled peaks cannot be reconstructed';
  return result;
}
