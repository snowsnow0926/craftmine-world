import assert from 'node:assert/strict';
import test from 'node:test';
import * as geometry from '../desktop/godot/shared/creation_runtime.mjs';
const {projectCreationScene,creationScreenPoint,selectCreationTarget}=geometry;
const scene={format:'craftmine.creation-scene/1',revision:3,defaults:{timeOfDay:12},entities:[
 {id:'door-a',kind:'door',position:[4,0,4],rotationY:0,scale:[1,1,1],color:'#884422',parameters:{}},
 ...['blue','red','green'].map((id,index)=>({id,kind:'marker',position:[8+index*2,0,4],rotationY:0,scale:[1,1,1],color:'#884422',parameters:{}})),
],rules:[{id:'sequence-one',kind:'sequence-door',doorId:'door-a',sequence:['blue','red','green'],script:'scripts/creation/rules/sequence-one.gd',sha256:'a'.repeat(64)}]};
test('静态投影保留场景版本与身份，但不能生成主机快照或玩法状态',()=>{
 const projected=projectCreationScene(scene);
 assert.deepEqual(projectCreationScene(structuredClone(scene)),projected);
 assert.equal(projected.sceneRevision,3);assert.equal(projected.sourceRevision,undefined);
 assert.equal(projected.format,'craftmine.creation-projection/1');
 assert.equal(geometry.creationTargetSnapshot,undefined);assert.equal(geometry.advanceSequenceDoor,undefined);
 assert.deepEqual(projected.ruleDeclarations,scene.rules);
 assert.equal(projected.ruleDeclarations[0].progress,undefined);
});
test('包围盒按实体底部与缩放后的半高计算中心，旋转交换水平边界',()=>{
 const changed=structuredClone(scene);changed.entities[0].position=[4,2,4];changed.entities[0].scale=[2,3,1];changed.entities[0].rotationY=90;
 const box=projectCreationScene(changed).entities[0].bounds;
 assert.deepEqual(box.position,[4,5.9,4]);
 assert.ok(Math.abs(box.halfExtents[0]-.25)<1e-12);
 assert.ok(Math.abs(box.halfExtents[1]-3.9)<1e-12);
 assert.ok(Math.abs(box.halfExtents[2]-1.6)<1e-12);
});
test('平面选中仅从已验证文档推导，不声称是引擎射线',()=>{
 assert.deepEqual(creationScreenPoint(scene.entities[0]),[320,256]);
 assert.equal(selectCreationTarget(scene,[320,256])?.id,'door-a');
 assert.equal(selectCreationTarget(scene,[0,0]),null);
 const overlap=structuredClone(scene);overlap.entities[1].position=[4,0,4];
 assert.equal(selectCreationTarget(overlap,[320,256])?.id,'blue');
});
test('非法场景、非数坐标与投影参数在合同边界拒绝',()=>{
 for(const alter of [s=>s.entities[0].scale=[0,1,1],s=>s.rules[0].sequence=['blue','missing'],s=>s.entities.push({...s.entities[0]}),s=>delete s.defaults]){
  const invalid=structuredClone(scene);alter(invalid);assert.throws(()=>projectCreationScene(invalid),error=>error.errorCode==='CREATION_SCENE_INVALID');
 }
 assert.throws(()=>selectCreationTarget(scene,[NaN,0]),/CREATION_PROJECTION_POINT_INVALID/);
 assert.throws(()=>selectCreationTarget(scene,[0,0],{pixelsPerUnit:0}),/CREATION_PROJECTION_OPTIONS_INVALID/);
});
