import test from 'node:test';import assert from 'node:assert/strict';
import {settleOperatorInputEvidence as settle,settleOperatorExplorationEvidence as explore} from './helpers/operator-input-evidence.mjs';
const identity={worldId:'w',buildId:'b',instanceId:'i'};
function fixture({inputError=false,resultError=false,saveError=false,releaseError=false,archiveError=false}={}){
  const order=[],writes=[];const result={status:resultError?'failed':'completed',...(resultError?{error:'PET_STATE_POSITION_INVALID',partialEvidence:{before:{frame:{pngBase64:'original-pixels'}},release:{released:true}}}:{before:{frame:{pngBase64:'original-pixels'}},during:{observation:{moved:true}},after:{snapshot:{valid:true}}}),semanticSuccess:null};
  const args={identity,segment:{keys:['KeyW'],frames:120},run:async()=>{order.push('input');if(inputError)throw Error('INPUT_TRANSPORT_LOST');return structuredClone(result);},archive:async data=>{order.push('archive');if(archiveError)throw Error('FRAME_HASH_MISMATCH');return {...data,archivedFrames:['before.png']};},release:async()=>{order.push('release');if(releaseError)throw Error('RELEASE_TRANSPORT_LOST');return {released:true};},checkpoint:async()=>{order.push('checkpoint');if(saveError)throw Error('POST_INPUT_SAVE_INVALID');return {snapshot:{valid:true}};},persist:async value=>{order.push('persist');writes.push(structuredClone(value));}};
  return {args,order,writes,result};
}
test('post-input save failure retains complete action and frames before cleanup, without a second save',async()=>{
  const f=fixture({saveError:true}),result=await settle(f.args);assert.deepEqual(f.order,['input','archive','persist','release','checkpoint','persist']);assert.equal(f.writes[0].result.archivedFrames[0],'before.png');assert.deepEqual(result.result.during,f.result.during);assert.equal(result.release.released,true);assert.equal(result.checkpointStatus,'unconfirmed');assert.match(result.primaryError,/POST_INPUT_SAVE_INVALID/);assert.equal(result.semanticSuccess,null);
});
test('native partial input failure remains primary even when release and save also fail',async()=>{
  const f=fixture({resultError:true,saveError:true,releaseError:true}),result=await settle(f.args);assert.equal(result.primaryError,'PET_STATE_POSITION_INVALID');assert.equal(result.result.partialEvidence.before.frame.pngBase64,'original-pixels');assert.match(result.errors.release,/RELEASE_TRANSPORT_LOST/);assert.match(result.errors.checkpoint,/POST_INPUT_SAVE_INVALID/);
});
test('unreceived result remains unknown, and archival failure retains original returned pixels',async()=>{
  const absent=await settle(fixture({inputError:true,saveError:true}).args);assert.equal(absent.resultReceived,false);assert.equal(absent.result,undefined);assert.match(absent.primaryError,/INPUT_TRANSPORT_LOST/);assert.equal(absent.release.released,true);
  const archived=await settle(fixture({archiveError:true}).args);assert.equal(archived.result.before.frame.pngBase64,'original-pixels');assert.match(archived.primaryError,/FRAME_HASH_MISMATCH/);
});
test('evidence write failure cannot prevent key release or mask the original native failure',async()=>{
  const f=fixture({resultError:true,saveError:true});f.args.persist=async()=>{throw Error('DISK_WRITE_FAILED');};const result=await settle(f.args);assert(f.order.includes('release'));assert(f.order.includes('checkpoint'));assert.equal(result.primaryError,'PET_STATE_POSITION_INVALID');assert.match(result.errors.evidenceWriteBefore,/DISK_WRITE_FAILED/);
});
test('a received save receipt is retained when its subsequent snapshot readback fails',async()=>{
  const f=fixture();f.args.checkpoint=async()=>{throw Object.assign(Error('SNAPSHOT_READBACK_FAILED'),{checkpointEvidence:{receipt:{revision:4},status:'save-received-readback-unconfirmed'}});};const result=await settle(f.args);assert.equal(result.checkpointStatus,'unconfirmed');assert.equal(result.checkpointPartial.receipt.revision,4);assert.match(result.primaryError,/SNAPSHOT_READBACK_FAILED/);
});
test('exploration capture failure after movement keeps observed positions and never claims no action ran',async()=>{
  let position=-93,stored;const result=await explore({identity,steps:[{op:'walk',args:{forward:-1,right:0,frames:120},capture:true}],observe:async()=>({position}),run:async()=>{position=-75;throw Error('GODOT_HEADLESS_CAPTURE_FULLSCREEN_USE_BOUND_VIEW');},archive:async value=>value,persist:async value=>{stored=structuredClone(value);}});
  assert.equal(stored.before.position,-93);assert.equal(stored.after.position,-75);assert.equal(result.resultReceived,false);assert.equal(result.executionCoverage,'actions-may-have-executed-without-complete-receipt');assert.match(result.primaryError,/FULLSCREEN_USE_BOUND_VIEW/);assert.equal(result.semanticSuccess,null);
});
