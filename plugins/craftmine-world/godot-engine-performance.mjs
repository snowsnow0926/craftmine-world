// Structural validation for the fixed collector protocol. This does not attest
// which script produced a payload; host/source/PCK authority is a separate gate.
const RULES={
  processTime:{monitor:'TIME_PROCESS',unit:'s',outputUnit:'ms',factor:1000,timing:true},
  physicsTime:{monitor:'TIME_PHYSICS_PROCESS',unit:'s',outputUnit:'ms',factor:1000,timing:true},
  fps:{monitor:'TIME_FPS',unit:'fps',outputUnit:'fps',factor:1,timing:true},
  objectCount:{monitor:'OBJECT_COUNT',unit:'count',outputUnit:'count',factor:1,count:true},
  nodeCount:{monitor:'OBJECT_NODE_COUNT',unit:'count',outputUnit:'count',factor:1,count:true},
  drawCalls:{monitor:'RENDER_TOTAL_DRAW_CALLS_IN_FRAME',unit:'count',outputUnit:'count',factor:1,count:true,render:true},
  primitives:{monitor:'RENDER_TOTAL_PRIMITIVES_IN_FRAME',unit:'count',outputUnit:'count',factor:1,count:true,render:true},
  gpuTime:{monitor:null,unit:'s',outputUnit:'ms',factor:1000,unsupported:true},
};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const requireThat=(condition,code)=>{if(!condition)throw Error(code);};

export function validateEnginePerformance(sample,{actualVersion,previousSequence=null}={}){
  requireThat(plain(sample)&&sample.format==='craftmine.godot-engine-performance/1'&&sample.profile==='engine-monitor/1','ENGINE_PERFORMANCE_FORMAT');
  requireThat(typeof actualVersion==='string'&&actualVersion.length>0&&sample.engineVersion===actualVersion,'ENGINE_PERFORMANCE_VERSION');
  for(const name of ['sequence','processFrame','physicsFrame','framesDrawn','monotonicUsec'])
    requireThat(Number.isSafeInteger(sample[name])&&sample[name]>=0,'ENGINE_PERFORMANCE_COUNTER');
  requireThat(sample.sequence>0,'ENGINE_PERFORMANCE_SEQUENCE');
  if(previousSequence!==null){
    requireThat(Number.isSafeInteger(previousSequence)&&previousSequence>=0,'ENGINE_PERFORMANCE_PREVIOUS_SEQUENCE');
    requireThat(sample.sequence>previousSequence,'ENGINE_PERFORMANCE_REPLAY');
  }
  for(const name of ['paused','headless','debugBuild','editorHint'])requireThat(typeof sample[name]==='boolean','ENGINE_PERFORMANCE_ENVIRONMENT');
  for(const name of ['renderingMethod','renderingDriver'])requireThat(typeof sample[name]==='string'&&sample[name].length<=100,'ENGINE_PERFORMANCE_ENVIRONMENT');
  requireThat(typeof sample.sampledAt==='string'&&Number.isFinite(Date.parse(sample.sampledAt)),'ENGINE_PERFORMANCE_TIME');
  requireThat(plain(sample.metrics)&&Object.keys(sample.metrics).sort().join(',')===Object.keys(RULES).sort().join(','),'ENGINE_PERFORMANCE_FIELDS');
  const metrics={};
  for(const [name,rule] of Object.entries(RULES)){
    const metric=sample.metrics[name];
    requireThat(plain(metric)&&metric.monitor===rule.monitor&&metric.unit===rule.unit,'ENGINE_PERFORMANCE_MONITOR');
    requireThat(metric.status==='measured'||metric.status==='unknown','ENGINE_PERFORMANCE_STATUS');
    if(metric.status==='unknown'){
      requireThat(!Object.hasOwn(metric,'rawValue'),'ENGINE_PERFORMANCE_UNKNOWN_VALUE');
      metrics[name]={status:'unknown',monitor:rule.monitor,unit:rule.outputUnit};
      continue;
    }
    requireThat(!rule.unsupported&&!(rule.render&&(sample.headless||sample.framesDrawn===0||sample.renderingMethod==='dummy'||sample.renderingDriver==='dummy'))&&!(rule.timing&&sample.paused),'ENGINE_PERFORMANCE_UNSUPPORTED_MEASUREMENT');
    const value=metric.rawValue;
    requireThat(typeof value==='number'&&Number.isFinite(value)&&value>=0&&(!rule.count||Number.isSafeInteger(value))&&(!rule.timing||value>0),'ENGINE_PERFORMANCE_VALUE');
    requireThat(Number.isFinite(value*rule.factor),'ENGINE_PERFORMANCE_VALUE');
    metrics[name]={status:'measured',monitor:rule.monitor,rawValue:value,rawUnit:rule.unit,value:value*rule.factor,unit:rule.outputUnit};
  }
  return {format:'craftmine.validated-engine-performance/1',engineVersion:sample.engineVersion,profile:sample.profile,
    sequence:sample.sequence,sampledAt:sample.sampledAt,monotonicUsec:sample.monotonicUsec,
    processFrame:sample.processFrame,physicsFrame:sample.physicsFrame,framesDrawn:sample.framesDrawn,
    paused:sample.paused,headless:sample.headless,debugBuild:sample.debugBuild,editorHint:sample.editorHint,
    renderingMethod:sample.renderingMethod,renderingDriver:sample.renderingDriver,metrics,
    authority:'not-attested-by-structural-validation',
    limitations:['Engine process/physics monitor durations are not OS process CPU time or rendered frame intervals.',
      'FPS monitor refresh may lag sampling; sequence changes do not prove monitor refresh.',
      'Host instance, source and PCK checks are required before accepting this as a current runtime observation.']};
}
