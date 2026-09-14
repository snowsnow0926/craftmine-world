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
