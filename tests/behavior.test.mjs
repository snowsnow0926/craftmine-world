import test from 'node:test';
import assert from 'node:assert/strict';
import { compileBehavior } from '../app/behavior-build.mjs';
import { validateBehavior,validateBehaviorFrame,validateBehaviorResult,jsonRecord } from '../app/behavior-contracts.mjs';
import { doorBehavior,bounceBehavior,behaviorFrame } from './behavior-fixtures.mjs';

test('不同玩法源码保存在产物中，构建可复核且不会执行源码',()=>{
  const door=compileBehavior(doorBehavior()),bounce=compileBehavior(bounceBehavior());assert.notEqual(door.hash,bounce.hash);assert.ok(door.definition.code.includes('!state.open'));
  assert.equal(door.hash,compileBehavior(structuredClone(doorBehavior())).hash);
  const dangerous=doorBehavior();dangerous.code="throw Error('DO NOT EXECUTE'); export function step() {}";assert.doesNotThrow(()=>compileBehavior(dangerous));
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
