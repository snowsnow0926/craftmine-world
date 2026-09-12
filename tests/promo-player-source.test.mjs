import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {inspectPlayerSource} from './helpers/promo-player-source.mjs';
import {assertProofs} from './helpers/promo-checkpoint-contract.mjs';
function fixture(t){
 fs.mkdirSync('test-results',{recursive:true});const out=fs.mkdtempSync(path.resolve('test-results/desktop-native-player-source-'));
 t.after(()=>{assert.ok(path.resolve(out).startsWith(path.resolve('test-results')+path.sep));fs.rmSync(out,{recursive:true,force:true});});
 const profile=path.join(out,'profile'),legacy=path.join(out,'legacy');fs.mkdirSync(profile);fs.mkdirSync(legacy);
 const file=(name,value)=>{const full=path.join(out,name);fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,JSON.stringify(value));return full;};
 const worldId='world',buildId='build',identity={revision:6,manifestHash:'a'.repeat(64)},source={worldId,branchId:'main',...identity};
 const audit={violations:[],pageErrors:[],shutdownFailures:[]},launches=[{audit,exit:{code:0,signal:null}},{audit,exit:{code:0,signal:null}}];
 const base={format:'craftmine.builtin-prefab-demo/1',worldId,modelCalls:0,creationEvaluation:false};
 const root=file('report.json',base),original={...base,sourceReport:root,installations:[{assetId:'tree',installed:{instanceIds:['one']},finished:{status:'passed'},applied:{status:'applied',worldId}},{assetId:'wall',operationId:'operation',archiveSha256:'b'.repeat(64)}]};
 const originalReport=file('resume.json',original);
 const intent={worldId,applyRequest:{operation:{operationId:'operation'}},archiveSha256:'b'.repeat(64),job:{jobId:'old-job'},receipt:identity,instanceIds:['two']};
 const intentFile=file('profile/intent.json',intent);
 const completedComponents=[{assetId:'tree',instanceIds:['one']},{assetId:'wall',instanceIds:['two']}],instances={...source,truncated:false,items:[{entityId:'one-e0'},{entityId:'two-e0'}]};
 const record={role:'developer-arranged-prefab-demo',worldId,modelCalls:0,sourceEdits:0,installationRetries:0,unresolvedInstallations:[],completedComponents,launches,packageIdentity:{inventorySha256:'c'.repeat(64)}};
 const job={worldId,buildId,jobId:'new-job',status:'passed',sourceStale:false,sourceRevision:6,manifestHash:identity.manifestHash};
 const candidate={...job,checkJobId:job.jobId,candidateId:'candidate'};
 const recovery={...record,format:'craftmine.prefab-check-recovery/1',originalReport,ok:false,error:'WORLD_BUSY',recheckIntent:{file:intentFile,originalJobId:'old-job',source:identity,instanceIds:['two']},sourceBefore:source,sourceAfter:source,instanceSourceBefore:instances,instanceSourceAfter:instances,checkRequest:job,checkedJob:job,candidate:{candidate,checkStatus:'passed',check:{assertions:[{passed:true}]}},applied:{status:'applied',worldId,candidateId:'candidate',record:{world:{build:{id:buildId}}}},finalBuild:buildId,saved:{worldId,buildId}};
 const recoveryFile=file('recovery/report.json',recovery);
 const reopened={...record,format:'craftmine.prefab-reopen-verification/1',originalReport:recoveryFile,sourceReport:recoveryFile,profileRoot:profile,ok:true,checksIssued:0,noModelExecution:{modelCallsAdded:0},expectedBuild:buildId,before:{worldId,buildId,instanceId:'first'},reopened:{worldId,buildId,instanceId:'second'},saved:{worldId,buildId}};
 const input=file('reopen/report.json',reopened);file('profile/headless-profile.json',{format:'craftmine.headless-profile/1',token:'fixture',legacySource:legacy});
 return{out,profile,input,recoveryFile,recovery,reopened,file};
}
test('successful cold reopen follows six original files to original profile without rewriting failed report',t=>{
 const f=fixture(t),before=fs.readFileSync(f.recoveryFile),r=inspectPlayerSource(f.input,{createSession:true});assert.equal(r.out,f.out);assert.equal(r.profile,f.profile);assert.equal(r.proofs.length,6);assert.equal(r.recoveryBinding.revision,6);assert.deepEqual(fs.readFileSync(f.recoveryFile),before);
 fs.appendFileSync(f.recoveryFile,' ');assert.throws(()=>assertProofs(r.proofs),/CHECKPOINT_SOURCE_CHANGED/);
});
test('merely flipping failed check-recovery ok cannot replace cold-reopen evidence',t=>{
 const f=fixture(t);f.recovery.ok=true;f.file('recovery/report.json',f.recovery);assert.throws(()=>inspectPlayerSource(f.recoveryFile,{createSession:true}));
});
test('changed world, profile, source identity and dirty audit each reject',t=>{
 for(const mutate of [f=>{f.reopened.worldId='other';},f=>{f.reopened.profileRoot=f.out;},f=>{f.recovery.sourceAfter={...f.recovery.sourceAfter,manifestHash:'d'.repeat(64)};},f=>{f.reopened.launches[0].audit.pageErrors=['error'];}]){
  const f=fixture(t);mutate(f);f.file('recovery/report.json',f.recovery);f.file('reopen/report.json',f.reopened);assert.throws(()=>inspectPlayerSource(f.input,{createSession:true}));
 }
});
test('failed check or extra component cannot be rescued by a successful reopen flag',t=>{
 for(const mutate of [f=>{f.recovery.checkedJob.status='failed';},f=>{f.reopened.completedComponents.push({assetId:'invented',instanceIds:['three']});}]){
  const f=fixture(t);mutate(f);f.file('recovery/report.json',f.recovery);f.file('reopen/report.json',f.reopened);assert.throws(()=>inspectPlayerSource(f.input,{createSession:true}));
 }
});

