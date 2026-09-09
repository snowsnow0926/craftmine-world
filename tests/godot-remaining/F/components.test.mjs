// F task: the component library must resolve real files, extract real
// instances from the committed worlds and install a component into a copied
// world with a NEW identity and the component's initial state.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  applyInstallation,
  componentPackageInput,
  extractInstance,
  getComponent,
  listComponents,
  loadComponentCatalog,
  planInstallation,
} from '../../../desktop/godot/shared/components.mjs';

const BASES_DIR = 'desktop/godot/bases';
const CATALOG = loadComponentCatalog(path.join(BASES_DIR, 'component-catalog.json'));

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'craftmine-f-components-'));
}

test('every base exposes at least five reusable components', () => {
  for (const baseId of ['first-person', 'top-down', 'side-view']) {
    const components = listComponents(CATALOG, { baseId });
    assert.ok(components.length >= 5, `${baseId} has ${components.length} components`);
    for (const component of components) {
      assert.ok(component.identity && component.identity.scheme, `${component.id} declares a stable identity scheme`);
      assert.ok('persistentState' in component && 'initialState' in component, `${component.id} declares state`);
    }
  }
});

test('a package input carries files, hashes, identity and initial state but no progress', () => {
  const input = componentPackageInput(CATALOG, { componentId: 'sv.target' });
  assert.equal(input.baseId, 'side-view');
  assert.equal(input.identity.field, 'id');
  assert.ok(input.files.some((file) => file.path === 'scripts/world/target.gd'));
  assert.match(input.contentHash, /^[0-9a-f]{64}$/);
  const text = JSON.stringify(input);
  assert.ok(!/coins|reward_ruins_cache|dummy_ruins/.test(text), 'package input must not carry a world instance');
});

test('extract reads a real instance from the committed ruins world', () => {
  const world = path.join(BASES_DIR, 'side-view', 'worlds', 'ruins');
  const target = extractInstance({ catalog: CATALOG, componentId: 'sv.target', projectDir: world, entityId: 'dummy_ruins' });
  assert.ok(target);
  assert.equal(target.roomId, 'ruins');
  assert.equal(target.collection, 'targets');
  assert.equal(target.entity.health, 2);
  const door = extractInstance({ catalog: CATALOG, componentId: 'sv.room-door', projectDir: world, entityId: 'door_vault' });
  assert.equal(door.entity.targetRoom, 'vault');
  const missing = extractInstance({ catalog: CATALOG, componentId: 'sv.target', projectDir: world, entityId: 'nope' });
  assert.equal(missing, null);
});

test('extract reads a top-down scene node and a first-person target', () => {
  const topDown = extractInstance({
    catalog: CATALOG,
    componentId: 'td.shop',
    projectDir: path.join(BASES_DIR, 'top-down', 'worlds', 'town'),
    entityId: 'shop-general',
  });
  assert.ok(topDown, 'the shop counter found in the town scene');
  assert.equal(topDown.scene, 'scenes/shop_interior.tscn');
  assert.equal(topDown.identityField, 'entity_id');
  assert.equal(topDown.properties.shop_id, '"general"');

  const firstPerson = extractInstance({
    catalog: CATALOG,
    componentId: 'fp.target-dummy',
    projectDir: path.join(BASES_DIR, 'first-person'),
    entityId: 'target_a',
  });
  assert.ok(firstPerson, 'target_a found in the training range');
  assert.equal(firstPerson.identityField, 'target_id');
  assert.equal(firstPerson.instanceExtResource, '11_target');
  assert.equal(firstPerson.properties.target_id, '&"target_a"');
});

test('installing a side-view component assigns a new id and starts from initial state', () => {
  const source = path.join(BASES_DIR, 'side-view');
  const project = path.join(tempDir(), 'world');
  fs.cpSync(path.join(source, 'worlds', 'blank'), project, { recursive: true });
  const before = JSON.parse(fs.readFileSync(path.join(project, 'world.json'), 'utf8'));
  const plan = planInstallation({
    catalog: CATALOG,
    componentId: 'sv.reward-pickup',
    projectDir: project,
    entityId: 'reward_second_cache',
    roomId: 'start',
    placement: { x: 320, y: 320 },
    overrides: { grants: { counters: { coins: 3 }, items: {} } },
  });
  assert.equal(plan.baseId, 'side-view');
  assert.deepEqual(plan.dataPatches[0].path, 'rooms[id=start].rewards');
  const receipt = applyInstallation({ catalog: CATALOG, plan, sourceDir: source, projectDir: project });
  assert.equal(receipt.ok, true, receipt.error);
  const after = JSON.parse(fs.readFileSync(path.join(project, 'world.json'), 'utf8'));
  const room = after.rooms.find((entry) => entry.id === 'start');
  assert.equal(before.rooms[0].rewards.length + 1, room.rewards.length);
  const installed = room.rewards.find((entry) => entry.id === 'reward_second_cache');
  assert.deepEqual(installed, { id: 'reward_second_cache', x: 320, y: 320, grants: { counters: { coins: 3 }, items: {} } });
  assert.ok(!('taken' in installed), 'a new instance starts from the ledger, not the source author state');
});

test('installing refuses a duplicate identity and an unsafe id', () => {
  const project = path.join(tempDir(), 'world');
  fs.cpSync(path.join(BASES_DIR, 'side-view', 'worlds', 'ruins'), project, { recursive: true });
  assert.throws(
    () => planInstallation({ catalog: CATALOG, componentId: 'sv.target', projectDir: project, entityId: 'dummy_ruins' }),
    /already exists/,
  );
  assert.throws(
    () => planInstallation({ catalog: CATALOG, componentId: 'sv.target', projectDir: project, entityId: '../escape' }),
    /portable id/,
  );
});

