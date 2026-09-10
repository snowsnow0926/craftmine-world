import test from 'node:test';
import assert from 'node:assert/strict';
import { readCreationEntities, creationRenderItems } from '../desktop/godot/shared/creation-entities.mjs';

const source = JSON.stringify({ format: 'craftmine.creation-scene/1', revision: 3, defaults: { timeOfDay: 12 }, entities: [
  { id: 'tree-1', kind: 'tree', position: [2, 0, -4], rotationY: 0, scale: [1, 2, 1], color: '#84A866', parameters: {} },
  { id: 'door-1', kind: 'door', position: [-2, 0, 1], rotationY: 90, scale: [1, 1, 1], color: '#B87333', parameters: { initiallyOpen: false } },
] });

test('creation entities retain stable identity and x/z render coordinates across reopen', () => {
  const first = readCreationEntities(source);
  const reopened = readCreationEntities(source);
  assert.equal(reopened.revision, 3);
  assert.deepEqual(creationRenderItems(reopened), [
    { id: 'tree-1', kind: 'tree', position: { x: 2, y: -4 }, scale: { x: 1, y: 1 }, color: '#84A866' },
    { id: 'door-1', kind: 'door', position: { x: -2, y: 1 }, scale: { x: 1, y: 1 }, color: '#B87333' },
  ]);
});

test('missing creation scene is an empty world', () => {
  assert.equal(readCreationEntities(''), null);
  assert.deepEqual(creationRenderItems(null), []);
  assert.throws(() => readCreationEntities('{}'), error=>error.errorCode==='CREATION_SCENE_INVALID');
});

test('视图投影拒绝无效完整合同及错误参数',()=>{
 const sourceValue=JSON.parse(source);sourceValue.entities[0].scale=[1,0,1];
 assert.throws(()=>readCreationEntities(JSON.stringify(sourceValue)),error=>error.errorCode==='CREATION_SCENE_INVALID');
 assert.throws(()=>creationRenderItems(sourceValue),error=>error.errorCode==='CREATION_SCENE_INVALID');
});
