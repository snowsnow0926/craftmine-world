// S3: complete managed draft file set and all-or-nothing application.
//
// Round-two audit gaps covered here (docs/audits/godot-round2-20260910/REPORT.md
// 3.3): a component install wrote file by file (partial install possible),
// existing files were never hashed before being overwritten, and the install
// produced no managed set (source, scene, asset lock, UID, input actions and
// entity map). The plan below is a real `package.planInstall` result shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {
  ASSET_LOCK_FILE,
  DRAFT_INSTANCES_FILE,
  applyDraftInstall,
  planDraftInstall,
  recoverDraftInstall,
} from '../../../desktop/godot/shared/draft_install.mjs';
import {canonicalLockText} from '../../../plugins/craftmine-world/asset-lock.mjs';

const sha=(value)=>createHash('sha256').update(value).digest('hex');
const hex=(character)=>character.repeat(64);

const DOOR_HASH=hex('1');
const SCRIPT='extends Node2D\n\nfunc _ready():\n\tpass\n';
const SCRIPT_BYTES=Buffer.from(SCRIPT,'utf8');
const UID='uid://b3door0script\n';
const UID_BYTES=Buffer.from(UID,'utf8');

function project(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'s3-draft-'));
  fs.mkdirSync(path.join(dir,'scenes'),{recursive:true});
  fs.writeFileSync(path.join(dir,'project.godot'),'[application]\nconfig/name="world"\n');
  fs.writeFileSync(path.join(dir,'scenes','world.tscn'),[
    '[gd_scene format=3]','','[node name="World" type="Node2D"]','',
  ].join('\n'));
  return dir;
}

function lock(overrides=[],script=SCRIPT_BYTES,uid=UID_BYTES){
  return {format:'craftmine.assets-lock/1',assets:[{
    asset:{assetId:'door',version:'1',contentHash:DOOR_HASH},
    installPath:'addons/door',
    files:[
      {path:'scripts/door.gd',sha256:sha(script),bytes:script.byteLength,mediaType:'text/x-gdscript'},
      {path:'scripts/door.gd.uid',sha256:sha(uid),bytes:uid.byteLength,mediaType:'text/plain'},
    ],
    dependencies:[],overrides,
  }]};
}

function plan(extra={}){
  const script=extra.script??SCRIPT_BYTES;
  const uid=extra.uid??UID_BYTES;
  return {
    ok:true,applied:false,operationId:'install-1',worldId:'world',
    order:['door@1'],
    instances:[{instanceId:'ins-1',assetId:'door',version:1,kind:'object',
      contentHash:DOOR_HASH,entityMap:{door:'ins-1-e0'},localOverrides:[],
      installPath:'addons/door'}],
    lock:lock(extra.overrides??[],script,uid),
    ...extra.plan,
  };
}

function payload(script=SCRIPT_BYTES,uid=UID_BYTES){
  return [
    {contentHash:DOOR_HASH,path:'scripts/door.gd',bytes:script},
    {contentHash:DOOR_HASH,path:'scripts/door.gd.uid',bytes:uid},
  ];
}

const codes=(result)=>result.conflicts.map(conflict=>conflict.code);

test('the plan builds the complete managed set without writing anything',()=>{
  const dir=project();
  const before=fs.readdirSync(dir,{recursive:true}).sort();
  const planned=planDraftInstall({plan:plan(),payload:payload(),projectDir:dir});
  assert.equal(planned.ok,true,codes(planned).join(','));
  assert.equal(planned.format,'craftmine.godot-draft-install/1');
  const paths=planned.files.map(file=>file.path).sort();
  assert.deepEqual(paths,[
    'addons/door/scripts/door.gd',
    'addons/door/scripts/door.gd.uid',
    ASSET_LOCK_FILE,
    DRAFT_INSTANCES_FILE,
  ].sort());
  const lockFile=planned.files.find(file=>file.path===ASSET_LOCK_FILE);
  assert.equal(lockFile.bytes.toString('utf8'),canonicalLockText(lock()));
  const instances=JSON.parse(planned.files.find(file=>file.path===DRAFT_INSTANCES_FILE).bytes.toString('utf8'));
  assert.equal(instances.format,'craftmine.godot-draft-instances/1');
  assert.deepEqual(instances.instances[0].entityMap,{door:'ins-1-e0'});
  assert.equal(instances.assetLockHash,planned.assetLockHash);
  assert.deepEqual(fs.readdirSync(dir,{recursive:true}).sort(),before,'preflight must not write');
});

