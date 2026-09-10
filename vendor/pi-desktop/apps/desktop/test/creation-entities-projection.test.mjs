import test from 'node:test';
import assert from 'node:assert/strict';
import { readCreationEntities, creationRenderItemsForBase } from '../../../../../desktop/godot/shared/creation-entities.mjs';

const source = JSON.stringify({
  format: 'craftmine.creation-scene/1', revision: 3, defaults:{timeOfDay:12},
  entities: [{ id: 'tree-1', kind: 'tree', position: [2, 4, 9], rotationY:0, scale: [2, 1, 1], color: '#44aa88', parameters:{} }],
});

test('side-view projects creation entities on x/y plane', () => {
  const doc = readCreationEntities(source);
  const [item] = creationRenderItemsForBase(doc, 'side-view', { scale: 16, origin: [10, 20] });
  assert.deepEqual(item.position, { x: 42, y: 84 });
  assert.equal(item.id, 'tree-1');
});

test('mining-sandbox uses same durable projection and preserves identity', () => {
  const doc = readCreationEntities(source);
  const [item] = creationRenderItemsForBase(doc, 'mining-sandbox');
  assert.deepEqual(item.position, { x: 64, y: 128 });
  assert.equal(item.scale.x, 2);
});

test('unsupported base is rejected before rendering', () => {
  const doc = readCreationEntities(source);
  assert.throws(() => creationRenderItemsForBase(doc, 'unknown'), /CREATION_BASE_UNSUPPORTED/);
});
