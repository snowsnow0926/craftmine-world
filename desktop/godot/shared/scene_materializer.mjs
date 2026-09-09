// Scene component materializer.
//
// The component library can copy files and patch data files, but until now a
// "scene-node" component (a door, an interactable, a target dummy, a spawn
// marker) was only returned as a manual step: the library never rewrote a
// `.tscn`. That meant R4 could package such a component but never install it.
//
// This module performs the missing half: it inserts a component node into an
// existing scene deterministically and verifiably.
//
//   - the insertion is planned first (`planSceneInsertion`) and can be reviewed;
//   - the plan refuses duplicates: a node name or an identity value that already
//     exists in the target scene is an error, never a silent second instance;
//   - applying it (`applySceneInsertion`) only appends text. Existing
//     ext_resources, nodes and their order are never rewritten, so a scene with
//     author edits keeps them;
//   - ext_resources are added with a deterministic id and, when the script has a
//     sibling `.gd.uid`, with its real `uid://` so the reference survives moves;
//   - input actions a component needs are added to `project.godot` in a separate
//     step (`planInputActions` / `applyInputActions`), because a scene cannot
//     declare them itself.
//
// The result is validated by the real engine (see
// tests/godot-round2/R3/scene-install.mjs), not by string comparison alone.

import fs from 'node:fs';
import path from 'node:path';

export const SCENE_EDIT_FORMAT = 'craftmine.godot-scene-edit/1';
export const INPUT_EDIT_FORMAT = 'craftmine.godot-input-edit/1';

