// Managed draft install: turn an install plan into a complete, reviewable file
// set and apply it atomically.
//
// The round-two audit found that component installation wrote file by file, so
// a failure halfway left a partially installed world, existing files were never
// hashed before being overwritten, and the plan was never turned into the full
// managed set (source, scene, asset lock, script UID, input actions and entity
// map). This module closes that gap:
//
//   planDraftInstall  - pure preflight. Verifies the payload against the plan's
//                       canonical lock, derives every target path, detects
//                       conflicts (existing file with a different hash, case
//                       collision, path escape, missing script UID, global
//                       class clash, stale HEAD, operation replay) and returns
//                       the complete file set. It writes nothing.
//   applyDraftInstall - all-or-nothing apply. Snapshots every target, stages
//                       the whole set, and restores the previous bytes if any
//                       step fails, is cancelled or hits a disk/lock error. A
//                       repeated operation is idempotent; the same operation id
//                       with different content is refused.
//   recoverDraftInstall - roll back an interrupted apply from the journal.
//
// The result is a draft inside the world project. Committing it to a formal
// revision is S1's content transaction; this module never touches Git and never
// writes a running world.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {
  ASSET_LOCK_FILE,
  ASSET_LOCK_FORMAT,
  assetLockHash,
  canonicalLockText,
  validateAssetLock,
  // The single JavaScript implementation of the canonical lock lives next to
  // the package format it belongs to; the host imports it rather than keeping a
  // second copy.
} from '../../../plugins/craftmine-world/asset-lock.mjs';
import {applyInputActions, applySceneInsertion, planInputActions} from './scene_materializer.mjs';

export const DRAFT_INSTALL_FORMAT = 'craftmine.godot-draft-install/1';
export const DRAFT_JOURNAL_FILE = path.join('.craftmine', 'draft-operations.json');
export const DRAFT_INSTANCES_FILE = path.join('.craftmine', 'instances.json');
export const INSTANCES_FORMAT = 'craftmine.godot-draft-instances/1';

const STAGE_PREFIX = '.craftmine-stage-';

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function isBuffer(value) {
  return Buffer.isBuffer(value) || value instanceof Uint8Array;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function stableJSON(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Every path a payload file can produce, resolved and checked. */
function targetPath(projectDir, installPath, filePath) {
  const relative = `${installPath}/${filePath}`;
  if (relative.startsWith('/') || relative.includes('\\') || relative.split('/').includes('..')) {
    throw fail(`DRAFT_PATH_ESCAPE: ${relative}`);
  }
  const absolute = path.resolve(projectDir, relative);
  const root = path.resolve(projectDir);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw fail(`DRAFT_PATH_ESCAPE: ${relative}`);
  }
  return {relative, absolute};
}

/** Existing global class names, from project.godot and from the project's scripts. */
function existingGlobalClasses(projectDir) {
  const classes = new Set();
  const projectFile = path.join(projectDir, 'project.godot');
  if (fs.existsSync(projectFile)) {
    const text = fs.readFileSync(projectFile, 'utf8');
    for (const match of text.matchAll(/"class"\s*:\s*&?"([A-Za-z_][A-Za-z0-9_]*)"/g)) {
      classes.add(match[1]);
    }
  }
  const stack = [projectDir];
  let visited = 0;
  while (stack.length > 0 && visited < 20000) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      if (entry.name === '.git' || entry.name === '.craftmine') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      visited += 1;
      if (!entry.name.endsWith('.gd')) continue;
      const match = /^\s*class_name\s+([A-Za-z_][A-Za-z0-9_]*)/m.exec(fs.readFileSync(full, 'utf8'));
      if (match) classes.add(match[1]);
    }
  }
  return classes;
}

function declaredClass(text) {
  const match = /^\s*class_name\s+([A-Za-z_][A-Za-z0-9_]*)/m.exec(text);
  return match ? match[1] : null;
}

/**
 * Build the complete managed draft file set for an install plan.
 *
 * `payload` is `[{contentHash, path, bytes}]`: the package's resource payload,
 * already unpacked by the ZIP layer. `sceneEdits` are the materialized scene
 * insertions (from `components.mjs`) and `inputActions` the actions components
 * declare.
 */
