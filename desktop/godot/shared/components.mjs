// Component library for the authored Godot bases.
//
// A "component" is one reusable, individually identifiable piece of a base:
// a door, an interactable, an NPC dialogue, a shop, a quest, a checkpoint, an
// equipment item, a crosshair. The catalog declares its files, its stable
// identity field, its persistent state fields and its starting state.
//
// This module is the host-side library the packaging task (H) and the model
// tool task (L) consume. It can:
//   - list and resolve components per base,
//   - build a package input (files + hashes + initial state + state contract),
//   - extract a real instance from a materialized world,
//   - plan and apply an installation that assigns a NEW identity and starts
//     from the component's initial state (never the source author's progress).
//
// It never runs Godot and never edits a `.tscn`: scene text is returned as an
// explicit manual step so a component cannot silently rewrite a scene graph.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { sha256File } from './base_contract.mjs';

export const INSTALL_PLAN_FORMAT = 'craftmine.godot-component-install/1';
export const COMPONENT_PACKAGE_FORMAT = 'craftmine.godot-component-package/1';

/** Side-view entities live in world.json rooms; map component id -> collection. */
const SIDE_VIEW_COLLECTIONS = Object.freeze({
  'sv.room-door': 'doors',
  'sv.checkpoint': 'checkpoints',
  'sv.ability-pickup': 'abilities',
  'sv.reward-pickup': 'rewards',
  'sv.target': 'targets',
  'sv.hazard': 'hazards',
  'sv.spawn': 'spawns',
});

/** Top-down data-driven components: component id -> data file + id field. */
const TOP_DOWN_DATA = Object.freeze({
  'td.npc-dialogue': { file: 'data/npcs', idField: 'id' },
  'td.shop': { file: 'data/shops', idField: 'id' },
  'td.quest': { file: 'data/quests', idField: 'id' },
});

export function loadComponentCatalog(file) {
  const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (catalog.format !== 'craftmine.godot-component-catalog/1') {
    throw new Error(`unsupported component catalog format: ${catalog.format}`);
  }
  return catalog;
}

export function listComponents(catalog, { baseId = null, kind = null } = {}) {
  return catalog.components.filter(
    (component) => (baseId === null || component.baseId === baseId) && (kind === null || component.kind === kind),
  );
}

export function getComponent(catalog, componentId, baseId = null) {
  const matches = catalog.components.filter(
    (component) => component.id === componentId && (baseId === null || component.baseId === baseId),
  );
  if (matches.length === 0) throw new Error(`unknown component: ${componentId}`);
  if (matches.length > 1) throw new Error(`component ${componentId} is declared for more than one base; pass baseId`);
  return matches[0];
}

/**
 * Packaging input for H: exactly the files, hashes, identity, state contract and
 * initial state needed to install this component in another world of the same
 * base. Contains no player progress and no absolute path.
 */
export function componentPackageInput(catalog, { componentId, baseId = null }) {
  const component = getComponent(catalog, componentId, baseId);
  return {
    format: COMPONENT_PACKAGE_FORMAT,
    componentId: component.id,
    componentVersion: component.version,
    kind: component.kind,
    label: component.label,
    baseId: component.baseId,
    baseVersion: component.baseVersion,
    identity: component.identity,
    persistentState: component.persistentState,
    initialState: component.initialState,
    files: component.files.map((file) => ({ path: file.path, bytes: file.bytes, sha256: file.sha256 })),
    contentHash: filesDigest(component.files),
  };
}

