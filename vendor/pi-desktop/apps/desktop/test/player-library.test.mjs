import test from 'node:test';import assert from 'node:assert/strict';import{register}from'node:module';import{createHash}from'node:crypto';
register(new URL('./helpers/ts-import-hooks.mjs',import.meta.url));
const {createWorldTemplatePanel}=await import('../electron/main/world-template-panel.ts');
const {createLibraryPreviewCapture}=await import('../electron/main/library-preview.ts');
const {libraryReference,parsePlayerWorldTemplate,publicationMetadata}=await import('../src/lib/player-library.ts');
const {invokeCraftmineNavigation}=await import('../electron/main/craftmine-navigation-host.ts');
const hash='a'.repeat(64),ref={assetId:'player.world.example',version:1,contentHash:hash};
test('template navigation keeps exact reference and rejects renderer materialization paths',async()=>{
 let actual;const deps={navigate:async r=>{actual=r;return r;}};
 await invokeCraftmineNavigation({pluginId:'craftmine.world',channel:'world.create',payload:{title:'Copy',baseId:'creation-sandbox',starterId:'library',operationId:'operation-1',libraryRef:ref}},deps);
 assert.deepEqual(actual.libraryRef,ref);assert.notEqual(actual.libraryRef,ref);
 await assert.rejects(invokeCraftmineNavigation({pluginId:'craftmine.world',channel:'world.create',payload:{title:'Copy',baseId:'creation-sandbox',starterId:'library',libraryRef:{...ref,path:'C:/private'}}},deps),/INVALID_WORLD_TEMPLATE_REFERENCE/);
 await assert.rejects(invokeCraftmineNavigation({pluginId:'craftmine.world',channel:'world.create',payload:{title:'Copy',baseId:'craftmine-web/5',starterId:'library',libraryRef:ref}},deps));
});
test('publication metadata is bounded and saved progress is explicit in world reads',()=>{
 assert.deepEqual(publicationMetadata('component',' Lamp ','lights','街灯,灯','lamp,light'),{displayName:'Lamp',description:'lights',tags:['街灯','灯'],aliases:['lamp','light']});
 assert.throws(()=>publicationMetadata('world','x'.repeat(121),'','',''),/NAME_INVALID/);
 assert.throws(()=>libraryReference({...ref,version:0}),/INVALID_ASSET_REFERENCE/);
 const body={format:'craftmine.player-world-template/1',ref,kind:'world',action:'create-new-world',displayName:'Mine',description:'',initialState:'saved-progress',preview:'https://remote.invalid/image.png'};
 assert.equal(parsePlayerWorldTemplate(body).preview,undefined);
 assert.throws(()=>parsePlayerWorldTemplate({...body,initialState:'unknown'}),/WORLD_TEMPLATE_INVALID/);
});
test('world publication accepts only metadata and a host-owned preview',async()=>{
 let request;const preview={worldId:'w',buildId:'b',pngBase64:'host-data',sha256:hash};
 const service=createWorldTemplatePanel({selection:async()=> 'w',capturePreview:async()=>preview,pick:async()=>null,domain:async(...args)=>{request=args;return {ref};}});
 await service.request('worldTemplate.save',{worldId:'w',operationId:'operation-1',includePreview:true});assert.deepEqual(request,['worldTemplate.save',{worldId:'w',operationId:'operation-1',preview}]);
 await assert.rejects(service.request('worldTemplate.save',{worldId:'w',operationId:'operation-2',preview}),/INVALID_PARAMS/);
 await assert.rejects(service.request('worldTemplate.import',{operationId:'operation-3',archivePath:'C:/private'}),/INVALID_PARAMS/);
 await assert.rejects(service.request('worldTemplate.prepare',{ref,worldId:'w'}));service.dispose();await assert.rejects(service.request('worldTemplate.list',{}));
});
test('preview capture does not rebind a late native frame to another world',async()=>{
 const png=Buffer.alloc(40);Buffer.from('89504e470d0a1a0a','hex').copy(png);const sha=createHash('sha256').update(png).digest('hex');
 let world='w',resizes=[];const identity={worldId:'w',buildId:'b',instanceId:'i'},image={isEmpty:()=>false,getSize:()=>({width:1920,height:1080}),resize(size){resizes.push(size);return this;},toPNG:()=>png};
 const capture=async()=>({...identity,scope:'formal',pngBase64:png.toString('base64'),sha256:sha});
 const make=call=>createLibraryPreviewCapture({selection:async()=>world,instance:()=>identity,candidateActive:()=>false,sourceIdentity:async()=> 'formal-source',capture:call,decode:()=>image});
 const value=await make(capture)('w');assert.equal(value.sha256,sha);assert.deepEqual(resizes[0],{width:640,height:360,quality:'good'});
 await assert.rejects(make(async()=>{world='other';return capture();})('w'),/WORLD_CHANGED/);
});

