import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {buildBuiltinSourceLibrary} from '../desktop/build-builtin-source-library.mjs';
import {buildApprovedPomeranianPackage} from '../desktop/build-approved-pomeranian-package.mjs';
import {buildRainControlPackage} from '../desktop/build-rain-control-package.mjs';
import {componentBridgeProfiles,PLACEMENT_PREVIEW_BRIDGE_HASHES,RELEASED_COMPONENT_ENGINE_BRIDGE_SHA256} from '../desktop/released-component-bridge.mjs';
import {unpackStaticPackage} from '../plugins/craftmine-world/package-zip.mjs';
const repository=path.resolve(import.meta.dirname,'..');
const baseline=JSON.parse(fs.readFileSync(path.join(repository,'tests/fixtures/builtin-source-library-preview22-687a851d.json')));
const {selectedAssets,compositionCatalog}=createRequire(import.meta.url)('../plugins/craftmine-world/world-composition.cjs');
for(const [name,build]of [['Pom',buildApprovedPomeranianPackage],['rain',buildRainControlPackage]])test(name+' v1 remains released bytes; v2 adds exact preview cohorts without changing behavior, model, state or rights',()=>{
  const old=build({repository,version:1}),next=build({repository,version:2}),pinned=baseline.entries.find(row=>row.assetId===old.entry.assetId);
  assert.equal(old.entry.sha256,pinned.sha256);assert.equal(old.entry.rootContentHash,pinned.rootContentHash);
  assert.equal(next.entry.assetId,old.entry.assetId);assert.equal(next.entry.version,2);assert.notEqual(next.file,old.file);assert.notEqual(next.entry.sha256,old.entry.sha256);
  const a=unpackStaticPackage(old.bytes).resources[0].manifest.content,b=unpackStaticPackage(next.bytes).resources[0].manifest.content;
  assert.deepEqual(b.files,a.files);assert.deepEqual(b.state,a.state);assert.deepEqual(b.licenses,a.licenses);assert.deepEqual(b.entry.capabilities,a.entry.capabilities);assert.deepEqual(b.entry.aliases,a.entry.aliases);
  assert.deepEqual(b.entry.sourceRequirementProfiles.slice(0,3),a.entry.sourceRequirementProfiles);
  assert.deepEqual(b.entry.sourceRequirementProfiles.slice(3).map(row=>row.requirements.find(file=>file.path==='craftmine_shared/runtime_bridge.gd').sha256),PLACEMENT_PREVIEW_BRIDGE_HASHES);
  assert.equal(a.entry.sourceRequirementProfiles[2].requirements.find(file=>file.path==='craftmine_shared/runtime_bridge.gd').sha256,RELEASED_COMPONENT_ENGINE_BRIDGE_SHA256);
  assert.throws(()=>build({repository,version:3}),/VERSION_UNSUPPORTED/);
});
test('new built-in library retains every preview22 entry byte-for-byte and adds only two versioned rows',()=>{
  fs.mkdirSync(path.join(repository,'test-results'),{recursive:true});const output=fs.mkdtempSync(path.join(repository,'test-results/preview-version-catalog-'));
  const current=buildBuiltinSourceLibrary({output});assert.equal(current.entries.length,30);
  for(const row of baseline.entries){const found=current.entries.find(item=>item.assetId===row.assetId&&item.version===row.version);assert(found);for(const key of ['file','sha256','rootContentHash'])assert.equal(found[key],row[key]);}
  assert.deepEqual(current.entries.filter(row=>!baseline.entries.some(old=>old.assetId===row.assetId&&old.version===row.version)).map(row=>[row.assetId,row.version]).sort(),[['cw.module.approved-pomeranian',2],['cw.module.rain-control',2]]);
});
test('recipe versions choose exact component versions while old recipe references retain old bytes',()=>{
  assert(compositionCatalog().recipes.every(row=>row.version===2));assert.deepEqual(compositionCatalog().supportedRecipeVersions,[1,2]);
  const base={recipeId:'collect-unlock-flight',choices:{scenery:'city-street',companion:true,weather:'rain',collectionCount:3}};
  const old=selectedAssets({...base,recipeVersion:1}),next=selectedAssets({...base,recipeVersion:2});
  for(const row of old)assert.equal(row.version,1);
  for(const row of next)assert.equal(row.version,['cw.module.approved-pomeranian','cw.module.rain-control'].includes(row.assetId)?2:1);
  for(const row of old){const original=baseline.entries.find(entry=>entry.assetId===row.assetId&&entry.version===1);assert.equal(row.archiveSha256,original.sha256);}
});
test('preview cohort construction refuses unknown package versions and missing released ownership cohort',()=>{
  assert.throws(()=>componentBridgeProfiles([],2),/PROFILE_REQUIRED/);assert.throws(()=>componentBridgeProfiles([],3),/VERSION_UNSUPPORTED/);
});