export function filesDigest(files) {
  // Deterministic digest over path+hash pairs; independent of filesystem order.
  const parts = files
    .map((file) => `${file.path}:${file.sha256 ?? 'missing'}`)
    .sort()
    .join('\n');
  return createHash('sha256').update(parts, 'utf8').digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Extract a real instance of a component from a materialized world project. */
export function extractInstance({ catalog, componentId, projectDir, entityId = null }) {
  const component = getComponent(catalog, componentId);
  const baseId = component.baseId;
  if (baseId === 'side-view') {
    const worldFile = path.join(projectDir, 'world.json');
    if (!fs.existsSync(worldFile)) throw new Error(`no world.json in ${projectDir}`);
    const world = readJson(worldFile);
    const collection = SIDE_VIEW_COLLECTIONS[component.id];
    if (!collection) throw new Error(`component ${component.id} has no side-view collection mapping`);
    for (const room of world.rooms || []) {
      for (const entity of room[collection] || []) {
        if (entityId === null || entity.id === entityId) {
          return {
            baseId,
            componentId: component.id,
            entityId: entity.id,
            roomId: room.id,
            collection,
            entity: JSON.parse(JSON.stringify(entity)),
            initialState: component.initialState,
          };
        }
      }
    }
    return null;
  }
  return extractFromScenes({ component, projectDir, entityId });
}

/** Text-level `.tscn` scan: find a node whose exported id matches entityId. */
function extractFromScenes({ component, projectDir, entityId }) {
  const identityField = component.identity?.field || 'entity_id';
  const idFields = [...new Set(['entity_id', 'target_id', identityField, 'shop_id', 'npc_id', 'spawn_id', 'zone_id'])];
  const candidates = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.godot') continue;
        walk(full);
      } else if (entry.name.endsWith('.tscn')) {
        candidates.push(full);
      }
    }
  };
  walk(projectDir);
  for (const file of candidates.sort()) {
    const text = fs.readFileSync(file, 'utf8');
    const blocks = text.split(/\n(?=\[node )/);
    for (const block of blocks) {
      const name = /\[node name="([^"]+)"/.exec(block);
      if (!name) continue;
      const properties = {};
      for (const match of block.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/gm)) {
        properties[match[1]] = match[2].trim();
      }
      const found = idFields
        .map((field) => [field, properties[field]])
        .filter(([, value]) => value !== undefined);
      if (found.length === 0) continue;
      const unquote = (value) => value.replace(/^&?"(.*)"$/, '$1');
      const match = entityId === null ? found[0] : found.find(([, value]) => unquote(value) === entityId);
      if (!match) continue;
      const [matchedField, matchedValue] = match;
      const script = /script\s*=\s*ExtResource\("([^"]+)"\)/.exec(block);
      const instance = /instance=ExtResource\("([^"]+)"\)/.exec(block);
      return {
        baseId: component.baseId,
        componentId: component.id,
        entityId: unquote(matchedValue),
        identityField: matchedField,
        scene: path.relative(projectDir, file).split(path.sep).join('/'),
        nodeName: name[1],
        nodeType: /\[node name="[^"]+"(?: type="([^"]+)")?/.exec(block)?.[1] || null,
        scriptExtResource: script ? script[1] : null,
        instanceExtResource: instance ? instance[1] : null,
        properties,
        initialState: component.initialState,
      };
    }
  }
  return null;
}

function sideViewEntityDefaults(componentId, entityId, placement, overrides) {
  const base = { id: entityId };
  switch (componentId) {
    case 'sv.room-door':
      return { ...base, x: 0, y: 0, w: 24, h: 360, targetRoom: '', targetSpawn: '', ...placement, ...overrides };
    case 'sv.checkpoint':
      return { ...base, x: 0, y: 0, ...placement, ...overrides };
    case 'sv.ability-pickup':
      return { ...base, x: 0, y: 0, ...placement, ...overrides };
    case 'sv.reward-pickup':
      return { ...base, x: 0, y: 0, grants: { counters: {}, items: {} }, ...placement, ...overrides };
    case 'sv.target':
      return { ...base, kind: 'dummy', x: 0, y: 0, health: 1, ...placement, ...overrides };
    case 'sv.hazard':
      return { ...base, x: 0, y: 0, w: 32, h: 16, ...placement, ...overrides };
    case 'sv.spawn':
      return { ...base, x: 0, y: 0, facing: 1, ...placement, ...overrides };
    default:
      return { ...base, ...placement, ...overrides };
  }
}

function assertFreshIdentity(world, entityId) {
  for (const room of world.rooms || []) {
    for (const collection of Object.values(SIDE_VIEW_COLLECTIONS)) {
      for (const entity of room[collection] || []) {
        if (entity.id === entityId) return `entity id ${entityId} already exists in room ${room.id}`;
      }
    }
  }
  return null;
}

/**
 * Build a deterministic installation plan. The plan never inherits progress:
 * a new entity id is assigned and the entity starts from the component's
 * declared initial state (the side-view state ledger starts empty).
 */
