import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{referenceHints,readSourceSnapshot,assessArchiveForSource}=require('../plugins/craftmine-world/source-library-read-hints.cjs');
const pin='a'.repeat(64),old='b'.repeat(64),file={path:'craftmine_shared/base_adapter.gd',sha256:pin},context={projectId:'p',sessionId:'s',turnId:'t'};
const source={worldId:'w',revision:4,manifestHash:'c'.repeat(64),baseId:'creation-sandbox',engineVersion:'4.7.2-stable'};
const resource=entry=>({manifest:{content:{assetId:'component',entry,compatibility:{base:'creation-sandbox',engine:'4.7.2-stable',baseVersion:'1.0.0'}}}});
test('installRef is the exact archive identity and never borrows the package resource hash',()=>{
  const ref={assetId:'component',version:2,contentHash:pin},hints=referenceHints(ref);assert.deepEqual(hints.installRef,ref);assert.deepEqual(hints.archiveRef,ref);assert.deepEqual(hints.readRequest,{mode:'read',ref});assert.match(hints.referenceRoles.rootRef,/never substitute/);hints.installRef.contentHash=old;assert.equal(ref.contentHash,pin);
});
test('all source pages share a verified pin and malformed/changing replies remain unknown',async()=>{
  const calls=[],call=async(method,args)=>{calls.push({method,args});return {...source,files:args.offset===0?[file]:[{path:'other.gd',sha256:old}],nextOffset:args.offset===0?1:null};};
  const result=await readSourceSnapshot(call,context,'w',()=>{});assert.equal(result.available,true);assert.equal(result.files.size,2);assert.equal(calls[1].args.revision,4);assert.equal(calls[1].args.manifestHash,source.manifestHash);assert(calls.every(row=>row.method==='godotProject.index'));
  const changed=await readSourceSnapshot(async(method,args)=>({...source,revision:args.offset?5:4,files:[file],nextOffset:args.offset?null:1}),context,'w',()=>{});assert.equal(changed.available,false);assert.equal(changed.reason,'SOURCE_LIBRARY_PREFLIGHT_SOURCE_CHANGED');
  const foreign=await readSourceSnapshot(async()=>({...source,worldId:'other',files:[],nextOffset:null}),context,'w',()=>{});assert.equal(foreign.available,false);assert.equal(foreign.reason,'SOURCE_LIBRARY_SOURCE_IDENTITY_REQUIRED');
});
test('legacy adapter mismatch is explicit while an exact controller profile only matches source prerequisites',()=>{
  const snapshot={available:true,source,files:new Map([[file.path,file]])};
  const legacy=assessArchiveForSource({resources:[resource({sourceRequirements:[{path:file.path,sha256:old}]})]},snapshot);assert.equal(legacy.status,'adaptation-required');assert.deepEqual(legacy.resources[0].requirements.required,[{path:file.path,expectedSha256:old,status:'changed'}]);
  const modern=assessArchiveForSource({resources:[resource({sourceRequirementProfiles:[{id:'legacy',requirements:[{path:file.path,sha256:old}]},{id:'controller-v1',requirements:[file]}]})]},snapshot);assert.equal(modern.status,'source-prerequisites-matched');assert.equal(modern.runtimeVerified,false);assert.equal(modern.installValidationRequired,true);assert.equal(modern.resources[0].baseVersionCheck,'not-assessed');assert.equal(modern.source.manifestHash,source.manifestHash);assert.equal(modern.resources[0].requirements.profiles.length,2);
  assert.equal(assessArchiveForSource({resources:[]},{available:false,reason:'unavailable'}).status,'unknown');
});
test('cancellation during an advisory read still propagates instead of becoming a compatibility hint',async()=>{
  let ended=false;await assert.rejects(()=>readSourceSnapshot(async()=>{ended=true;return {...source,files:[],nextOffset:null};},context,'w',()=>{if(ended)throw Error('TURN_ENDED');}),/TURN_ENDED/);
});
