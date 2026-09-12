// Fixed native engine monitor experiment. No display, model, project callbacks or user data.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {createHash} from 'node:crypto';
import {createGodotProbeEnvironment,godotLock,sha256} from '../../desktop/godot/toolchain.mjs';
const root=path.resolve(import.meta.dirname,'../..');fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const out=fs.mkdtempSync(path.join(root,'test-results/engine-performance-native-'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const collector=fs.readFileSync(path.join(root,'desktop/godot/shared/engine_performance.gd'));
const fixture=fs.readFileSync(path.join(root,'tests/godot-agent/fixtures/engine-performance-native.gd'));
const db=JSON.parse(fs.readFileSync(path.join(root,'plugins/craftmine-world/engine-api/4.7.2-stable/classdb.json')));
const constants=db.classes.find(c=>c.name==='Performance').constants;
const expected={TIME_FPS:0,TIME_PROCESS:1,TIME_PHYSICS_PROCESS:2,OBJECT_COUNT:7,OBJECT_NODE_COUNT:9,RENDER_TOTAL_PRIMITIVES_IN_FRAME:12,RENDER_TOTAL_DRAW_CALLS_IN_FRAME:13};
for(const [name,value] of Object.entries(expected))assert.equal(Number(constants.find(c=>c.name===name)?.value),value);
assert.equal(db.engineSha256,godotLock.editor.executableSha256);
const report={format:'craftmine.engine-performance-native-test/1',passed:false,out,collectorSha256:hash(collector),fixtureSha256:hash(fixture),classdbVersion:db.actualVersion,enumEvidence:expected,
  scope:'Pinned native editor binary running an authored empty tree then 256 inert nodes, paused removal and resume; not a shipped world, renderer workload, optimization or model benchmark',checks:[]};
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
try{
  const engine=await createGodotProbeEnvironment(out);report.engineVersion=engine.actualVersion;report.engineSha256=await sha256(engine.executable);
  const project=path.join(out,'project');fs.mkdirSync(project);
  fs.writeFileSync(path.join(project,'project.godot'),'config_version=5\n[application]\nconfig/name="Fixed engine monitor probe"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n');
  fs.writeFileSync(path.join(project,'engine_performance.gd'),collector);fs.writeFileSync(path.join(project,'probe.gd'),fixture);
  const env={};for(const key of ['SystemRoot','WINDIR','COMSPEC'])if(process.env[key])env[key]=process.env[key];env.PATH=path.join(process.env.SystemRoot,'System32');
  for(const key of ['APPDATA','LOCALAPPDATA','USERPROFILE','TEMP','TMP'])env[key]=path.join(out,'profile',key.toLowerCase());
  const args=['--headless','--language','en','--path',project,'--script','res://probe.gd'];report.arguments=args;
  const child=spawn(engine.executable,args,{cwd:out,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
  child.stdout.on('data',bytes=>stdout+=bytes);child.stderr.on('data',bytes=>stderr+=bytes);
  const timer=setTimeout(()=>child.kill(),30000);
  report.exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));}).finally(()=>clearTimeout(timer));
  fs.writeFileSync(path.join(out,'stdout.log'),stdout);fs.writeFileSync(path.join(out,'stderr.log'),stderr);
  report.stdoutSha256=hash(stdout);report.stderrSha256=hash(stderr);
  assert.equal(report.exit.code,0,stderr);assert.ok(!/SCRIPT ERROR|Parse Error|ERROR:/.test(stdout+stderr),stderr);
  const line=stdout.split(/\r?\n/).find(line=>line.startsWith('ENGINE_PERFORMANCE_RESULT='));assert.ok(line,'Engine result missing');
  report.samples=JSON.parse(line.slice('ENGINE_PERFORMANCE_RESULT='.length));
  const s=report.samples,keys=['empty','loaded','paused','removed','resumed'];
  for(let i=0;i<keys.length;i++){
    const sample=s[keys[i]];assert.equal(sample.format,'craftmine.godot-engine-performance/1');assert.equal(sample.profile,'engine-monitor/1');
    assert.equal(sample.sequence,i+1);assert.equal(sample.headless,true);assert.equal(sample.debugBuild,true);assert.equal(sample.editorHint,false);
    for(const key of ['drawCalls','primitives','gpuTime']){assert.equal(sample.metrics[key].status,'unknown');assert.equal(sample.metrics[key].rawValue,undefined);}
    for(const key of ['objectCount','nodeCount']){assert.equal(sample.metrics[key].status,'measured');assert.ok(Number.isSafeInteger(sample.metrics[key].rawValue));}
    if(i){assert.ok(sample.processFrame>=s[keys[i-1]].processFrame);assert.ok(sample.physicsFrame>=s[keys[i-1]].physicsFrame);assert.ok(sample.monotonicUsec>=s[keys[i-1]].monotonicUsec);}
  }
  for(const key of ['empty','loaded','resumed'])for(const field of ['processTime','physicsTime','fps']){assert.equal(s[key].metrics[field].status,'measured');assert.ok(s[key].metrics[field].rawValue>0);}
  for(const key of ['paused','removed']){assert.equal(s[key].paused,true);for(const field of ['processTime','physicsTime','fps'])assert.equal(s[key].metrics[field].reason,'SCENE_TREE_PAUSED_NOT_ACTIVE_GAMEPLAY');}
  assert.equal(s.loaded.metrics.nodeCount.rawValue-s.empty.metrics.nodeCount.rawValue,256);
  assert.ok(s.loaded.metrics.objectCount.rawValue-s.empty.metrics.objectCount.rawValue>=256);
  assert.equal(s.removed.metrics.nodeCount.rawValue,s.empty.metrics.nodeCount.rawValue);
  assert.equal(s.customMonitorCalls,0);
  report.checks=['Pinned engine and enum identities','Real positive process/physics/FPS readings after publication','Exact 256 scene-node increase and removal','Engine object count increases with authored nodes','Paused timings and headless render/GPU remain unknown','No custom monitor invoked','Monotonic collector/frame identities'];
  report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}finally{save();console.log(JSON.stringify({out,passed:report.passed,error:report.error}));}
