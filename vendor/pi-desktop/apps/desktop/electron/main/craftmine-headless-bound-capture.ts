import {validateGodotViewCaptureIdentity,type GodotViewCaptureIdentity} from './godot-view-capture';
type Access={enabled:boolean;capture:(identity:GodotViewCaptureIdentity)=>Promise<unknown>;state:()=>unknown};
/** Test-only forwarding. The normal world host still owns every capture check. */
export async function runHeadlessBoundCapture(request:unknown,access:Access):Promise<unknown>{
 if(!access.enabled||!request||typeof request!=='object'||Array.isArray(request))throw Error('HEADLESS_BOUND_CAPTURE_DENIED');
 const input=request as Record<string,unknown>;
 if(input.type!=='craftmine-headless'||typeof input.id!=='string'||!input.id)throw Error('HEADLESS_BOUND_CAPTURE_DENIED');
 if(input.method==='godotCaptureBoundState'){
  if(Object.keys(input).sort().join(',')!=='id,method,type')throw Error('HEADLESS_BOUND_CAPTURE_FIELDS');
  return access.state();
 }
 if(input.method!=='godotCaptureBoundView'||Object.keys(input).sort().join(',')!=='id,method,payload,type')throw Error('HEADLESS_BOUND_CAPTURE_FIELDS');
 validateGodotViewCaptureIdentity(input.payload as GodotViewCaptureIdentity);
 return access.capture({...input.payload as GodotViewCaptureIdentity});
}
