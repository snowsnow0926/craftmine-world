import assert from 'node:assert/strict';
import test from 'node:test';
import { materializeCreationRuntime, creationTargetSnapshot, creationTargetSnapshotAtPoint, selectCreationTarget, advanceSequenceDoor } from '../desktop/godot/shared/creation_runtime.mjs';

const scene = { format:'craftmine.creation-scene/1', revision:3, defaults:{timeOfDay:12}, entities:[
  {id:'door-a',kind:'door',position:[4,0,4],rotationY:0,scale:[1,1,1],color:'#884422',parameters:{}},
  ...['blue','red','green'].map((id,index)=>({id,kind:'marker',position:[8+index*2,0,4],rotationY:0,scale:[1,1,1],color:'#884422',parameters:{}})),
], rules:[{id:'sequence-one',kind:'sequence-door',doorId:'door-a',sequence:['blue','red','green'],script:'scripts/creation/rules/sequence-one.gd',sha256:'a'.repeat(64)}]};

test('creation scene reopens as deterministic runtime entities and target snapshot',()=>{
  const first=materializeCreationRuntime(scene), reopened=materializeCreationRuntime(structuredClone(scene));
  assert.deepEqual(reopened,first); assert.equal(first.entities.length,4);
  const snap=creationTargetSnapshot(first,{worldId:'w',buildId:'b',instanceId:'i',manifestHash:'f'.repeat(64),targetId:'door-a'});
  assert.equal(snap.target.entityId,'door-a'); assert.deepEqual(snap.target.position,[4,0,4]);
});

test('top-down point selection resolves persisted entity identity without UI input',()=>{
  const runtime=materializeCreationRuntime(scene);
  // door-a is at canvas [320, 256] using CreationRenderer's origin/scale.
  assert.equal(selectCreationTarget(runtime,[320,256])?.id,'door-a');
  const snap=creationTargetSnapshotAtPoint(runtime,[320,256],{worldId:'w',buildId:'b',instanceId:'i',manifestHash:'f'.repeat(64)});
  assert.equal(snap.target.entityId,'door-a');
  assert.equal(selectCreationTarget(runtime,[0,0]),null);
});

test('overlapping target selection is deterministic by distance then id',()=>{
  const runtime=materializeCreationRuntime({ ...scene, entities: scene.entities.slice(0,2).map(entity=>({...entity,position:[4,0,4]})) });
  assert.equal(selectCreationTarget(runtime,[320,256])?.id,'blue');
});

test('sequence door opens only after the authored marker order',()=>{
  let runtime=materializeCreationRuntime(scene);
  runtime=advanceSequenceDoor(runtime,'red'); assert.equal(runtime.rules[0].open,false); assert.equal(runtime.rules[0].progress,0);
  for (const id of ['blue','red','green']) runtime=advanceSequenceDoor(runtime,id);
  assert.equal(runtime.rules[0].open,true); assert.equal(runtime.rules[0].progress,3);
});
