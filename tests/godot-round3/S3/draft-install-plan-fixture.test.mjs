// S3: the JavaScript draft installer consumes a plan the Rust core produced.
//
// tests/godot-round3/S3/vectors/install-plan-fixture.json is regenerated from
// the real `TaskJournal::package_plan_install`:
//
//   cargo test -p craftmine-core --lib \
//     library::installer::tests::print_install_plan_fixture -- --ignored --nocapture
//
// This is the cross-language half of the install chain: Rust plans, JavaScript
// turns that plan into the complete managed draft file set and applies it
// atomically. The product RPC (`package.planInstall`) is not registered yet;
// that registration belongs to S1 and is requested in
// docs/dispatch-reports/godot-round3/S3/REGISTRATION_S3.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  ASSET_LOCK_FILE,
  DRAFT_INSTANCES_FILE,
  applyDraftInstall,
  planDraftInstall,
} from '../../../desktop/godot/shared/draft_install.mjs';
import {assetLockHash, canonicalLockText, validateAssetLock} from '../../../plugins/craftmine-world/asset-lock.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const fixture=JSON.parse(fs.readFileSync(join(here,'vectors','install-plan-fixture.json'),'utf8'));

function project(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'s3-plan-'));
  fs.writeFileSync(path.join(dir,'project.godot'),'[application]\nconfig/name="fixture-world"\n');
  return dir;
}

function payload(){
  return fixture.payload.map(entry=>({
    contentHash:entry.contentHash,
    path:entry.path,
    bytes:Buffer.from(entry.text,'utf8'),
  }));
}

test('the fixture is a real Rust plan with the canonical lock',()=>{
  assert.equal(fixture.format,'craftmine.install-plan-fixture/1');
  assert.equal(fixture.plan.applied,false);
  assert.equal(fixture.plan.ok,true);
  assert.equal(fixture.plan.lock.format,'craftmine.assets-lock/1');
  const lock=validateAssetLock(fixture.plan.lock);
  assert.equal(lock.assets.length,2);
  assert.equal(assetLockHash(lock),fixture.plan.assetLockHash);
  assert.deepEqual(fixture.plan.order,['stone@1','recipe@1']);
  assert.equal(lock.assets.find(entry=>entry.asset.assetId==='recipe').dependencies.length,1);
});

test('the JavaScript draft installer accepts the Rust plan',()=>{
  const dir=project();
  const planned=planDraftInstall({plan:fixture.plan,payload:payload(),projectDir:dir});
  assert.equal(planned.ok,true,JSON.stringify(planned.conflicts));
  assert.equal(planned.assetLockHash,fixture.plan.assetLockHash);
  const paths=planned.files.map(file=>file.path).sort();
  assert.deepEqual(paths,[
    'addons/recipe/data/recipes.json',
    'addons/stone/payload/stone.bin',
    ASSET_LOCK_FILE,
    DRAFT_INSTANCES_FILE,
  ].sort());
  const receipt=applyDraftInstall({plan:fixture.plan,payload:payload(),projectDir:dir});
  assert.equal(receipt.ok,true,JSON.stringify(receipt.conflicts));
  assert.equal(receipt.applied,true);
  assert.equal(fs.readFileSync(path.join(dir,ASSET_LOCK_FILE),'utf8'),canonicalLockText(fixture.plan.lock));
  const instances=JSON.parse(fs.readFileSync(path.join(dir,DRAFT_INSTANCES_FILE),'utf8'));
  assert.deepEqual(instances.instances.map(instance=>instance.assetId),['stone','recipe']);
  assert.equal(instances.instances.find(instance=>instance.assetId==='recipe').entityMap.forge
    .startsWith('ins-'),true);
  // The two resources keep independent instances and progress.
  const ids=new Set(instances.instances.map(instance=>instance.instanceId));
  assert.equal(ids.size,2);
});
