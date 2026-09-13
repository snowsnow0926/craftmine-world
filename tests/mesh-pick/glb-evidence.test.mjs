import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {materializeBase} from '../../desktop/godot/shared/materialize.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const evidence=path.join(root,'docs/evidence/gu2-arraymesh-picker-20260912');
const read=name=>JSON.parse(fs.readFileSync(path.join(evidence,name)));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
test('archived real legacy GLB failure is independent of road overlap',()=>{
 const report=read('legacy-negative.json');
 assert.equal(report.validation.valid,true);assert.equal(report.originalSourceUnchanged,true);
 assert.equal(report.result.checks.length,5);assert.ok(report.result.checks.every(check=>check.passed));
 assert.equal(report.result.independentBuilding.reason,'unsupported-mesh-type');
 assert.equal(report.result.offRayArrayMesh.reason,'unsupported-mesh-type');
 assert.equal(report.result.boxControl.status,'hit');
 const building=report.result.meshes.find(mesh=>mesh.nodePath.includes('building-small-a'));
 assert.equal(building.meshClass,'ArrayMesh');assert.equal(building.surfaces[0].indices,1356);
 assert.equal(building.serializedSurfaceKeys[0].lodCount,2);
});
test('archived complete controller cohort exposes exact imported bodies through ordinary bridge observe',()=>{
 const report=read('controller-v2.json'),cases=report.result.cases,observation=report.bridge.observe.result.creation;
 assert.equal(report.cohort,'controller-v1-plus-picker-v2');
 assert.equal(report.validation.valid,true);assert.equal(report.originalSourceUnchanged,true);
 assert.equal(report.result.checks.length,37);assert.ok(report.result.checks.every(check=>check.passed));
 assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.guard,{pointerLock:0,focus:0});
 assert.equal(report.console.filter(item=>item.type==='error'||/SCRIPT ERROR|Parse Error|ERROR:/.test(item.text)).length,0);
 const first=cases.adapterBuildingObservation.sceneObjectTarget,second=cases.adapterSecondObservation.sceneObjectTarget;
 assert.equal(first.nodeClass,'StaticBody3D');assert.notEqual(first.objectId,second.objectId);
 assert.equal(observation.sceneObjectTarget.objectId,first.objectId);
 assert.ok(observation.sceneObjectRefs.some(ref=>ref.objectId===first.objectId));
 assert.equal(observation.sceneObjectSelection.geometryBasis,'base-surface-arrays');
 assert.equal(observation.sceneObjectSelection.renderLodVerified,false);
 assert.equal(observation.sceneObjectSelection.pixelAccurate,false);
 assert.ok(observation.physicsTick>cases.adapterBuildingObservation.physicsTick);
 assert.equal(cases.buildingPhysics.status,'blocked');assert.equal(cases.buildingBaseTriangles.status,'hit');
 assert.equal(cases.aabbOnlyMustMiss.status,'none');assert.equal(cases.unknownPoints.status,'fallback');
 for(const name of ['surfaceBudget','vertexBudget','triangleBudget','aggregateVertexBudget'])assert.equal(cases[name].counts.facesRead,0);
});
test('archived executed picker bytes retain their original released implementation',()=>{
 const report=read('controller-v2.json');
 assert.equal(hash(fs.readFileSync(path.join(root,'desktop/godot/shared/repairs/scene_mesh_picker_v2-global-budget.gd'),'utf8').replace(/\r\n/g,'\n')),'f83525ba2dea31a2578cdae07a91d379ad177011ef689b57dfd9937c135a3938');
 assert.equal(report.v2PickerSha256,'aa0d01c2906892abecc2eff199f1cb31ae4c83c6b0001249573448d97bfc2cb1');
 assert.equal(report.originalPickerSha256,'d5b6f04b5fe0b4e6acbeb21012cdedb356178221b18347045ee52a7ad468c512');
 for(const record of [read('legacy-negative.json'),report]){
  assert.equal(hash(Buffer.from(JSON.stringify(record.receipt.sourceFiles))),record.request.sourceBinding.sourceDigest);
  assert.equal(record.receipt.sourceSnapshotDigest,record.request.sourceBinding.sourceDigest);
  for(const field of ['schemaVersion','requestId','taskId','operation','inputHash'])assert.equal(record.receipt[field],record.request[field]);
  assert.deepEqual(record.receipt.sourceBinding,record.request.sourceBinding);
 }
 const old=read('legacy-regression.json');assert.equal(old.checks,44);assert.deepEqual(old.failures,[]);
});

test('the integrated materializer emits all ten resources actually exercised by the GLB observation',()=>{
 const directory=fs.mkdtempSync(path.join(tmpdir(),'craftmine-glb-cohort-'));
 const materialized=materializeBase({baseId:'creation-sandbox',worldId:'cohort-review',out:path.join(directory,'project'),controllerProfile:'creation-fixed-controller/1'});
 const expected=read('controller-v2.json').receipt.sourceFiles.filter(f=>f.path.startsWith('craftmine_shared/')||f.path.startsWith('scripts/reused/'));
 assert.equal(expected.length,10);
 for(const file of expected)assert(materialized.files.some(f=>f.path===file.path),'Current complete cohort retains '+file.path);
 assert.equal(materialized.files.find(f=>f.path==='craftmine_shared/scene_mesh_picker_v2.gd')?.sha256,hash(fs.readFileSync(path.join(root,'desktop/godot/shared/scene_mesh_picker_v2.gd'))));
});
