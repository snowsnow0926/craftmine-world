import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {validateEnginePerformance} from '../../plugins/craftmine-world/godot-engine-performance.mjs';
const metadata=JSON.parse(fs.readFileSync(new URL('../../plugins/craftmine-world/engine-api/4.7.2-stable/classdb.json',import.meta.url)));
const actualVersion=metadata.actualVersion;
const entry=(monitor,unit,rawValue)=>({status:'measured',monitor,unit,rawValue});
const sample=()=>({format:'craftmine.godot-engine-performance/1',profile:'engine-monitor/1',engineVersion:actualVersion,
  sequence:1,processFrame:180,physicsFrame:180,framesDrawn:0,monotonicUsec:1000000,
  paused:false,headless:true,debugBuild:true,editorHint:false,renderingMethod:'gl_compatibility',renderingDriver:'opengl3',
  sampledAt:'2026-09-12T02:00:00Z',metrics:{
    processTime:entry('TIME_PROCESS','s',0.002),physicsTime:entry('TIME_PHYSICS_PROCESS','s',0.001),
    fps:entry('TIME_FPS','fps',60),objectCount:entry('OBJECT_COUNT','count',123),nodeCount:entry('OBJECT_NODE_COUNT','count',100),
    drawCalls:{status:'unknown',monitor:'RENDER_TOTAL_DRAW_CALLS_IN_FRAME',unit:'count'},
    primitives:{status:'unknown',monitor:'RENDER_TOTAL_PRIMITIVES_IN_FRAME',unit:'count'},
    gpuTime:{status:'unknown',monitor:null,unit:'s'},
  }});

test('collector contract monitor names exist in the actual pinned ClassDB',()=>{
  assert.equal(metadata.engineVersion,'4.7.2-stable');
  const reflected=metadata.classes.find(item=>item.name==='Performance');
  for(const metric of Object.values(sample().metrics))if(metric.monitor)
    assert.ok(reflected.constants.some(item=>item.enum==='Monitor'&&item.name===metric.monitor),metric.monitor);
});

test('retains raw units while converting engine seconds to milliseconds without attesting origin',()=>{
  const result=validateEnginePerformance({...sample(),worldId:'untrusted-extra'},{actualVersion});
  assert.equal(result.metrics.processTime.value,2);assert.equal(result.metrics.physicsTime.value,1);
  assert.equal(result.metrics.processTime.rawValue,0.002);assert.equal(result.metrics.processTime.rawUnit,'s');
  assert.equal(result.metrics.gpuTime.status,'unknown');assert.equal(result.authority,'not-attested-by-structural-validation');
  assert.equal(Object.hasOwn(result,'worldId'),false);
});

test('rejects wrong version, replay, invalid timestamps and fractional counters',()=>{
  for(const patch of [{engineVersion:'4.5.stable'},{sequence:0},{processFrame:1.5},{sampledAt:'invalid'},{paused:'false'}])
    assert.throws(()=>validateEnginePerformance({...sample(),...patch},{actualVersion}));
  assert.throws(()=>validateEnginePerformance(sample(),{actualVersion,previousSequence:1}),/REPLAY/);
  assert.throws(()=>validateEnginePerformance(sample(),{actualVersion,previousSequence:NaN}),/PREVIOUS_SEQUENCE/);
});

test('refuses unit confusion, invented monitor values and unsupported measurements',()=>{
  for(const [key,change] of [['processTime',{unit:'ms'}],['processTime',{rawValue:Infinity}],
    ['processTime',{rawValue:0}],
    ['objectCount',{rawValue:1.5}],['objectCount',{monitor:'CUSTOM_OBJECTS'}],
    ['gpuTime',{status:'measured',rawValue:0}],['drawCalls',{status:'measured',rawValue:0}],
    ['primitives',{rawValue:0}]]){
    const input=sample();Object.assign(input.metrics[key],change);
    assert.throws(()=>validateEnginePerformance(input,{actualVersion}),key);
  }
  const input=sample();input.metrics.invented=entry('CUSTOM','s',0);
  assert.throws(()=>validateEnginePerformance(input,{actualVersion}),/FIELDS/);
  assert.throws(()=>validateEnginePerformance({...sample(),paused:true},{actualVersion}),/UNSUPPORTED_MEASUREMENT/);
  const unrendered=sample();unrendered.headless=false;unrendered.metrics.drawCalls=entry('RENDER_TOTAL_DRAW_CALLS_IN_FRAME','count',0);
  assert.throws(()=>validateEnginePerformance(unrendered,{actualVersion}),/UNSUPPORTED_MEASUREMENT/);
});

test('validates the actual native collector sequence and retained raw evidence',()=>{
  const directory=new URL('../../docs/evidence/gu6-engine-monitors-native-20260912/',import.meta.url);
  const report=JSON.parse(fs.readFileSync(new URL('report.json',directory)));
  const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
  assert.equal(report.engineSha256,metadata.engineSha256);assert.equal(report.exit.code,0);
  for(const stream of ['stdout','stderr'])assert.equal(digest(fs.readFileSync(new URL(stream+'.log',directory))),report[stream+'Sha256']);
  assert.equal(digest(fs.readFileSync(new URL('../../desktop/godot/shared/engine_performance.gd',import.meta.url))),report.collectorSha256);
  let previousSequence=0;
  for(const name of ['empty','loaded','paused','removed','resumed']){
    const result=validateEnginePerformance(report.samples[name],{actualVersion,previousSequence});previousSequence=result.sequence;
    assert.equal(result.metrics.objectCount.status,'measured');assert.equal(result.metrics.gpuTime.status,'unknown');
    if(result.paused)assert.equal(result.metrics.processTime.status,'unknown');
  }
  assert.equal(report.samples.loaded.metrics.nodeCount.rawValue-report.samples.empty.metrics.nodeCount.rawValue,256);
});
