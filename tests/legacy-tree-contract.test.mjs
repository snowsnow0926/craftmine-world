import test from 'node:test';import assert from 'node:assert/strict';
import{requireLegacyTree,requireSameLegacySave,legacyProgressDifferences,LEGACY_TREE_REQUEST,LEGACY_TREE_BASE}from'./helpers/legacy-tree-contract.mjs';
const before={id:'world',runtimeKind:'legacy',world:{build:{id:'old',scene:{objects:[]}}}};
const record={id:'world',runtimeKind:'legacy',world:{build:{id:'new',scene:{objects:[{id:'oak',parts:[{size:{x:1,y:3,z:1}}]}]}}}};
const observation={objects:[{id:'oak',visible:true,mesh:true}]};
test('original request and delivered web base remain exact',()=>{assert.equal(LEGACY_TREE_REQUEST,'生成一个树');assert.equal(LEGACY_TREE_BASE,'craftmine-web/5');});
test('source or logical object presence alone cannot prove a rendered addition',()=>{
  assert.deepEqual(requireLegacyTree({before,record,observation}).drawableObjectIds,['oak']);
  for(const objects of [[],[{id:'oak',visible:true,mesh:false}],[{id:'oak',visible:false,mesh:true}]])assert.throws(()=>requireLegacyTree({before,record,observation:{objects}}),/ACTUAL_DRAWABLE/);
  assert.throws(()=>requireLegacyTree({before,record:{...record,runtimeKind:'godot'},observation}),/LEGACY_WORLD/);
  assert.throws(()=>requireLegacyTree({before,record:{...record,id:'foreign'},observation}),/ORIGINAL_WORLD/);
});
test('cold reopen requires complete saved progress and exact source build',()=>{
  const saved={record:{...record,world:{...record.world,snapshot:{player:{x:1,y:6,z:0},behaviors:{time:0}}}}};assert.equal(requireSameLegacySave(saved,structuredClone(saved)),true);
  const changed=structuredClone(saved);changed.record.world.snapshot.player.x=2;assert.throws(()=>requireSameLegacySave(saved,changed),/COLD_PERSISTED_PROGRESS_CHANGED/);
  assert.deepEqual(legacyProgressDifferences({player:{x:1},behaviors:{time:.1}},{player:{x:1},behaviors:{time:.3}}),[{path:'behaviors.time',before:.1,after:.3}]);
});
