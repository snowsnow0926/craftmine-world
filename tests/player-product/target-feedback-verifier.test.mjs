// Unit simulation of the actual verifier class and finite parser. No Electron
// process or engine is launched; native acceptance is a separate harness.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {parseGodotCheckRequirements,readGodotTargetFeedback,godotTargetFeedbackMatches} from '../../vendor/pi-desktop/apps/desktop/electron/main/godot-check-requirements.ts';
const root=path.resolve(import.meta.dirname,'../..');
const dependencies=process.env.CRAFTMINE_NATIVE_DEPENDENCY_ROOT??root;
const require=createRequire(path.join(dependencies,'vendor/pi-desktop/packages/agent-runtime/package.json'));
const {build}=require('esbuild');
const hash=value=>createHash('sha256').update(value).digest('hex');
const requirements={format:'craftmine.godot-check-requirements/1',targetFeedback:{targetId:'target_a',hitFlashMilliseconds:500}};
const digest=hash('craftmine.godot-check-requirements/1\ntarget_a\n500\n');
const scope={worldId:'world',buildId:'gbd-'+'b'.repeat(64),instanceId:'instance'};
const envelope=(value=500)=>({format:'craftmine.godot-observation/1',...scope,baseId:'first-person',baseVersion:'0.1.0',sampledAt:'2026-09-10T00:00:00Z',payload:{targetFeedback:{format:'craftmine.target-feedback-observation/1',targets:[{targetId:'target_a',hitFlashMilliseconds:value}]}}});
const code=(await build({entryPoints:[path.join(root,'vendor/pi-desktop/apps/desktop/electron/main/godot-build-verifier.ts')],bundle:true,platform:'node',format:'cjs',write:false,external:['electron'],plugins:[{name:'fixture-runtime',setup(builder){builder.onResolve({filter:/godot\/web\/runtime\.mjs$/},()=>({path:'fixture-runtime',external:true}));}}]})).outputFiles[0].text;

test('finite requirements parser binds exact format, fields, base and newline-framed hash',()=>{
 assert.equal(parseGodotCheckRequirements(requirements,digest,'first-person').checkRequirementsHash,digest);
 assert.equal(parseGodotCheckRequirements(undefined,undefined,'top-down'),undefined);
 for(const [value,signature,base] of [[requirements,undefined,'first-person'],[undefined,digest,'first-person'],[null,null,'first-person'],[requirements,digest,'top-down'],[requirements,'0'.repeat(64),'first-person'],[{...requirements,extra:true},digest,'first-person'],[{...requirements,targetFeedback:{...requirements.targetFeedback,targetId:'target_a\n'}},digest,'first-person'],[{...requirements,targetFeedback:{targetId:'target_a',hitFlashMilliseconds:0}},digest,'first-person'],[{...requirements,targetFeedback:{...requirements.targetFeedback,path:'x'}},digest,'first-person']])assert.throws(()=>parseGodotCheckRequirements(value,signature,base),/INVALID_GODOT_CHECK_REQUIREMENTS/);
});
test('runtime extraction binds live identity and retains finite actual values without rounding',()=>{
 const actual=readGodotTargetFeedback(envelope(500.0000001),scope,'target_a','loaded');assert.equal(actual.hitFlashMilliseconds,500.0000001);assert.equal(godotTargetFeedbackMatches(actual,requirements),true);
 assert.equal(godotTargetFeedbackMatches(readGodotTargetFeedback(envelope(700),scope,'target_a','running'),requirements),false);
 for(const change of [value=>value.instanceId='old',value=>value.worldId='other',value=>value.buildId='old',value=>delete value.payload.targetFeedback,value=>value.payload.targetFeedback.targets.push({...value.payload.targetFeedback.targets[0]}),value=>value.payload.targetFeedback.targets[0].hitFlashMilliseconds=NaN,value=>value.payload.targetFeedback.error='TARGET_FEEDBACK_INVALID_DURATION']){const value=envelope();change(value);assert.throws(()=>readGodotTargetFeedback(value,scope,'target_a','loaded'),/OBSERVATION_INVALID/);}
});

