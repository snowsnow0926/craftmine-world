import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {materializeBase} from '../../../../../desktop/godot/shared/materialize.mjs';
import {loadSceneObserverPins,currentSceneObserverProfile,hasVersionedSceneObserverFiles} from '../electron/main/creation-observer-pins.ts';
const root=fileURLToPath(new URL('../../../../../',import.meta.url));
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'engine-observer-compatibility-'));
test.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
const pins=loadSceneObserverPins(path.join(root,'desktop/godot'));
for(const controllerProfile of ['legacy','creation-fixed-controller/1','creation-player-collision/1'])test('complete monitor extension preserves '+controllerProfile+' observer identity',()=>{
  const manifest=materializeBase({baseId:'creation-sandbox',worldId:'engine-compatibility',out:path.join(temporary,controllerProfile.replaceAll('/','-')),
    controllerProfile,enginePerformanceProfile:'engine-monitor/1'});
  assert.equal(currentSceneObserverProfile(manifest.files,pins),controllerProfile);
  assert.equal(hasVersionedSceneObserverFiles(manifest.files),true);
  for(const file of ['craftmine_shared/runtime_bridge.gd','craftmine_shared/runtime_bridge_base.gd','craftmine_shared/engine_performance.gd']){
    assert.equal(currentSceneObserverProfile(manifest.files.filter(entry=>entry.path!==file),pins),null);
    assert.equal(currentSceneObserverProfile(manifest.files.map(entry=>entry.path===file?{...entry,sha256:'f'.repeat(64)}:entry),pins),null);
    assert.equal(currentSceneObserverProfile([...manifest.files,manifest.files.find(entry=>entry.path===file)],pins),null);
  }
  const oldPins={...pins};delete oldPins['@engineBridge'];
  assert.equal(currentSceneObserverProfile(manifest.files,oldPins),null);
});
