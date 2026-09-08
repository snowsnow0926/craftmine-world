import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectStore } from '../app/store.mjs';
import { compileScene,withAppearanceFormat,sceneDiff,validateObjectScope,INITIAL_SNAPSHOT,encodeAgentScene,decodeAgentScene } from '../app/scene.mjs';
import { defaultAppearance,appearanceMatrix,appearanceBounds,decodeWorldAssets } from '../app/asset-binding.mjs';
import { BehaviorState } from '../app/behavior-state.mjs';
import { captureCreation,creationGroups,materializeCreation } from '../app/creation.mjs';
import { behaviorScene,behaviorFrame } from './behavior-fixtures.mjs';
import { png } from './asset-fixtures.mjs';
const fixture=()=>new ProjectStore(fs.mkdtempSync(path.join(os.tmpdir(),'craftmine-asset-world-')));
function addAsset(store,color=[240,40,60,255],previous=null){const a=store.assets.prepare(store.data,{id:previous?.id||null,baseVersion:previous?.version||null,name:'门绘图',filename:'door.png',mime:'image/png',data:png(4,10,color).toString('base64')});store.change(d=>store.assets.register(d,a));return a;}
function sceneFor(a){const s=withAppearanceFormat({...behaviorScene(),format:'craftmine.scene/4'});s.objects[0].appearance=defaultAppearance(s.objects[0],a);return s;}
function apply(store,scene){store.importSave({format:'craftmine.save/1',scene,snapshot:INITIAL_SNAPSHOT});const tx=store.prepare(store.data.candidate.id,store.data.current,INITIAL_SNAPSHOT);store.commit(tx.id,INITIAL_SNAPSHOT);}

