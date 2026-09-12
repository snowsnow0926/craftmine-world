import assert from 'node:assert/strict';
export function acceptCurrentPreviewReceipt(binding,receipt){assert.equal(receipt?.status,'preview');assert.equal(receipt.worldId,binding.worldId);assert.equal(receipt.candidateId,binding.candidateId);assert.equal(receipt.buildId,binding.candidateBuildId);binding.activePreviewCandidateId=receipt.candidateId;}
export function clearCurrentPreview(binding){delete binding.activePreviewCandidateId;}
export function validateSourceViewPreparationCall(method,fields={},binding){
 if(method==='worldPanel')assert.ok(['godot.runtimeResume','godot.runtimeSave'].includes(fields.channel)||fields.channel==='package.request'&&fields.payload?.method==='sourceList','VIEW_PREPARATION_MUTATION_DENIED');
 validateSourceProposalAdoptionCall(method,fields,binding);
}
export function inspectModelSourceProposal(report,proposalId){
 assert.equal(report?.format,'craftmine.promo-player/1');assert.equal(report.status,'SETTLED_UNVERIFIED');assert.equal(report.stateIntegrityVerified,true);assert.equal(report.latest?.active,false);assert.equal(report.forcedStop,undefined);assert.equal(report.closeoutError,undefined);assert.ok(Number.isFinite(Date.parse(report.endedAt))&&Date.parse(report.endedAt)>=Date.parse(report.submittedAt));
 for(const field of ['violations','pageErrors','shutdownFailures'])assert.deepEqual(report.exitReport?.[field],[]);
 assert.equal(report.creationEvaluation,false);assert.equal(report.latest.observation.worldId,report.worldId);
 const before=report.sourceProposalsBefore?.items??[],after=report.sourceProposalsAfter?.items;
 assert.ok(Array.isArray(after));assert.ok(!before.some(p=>p.proposalId===proposalId),'PROPOSAL_MUST_BE_NEW');
 const matches=after.filter(p=>p.proposalId===proposalId);assert.equal(matches.length,1);const proposal=matches[0];
 assert.equal(proposal.worldId,report.worldId);assert.equal(proposal.status,'proposed');assert.equal(proposal.applied,false);assert.equal(proposal.requiresPlayerAction,true);
 const evidence=report.sourceLibraryCalls?.filter(c=>c.status==='success'&&c.result?.details?.proposal?.proposalId===proposalId);assert.equal(evidence?.length,1,'MODEL_PROPOSAL_EVIDENCE_REQUIRED');assert.deepEqual(evidence[0].result.details.proposal,proposal);
 assert.ok(Number.isSafeInteger(proposal.source?.revision)&&/^[a-f0-9]{64}$/.test(proposal.source?.manifestHash));
 if(proposal.kind==='group'){assert.equal(evidence[0].args.mode,'propose-group');assert.ok(proposal.items.length>=2&&proposal.items.length<=8);assert.equal(evidence[0].args.items.length,proposal.items.length);}
 else assert.equal(evidence[0].args.mode,'propose');
 return proposal;
}
export function validateSourceProposalAdoptionCall(method,fields={},binding){
 const empty=['status','godotObserve','godotCaptureBoundState','quit'];if(empty.includes(method)){assert.deepEqual(fields,{});return;}
 if(method==='primaryMode'){assert.ok(Object.keys(fields).length===0||['create','play','entry'].some(action=>JSON.stringify(fields)===JSON.stringify({payload:{action}})));return;}
 if(method==='godotCaptureBoundView'){assert.deepEqual(Object.keys(fields),['payload']);assert.equal(fields.payload.worldId,binding.worldId);assert.equal(fields.payload.buildId,binding.captureIdentity?.buildId);assert.deepEqual(fields.payload,binding.captureIdentity);return;}
 if(method==='godotExplore'){assert.deepEqual(Object.keys(fields),['payload']);assert.deepEqual(fields.payload,binding.exploreRequest);assert.equal(fields.payload.worldId,binding.worldId);assert.equal(fields.payload.buildId,binding.formalBuildId);assert.ok(Array.isArray(fields.payload.steps)&&fields.payload.steps.length<=8&&fields.payload.steps.every(s=>['walk','look','wait'].includes(s.op)));return;}
 assert.deepEqual(Object.keys(fields).sort(),['channel','payload']);assert.equal(method,'worldPanel');assert.equal(fields.payload.worldId,binding.worldId);
 if(fields.channel==='godot.runtimeSave'){assert.ok(binding.adoptOnly===true||binding.allowReframeSave===true&&binding.reframeOnly===true);assert.deepEqual(fields.payload,{worldId:binding.worldId,freeze:true});return;}
 if(fields.channel==='godot.candidateApply'){assert.equal(binding.adoptOnly,true);assert.equal(typeof binding.candidateId,'string');assert.equal(binding.activePreviewCandidateId,binding.candidateId,'CURRENT_PREVIEW_REQUIRED');assert.deepEqual(fields.payload,{worldId:binding.worldId,candidateId:binding.candidateId});return;}
 if(fields.channel==='package.request'){
  const {method,params}=fields.payload;assert.deepEqual(Object.keys(fields.payload).sort(),['method','params','worldId']);
  const expected=method==='installSourceProposal'?{worldId:binding.worldId,proposalId:binding.proposalId}:method==='sourceJob'?{worldId:binding.worldId,jobId:binding.jobId}:{worldId:binding.worldId};
  assert.ok(['sourceProposals','sourceList','installSourceProposal','sourceJob'].includes(method));if(binding.reframeOnly)assert.ok(['sourceList','sourceJob'].includes(method));if(method==='sourceJob')assert.equal(typeof binding.jobId,'string');assert.deepEqual(params,expected);return;
 }
 const payload=['godot.runtimeResume','godot.candidateClose'].includes(fields.channel)?{worldId:binding.worldId}:fields.channel==='godot.candidateList'?{worldId:binding.worldId,offset:0,limit:32}:{worldId:binding.worldId,candidateId:binding.candidateId};
 assert.ok(['godot.runtimeResume','godot.candidateList','godot.candidateRead','godot.candidatePreview','godot.candidateClose'].includes(fields.channel));if(fields.channel.startsWith('godot.candidate')&&!['godot.candidateList','godot.candidateClose'].includes(fields.channel))assert.equal(typeof binding.candidateId,'string');assert.deepEqual(fields.payload,payload);
}