async function fixture(t,{loaded=500,running=500,required=true,malformed=false}={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'target-verifier-unit-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const bytes=Buffer.from('fixed unit artifact');await fs.mkdir(path.join(directory,'web'));await fs.writeFile(path.join(directory,'web/index.html'),bytes);
 const calls=[];let windows=0,captures=0,observations=0;
 const runtime={...scope,url:'http://127.0.0.1:12345/world',origin:'http://127.0.0.1:12345',protocol:'craftmine.godot-runtime/2',state:'ready',attach:()=>()=>{},onEvent:()=>{},receive:()=>{},waitReady:async()=>({ops:['load','snapshot','observe-envelope','resume']}),load:async()=>{calls.push('load');return {result:{loaded:true}};},snapshot:async()=>{calls.push('snapshot');return {result:{state:{body:{health:3}}}};},resume:async()=>{calls.push('resume');return {result:{resumed:true}};},request:async(op)=>{assert.equal(op,'observe-envelope');const phase=observations++===0?'loaded':'running';calls.push('observe:'+phase);const value=envelope(phase==='loaded'?loaded:running);if(malformed)value.instanceId='wrong';return {result:value};},exit:async()=>{calls.push('exit');return {result:{exitCode:0}};},dispose:async()=>{runtime.state='disposed';}};
 class Window{
  constructor(options){windows++;assert.equal(options.show,false);assert.equal(options.focusable,false);this.dead=false;this.webContents={isOffscreen:()=>true,isDestroyed:()=>false,setWindowOpenHandler:()=>{},on:()=>{},ipc:{on:()=>{}},send:()=>{},mainFrame:{framesInSubtree:[{executeJavaScript:async()=>({guard:{focus:0,pointerLock:0},node:'undefined',bridge:'undefined'})}]},executeJavaScript:async()=>false,invalidate:()=>{},capturePage:async()=>{captures++;calls.push('capture');return {getSize:()=>({width:320,height:240}),toBitmap:()=>Buffer.alloc(320*240*4,100),toPNG:()=>Buffer.from('paint'+captures)};}};}
  getBounds(){return {width:960,height:640};}isFocusable(){return false;}isVisible(){return false;}isDestroyed(){return this.dead;}destroy(){this.dead=true;}async loadURL(){}
 }
 const isolated={setPermissionRequestHandler:()=>{},setPermissionCheckHandler:()=>{},webRequest:{onBeforeRequest:()=>{}},registerPreloadScript:()=>{},clearStorageData:async()=>{}};
 const module={exports:{}};
 const factory=vm.runInThisContext('(function(require,module,exports,__dirname){'+code+'\n})');
 factory(name=>name==='electron'?{BrowserWindow:Window,session:{fromPartition:()=>isolated}}:name==='fixture-runtime'?{createWorldRuntime:async()=>runtime}:require(name),module,module.exports,directory);
 const descriptor={format:'craftmine.godot-check-descriptor/1',phase:'check',jobId:'gjob-'+'a'.repeat(64),inputHash:'c'.repeat(64),worldId:scope.worldId,buildId:scope.buildId,baseId:'first-person',root:directory,entry:'web/index.html',threads:true,artifacts:[{path:'web/index.html',bytes:bytes.length,sha256:hash(bytes)}],snapshot:null,...(required?{checkRequirements:requirements,checkRequirementsHash:digest}:{})};
 return {verifier:new module.exports.GodotBuildVerifier(),descriptor,calls,get windows(){return windows;},get captures(){return captures;}};
}
test('actual verifier class samples after load and after resumed frame checks, binding both observations',async t=>{
 const f=await fixture(t);const evidence=await f.verifier.check(f.descriptor);
 assert.equal(evidence.passed,true);assert.equal(evidence.requirementsEvidence.requirementsHash,digest);
 assert.deepEqual(evidence.requirementsEvidence.observations,[{phase:'loaded',targetId:'target_a',hitFlashMilliseconds:500},{phase:'running',targetId:'target_a',hitFlashMilliseconds:500}]);
 assert.equal(evidence.assertions.filter(item=>item.id==='runtime.target-feedback').length,1);
 assert.deepEqual(f.calls,['load','observe:loaded','snapshot','resume','capture','capture','capture','observe:running','exit']);
});
test('loaded mismatch fails entire check and preserves only actual partial observations',async t=>{
 const f=await fixture(t,{loaded:700});const evidence=await f.verifier.check(f.descriptor);
 assert.equal(evidence.passed,false);assert.match(evidence.error,/MISMATCH:loaded/);assert.equal(f.captures,0);
 assert.deepEqual(evidence.requirementsEvidence.observations,[{phase:'loaded',targetId:'target_a',hitFlashMilliseconds:700}]);
 assert.equal(evidence.assertions.find(item=>item.id==='runtime.target-feedback').passed,false);
});
test('running mismatch after successful frames is still a failed check',async t=>{
 const f=await fixture(t,{running:700});const evidence=await f.verifier.check(f.descriptor);
 assert.equal(evidence.render.ok,true);assert.equal(evidence.snapshot.ok,true);assert.equal(evidence.passed,false);assert.match(evidence.error,/MISMATCH:running/);
 assert.deepEqual(evidence.requirementsEvidence.observations.map(item=>item.hitFlashMilliseconds),[500,700]);
});
test('wrong instance never becomes a parameter observation or passing assertion',async t=>{
 const f=await fixture(t,{malformed:true});const evidence=await f.verifier.check(f.descriptor);
 assert.equal(evidence.passed,false);assert.deepEqual(evidence.requirementsEvidence.observations,[]);assert.match(evidence.error,/OBSERVATION_INVALID/);
});
test('legacy jobs retain six checks without extra observations; malformed requirements fail before window creation',async t=>{
 const f=await fixture(t,{required:false});const evidence=await f.verifier.check(f.descriptor);assert.equal(evidence.passed,true);assert.equal(evidence.assertions.length,6);assert.equal(evidence.requirementsEvidence,undefined);assert.ok(!f.calls.some(call=>call.startsWith('observe')));
 const bad=await fixture(t);await assert.rejects(bad.verifier.check({...bad.descriptor,checkRequirementsHash:'0'.repeat(64)}),/INVALID_GODOT_CHECK_REQUIREMENTS/);assert.equal(bad.windows,0);
});
