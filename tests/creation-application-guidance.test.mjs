import test from 'node:test';import assert from 'node:assert/strict';import {createRequire,register} from 'node:module';
register(new URL('../vendor/pi-desktop/apps/desktop/test/helpers/ts-import-hooks.mjs',import.meta.url));
const {readCurrentCreationCapture}=await import('../vendor/pi-desktop/apps/desktop/electron/main/creation-current-capture.ts');
const {creationApplicationGuidance:guide}=createRequire(import.meta.url)('../plugins/craftmine-world/creation-application-guidance.cjs');
const context={projectId:'project',sessionId:'session',turnId:'turn'},target={format:'craftmine.creation-target/1',worldId:'world',snapshotId:'snapshot',authorization:'full-auto',autoApply:true};
const application={worldId:'world',jobId:'job',buildId:'build',candidateId:'candidate',status:'deferred',reason:'CREATION_TURN_BUSY'};
const job={...application,kind:'check',status:'passed',creationApplication:application};

test('current permission downgrade changes model context and actual guidance without mutating frozen authority',async()=>{
 let auto=true,reads=0;const deps={bound:(owner,id)=>{assert.deepEqual(owner,context);assert.equal(id,'world');reads++;return target;},fullAuto:async id=>{assert.equal(id,'session');return auto;}};
 const permitted=await readCurrentCreationCapture(context,'world',deps);assert.equal(guide('world',permitted,job,context).playerActionRequired,false);
 auto=false;const ask=await readCurrentCreationCapture(context,'world',deps),result=guide('world',ask,job,context);
 assert.equal(ask.autoApply,false);assert.equal(target.autoApply,true);assert.equal(reads,4);
 assert.equal(result.mode,'manual-or-unavailable');assert.equal(result.adoptionConfirmed,false);assert.equal(result.playerActionRequired,null);
 assert.equal(result.nextAction,'report-actual-application-state');
});

test('permission await rechecks the captured target and never returns a disappeared or crossed world',async()=>{
 for(const changed of [null,{...target,worldId:'foreign'}]){let current=target;const result=await readCurrentCreationCapture(context,'world',{bound:()=>current,fullAuto:async()=>{current=changed;return true;}});assert.equal(result,null);}
 let count=0;assert.equal(await readCurrentCreationCapture(context,'world',{bound:()=>({...target,worldId:'foreign'}),fullAuto:async()=>{count++;return true;}}),null);assert.equal(count,0);
});

test('early project context distinguishes full-auto from Ask without claiming any adoption',()=>{
 const automatic=guide('world',target,null,context);assert.equal(automatic.mode,'full-auto');assert.equal(automatic.adoptionConfirmed,false);assert.equal(automatic.nextAction,'complete-edit-check-then-finish-turn');
 assert.equal(guide('world',target,null,{...context,unexpected:true}).mode,'manual-or-unavailable');
 assert.equal(guide('world',{...target,autoApply:false},null,context).playerActionRequired,null);
});

test('manual, failures, stale source and mismatched job receipts retain their different facts',()=>{
 const manual=guide('world',{...target,autoApply:false},{...job,creationApplication:{...application,status:'manual'}},context);
 assert.equal(manual.playerActionRequired,true);assert.equal(manual.adoptionConfirmed,false);assert.match(manual.playerMessage,/确认采用/);
 const superseded=guide('world',target,{...job,creationApplication:{...application,status:'manual',reason:'CREATION_CHECK_SUPERSEDED'}},context);assert.equal(superseded.nextAction,'read-latest-result');assert.equal(superseded.playerActionRequired,null);
 for(const status of ['failed','cancelled','interrupted','unknown']){const result=guide('world',target,{...job,creationApplication:{...application,status}},context);assert.equal(result.adoptionConfirmed,false);assert.equal(result.playerActionRequired,null);}
 const stale=guide('world',target,{...job,sourceStale:true},context);assert.equal(stale.nextAction,'check-current-source');assert.equal(stale.playerActionRequired,null);
 for(const mismatch of [{jobId:'other'},{worldId:'other'},{buildId:'other'},{candidateId:'other'}]){const result=guide('world',target,{...job,creationApplication:{...application,...mismatch}},context);assert.equal(result.nextAction,'read-exact-application-state');assert.equal(result.playerActionRequired,null);}
 assert.equal(guide('world',target,{...job,creationApplication:{...application,status:'applied'}},context).adoptionConfirmed,true);
 assert.deepEqual(job.creationApplication,application,'presentation never rewrites the original status or reason');
});
