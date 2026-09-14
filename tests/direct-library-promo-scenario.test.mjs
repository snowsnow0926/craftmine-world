import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {parseDirectLibraryArgs,promoPlacementFromGround,readPromoNativePlan,preservePriorComponents,PROMO_NATIVE_STAGES} from './helpers/direct-library-promo-scenario.mjs';
import {buildPromoCombatPackages} from '../desktop/build-promo-combat-packages.mjs';
import {buildPromoNaturePackages} from '../desktop/build-promo-nature-packages.mjs';
const repository=path.resolve(import.meta.dirname,'..'),base=path.join(repository,'desktop/godot/bases/creation-sandbox');
const worldSource=fs.readFileSync(path.join(base,'scripts/creation_world.gd'),'utf8'),scene=fs.readFileSync(path.join(base,'scenes/creation.tscn'),'utf8');
test('explicit sealed scenario accepts actual resource root and retains positional legacy launch',()=>{
  const packaged=path.resolve('test-results/sealed'),resources=path.join(packaged,'resources');
  const value=parseDirectLibraryArgs(['--application-root',repository,'--packaged-root',packaged,'--scenario','promo-six-stage']);
  assert.equal(value.resources,resources);assert.equal(value.scenario,'promo-six-stage');
  assert.equal(parseDirectLibraryArgs([repository,resources,'--packaged-root',packaged]).scenario,'legacy');
  assert.throws(()=>parseDirectLibraryArgs(['--application-root',repository,'--resources',resources,'--scenario','promo-six-stage']),/PROMO_SEALED_RESOURCES_REQUIRED/);
  assert.throws(()=>parseDirectLibraryArgs(['--application-root',repository,'--packaged-root',packaged,'--resources',repository,'--scenario','promo-six-stage']),/PROMO_SEALED_RESOURCES_REQUIRED/);
  assert.throws(()=>parseDirectLibraryArgs(['--application-root',repository,'--packaged-root',packaged,'--scenario','unknown']),/DIRECT_SCENARIO_INVALID/);
});
test('placement reads shipped floor/camera and refuses changed dimensions instead of guessing',()=>{
  const plan=promoPlacementFromGround(worldSource,scene);assert.deepEqual(plan.ground,{minimum:[-32,0,-32],maximum:[32,0,32]});assert.equal(plan.cameraHeight,.65);
  assert.deepEqual(plan.stages.map(x=>x.assetId),PROMO_NATIVE_STAGES);
  const monster=plan.stages[2].position,hunt=plan.stages[4].position,tree=plan.stages[0].position;
  assert(monster.z-37>=-32&&monster.z+10<=32);assert(hunt.z-14>=-32&&hunt.z+14<=32);assert(tree.x+1.32<hunt.x-11);
  assert.throws(()=>promoPlacementFromGround(worldSource.replaceAll('Vector3(64, 0.4, 64)','Vector3(60, 0.4, 64)'),scene),/PROMO_GROUND_CHANGED/);
  assert.throws(()=>promoPlacementFromGround(worldSource,scene.replace('Vector3(0, 0.65, 0)','Vector3(0, 0.75, 0)')),/PROMO_CAMERA_HEIGHT/);
});
test('six real package archives and root hashes are verified without running application or model',()=>{
  fs.mkdirSync(path.join(repository,'test-results'),{recursive:true});const out=fs.mkdtempSync(path.join(repository,'test-results/promo-native-plan-'));
  const resources=path.join(out,'resources'),baseOut=path.join(resources,'godot/bases/creation-sandbox'),library=path.join(resources,'plugins/craftmine.world/builtin-source-library');
  fs.mkdirSync(path.join(baseOut,'scripts'),{recursive:true});fs.mkdirSync(path.join(baseOut,'scenes'),{recursive:true});fs.mkdirSync(library,{recursive:true});
  fs.writeFileSync(path.join(baseOut,'scripts/creation_world.gd'),worldSource);fs.writeFileSync(path.join(baseOut,'scenes/creation.tscn'),scene);
  const built=[...buildPromoNaturePackages({repository}),...buildPromoCombatPackages({repository})];for(const item of built)fs.writeFileSync(path.join(library,item.file),item.bytes);
  fs.writeFileSync(path.join(library,'catalog.json'),JSON.stringify({format:'craftmine.builtin-source-library/1',entries:built.map(x=>x.entry)}));
  const plan=readPromoNativePlan(resources);assert.equal(plan.stages.length,6);assert(plan.stages.every(x=>/^[a-f0-9]{64}$/.test(x.package.archiveSha256)&&x.package.modelBytes>0));
  fs.appendFileSync(path.join(library,built[0].file),'changed');assert.throws(()=>readPromoNativePlan(resources));
});
test('adoption proof accepts only added IDs and preserves player and existing state exactly',()=>{
  const before={state:{body:{format:'craftmine.creation-progress/1',player:{position:[0,.9,6]},components:{old:{health:44}},inventory:{},openedChests:[],doors:{},rules:{}}}};
  const after=structuredClone(before);after.state.body.components.next={health:60};assert.deepEqual(preservePriorComponents(before,after).addedComponentIds,['next']);
  after.state.body.components.old.health=100;assert.throws(()=>preservePriorComponents(before,after),/PRIOR_COMPONENT_CHANGED/);
  after.state.body.components.old.health=44;after.state.body.player.position[0]=5;assert.throws(()=>preservePriorComponents(before,after),/PLAYER_CHANGED_DURING_INSTALL/);
});
