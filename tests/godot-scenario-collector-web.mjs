// Real Web exports on isolated Chromium profiles. No input simulation or model.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {materializeBase} from '../desktop/godot/shared/materialize.mjs';
import {createGodotProbeEnvironment} from '../desktop/godot/toolchain.mjs';
import {createWorldRuntime,hashBuildDirectory} from '../desktop/godot/web/runtime.mjs';
import {playwright,browserOptions} from '../app/browser-tools.mjs';
import {collectGodotScenarioDiagnostic} from '../vendor/pi-desktop/apps/desktop/electron/main/godot-scenario-collector.ts';
import {runScenarioOffscreen} from './fixtures/run-godot-scenario-offscreen.mjs';
const root=path.resolve(import.meta.dirname,'..');fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const out=fs.mkdtempSync(path.join(root,'test-results/godot-scenario-collector-web-'));
const report={format:'craftmine.godot-scenario-collector-web/1',out,passed:false,scope:'real isolated Web runtime plus host diagnostic provider; not complete Electron verifier/core readiness acceptance',runs:[],results:[],isolation:[]};
const plan={format:'craftmine.godot-scenario/1',fixtureRef:'web-door-authored-spawn-v1',steps:[{op:'wait',args:{frames:4}},{op:'walk',args:{forward:1,right:0,frames:90}},{op:'wait',args:{frames:4}},{op:'interact',args:{}},{op:'wait',args:{frames:4}},{op:'walk',args:{forward:1,right:0,frames:90}},{op:'wait',args:{frames:4}}],assertions:[
 {id:'initial',step:0,path:['state','player','position','2'],range:[2.99,3.01]},
 {id:'blocked',step:2,path:['state','player','position','2'],range:[.54,.7]},
 {id:'raycast-hit',step:3,path:['actionResult','interacted'],equals:true},
 {id:'right-target',step:3,path:['actionResult','entityId'],equals:'gate'},
 {id:'collision-released',step:4,path:['state','creation','entities','0','solid'],equals:false},
 {id:'actual-open',step:4,path:['state','creation','entities','0','open'],equals:true},
 {id:'walk-through',step:6,path:['state','player','position','2'],range:[-7,-3]}
]};
let browser;const active=new Set();
const sha=text=>createHash('sha256').update(text).digest('hex');
async function boot(exportRoot,binding){
 const runtime=await createWorldRuntime({worldId:binding.worldId,buildId:binding.buildId,root:exportRoot,timeoutMs:60000});
 const page=await browser.newPage(),entry={runtime,page};active.add(entry);
 await page.exposeFunction('__post',message=>runtime.receive(message));
 await page.addInitScript(scope=>{globalThis.__scenarioGuard={pointerLock:0,focus:0};Element.prototype.requestPointerLock=()=>{globalThis.__scenarioGuard.pointerLock++;throw Error('disabled');};window.focus=()=>{globalThis.__scenarioGuard.focus++;throw Error('disabled');};const handlers=[];globalThis.__craftmineRuntimeHost={scope,post:message=>void globalThis.__post(message),on:handler=>handlers.push(handler),onDetach:()=>{}};globalThis.__deliver=message=>handlers.forEach(handler=>handler(message));},{worldId:runtime.worldId,buildId:runtime.buildId,instanceId:runtime.instanceId});
 runtime.attach(message=>page.evaluate(value=>globalThis.__deliver(value),message));
 await page.goto(runtime.url,{waitUntil:'domcontentloaded'});await runtime.waitReady();assert.ok(!(await runtime.load()).error);assert.ok(!(await runtime.resume()).error);
 return entry;
}
async function close(entry){report.isolation.push({instanceId:entry.runtime.instanceId,guard:await entry.page.evaluate(()=>globalThis.__scenarioGuard)});await entry.runtime.dispose({graceful:true});await entry.page.close();active.delete(entry);}
try{
 const env=await createGodotProbeEnvironment(out,{web:true,threads:true});report.runs=env.runs;report.engineVersion=env.actualVersion;
 browser=await playwright().chromium.launchPersistentContext(path.join(out,'browser-profile'),{...browserOptions(),args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
 const host=fs.readFileSync(path.join(root,'vendor/pi-desktop/crates/craftmine-core/src/godot_host_resources.rs'),'utf8');const preset=JSON.parse(host.match(/const EXPORT_PRESET: &str = ("(?:\\.|[^"\\])*");/)[1]);
 for(const variant of ['correct','collision-retained']){
  const project=path.join(out,variant),exportRoot=path.join(out,variant+'-web');fs.mkdirSync(exportRoot);materializeBase({baseId:'creation-sandbox',worldId:'gu4-web-fixture',out:project});
  const sceneFile=path.join(project,'scenes/creation.tscn');fs.writeFileSync(sceneFile,fs.readFileSync(sceneFile,'utf8').replace('position = Vector3(0, 0.9, 6)','position = Vector3(0, 0.9, 3)'));
  fs.writeFileSync(path.join(project,'world/creation.json'),JSON.stringify({format:'craftmine.creation-scene/1',revision:1,defaults:{timeOfDay:12},entities:[{id:'gate',kind:'door',position:[0,0,0],scale:[1,1,1],rotationY:0,color:'#84a866',parameters:{}}],rules:[]}));
  if(variant==='collision-retained'){const file=path.join(project,'scripts/creation_world.gd');const source=fs.readFileSync(file,'utf8'),target='shape.set_deferred("disabled", doors.get(id, false))';assert.equal(source.split(target).length,2);fs.writeFileSync(file,source.replace(target,'shape.set_deferred("disabled", false)'));}
  fs.copyFileSync(path.join(root,'desktop/godot/web/shell.html'),path.join(project,'craftmine_host_shell.html'));fs.writeFileSync(path.join(project,'export_presets.cfg'),preset.replace('custom_template/release=""','custom_template/release='+JSON.stringify(env.webTemplate.replaceAll('\\','/'))));
  await env.run(variant+'-import',['--path',project,'--editor','--import']);await env.run(variant+'-export',['--path',project,'--export-release','Web',path.join(exportRoot,'index.html')],{timeout:120000});fs.copyFileSync(path.join(root,'desktop/godot/web/bridge.js'),path.join(exportRoot,'bridge.js'));
  const binding={jobId:'gjob-'+sha(variant),inputHash:sha(JSON.stringify(plan)),worldId:'gu4-web-fixture',buildId:'gbd-'+await hashBuildDirectory(exportRoot),baseId:'creation-sandbox'};
  let entry=await boot(exportRoot,binding);
  const diagnostic=await collectGodotScenarioDiagnostic({binding,runtime:entry.runtime,plan,signal:new AbortController().signal});report.results.push({variant,diagnostic});assert.equal(diagnostic.status,variant==='correct'?'passed':'failed',JSON.stringify(diagnostic));assert.equal(diagnostic.affectsCandidateReadiness,false);await close(entry);
  if(variant==='correct'){
   entry=await boot(exportRoot,binding);const controller=new AbortController(),calls=[];const access={...entry.runtime,request:async(op,args)=>{calls.push(op);const pending=entry.runtime.request(op,args);if(op==='walk')setTimeout(()=>controller.abort(),30);return pending;}};
   const cancelled=await collectGodotScenarioDiagnostic({binding,runtime:access,plan,signal:controller.signal});report.results.push({variant:'cancel-during-real-walk',diagnostic:cancelled});assert.equal(cancelled.reason,'SCENARIO_CANCELLED');assert.ok(!calls.includes('interact'));await close(entry);
   const old=await boot(exportRoot,binding),replacement=await boot(exportRoot,binding);let selected=old.runtime;const switchedCalls=[];
   const switching={get worldId(){return selected.worldId;},get buildId(){return selected.buildId;},get instanceId(){return selected.instanceId;},request:async(op,args)=>{switchedCalls.push({instanceId:selected.instanceId,op});const response=await selected.request(op,args);if(op==='walk')selected=replacement.runtime;return response;}};
   const switched=await collectGodotScenarioDiagnostic({binding,runtime:switching,plan,signal:new AbortController().signal});report.results.push({variant:'actual-runtime-replacement',diagnostic:switched});assert.equal(switched.reason,'SCENARIO_RUNTIME_IDENTITY_CHANGED');assert.ok(switchedCalls.every(c=>c.instanceId===old.runtime.instanceId));const unchanged=(await replacement.runtime.request('observe-envelope')).result.payload.player.position;assert.ok(Math.abs(unchanged[2]-3)<.01);await close(old);await close(replacement);
  }
 }
 assert.ok(report.isolation.every(item=>item.guard.pointerLock===0&&item.guard.focus===0));
 await browser.close();browser=null;
 report.offscreen=await runScenarioOffscreen(out,plan);report.passed=true;
}catch(error){report.error=String(error.stack||error);throw error;}finally{for(const entry of active){await entry.runtime.dispose({graceful:false}).catch(()=>{});await entry.page.close().catch(()=>{});}await browser?.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.passed,results:report.results.map(r=>({variant:r.variant,status:r.diagnostic.status,reason:r.diagnostic.reason}))}));}
