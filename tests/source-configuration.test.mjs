import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {buildApprovedPomeranianPackage} from '../desktop/build-approved-pomeranian-package.mjs';
import {buildBuiltinPetPackage} from '../desktop/build-builtin-pet-package.mjs';
import {unpackStaticPackage} from '../plugins/craftmine-world/package-zip.mjs';
const require=createRequire(import.meta.url);
const {configurationHint,validatePositionBounds,resolveSourceConfiguration}=require('../plugins/craftmine-world/source-configuration.cjs');
const {assessArchiveForSource}=require('../plugins/craftmine-world/source-library-read-hints.cjs');
const {profiles}=require('../plugins/craftmine-world/companion-position-profiles.json');
const repository=path.resolve(import.meta.dirname,'..'),source={revision:4,manifestHash:'a'.repeat(64)};
const profileMap=profile=>new Map([{path:profile.path,sha256:profile.sha256},...profile.selectors].map(file=>[file.path,file]));
const city=profiles.find(p=>p.id==='orgrimmar-city'),sandbox=profiles.find(p=>p.id==='stock-sandbox');
const bounds={minimum:[-240,-20,-300],maximum:[240,160,80],expectedSource:source};

test('published v3 read declarations resolve exact pins and never infer bounds from a lone stock script',()=>{
 for(const build of [buildApprovedPomeranianPackage,buildBuiltinPetPackage]){
  const archive=unpackStaticPackage(build({repository,version:3}).bytes),content=archive.resources[0].manifest.content;
  for(const profile of profiles){
   const files=profileMap(profile),hint=configurationHint(content,files,source);
   assert.equal(hint.status,'configuration-planned');assert.equal(hint.appliedToInstances,false);
   assert.deepEqual(hint.positionBounds.minimum,profile.minimum);
   const plan=resolveSourceConfiguration(archive,files,source);
   assert.deepEqual(plan[0].properties.saved_position_max,profile.maximum);
   for(const missing of [profile.path,...profile.selectors.map(s=>s.path)]){
    const changed=new Map(files);changed.set(missing,{path:missing,sha256:'b'.repeat(64)});
    assert.equal(configurationHint(content,changed,source).status,'configuration-required');
    assert.throws(()=>resolveSourceConfiguration(archive,changed,source),/PACKAGE_POSITION_BOUNDS_REQUIRED/);
   }
  }
  const custom=new Map(profileMap(sandbox));custom.set(city.path,{path:city.path,sha256:'c'.repeat(64)});
  assert.equal(configurationHint(content,custom,source).status,'configuration-required','custom city must not fall through to sandbox bounds');
  assert.deepEqual(resolveSourceConfiguration(archive,custom,source,bounds)[0].properties,{saved_position_min:bounds.minimum,saved_position_max:bounds.maximum});
  assert.throws(()=>resolveSourceConfiguration(archive,custom,{...source,revision:5},bounds),/PACKAGE_CONFIGURATION_SOURCE_CHANGED/);
 }
});

test('old fixed-bound versions disclose limits without rewriting their manifests or archives',()=>{
 for(const build of [buildApprovedPomeranianPackage,buildBuiltinPetPackage]){
  const result=build({repository,version:2}),bytes=Buffer.from(result.bytes),archive=unpackStaticPackage(bytes),content=archive.resources[0].manifest.content;
  const original=structuredClone(content);
  assert.equal(configurationHint(content,profileMap(city),source).status,'legacy-range-insufficient');
  assert.equal(configurationHint(content,profileMap(sandbox),source).status,'legacy-range-covers-stock');
  assert.equal(configurationHint(content,new Map(),source).status,'legacy-range-unverified');
  assert.equal(resolveSourceConfiguration(archive,profileMap(city),source)[0].warning.status,'legacy-range-insufficient');
  assert.equal(resolveSourceConfiguration(archive,new Map(),source)[0].warning.status,'legacy-range-unverified');
  assert.match(resolveSourceConfiguration(archive,profileMap(sandbox),source)[0].warning.instruction,/never rewrite old archives/);
  assert.throws(()=>resolveSourceConfiguration(archive,new Map(),source,bounds),/PACKAGE_POSITION_BOUNDS_COMPONENT_REQUIRED/);
  assert.deepEqual(content,original);assert.deepEqual(bytes,result.bytes);
  const snapshot={available:true,source:{...source,baseId:content.compatibility.base,engineVersion:content.compatibility.engine},files:profileMap(city)};
  // Regardless of adapter requirements, a legacy warning remains visible.
  assert.equal(assessArchiveForSource(archive,snapshot).resources[0].configuration.status,'legacy-range-insufficient');
 }
});

