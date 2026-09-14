import assert from 'node:assert/strict';
import test from 'node:test';
import {register} from 'node:module';
register(new URL('./helpers/ts-import-hooks.mjs', import.meta.url));
const {parseWorldCapabilities} = await import('../src/lib/craftmine-worlds.ts');
const {worldAssetPrompt, appendWorldAssetRequest} = await import('../src/lib/world-asset-request.ts');
const {parseSourceProposals, sourcePackageRequest, sourceJobState, parseSourceJob} = await import('../src/lib/source-reuse.ts');
const {createCraftminePackageService} = await import('../electron/main/craftmine-package-service.ts');
const hash='a'.repeat(64);

test('only verified frozen archive declarations block a retained proposal',()=>{
 const ref={assetId:'combat',version:1,contentHash:hash},proposal={proposalId:'source-'+'b'.repeat(48),worldId:'w1',displayName:'Combat',status:'proposed',source:{revision:1,manifestHash:hash},archiveRef:ref,archiveSha256:hash};
 const availability={scope:'frozen-proposal-archive-declaration',status:'blocked-declaration',archives:[{archiveRef:ref,archiveSha256:hash,verified:true,status:'blocked-declaration',issues:[{resourceId:'combat',reason:'PACKAGE_SINGLE_ENTITY_DECLARATION_REQUIRED'}]}]};
 const parse=value=>parseSourceProposals({worldId:'w1',items:[{...proposal,installationAvailability:value}]},'w1')[0];
 assert.equal(parse(availability).installationAvailability.status,'blocked-declaration');assert.equal(parse(availability).status,'proposed');
 for(const mutate of [value=>value.archives[0].verified=false,value=>value.archives[0].archiveSha256='c'.repeat(64),value=>value.archives[0].archiveRef={...ref,version:2},value=>value.archives[0].issues[0].reason='UNKNOWN_PROBLEM']){const value=structuredClone(availability);mutate(value);assert.equal(parse(value).installationAvailability.status,'unknown');}
 const group={...proposal,kind:'group',items:[{archiveRef:ref,archiveSha256:hash},{archiveRef:ref,archiveSha256:hash}],installationAvailability:{...availability,archives:[availability.archives[0],availability.archives[0]]}};assert.equal(parseSourceProposals({worldId:'w1',items:[group]},'w1')[0].installationAvailability.status,'blocked-declaration');
});

test('examples retain host metadata and reject remote or executable previews', () => {
  const parse=preview=>parseWorldCapabilities({bases:[{id:'creation-sandbox',delivered:true,starters:[{id:'promo',kind:'example',delivered:true,label:'Dog',preview,source:{id:'promo',version:'1.0.0',sha256:hash},initialState:'authored-defaults'}]}]}).bases[0].starters[0];
  assert.equal(parse('https://example.com/track.png').preview,undefined);
  assert.equal(parse('data:image/svg+xml;base64,abcd').preview,undefined);
  assert.equal(parse('data:image/png;base64,iVBORw0KGgoAAA==').kind,'example');
  assert.deepEqual(parse('').source,{id:'promo',version:'1.0.0',sha256:hash});
  assert.equal(parse('').initialState,'authored-defaults');
});
test('reuse drafts pin version and preserve typed text and file references', () => {
  const asset={assetId:'cw.module.approved-pomeranian',version:1,contentHash:hash,displayName:'White Pom',mediaKind:'package'};
  const prompt=worldAssetPrompt(asset,false,true);
  assert(prompt.includes(JSON.stringify({assetId:asset.assetId,version:1,contentHash:hash})));
  const original={text:'Keep the city',fileReferences:[{path:'world.png',name:'World',kind:'image'}]};
  const next=appendWorldAssetRequest(original,prompt);assert(next.text.startsWith('Keep the city\n\n'));assert.deepEqual(next.fileReferences,original.fileReferences);assert.notEqual(next.fileReferences,original.fileReferences);
  assert.match(worldAssetPrompt({...asset,mediaKind:'model'},true,false),/Ask which appearance or behavior/);
  assert.match(worldAssetPrompt({...asset,mediaKind:'model'},false,false),/This is a model/);
  assert.throws(()=>worldAssetPrompt({...asset,contentHash:'latest'},false,true),/INVALID_ASSET_REFERENCE/);
});
test('durable proposal restores the exact job and rejects cross-world receipts', async () => {
  const proposal={proposalId:'source-'+'a'.repeat(48),worldId:'w1',displayName:'Pom',status:'check-queued',source:{revision:7,manifestHash:hash},archiveRef:{assetId:'pom',version:1,contentHash:hash},installation:{job:{jobId:'gjob-'+hash,status:'queued'},instanceIds:['pet1']}};
  assert.equal(parseSourceProposals({worldId:'w1',items:[proposal]},'w1')[0].job.id,'gjob-'+hash);
  assert.throws(()=>parseSourceProposals({worldId:'w2',items:[proposal]},'w1'),/RECEIPT_INVALID/);
  let actual;await sourcePackageRequest({call:async(...args)=>{actual=args;}},'w1','installSourceProposal',{proposalId:proposal.proposalId,worldId:'wrong'});
  assert.deepEqual(actual,['package.request',{worldId:'w1',method:'installSourceProposal',params:{worldId:'w1',proposalId:proposal.proposalId}}]);
  assert.equal(sourceJobState({worldId:'w1',jobId:'gjob-'+hash,status:'failed'},'w1','gjob-'+hash),'failed');
  assert.throws(()=>sourceJobState({worldId:'w2',jobId:'gjob-'+hash,status:'passed'},'w1','gjob-'+hash));
});
test('historical source checks retain failure and only accept explicit stale evidence',()=>{
 const receipt={worldId:'w1',jobId:'gjob-'+hash,status:'failed'};
 assert.deepEqual(parseSourceJob({...receipt,sourceStale:true},'w1',receipt.jobId),{id:receipt.jobId,status:'failed',sourceStale:true});
 assert.deepEqual(parseSourceJob(receipt,'w1',receipt.jobId),{id:receipt.jobId,status:'failed'});
 assert.equal(parseSourceJob({...receipt,sourceStale:false},'w1',receipt.jobId).sourceStale,false);
 assert.throws(()=>parseSourceJob({...receipt,sourceStale:'true'},'w1',receipt.jobId),/RECEIPT_INVALID/);
});
test('native source-job projection carries only the current core staleness flag, never later-success claims',async()=>{
 const jobId='gjob-'+hash;let sourceStale=true;
 const service=createCraftminePackageService({selection:()=> 'w1',pickFile:async()=>{throw Error('unexpected picker');},domainCall:async(method,args)=>{
  assert.equal(method,'package.sourceJob');assert.deepEqual(args,{worldId:'w1',jobId});
  return {worldId:'w1',jobId,status:'failed',sourceStale,privatePath:'private-source-path',laterPassed:true};
 }});
 const read=()=>service.request('package.request',{worldId:'w1',method:'sourceJob',params:{worldId:'w1',jobId}});
 assert.deepEqual(await read(),{worldId:'w1',jobId,status:'failed',terminal:true,sourceStale:true});
 sourceStale=false;assert.equal((await read()).sourceStale,false);
 sourceStale='true';await assert.rejects(read(),/PACKAGE_JOB_RECEIPT_INVALID/);
});
