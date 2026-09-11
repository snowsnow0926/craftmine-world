/** Normal, session-bound visual read. No model request, credential, path, or input API. */
export type ViewCaptureRequest = {
  context: {projectId:string;sessionId:string;turnId:string};
  worldId:string;buildId:string;instanceId?:string;candidateId?:string;
};
export type ViewCaptureModel = {providerId:string;modelId:string;declaredImages:boolean};
const fail=(code:string):never=>{throw Error(code);};
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function validateViewCaptureRequest(value:unknown):ViewCaptureRequest {
  if(!record(value)||Object.keys(value).some(key=>!['context','worldId','buildId','instanceId','candidateId'].includes(key)))fail('GODOT_CAPTURE_INVALID_REQUEST');
  const input=value as Record<string,unknown>;
  for(const key of ['worldId','buildId'])if(typeof input[key]!=='string'||!/^[a-zA-Z0-9._-]{1,128}$/.test(input[key] as string))fail('GODOT_CAPTURE_INVALID_IDENTITY');
  if(input.instanceId!==undefined&&(typeof input.instanceId!=='string'||!/^[a-zA-Z0-9._-]{1,128}$/.test(input.instanceId)))fail('GODOT_CAPTURE_INVALID_IDENTITY');
  if(input.candidateId!==undefined&&(typeof input.candidateId!=='string'||!/^[a-zA-Z0-9._-]{1,128}$/.test(input.candidateId)))fail('GODOT_CAPTURE_INVALID_IDENTITY');
  if(input.instanceId===undefined&&input.candidateId===undefined)fail('GODOT_CAPTURE_INVALID_IDENTITY');
  const context=input.context;
  if(!record(context)||Object.keys(context).sort().join(',')!=='projectId,sessionId,turnId')fail('GODOT_CAPTURE_INVALID_CONTEXT');
  for(const value of Object.values(context as Record<string,unknown>))if(typeof value!=='string'||!value.trim()||value.length>240||/[\x00-\x1f]/.test(value))fail('GODOT_CAPTURE_INVALID_CONTEXT');
  return input as ViewCaptureRequest;
}
export function authorizeViewCaptureCaller(input:unknown,caller:{sessionId:string;toolName:string}|undefined):ViewCaptureRequest {
  const checked=validateViewCaptureRequest(input);
  if(!caller||caller.toolName!=='godot_view_capture'||caller.sessionId!==checked.context.sessionId)fail('GODOT_CAPTURE_CALLER_MISMATCH');
  return checked;
}
export function createCraftmineViewCaptureBridge(deps:{
  authorize:(input:ViewCaptureRequest)=>Promise<void>;
  model:(input:ViewCaptureRequest)=>Promise<ViewCaptureModel>;
  candidateInstance?:()=>{worldId:string;buildId:string;instanceId:string}|null;
  capture:(input:Omit<ViewCaptureRequest,'context'|'instanceId'>&{instanceId:string})=>Promise<Record<string,unknown>>;
}){
  return async (value:unknown):Promise<Record<string,unknown>>=>{
    const input=validateViewCaptureRequest(value);
    await deps.authorize(input);
    const model=await deps.model(input);
    const unavailable=(reason:string)=>({format:'craftmine.godot-view-capture/1',status:'unavailable',delivery:'not-delivered',reason,worldId:input.worldId,buildId:input.buildId,instanceId:input.instanceId,candidateId:input.candidateId??null,model});
    if(!model.declaredImages)return unavailable('MODEL_IMAGE_INPUT_UNAVAILABLE');
    let resolvedInstance=input.instanceId;
    if(input.candidateId){
      const candidate=deps.candidateInstance?.();
      if(!candidate||candidate.worldId!==input.worldId||candidate.buildId!==input.buildId||resolvedInstance!==undefined&&resolvedInstance!==candidate.instanceId)fail('GODOT_CAPTURE_CANDIDATE_IDENTITY_CHANGED');
      resolvedInstance=candidate!.instanceId;
    }
    const {context:_context,...requestedIdentity}=input;
    const identity={...requestedIdentity,instanceId:resolvedInstance!};
    let image:Record<string,unknown>;
    try{image=await deps.capture(identity);}catch(error){
      const code=error instanceof Error?error.message:'';
      throw Error(/^(?:GODOT_[A-Z0-9_]+|WORLD_BUSY)$/.test(code)&&code.length<128?code:'GODOT_VIEW_CAPTURE_FAILED');
    }
    await deps.authorize(input);
    if(input.candidateId){
      const candidate=deps.candidateInstance?.();
      if(!candidate||candidate.worldId!==identity.worldId||candidate.buildId!==identity.buildId||candidate.instanceId!==identity.instanceId)fail('GODOT_CAPTURE_CANDIDATE_IDENTITY_CHANGED');
    }
    const latest=await deps.model(input);
    if(!latest.declaredImages||latest.providerId!==model.providerId||latest.modelId!==model.modelId)return unavailable('MODEL_CHANGED_DURING_CAPTURE');
    if(image.worldId!==input.worldId||image.buildId!==input.buildId||image.instanceId!==identity.instanceId||image.candidateId!==(input.candidateId??null))fail('GODOT_CAPTURE_IDENTITY_CHANGED');
    return {...image,status:'captured',delivery:'image-block-ready',model:{...model,serviceVisionVerified:false}};
  };
}
