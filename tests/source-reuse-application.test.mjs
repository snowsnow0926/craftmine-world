import test from 'node:test';import assert from 'node:assert/strict';import {register} from 'node:module';
register(new URL('../vendor/pi-desktop/apps/desktop/test/helpers/ts-import-hooks.mjs',import.meta.url));
const {createCraftminePackageService}=await import('../vendor/pi-desktop/apps/desktop/electron/main/craftmine-package-service.ts');
const {parseSourceJob}=await import('../vendor/pi-desktop/apps/desktop/src/lib/source-reuse.ts');
const jobId='gjob-'+'1'.repeat(64),candidateId='gcan-'+'2'.repeat(64),buildId='gbd-'+'3'.repeat(64);
function fixture(){
 const state={world:'world-one',job:{worldId:'world-one',jobId,candidateId,buildId,status:'passed',sourceRevision:6,manifestHash:'4'.repeat(64),outputHash:'5'.repeat(64)},candidate:{checkStatus:'passed',candidate:{worldId:'world-one',candidateId,buildId,checkJobId:jobId,status:'ready',sourceRevision:6,manifestHash:'4'.repeat(64),checkOutputHash:'5'.repeat(64)}},calls:[]};
 const service=createCraftminePackageService({selection:()=>state.world,pickFile:async()=>{throw Error('Unexpected picker');},domainCall:async(method,args)=>{state.calls.push({method,args});if(method==='package.sourceJob')return state.job;if(method==='godotCandidate.read')return state.candidate;throw Error(method);}});
 return {state,read:()=>service.request('package.request',{worldId:'world-one',method:'sourceJob',params:{worldId:'world-one',jobId}})};
}
test('passed check remains ready until Core attests actual adoption; later calls recover it without reinstall',async()=>{
 const f=fixture();assert.equal((await f.read()).application,'ready');
 f.state.candidate.adoption={worldId:'world-one',candidateId,buildId,wasApplied:true,inCurrentLineage:true};
 const applied=await f.read();assert.equal(applied.application,'applied');assert.equal(parseSourceJob(applied,'world-one',jobId).application,'applied');
 f.state.candidate.adoption.inCurrentLineage=false;assert.equal((await f.read()).application,'historical');
 assert.equal(f.state.calls.some(c=>/install|prepare|commit|update/i.test(c.method)),false);
});
test('a stale or unverified candidate never becomes applied based on model text or candidate status alone',async()=>{
 const f=fixture();f.state.candidate.candidate.status='applied';assert.equal((await f.read()).application,'unknown');
 f.state.candidate.adoption={worldId:'foreign',candidateId,buildId,wasApplied:true,inCurrentLineage:true};assert.equal((await f.read()).application,'unknown');
 f.state.candidate.candidate.checkOutputHash='6'.repeat(64);await assert.rejects(f.read(),/PACKAGE_CANDIDATE_RECEIPT_INVALID/);
 const other=fixture();other.state.job.sourceStale=true;assert.equal((await other.read()).application,'historical');
});
test('unknown or failed checks cannot carry success and exact world/job identities remain mandatory',async()=>{
 const f=fixture();f.state.job.status='failed';const failed=await f.read();assert.equal(failed.application,undefined);assert.equal(f.state.calls.length,1);
 assert.throws(()=>parseSourceJob({...failed,application:'applied'},'world-one',jobId),/RECEIPT_INVALID/);
 assert.throws(()=>parseSourceJob({...failed,status:'passed',application:'made-up'},'world-one',jobId),/RECEIPT_INVALID/);
 f.state.job.worldId='foreign';await assert.rejects(f.read(),/PACKAGE_JOB_RECEIPT_INVALID/);
});
