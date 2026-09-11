import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {materializeBase} from '../desktop/godot/shared/materialize.mjs';
import {loadSceneObserverPins,hasCurrentSceneObserver} from '../vendor/pi-desktop/apps/desktop/electron/main/creation-observer-pins.ts';
const root=path.resolve(import.meta.dirname,'..');
test('materialized new and retained legacy cohorts have independent complete observer authority',t=>{
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'creation-cohort-'));t.after(()=>fs.rmSync(out,{recursive:true,force:true}));
 const pins=loadSceneObserverPins(path.join(root,'desktop/godot'));
 const modern=materializeBase({baseId:'creation-sandbox',worldId:'modern-world',out:path.join(out,'modern')}).files;
 const legacy=materializeBase({baseId:'creation-sandbox',worldId:'legacy-world',out:path.join(out,'legacy'),controllerProfile:'legacy'}).files;
 assert.equal(hasCurrentSceneObserver(modern,pins),true);assert.equal(hasCurrentSceneObserver(legacy,pins),true);
 for(const name of ['craftmine_shared/base_adapter.gd','craftmine_shared/base_adapter_legacy.gd','craftmine_shared/controller_evidence.gd','craftmine_shared/scene_mesh_picker.gd','craftmine_shared/scene_mesh_picker_v2.gd']){
  assert.equal(hasCurrentSceneObserver(modern.filter(f=>f.path!==name),pins),false);
  assert.equal(hasCurrentSceneObserver(modern.map(f=>f.path===name?{...f,sha256:'f'.repeat(64)}:f),pins),false);
 }
 const extra=modern.filter(f=>['craftmine_shared/base_adapter_legacy.gd','craftmine_shared/controller_evidence.gd','craftmine_shared/scene_mesh_picker_v2.gd'].includes(f.path));
 assert.equal(hasCurrentSceneObserver([...legacy,...extra],pins),false);
 assert.equal(fs.readFileSync(path.join(out,'legacy/craftmine_shared/base_adapter.gd'),'utf8'),fs.readFileSync(path.join(root,'desktop/godot/shared/adapters/creation-sandbox.gd'),'utf8'));
 assert.equal(fs.readFileSync(path.join(out,'modern/craftmine_shared/base_adapter_legacy.gd'),'utf8'),fs.readFileSync(path.join(root,'desktop/godot/shared/adapters/creation-sandbox.gd'),'utf8'));
});
