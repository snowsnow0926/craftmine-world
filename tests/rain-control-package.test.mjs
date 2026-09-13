import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildRainControlPackage,RAIN_CONTROL_ID} from '../desktop/build-rain-control-package.mjs';
import {unpackStaticPackage} from '../plugins/craftmine-world/package-zip.mjs';
import {planSceneInsertion,applySceneInsertion,parseScene} from '../desktop/godot/shared/scene_materializer.mjs';
import {buildBuiltinSourceLibrary} from '../desktop/build-builtin-source-library.mjs';
const repository=path.resolve(import.meta.dirname,'..'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
fs.mkdirSync(path.join(repository,'test-results'),{recursive:true});
test('rain archive is deterministic, bounded and declares actual behavior and exclusive ownership',()=>{
 const built=buildRainControlPackage({repository});assert.deepEqual(built.bytes,buildRainControlPackage({repository}).bytes);
 const r=unpackStaticPackage(built.bytes).resources[0],c=r.manifest.content;
 assert.equal(c.assetId,RAIN_CONTROL_ID);assert.equal(c.version,1);assert.equal(c.state.format,'craftmine.rain-control-state/1');
 assert(c.files.reduce((sum,f)=>sum+f.bytes,0)<4*1024*1024);assert(built.bytes.length<5*1024*1024);
 assert.equal(c.entry.integration.replacesPlayer,false);assert.equal(c.entry.integration.replacesCamera,false);assert.equal(c.entry.integration.replacesEnvironment,false);
 assert.equal(c.entry.controls.changesInputMap,false);assert.deepEqual([c.entry.controls.advance,c.entry.controls.normal,c.entry.controls.automatic],['U','I','O']);
 assert.equal(c.entry.exclusiveCapability.conflict,'reject-check-and-save');assert.equal(c.entry.sourceRequirementProfiles.length,3);
 assert(c.entry.capabilities.includes('suspend-rain-while-player-walks'));
 assert.equal(sha(r.files.get('rain_water.gdshader')),c.entry.lineage.sourceFiles.find(f=>f.path==='shaders/rain_water.gdshader').sha256);
 assert(![...r.files.keys()].some(name=>name.includes('rain_world')||name.includes('rain_web_world')||name.endsWith('.glb')));
 assert(!r.files.get('rain_control.gd').toString().includes('_run_skill_probe'));
});
test('ordinary scene installer adds a rain instance while preserving player/camera and world script',()=>{
 const r=unpackStaticPackage(buildRainControlPackage({repository}).bytes).resources[0];
 const source=fs.readFileSync(path.join(repository,'desktop/godot/bases/creation-sandbox/scenes/creation.tscn'),'utf8');
 const spec={...r.manifest.content.entry.sceneInstall,sceneFile:'addons/'+RAIN_CONTROL_ID+'/rain_control.tscn',parent:'.'};
 const plan=planSceneInsertion({sceneText:source,scenePath:'scenes/creation.tscn',spec,entityId:'rain-instance-one'});assert(plan.ok);
 const next=applySceneInsertion(source,plan.edit),before=parseScene(source),after=parseScene(next);
 for(const node of before.nodes)assert.deepEqual(after.nodes.find(n=>n.name===node.name&&n.parent===node.parent),node);
 assert.equal(after.nodes.filter(n=>n.properties.entity_id==='"rain-instance-one"').length,1);
 assert.match(next,/res:\/\/scripts\/creation_world.gd/);assert.match(next,/player_controller.gd/);
});
test('altered original shader or missing lineage source cannot retain the accepted provenance claim',()=>{
 for(const variant of ['shader','lineage']){
  const root=fs.mkdtempSync(path.join(repository,'test-results/rain-package-invalid-'));
  fs.cpSync(path.join(repository,'desktop/godot/components/rain-control'),root,{recursive:true});
  if(variant==='shader')fs.appendFileSync(path.join(root,'rain_water.gdshader'),'\n// changed');
  else {const file=path.join(root,'provenance.json'),value=JSON.parse(fs.readFileSync(file));value.sourceFiles.pop();fs.writeFileSync(file,JSON.stringify(value));}
  assert.throws(()=>buildRainControlPackage({repository,root}),variant==='shader'?/RAIN_ORIGINAL_SHADER_CHANGED/:/RAIN_PROVENANCE_SOURCES_INVALID/);
 }
});
test('new wrapper line endings do not silently change the first published package version',()=>{
 const root=fs.mkdtempSync(path.join(repository,'test-results/rain-package-eol-'));
 fs.cpSync(path.join(repository,'desktop/godot/components/rain-control'),root,{recursive:true});
 for(const name of ['rain_control.gd','rain_control.gd.uid','rain_water.gdshader','LICENSE.txt','provenance.json']){
  const file=path.join(root,name);fs.writeFileSync(file,fs.readFileSync(file,'utf8').replaceAll('\r\n','\n').replaceAll('\n','\r\n'));
 }
 assert.deepEqual(buildRainControlPackage({repository,root}).bytes,buildRainControlPackage({repository}).bytes);
});
test('rain is searchable as a playable module and does not replace any original catalog item',()=>{
 const output=fs.mkdtempSync(path.join(repository,'test-results/rain-catalog-'));
 const catalog=buildBuiltinSourceLibrary({output}),rain=catalog.entries.filter(e=>e.assetId===RAIN_CONTROL_ID);assert.equal(rain.length,1);
 assert.equal(rain[0].kind,'module');for(const tag of ['控雨','悬停','倒流','技能'])assert(rain[0].tags.includes(tag));
 const original=catalog.entries.filter(e=>!e.tags.includes('reusable-world-content'));assert.equal(original.length,22);
 const completePins=JSON.parse(fs.readFileSync(path.join(repository,'tests/fixtures/player-workflow-builtin22-20260913.json'))).entries;
 assert.deepEqual(original.map(e=>e.assetId).sort(),completePins.map(e=>e.assetId).sort());
 for(const pin of completePins){const entry=original.find(e=>e.assetId===pin.assetId);assert.equal(entry.version,pin.version);assert.equal(sha(fs.readFileSync(path.join(output,pin.file))),pin.sha256);}
 const pins=JSON.parse(fs.readFileSync(path.join(repository,'tests/fixtures/builtin-source-library-approved-20260913-sha256.json')));
 for(const [name,expected]of Object.entries(pins))assert.equal(sha(fs.readFileSync(path.join(output,name))),expected);
});
