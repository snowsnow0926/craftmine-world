import test from 'node:test';
import assert from 'node:assert/strict';
import { creationGroups,captureCreation,validateCreation,materializeCreation,placeCreation } from '../app/creation.mjs';
import { BehaviorBinding } from '../app/behavior-binding.mjs';
import { compileScene,encodeAgentScene,decodeAgentScene,canonicalJSON } from '../app/scene.mjs';
import { behaviorScene,behaviorFrame } from './behavior-fixtures.mjs';
import { GameplaySession } from '../app/gameplay.mjs';
import { BehaviorState } from '../app/behavior-state.mjs';

const source={id:'creation-library-test',version:1};
const fixture=()=>{const scene=behaviorScene(),group=creationGroups(scene)[0];return captureCreation(group,scene);};
test('创作模板保存原始源码、参数与显式对象映射，放到新位置不替换字符串',()=>{
  const payload=fixture();validateCreation(payload);const scene=materializeCreation(payload,source,{x:12,y:6,z:-10},'test-instance');compileScene(scene);
  assert.equal(scene.behaviors[0].code,behaviorScene().behaviors[0].code);assert.deepEqual(scene.behaviors[0].params,behaviorScene().behaviors[0].params);
  assert.notEqual(scene.behaviors[0].targets[0],payload.scripts[0].definition.targets[0]);assert.equal(scene.objects[0].position.x,12);
  assert.deepEqual(decodeAgentScene(encodeAgentScene(scene)),scene);
});
test('创建的副本再次捕获时内容相同，不因位置和新实例 ID 产生新版本',()=>{
  const payload=fixture(),scene=materializeCreation(payload,source,{x:12,y:6,z:-10},'test-instance'),captured=captureCreation(creationGroups(scene)[0],scene);
  assert.equal(canonicalJSON(captured),canonicalJSON(payload));
});
test('新版新增角色不会占用保留角色的身份，改变排序也保留身份',()=>{
  const payload=fixture(),scene=materializeCreation(payload,source,{x:12,y:6,z:-10},'test-instance'),existing=scene.behaviors[0].binding;
  const extra=structuredClone(payload.objects[0]);extra.key='extra-object';extra.position.x+=5;payload.objects.unshift(extra);
  payload.scripts[0].objects.push({local:'extra-object',object:'extra-object'});
  const generated=materializeCreation(payload,{...source,version:2},existing.origin,existing.instanceId,existing);compileScene(generated);
  assert.equal(generated.objects[1].id,scene.objects[0].id);assert.notEqual(generated.objects[0].id,scene.objects[0].id);
  assert.equal(generated.behaviors[0].id,scene.behaviors[0].id);
});
test('实例只转换现场和命令：原始对象 ID 与同名外部对象不会冲突',()=>{
  const scene=materializeCreation(fixture(),source,{x:12,y:6,z:-10},'test-instance'),definition=scene.behaviors[0],binding=new BehaviorBinding(definition),frame=behaviorFrame();
  frame.event.targetId=definition.targets[0];frame.player.position={x:12,y:6,z:-7};frame.objects.push({id:definition.targets[0],position:{x:12,y:6,z:-10},visible:true,solid:true,health:0});
  const local=binding.frame(frame);assert.deepEqual(local.player.position,{x:0,y:6,z:10});assert.equal(local.event.targetId,'door-one');assert.equal(local.objects.filter(o=>o.id==='door-one').length,1);
  const translated=binding.result({state:{open:true},commands:[{type:'object.patch',id:'door-one',position:{x:1.2,y:6,z:7},solid:false,visible:true,color:null}]},frame);
  assert.equal(translated.commands[0].id,definition.targets[0]);assert.deepEqual(translated.commands[0].position,{x:13.2,y:6,z:-10});
  assert.throws(()=>binding.result({state:{},commands:[{type:'object.patch',id:'outside-0',position:null,solid:false,visible:true,color:null}]},frame),/未授权/);
});
test('本地坐标可表达远处玩家，但转换后的命令仍受真实世界边界限制',()=>{
  const scene=materializeCreation(fixture(),source,{x:38,y:6,z:0},'test-instance'),binding=new BehaviorBinding(scene.behaviors[0]),frame=behaviorFrame();frame.event.targetId=scene.behaviors[0].targets[0];frame.player.position.x=-47;
  frame.objects=[{id:scene.behaviors[0].targets[0],position:scene.objects[0].position,visible:true,solid:true,health:0}];assert.equal(binding.frame(frame).player.position.x,-85);
  assert.throws(()=>binding.result({state:{},commands:[{type:'object.patch',id:'door-one',position:{x:5,y:6,z:7},solid:false,visible:true,color:null}]},frame));
});
test('声明的系统依赖与实例对象关系都要经过构建校验',()=>{
  const payload=fixture();payload.scripts[0].definition.requires=['health@1'];assert.throws(()=>validateCreation(payload),/依赖/);
  payload.systems=[{id:'life-system',name:'生命值',type:'health',config:{maxHealth:100,fallDamage:5,regenPerSecond:0},source:null}];validateCreation(payload);
  const scene=materializeCreation(payload,source,{x:10,y:6,z:0});scene.behaviors[0].binding.objects[0].world='missing';assert.throws(()=>compileScene(scene));
});
test('一个相关对象上的多个规则作为同一个创作保存；独立规则分开',()=>{
  const scene=behaviorScene();scene.behaviors.push({...scene.behaviors[0],id:'door-observer',permissions:['hud.message'],code:'export function step({state}){return {state,commands:[]};}'});
  const groups=creationGroups(scene);assert.equal(groups.length,2);assert.equal(groups[0].behaviors.length,2);validateCreation(captureCreation(groups[0],scene));
});
test('放置完整创作不改变已有对象，新对象和行为都有独立身份',()=>{
  const before=behaviorScene(),scene=placeCreation(before,fixture(),source,{x:15,y:6,z:15,yaw:0});assert.deepEqual(scene.objects.slice(0,2),before.objects);assert.equal(scene.behaviors.length,3);compileScene(scene);
});
test('卸载与恢复不仅保留源码状态，也保留对象生命值和库存',()=>{
  const scene=behaviorScene(),build=compileScene(scene),state=new BehaviorState(build);state.value.modules['sliding-door'].state.open=true;state.value.inventory.wood=5;
  const empty=compileScene({...scene,objects:[],behaviors:[]}),unloaded=new BehaviorState(empty,state.snapshot());assert.equal(unloaded.value.archive[0].record.state.open,true);assert.equal(unloaded.value.inventory.wood,5);
  const restored=new BehaviorState(build,unloaded.snapshot());assert.equal(restored.value.modules['sliding-door'].state.open,true);assert.equal(restored.value.archive.length,0);
  scene.objects[0].components.health=100;const play=new GameplaySession([],scene.objects);play.state.targets['door-one'].health=35;
  const removed=new GameplaySession([],[],play.snapshot()),again=new GameplaySession([],scene.objects,removed.snapshot());assert.equal(again.state.targets['door-one'].health,35);assert.equal(Object.keys(again.state.archivedTargets).length,0);
});
