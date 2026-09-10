import {readGodotCreationObservation,godotCreationMatches} from '../vendor/pi-desktop/apps/desktop/electron/main/godot-check-requirements.ts';
// Isolated real Web engine: no physical input, focus or pointer-lock requests.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
import {createGodotProbeEnvironment} from '../desktop/godot/toolchain.mjs';import {createWorldRuntime} from '../desktop/godot/web/runtime.mjs';import {materializeBase} from '../desktop/godot/shared/materialize.mjs';import {playwright,browserOptions} from '../app/browser-tools.mjs';
import {freezeCreationRequirements,creationEntitiesMatch} from '../vendor/pi-desktop/apps/desktop/electron/main/creation-check-requirements.ts';import {verifyCreationHarvest,creationHarvestTraceMatches} from '../vendor/pi-desktop/apps/desktop/electron/main/creation-harvest-verifier.ts';
const require=createRequire(import.meta.url),{generateSequenceDoorRule}=require('../plugins/craftmine-world/creation-sequence-rule.cjs');
const root=path.resolve(import.meta.dirname,'..');fs.mkdirSync(path.join(root,'test-results'),{recursive:true});const out=fs.mkdtempSync(path.join(root,'test-results/creation-harvest-web-'));
const report={format:'craftmine.creation-harvest-engine/1',out,checks:[],runs:[],passed:false};let browser,runtime,page;
const check=(name,value)=>{report.checks.push({name,passed:!!value});assert.ok(value,name);console.log('PASS '+name);};
try{
 const env=await createGodotProbeEnvironment(out,{web:true,threads:true});report.runs=env.runs;
 const host=fs.readFileSync(path.join(root,'vendor/pi-desktop/crates/craftmine-core/src/godot_host_resources.rs'),'utf8');const preset=JSON.parse(host.match(/const EXPORT_PRESET: &str = ("(?:\\.|[^"\\])*");/)[1]);
 browser=await playwright().chromium.launchPersistentContext(path.join(out,'profile'),{...browserOptions(),args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
 const entity=(id,kind,position,scale=[1,1,1])=>({id,kind,position,scale,rotationY:0,color:'#84a866',parameters:{}});
 const entities=[entity('tree-a','tree',[0,0,0])];
 for(const variant of ['harvest','double-reward','early-regrowth','lost-progress']){
  const project=path.join(out,variant),exportRoot=path.join(out,variant+'-web');fs.mkdirSync(exportRoot);materializeBase({baseId:'creation-sandbox',worldId:'requirement-world',out:project});
  const rule={declaration:{id:'harvest-rule',kind:'entity-behavior',entityIds:['tree-a'],script:'scripts/creation/rules/harvest-rule.gd',sha256:''},text:fs.readFileSync(path.join(root,'tests/fixtures/creation-harvest.gd'),'utf8')};
  if(variant==='double-reward')rule.text=rule.text.replace('get("wood", 0)) + 1','get("wood", 0)) + 2');
  if(variant==='early-regrowth')rule.text=rule.text.replace('remaining_ticks = 300','remaining_ticks = 60');
  if(variant==='lost-progress')rule.text=rule.text.replace('remaining_ticks = int(data.remainingTicks)','remaining_ticks = 0');
  rule.declaration.sha256=createHash('sha256').update(rule.text).digest('hex');
  fs.mkdirSync(path.dirname(path.join(project,rule.declaration.script)),{recursive:true});fs.writeFileSync(path.join(project,rule.declaration.script),rule.text);fs.writeFileSync(path.join(project,'world/creation.json'),JSON.stringify({format:'craftmine.creation-scene/1',revision:1,defaults:{timeOfDay:12},entities,rules:[rule.declaration]}));
  fs.copyFileSync(path.join(root,'desktop/godot/web/shell.html'),path.join(project,'craftmine_host_shell.html'));fs.writeFileSync(path.join(project,'export_presets.cfg'),preset.replace('custom_template/release=""','custom_template/release='+JSON.stringify(env.webTemplate.replaceAll('\\','/'))));
  await env.run(variant+'-import',['--path',project,'--editor','--import']);await env.run(variant+'-export',['--path',project,'--export-release','Web',path.join(exportRoot,'index.html')],{timeout:120000});fs.copyFileSync(path.join(root,'desktop/godot/web/bridge.js'),path.join(exportRoot,'bridge.js'));
  runtime=await createWorldRuntime({worldId:'requirement-world',buildId:'check-'+variant,root:exportRoot,timeoutMs:60000});page=await browser.newPage();
  await page.exposeFunction('__post',message=>runtime.receive(message));await page.addInitScript(scope=>{Element.prototype.requestPointerLock=()=>{throw Error('disabled');};window.focus=()=>{throw Error('disabled');};const handlers=[];globalThis.__craftmineRuntimeHost={scope,post:message=>void globalThis.__post(message),on:handler=>handlers.push(handler),onDetach:()=>{}};globalThis.__deliver=message=>handlers.forEach(handler=>handler(message));},{worldId:runtime.worldId,buildId:runtime.buildId,instanceId:runtime.instanceId});runtime.attach(message=>page.evaluate(value=>globalThis.__deliver(value),message));await page.goto(runtime.url,{waitUntil:'domcontentloaded'});await runtime.waitReady();
  assert.ok(!(await runtime.load()).error);const defaults=(await runtime.snapshot()).result.state;await runtime.resume();
  const raw=(await runtime.request('observe-envelope')).result;const actual=raw.payload.creation.entities;
  check(variant+' actual ordinary script loaded',actual.length===1&&actual[0].visible===true&&actual[0].solid===true);
  const required=freezeCreationRequirements({target:{entityId:'tree-a',position:[0,0,0]},entities},'让这棵树可以按E砍伐，砍掉时给背包增加一块木头，5秒后重新长出来。保存重开后保留木头和树的生长状态。').requirements;
  if(variant==='harvest'){const trace=await verifyCreationHarvest(runtime,required,defaults,p=>p);report.trace=trace;check('actual harvest, reward, no-repeat, restoration and regrowth',creationHarvestTraceMatches(required,trace));
   const hidden=(await runtime.request('observe-envelope')).result;const hiddenTree=hidden.payload.creation.entities[0];check('trusted declaration marks hidden behavior presence as mutable',hiddenTree.presenceMutable===true&&hiddenTree.visible===false&&hiddenTree.solid===false);
   const nextWish=freezeCreationRequirements({target:{entityId:null,position:[4,0,0]},entities:hidden.payload.creation.entities},'把时间设为18点').requirements;
   await runtime.request('wait',{frames:330});await runtime.request('set-time',{hours:18});
   check('later unrelated wish accepts actual natural regrowth with preserved identity',godotCreationMatches(readGodotCreationObservation((await runtime.request('observe-envelope')).result,runtime,'running'),{format:'craftmine.godot-check-requirements/1',creation:nextWish}));}
  else {await assert.rejects(verifyCreationHarvest(runtime,required,defaults,p=>p),/REQUIREMENTS_MISMATCH|PROGRESS_MISMATCH|HARVEST_RESTORE|restore differs from projection/);check(variant+' runnable incorrect behavior rejected',true);}
  await runtime.dispose({graceful:true});runtime=null;await page.close();page=null;
 }
 report.passed=true;
}catch(error){report.error=String(error.stack||error);if(error.trace)report.failedTrace=error.trace;throw error;}finally{await runtime?.dispose({graceful:false}).catch(()=>{});await browser?.close().catch(()=>{});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log('Report '+path.join(out,'report.json'));}
