import assert from 'node:assert/strict';

/** Gameplay progress survives reopening while live actors/rain may advance. */
export function assertTemplateReopened(record){
 const original=record.snapshot.state,next=record.reopenedSnapshot.state;
 assert.equal(original.worldId,record.worldId);assert.equal(next.worldId,record.worldId);
 assert.equal(record.save.worldId,record.worldId);assert.deepEqual(original.body.inventory,next.body.inventory);
 const a=original.body.components,b=next.body.components;
 if(record.starterId==='promo-mainline'){
  assert.equal(a['great-hunt-01'].wins,0);assert.equal(a['great-hunt-01'].attempts,0);
  assert.deepEqual(a['great-hunt-01'],b['great-hunt-01']);
  for(const id of Object.keys(a))for(const key of ['entityId','format','health','dead'])assert.deepEqual(a[id][key],b[id][key]);
 }else if(record.starterId==='promo-flight'){
  assert.equal(a['j20-player-aircraft'].aircraft.hasFlown,false);assert.equal(a['j20-player-aircraft'].aircraft.landings,0);
  assert.deepEqual(original,next);
 }else if(record.starterId==='promo-city'){
  assert.deepEqual(original.body.inventory,{});assert.deepEqual(original,next);
 }else if(record.starterId==='promo-rain'){
  assert.equal(a['rain-magic'].casts,0);
  for(const key of ['entityId','format','casts','phase','velocity','automatic','settings','sourceSettings'])assert.deepEqual(a['rain-magic'][key],b['rain-magic'][key]);
 }else throw Error('UNEXPECTED_TEMPLATE');
 return {worldId:record.worldId,starterId:record.starterId,initialStateVerified:true,reopenedProgressVerified:true,
  comparison:record.starterId==='promo-mainline'||record.starterId==='promo-rain'?'persistent gameplay fields; live positions and rain clocks may advance':'exact snapshot'};
}
