'use strict';
const {createHash}=require('node:crypto');
const fail=code=>{throw Object.assign(Error(code),{errorCode:code});};
const ID=/^[a-zA-Z0-9._-]{1,128}$/;
async function captureGodotView({context,worldId,args,services,assertActive=()=>{}}){
  if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!['buildId','instanceId','candidateId'].includes(k)))fail('GODOT_CAPTURE_INVALID_ARGUMENTS');
  if(typeof args.buildId!=='string'||!ID.test(args.buildId))fail('GODOT_CAPTURE_INVALID_IDENTITY');
  if(args.instanceId!==undefined&&(typeof args.instanceId!=='string'||!ID.test(args.instanceId)))fail('GODOT_CAPTURE_INVALID_IDENTITY');
  if(args.instanceId===undefined&&args.candidateId===undefined)fail('GODOT_CAPTURE_INVALID_IDENTITY');
  if(typeof worldId!=='string'||!ID.test(worldId)||args.candidateId!==undefined&&(typeof args.candidateId!=='string'||!ID.test(args.candidateId)))fail('GODOT_CAPTURE_INVALID_IDENTITY');
  assertActive();
  if(typeof services?.captureView!=='function')return {reason:'VIEW_CAPTURE_NOT_WIRED',text:JSON.stringify({format:'craftmine.godot-view-capture/1',status:'unavailable',delivery:'not-delivered',reason:'VIEW_CAPTURE_NOT_WIRED'}),images:[]};
  const result=await services.captureView({context,worldId,...args});assertActive();
  if(result?.worldId!==worldId||result.buildId!==args.buildId||args.instanceId!==undefined&&result.instanceId!==args.instanceId||result.candidateId!==(args.candidateId??null))fail('GODOT_CAPTURE_IDENTITY_CHANGED');
  if(result.status==='unavailable'&&result.delivery==='not-delivered'&&['MODEL_IMAGE_INPUT_UNAVAILABLE','MODEL_CHANGED_DURING_CAPTURE'].includes(result.reason))return {reason:result.reason,text:JSON.stringify({format:result.format,status:result.status,delivery:result.delivery,reason:result.reason,worldId,buildId:args.buildId,instanceId:args.instanceId}),images:[]};
  if(result.format!=='craftmine.godot-view-capture/1'||result.status!=='captured'||result.delivery!=='image-block-ready'||typeof result.instanceId!=='string'||!ID.test(result.instanceId)||result.scope!==(args.candidateId?'candidate':'formal')||typeof result.capturedAt!=='string'||!Number.isFinite(Date.parse(result.capturedAt)))fail('GODOT_CAPTURE_INVALID_RECEIPT');
  if(!Number.isSafeInteger(result.width)||!Number.isSafeInteger(result.height)||result.width<1||result.width>1920||result.height<1||result.height>1080||typeof result.pngBase64!=='string'||result.pngBase64.length>5592408)fail('GODOT_CAPTURE_IMAGE_LIMIT');
  for(const key of ['sourceWidth','sourceHeight'])if(!Number.isSafeInteger(result[key])||result[key]<1||result[key]>8192)fail('GODOT_CAPTURE_INVALID_SOURCE_SIZE');
  for(const key of ['viewWidth','viewHeight'])if(!Number.isFinite(result[key])||result[key]<=0||result[key]>8192)fail('GODOT_CAPTURE_INVALID_VIEW_SIZE');
  if(result.sourceWidth*result.sourceHeight>16777216||typeof result.resized!=='boolean'||result.width>result.sourceWidth||result.height>result.sourceHeight||result.resized!==(result.width!==result.sourceWidth||result.height!==result.sourceHeight)||Math.abs(result.width*result.sourceHeight-result.height*result.sourceWidth)>result.sourceWidth+result.sourceHeight)fail('GODOT_CAPTURE_INVALID_RESIZE');
  const bytes=Buffer.from(result.pngBase64,'base64');
  if(bytes.length<24||bytes.length>4194304||bytes.toString('base64')!==result.pngBase64||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.toString('ascii',12,16)!=='IHDR'||bytes.readUInt32BE(16)!==result.width||bytes.readUInt32BE(20)!==result.height||createHash('sha256').update(bytes).digest('hex')!==result.sha256)fail('GODOT_CAPTURE_INVALID_IMAGE');
  const receipt={format:result.format,status:'captured',delivery:'image-block-ready',worldId,buildId:args.buildId,instanceId:result.instanceId,candidateId:args.candidateId??null,scope:result.scope,capturedAt:result.capturedAt,width:result.width,height:result.height,sourceWidth:result.sourceWidth,sourceHeight:result.sourceHeight,viewWidth:result.viewWidth,viewHeight:result.viewHeight,resized:result.resized,sha256:result.sha256,model:result.model,note:'Real game view; pixels are not proof of gameplay correctness or provider vision support. No same-tick observation is claimed.'};
  return {text:JSON.stringify(receipt),images:[{data:result.pngBase64,mimeType:'image/png'}]};
}
module.exports={captureGodotView};
