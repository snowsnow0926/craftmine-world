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
import {createHash, randomUUID} from 'node:crypto';
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
export const DRAFT_INSTANCES_FILE = 'craftmine.instances.json';
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
      if(entry.isSymbolicLink())throw fail('DRAFT_LINK_REFUSED');
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
  let lock = validateAssetLock(plan.lock);
  const oldLockPath=path.join(projectDir,ASSET_LOCK_FILE);
  if(fs.existsSync(oldLockPath)) {
    const old=validateAssetLock(JSON.parse(fs.readFileSync(oldLockPath,'utf8')));
    const entries=new Map(old.assets.map(e=>[e.asset.assetId,e]));
    for(const entry of lock.assets) {
      const prior=entries.get(entry.asset.assetId);
      if(prior && JSON.stringify(prior)!==JSON.stringify(entry)) throw fail('DRAFT_EXISTING_LOCK_CONFLICT');
      entries.set(entry.asset.assetId,entry);
    }
    lock=validateAssetLock({format:ASSET_LOCK_FORMAT,assets:[...entries.values()]});
  }
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
        if (!byHash.has(uidKey) || !entry.files.some(f=>f.path===ref.path+'.uid')) {
          conflicts.push({code: 'DRAFT_MISSING_SCRIPT_UID', detail: relative});
          continue;
        }
        const name = declaredClass(bytes.toString('utf8'));
        if (name) {
          if (classes.has(name) && !(fs.existsSync(absolute)&&sha256(fs.readFileSync(absolute))===digest)) {
            conflicts.push({code: 'DRAFT_SCRIPT_CLASS_CONFLICT', detail: `${name} already exists in the world`});
            continue;
          }
          if (newClasses.has(name) && newClasses.get(name)!==relative) {
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
  const oldInstancesPath=path.join(projectDir,DRAFT_INSTANCES_FILE);
  const oldInstances=fs.existsSync(oldInstancesPath)?JSON.parse(fs.readFileSync(oldInstancesPath,'utf8')):null;
  if(oldInstances && (oldInstances.format!==INSTANCES_FORMAT || oldInstances.worldId!==plan.worldId || !Array.isArray(oldInstances.instances))) throw fail('DRAFT_INSTANCE_MAP_INVALID');
  const mergedInstances=new Map((oldInstances?.instances??[]).map(i=>[i.instanceId,i]));
  for(const instance of plan.instances) {
    if(mergedInstances.has(instance.instanceId)) throw fail('DRAFT_INSTANCE_ID_CONFLICT');
    mergedInstances.set(instance.instanceId,{...instance,installPath:lockByAsset.get(instance.assetId+'@'+instance.version)?.installPath});
  }
  const instancesText = stableJSON({
    format: INSTANCES_FORMAT,
    operationId: plan.operationId,
    worldId: plan.worldId,
    assetLockHash: assetLockHash(lock),
    instances: [...mergedInstances.values()].map((instance) => ({
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
  const sceneFiles=new Map();
  for (const edit of sceneEdits) {
    const absolute = checkedTarget(projectDir,edit.scene);
    if (!fs.existsSync(absolute)) {
      conflicts.push({code: 'DRAFT_SCENE_MISSING', detail: edit.scene});
      continue;
    }
    const current = sceneFiles.get(edit.scene)?.bytes.toString('utf8') ?? fs.readFileSync(absolute, 'utf8');
    let next;
    try {
      next = applySceneInsertion(current, edit, {uid: edit.uid ?? null});
    } catch (error) {
      conflicts.push({code: 'DRAFT_SCENE_EDIT_REFUSED', detail: `${edit.scene}: ${error.message}`});
      continue;
    }
    sceneFiles.set(edit.scene,{kind: 'scene', path: edit.scene, absolute,
      bytes: Buffer.from(next, 'utf8'), sha256: sha256(Buffer.from(next, 'utf8')), node: edit.nodeName});
  }

  files.push(...sceneFiles.values());
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
  const unique=new Map();
  for(const file of writable) {
    checkedTarget(projectDir,file.path);
    const previous=unique.get(file.path.toLowerCase());
    if(previous && (previous.path!==file.path || previous.sha256!==file.sha256)) throw fail('DRAFT_TARGET_COLLISION');
    unique.set(file.path.toLowerCase(),file);
  }
  writable.splice(0,writable.length,...unique.values());
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


/** Only ordinary descendants of this private draft may be read or replaced. */
function checkedTarget(projectDir, relative) {
  if(typeof relative!=='string'||relative.includes('\\')||relative.split('/').some(p=>!p||p==='.'||p==='..'||/[<>:"|?*\x00-\x1f]/.test(p)||/[ .]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw fail('DRAFT_PATH_ESCAPE');
  const root=path.resolve(projectDir), absolute=path.resolve(root,relative);
  if(!absolute.startsWith(root+path.sep)) throw fail('DRAFT_PATH_ESCAPE');
  let current=root;
  for(const part of ['',...relative.split('/')]) {
    if(part)current=path.join(current,part);
    if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink()) throw fail('DRAFT_LINK_REFUSED');
  }
  return absolute;
}
function durableWrite(file,bytes) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temporary=file+'.tmp-'+randomUUID();
  const fd=fs.openSync(temporary,'wx');
  try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(temporary,file);
}
function readJournal(projectDir) {
  const file=checkedTarget(projectDir,DRAFT_JOURNAL_FILE.replaceAll('\\','/'));
  if(!fs.existsSync(file))return {format:DRAFT_INSTALL_FORMAT,operations:{}};
  const value=JSON.parse(fs.readFileSync(file,'utf8'));
  if(value.format!==DRAFT_INSTALL_FORMAT||!value.operations)throw fail('DRAFT_JOURNAL_CORRUPT');
  return value;
}
function writeJournal(projectDir,journal) {
  durableWrite(checkedTarget(projectDir,DRAFT_JOURNAL_FILE.replaceAll('\\','/')),stableJSON(journal));
}
function requestHash(args) {
  return sha256(Buffer.from(JSON.stringify({plan:args.plan,payload:(args.payload??[]).map(f=>({contentHash:f.contentHash,path:f.path,sha256:sha256(f.bytes)})),sceneEdits:args.sceneEdits??[],inputActions:args.inputActions??[],expectedHead:args.expectedHead??null})));
}
function removeStage(projectDir,stageName) {
  if(!/^\.craftmine-stage-[a-f0-9-]{36}$/.test(stageName))throw fail('DRAFT_STAGE_INVALID');
  const stage=checkedTarget(projectDir,stageName);
  if(!fs.existsSync(stage))return;
  // Only this transaction's flat, ordinary files may be removed.
  for(const name of fs.readdirSync(stage)) {
    const file=checkedTarget(projectDir,stageName+'/'+name);
    if(!fs.lstatSync(file).isFile())throw fail('DRAFT_STAGE_INVALID');
    fs.unlinkSync(file);
  }
  fs.rmdirSync(stage);
}
/** Real process-crash recovery: durable before-images, never guessed deletion. */
export function recoverDraftInstall({projectDir,operationId}={}) {
  const journal=readJournal(projectDir),record=journal.operations[operationId];
  if(!record)throw fail('DRAFT_UNKNOWN_OPERATION: '+operationId);
  if(record.status!=='applying')return {ok:true,operationId,recovered:false,status:record.status};
  if(record.version!==2||!Array.isArray(record.files))throw fail('DRAFT_LEGACY_RECOVERY_UNSAFE');
  // Verify all targets and backups before undoing any of them.
  for(const file of record.files) {
    const target=checkedTarget(projectDir,file.path);
    const hash=fs.existsSync(target)?sha256(fs.readFileSync(target)):null;
    if(hash!==file.beforeHash&&hash!==file.sha256)throw fail('DRAFT_RECOVERY_CONFLICT');
    if(file.beforeHash!==null) {
      const backup=checkedTarget(projectDir,record.stage+'/'+file.backup);
      if(sha256(fs.readFileSync(backup))!==file.beforeHash)throw fail('DRAFT_BACKUP_CORRUPT');
    }
  }
  const restored=[],removed=[];
  for(const file of record.files) {
    const target=checkedTarget(projectDir,file.path);
    if(file.beforeHash===null) {if(fs.existsSync(target)){fs.unlinkSync(target);removed.push(file.path);}}
    else {durableWrite(target,fs.readFileSync(checkedTarget(projectDir,record.stage+'/'+file.backup)));restored.push(file.path);}
  }
  delete journal.operations[operationId];writeJournal(projectDir,journal);
  removeStage(projectDir,record.stage);
  return {ok:true,operationId,recovered:true,restored,removed};
}
/** This is for isolated draft workspaces only. Production commits the planned set through Rust. */
export function applyDraftInstall(args={}) {
  const {projectDir,shouldCancel}=args, operationId=args.plan?.operationId;
  if(typeof operationId!=='string'||!operationId||operationId.length>240)throw fail('INVALID_OPERATION_ID');
  const request=requestHash(args),journal=readJournal(projectDir),previous=journal.operations[operationId];
  if(previous) {
    if(previous.requestHash===request&&previous.status==='applied')return {...previous.receipt,applied:false,alreadyApplied:true};
    return {ok:false,applied:false,operationId,conflicts:[{code:previous.status==='applying'?'DRAFT_RECOVERY_REQUIRED':'OPERATION_CONFLICT'}]};
  }
  const planned=planDraftInstall(args);
  if(!planned.ok)return {...planned,applied:false};
  const stageName=STAGE_PREFIX+randomUUID(),stage=checkedTarget(projectDir,stageName);
  const record={version:2,status:'applying',requestHash:request,fileSetHash:planned.fileSetHash,stage:stageName,files:[]};
  let journaled=false;
  try {
    fs.mkdirSync(stage);
    for(const [index,file] of planned.files.entries()) {
      const target=checkedTarget(projectDir,file.path.replaceAll('\\','/'));
      const before=fs.existsSync(target)?fs.readFileSync(target):null;
      const backup='before-'+index,staged='after-'+index;
      if(before!==null)durableWrite(path.join(stage,backup),before);
      durableWrite(path.join(stage,staged),file.bytes);
      record.files.push({path:file.path.replaceAll('\\','/'),sha256:file.sha256,beforeHash:before===null?null:sha256(before),backup,staged});
    }
    journal.operations[operationId]=record;writeJournal(projectDir,journal);journaled=true;
    for(const file of record.files) {
      if(shouldCancel?.())throw fail('DRAFT_CANCELLED');
      const target=checkedTarget(projectDir,file.path);
      if((fs.existsSync(target)?sha256(fs.readFileSync(target)):null)!==file.beforeHash)throw fail('DRAFT_STALE_TARGET');
      if(file.beforeHash===file.sha256)continue;
      durableWrite(target,fs.readFileSync(path.join(stage,file.staged)));
    }
    const receipt={ok:true,applied:true,operationId,fileSetHash:planned.fileSetHash,assetLockHash:planned.assetLockHash,conflicts:[],created:record.files.filter(f=>f.beforeHash===null).map(f=>f.path),replaced:record.files.filter(f=>f.beforeHash!==null&&f.beforeHash!==f.sha256).map(f=>f.path),unchanged:record.files.filter(f=>f.beforeHash===f.sha256).map(f=>f.path),instances:planned.instances,classes:planned.classes,lockPath:ASSET_LOCK_FILE};
    journal.operations[operationId]={...record,status:'applied',receipt};writeJournal(projectDir,journal);
    removeStage(projectDir,stageName);return receipt;
  }catch(error) {
    if(journaled) {
      const persisted=readJournal(projectDir).operations[operationId];
      if(persisted?.status==='applied')throw error; // Never undo a committed receipt on cleanup failure.
      try{recoverDraftInstall({projectDir,operationId});}catch(recovery){throw new AggregateError([error,recovery],'DRAFT_RECOVERY_REQUIRED');}
    } else removeStage(projectDir,stageName);
    return {ok:false,applied:false,operationId,restored:true,conflicts:[{code:error.code??'DRAFT_APPLY_FAILED',detail:error.message}]};
  }
}
export {ASSET_LOCK_FILE,ASSET_LOCK_FORMAT};
