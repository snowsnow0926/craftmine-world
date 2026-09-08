import test from 'node:test';
import assert from 'node:assert/strict';
import { compileBehavior } from '../app/behavior-build.mjs';
import { validateBehavior,validateBehaviorFrame,validateBehaviorResult,jsonRecord } from '../app/behavior-contracts.mjs';
import { doorBehavior,bounceBehavior,behaviorFrame,behaviorScene } from './behavior-fixtures.mjs';
import { compileScene,decodeAgentScene,encodeAgentScene,validateSnapshot,validateObjectScope,sceneDiff } from '../app/scene.mjs';
import { BehaviorState } from '../app/behavior-state.mjs';

test('不同玩法源码保存在产物中，构建可复核且不会执行源码',()=>{
  const door=compileBehavior(doorBehavior()),bounce=compileBehavior(bounceBehavior());assert.notEqual(door.hash,bounce.hash);assert.ok(door.definition.code.includes('!state.open'));
  assert.equal(door.hash,compileBehavior(structuredClone(doorBehavior())).hash);
  const dangerous=doorBehavior();dangerous.code="throw Error('DO NOT EXECUTE'); export function step() {}";assert.doesNotThrow(()=>compileBehavior(dangerous));
});

test('源码随场景构建保存，模型传输可往返，来源对象和写权限唯一',()=>{
  const scene=behaviorScene(),build=compileScene(scene);assert.equal(build.behaviors.length,2);assert.deepEqual(decodeAgentScene(encodeAgentScene(scene)),scene);
  assert.equal(build.hash,compileScene(scene).hash);scene.behaviors[0].targets=['missing'];assert.throws(()=>compileScene(scene),/不存在/);
  const conflict=behaviorScene();conflict.behaviors.push({...doorBehavior(),id:'second-writer'});assert.throws(()=>compileScene(conflict),/只能由一个/);
  assert.deepEqual(sceneDiff({...behaviorScene(),behaviors:[]},behaviorScene()).behaviors.added,['交互滑门','弹跳板']);
});
test('选中对象允许它自己的代码，拒绝另一个对象和全局运动权限',()=>{
  const before={...behaviorScene(),behaviors:[]},after=structuredClone(before);after.behaviors=[doorBehavior()];assert.doesNotThrow(()=>validateObjectScope(before,after,'door-one'));
  after.behaviors.push(bounceBehavior());assert.throws(()=>validateObjectScope(before,after,'door-one'),/范围/);
});
const openResult=()=>({state:{open:true},commands:[{type:'object.patch',id:'door-one',position:{x:1.2,y:6,z:7},solid:false,visible:true,color:null}]});
test('完整命令批次先校验后提交，真实对象几何与碰撞一起变化',()=>{
  const build=compileScene(behaviorScene()),state=new BehaviorState(build),frame=behaviorFrame();
  state.apply(build.behaviors[0],openResult(),frame);assert.equal(state.value.modules['sliding-door'].state.open,true);assert.equal(state.view.objects[0].position.x,1.2);assert.ok(state.view.primitives.filter(p=>p.id==='door-one').every(p=>!p.solid));
  const before=state.snapshot(),bad=openResult();bad.commands[0].position.y=38;
  assert.throws(()=>state.apply(build.behaviors[0],bad,frame),/边界/);assert.deepEqual(state.snapshot(),before);
  bad.commands[0].position={x:0,y:6,z:10};bad.commands[0].solid=true;assert.throws(()=>state.apply(build.behaviors[0],bad,frame),/玩家/);assert.deepEqual(state.snapshot(),before);
});
test('状态和对象偏移跨存档及参数修改保留，不兼容状态版本拒绝载入',()=>{
  const scene=behaviorScene(),build=compileScene(scene),state=new BehaviorState(build);state.apply(build.behaviors[0],openResult(),behaviorFrame());
  const saved=state.snapshot(),snapshot={format:'craftmine.progress/3',player:{x:0,y:6,z:10,yaw:0,pitch:0},gameplay:{systems:{},targets:{},equipped:null},behaviors:saved};assert.deepEqual(validateSnapshot(snapshot),snapshot);
  scene.objects[0].position.z=9;scene.behaviors[0].params.z=9;
  const restored=new BehaviorState(compileScene(scene),saved);assert.equal(restored.value.modules['sliding-door'].state.open,true);assert.equal(restored.view.objects[0].position.z,9);assert.equal(restored.view.objects[0].position.x,1.2);
  scene.behaviors[0].stateVersion=2;assert.throws(()=>new BehaviorState(compileScene(scene),saved),/迁移/);
});
test('库存不足拒绝整步操作，包括同一步的对象变化和模块状态',()=>{
  const scene=behaviorScene();scene.behaviors[0].permissions.push('inventory.write');const build=compileScene(scene),state=new BehaviorState(build),before=state.snapshot();
  const bad=openResult();bad.commands.push({type:'inventory.add',item:'wood',count:-1});assert.throws(()=>state.apply(build.behaviors[0],bad,behaviorFrame()),/库存/);assert.deepEqual(state.snapshot(),before);
  bad.commands[1].count=3;state.apply(build.behaviors[0],bad,behaviorFrame());assert.equal(state.value.inventory.wood,3);assert.equal(state.value.modules['sliding-door'].state.open,true);
});
test('保留旧玩法偏移后若与新增实体重叠，拒绝恢复；已摧毁目标不阻挡',()=>{
  const scene=behaviorScene(),build=compileScene(scene),state=new BehaviorState(build),opened=openResult();opened.commands[0].solid=true;
  state.apply(build.behaviors[0],opened,behaviorFrame());const saved=state.snapshot();
  const obstacle=structuredClone(scene.objects[0]);obstacle.id='new-obstacle';obstacle.position.x=1.2;obstacle.components.health=100;scene.objects.push(obstacle);
  const next=compileScene(scene);assert.throws(()=>new BehaviorState(next,saved),/重叠/);
  assert.doesNotThrow(()=>new BehaviorState(next,saved,{targets:{'new-obstacle':{health:0}}}));
});
test('语法错误、超大源码和未知权限在候选构建前拒绝',()=>{
  const d=doorBehavior();d.code='export function step( {';assert.throws(()=>compileBehavior(d),/语法错误/);d.code='x'.repeat(32001);assert.throws(()=>validateBehavior(d));d.code='export function step() {}';d.permissions=['shell.execute'];assert.throws(()=>validateBehavior(d));
});
test('状态必须可保存，限制体积、递归、非 JSON 类型与污染字段',()=>{
  assert.throws(()=>jsonRecord({value:Infinity}));assert.throws(()=>jsonRecord({value:new Map()}));assert.throws(()=>jsonRecord({value:'x'.repeat(16001)}));assert.throws(()=>jsonRecord(JSON.parse('{"__proto__":{}}')));
  const cycle={};cycle.next=cycle;assert.throws(()=>jsonRecord(cycle),/复杂/);assert.deepEqual(jsonRecord({inventory:{wood:3},opened:false}),{inventory:{wood:3},opened:false});
});
test('上下文校验拒绝无效事件和伪造玩家数据',()=>{
  const frame=behaviorFrame();assert.doesNotThrow(()=>validateBehaviorFrame(frame));frame.event.type='shell';assert.throws(()=>validateBehaviorFrame(frame));frame.event.type='tick';frame.player.position.x=10000;assert.throws(()=>validateBehaviorFrame(frame));
});
test('只有已授权且仍存在的对象能被修改，整批校验后才返回',()=>{
  const d=doorBehavior(),frame=behaviorFrame(),command={type:'object.patch',id:'door-one',position:null,visible:true,solid:false,color:null};
  assert.doesNotThrow(()=>validateBehaviorResult({state:{open:true},commands:[command]},d,frame));
  assert.throws(()=>validateBehaviorResult({state:{open:true},commands:[command,{...command,id:'pad-one'}]},d,frame),/未授权/);
  frame.objects=[];assert.throws(()=>validateBehaviorResult({state:{},commands:[command]},d,frame));
});
test('受控命令拒绝越权、越界、超大冲量、伪造命令和洪泛',()=>{
  const d=doorBehavior(),frame=behaviorFrame();assert.throws(()=>validateBehaviorResult({state:{},commands:[{type:'player.impulse',velocity:{x:0,y:10,z:0}}]},d,frame),/权限/);
  const b=bounceBehavior();assert.throws(()=>validateBehaviorResult({state:{},commands:[{type:'player.impulse',velocity:{x:0,y:100,z:0}}]},b,frame));
  assert.throws(()=>validateBehaviorResult({state:{},commands:[{type:'eval',code:'alert(1)'}]},d,frame));
  assert.throws(()=>validateBehaviorResult({state:{},commands:Array.from({length:33},()=>({type:'hud.message',text:'x'}))},d,frame));
});