test('two installations of the same component keep independent identities', () => {
  const source = path.join(BASES_DIR, 'side-view');
  const project = path.join(tempDir(), 'world');
  fs.cpSync(path.join(source, 'worlds', 'blank'), project, { recursive: true });
  for (const id of ['checkpoint_a', 'checkpoint_b']) {
    const plan = planInstallation({ catalog: CATALOG, componentId: 'sv.checkpoint', projectDir: project, entityId: id, roomId: 'start', placement: { x: 100, y: 320 } });
    const receipt = applyInstallation({ catalog: CATALOG, plan, sourceDir: source, projectDir: project });
    assert.equal(receipt.ok, true, receipt.error);
  }
  const world = JSON.parse(fs.readFileSync(path.join(project, 'world.json'), 'utf8'));
  const ids = world.rooms[0].checkpoints.map((entry) => entry.id);
  assert.deepEqual(ids.slice(-2), ['checkpoint_a', 'checkpoint_b']);
});

test('a component source hash mismatch stops the installation', () => {
  const source = path.join(BASES_DIR, 'side-view');
  const project = path.join(tempDir(), 'world');
  fs.cpSync(path.join(source, 'worlds', 'blank'), project, { recursive: true });
  const plan = planInstallation({ catalog: CATALOG, componentId: 'sv.hazard', projectDir: project, entityId: 'spikes_new', roomId: 'start', placement: { x: 300, y: 340 } });
  plan.files = plan.files.map((file) => ({ ...file, copy: true, sha256: 'deadbeef' }));
  const receipt = applyInstallation({ catalog: CATALOG, plan, sourceDir: source, projectDir: project });
  assert.equal(receipt.ok, false);
  assert.match(receipt.error, /hash mismatch/);
});

test('a scene-node component is written into the target scene with a new identity', () => {
  const project = path.join(tempDir(), 'world');
  fs.cpSync(path.join(BASES_DIR, 'top-down', 'worlds', 'blank'), project, { recursive: true });
  const scene = 'scenes/world.tscn';
  const plan = planInstallation({
    catalog: CATALOG,
    componentId: 'td.door',
    projectDir: project,
    entityId: 'door_new',
    scene,
    placement: { x: 64, y: 96 },
  });
  assert.equal(plan.dataPatches.length, 0);
  assert.equal(plan.sceneEdits.length, 1);
  assert.equal(plan.sceneEdits[0].format, 'craftmine.godot-scene-edit/1');
  assert.equal(plan.manualSteps.length, 0);
  const before = fs.readFileSync(path.join(project, scene), 'utf8');
  const receipt = applyInstallation({ catalog: CATALOG, plan, sourceDir: path.join(BASES_DIR, 'top-down'), projectDir: project });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.sceneApplied.length, 1);
  assert.equal(receipt.requiresSceneEdit, undefined);
  const after = fs.readFileSync(path.join(project, scene), 'utf8');
  assert.match(after, /\[node name="door_new" type="Area2D" parent="\."\]/);
  assert.match(after, /entity_id = "door_new"/);
  assert.match(after, /target_scene = ""/);
  assert.match(after, /\[ext_resource type="Script"[^\]]*path="res:\/\/scripts\/base\/door_zone\.gd"/);
  // A second instance of the same component is independent of the first.
  const second = planInstallation({
    catalog: CATALOG,
    componentId: 'td.door',
    projectDir: project,
    entityId: 'door_other',
    scene,
    placement: { x: 200, y: 96, target_scene: 'res://scenes/shop_interior.tscn' },
  });
  applyInstallation({ catalog: CATALOG, plan: second, sourceDir: path.join(BASES_DIR, 'top-down'), projectDir: project });
  const both = fs.readFileSync(path.join(project, scene), 'utf8');
  assert.match(both, /entity_id = "door_new"/);
  assert.match(both, /entity_id = "door_other"/);
  assert.match(both, /target_scene = "res:\/\/scenes\/shop_interior\.tscn"/);
  assert.match(both, /target_scene = ""/);
  assert.equal(both.match(/entity_id = "door_new"/g).length, 1);
});

test('a top-down data component installs its data file with a new identity', () => {
  const project = path.join(tempDir(), 'world');
  fs.cpSync(path.join(BASES_DIR, 'top-down', 'worlds', 'blank'), project, { recursive: true });
  const plan = planInstallation({
    catalog: CATALOG,
    componentId: 'td.quest',
    projectDir: project,
    entityId: 'f-courier',
    overrides: { giver: 'npc-mira', requires: { itemId: 'herb', count: 1 }, reward: { coins: 5 } },
  });
  assert.deepEqual(plan.sceneEdits, []);
  assert.equal(plan.dataPatches[0].kind, 'data-file');
  assert.equal(plan.dataPatches[0].file, 'data/quests/f-courier.json');
  const receipt = applyInstallation({ catalog: CATALOG, plan, sourceDir: path.join(BASES_DIR, 'top-down'), projectDir: project });
  assert.equal(receipt.ok, true, receipt.error);
  const quest = JSON.parse(fs.readFileSync(path.join(project, 'data', 'quests', 'f-courier.json'), 'utf8'));
  assert.equal(quest.id, 'f-courier');
  assert.equal(quest.giver, 'npc-mira');
  assert.ok(!('rewarded' in quest), 'a new quest starts unrewarded');
  assert.ok(!('status' in quest), 'a new quest does not ship a completed status');
});

test('unknown components are rejected instead of silently resolved', () => {
  assert.throws(() => getComponent(CATALOG, 'nope.nothing'), /unknown component/);
  assert.throws(() => componentPackageInput(CATALOG, { componentId: 'sv.target', baseId: 'top-down' }), /unknown component/);
});
