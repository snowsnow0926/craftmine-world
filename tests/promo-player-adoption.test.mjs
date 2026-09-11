import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {validateAdoptionReport,inspectAdoptionSource,validateExplorationSource,validateExplorationCall,validateAdoptionCall,adoptionEnvironment,modelFreeExecutionEvidence} from './helpers/promo-adoption-contract.mjs';
import {assertProofs} from './helpers/promo-checkpoint-contract.mjs';
const submittedAt='2026-09-12T01:00:00.000Z',endedAt='2026-09-12T01:01:00.000Z';
function report(){return {format:'craftmine.promo-player/1',worldId:'world-a',sessionId:'session-a',submittedAt,endedAt,stateIntegrityVerified:true,
 packageIdentity:{packaged:path.resolve('fixed-package'),inventorySha256:'a'.repeat(64)},exitReport:{violations:[],pageErrors:[],shutdownFailures:[]},
 before:{active:false,job:{jobId:'prior-job'},observation:{worldId:'world-a',buildId:'prior-build'}},
 latest:{active:false,job:{jobId:'new-job',worldId:'world-a',buildId:'new-build',candidateId:'candidate-a',kind:'check',status:'passed',sourceStale:false,createdAt:Date.parse(submittedAt)+1000,output:{passed:true,check:{passed:true,assertions:[{passed:true}]}}}}};}
test('ordinary player result needs no evaluation ledger and never manufactures budget fields',()=>{
 const value=report(),unusedLedger=new Proxy({},{get(){throw Error('ledger must not be accessed');}}),selected=validateAdoptionReport(value,unusedLedger);
 assert.equal(selected.sourceFormat,value.format);assert.equal(selected.buildId,'new-build');assert.equal(Object.hasOwn(selected,'budget'),false);
});
test('old checks, reused jobs, unknown timestamps and source/world changes are rejected',()=>{
 for(const change of [r=>r.latest.job.createdAt=Date.parse(submittedAt)-1,r=>r.latest.job.createdAt=Date.parse(endedAt)+1,r=>delete r.latest.job.createdAt,r=>r.latest.job.createdAt=String(Date.parse(submittedAt)),r=>r.latest.job.jobId='prior-job',r=>r.latest.job.sourceStale=true,r=>r.before.observation.worldId='other',r=>r.latest.job.worldId='other',r=>r.latest.job.sessionId='other',r=>r.submittedAt='not-a-date']){
  const value=report();change(value);assert.throws(()=>validateAdoptionReport(value));
 }
});
test('model stop, clean exit, real check evidence and source integrity remain mandatory',()=>{
 for(const change of [r=>r.latest.active=true,r=>r.stateIntegrityVerified=false,r=>delete r.stateIntegrityVerified,r=>delete r.sessionId,r=>r.forcedStop=true,r=>r.exitReport.pageErrors=['failure'],r=>r.latest.job.output.check.assertions=[],r=>r.latest.job.output.passed=false]){const value=report();change(value);assert.throws(()=>validateAdoptionReport(value));}
});
test('ordinary report inspection preserves report/marker and never opens even an invalid ledger path',t=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'player-adoption-'));t.after(()=>{assert.equal(path.dirname(base),path.resolve(os.tmpdir()));fs.rmSync(base,{recursive:true,force:true});});
 const out=path.join(base,'test-results','desktop-native-player'),profile=path.join(out,'profile'),legacy=path.join(out,'legacy');fs.mkdirSync(profile,{recursive:true});fs.mkdirSync(legacy);
 const file=path.join(out,'player-report.json'),marker=path.join(profile,'headless-profile.json');fs.writeFileSync(file,JSON.stringify(report()));
 fs.writeFileSync(marker,JSON.stringify({format:'craftmine.headless-profile/1',token:'fixture-token',legacySource:legacy}));
 fs.mkdirSync(path.join(profile,'creation-evaluation-budget.json')); // Any legacy ledger read would throw.
 const inspected=inspectAdoptionSource(file);assert.equal(inspected.budgetFile,null);assert.equal(inspected.proofs.length,2);assertProofs(inspected.proofs);
 fs.appendFileSync(marker,' ');assert.throws(()=>assertProofs(inspected.proofs),/SOURCE_CHANGED/);
});
test('exploration pins ordinary player world/candidate/build and exact frozen package',()=>{
 const original=report(),source={original,selection:validateAdoptionReport(original)},adoption={format:'craftmine.promo-adoption/1',ok:true,worldId:'world-a',candidateId:'candidate-a',after:{worldId:'world-a',buildId:'new-build'}};
 validateExplorationSource(adoption,source,original.packageIdentity);
 for(const changed of [{...adoption,candidateId:'old'},{...adoption,worldId:'other'},{...adoption,after:{worldId:'world-a',buildId:'prior-build'}}])assert.throws(()=>validateExplorationSource(changed,source,original.packageIdentity));
 assert.throws(()=>validateExplorationSource(adoption,source,{inventorySha256:'b'.repeat(64)}),/FROZEN_PACKAGE_CHANGED/);
});
test('model-free claim depends on clean audit and strictly non-model controller calls',()=>{
 const audit=report().exitReport;assert.equal(modelFreeExecutionEvidence(audit,['primaryMode','worldPanel:godot.candidateApply','quit']).modelCallsAdded,0);
 assert.throws(()=>modelFreeExecutionEvidence(audit,['playerPrompt']));assert.throws(()=>modelFreeExecutionEvidence(audit,[]));assert.throws(()=>modelFreeExecutionEvidence({...audit,violations:['focus']},['quit']));
 const selection=validateAdoptionReport(report());
 for(const method of ['initialize','playerConfigure','playerPrompt','askToolResolve','agentPrompt']){assert.throws(()=>validateAdoptionCall(method,{},selection));assert.throws(()=>validateExplorationCall(method,{},selection));}
 validateExplorationCall('worldPanel',{channel:'godot.runtimeResume',payload:{worldId:'world-a'}},selection);
 assert.throws(()=>validateExplorationCall('worldPanel',{channel:'world.create',payload:{}},selection));
 const env=adoptionEnvironment({environment:()=>({CRAFTMINE_HEADLESS_TOKEN:'fixture',CRAFTMINE_CREATION_EVAL:'1',CRAFTMINE_PLAYER_MODEL:'provider',CRAFTMINE_NORMAL_PLAYER:'1',OPENAI_API_KEY:'secret'})},{});assert.deepEqual(env,{CRAFTMINE_HEADLESS_TOKEN:'fixture'});
});
