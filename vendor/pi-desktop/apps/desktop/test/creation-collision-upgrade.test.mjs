import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {planCreationCollisionUpgrade,COLLISION_SUPPORT_OLD,COLLISION_SUPPORT_CURRENT} from '../electron/main/creation-collision-upgrade.ts';
import {verifyCreationGroundUpgrade} from '../electron/main/creation-ground-upgrade.ts';
import {materializeBase} from '../../../../../desktop/godot/shared/materialize.mjs';
const root=path.resolve(import.meta.dirname,'../../../../..'),resourcesRoot=path.join(root,'desktop/godot'),out=fs.mkdtempSync(path.join(root,'test-results/collision-planner-'));
const manifest=materializeBase({baseId:'creation-sandbox',worldId:'retained-collision',out:path.join(out,'source'),controllerProfile:'creation-player-collision/1'});
const base=manifest.files.map(f=>({path:f.path,sha256:f.sha256,bytes:f.bytes})),source='craftmine_shared/progress_collision.gd';
const oldFiles=()=>base.map(f=>f.path===source?{...f,sha256:COLLISION_SUPPORT_OLD[0],bytes:3811}:{...f});
const plan=files=>planCreationCollisionUpgrade({baseId:'creation-sandbox',formalFiles:files,draftFiles:files,resourcesRoot});
test('exact complete old collision cohort changes only the owned guard and preserves authored sources',()=>{
 const files=[...oldFiles(),{path:'scripts/player-work.gd',sha256:createHash('sha256').update('valuable work').digest('hex'),bytes:13}];
 const result=plan(files);assert.equal(result.status,'planned');assert.equal(result.operations.length,1);assert.equal(result.operations[0].path,source);
 assert.equal(result.operations[0].expectedHash,COLLISION_SUPPORT_OLD[0]);assert.ok(COLLISION_SUPPORT_CURRENT.includes(result.expectedFiles.find(f=>f.path===source).sha256));
 assert.deepEqual(result.expectedFiles.filter(f=>f.path!==source),files.filter(f=>f.path!==source));verifyCreationGroundUpgrade(result,result.expectedFiles);
});
test('CRLF released guard is accepted, current guard is a no-op and customized/mixed/compiled cohorts are not replaced',()=>{
 const crlf=oldFiles();crlf.find(f=>f.path===source).sha256=COLLISION_SUPPORT_OLD[1];assert.equal(plan(crlf).status,'planned');assert.equal(plan(base).reason,'already-current');
 for(const change of [files=>files.find(f=>f.path==='craftmine_shared/base_adapter.gd').sha256='f'.repeat(64),files=>files.find(f=>f.path===source).sha256='e'.repeat(64),files=>files.push({path:source+'.remap',sha256:'a'.repeat(64),bytes:1}),files=>files.splice(files.findIndex(f=>f.path==='craftmine_shared/controller_evidence.gd'),1)]){
  const files=oldFiles();change(files);assert.equal(plan(files).reason,'customized-source');
 }
});
test('branch/source drift refuses migration and verification examines every retained file',()=>{
 const files=oldFiles();assert.equal(planCreationCollisionUpgrade({baseId:'creation-sandbox',formalFiles:files,draftFiles:files.slice(1),resourcesRoot}).reason,'draft-conflict');
 const result=plan(files);const changed=structuredClone(result.expectedFiles);changed.find(f=>f.path==='world/creation.json').sha256='a'.repeat(64);assert.throws(()=>verifyCreationGroundUpgrade(result,changed),/SOURCE_CHANGED/);
});