export function planInstallation({ catalog, componentId, projectDir, entityId, roomId = null, placement = {}, overrides = {} }) {
  const component = getComponent(catalog, componentId);
  if (typeof entityId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(entityId)) {
    throw new Error('entityId must be a portable id');
  }
  const files = component.files.map((file) => {
    const target = path.join(projectDir, file.path);
    return {
      path: file.path,
      sha256: file.sha256,
      present: fs.existsSync(target),
      copy: !fs.existsSync(target),
    };
  });
  const plan = {
    format: INSTALL_PLAN_FORMAT,
    componentId: component.id,
    componentVersion: component.version,
    baseId: component.baseId,
    entityId,
    identity: component.identity,
    persistentState: component.persistentState,
    initialState: component.initialState,
    files,
    dataPatches: [],
    sceneEdits: [],
    manualSteps: [],
  };

  if (component.baseId === 'side-view') {
    const worldFile = path.join(projectDir, 'world.json');
    const world = readJson(worldFile);
    const targetRoom = roomId ?? world.startRoom ?? (world.rooms?.[0]?.id ?? null);
    const room = (world.rooms || []).find((entry) => entry.id === targetRoom);
    if (!room) throw new Error(`room ${targetRoom} does not exist in ${worldFile}`);
    const conflict = assertFreshIdentity(world, entityId);
    if (conflict) throw new Error(conflict);
    const collection = SIDE_VIEW_COLLECTIONS[component.id];
    const entity = sideViewEntityDefaults(component.id, entityId, placement, overrides);
    plan.dataPatches.push({
      kind: 'json-append',
      file: 'world.json',
      path: `rooms[id=${targetRoom}].${collection}`,
      entity,
    });
    return plan;
  }

  if (component.baseId === 'top-down') {
    const data = TOP_DOWN_DATA[component.id];
    if (data) {
      plan.dataPatches.push({
        kind: 'data-file',
        file: `${data.file}/${entityId}.json`,
        idField: data.idField,
        entity: { id: entityId, ...placement, ...overrides },
      });
      return plan;
    }
  }

  plan.sceneEdits.push({
    reason: 'scene-node-required',
    baseId: component.baseId,
    componentId: component.id,
    identityField: component.identity?.field || null,
    requiredExports: Object.keys(component.initialState || {}),
    note: 'Add the component node to the target scene and set the identity field. This tool never rewrites .tscn files.',
  });
  plan.manualSteps.push(`add a ${component.label} node with ${component.identity?.field || 'identity'} = ${entityId}`);
  return plan;
}

/** Apply the file copies and JSON patches a plan can apply safely. */
export function applyInstallation({ catalog, plan, sourceDir, projectDir }) {
  const receipt = {
    format: INSTALL_PLAN_FORMAT,
    componentId: plan.componentId,
    entityId: plan.entityId,
    copied: [],
    patched: [],
    manualSteps: [...plan.manualSteps],
    ok: true,
  };
  const component = getComponent(catalog, plan.componentId);
  for (const file of plan.files) {
    if (!file.copy) continue;
    const source = path.join(sourceDir, file.path);
    const target = path.join(projectDir, file.path);
    if (!fs.existsSync(source)) {
      receipt.ok = false;
      receipt.error = `missing component source file: ${file.path}`;
      return receipt;
    }
    if (file.sha256 && sha256File(source) !== file.sha256) {
      receipt.ok = false;
      receipt.error = `component source file hash mismatch: ${file.path}`;
      return receipt;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    receipt.copied.push(file.path);
  }
  for (const patch of plan.dataPatches) {
    const target = path.join(projectDir, patch.file);
    if (patch.kind === 'json-append') {
      const world = readJson(target);
      const room = (world.rooms || []).find((entry) => entry.id === patch.path.match(/rooms\[id=([^\]]+)\]/)?.[1]);
      const collection = patch.path.split('.').pop();
      if (!room) {
        receipt.ok = false;
        receipt.error = `room for patch not found: ${patch.path}`;
        return receipt;
      }
      room[collection] = room[collection] || [];
      room[collection].push(patch.entity);
      fs.writeFileSync(target, `${JSON.stringify(world, null, 2)}\n`);
      receipt.patched.push(patch.path);
    } else if (patch.kind === 'data-file') {
      const absolute = path.join(projectDir, patch.file);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, `${JSON.stringify(patch.entity, null, 2)}\n`);
      receipt.patched.push(patch.file);
    }
  }
  if (plan.sceneEdits.length > 0) receipt.requiresSceneEdit = true;
  receipt.componentFiles = component.files.map((file) => file.path);
  return receipt;
}
