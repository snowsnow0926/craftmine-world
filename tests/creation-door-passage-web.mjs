// Trusted authored fixtures, real isolated Web physics, no input simulation.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
import {createGodotProbeEnvironment} from '../desktop/godot/toolchain.mjs';import {createWorldRuntime,hashBuildDirectory} from '../desktop/godot/web/runtime.mjs';import {materializeBase} from '../desktop/godot/shared/materialize.mjs';import {playwright,browserOptions} from '../app/browser-tools.mjs';
import {freezeCreationRequirements,creationRequirementsHash} from '../vendor/pi-desktop/apps/desktop/electron/main/creation-check-requirements.ts';
import {verifyCreationDoorSequence,creationDoorTraceMatches} from '../vendor/pi-desktop/apps/desktop/electron/main/creation-door-verifier.ts';
import {readGodotCreationObservation} from '../vendor/pi-desktop/apps/desktop/electron/main/godot-check-requirements.ts';
const require=createRequire(import.meta.url),{generateSequenceDoorRule}=require('../plugins/craftmine-world/creation-sequence-rule.cjs');
const {CONTROLLER_PROTECTED_FILES,PROTECTED_CREATION_FILES,verifyCreationPack}=require('../plugins/craftmine-world/godot-creation-pack.cjs');
const root=path.resolve(import.meta.dirname,'..');fs.mkdirSync(path.join(root,'test-results'),{recursive:true});const out=fs.mkdtempSync(path.join(root,'test-results/creation-door-passage-web-'));
const report={format:'craftmine.creation-door-passage-web/1',out,passed:false,runs:[],cases:[],scope:'actual Web physics and fixed requirements evidence; authored descriptors, not ordinary player acceptance'};let browser,runtime,page;
try{
 const env=await createGodotProbeEnvironment(out,{web:true,threads:true});report.runs=env.runs;report.engineVersion=env.actualVersion;
 const host=fs.readFileSync(path.join(root,'vendor/pi-desktop/crates/craftmine-core/src/godot_host_resources.rs'),'utf8');const preset=JSON.parse(host.match(/const EXPORT_PRESET: &str = ("(?:\\.|[^"\\])*");/)[1]);
 browser=await playwright().chromium.launchPersistentContext(path.join(out,'profile'),{...browserOptions(),args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
 const entity=(id,kind,position)=>({id,kind,position,scale:[1,1,1],rotationY:0,color:'#84a866',parameters:{}});
 const entities=[entity('door-a','door',[0,0,0]),entity('marker-a','marker',[4,0,0]),entity('marker-b','marker',[4,0,-4])];
 for(const variant of ['correct','ghost-closed','retained-open','direct-open-bypass','legacy-probe','static-subclass']){
  const project=path.join(out,variant),exportRoot=path.join(out,variant+'-web');fs.mkdirSync(exportRoot);materializeBase({baseId:'creation-sandbox',worldId:'passage-world',out:project,controllerProfile:variant==='legacy-probe'?'legacy':'creation-fixed-controller/1'});
  const rule=generateSequenceDoorRule({id:'door-rule',doorId:'door-a',sequence:['marker-a','marker-b']});fs.mkdirSync(path.dirname(path.join(project,rule.declaration.script)),{recursive:true});fs.writeFileSync(path.join(project,rule.declaration.script),rule.text);fs.writeFileSync(path.join(project,'world/creation.json'),JSON.stringify({format:'craftmine.creation-scene/1',revision:1,defaults:{timeOfDay:12},entities,rules:[rule.declaration]}));
  const worldFile=path.join(project,'scripts/creation_world.gd');if(['ghost-closed','retained-open'].includes(variant)){const source=fs.readFileSync(worldFile,'utf8'),needle='shape.set_deferred("disabled", doors.get(id, false))';assert.equal(source.split(needle).length,2);fs.writeFileSync(worldFile,source.replace(needle,'shape.set_deferred("disabled", '+(variant==='ghost-closed'?'true':'false')+')'));}
  if(variant==='direct-open-bypass'){
   const source=fs.readFileSync(worldFile,'utf8'),pattern=/^(\t+)return \{"interacted": false, "reason": "rule-controlled", "entityId": id\}\r?$/m;
   assert.ok(pattern.test(source));fs.writeFileSync(worldFile,source.replace(pattern,(_,indent)=>indent+'set_door_open(id, true)\n'+indent+'return {"interacted": true, "entityId": id, "kind": "door"}'));
  }
  if(variant==='static-subclass'){
   fs.writeFileSync(path.join(project,'custom_controller.gd'),'extends "res://scripts/reused/player_controller.gd"\n');
   const file=path.join(project,'scenes/creation.tscn');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('path="res://scripts/reused/player_controller.gd"','path="res://custom_controller.gd"'));
  }
  fs.copyFileSync(path.join(root,'desktop/godot/web/shell.html'),path.join(project,'craftmine_host_shell.html'));fs.writeFileSync(path.join(project,'export_presets.cfg'),preset.replace('custom_template/release=""','custom_template/release='+JSON.stringify(env.webTemplate.replaceAll('\\','/'))));
  const protectedFiles=(variant==='legacy-probe'?PROTECTED_CREATION_FILES:CONTROLLER_PROTECTED_FILES).map(relative=>{const bytes=fs.readFileSync(path.join(project,relative));return {path:relative,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};});
  await env.run(variant+'-import',['--path',project,'--editor','--import']);await env.run(variant+'-export',['--path',project,'--export-release','Web',path.join(exportRoot,'index.html')],{timeout:120000});fs.copyFileSync(path.join(root,'desktop/godot/web/bridge.js'),path.join(exportRoot,'bridge.js'));
  const packProof=verifyCreationPack(fs.readFileSync(path.join(exportRoot,'index.pck')),protectedFiles);
  runtime=await createWorldRuntime({worldId:'passage-world',buildId:'gbd-'+await hashBuildDirectory(exportRoot),root:exportRoot,timeoutMs:60000});page=await browser.newPage();
  await page.exposeFunction('__post',message=>runtime.receive(message));await page.addInitScript(scope=>{globalThis.__guard={pointerLock:0,focus:0};Element.prototype.requestPointerLock=()=>{__guard.pointerLock++;throw Error('disabled');};window.focus=()=>{__guard.focus++;throw Error('disabled');};const handlers=[];globalThis.__craftmineRuntimeHost={scope,post:message=>void globalThis.__post(message),on:handler=>handlers.push(handler),onDetach:()=>{}};globalThis.__deliver=message=>handlers.forEach(handler=>handler(message));},{worldId:runtime.worldId,buildId:runtime.buildId,instanceId:runtime.instanceId});runtime.attach(message=>page.evaluate(value=>globalThis.__deliver(value),message));await page.goto(runtime.url,{waitUntil:'domcontentloaded'});await runtime.waitReady();assert.ok(!(await runtime.load()).error);const defaults=(await runtime.snapshot()).result.state;await runtime.resume();
  const requirements=freezeCreationRequirements({target:{entityId:null,position:null},entities},'依次触碰marker-a、marker-b后打开door-a').requirements;assert.equal(requirements.doorSequence.verifyPassage,true);
  const loaded=readGodotCreationObservation((await runtime.request('observe-envelope')).result,runtime,'loaded');
  const entry={variant,requirements,instanceId:runtime.instanceId,packProof};report.cases.push(entry);
  try{
   entry.trace=await verifyCreationDoorSequence(runtime,requirements,defaults,p=>p);assert.equal(variant,'correct','defective geometry must not pass');assert.ok(creationDoorTraceMatches(requirements,entry.trace));entry.status='passed';
   const frozen={format:'craftmine.godot-check-requirements/1',creation:requirements};const hash=creationRequirementsHash(requirements);
   entry.descriptor={format:'craftmine.godot-check-descriptor/1',phase:'check',jobId:'authored-passage-check',worldId:runtime.worldId,buildId:runtime.buildId,checkRequirements:frozen,checkRequirementsHash:hash};
   entry.evidence={format:'craftmine.godot-check-requirements-evidence/1',requirementsHash:hash,jobId:entry.descriptor.jobId,worldId:runtime.worldId,buildId:runtime.buildId,instanceId:runtime.instanceId,observations:[loaded,{...readGodotCreationObservation((await runtime.request('observe-envelope')).result,runtime,'running'),doorTrace:entry.trace}]};
  }catch(error){entry.error=String(error.message);entry.passage=error.passage;entry.status='failed';if(variant==='correct')throw error;
   const expected={'ghost-closed':'CREATION_PASSAGE_CLOSED_NOT_BLOCKING','retained-open':'CREATION_PASSAGE_OPENED_NOT_TRAVERSABLE','direct-open-bypass':'CREATION_PASSAGE_CLOSED_NOT_BLOCKING','legacy-probe':'CREATION_CONTROLLER_PROFILE_UNSUPPORTED:PROBE_UNAVAILABLE','static-subclass':'CREATION_CONTROLLER_PROFILE_UNSUPPORTED:PLAYER_SCRIPT_MISMATCH'};
   assert.equal(entry.error,expected[variant]);if(['ghost-closed','retained-open','direct-open-bypass'].includes(variant))assert.ok(entry.passage);
   if(variant==='direct-open-bypass')assert.equal(entry.passage.closed.lockedInteraction.doorOpen,true);
  }
  entry.guard=await page.evaluate(()=>globalThis.__guard);assert.deepEqual(entry.guard,{pointerLock:0,focus:0});
  await runtime.dispose({graceful:true});runtime=null;await page.close();page=null;
 }
 report.passed=true;
}catch(error){report.error=String(error.stack||error);throw error;}finally{await runtime?.dispose({graceful:false}).catch(()=>{});await browser?.close().catch(()=>{});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.passed,cases:report.cases.map(c=>({variant:c.variant,status:c.status,error:c.error}))}));}
