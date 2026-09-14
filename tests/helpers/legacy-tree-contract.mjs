import assert from 'node:assert/strict';
export const LEGACY_TREE_REQUEST='生成一个树';
export const LEGACY_TREE_BASE='craftmine-web/5';
export function requireLegacyTree({before,record,observation}){
  assert.equal(record.runtimeKind,'legacy','LEGACY_WORLD_REQUIRED');
  assert.equal(record.id,before.id,'ORIGINAL_WORLD_REQUIRED');
  assert.notEqual(record.world.build.id,before.world.build.id,'NEW_APPLIED_BUILD_REQUIRED');
  const oldIds=new Set(before.world.build.scene.objects.map(row=>row.id));
  const added=record.world.build.scene.objects.filter(row=>!oldIds.has(row.id));
  assert(added.length>0,'ADDED_OBJECT_REQUIRED');
  const drawable=added.filter(row=>Array.isArray(row.parts)&&row.parts.length>0&&observation.objects.some(value=>value.id===row.id&&value.visible===true&&value.mesh===true));
  assert(drawable.length>0,'ACTUAL_DRAWABLE_ADDED_OBJECT_REQUIRED');
  for(const original of before.world.build.scene.objects)assert.deepEqual(record.world.build.scene.objects.find(row=>row.id===original.id),original,'EXISTING_OBJECT_CHANGED');
  return {addedObjectIds:added.map(row=>row.id),drawableObjectIds:drawable.map(row=>row.id),buildId:record.world.build.id,
    scope:'Actual preview renderer mesh observation and applied source; tree aesthetics require screenshot/player review'};
}
export function requireSameLegacySave(saved,cold){
  assert.equal(cold.record.id,saved.record.id);assert.equal(cold.record.runtimeKind,'legacy');
  assert.deepEqual(cold.record.world.build,saved.record.world.build,'COLD_BUILD_CHANGED');
  assert.deepEqual(cold.snapshot,saved.snapshot,'COLD_PROGRESS_CHANGED');
  return true;
}
