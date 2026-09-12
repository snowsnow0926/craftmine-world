import assert from 'node:assert/strict';
export const LEGACY_BASE_CASES=[
 {baseId:'first-person',starterId:'blank',gameplay:'godotExplore'},
 {baseId:'top-down',starterId:'town',gameplay:'godotPlayTown'},
 {baseId:'side-view',starterId:'ruins',gameplay:'godotPlayRuins'},
 {baseId:'mining-sandbox',starterId:'mine-camp',gameplay:'godotPlayMine'},
];
export function isWorldBusyPreflight(error){
 let message=error?.message;if(typeof message!=='string')return false;
 if(message.startsWith('Error: '))message=message.slice(7);
 const wrapper="Error invoking remote method 'pi-plugin-panel-invoke': ";
 if(message.startsWith(wrapper)){message=message.slice(wrapper.length);if(message.startsWith('Error: '))message=message.slice(7);}
 return message==='WORLD_BUSY';
}
export function assertLegacyCheck(baseId,worldId,observed,candidate,job){
 assert.equal(observed.format,'craftmine.godot-observation/1');assert.equal(observed.baseId,baseId);assert.equal(observed.worldId,worldId);
 assert.equal(candidate.worldId,worldId);assert.equal(candidate.buildId,observed.buildId);assert.equal(candidate.checkJobId,job.jobId);
 assert.equal(candidate.baseId,baseId);assert.equal(candidate.sourceRevision,job.sourceRevision);assert.equal(candidate.manifestHash,job.manifestHash);assert.equal(candidate.assetManifestHash,job.assetManifestHash);assert.equal(candidate.checkOutputHash,job.outputHash);
 assert.equal(job.worldId,worldId);assert.equal(job.baseId,baseId);assert.equal(job.buildId,observed.buildId);assert.equal(job.kind,'check');assert.equal(job.status,'passed');
 assert.equal(job.executorId,'craftmine-windows-broker-v1');assert.equal(job.output?.passed,true);assert.equal(job.output?.import?.passed,true);assert.equal(job.output?.compile?.passed,true);assert.equal(job.output?.check?.passed,true);
 for(const id of ['runtime.ready','runtime.frame','runtime.no-errors','runtime.snapshot','runtime.isolation','runtime.recovery']){const matches=job.output.check.assertions.filter(row=>row.id===id);assert.equal(matches.length,1,id);assert.equal(matches[0].passed,true,id);}
 assert.equal(job.output.engine.isolation,'craftmine.windows.lpac-registry.v1');
}
export function progress(snapshot){
 const state=snapshot?.state??snapshot?.result?.state;
 assert.equal(state?.format,'craftmine.godot-progress/1');assert.equal(typeof state.worldId,'string');assert.equal(state.body.worldId,state.worldId);return state;
}
export function assertLegacyCold(before,after){
 assert.equal(after.observation.worldId,before.observation.worldId);assert.equal(after.observation.baseId,before.observation.baseId);assert.equal(after.observation.buildId,before.observation.buildId);assert.notEqual(after.observation.instanceId,before.observation.instanceId);
 for(const value of [before,after]){const state=progress(value.snapshot);assert.equal(state.worldId,value.observation.worldId);assert.equal(state.baseId,value.observation.baseId);assert.equal(state.baseVersion,value.observation.baseVersion);}
 assert.deepEqual(progress(after.snapshot),progress(before.snapshot),'complete native progress must survive cold restart');
}
export function validateLegacyCall(method,payload={}){
 const exact=(allowed)=>assert.ok(Object.keys(payload).every(key=>allowed.includes(key)),method+' fields');
 if(['status','primaryMode','godotObserve','godotSnapshot','godotCaptureView','worldNavigationReady','quit','godotPlayTown','godotPlayRuins','godotPlayMine'].includes(method)){
  exact(method==='primaryMode'?['payload']:[]);if(method==='primaryMode')assert.deepEqual(payload,{payload:{action:'create'}});return;
 }
 if(method==='worldNavigation'){exact(['channel','payload']);assert.ok(['world.createOptions','world.list','world.create','world.open','godot.historyJob'].includes(payload.channel));return;}
 if(method==='worldPanel'){exact(['channel','payload']);assert.ok(['godot.candidateList','godot.runtimeSave','godot.runtimeResume'].includes(payload.channel));return;}
 if(method==='godotExplore'){exact(['payload']);assert.ok(payload.payload.steps.every(step=>['walk','wait'].includes(step.op)));return;}
 throw Error('UNSUPPORTED_LEGACY_BASE_DIAGNOSTIC_METHOD');
}
