import assert from 'node:assert/strict';
import test from 'node:test';
import {register} from 'node:module';
register(new URL('./helpers/ts-import-hooks.mjs', import.meta.url));
const {parseWorldCapabilities} = await import('../src/lib/craftmine-worlds.ts');
const {worldAssetPrompt, appendWorldAssetRequest} = await import('../src/lib/world-asset-request.ts');
const {parseSourceProposals, sourcePackageRequest, sourceJobState} = await import('../src/lib/source-reuse.ts');
const hash='a'.repeat(64);

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
