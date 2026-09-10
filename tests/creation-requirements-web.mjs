import {readGodotCreationObservation,godotCreationMatches} from '../vendor/pi-desktop/apps/desktop/electron/main/godot-check-requirements.ts';
// Isolated real Web engine: no physical input, focus or pointer-lock requests.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
import {createGodotProbeEnvironment} from '../desktop/godot/toolchain.mjs';import {createWorldRuntime} from '../desktop/godot/web/runtime.mjs';import {materializeBase} from '../desktop/godot/shared/materialize.mjs';import {playwright,browserOptions} from '../app/browser-tools.mjs';
import {freezeCreationRequirements,creationEntitiesMatch} from '../vendor/pi-desktop/apps/desktop/electron/main/creation-check-requirements.ts';import {verifyCreationDoorSequence,creationDoorTraceMatches} from '../vendor/pi-desktop/apps/desktop/electron/main/creation-door-verifier.ts';
const require=createRequire(import.meta.url),{generateSequenceDoorRule}=require('../plugins/craftmine-world/creation-sequence-rule.cjs');
const root=path.resolve(import.meta.dirname,'..');fs.mkdirSync(path.join(root,'test-results'),{recursive:true});const out=fs.mkdtempSync(path.join(root,'test-results/creation-requirements-web-'));
const report={format:'craftmine.creation-requirements-engine/1',out,checks:[],runs:[],passed:false};let browser,runtime,page;
const check=(name,value)=>{report.checks.push({name,passed:!!value});assert.ok(value,name);console.log('PASS '+name);};
try{
 const env=await createGodotProbeEnvironment(out,{web:true,threads:true});report.runs=env.runs;
 const host=fs.readFileSync(path.join(root,'vendor/pi-desktop/crates/craftmine-core/src/godot_host_resources.rs'),'utf8');const preset=JSON.parse(host.match(/const EXPORT_PRESET: &str = ("(?:\\.|[^"\\])*");/)[1]);
 browser=await playwright().chromium.launchPersistentContext(path.join(out,'profile'),{...browserOptions(),args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
 const entity=(id,kind,position,scale=[1,1,1])=>({id,kind,position,scale,rotationY:0,color:'#84a866',parameters:{}});
 const entities=[entity('tree-a','tree',[4,0,0],[2,2,2]),entity('door-a','door',[-4,0,0]),entity('marker-a','marker',[0,0,0]),entity('marker-b','marker',[0,0,-4]),entity('copy-a','tree',[8,0,0],[2,2,2]),entity('copy-b','tree',[12,0,0],[2,2,2])];
 for(const variant of ['correct','unconditional','overlapping-copies']){
  entities[5].position=variant==='overlapping-copies'?[8,0,0]:[12,0,0];
  const project=path.join(out,variant),exportRoot=path.join(out,variant+'-web');fs.mkdirSync(exportRoot);materializeBase({baseId:'creation-sandbox',worldId:'requirement-world',out:project});
  const rule=generateSequenceDoorRule({id:'door-rule',doorId:'door-a',sequence:['marker-a','marker-b']});
  if(variant==='unconditional'){rule.text=rule.text.replace('func on_entity_interacted(entity_id: String) -> void:', 'func on_entity_interacted(entity_id: String) -> void:\n\t_host.set_door_open(DOOR_ID, true)');rule.declaration.sha256=createHash('sha256').update(rule.text).digest('hex');}
  fs.mkdirSync(path.dirname(path.join(project,rule.declaration.script)),{recursive:true});fs.writeFileSync(path.join(project,rule.declaration.script),rule.text);fs.writeFileSync(path.join(project,'world/creation.json'),JSON.stringify({format:'craftmine.creation-scene/1',revision:1,defaults:{timeOfDay:12},entities,rules:[rule.declaration]}));
  fs.copyFileSync(path.join(root,'desktop/godot/web/shell.html'),path.join(project,'craftmine_host_shell.html'));fs.writeFileSync(path.join(project,'export_presets.cfg'),preset.replace('custom_template/release=""','custom_template/release='+JSON.stringify(env.webTemplate.replaceAll('\\','/'))));
  await env.run(variant+'-import',['--path',project,'--editor','--import']);await env.run(variant+'-export',['--path',project,'--export-release','Web',path.join(exportRoot,'index.html')],{timeout:120000});fs.copyFileSync(path.join(root,'desktop/godot/web/bridge.js'),path.join(exportRoot,'bridge.js'));
  runtime=await createWorldRuntime({worldId:'requirement-world',buildId:'check-'+variant,root:exportRoot,timeoutMs:60000});page=await browser.newPage();
  await page.exposeFunction('__post',message=>runtime.receive(message));await page.addInitScript(scope=>{Element.prototype.requestPointerLock=()=>{throw Error('disabled');};window.focus=()=>{throw Error('disabled');};const handlers=[];globalThis.__craftmineRuntimeHost={scope,post:message=>void globalThis.__post(message),on:handler=>handlers.push(handler),onDetach:()=>{}};globalThis.__deliver=message=>handlers.forEach(handler=>handler(message));},{worldId:runtime.worldId,buildId:runtime.buildId,instanceId:runtime.instanceId});runtime.attach(message=>page.evaluate(value=>globalThis.__deliver(value),message));await page.goto(runtime.url,{waitUntil:'domcontentloaded'});await runtime.waitReady();
  assert.ok(!(await runtime.load()).error);const defaults=(await runtime.snapshot()).result.state;await runtime.resume();
  const raw=(await runtime.request('observe-envelope')).result;const actual=raw.payload.creation.entities;
  check(variant+' real engine answers entities',actual.length===6);
  const captured={target:{entityId:'tree-a',position:[4,0,0]},entities:[{...entities[0],scale:[1,1,1]},...entities.slice(1)]};const enlarged=freezeCreationRequirements(captured,'把这棵树放大到2倍').requirements;
  check(variant+' correct runtime target and scale',creationEntitiesMatch(enlarged,actual));check(variant+' wrong scale rejected',!creationEntitiesMatch({...enlarged,entities:[{id:'tree-a',scale:[3,3,3]}]},actual));check(variant+' wrong identity rejected',!creationEntitiesMatch({...enlarged,entities:[{id:'tree-wrong',scale:[2,2,2]}]},actual));check(variant+' wrong color rejected',!creationEntitiesMatch({...enlarged,entities:[{id:'tree-a',color:'#ff0000'}]},actual));check(variant+' wrong count rejected',!creationEntitiesMatch({...enlarged,counts:[{kind:'tree',count:2}]},actual));
  const observation=readGodotCreationObservation(raw,runtime,'running');
  const copyRequired=freezeCreationRequirements({target:{entityId:'tree-a',position:[4,0,0]},entities:entities.slice(0,4)},'复制这棵树两个，排开一点').requirements;
  check(variant+' actual duplicate count, style and separated collision bounds',creationEntitiesMatch(copyRequired,observation.entities)===(variant!=='overlapping-copies'));
  const timeRequired={format:'craftmine.godot-check-requirements/1',creation:freezeCreationRequirements({target:{entityId:null,position:null},entities},'把时间设为18点').requirements};
  check(variant+' wrong actual time rejected',!godotCreationMatches(observation,timeRequired));await runtime.request('set-time',{hours:18});
  check(variant+' exact requested time observed',godotCreationMatches(readGodotCreationObservation((await runtime.request('observe-envelope')).result,runtime,'running'),timeRequired));
  const required=freezeCreationRequirements({target:{entityId:null,position:null},entities},'依次触碰marker-a、marker-b后打开door-a').requirements;
  if(variant!=='unconditional'){const trace=await verifyCreationDoorSequence(runtime,required,defaults,p=>p);report.trace=trace;check('real sequence requires ordered interactions',creationDoorTraceMatches(required,trace));}
  else{await assert.rejects(verifyCreationDoorSequence(runtime,required,defaults,p=>p),/WRONG_ORDER|OPEN_TOO_EARLY/);check('runnable unconditional door candidate rejected',true);}
  await runtime.dispose({graceful:true});runtime=null;await page.close();page=null;
 }
 report.passed=true;
}catch(error){report.error=String(error.stack||error);throw error;}finally{await runtime?.dispose({graceful:false}).catch(()=>{});await browser?.close().catch(()=>{});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log('Report '+path.join(out,'report.json'));}