test('外观进入确定性构建与模型传输，升级不会把其他对象标为更改',()=>{
  const store=fixture(),a=addAsset(store),before=behaviorScene(),scene=sceneFor(a),build=store.build(scene);
  assert.equal(build.format,'craftmine.build/4');assert.equal(build.assets[0].hash,a.hash);assert.deepEqual(decodeAgentScene(encodeAgentScene(scene)),scene);assert.deepEqual(sceneDiff(before,scene).details.items.map(i=>[i.id,i.fields]),[['door-one',['appearance']]]);validateObjectScope(before,scene,'door-one');
  assert.deepEqual(build.primitives,compileScene(before).primitives);assert.deepEqual(build.behaviors,compileScene(before).behaviors);assert.notEqual(build.hash,compileScene(before).hash);
  const changed=structuredClone(scene);changed.objects[1].appearance=defaultAppearance(changed.objects[1],a);assert.throws(()=>validateObjectScope(before,changed,'door-one'),/范围/);
});
test('素材版本固定、缺失和哈希错误拒绝构建，缺失版本能从原包恢复',()=>{
  const store=fixture(),a=addAsset(store),scene=sceneFor(a),one=store.build(scene),newer=addAsset(store,[30,200,80,255],a);assert.equal(store.readBuild(one.id).assets[0].version,1);
  const other=sceneFor(newer);assert.notEqual(store.build(other).id,one.id);
  const bad=structuredClone(scene);bad.objects[0].appearance.asset.hash='0'.repeat(64);assert.throws(()=>store.build(bad),/不匹配/);
  const file=store.assets.file(a.id,a.version);fs.unlinkSync(file);assert.throws(()=>store.readBuild(one.id),/缺失/);store.change(d=>store.assets.register(d,a));assert.equal(store.readBuild(one.id).assets[0].hash,a.hash);
  assert.equal(store.data.current,new ProjectStore(store.root).data.current);assert.equal(store.data.candidate,null);
});
test('外观变换保持比例、旋转中心与声明边界，玩法偏移也检查外观边界',()=>{
  const store=fixture(),a=addAsset(store),s=sceneFor(a),o=s.objects[0];o.appearance.size={x:2,y:4,z:.2};o.appearance.offset={x:-1,y:0,z:0};o.appearance.rotationY=90;
  const m=appearanceMatrix(o,{min:[-1,-.5,0],max:[1,.5,0]});assert.ok(Math.abs(m[2]+1)<1e-9);assert.equal(m[13],8);assert.ok(Math.abs(m[12])<1e-9);assert.equal(m[14],7.1);
  const b=appearanceBounds(o);assert.ok(Math.abs(b.max.x-b.min.x-.2)<1e-8);assert.ok(Math.abs(b.max.z-b.min.z-2)<1e-8);
  const bad=structuredClone(s);bad.objects[0].appearance.size.x=24;bad.objects[0].appearance.rotationY=0;bad.objects[0].appearance.offset.x=23;assert.throws(()=>compileScene(bad),/外观超出/);
  o.appearance.size={x:24,y:4,z:.2};o.appearance.rotationY=0;o.appearance.offset.x=20;const build=compileScene(s),state=new BehaviorState(build);
  assert.throws(()=>state.apply(build.behaviors[0],{state:{open:true},commands:[{type:'object.patch',id:o.id,position:{x:4,y:6,z:7},visible:true,solid:false,color:null}]},behaviorFrame()),/外观超出/);assert.deepEqual(state.value.modules['sliding-door'].state,{open:false});
});
test('外观随着对象位移和显隐材质状态更新，碰撞定义与源码版本保留',()=>{
  const store=fixture(),a=addAsset(store),build=store.build(sceneFor(a)),state=new BehaviorState(build);const code=build.behaviors[0];state.apply(code,{state:{open:true},commands:[{type:'object.patch',id:'door-one',position:{x:1.2,y:6,z:7},visible:false,solid:false,color:'#ff8800'}]},behaviorFrame());
  const view=state.view.objects[0];assert.equal(view.visible,false);assert.equal(view.position.x,1.2);assert.equal(view.appearanceTint,'#ff8800');assert.deepEqual(view.appearance.asset,{id:a.id,version:a.version,hash:a.hash});assert.equal(state.view.primitives[0].solid,false);
  const b=addAsset(store,[10,60,220,255],a),next=new BehaviorState(store.build(sceneFor(b)),state.snapshot());assert.deepEqual(next.value.modules, state.value.modules);assert.equal(next.view.objects[0].appearance.asset.version,2);
});
test('对象和完整创作记忆保留固定外观，复用旧版本不随素材新版改变',()=>{
  const store=fixture(),a=addAsset(store),scene=sceneFor(a);apply(store,scene);const objectRef=store.data.moduleBindings.object['door-one'],creationRef=store.data.moduleBindings.creation['sliding-door'];
  const object=store.modules.read(store.data,objectRef.id,objectRef.version),creation=store.modules.read(store.data,creationRef.id,creationRef.version);assert.equal(object.format,'craftmine.module/3');assert.equal(creation.format,'craftmine.module/3');assert.ok(object.dependencies.includes('assets@1'));assert.ok(creation.dependencies.includes('assets@1'));assert.equal(creation.payload.objects[0].appearance.asset.hash,a.hash);
  const group=creationGroups(scene)[0],captured=captureCreation(group,scene),placed=materializeCreation(captured,{id:creation.id,version:1},{x:-8,y:6,z:0});assert.equal(placed.format,'craftmine.scene/4');assert.equal(placed.objects[0].appearance.asset.version,1);assert.equal(placed.behaviors[0].code,scene.behaviors[0].code);store.build(placed);
  const later=addAsset(store,[20,220,240,255],a);apply(store,sceneFor(later));assert.equal(store.data.moduleBindings.object['door-one'].id,objectRef.id);assert.equal(store.data.moduleBindings.object['door-one'].version,2);assert.equal(store.modules.read(store.data,creation.id,1).payload.objects[0].appearance.asset.version,1);
  const reused=store.modules.instantiate(store.data,sceneFor(later),object.id,1,INITIAL_SNAPSHOT.player);assert.equal(reused.objects.at(-1).appearance.asset.version,1);store.build(reused);
});
test('世界素材不能缺份、重复携带或超过累计纹理预算',()=>{
  const store=fixture(),a=addAsset(store),s=sceneFor(a);assert.throws(()=>decodeWorldAssets(s,[]),/不完整/);assert.throws(()=>decodeWorldAssets(s,[a,a]),/不完整/);
  const assets=[];for(let i=0;i<5;i++){const asset={...a,id:a.id.slice(0,-1)+i,data:png(2048,2048,[20,40,80,255]).toString('base64')};assets.push(asset);const o=structuredClone(s.objects[0]);o.id='image-'+i;o.appearance.asset.id=asset.id;s.objects.push(o);}s.objects=s.objects.slice(2);assert.throws(()=>decodeWorldAssets(s,assets),/纹理超过/);
});
test('带外观世界仍能安装旧对象和旧创作，并切回不含素材的历史创作版本',()=>{
  const store=fixture();apply(store,behaviorScene());const object=store.data.moduleBindings.object['door-one'],creation=store.data.moduleBindings.creation['sliding-door'],a=addAsset(store);apply(store,sceneFor(a));
  const restored=store.modules.changeCreation(store.data,sceneFor(a),'sliding-door',creation.version);store.build(restored);assert.equal(restored.format,'craftmine.scene/4');assert.equal(restored.objects.find(o=>o.id==='door-one').appearance,null);
  const oldObject=store.modules.instantiate(store.data,restored,object.id,object.version,INITIAL_SNAPSHOT.player);store.build(oldObject);assert.equal(oldObject.objects.at(-1).appearance,null);
  const oldCreation=store.modules.instantiate(store.data,restored,creation.id,creation.version,INITIAL_SNAPSHOT.player,{x:-8,y:6,z:0});store.build(oldCreation);assert.equal(oldCreation.objects.at(-1).appearance,null);
});
test('外观低于或大于碰撞范围时，记忆校验和新实例放置使用完整外观边界',()=>{
  const store=fixture(),a=addAsset(store),scene=sceneFor(a);scene.objects[0].position.y=7;scene.objects[0].appearance.offset.y=-1;scene.objects[0].appearance.size.y=3.5;scene.behaviors[0].params.y=7;apply(store,scene);
  const object=store.data.moduleBindings.object['door-one'],creation=store.data.moduleBindings.creation['sliding-door'],pack=store.modules.read(store.data,creation.id,creation.version);assert.equal(pack.payload.anchor.y,7);
  const placed=store.modules.instantiate(store.data,scene,object.id,object.version,INITIAL_SNAPSHOT.player);assert.equal(placed.objects.at(-1).position.y+placed.objects.at(-1).appearance.offset.y,6);store.build(placed);
});
