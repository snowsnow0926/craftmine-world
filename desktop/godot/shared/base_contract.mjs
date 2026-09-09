// Versioned engine/base/asset/state contract for the authored Godot bases.
//
// The three bases were authored at different times and used different manifest
// shapes (`craftmine.godot-base-manifest/1` for first-person and
// `craftmine.godot-base/1` for top-down/side-view). This module normalizes them
// into one contract so the product can create, version, package and verify a
// world without knowing which base authored it, and so a missing template,
// asset or state declaration fails loudly instead of silently.
//
// It is a pure library: no engine process, no writes. `build-base-catalog.mjs`
// uses it to generate the creation manifest consumed by the UI task (E) and the
// packaging task (H).

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const BASE_CONTRACT_FORMAT = 'craftmine.godot-base-contract/1';
export const COMPONENT_CATALOG_FORMAT = 'craftmine.godot-component-catalog/1';
export const BASE_CATALOG_FORMAT = 'craftmine.godot-base-catalog/1';

/** Pinned engine contract. Kept in sync with desktop/godot/toolchain.lock.json. */
export const ENGINE_CONTRACT = Object.freeze({
  name: 'godot',
  version: '4.7.2-stable',
  language: 'GDScript',
  renderer: 'gl_compatibility',
});

export const TEMPLATE_KINDS = Object.freeze(['blank-start', 'example']);

export const REQUIRED_COMPONENT_FIELDS = Object.freeze([
  'id',
  'version',
  'kind',
  'compatibleBases',
  'identity',
  'persistentState',
  'initialState',
  'files',
]);

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function sha256File(file) {
  return sha256(fs.readFileSync(file));
}

