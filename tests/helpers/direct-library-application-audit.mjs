import assert from 'node:assert/strict';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {preservePriorComponents} from './direct-library-progress.mjs';

export function verifyAppliedProgress(row,{worldId,candidateId,buildId}){
  assert.equal(row.status,'applied');assert.equal(row.world_id,worldId);assert.equal(row.candidate_id,candidateId);assert.equal(row.build_id,buildId);
  const input=JSON.parse(row.input),previous=JSON.parse(row.previous_world),output=JSON.parse(row.output);
  assert.equal(input.worldId,worldId);assert.equal(input.candidateId,candidateId);assert.equal(input.buildId,buildId);
  assert.equal(output.format,'craftmine.godot-application/2');assert.equal(output.launch.passed,true);assert.equal(output.launch.buildId,buildId);
  assert.equal(output.snapshot.worldId,worldId);assert.equal(previous.snapshot.worldId,worldId);
  assert.deepEqual(input.previousSnapshot,previous.snapshot,'APPLICATION_PREVIOUS_PROGRESS_CHANGED');
  assert.deepEqual(output.snapshot,input.snapshot,'APPLICATION_OUTPUT_PROGRESS_CHANGED');
  if(input.progressMigration?.snapshot)assert.deepEqual(input.progressMigration.snapshot,input.snapshot,'APPLICATION_MIGRATION_PROGRESS_CHANGED');
  const progress=preservePriorComponents({state:previous.snapshot},{state:output.snapshot});
  return {applicationId:row.id,worldId,candidateId,buildId,createdAt:row.created_at,appliedAt:row.updated_at,
    source:'closed-profile-read-only-Core-application',before:previous.snapshot,after:output.snapshot,launch:output.launch,progress};
}

export function auditPromoApplications(report){
  assert(report.launches.length&&report.launches.every(run=>run.exit?.code===0),'APPLICATION_AUDIT_REQUIRES_NORMAL_CLOSED_PROFILE');
  const db=new DatabaseSync(path.join(report.out,'profile/plugins/data/craftmine.world/tasks.sqlite'),{readOnly:true});
  try{return report.stages.map(stage=>{
    const operation=report.operations.find(row=>row.operationId===stage.operationId);assert(operation?.applied,'APPLICATION_OPERATION_NOT_APPLIED');
    const identity={worldId:operation.worldId,candidateId:operation.applied.candidateId,buildId:stage.after.receipt.buildId};
    const rows=db.prepare('SELECT id,world_id,candidate_id,build_id,status,input,previous_world,output,created_at,updated_at FROM craftmine_godot_applications WHERE world_id=? AND candidate_id=? AND build_id=? AND status=\'applied\'').all(identity.worldId,identity.candidateId,identity.buildId);
    assert.equal(rows.length,1,'EXACT_APPLICATION_RECEIPT_REQUIRED');
    const proof=verifyAppliedProgress(rows[0],identity);
    assert.equal(proof.launch.instanceId,stage.after.receipt.instanceId,'APPLICATION_LIVE_INSTANCE_CHANGED');
    return {assetId:stage.assetId,operationId:stage.operationId,...proof};
  });}finally{db.close();}
}

export function auditClosedSavedProgress(report){
  assert(report.launches.length&&report.launches.every(run=>run.exit?.code===0),'APPLICATION_AUDIT_REQUIRES_NORMAL_CLOSED_PROFILE');
  const db=new DatabaseSync(path.join(report.out,'profile/plugins/data/craftmine.world/tasks.sqlite'),{readOnly:true});
  try{
    const row=db.prepare('SELECT document FROM craftmine_worlds WHERE id=?').get(report.saved.worldId);assert(row,'COLD_SAVED_WORLD_REQUIRED');
    const snapshot=JSON.parse(row.document).snapshot;assert.deepEqual(snapshot,report.saved.state,'CLOSED_CORE_SAVED_PROGRESS_CHANGED');
    return {scope:'closed-Core-saved-progress',worldId:report.saved.worldId,exactlyEqual:true,snapshot};
  }finally{db.close();}
}