const NODE_HEADER = /^\[node name="([^"]+)"((?:[^\]]|\\])*)\]/;
const EXT_HEADER = /^\[ext_resource type="([^"]+)"(?: uid="([^"]+)")? path="([^"]+)" id="([^"]+)"\]/;

/** Split a .tscn into its header, ext_resource lines and node blocks. */
export function parseScene(text) {
  const lines = text.split('\n');
  const header = [];
  const extResources = [];
  const nodes = [];
  let current = null;
  for (const line of lines) {
    const ext = EXT_HEADER.exec(line);
    if (ext) {
      extResources.push({ type: ext[1], uid: ext[2] || null, path: ext[3], id: ext[4], raw: line });
      current = null;
      continue;
    }
    const node = NODE_HEADER.exec(line);
    if (node) {
      current = { name: node[1], header: line, attributes: node[2], properties: {}, lines: [line] };
      nodes.push(current);
      continue;
    }
    if (current) current.lines.push(line);
    else header.push(line);
  }
  for (const node of nodes) {
    for (const line of node.lines.slice(1)) {
      const property = /^([A-Za-z_][A-Za-z0-9_/]*)\s*=\s*(.*)$/.exec(line);
      if (property) node.properties[property[1]] = property[2].trim();
    }
  }
  return { header, extResources, nodes, text };
}

function sceneLineEnding(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function allocateExtId(parsed) {
  let max = 0;
  for (const resource of parsed.extResources) {
    const match = /^(\d+)/.exec(resource.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return String(max + 1);
}

function sanitizeNodeName(entityId) {
  // Godot node names may not contain '/' or start with a digit after trimming.
  const cleaned = String(entityId).replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^_+/, '');
  return cleaned.length > 0 ? cleaned : 'Component';
}

function identityValue(kind, value) {
  const text = String(value);
  return kind === 'stringname' ? `&"${text}"` : `"${text}"`;
}

function numericProperty(value) {
  return typeof value === 'number' ? String(value) : String(value);
}

/** Render a value as a GDScript literal. Plain strings are quoted. */
function gdLiteral(value) {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === null || value === undefined) return 'null';
  const text = String(value);
  if (/^&?".*"$/.test(text)) return text;                       // already a String/StringName literal
  if (/^(Vector[234]|Transform3D|Rect2|Color|NodePath)\(/.test(text)) return text;
  if (text === 'true' || text === 'false' || /^-?\d+(\.\d+)?$/.test(text)) return text;
  return JSON.stringify(text);
}

/**
 * Plan the insertion of one component node into one scene.
 *
 * `spec` is the component's `install` block:
 *   { mode: 'instance'|'script-node', scene, parent, nodeType, script, sceneFile,
 *     identityField, identityType, groups, exports, inputActions }
 */
export function planSceneInsertion({ sceneText, scenePath, spec, entityId, placement = {}, overrides = {} }) {
  if (!spec || !['instance', 'script-node'].includes(spec.mode)) {
    return { ok: false, reason: 'component-declares-no-scene-install', detail: 'the component has no install.mode' };
  }
  const parsed = parseScene(sceneText);
  const nodeName = sanitizeNodeName(entityId);
  const parent = spec.parent || '.';
  const siblings = parsed.nodes.filter((node) => (node.properties.parent || '.') === parent);
  if (siblings.some((node) => node.name === nodeName)) {
    return { ok: false, reason: 'node-name-taken', detail: `${parent} already has a node named ${nodeName}` };
  }
  const identityField = spec.identityField;
  if (!identityField) return { ok: false, reason: 'component-declares-no-identity', detail: 'install.identityField is required' };
  const wanted = identityValue(spec.identityType || 'string', entityId);
  for (const node of parsed.nodes) {
    const value = node.properties[identityField];
    if (value === undefined) continue;
    if (value === wanted || value === `"${entityId}"` || value === `&"${entityId}"`) {
      return { ok: false, reason: 'identity-taken', detail: `${identityField} = ${entityId} already exists in ${scenePath}` };
    }
  }
  const extId = allocateExtId(parsed);
  const extResource = spec.mode === 'instance'
    ? { type: 'PackedScene', path: spec.sceneFile, id: `${extId}_${sanitizeNodeName(spec.sceneFile.split('/').pop().replace(/\.tscn$/, ''))}` }
    : { type: 'Script', path: spec.script, id: `${extId}_${sanitizeNodeName(spec.script.split('/').pop().replace(/\.gd$/, ''))}` };
  const properties = {};
  properties[identityField] = wanted;
  for (const [key, value] of Object.entries(spec.exports || {})) {
    if (placement[key] !== undefined) properties[key] = gdLiteral(placement[key]);
    else if (overrides[key] !== undefined) properties[key] = gdLiteral(overrides[key]);
    else if (value !== undefined && value !== null) properties[key] = gdLiteral(value);
  }
  for (const [key, value] of Object.entries(placement)) {
    if (key === 'parent' || properties[key] !== undefined) continue;
    properties[key] = gdLiteral(value);
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (key === 'parent') continue;
    properties[key] = gdLiteral(value);
  }
  return {
    ok: true,
    edit: {
      format: SCENE_EDIT_FORMAT,
      scene: scenePath,
      parent,
      nodeName,
      mode: spec.mode,
      nodeType: spec.nodeType || 'Node2D',
      extResource,
      properties,
      groups: spec.groups ? [...spec.groups] : [],
      inputActions: spec.inputActions ? [...spec.inputActions] : [],
    },
  };
}

/** Render the node block for a planned edit. Godot expects type before parent. */
export function renderNodeBlock(edit) {
  const lines = [];
  const attributes = [];
  if (edit.mode === 'script-node') attributes.push(`type="${edit.nodeType}"`);
  attributes.push(`parent="${edit.parent}"`);
  if (edit.mode === 'instance') attributes.push(`instance=ExtResource("${edit.extResource.id}")`);
  lines.push(`[node name="${edit.nodeName}" ${attributes.join(' ')}]`);
  if (edit.mode === 'script-node') lines.push(`script = ExtResource("${edit.extResource.id}")`);
  for (const [key, value] of Object.entries(edit.properties)) lines.push(`${key} = ${value}`);
  if (edit.groups.length > 0) lines.push(`groups = [${edit.groups.map((group) => `"${group}"`).join(', ')}]`);
  return lines;
}

function renderExtResource(resource) {
  const uid = resource.uid ? ` uid="${resource.uid}"` : '';
  return `[ext_resource type="${resource.type}"${uid} path="res://${resource.path.replace(/^res:\/\//, '')}" id="${resource.id}"]`;
}

/** Read the `uid://` of a script next to it, when Godot generated one. */
export function scriptUid(projectDir, scriptPath) {
  const uidFile = path.join(projectDir, `${scriptPath}.uid`);
  if (!fs.existsSync(uidFile)) return null;
  const text = fs.readFileSync(uidFile, 'utf8').trim();
  return /^uid:\/\/[A-Za-z0-9]+$/.test(text) ? text : null;
}

/**
 * Apply a planned insertion to scene text. Only appends: the existing header,
 * ext_resources and nodes are preserved byte for byte.
 */
export function applySceneInsertion(sceneText, edit, { uid = null } = {}) {
  const eol = sceneLineEnding(sceneText);
  const parsed = parseScene(sceneText);
  const nodeName = edit.nodeName;
  if (parsed.nodes.some((node) => node.name === nodeName)) {
    throw new Error(`scene already contains a node named ${nodeName}`);
  }
  const resource = { ...edit.extResource, uid };
  const extLine = renderExtResource(resource);
  // Insert the new ext_resource after the last existing one, or after the scene
  // header when the scene has none.
  const lines = sceneText.split('\n');
  let insertExtAt = 1;
  for (let index = 0; index < lines.length; index += 1) {
    if (EXT_HEADER.test(lines[index])) insertExtAt = index + 1;
  }
  lines.splice(insertExtAt, 0, extLine);
  const block = renderNodeBlock(edit);
  const text = lines.join('\n');
  const needsBlank = !text.endsWith('\n\n');
  return `${text}${needsBlank ? '\n' : ''}${block.join('\n')}\n`;
}

/** Input actions a component needs, as `[input]` entries for project.godot. */
export function planInputActions(projectText, actions) {
  if (!actions || actions.length === 0) return { ok: true, edit: null, missing: [] };
  const present = new Set();
  const inputSection = /\[input\]\n([\s\S]*?)(\n\[|$)/.exec(projectText);
  if (inputSection) {
    for (const line of inputSection[1].split('\n')) {
      const name = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line);
      if (name) present.add(name[1]);
    }
  }
  const missing = actions.filter((action) => !present.has(action));
  if (missing.length === 0) return { ok: true, edit: null, missing: [] };
  const edit = {
    format: INPUT_EDIT_FORMAT,
    actions: missing.map((name) => ({
      name,
      body: `${name}={\n"deadzone": 0.2,\n"events": []\n}`,
    })),
  };
  return { ok: true, edit, missing };
}

/** Add the missing `[input]` entries. Never rewrites an existing action. */
export function applyInputActions(projectText, edit) {
  if (!edit || edit.actions.length === 0) return projectText;
  const eol = sceneLineEnding(projectText);
  const block = edit.actions.map((action) => action.body.replace(/\n/g, eol)).join(`${eol}`);
  if (projectText.includes('[input]')) {
    return projectText.replace('[input]', `[input]${eol}${block}`);
  }
  return `${projectText}${projectText.endsWith(eol) ? '' : eol}${eol}[input]${eol}${block}${eol}`;
}
