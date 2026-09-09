import assert from 'node:assert/strict';
import test from 'node:test';
import {compileScene,INITIAL_SNAPSHOT} from '../app/scene.mjs';
import {prepareLegacyWorld} from '../plugins/craftmine-world/domain-adapter.mjs';

test('format-1 imports verify original order before upgrading the playable copy',async()=>{
  const scene={format:'craftmine.scene/1',title:'早期世界',night:false,objects:[{id:'stone',name:'石头',position:{x:3,y:6,z:0},parts:[{offset:{x:0,y:0,z:0},size:{x:1,y:1,z:1},material:'stone'}]}]};
  const build=compileScene(scene),project={format:'craftmine.project/1',current:'v-'+build.hash.slice(0,20),snapshot:INITIAL_SNAPSHOT};
  const world=await prepareLegacyWorld(project,async()=>build);
  assert.equal(world.build.scene.format,'craftmine.scene/2');
  assert.notEqual(world.build.id,project.current);
  assert.equal(world.build.hash,compileScene(JSON.parse(JSON.stringify(world.build.scene))).hash);
  assert.deepEqual(world.build.scene.objects[0].position,scene.objects[0].position);
  assert.equal(world.build.scene.objects[0].parts[0].material,'stone');
  assert.equal(world.build.scene.objects[0].parts[0].solid,true);
  assert.equal(build.scene.format,'craftmine.scene/1');
  const reordered={...build,scene:Object.fromEntries(Object.entries(scene).sort())};
  await assert.rejects(prepareLegacyWorld(project,async()=>reordered),/哈希不一致/);
});
