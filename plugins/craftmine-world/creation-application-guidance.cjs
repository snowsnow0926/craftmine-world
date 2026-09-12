'use strict';
// Presentation only. Neither a guide nor a saved executor receipt can grant
// adoption authority; the caller supplies the current host-bound capture.
function creationApplicationGuidance(worldId,target,job=null,context=null){
 const owner=context&&Object.keys(context).sort().join(',')==='projectId,sessionId,turnId'&&Object.values(context).every(value=>typeof value==='string'&&value.length>0)?{...context}:null;
 const fullAuto=!!owner&&target?.format==='craftmine.creation-target/1'&&target.worldId===worldId&&target.autoApply===true&&target.authorization==='full-auto'&&!target.supersededBy&&!target.observerUpgradeOnly&&typeof target.snapshotId==='string'&&target.snapshotId.length>0;
 const result={format:'craftmine.creation-application-guidance/1',worldId,owner,captureSnapshotId:fullAuto?target.snapshotId:null,authority:'current-host-capture',grantsAuthority:false,mode:fullAuto?'full-auto':'manual-or-unavailable',
  instruction:'Describe the player-visible result and remaining real checks in ordinary language. Source files, build IDs and technical panels are not steps a full-auto player must perform. A passed check alone never proves adoption or every requested gameplay behavior.'};
 if(!job)return {...result,adoptionConfirmed:false,playerActionRequired:fullAuto?false:null,nextAction:fullAuto?'complete-edit-check-then-finish-turn':'follow-current-authorization',
  instruction:result.instruction+(fullAuto?' The host applies the latest verified result after this author turn finishes. If the matching application receipt is deferred for CREATION_TURN_BUSY or CREATION_AWAITING_TURN_FINISH, finish the turn once the requested work is checked; do not wait for your own turn to end, ask for manual adoption, or claim it is already adopted.':' Do not infer automatic adoption from this guide; honor the actual application receipt and current player confirmation.')};
 const application=job.creationApplication;
 const bound=job.worldId===worldId&&job.status==='passed'&&job.kind==='check'&&application&&application.worldId===worldId&&application.jobId===job.jobId&&application.buildId===job.buildId&&typeof job.candidateId==='string'&&application.candidateId===job.candidateId;
 if(!bound)return {...result,adoptionConfirmed:false,playerActionRequired:null,nextAction:'read-exact-application-state'};
 const identity={jobId:job.jobId,buildId:job.buildId,candidateId:job.candidateId,status:application.status};
 if(application.status==='applied')return {...result,...identity,adoptionConfirmed:true,playerActionRequired:false,nextAction:'report-adoption-and-verified-behavior',playerMessage:'作品已放入世界，可以开始游玩。'};
 if(job.sourceStale===true)return {...result,...identity,adoptionConfirmed:false,playerActionRequired:null,nextAction:'check-current-source',instruction:result.instruction+' This check no longer covers the current source. Do not promise automatic adoption of this older result; complete and check the current work.'};
 if(fullAuto&&application.status==='deferred'){
  const turn=['CREATION_TURN_BUSY','CREATION_AWAITING_TURN_FINISH'].includes(application.reason);
  return {...result,...identity,adoptionConfirmed:false,playerActionRequired:false,timing:turn?'after-current-turn-settles':'when-owner-world-is-available',
   nextAction:turn?'finish-current-turn-if-work-complete':'report-automatic-application-wait',
   playerMessage:turn?'检查通过。应用会在本轮创作结束后自动放入世界，无需你另外操作。':'检查通过。应用正在等待这个世界可以更新，然后会自动放入，无需手动采用。',
   instruction:result.instruction+' This is an authorized automatic handoff, not a request for player confirmation. Keep deferred truthful; do not say adopted yet or tell the player to visit a technical panel. If all requested edits are included in this last check, finish this turn so the host can continue. Further edits require a fresh check; this receipt is not a permanent promise after edits, cancellation, world changes or permission changes.'};
 }
 if(fullAuto&&['pending','applying','repairing'].includes(application.status))return {...result,...identity,adoptionConfirmed:false,playerActionRequired:false,nextAction:application.status==='repairing'?'report-automatic-repair':'read-same-job-state',playerMessage:application.status==='repairing'?'应用正在自动修复，完成检查后会继续放入世界。':'检查通过，应用正在自动准备放入世界。'};
 if(application.status==='manual'&&['CREATION_CHECK_SUPERSEDED','CREATION_REQUEST_SUPERSEDED'].includes(application.reason))return {...result,...identity,adoptionConfirmed:false,playerActionRequired:null,nextAction:'read-latest-result',playerMessage:'这次检查已被后续创作替代，请以最新创作结果为准。'};
 if(application.status==='manual')return {...result,...identity,adoptionConfirmed:false,playerActionRequired:true,nextAction:'follow-current-result-confirmation',playerMessage:'检查通过，等待你在创作结果中确认采用。'};
 return {...result,...identity,adoptionConfirmed:false,playerActionRequired:null,nextAction:'report-actual-application-state',instruction:result.instruction+' Do not promise automatic adoption from a stale receipt or infer a required manual step from deferred alone. Read current state and report the actual failure or authorization reason.'};
}
module.exports={creationApplicationGuidance};
