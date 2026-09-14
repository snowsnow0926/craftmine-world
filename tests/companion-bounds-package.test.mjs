import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {buildApprovedPomeranianPackage} from '../desktop/build-approved-pomeranian-package.mjs';
import {buildBuiltinPetPackage} from '../desktop/build-builtin-pet-package.mjs';
import {unpackStaticPackage} from '../plugins/craftmine-world/package-zip.mjs';
import {planCompanionBoundsUpgrade} from '../desktop/plan-companion-bounds-upgrade.mjs';
const repository=path.resolve(import.meta.dirname,'..'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const bounds={minimum:[-240,-20,-300],maximum:[240,160,80]};

test('released Pom v1/v2 and generic pet v2 archives stay byte-for-byte pinned',()=>{
  assert.equal(buildApprovedPomeranianPackage({repository,version:1}).entry.sha256,'b3070a8780f26a44e2602fe5b75e4b1ffe8e3cff9e4305ea52ba6b333ae4c4f8');
  assert.equal(buildApprovedPomeranianPackage({repository,version:2}).entry.sha256,'2c9c38faca756f6be9cdd787f8565243571ca736308706405710a5aa7225068a');
  const pin=JSON.parse(fs.readFileSync(path.join(repository,'tests/fixtures/player-workflow-builtin22-20260913.json'))).entries.find(e=>e.assetId==='cw.module.pet-companion');
  assert.equal(buildBuiltinPetPackage({repository,version:2}).entry.sha256,pin.sha256);
  assert.equal(buildApprovedPomeranianPackage({repository,version:3}).entry.sha256,'186f0fa94cc396d7c625a45cdfdb6352d71891fab104ba54f961b2a16c171718');
  assert.equal(buildBuiltinPetPackage({repository,version:3}).entry.sha256,'19e1d424316bc3621e9b9200f45ddceefec42813e2d24c2aebeb1b69ddffd1c3');
});

test('new source packages preserve visual bytes and state schema while exposing explicit bounds requirements',()=>{
  for(const builder of [buildApprovedPomeranianPackage,buildBuiltinPetPackage]){
    const old=unpackStaticPackage(builder({repository,version:2}).bytes).resources[0];
    const next=unpackStaticPackage(builder({repository,version:3}).bytes).resources[0];
    assert.deepEqual(next.manifest.content.state,old.manifest.content.state);
    assert.deepEqual(next.manifest.content.entry.editableSettings,old.manifest.content.entry.editableSettings);
    const validation=next.manifest.content.entry.positionValidation;
    assert.equal(validation.requiresWorldConfiguration,true);assert.equal(validation.changesSavedPosition,false);assert.equal(validation.verticalContactToleranceMm,2);
    assert.deepEqual(validation.compatibilityDefaults,{minimum:[-80,-80,-80],maximum:[80,80,80]});
    assert.equal(next.manifest.content.entry.sourceRequirementProfiles.length,5);
    for(const [name,bytes]of old.files)if(!name.endsWith('.gd'))assert.deepEqual(next.files.get(name),bytes,name);
  }
});

test('source-local upgrade changes only exact released scripts and pins configured bounds without progress edits',()=>{
  const files=[{path:'addons/cw.module.approved-pomeranian/companion.gd',text:fs.readFileSync(path.join(repository,'desktop/godot/components/approved-pomeranian/companion.gd'),'utf8')}];
  const before=structuredClone(files),plan=planCompanionBoundsUpgrade({repository,files,bounds});
  assert.deepEqual(files,before);assert.equal(plan.progressMutation,false);assert.equal(plan.operations.length,1);
  assert.equal(plan.operations[0].expectedHash,sha(files[0].text));assert.match(plan.operations[0].text,/saved_position_min := Vector3\(-240, -20, -300\)/);
  assert.match(plan.operations[0].text,/saved_position_max := Vector3\(240, 160, 80\)/);assert.match(plan.operations[0].text,/data\.yaw, -PI, PI/);
  assert.match(plan.operations[0].text,/data\.interactionCount, 0, 999999/);
  assert.throws(()=>planCompanionBoundsUpgrade({repository,files:[{...files[0],text:files[0].text+'\n# authored override'}],bounds}),/SCRIPT_NOT_RELEASED/);
  assert.throws(()=>planCompanionBoundsUpgrade({repository,files,bounds:{...bounds,minimum:[-Infinity,0,0]}}),/BOUNDS_REQUIRED/);
});

test('documented stock bounds profiles are pinned to actual receiving source and selector bytes',()=>{
  const {profiles}=JSON.parse(fs.readFileSync(path.join(repository,'plugins/craftmine-world/companion-position-profiles.json')));
  for(const profile of profiles){
    assert.equal(sha(fs.readFileSync(path.join(repository,profile.source))),profile.sha256);
    const base=profile.id==='stock-sandbox'?'desktop/godot/bases/creation-sandbox':'desktop/godot/shared/promo-templates/promo-city/source';
    for(const selector of profile.selectors)assert.equal(sha(fs.readFileSync(path.join(repository,base,selector.path))),selector.sha256);
    for(const script of profile.rootBinding.scripts)assert.equal(sha(fs.readFileSync(path.join(repository,base,script.path))),script.sha256);
  }
  assert.deepEqual(profiles.find(p=>p.id==='orgrimmar-city').minimum,bounds.minimum);
});