test('a prepared native frame survives sheet hiding but never a different formal source or instance',async()=>{
 const png=Buffer.alloc(40);Buffer.from('89504e470d0a1a0a','hex').copy(png);const sha=createHash('sha256').update(png).digest('hex');
 let source='build:artifact-a',world='w',identity={worldId:'w',buildId:'b',instanceId:'i'},hidden=false,candidate=false,captures=0;
 const image={isEmpty:()=>false,getSize:()=>({width:1280,height:720}),resize(){return this;},toPNG:()=>png};
 const capture=createLibraryPreviewCapture({selection:async()=>world,instance:()=>identity,sourceIdentity:async()=>source,candidateActive:()=>candidate,decode:()=>image,capture:async()=>{captures++;if(hidden)throw Error('DETACHED');return {...identity,scope:'formal',pngBase64:png.toString('base64'),sha256:sha};}});
 await assert.rejects(capture.prepared('w'),/PREPARE_REQUIRED/);assert.equal(captures,0);
 const prepared=await capture.prepare({worldId:'w'});assert.deepEqual(prepared,{ready:true,worldId:'w',buildId:'b'});assert(!('pngBase64'in prepared));
 hidden=true;assert.equal((await capture('w')).sha256,sha);assert.equal(captures,1,'sheet publication uses actual prepared frame without reattaching hidden view');
 assert.equal((await capture.prepared('w')).sha256,sha);assert.equal(captures,1,'feedback reads exact prepared frame without capturing hidden view');
 source='build:artifact-b';await assert.rejects(capture.prepared('w'),/WORLD_CHANGED/);assert.equal(captures,1,'changed feedback binding never triggers a replacement capture');await assert.rejects(capture('w'),/DETACHED/);
 hidden=false;await capture.prepare({worldId:'w'});hidden=true;identity={...identity,instanceId:'new'};await assert.rejects(capture('w'),/DETACHED/);
 hidden=false;await capture.prepare({worldId:'w'});hidden=true;candidate=true;await assert.rejects(capture('w'),/UNAVAILABLE/);candidate=false;world='other';await assert.rejects(capture('w'),/UNAVAILABLE/);
 for(const input of [{worldId:'w',pngBase64:'forged'},{worldId:'../world'},{}])await assert.rejects(capture.prepare(input),/INVALID_REQUEST/);
});

function preparationFixture(captureAction,waiting=()=>{}) {
 const png=Buffer.alloc(40);Buffer.from('89504e470d0a1a0a','hex').copy(png);const sha=createHash('sha256').update(png).digest('hex');
 const state={source:'build:artifact-a',identity:{worldId:'w',buildId:'b',instanceId:'i'},clock:0,captures:0,waits:[],diagnostics:[]};
 const image={isEmpty:()=>false,getSize:()=>({width:1280,height:720}),resize(){return this;},toPNG:()=>png};
 const service=createLibraryPreviewCapture({selection:async()=>'w',instance:()=>state.identity,sourceIdentity:async()=>state.source,candidateActive:()=>false,decode:()=>image,
  capture:async()=>{state.captures++;await captureAction(state);return {...state.identity,scope:'formal',pngBase64:png.toString('base64'),sha256:sha};},
  now:()=>state.clock,wait:async milliseconds=>{state.waits.push(milliseconds);state.clock+=milliseconds;waiting(state);},onPreparation:value=>state.diagnostics.push(value)});
 return {service,state};
}
test('pre-sheet preparation retries transient busy once and stops after the successful frame',async()=>{
 const {service,state}=preparationFixture(state=>{if(state.captures===1)throw Error('GODOT_VIEW_CAPTURE_BUSY');});
 assert.equal((await service.prepare({worldId:'w'})).ready,true);assert.equal(state.captures,2);assert.deepEqual(state.waits,[100]);
 assert.deepEqual(state.diagnostics,[{attempts:2,elapsedMs:100,firstRetryableCode:'GODOT_VIEW_CAPTURE_BUSY',outcome:'ready'}]);
 await service.prepared('w');assert.equal(state.captures,2);
});
test('pre-sheet retry refuses changed original identity before another capture',async()=>{
 for(const change of [s=>s.source='build:artifact-b',s=>s.identity={...s.identity,instanceId:'replacement'},s=>s.identity={...s.identity,buildId:'new-build'}]){
  const {service,state}=preparationFixture(()=>{throw Error('GODOT_VIEW_CAPTURE_BUSY');},change);
  await assert.rejects(service.prepare({worldId:'w'}),/WORLD_CHANGED/);assert.equal(state.captures,1);assert.equal(state.diagnostics[0].finalCode,'LIBRARY_PREVIEW_WORLD_CHANGED');
 }
});
test('permanent pending ends within the two-second retry window and other failures are not retried',async()=>{
 const {service,state}=preparationFixture(()=>{throw Error('GODOT_VIEW_CAPTURE_PENDING');});
 await assert.rejects(service.prepare({worldId:'w'}),/GODOT_VIEW_CAPTURE_PENDING/);assert.equal(state.clock,2000);assert.equal(state.captures,20);
 assert.equal(state.diagnostics[0].attempts,20);assert.equal(state.diagnostics[0].outcome,'failed');await assert.rejects(service.prepared('w'),/PREPARE_REQUIRED/);
 const other=preparationFixture(()=>{throw Error('GODOT_VIEW_CAPTURE_DETACHED');});await assert.rejects(other.service.prepare({worldId:'w'}),/DETACHED/);assert.equal(other.state.captures,1);assert.deepEqual(other.state.waits,[]);
});