test('payload is verified against the plan lock before any write',()=>{
  const dir=project();
  const missing=planDraftInstall({plan:plan(),payload:[payload()[0]],projectDir:dir});
  assert.equal(missing.ok,false);
  assert.ok(codes(missing).includes('DRAFT_PAYLOAD_MISSING'),codes(missing).join(','));
  const wrongHash=planDraftInstall({plan:plan(),payload:[
    {contentHash:DOOR_HASH,path:'scripts/door.gd',bytes:Buffer.from('tampered\n')},
    payload()[1],
  ],projectDir:dir});
  assert.ok(codes(wrongHash).includes('DRAFT_PAYLOAD_HASH_MISMATCH'),codes(wrongHash).join(','));
  // A lock that declares the wrong byte count is refused even when the hash
  // matches, so the package's file size cannot be silently wrong.
  const sizeLock=lock();
  sizeLock.assets[0].files[0].bytes=SCRIPT_BYTES.byteLength+1;
  const sizeMismatch=planDraftInstall({plan:{...plan(),lock:sizeLock},payload:payload(),projectDir:dir});
  assert.ok(codes(sizeMismatch).includes('DRAFT_PAYLOAD_SIZE_MISMATCH'),codes(sizeMismatch).join(','));
});

test('a script without its Godot UID is refused',()=>{
  const dir=project();
  const result=planDraftInstall({plan:plan(),payload:[payload()[0]],projectDir:dir});
  assert.ok(codes(result).includes('DRAFT_MISSING_SCRIPT_UID'),codes(result).join(','));
});

test('a global class clash is refused before writing',()=>{
  const dir=project();
  fs.mkdirSync(path.join(dir,'scripts'),{recursive:true});
  fs.writeFileSync(path.join(dir,'scripts','existing.gd'),'extends Node2D\nclass_name Door\n');
  const bytes=Buffer.from('extends Node2D\nclass_name Door\n');
  const planned=planDraftInstall({
    plan:plan({script:bytes}),
    payload:payload(bytes),
    projectDir:dir,
  });
  assert.ok(codes(planned).includes('DRAFT_SCRIPT_CLASS_CONFLICT'),codes(planned).join(','));
});

test('an existing file with a different hash is a conflict unless it is an override',()=>{
  const dir=project();
  const target=path.join(dir,'addons','door','scripts','door.gd');
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.writeFileSync(target,'extends Node2D # author edit\n');
  const refused=planDraftInstall({plan:plan(),payload:payload(),projectDir:dir});
  assert.ok(codes(refused).includes('DRAFT_FILE_CONFLICT'),codes(refused).join(','));

  const overridden=planDraftInstall({plan:plan({overrides:[
    {scope:'ins-1',path:'scripts/door.gd',contentHash:sha(Buffer.from('extends Node2D # author edit\n'))},
  ]}),payload:payload(),projectDir:dir});
  assert.equal(overridden.ok,true,codes(overridden).join(','));
  assert.equal(overridden.files.find(file=>file.path.endsWith('door.gd')).overridden,true);
});

test('a stale head and a malicious lock are refused',()=>{
  const dir=project();
  const stale=planDraftInstall({plan:plan(),payload:payload(),projectDir:dir,expectedHead:'aaa',currentHead:'bbb'});
  assert.equal(stale.ok,false);
  assert.ok(codes(stale).includes('DRAFT_STALE_HEAD'));
  const escaped=plan();
  escaped.lock.assets[0].installPath='../outside';
  assert.throws(()=>planDraftInstall({plan:escaped,payload:payload(),projectDir:dir}),/PATH_TRAVERSAL/);
});