export function planDraftInstall({
  plan,
  payload = [],
  projectDir,
  sceneEdits = [],
  inputActions = [],
  expectedHead = null,
  currentHead = null,
} = {}) {
  const conflicts = [];
  if (!plan || plan.applied !== false) throw fail('DRAFT_PLAN_REQUIRED');
  if (plan.ok !== true) throw fail('DRAFT_PLAN_HAS_CONFLICTS');
  const lock = validateAssetLock(plan.lock);
  if (expectedHead !== null && currentHead !== null && expectedHead !== currentHead) {
    return {ok: false, operationId: plan.operationId, conflicts: [{code: 'DRAFT_STALE_HEAD',
      detail: `plan was built for ${expectedHead} but the world is at ${currentHead}`}], files: []};
  }

  // Payload index: contentHash -> path -> bytes.
  const byHash = new Map();
  for (const file of payload) {
    if (!isBuffer(file.bytes)) throw fail('DRAFT_PAYLOAD_BYTES_REQUIRED');
    const key = `${file.contentHash}\u0000${file.path}`;
    if (byHash.has(key)) throw fail(`DRAFT_DUPLICATE_PAYLOAD: ${file.path}`);
    byHash.set(key, Buffer.from(file.bytes));
  }

  const instances = new Map(plan.instances.map((instance) => [instance.instanceId, instance]));
  const lockByAsset = new Map(lock.assets.map((entry) => [`${entry.asset.assetId}@${entry.asset.version}`, entry]));
  const files = [];
  const seen = new Map();
  const classes = existingGlobalClasses(projectDir);
  const newClasses = new Map();

  for (const instance of plan.instances) {
    const entry = lockByAsset.get(`${instance.assetId}@${instance.version}`);
    if (!entry) {
      conflicts.push({code: 'DRAFT_LOCK_ENTRY_MISSING', detail: `${instance.assetId}@${instance.version} is not in the plan lock`});
      continue;
    }
    if (entry.asset.contentHash !== instance.contentHash) {
      conflicts.push({code: 'DRAFT_LOCK_HASH_MISMATCH', detail: `${instance.assetId}@${instance.version}`});
      continue;
    }
    for (const ref of entry.files) {
      const key = `${entry.asset.contentHash}\u0000${ref.path}`;
      if (!byHash.has(key)) {
        conflicts.push({code: 'DRAFT_PAYLOAD_MISSING', detail: `${instance.assetId}@${instance.version} ${ref.path}`});
        continue;
      }
      const bytes = byHash.get(key);
      const digest = sha256(bytes);
      if (digest !== ref.sha256) {
        conflicts.push({code: 'DRAFT_PAYLOAD_HASH_MISMATCH', detail: `${ref.path}: ${digest}`});
        continue;
      }
      if (bytes.byteLength !== ref.bytes) {
        conflicts.push({code: 'DRAFT_PAYLOAD_SIZE_MISMATCH', detail: `${ref.path}: ${bytes.byteLength} != ${ref.bytes}`});
        continue;
      }
      const {relative, absolute} = targetPath(projectDir, entry.installPath, ref.path);
      const lower = relative.toLowerCase();
      if (seen.has(lower) && seen.get(lower) !== relative) {
        conflicts.push({code: 'DRAFT_PATH_COLLISION', detail: `${relative} vs ${seen.get(lower)}`});
        continue;
      }
      seen.set(lower, relative);
      // Scripts must carry their Godot UID so references survive moves.
      if (relative.endsWith('.gd')) {
        const uidKey = `${entry.asset.contentHash}\u0000${ref.path}.uid`;
        if (!byHash.has(uidKey)) {
          conflicts.push({code: 'DRAFT_MISSING_SCRIPT_UID', detail: relative});
          continue;
        }
        const name = declaredClass(bytes.toString('utf8'));
        if (name) {
          if (classes.has(name)) {
            conflicts.push({code: 'DRAFT_SCRIPT_CLASS_CONFLICT', detail: `${name} already exists in the world`});
            continue;
          }
          if (newClasses.has(name)) {
            conflicts.push({code: 'DRAFT_SCRIPT_CLASS_CONFLICT', detail: `${name} declared twice in the package`});
            continue;
          }
          newClasses.set(name, relative);
        }
      }
      files.push({
        kind: 'payload',
        path: relative,
        absolute,
        bytes,
        sha256: digest,
        assetId: entry.asset.assetId,
        version: entry.asset.version,
        instanceId: instance.instanceId,
      });
    }
  }

  // The lock, the instance/entity map and the UID files are part of the managed
  // set, not side effects of the caller.
  const lockText = canonicalLockText(lock);
  files.push({kind: 'lock', path: ASSET_LOCK_FILE, absolute: path.join(projectDir, ASSET_LOCK_FILE),
    bytes: Buffer.from(lockText, 'utf8'), sha256: sha256(Buffer.from(lockText, 'utf8'))});
  const instancesText = stableJSON({
    format: INSTANCES_FORMAT,
    operationId: plan.operationId,
    worldId: plan.worldId,
    assetLockHash: assetLockHash(lock),
    instances: plan.instances.map((instance) => ({
      instanceId: instance.instanceId,
      assetId: instance.assetId,
      version: instance.version,
      contentHash: instance.contentHash,
      installPath: instance.installPath,
      entityMap: instance.entityMap,
      localOverrides: instance.localOverrides ?? [],
    })),
  });
  files.push({kind: 'instances', path: DRAFT_INSTANCES_FILE, absolute: path.join(projectDir, DRAFT_INSTANCES_FILE),
    bytes: Buffer.from(instancesText, 'utf8'), sha256: sha256(Buffer.from(instancesText, 'utf8'))});

  // Scene edits are applied to the scene's current text and stored as the new
  // scene content, so the whole draft is one atomic set.
  for (const edit of sceneEdits) {
    const absolute = path.join(projectDir, edit.scene);
    if (!fs.existsSync(absolute)) {
      conflicts.push({code: 'DRAFT_SCENE_MISSING', detail: edit.scene});
      continue;
    }
    const current = fs.readFileSync(absolute, 'utf8');
    let next;
    try {
      next = applySceneInsertion(current, edit, {uid: edit.uid ?? null});
    } catch (error) {
      conflicts.push({code: 'DRAFT_SCENE_EDIT_REFUSED', detail: `${edit.scene}: ${error.message}`});
      continue;
    }
    files.push({kind: 'scene', path: edit.scene, absolute,
      bytes: Buffer.from(next, 'utf8'), sha256: sha256(Buffer.from(next, 'utf8')), node: edit.nodeName});
  }

  if (inputActions.length > 0) {
    const projectFile = path.join(projectDir, 'project.godot');
    if (fs.existsSync(projectFile)) {
      const current = fs.readFileSync(projectFile, 'utf8');
      const edit = planInputActions(current, inputActions);
      if (edit.edit) {
        const next = applyInputActions(current, edit.edit);
        files.push({kind: 'input-actions', path: 'project.godot', absolute: projectFile,
          bytes: Buffer.from(next, 'utf8'), sha256: sha256(Buffer.from(next, 'utf8'))});
      }
    }
  }

  // Existing payload files: identical content is a no-op, a different hash is a
  // conflict unless the plan's overrides own that path. The draft's own
  // records (lock, instance map, scene edits, input actions) are derived from
  // the current project and are always rewritten.
  const overrides = new Set();
  for (const entry of lock.assets) {
    for (const override of entry.overrides) {
      overrides.add(`${entry.installPath}/${override.path}`);
    }
  }
  const writable = [];
  for (const file of files) {
    if (file.kind === 'payload' && fs.existsSync(file.absolute)) {
      const current = fs.readFileSync(file.absolute);
      if (sha256(current) === file.sha256) {
        file.unchanged = true;
        writable.push(file);
        continue;
      }
      if (!overrides.has(file.path)) {
        conflicts.push({code: 'DRAFT_FILE_CONFLICT',
          detail: `${file.path} already exists with a different hash`});
        continue;
      }
      file.overridden = true;
    }
    writable.push(file);
  }
  writable.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));

  const fileSetHash = sha256(Buffer.from(writable
    .map((file) => `${file.path}\u0000${file.sha256}`)
    .join('\n'), 'utf8'));
  return {
    ok: conflicts.length === 0,
    format: DRAFT_INSTALL_FORMAT,
    operationId: plan.operationId,
    worldId: plan.worldId,
    assetLockHash: assetLockHash(lock),
    fileSetHash,
    conflicts,
    files: writable,
    classes: [...newClasses.keys()].sort(),
    instances: plan.instances.map((instance) => instance.instanceId),
  };
}

