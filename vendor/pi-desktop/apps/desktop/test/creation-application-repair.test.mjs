import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {creationApplicationRepairReason as reason} from '../electron/main/creation-application-repair.ts';
const errors=['GODOT_ADDITIVE_REMOVAL_REJECTED','GODOT_ADDITIVE_ENTITY_SHAPE_CHANGED','GODOT_ADDITIVE_COMPONENT_SCHEMA_CHANGED','Saved player overlaps candidate entity: tree-1','Authored rule rejected progress: regrow: incompatible schema'];
test('fixed collision and source schema diagnostics can repair only after confirmed rollback',()=>{
 for(const error of errors){assert.equal(reason(Error(error),true,true),error);assert.equal(reason(Error(error),false,true),null);assert.equal(reason(Error(error),true,false),null);}
});
test('CAS, identity, permission, disk and uncertain application failures never trigger source repair',()=>{
 for(const error of ['CONTENT_HEAD_CONFLICT','CREATION_TARGET_STALE','GODOT_CANDIDATE_CONTENT_UNKNOWN','EACCES','ENOSPC','GODOT_APPLICATION_COMMIT_UNCERTAIN',...errors.map(error=>error+'; application recovery pending: read failed'),'custom collision failure','GODOT_ADDITIVE_COMPONENT_SCHEMA_CHANGED_FORGED'])assert.equal(reason(Error(error),true,true),null);
});
test('allowlist corresponds to diagnostics actually emitted by fixed source validators',()=>{
 const world=fs.readFileSync(new URL('../../../../../desktop/godot/bases/creation-sandbox/scripts/creation_world.gd',import.meta.url),'utf8');
 const core=fs.readFileSync(new URL('../../../crates/craftmine-core/src/godot_additive_progress.rs',import.meta.url),'utf8');
 for(const error of errors.slice(0,3))assert.ok(core.includes('"'+error+'"'));
 for(const prefix of ['Saved player overlaps candidate entity: ','Authored rule rejected progress: '])assert.ok(world.includes('"'+prefix+'"'));
});