test('apply writes the whole set and is idempotent per operation id',()=>{
  const dir=project();
  const receipt=applyDraftInstall({plan:plan(),payload:payload(),projectDir:dir});
  assert.equal(receipt.ok,true,JSON.stringify(receipt.conflicts));
  assert.equal(receipt.applied,true);
  assert.equal(fs.readFileSync(path.join(dir,'addons','door','scripts','door.gd'),'utf8'),SCRIPT);
  assert.equal(fs.readFileSync(path.join(dir,'addons','door','scripts','door.gd.uid'),'utf8'),UID);
  assert.equal(fs.readFileSync(path.join(dir,ASSET_LOCK_FILE),'utf8'),canonicalLockText(lock()));
  assert.ok(fs.existsSync(path.join(dir,DRAFT_INSTANCES_FILE)));

  const replay=applyDraftInstall({plan:plan(),payload:payload(),projectDir:dir});
  assert.equal(replay.ok,true);
  assert.equal(replay.alreadyApplied,true);
  assert.equal(replay.applied,false);

  const conflicting=applyDraftInstall({plan:{...plan(),operationId:'install-1',worldId:'other'},
    payload:payload(),projectDir:dir});
  assert.equal(conflicting.ok,false);
  assert.ok(codes(conflicting).includes('OPERATION_CONFLICT'),codes(conflicting).join(','));
});

test('a cancelled apply restores the previous world',()=>{
  const dir=project();
  const target=path.join(dir,'addons','door','scripts','door.gd');
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.writeFileSync(target,'extends Node2D # author edit\n');
  const original=fs.readFileSync(target);
  const planned=planDraftInstall({plan:plan({overrides:[
    {scope:'ins-1',path:'scripts/door.gd',contentHash:sha(original)},
  ]}),payload:payload(),projectDir:dir});
  assert.equal(planned.ok,true,codes(planned).join(','));
  const receipt=applyDraftInstall({plan:plan({overrides:[
    {scope:'ins-1',path:'scripts/door.gd',contentHash:sha(original)},
  ]}),payload:payload(),projectDir:dir,shouldCancel:()=>true});
  assert.equal(receipt.ok,false);
  assert.ok(codes(receipt).includes('DRAFT_CANCELLED'),codes(receipt).join(','));
  assert.equal(receipt.restored,true);
  assert.deepEqual(fs.readFileSync(target),original,'existing file restored');
  assert.equal(fs.existsSync(path.join(dir,ASSET_LOCK_FILE)),false,'no half-written lock');
  assert.equal(fs.existsSync(path.join(dir,'addons','door','scripts','door.gd.uid')),false,'no half-written payload');
  assert.deepEqual(fs.readdirSync(dir).filter(name=>name.startsWith('.craftmine-stage-')),[],'stage cleaned');
});

test('a legacy journal without before-images refuses destructive recovery',()=>{
  const dir=project();
  const file=path.join(dir,'addons','door','scripts','door.gd');
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,SCRIPT_BYTES);
  const journalFile=path.join(dir,'.craftmine','draft-operations.json');
  fs.mkdirSync(path.dirname(journalFile),{recursive:true});
  fs.writeFileSync(journalFile,JSON.stringify({format:'craftmine.godot-draft-install/1',operations:{
    'install-9':{status:'applying',fileSetHash:hex('9'),files:[
      {path:'addons/door/scripts/door.gd',sha256:sha(SCRIPT_BYTES),kind:'payload'},
      {path:'addons/door/scripts/missing.gd',sha256:hex('8'),kind:'payload'},
    ]},
  }}));
  assert.throws(()=>recoverDraftInstall({projectDir:dir,operationId:'install-9'}),/DRAFT_LEGACY_RECOVERY_UNSAFE/);
  assert.equal(fs.readFileSync(file).equals(SCRIPT_BYTES),true);
  assert.throws(()=>recoverDraftInstall({projectDir:dir,operationId:'install-unknown'}),/DRAFT_UNKNOWN_OPERATION/);
});

