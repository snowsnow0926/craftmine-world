import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {godotCopyProgressIdentity,createGodotWorldCopyService,godotCopyTarget} from '../../vendor/pi-desktop/apps/desktop/electron/main/godot-world-copy-service.ts';
const source={format:'craftmine.godot-progress/1',worldId:'source',baseId:'mining-sandbox',baseVersion:'1.0.0',stateVersion:1,body:{format:'craftmine.godot-mining-sandbox-managed/1',worldId:'source',chunks:{'0_0':{cells:[[8,12,'air'],[9,12,'stone_brick']],revision:2}},state:{format:'craftmine.godot-mining-sandbox-state/1',worldId:'source',inventory:{stone:5},flags:[{id:'source'}],ledger:[{requestId:'source',result:{detail:'source'}}]}}};
test('mining progress copy changes only three defined identity fields',()=>{
  const original=structuredClone(source),expected=structuredClone(source);expected.worldId='target';expected.body.worldId='target';expected.body.state.worldId='target';
  assert.deepEqual(godotCopyProgressIdentity(source,'source','target'),expected);assert.deepEqual(source,original);
  const other=structuredClone(source);other.baseId='top-down';assert.equal(godotCopyProgressIdentity(other,'source','target').body.state.worldId,'source','non-mining nested gameplay field is not a granted identity rewrite');
});
test('mixed identity and unknown mining state formats cannot become a copied save',()=>{
  for(const [path,value]of [[['body','state','worldId'],'foreign'],[['body','format'],'unknown'],[['body','state','format'],'unknown']]){
    const bad=structuredClone(source);let parent=bad;for(const key of path.slice(0,-1))parent=parent[key];parent[path.at(-1)]=value;
    assert.throws(()=>godotCopyProgressIdentity(bad,'source','target'),/IDENTITY_MISMATCH/);
  }
});
function fixture(mixed=false){
  const input={worldId:'source',operationId:'mining-copy-one'},target=godotCopyTarget(input.worldId,input.operationId),copy=godotCopyProgressIdentity(source,'source',target);
  if(mixed)copy.body.state.worldId='source';let selected='source',exists=false,started=0;
  const origin={targetWorldId:target,originalSourceWorldId:'source',progressMode:'formal',copyId:'gcopy-'+createHash('sha256').update('craftmine.godot-world-copy/1|source|'+target).digest('hex')};
  const options={selection:async()=>selected,checkpoint:async()=>({status:'persisted',receipt:{format:'craftmine.godot-progress-receipt/1',worldId:'source',revision:4,buildId:'formal'}}),open:async id=>{selected=id;},start:async()=>{started++;return {status:'ready'};},domain:async(method,args)=>{
    if(method==='godotWorld.copyStatus')return exists?origin:null;
    if(method==='godotRuntime.describe')return args.worldId==='source'?{phase:'formal',worldId:'source',snapshot:source}:{phase:'formal',worldId:target,buildId:'rebuilt',snapshot:copy};
    if(method==='world.read')return {revision:4,world:{build:{id:'formal'},snapshot:args.id==='source'?source:copy}};
    if(method==='godotWorld.copy'){exists=true;return {};}
    if(method==='content.status')return {backend:'git'};
    if(['godotWorld.prepareRebuildSource','godotWorld.prepareCopyRuntime'].includes(method))return {};
    throw Error(method);
  }};
  return {input,options,get started(){return started;}};
}
test('host expected checkpoint uses mining schema and retries existing copy after service reconstruction',async()=>{
  const f=fixture();assert.equal((await createGodotWorldCopyService(f.options).copy(f.input)).status,'ready');
  assert.equal((await createGodotWorldCopyService(f.options).copy(f.input)).status,'ready');assert.equal(f.started,2);
});
test('old two-field copy receipt is rejected before the target is opened or rebuilt',async()=>{
  const f=fixture(true);await assert.rejects(createGodotWorldCopyService(f.options).copy(f.input),/IDENTITY_MISMATCH/);assert.equal(f.started,0);assert.equal(await f.options.selection(),'source');
});