test('structured bounds refuse nonfinite, unbounded, inverted, injected properties and missing source identity',()=>{
 assert.deepEqual(validatePositionBounds(bounds),bounds);
 for(const value of [NaN,Infinity,-Infinity,100001,-100001,'0',null])assert.throws(()=>validatePositionBounds({...bounds,minimum:[value,-20,-300]}),/PACKAGE_POSITION_BOUNDS_INVALID/);
 for(const changed of [{...bounds,maximum:bounds.minimum},{...bounds,entity_id:'overwrite'},{...bounds,minimum:[-1,0]},{...bounds,minimum:['Vector3(0,0,0)',0,0]}])assert.throws(()=>validatePositionBounds(changed),/PACKAGE_POSITION_BOUNDS_INVALID/);
 for(const identity of [{}, {...source,revision:-1},{...source,manifestHash:'unknown'},{...source,worldId:'foreign'}])assert.throws(()=>validatePositionBounds({...bounds,expectedSource:identity}),/PACKAGE_CONFIGURATION_SOURCE_REQUIRED/);
});

test('actual PI argument validator accepts recipe v3 and all structured source-library configuration routes',async()=>{
 const manifest=JSON.parse(await fs.readFile(path.join(repository,'plugins/craftmine-world/manifest.json'),'utf8'));
 const definition=manifest.contributes.agentTools.find(t=>t.name==='godot_source_library');
 const modulePath=path.join(repository,'vendor/pi-desktop/packages/agent-runtime/node_modules/@earendil-works/pi-ai/dist/utils/validation.js');
 const {validateToolArguments}=await import(pathToFileURL(modulePath).href);
 const tool={name:definition.name,description:definition.description,parameters:definition.schema};
 const validate=args=>validateToolArguments(tool,{id:'schema-test',name:tool.name,arguments:args});
 const ref={assetId:'cw.module.approved-pomeranian',version:3,contentHash:'d'.repeat(64)};
 for(const mode of ['install','propose','install-group','propose-group']){
  const item={ref,positionBounds:bounds},args=mode.endsWith('-group')?{mode,items:[item,item]}:{mode,...item};
  assert.deepEqual(validate(args),args);
  const bad=structuredClone(args);if(bad.items)bad.items[0].positionBounds.maximum=[1,2];else bad.positionBounds.maximum=[1,2];
  assert.throws(()=>validate(bad),/Validation failed/);
 }
 const compose={mode:'compose',request:{recipeId:'collect-unlock-flight',recipeVersion:3,choices:{scenery:'city-street',companion:true,weather:'keep',collectionCount:4}}};
 assert.deepEqual(validate(compose),compose);
 assert.throws(()=>validate({...compose,request:{...compose.request,recipeVersion:4}}),/Validation failed/);
});

test('renderer retains legacy warnings without disabling use, and explains required or stale configurations',async()=>{
 const {build}=createRequire(path.join(repository,'vendor/pi-desktop/packages/agent-runtime/package.json'))('esbuild');
 await fs.mkdir(path.join(repository,'test-results'),{recursive:true});
 const directory=await fs.mkdtemp(path.join(repository,'test-results/source-configuration-ui-')),output=path.join(directory,'state.mjs');
 await build({entryPoints:[path.join(repository,'vendor/pi-desktop/apps/desktop/src/components/craftmine/assets/direct-library-state.ts')],outfile:output,bundle:true,format:'esm',platform:'node'});
 const {parseDirectInspection,directErrorMessage}=await import(pathToFileURL(output).href);
 const legacy=parseDirectInspection({eligible:true,warning:'LEGACY_COMPANION_SAVE_BOUNDS',compatibility:'unchecked',positionSupported:true});
 assert.equal(legacy.eligible,true);assert.match(directErrorMessage(legacy.warning,false),/−80 to 80/);assert.match(directErrorMessage(legacy.warning,true),/保留原身份和存档/);
 const configurable=parseDirectInspection({eligible:false,reason:'DIRECT_LIBRARY_WORLD_CONFIGURATION_REQUIRED',compatibility:'unchecked',positionSupported:true});
 assert.equal(configurable.eligible,false);assert.match(directErrorMessage(configurable.reason,false),/inspect the world source/);
 assert.match(directErrorMessage('PACKAGE_CONFIGURATION_SOURCE_CHANGED',false),/current revision/);
 assert.match(directErrorMessage('PET_STATE_POSITION_INVALID',false),/did not finish/);
});