test('a scene edit becomes part of the same atomic set',()=>{
  const dir=project();
  const sceneEdit={
    format:'craftmine.godot-scene-edit/1',
    scene:'scenes/world.tscn',
    parent:'.',
    nodeName:'door_ins1',
    mode:'script-node',
    nodeType:'Node2D',
    extResource:{type:'Script',path:'addons/door/scripts/door.gd',id:'2_door'},
    properties:{entity_id:'"ins-1-e0"'},
    identity:{field:'entity_id',value:'"ins-1-e0"',entityId:'ins-1-e0'},
    groups:[],
    inputActions:[],
  };
  const receipt=applyDraftInstall({plan:plan(),payload:payload(),projectDir:dir,sceneEdits:[sceneEdit]});
  assert.equal(receipt.ok,true,JSON.stringify(receipt.conflicts));
  const scene=fs.readFileSync(path.join(dir,'scenes','world.tscn'),'utf8');
  assert.match(scene,/\[node name="door_ins1" type="Node2D" parent="\."\]/);
  assert.match(scene,/entity_id = "ins-1-e0"/);
  assert.ok(receipt.replaced.includes('scenes/world.tscn'),JSON.stringify(receipt.replaced));
});

test('declared input actions are written into project.godot in the same set',()=>{
  const dir=project();
  const receipt=applyDraftInstall({plan:plan(),payload:payload(),projectDir:dir,inputActions:['interact']});
  assert.equal(receipt.ok,true,JSON.stringify(receipt.conflicts));
  const text=fs.readFileSync(path.join(dir,'project.godot'),'utf8');
  assert.match(text,/\[input\]/);
  assert.match(text,/interact=\{/);
});

function sceneEdit(id){return {format:'craftmine.godot-scene-edit/1',scene:'scenes/world.tscn',parent:'.',nodeName:id,mode:'script-node',nodeType:'Node2D',extResource:{type:'Script',path:'addons/door/scripts/door.gd',id:'resource-'+id},properties:{entity_id:JSON.stringify(id)},identity:{field:'entity_id',value:JSON.stringify(id),entityId:id},groups:[],inputActions:[]};}
test('same-content targets and multiple scene edits are installed together',()=>{
 const dir=project(),p=plan();const ref=p.lock.assets[0].files[1];p.lock.assets[0].files.push({...ref,path:'same.uid'});
 const extra={contentHash:DOOR_HASH,path:'same.uid',bytes:UID_BYTES};
 const result=applyDraftInstall({plan:p,payload:[...payload(),extra],projectDir:dir,sceneEdits:[sceneEdit('door-a'),sceneEdit('door-b')]});
 assert.equal(result.ok,true,JSON.stringify(result));const text=fs.readFileSync(path.join(dir,'scenes/world.tscn'),'utf8');assert.match(text,/door-a/);assert.match(text,/door-b/);assert.equal(fs.readFileSync(path.join(dir,'addons/door/same.uid'),'utf8'),UID);
});
test('a second independent install retains the first instance and lock entry',()=>{
 const dir=project();assert.equal(applyDraftInstall({plan:plan(),payload:payload(),projectDir:dir}).ok,true);
 const p=plan({plan:{operationId:'install-2'}});p.instances[0].instanceId='ins-2';p.instances[0].entityMap={door:'ins-2-e0'};
 assert.equal(applyDraftInstall({plan:p,payload:payload(),projectDir:dir}).ok,true);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,DRAFT_INSTANCES_FILE))).instances.map(i=>i.instanceId),['ins-1','ins-2']);
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,ASSET_LOCK_FILE))).assets.length,1);
});
