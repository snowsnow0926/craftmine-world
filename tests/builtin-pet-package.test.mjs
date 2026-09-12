import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {buildBuiltinPetPackage,PET_ASSET_ID,PET_VERSION,PET_SOURCE_REQUIREMENTS} from '../desktop/build-builtin-pet-package.mjs';
import {buildBuiltinSourceLibrary} from '../desktop/build-builtin-source-library.mjs';
import {unpackStaticPackage} from '../plugins/craftmine-world/package-zip.mjs';
import {planSceneInsertion,applySceneInsertion,parseScene} from '../desktop/godot/shared/scene_materializer.mjs';
const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const results=path.join(repository,'test-results');fs.mkdirSync(results,{recursive:true});
const tmp=()=>fs.mkdtempSync(path.join(results,'pet-package-'));
function resource(){const result=buildBuiltinPetPackage({repository});return {result,resource:unpackStaticPackage(result.bytes).resources[0]};}

test('playable module binds one behavior root and both final visual byte streams',()=>{
 const {result,resource:r}=resource(),c=r.manifest.content;
 assert.equal(PET_VERSION,2);assert.equal(result.entry.version,2);assert.equal(c.version,2);
 assert.equal(result.entry.kind,'module');assert.equal(c.state.kind,'persistent-component');assert.equal(c.state.format,'craftmine.pet-companion-state/1');
 assert.deepEqual(c.entry.entities,['pet']);assert.equal(c.entry.sceneInstall.identityField,'entity_id');
 const scene=r.files.get(c.entry.sceneInstall.sceneFile).toString();
 assert.match(scene,/type="CharacterBody3D"/);assert.match(scene,/appearance_key = "dog"/);
 for(const ref of scene.matchAll(/path="res:\/\/addons\/cw\.module\.pet-companion\/([^"]+)"/g))assert.ok(r.files.has(ref[1]),'self-contained reference '+ref[1]);
 for(const appearance of c.entry.appearances){
  assert.equal(sha(r.files.get(appearance.scene)),appearance.sha256);
  assert.deepEqual(r.files.get(appearance.scene),fs.readFileSync(path.join(repository,'desktop/godot/components/canine-visuals',appearance.key+'.glb')));
  assert.ok(r.files.has(appearance.scene+'.import'));
 }
 assert.ok(r.files.has('LICENSE.txt'));assert.ok(r.files.has('scripts/pet_companion.gd.uid'));
 assert.deepEqual(r.files.get('scripts/pet_companion.gd'),fs.readFileSync(path.join(repository,'desktop/godot/components/pet-companion/scripts/pet_companion.gd')));
});

test('package requirements bind the real project adapter alias and frozen source bytes',()=>{
 const {resource:r}=resource();
 assert.deepEqual(r.manifest.content.entry.sourceRequirements,PET_SOURCE_REQUIREMENTS.map(([name,source])=>({path:name,sha256:sha(fs.readFileSync(path.join(repository,source)))})));
 assert.ok(r.manifest.content.entry.sourceRequirements.some(item=>item.path==='craftmine_shared/base_adapter.gd'));
 const empty=tmp();assert.throws(()=>buildBuiltinPetPackage({repository:empty,petRoot:path.join(repository,'desktop/godot/components/pet-companion'),visualRoot:path.join(repository,'desktop/godot/components/canine-visuals')}),/ENOENT/);
});

test('corrupt visual and unsupported import configuration fail before archive production',()=>{
 for(const target of ['dog.glb','dog.glb.import']){
  const visualRoot=tmp();fs.cpSync(path.join(repository,'desktop/godot/components/canine-visuals'),visualRoot,{recursive:true});
  fs.appendFileSync(path.join(visualRoot,target),'changed');
  assert.throws(()=>buildBuiltinPetPackage({repository,visualRoot}),target.endsWith('.glb')?/PET_VISUAL_HASH_MISMATCH/:/PET_VISUAL_IMPORT_UNSUPPORTED/);
 }
});

test('scene materialization preserves two independent identities and reuses the same appearance-bearing source',()=>{
 const {resource:r}=resource();let text='[gd_scene format=3]\n[node name="World" type="Node3D"]\n';
 const spec={...r.manifest.content.entry.sceneInstall,sceneFile:'addons/'+PET_ASSET_ID+'/'+r.manifest.content.entry.sceneInstall.sceneFile,parent:'.'};
 for(const entityId of ['instance-first-pet','instance-second-pet']){
  const plan=planSceneInsertion({sceneText:text,scenePath:'world.tscn',spec,entityId});assert.ok(plan.ok);text=applySceneInsertion(text,plan.edit);
 }
 const roots=parseScene(text).nodes.filter(node=>node.properties.entity_id);
 assert.deepEqual(roots.map(node=>node.properties.entity_id).sort(),['"instance-first-pet"','"instance-second-pet"']);
 const references=[...text.matchAll(/path="(res:\/\/addons\/cw\.module\.pet-companion\/scenes\/pet_companion.tscn)"/g)].map(match=>match[1]);
 assert.equal(references.length,2);assert.equal(new Set(references).size,1);
});

test('whole library is deterministic and appends one playable module without reclassifying old resources',()=>{
 const output=tmp(),other=tmp(),a=buildBuiltinSourceLibrary({output}),b=buildBuiltinSourceLibrary({output:other});
 assert.equal(a.entries.length,19);assert.deepEqual(a,b);assert.equal(a.entries.at(-1).assetId,PET_ASSET_ID);
 for(const entry of a.entries)assert.deepEqual(fs.readFileSync(path.join(output,entry.file)),fs.readFileSync(path.join(other,entry.file)));
 assert.equal(a.entries.filter(entry=>entry.kind==='object').length,16);
 assert.equal(a.entries.filter(entry=>entry.kind==='scene').length,1);
 const baseline=JSON.parse(fs.readFileSync(path.join(repository,'tests/fixtures/builtin-source-library-v1-sha256.json')));
 assert.equal(Object.keys(baseline).length,18);
 for(const [file,hash]of Object.entries(baseline))assert.equal(sha(fs.readFileSync(path.join(output,file))),hash,'Previously shipped v1 package bytes changed: '+file);
});
