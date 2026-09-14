import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {buildPromoCombatPackages,PROMO_COMBAT_MODEL_PINS} from '../desktop/build-promo-combat-packages.mjs';
import {unpackStaticPackage} from '../plugins/craftmine-world/package-zip.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
test('promotional stages have truthful single-root declarations and original GLB bytes',()=>{
  for(const built of buildPromoCombatPackages()){
    const archive=unpackStaticPackage(built.bytes),resource=archive.resources[0],content=resource.manifest.content;
    const stage=content.assetId.replace('cw.module.promo-',''),pin=PROMO_COMBAT_MODEL_PINS[stage];
    assert.equal(content.entry.entities.length,1);
    assert(resource.files.has(content.entry.sceneInstall.sceneFile));
    assert.deepEqual(resource.files.get('model.glb'),fs.readFileSync('desktop/godot/shared/promo-templates/promo-mainline/source/assets/blender/'+pin.file));
    assert.equal(sha(resource.files.get('model.glb')),pin.sha256);
    for(const [name]of resource.files)if(name.endsWith('.gd'))assert(resource.files.has(name+'.uid'),name+' has UID');
    assert.equal(content.entry.lineage.sharedHelperSha256,sha(resource.files.get('core.gd')));
    assert.deepEqual(resource.files.get('ORIGINAL_ASSETS_LICENSE.txt'),fs.readFileSync('desktop/godot/shared/promo-templates/promo-mainline/source/licenses/ORIGINAL_ASSETS_LICENSE.txt'));
    assert.equal(content.licenses.modelLicenseStatus,'unverified');
    if(stage==='hunt')for(const word of ['大怪物','狩猎'])assert(built.entry.tags.includes(word));
    if(stage==='heavyblade')assert(built.entry.tags.includes('重剑'));
    assert(!resource.files.get('core.gd').toString().includes('.source_code'),'runtime does not require editor source access');
    if(stage==='monsters'){
      const source=[...resource.files].filter(([n])=>n.endsWith('.gd')||n.endsWith('.tscn')).map(([,b])=>b.toString()).join('\n');
      assert(!source.includes('preload("res://assets/blender/'));
      assert(!source.includes('_cast_pulse'));
      assert(!source.includes('Riftbeast'));
    }
  }
});
test('package output is deterministic and preserves every original model pin',()=>{
  assert.deepEqual(buildPromoCombatPackages().map(x=>x.bytes),buildPromoCombatPackages().map(x=>x.bytes));
  for(const pin of Object.values(PROMO_COMBAT_MODEL_PINS)){
    const bytes=fs.readFileSync('desktop/godot/shared/promo-templates/promo-mainline/source/assets/blender/'+pin.file);
    assert.equal(bytes.length,pin.bytes);assert.equal(sha(bytes),pin.sha256);
  }
});
test('four independent requested stages share a helper but never embed another visible stage',()=>{
  const packages=buildPromoCombatPackages();assert.equal(packages.length,4);
  const helperHashes=new Set();
  for(const built of packages){
    const resource=unpackStaticPackage(built.bytes).resources[0];helperHashes.add(sha(resource.files.get('core.gd')));
    assert.equal([...resource.files.keys()].filter(name=>name.endsWith('.glb')).length,1);
    assert.deepEqual(resource.manifest.content.dependencies,[]);
    const stage=built.entry.assetId.replace('cw.module.promo-','');
    if(stage==='hunt')assert(resource.manifest.content.entry.sourceRequirements.some(x=>x.path==='addons/cw.module.promo-heavyblade/blade.gd'));
    else assert(!resource.manifest.content.entry.sourceRequirements.some(x=>x.path.includes('promo-monsters')));
  }
  assert.equal(helperHashes.size,1,'all packages ship identical helper bytes');
});