/** True when a relative path stays inside its root (no `..`, no absolute, no drive). */
export function isSafeRelativePath(relative) {
  if (typeof relative !== 'string' || relative.length === 0) return false;
  if (relative.includes('\\')) return false;
  if (path.posix.isAbsolute(relative)) return false;
  const normalized = path.posix.normalize(relative);
  if (normalized === '.' || normalized.startsWith('../') || normalized === '..') return false;
  if (/^[a-zA-Z]:/.test(relative)) return false;
  return true;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function issue(code, where, message) {
  return { code, where, message };
}

/**
 * Normalize a raw base manifest into the common contract view.
 * Missing declarations stay `null` so `validateBaseContract` can report them.
 */
export function normalizeBaseManifest(manifest) {
  const engine = manifest.engine || {
    name: 'godot',
    version: manifest.godotVersion,
    scriptLanguage: manifest.language,
    renderer: manifest.renderer,
  };
  const protocols = {
    world: manifest.protocols?.worldFormat ?? manifest.protocols?.world ?? null,
    state: manifest.protocols?.stateFormat ?? manifest.stateFormat?.id ?? null,
    progress: manifest.protocols?.progressFormat ?? null,
    probe: manifest.protocols?.probeFormat ?? null,
    params: manifest.protocols?.paramsFormat ?? null,
    baseProtocolVersion: manifest.protocols?.baseProtocolVersion ?? null,
  };
  const state = manifest.contract?.state || manifest.stateFormat || null;
  const templates = [];
  if (Array.isArray(manifest.templates)) {
    for (const template of manifest.templates) templates.push({ ...template });
  } else if (manifest.entryScenes) {
    // first-person style: {blank: "res://...", example: "res://..."}
    templates.push({
      id: 'blank',
      kind: 'blank-start',
      entryScene: manifest.entryScenes.blank,
      description: 'Blank start',
      source: manifest.entryScenes.blank,
    });
    templates.push({
      id: 'training-range',
      kind: 'example',
      entryScene: manifest.entryScenes.example,
      description: 'Training range example',
      source: manifest.entryScenes.example,
    });
  } else if (manifest.worlds && typeof manifest.worlds === 'object') {
    for (const [id, world] of Object.entries(manifest.worlds)) {
      templates.push({
        id,
        kind: world.kind === 'example' ? 'example' : 'blank-start',
        entryScene: world.entryScene,
        description: world.description || '',
        source: world.directory,
      });
    }
  }
  return {
    format: manifest.contract?.format || BASE_CONTRACT_FORMAT,
    baseId: manifest.baseId,
    baseVersion: manifest.baseVersion,
    title: manifest.title || manifest.baseId,
    engine: {
      name: engine.name,
      version: engine.version,
      language: engine.language || engine.scriptLanguage || ENGINE_CONTRACT.language,
      renderer: engine.renderer,
      targets: engine.targetPlatforms || manifest.targetPlatforms || [],
    },
    protocols,
    state: state
      ? {
          format: state.format || state.id,
          version: state.version,
          preserved: state.preserved || [],
          migrations: state.migrations || [],
        }
      : null,
    assets: manifest.contract?.assets || manifest.assets || null,
    templates,
    components: Array.isArray(manifest.components) ? manifest.components : [],
    tools: manifest.tools || {},
    acceptance: manifest.acceptance || {},
    raw: manifest,
  };
}

/** Structural validation. Returns { ok, issues } and never throws on bad input. */
export function validateBaseContract(manifest, { baseDir = null } = {}) {
  const issues = [];
  if (manifest === null || typeof manifest !== 'object') {
    return { ok: false, issues: [issue('manifest-not-object', 'manifest', 'manifest must be an object')] };
  }
  const contract = normalizeBaseManifest(manifest);
  const where = `base:${contract.baseId ?? '?'}`;

  if (!isNonEmptyString(contract.baseId)) issues.push(issue('missing-base-id', where, 'baseId is required'));
  if (!isNonEmptyString(contract.baseVersion)) issues.push(issue('missing-base-version', where, 'baseVersion is required'));
  if (contract.format !== BASE_CONTRACT_FORMAT) {
    issues.push(issue('contract-format', where, `contract.format must be ${BASE_CONTRACT_FORMAT}`));
  }
  if (contract.engine.name !== ENGINE_CONTRACT.name) {
    issues.push(issue('engine-name', where, `engine name must be ${ENGINE_CONTRACT.name}`));
  }
  if (contract.engine.version !== ENGINE_CONTRACT.version) {
    issues.push(issue('engine-version', where, `engine version must be pinned to ${ENGINE_CONTRACT.version}`));
  }
  if (contract.engine.renderer !== ENGINE_CONTRACT.renderer) {
    issues.push(issue('engine-renderer', where, `renderer must be ${ENGINE_CONTRACT.renderer}`));
  }
  if (!isNonEmptyString(contract.protocols.world)) issues.push(issue('protocol-world', where, 'protocols.worldFormat is required'));
  if (!isNonEmptyString(contract.protocols.state)) issues.push(issue('protocol-state', where, 'protocols.stateFormat is required'));
  if (!Number.isInteger(contract.protocols.baseProtocolVersion) || contract.protocols.baseProtocolVersion < 1) {
    issues.push(issue('protocol-version', where, 'protocols.baseProtocolVersion must be a positive integer'));
  }
  if (!contract.state) {
    issues.push(issue('missing-state-contract', where, 'state contract is required'));
  } else {
    if (contract.state.format !== contract.protocols.state) {
      issues.push(issue('state-format-mismatch', where, 'state.format must equal protocols.stateFormat'));
    }
    if (!Number.isInteger(contract.state.version) || contract.state.version < 1) {
      issues.push(issue('state-version', where, 'state.version must be a positive integer'));
    }
    if (!Array.isArray(contract.state.preserved) || contract.state.preserved.length === 0) {
      issues.push(issue('state-preserved', where, 'state.preserved must list the persisted fields'));
    }
    if (!Array.isArray(contract.state.migrations)) {
      issues.push(issue('state-migrations', where, 'state.migrations must be an array (may be empty)'));
    }
  }
  if (!contract.assets || !isNonEmptyString(contract.assets.manifest)) {
    issues.push(issue('missing-asset-manifest', where, 'assets.manifest is required'));
  }
  if (!contract.assets || !isNonEmptyString(contract.assets.license)) {
    issues.push(issue('missing-asset-license', where, 'assets.license is required'));
  }

  const templateIds = new Set();
  let blankCount = 0;
  for (const template of contract.templates) {
    const at = `${where}/template:${template.id ?? '?'}`;
    if (!isNonEmptyString(template.id)) issues.push(issue('template-id', at, 'template id is required'));
    else if (templateIds.has(template.id)) issues.push(issue('template-duplicate', at, 'template id is duplicated'));
    else templateIds.add(template.id);
    if (!TEMPLATE_KINDS.includes(template.kind)) {
      issues.push(issue('template-kind', at, `template kind must be one of ${TEMPLATE_KINDS.join(', ')}`));
    }
    if (template.kind === 'blank-start') blankCount += 1;
    if (!isNonEmptyString(template.entryScene) || !template.entryScene.startsWith('res://')) {
      issues.push(issue('template-entry-scene', at, 'entryScene must be a res:// path'));
    }
    if (!template.initialState || typeof template.initialState !== 'object') {
      issues.push(issue('template-initial-state', at, 'template.initialState must describe the starting progress'));
    }
  }
  if (contract.templates.length === 0) {
    issues.push(issue('missing-templates', where, 'at least one template is required'));
  } else if (blankCount !== 1) {
    issues.push(issue('blank-template-count', where, `exactly one blank-start template is required, found ${blankCount}`));
  }

  const componentIds = new Set();
  for (const component of contract.components) {
    const at = `${where}/component:${component.id ?? '?'}`;
    for (const field of REQUIRED_COMPONENT_FIELDS) {
      if (!(field in component)) issues.push(issue('component-field', at, `component.${field} is required`));
    }
    if (!isNonEmptyString(component.id)) issues.push(issue('component-id', at, 'component id is required'));
    else if (componentIds.has(component.id)) issues.push(issue('component-duplicate', at, 'component id is duplicated'));
    else componentIds.add(component.id);
    if (!Array.isArray(component.compatibleBases) || !component.compatibleBases.includes(contract.baseId)) {
      issues.push(issue('component-bases', at, 'compatibleBases must include this base'));
    }
    if (!Array.isArray(component.files)) {
      issues.push(issue('component-files', at, 'component.files must be an array'));
      continue;
    }
    for (const file of component.files) {
      const rel = typeof file === 'string' ? file : file?.path;
      if (!isSafeRelativePath(rel)) {
        issues.push(issue('component-file-path', at, `unsafe component file path: ${String(rel)}`));
        continue;
      }
      if (baseDir && !fs.existsSync(path.join(baseDir, rel))) {
        issues.push(issue('component-file-missing', at, `component file does not exist: ${rel}`));
      }
    }
  }

  if (baseDir) {
    for (const [key, rel] of Object.entries({ manifest: contract.assets?.manifest, license: contract.assets?.license })) {
      if (isNonEmptyString(rel) && !fs.existsSync(path.join(baseDir, rel))) {
        issues.push(issue('asset-file-missing', where, `assets.${key} does not exist: ${rel}`));
      }
    }
  }

  return { ok: issues.length === 0, issues, contract };
}

/** Load and validate every base manifest under `desktop/godot/bases`. */
export function loadBaseContracts(basesDir) {
  const bases = [];
  const issues = [];
  if (!fs.existsSync(basesDir)) {
    return { bases, issues: [issue('bases-dir-missing', basesDir, 'bases directory does not exist')] };
  }
  const manifestNames = ['manifest.json', 'base_manifest.json'];
  for (const entry of fs.readdirSync(basesDir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(basesDir, entry.name);
    const manifestName = manifestNames.find((name) => fs.existsSync(path.join(dir, name)));
    if (!manifestName) continue;
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(dir, manifestName), 'utf8'));
    } catch (error) {
      issues.push(issue('manifest-json', dir, `${manifestName} is not valid JSON: ${error.message}`));
      continue;
    }
    const result = validateBaseContract(manifest, { baseDir: dir });
    issues.push(...result.issues);
    bases.push({ dir, manifestName, manifest, contract: result.contract, ok: result.ok });
  }
  return { bases, issues };
}