test('ordinary existing-session reports and complete direct demos keep their original root',t=>{
 const f=fixture(t),file=f.file('player.json',{format:'craftmine.promo-player/1',worldId:'world',sessionId:'existing'});
 const old=inspectPlayerSource(file);assert.equal(old.sessionId,'existing');assert.equal(old.profile,f.profile);assert.equal(old.recoveryBinding,undefined);
 const demo=f.file('complete-demo.json',{format:'craftmine.builtin-prefab-demo/1',worldId:'world',ok:true,stateIntegrityVerified:true});
 assert.equal(inspectPlayerSource(demo,{createSession:true}).profile,f.profile);
});

test('packaged pet continuation requires adopted provenance and exact cold-reopened progress',t=>{
 const f=fixture(t),worldId='world',buildId='build',candidate={worldId,buildId,candidateId:'candidate',checkJobId:'job',sourceRevision:2,manifestHash:'a'.repeat(64),content:{branchId:'main'}};
 const original={format:'craftmine.pet-product-demo/1',worldId,modelCalls:0,creationEvaluation:false,check:{status:'passed',jobId:'job'},checked:{checkStatus:'passed',check:{assertions:[{passed:true}]},candidate},applied:{status:'applied',worldId,candidateId:'candidate',record:{world:{build:{id:buildId}}}},packageIdentity:{inventorySha256:'b'.repeat(64)},source:{revision:2,manifestHash:'a'.repeat(64),items:[{supported:true,entityId:'pet'}]}};
 const originalFile=f.file('pet.json',original),snapshot={worldId,body:{worldId,components:{pet:{entityId:'pet',format:'craftmine.pet-companion-state/1',interactionCount:2}}}};
 const continuation={format:'craftmine.pet-product-continuation/2',sourceReport:originalFile,worldId,entityId:'pet',ok:true,modelCalls:0,launches:f.reopened.launches,packageInventorySha256:'b'.repeat(64),opened:{worldId,buildId,instanceId:'first'},reopened:{worldId,buildId,instanceId:'second'},saved:{format:'craftmine.godot-progress-receipt/1',worldId,buildId,instanceId:'first'},savedSnapshot:snapshot,reopenedSnapshot:snapshot};
 const input=f.file('pet-continuation/report.json',continuation),inspected=inspectPlayerSource(input,{createSession:true});
 assert.equal(inspected.profile,f.profile);assert.equal(inspected.recoveryBinding.revision,2);assert.equal(inspected.proofs.length,3);
 for(const mutate of [r=>r.ok=false,r=>r.savedSnapshot.body.components.pet.interactionCount=0,r=>r.reopenedSnapshot.worldId='other',r=>r.packageInventorySha256='c'.repeat(64),r=>r.reopened.instanceId='first',r=>r.entityId='different']){
  const invalid=structuredClone(continuation);mutate(invalid);f.file('pet-continuation/report.json',invalid);assert.throws(()=>inspectPlayerSource(input,{createSession:true}));
 }
 f.file('pet-continuation/report.json',continuation);original.check.status='failed';f.file('pet.json',original);assert.throws(()=>inspectPlayerSource(input,{createSession:true}));
});
