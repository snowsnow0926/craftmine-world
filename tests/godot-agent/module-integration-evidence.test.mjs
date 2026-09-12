import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {materializeBase} from '../../desktop/godot/shared/materialize.mjs';
const root=path.resolve(import.meta.dirname,'../..'),directory=path.join(root,'docs/evidence/gu3-gu4-module-integration-20260912');
const read=name=>JSON.parse(fs.readFileSync(path.join(directory,name)));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const summary=read('summary.json'),core=read('module-core-report.json'),native=read('collision-native-report.json'),web=read('collision-web-report.json');

function validateCollision(native,web){
 assert.equal(native.cases.length,17);
 const get=name=>{const cases=native.cases.filter(c=>c.case===name);assert.equal(cases.length,1);return cases[0];};
 for(const name of ['normal-floor-contact','wall-contact','non-solid-building','saved-open-door','corner-contact','slope-contact','trimesh-room-clearance']){
  const c=get(name);assert.equal(c.restoreError,'');assert.equal(c.guard.status,'passed');assert.ok(c.guard.maxContactDepth<=0.001);
  assert.equal(c.guard.synchronization.paused,true);assert.ok(c.guard.synchronization.finishedFrame-c.guard.synchronization.startedFrame>=2);
 }
 for(const name of ['wall-penetration','inside-convex-building','two-mm-wall-penetration','corner-penetration','slope-penetration','trimesh-wall-penetration']){
  const c=get(name);assert.match(c.restoreError,/CREATION_COLLISION_GUARD_FAILED:PLAYER_PENETRATION/);assert.equal(c.guard.status,'failed');assert.ok(c.guard.maxContactDepth>0.001);assert.equal(c.rollbackEqual,true);
 }
 for(const name of ['collision-budget','restore-lies-about-pose','shape-replaced-during-sync','native-shape-owner-transform'])assert.match(get(name).restoreError,/CREATION_COLLISION_GUARD_UNSUPPORTED:/);
 assert.equal(web.passed,true);assert.equal(web.electron.passed,true);
 assert.deepEqual(web.electron.latestProgress,{position:[0,0.899999976158142,2.11500144004822],stageRejected:true,formalInstanceRetained:true,formalSnapshotUnchanged:true});
 assert.ok(web.electron.guards.length>0);for(const guard of web.electron.guards)assert.deepEqual(guard,{pointerLock:0,focus:0});
}

test('archived actual Core and physics reports retain original bytes and distinct evidence scopes',()=>{
 for(const [file,pin]of Object.entries(summary.records)){const bytes=fs.readFileSync(path.join(directory,file));assert.equal(bytes.length,pin.bytes);assert.equal(hash(bytes),pin.sha256);}
 assert.equal(core.passed,true);assert.equal(core.checks.length,18);assert.ok(core.checks.every(c=>c.passed));assert.equal(core.engineCalls,0);assert.equal(core.modelCalls,0);
 assert.match(core.scope,/synthetic host capture/);assert.match(web.scope,/no core-issued application/);
 validateCollision(native,web);
});

test('current materialized twelve-resource cohort matches all three actual Web PCK proofs',()=>{
 const out=path.join(fs.mkdtempSync(path.join(root,'test-results/module-evidence-source-')),'project');
 materializeBase({baseId:'creation-sandbox',worldId:'evidence',out});
 assert.equal(summary.protectedFiles.length,12);assert.equal(web.projects.length,3);
 for(const pin of summary.protectedFiles){
  const bytes=fs.readFileSync(path.join(out,pin.path));assert.equal(bytes.length,pin.bytes);assert.equal(hash(bytes),pin.sha256);
  for(const project of web.projects)assert.deepEqual(project.packProof.files.find(file=>file.path===pin.path),pin);
 }
});

test('a claimed clear penetration or lost formal snapshot fails the archived acceptance',()=>{
 const wrong=structuredClone(native);wrong.cases.find(c=>c.case==='two-mm-wall-penetration').guard.status='passed';assert.throws(()=>validateCollision(wrong,web));
 const replaced=structuredClone(web);replaced.electron.latestProgress.formalSnapshotUnchanged=false;assert.throws(()=>validateCollision(native,replaced));
});
