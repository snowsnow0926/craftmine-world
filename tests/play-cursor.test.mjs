import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { makeWorldRuntime } from '../app/world-runtime.mjs';

// Memory-only event targets: never creates a browser, locks a pointer, or sends OS input.
function fixture() {
  const listeners=new Map();
  const document={activeElement:null,pointerLockElement:null,hidden:false,exitPointerLock(){this.pointerLockElement=null;}};
  const window={};
  let rejectLock, attempts=0;
  const context=vm.createContext({window,document,matchMedia:()=>({matches:false})});
  vm.runInContext(fs.readFileSync(new URL('../world-workshop-3d/src/voxel-runtime.js',import.meta.url),'utf8'),context);
  globalThis.WorldRuntime=window.WorldRuntime;
  globalThis.document=document;globalThis.window=window;
  const enter={hidden:false};let frozen=false;
  const Runtime=makeWorldRuntime({send(){},inform(){},enter,isFrozen:()=>frozen});
  const engine=Object.create(Runtime.prototype);
  Object.assign(engine,{canvas:{style:{},focus(){},setPointerCapture(){},requestPointerLock(){attempts++;return new Promise((_,reject)=>{rejectLock=reject;});}},active:true,input:false,keys:new Set(),touchMove:{x:0,y:0},p:{yaw:0,pitch:0},listen(target,type,handler){listeners.set(type,handler);}});
  engine.bindInput();
  return {engine,document,enter,event:(type,payload={})=>listeners.get(type)(payload),freeze:()=>{frozen=true;},reject:()=>rejectLock(Error('unsupported')),attempts:()=>attempts};
}

test('玩家点击画布后隐藏游戏光标，暂停和迟到的锁定拒绝保持释放输入',async()=>{
  const f=fixture();
  f.event('pointerdown',{button:0,pointerId:1});
  assert.equal(f.engine.input,true);assert.equal(f.engine.canvas.style.cursor,'none');assert.equal(f.attempts(),1);
  f.engine.keys.add('KeyW');f.engine.pauseInput();f.reject();await Promise.resolve();
  assert.equal(f.engine.input,false);assert.equal(f.engine.canvas.style.cursor,'');assert.equal(f.engine.keys.size,0);
  f.event('pointerlockerror');assert.equal(f.engine.input,false);
});

test('锁定释放、失焦与浮层暂停均恢复光标，迟到的锁定成功被释放',()=>{
  const f=fixture();f.engine.input=true;f.document.pointerLockElement=f.engine.canvas;
  f.event('pointerlockchange');assert.equal(f.engine.canvas.style.cursor,'none');
  f.document.pointerLockElement=null;f.event('pointerlockchange');assert.equal(f.engine.canvas.style.cursor,'');
  f.engine.input=true;f.engine.syncCursor();f.event('blur');assert.equal(f.engine.canvas.style.cursor,'');
  f.freeze();f.document.pointerLockElement=f.engine.canvas;f.event('pointerlockchange');
  assert.equal(f.document.pointerLockElement,null);assert.equal(f.engine.input,false);
  f.event('pointerdown',{button:0,pointerId:1});assert.equal(f.attempts(),0);
});

test('暂停恢复只显示入口，下一次玩家点击才重新捕获；输入框按键不穿透',()=>{
  const f=fixture();f.engine.resize=()=>{};
  f.engine.input=true;f.engine.setActive(false);assert.equal(f.engine.canvas.style.cursor,'');
  f.engine.setActive(true);assert.equal(f.engine.input,false);assert.equal(f.attempts(),0);
  f.event('pointerdown',{button:0,pointerId:1});assert.equal(f.engine.canvas.style.cursor,'none');
  f.document.activeElement={tagName:'TEXTAREA'};
  f.event('keydown',{code:'KeyW',preventDefault(){throw Error('Text key was intercepted');}});
  assert.equal(f.engine.keys.size,0);
});

test('Godot 两种第一人称控制器共同释放暂停和失焦捕获，拒绝后台捕获',()=>{
  const first=fs.readFileSync(new URL('../desktop/godot/bases/first-person/scripts/core/player_controller.gd',import.meta.url),'utf8');
  const creation=fs.readFileSync(new URL('../desktop/godot/bases/creation-sandbox/scripts/reused/player_controller.gd',import.meta.url),'utf8');
  assert.equal(creation,first);
  assert.match(first,/NOTIFICATION_PAUSED, NOTIFICATION_WM_WINDOW_FOCUS_OUT, NOTIFICATION_APPLICATION_FOCUS_OUT\]:\n\t\tset_captured\(false\)/);
  assert.match(first,/if value and \(not input_enabled or get_tree\(\).paused or DisplayServer.get_name\(\) == "headless"\):\n\t\treturn/);
});
