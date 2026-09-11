import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {createHash} from 'node:crypto';
import {createCraftmineViewCaptureBridge,authorizeViewCaptureCaller} from '../vendor/pi-desktop/apps/desktop/electron/main/craftmine-view-capture.ts';
const require=createRequire(import.meta.url),{captureGodotView}=require('../plugins/craftmine-world/godot-view-capture.cjs'),{createHostProviders}=require('../plugins/craftmine-world/tool-services.cjs');
const input={context:{projectId:'project',sessionId:'session',turnId:'turn'},worldId:'world-1',buildId:'build-1',instanceId:'instance-1'};
const model={providerId:'provider',modelId:'model',declaredImages:true};
// Framing fixture only; actual PNG decoding/capture belongs to the native host tests.
const png=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.write('IHDR',12);png.writeUInt32BE(320,16);png.writeUInt32BE(240,20);
const image={format:'craftmine.godot-view-capture/1',worldId:input.worldId,buildId:input.buildId,instanceId:input.instanceId,candidateId:null,scope:'formal',capturedAt:'2026-09-12T00:00:00.000Z',width:320,height:240,sourceWidth:320,sourceHeight:240,viewWidth:320,viewHeight:240,resized:false,pngBase64:png.toString('base64'),sha256:createHash('sha256').update(png).digest('hex')};
test('normal service returns true image transport and excludes base64 from text metadata',async()=>{
 const calls=[];const bridge=createCraftmineViewCaptureBridge({authorize:async q=>{assert.deepEqual(q,input);calls.push('authorize');},model:async()=>model,capture:async q=>{assert.equal(q.context,undefined);calls.push('capture');return image;}});
 const services=createHostProviders(async(method,args)=>{assert.equal(method,'godotViewCapture');return bridge(args);});
 const result=await captureGodotView({context:input.context,worldId:input.worldId,args:{buildId:input.buildId,instanceId:input.instanceId},services});
 assert.deepEqual(calls,['authorize','capture','authorize']);assert.equal(result.images.length,1);assert.equal(result.images[0].data,image.pngBase64);assert.ok(!result.text.includes(image.pngBase64));assert.equal(JSON.parse(result.text).model.serviceVisionVerified,false);
});
test('caller scope refuses cross-session, wrong tool, extra fields and forged context',()=>{
 const caller={sessionId:'session',toolName:'godot_view_capture'};assert.deepEqual(authorizeViewCaptureCaller(input,caller),input);
 for(const other of [undefined,{...caller,sessionId:'other'},{...caller,toolName:'godot_runtime_state'}])assert.throws(()=>authorizeViewCaptureCaller(input,other),/CALLER_MISMATCH/);
 assert.throws(()=>authorizeViewCaptureCaller({...input,url:'https://example.com'},caller),/INVALID_REQUEST/);
 assert.throws(()=>authorizeViewCaptureCaller({...input,context:{...input.context,provider:'other'}},caller),/INVALID_CONTEXT/);
});
test('declared no-image capability prevents capture; capability or world changes discard returned pixels',async()=>{
 let captures=0,reads=0;
 const blocked=createCraftmineViewCaptureBridge({authorize:async()=>{},model:async()=>({...model,declaredImages:false}),capture:async()=>{captures++;return image;}});
 assert.equal((await blocked(input)).delivery,'not-delivered');assert.equal(captures,0);
 const changed=createCraftmineViewCaptureBridge({authorize:async()=>{},model:async()=>({...model,declaredImages:++reads===1}),capture:async()=>image});
 const result=await changed(input);assert.equal(result.reason,'MODEL_CHANGED_DURING_CAPTURE');assert.equal(result.pngBase64,undefined);
 const stale=createCraftmineViewCaptureBridge({authorize:async()=>{},model:async()=>model,capture:async()=>({...image,instanceId:'stale'})});
 await assert.rejects(stale(input),/IDENTITY_CHANGED/);
 let checks=0;const ended=createCraftmineViewCaptureBridge({authorize:async()=>{if(++checks===2)throw Error('TURN_ENDED');},model:async()=>model,capture:async()=>image});await assert.rejects(ended(input),/TURN_ENDED/);
});
test('plugin validates actual returned identity, image hash, size and exact candidate scope',async()=>{
 const request={context:input.context,worldId:input.worldId,args:{buildId:input.buildId,instanceId:input.instanceId}};
 const good={...image,status:'captured',delivery:'image-block-ready',model};
 for(const bad of [{...good,sha256:'0'.repeat(64)},{...good,width:640},{...good,instanceId:'other'},{...good,candidateId:'wrong'},{...good,scope:'candidate'},{...good,resized:true},{...good,sourceWidth:8192,sourceHeight:8192},{...good,sourceWidth:640,resized:true}])await assert.rejects(captureGodotView({...request,services:{captureView:async()=>bad}}),/GODOT_CAPTURE_/);
 await assert.rejects(captureGodotView({...request,args:{...request.args,path:'C:/other'},services:{captureView:async()=>good}}),/INVALID_ARGUMENTS/);
 const candidate=await captureGodotView({...request,args:{...request.args,candidateId:'candidate-1'},services:{captureView:async()=>({...good,scope:'candidate',candidateId:'candidate-1'})}});assert.equal(candidate.images.length,1);
});
test('capture failure does not expose arbitrary exception contents or retry',async()=>{
 let calls=0;const bridge=createCraftmineViewCaptureBridge({authorize:async()=>{},model:async()=>model,capture:async()=>{calls++;throw Error('private-path-and-provider-data');}});
 await assert.rejects(bridge(input),/^Error: GODOT_VIEW_CAPTURE_FAILED$/);assert.equal(calls,1);
});
test('candidate lookup resolves its real instance and rejects wrong world/build/candidate or a replaced preview',async()=>{
 const candidateRequest={...input,candidateId:'candidate-1'};delete candidateRequest.instanceId;
 let candidate={worldId:input.worldId,buildId:input.buildId,instanceId:'preview-1'},calls=0,replace=false;
 const bridge=createCraftmineViewCaptureBridge({authorize:async()=>{},model:async()=>model,candidateInstance:()=>candidate,capture:async q=>{
  calls++;assert.equal(q.instanceId,'preview-1');
  if(q.candidateId!=='candidate-1')throw Error('GODOT_CAPTURE_CANDIDATE_IDENTITY_CHANGED');
  const captured={...image,scope:'candidate',candidateId:'candidate-1',instanceId:'preview-1'};
  if(replace)candidate={...candidate,instanceId:'preview-2'};
  return captured;
 }});
 const result=await captureGodotView({context:input.context,worldId:input.worldId,args:{buildId:input.buildId,candidateId:'candidate-1'},services:{captureView:bridge}});
 assert.equal(JSON.parse(result.text).instanceId,'preview-1');assert.equal(calls,1);
 await assert.rejects(bridge({...candidateRequest,worldId:'other'}),/CANDIDATE_IDENTITY_CHANGED/);
 await assert.rejects(bridge({...candidateRequest,buildId:'other'}),/CANDIDATE_IDENTITY_CHANGED/);assert.equal(calls,1);
 await assert.rejects(bridge({...candidateRequest,candidateId:'candidate-other'}),/CANDIDATE_IDENTITY_CHANGED/);
 replace=true;await assert.rejects(bridge(candidateRequest),/CANDIDATE_IDENTITY_CHANGED/);
 await assert.rejects(bridge({...input,instanceId:undefined}),/INVALID_IDENTITY/);
});
test('the receipt records output resizing without changing declared game-view dimensions',async()=>{
 const result=await captureGodotView({context:input.context,worldId:input.worldId,args:{buildId:input.buildId,instanceId:input.instanceId},services:{captureView:async()=>({...image,status:'captured',delivery:'image-block-ready',model,sourceWidth:640,sourceHeight:480,resized:true})}});
 assert.equal(JSON.parse(result.text).resized,true);assert.equal(JSON.parse(result.text).viewWidth,320);assert.equal(JSON.parse(result.text).sourceWidth,640);assert.equal(JSON.parse(result.text).width,320);
});