/**
 * Creation guard: a template may only ship starting progress.
 * A blank start must have no rewards, no completed quests and no claimed
 * pickups; an example may declare content but never a claimed reward.
 */
export function assertTemplateInitialState({ baseId, templateId, world }) {
  const issues = [];
  const at = `base:${baseId}/template:${templateId}`;
  const fail = (code, message) => issues.push(issue(code, at, message));
  const isBlank = templateId === 'blank' || world?.kind === 'blank-start';

  if (world && typeof world === 'object' && 'initialProgress' in world) {
    const initial = world.initialProgress || {};
    for (const quest of initial.quests || []) {
      if (quest.rewarded === true) fail('blank-claimed-reward', `quest ${quest.id} ships rewarded=true`);
      if (quest.status === 'completed') fail('blank-completed-quest', `quest ${quest.id} ships status=completed`);
    }
    if (initial.grantedRewards && Object.keys(initial.grantedRewards).length > 0) {
      fail('blank-reward-ledger', 'grantedRewards must start empty');
    }
    for (const item of initial.inventory || []) {
      if (Number(item.count) < 0) fail('blank-negative-inventory', `inventory ${item.id} is negative`);
    }
    if (initial.coins !== undefined && Number(initial.coins) < 0) fail('blank-negative-coins', 'coins must not start negative');
  }

  if (isBlank && world && Array.isArray(world.rooms)) {
    for (const room of world.rooms) {
      if ((room.targets || []).length > 0) fail('blank-targets', `room ${room.id} ships ${room.targets.length} target(s)`);
      if ((room.rewards || []).length > 0) fail('blank-rewards', `room ${room.id} ships ${room.rewards.length} reward(s)`);
      if ((room.abilities || []).length > 0) fail('blank-abilities', `room ${room.id} ships ${room.abilities.length} ability pickup(s)`);
    }
  }

  if (isBlank && world && Array.isArray(world.sceneNodes)) {
    for (const node of world.sceneNodes) {
      if (node.kind === 'target' || node.kind === 'pickup') fail('blank-scene-node', `blank start ships ${node.kind} ${node.id}`);
    }
  }
  return { ok: issues.length === 0, issues };
}

/** Stable digest of everything that defines a base version's content contract. */
export function baseContentHash(baseDir, contract) {
  const files = [];
  for (const component of contract.components) {
    for (const file of component.files) {
      const rel = typeof file === 'string' ? file : file.path;
      if (isSafeRelativePath(rel)) files.push(rel);
    }
  }
  for (const rel of [contract.assets?.manifest, contract.assets?.license].filter(isNonEmptyString)) files.push(rel);
  const unique = [...new Set(files)].sort();
  const hash = createHash('sha256');
  for (const rel of unique) {
    const absolute = path.join(baseDir, rel);
    hash.update(rel);
    hash.update('\0');
    hash.update(fs.existsSync(absolute) ? sha256File(absolute) : 'missing');
    hash.update('\0');
  }
  return { hash: hash.digest('hex'), files: unique };
}