function journalPath(projectDir) {
  return path.join(projectDir, DRAFT_JOURNAL_FILE);
}

function readJournal(projectDir) {
  return readJson(journalPath(projectDir)) ?? {format: DRAFT_INSTALL_FORMAT, operations: {}};
}

function writeJournal(projectDir, journal) {
  const file = journalPath(projectDir);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, stableJSON(journal));
}

/**
 * Apply a planned draft file set atomically.
 *
 * The whole set is staged inside the project first; only then are targets
 * replaced, and the previous bytes of every replaced target are kept until the
 * last write succeeds. Any failure, cancellation or stale head restores every
 * target and removes every file this call created.
 */
export function applyDraftInstall({
  plan,
  payload = [],
  projectDir,
  sceneEdits = [],
  inputActions = [],
  expectedHead = null,
  currentHead = null,
  shouldCancel = null,
} = {}) {
  const planned = planDraftInstall({plan, payload, projectDir, sceneEdits, inputActions, expectedHead, currentHead});
  if (!planned.ok) return {ok: false, operationId: planned.operationId, conflicts: planned.conflicts,
    applied: false, fileSetHash: planned.fileSetHash};

  const journal = readJournal(projectDir);
  const previous = journal.operations[planned.operationId];
  if (previous) {
    if (previous.fileSetHash === planned.fileSetHash && previous.status === 'applied') {
      return {ok: true, operationId: planned.operationId, applied: false, alreadyApplied: true,
        fileSetHash: planned.fileSetHash, conflicts: []};
    }
    return {ok: false, operationId: planned.operationId, applied: false, conflicts: [{code: 'OPERATION_CONFLICT',
      detail: 'this operation id was already used with different content'}], fileSetHash: planned.fileSetHash};
  }

  const stage = path.join(projectDir, `${STAGE_PREFIX}${planned.fileSetHash.slice(0, 16)}`);
  const snapshot = new Map();
  const created = [];
  const replaced = [];
  let staged = false;
  try {
    fs.mkdirSync(stage, {recursive: false});
    staged = true;
    for (const file of planned.files) {
      const stagedFile = path.join(stage, file.sha256);
      fs.writeFileSync(stagedFile, file.bytes);
      if (sha256(fs.readFileSync(stagedFile)) !== file.sha256) throw fail(`DRAFT_STAGE_MISMATCH: ${file.path}`);
    }
    // Journal the intent before touching any target so a crash is recoverable.
    journal.operations[planned.operationId] = {
      status: 'applying', fileSetHash: planned.fileSetHash,
      files: planned.files.map((file) => ({path: file.path, sha256: file.sha256, kind: file.kind})),
    };
    writeJournal(projectDir, journal);

    for (const file of planned.files) {
      if (typeof shouldCancel === 'function' && shouldCancel()) throw fail('DRAFT_CANCELLED');
      if (file.unchanged) continue;
      const existed = fs.existsSync(file.absolute);
      if (existed) {
        snapshot.set(file.absolute, fs.readFileSync(file.absolute));
        replaced.push(file.path);
      } else {
        created.push(file.absolute);
      }
      fs.mkdirSync(path.dirname(file.absolute), {recursive: true});
      fs.renameSync(path.join(stage, file.sha256), file.absolute);
    }
    journal.operations[planned.operationId] = {
      status: 'applied', fileSetHash: planned.fileSetHash,
      files: planned.files.map((file) => ({path: file.path, sha256: file.sha256, kind: file.kind})),
    };
    writeJournal(projectDir, journal);
    return {
      ok: true, applied: true, operationId: planned.operationId, fileSetHash: planned.fileSetHash,
      assetLockHash: planned.assetLockHash, conflicts: [],
      created, replaced,
      unchanged: planned.files.filter((file) => file.unchanged).map((file) => file.path),
      instances: planned.instances, classes: planned.classes,
      lockPath: ASSET_LOCK_FILE,
    };
  } catch (error) {
    for (const [file, bytes] of snapshot) fs.writeFileSync(file, bytes);
    for (const file of created) if (fs.existsSync(file)) fs.rmSync(file);
    delete journal.operations[planned.operationId];
    try {
      writeJournal(projectDir, journal);
    } catch {
      // The rollback already restored the world; the journal is best effort.
    }
    return {ok: false, applied: false, operationId: planned.operationId, fileSetHash: planned.fileSetHash,
      conflicts: [{code: error.code ?? 'DRAFT_APPLY_FAILED', detail: error.message}], restored: true};
  } finally {
    if (staged && fs.existsSync(stage)) fs.rmSync(stage, {recursive: true, force: true});
  }
}

/**
 * Roll back an apply that was interrupted after the journal recorded `applying`
 * but before it recorded `applied`. Unknown operation ids are refused.
 */
export function recoverDraftInstall({projectDir, operationId} = {}) {
  const journal = readJournal(projectDir);
  const record = journal.operations[operationId];
  if (!record) throw fail(`DRAFT_UNKNOWN_OPERATION: ${operationId}`);
  if (record.status !== 'applying') return {ok: true, operationId, recovered: false, status: record.status};
  const removed = [];
  for (const file of record.files) {
    const absolute = path.join(projectDir, file.path);
    if (!fs.existsSync(absolute)) continue;
    if (sha256(fs.readFileSync(absolute)) !== file.sha256) continue;
    fs.rmSync(absolute);
    removed.push(file.path);
  }
  delete journal.operations[operationId];
  writeJournal(projectDir, journal);
  return {ok: true, operationId, recovered: true, removed};
}

export {ASSET_LOCK_FILE, ASSET_LOCK_FORMAT};
