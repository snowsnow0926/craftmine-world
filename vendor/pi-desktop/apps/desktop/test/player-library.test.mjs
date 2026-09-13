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
 const make=call=>createLibraryPreviewCapture({selection:async()=>world,instance:()=>identity,candidateActive:()=>false,capture:call,decode:()=>image});
 const value=await make(capture)('w');assert.equal(value.sha256,sha);assert.deepEqual(resizes[0],{width:640,height:360,quality:'good'});
 await assert.rejects(make(async()=>{world='other';return capture();})('w'),/WORLD_CHANGED/);
});
