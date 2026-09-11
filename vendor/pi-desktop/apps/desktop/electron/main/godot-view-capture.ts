import {createHash} from 'node:crypto';

export type GodotViewCaptureIdentity={worldId:string;buildId:string;instanceId:string;candidateId?:string};
export type GodotViewCapture={format:'craftmine.godot-view-capture/1';worldId:string;buildId:string;instanceId:string;candidateId:string|null;scope:'formal'|'candidate';capturedAt:string;viewWidth:number;viewHeight:number;sourceWidth:number;sourceHeight:number;width:number;height:number;resized:boolean;pngBase64:string;sha256:string};
type Frame={getSize():{width:number;height:number};toBitmap():Buffer;toPNG():Buffer;resize(options:{width:number;height:number;quality:'good'}):Frame};
type Contents={capturePage():Promise<Frame>};
const pending=new WeakSet<Contents>();
export const WORLD_VIEW_CAPTURE_DEADLINE_MS=4000;
export const WORLD_VIEW_CAPTURE_MAX_PNG_BYTES=4*1024*1024;
export const WORLD_VIEW_CAPTURE_MAX_PIXELS=16*1024*1024;
export function validateGodotViewCaptureIdentity(input:GodotViewCaptureIdentity):void{
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['worldId','buildId','instanceId','candidateId'].includes(key))||![input.worldId,input.buildId,input.instanceId].every(value=>typeof value==='string'&&/^[a-zA-Z0-9._-]{1,128}$/.test(value))||(input.candidateId!==undefined&&(typeof input.candidateId!=='string'||!/^[a-zA-Z0-9._-]{1,128}$/.test(input.candidateId))))throw Error('GODOT_VIEW_CAPTURE_IDENTITY');
}
/** One bounded read from an existing compositor. No layout or runtime actions. */
export async function captureBoundGodotView(contents:Contents,identity:GodotViewCaptureIdentity,viewWidth:number,viewHeight:number,verify:()=>void):Promise<GodotViewCapture>{
 validateGodotViewCaptureIdentity(identity);
 identity={...identity};
 const bounded=(width:number,height:number)=>Number.isSafeInteger(width)&&Number.isSafeInteger(height)&&width>0&&height>0&&width<=8192&&height<=8192&&width*height<=WORLD_VIEW_CAPTURE_MAX_PIXELS;
 if(!bounded(viewWidth,viewHeight)||viewWidth<320||viewHeight<240)throw Error('GODOT_VIEW_CAPTURE_DIMENSIONS');
 verify();if(pending.has(contents))throw Error('GODOT_VIEW_CAPTURE_PENDING');
 pending.add(contents);
 let image:Frame;
 try{
  image=await new Promise<Frame>((resolve,reject)=>{
   let settled=false;
   const finish=(image:Frame|null,code?:string)=>{if(settled)return;settled=true;clearTimeout(timer);code?reject(Error(code)):resolve(image!);};
   const timer=setTimeout(()=>finish(null,'GODOT_VIEW_CAPTURE_TIMEOUT'),WORLD_VIEW_CAPTURE_DEADLINE_MS);
   // A timed-out native read may still be pending. Keep its view locked until
   // settlement so repeated requests cannot accumulate hidden capture work.
   try{Promise.resolve(contents.capturePage()).then(value=>{pending.delete(contents);finish(value);},()=>{pending.delete(contents);finish(null,'GODOT_VIEW_CAPTURE_FAILED');});}
   catch{pending.delete(contents);finish(null,'GODOT_VIEW_CAPTURE_FAILED');}
  });
 }catch(error){verify();throw error;}
 verify();
 let png:Buffer,width:number,height:number,sourceWidth:number,sourceHeight:number;
 try{
  const size=image.getSize();sourceWidth=size.width;sourceHeight=size.height;width=sourceWidth;height=sourceHeight;
  // The same WebContents may capture its owning offscreen compositor's pixel
  // surface rather than the child view's layout rectangle. Record both sizes;
  // binding/identity checks establish provenance, not a presumed DPI ratio.
  if(!bounded(width,height))throw Error('GODOT_VIEW_CAPTURE_DIMENSIONS');
  const bitmap=image.toBitmap();if(bitmap.length!==width*height*4)throw Error('GODOT_VIEW_CAPTURE_EMPTY_FRAME');
  let painted=false;for(let i=3;i<bitmap.length;i+=4)if(bitmap[i]!==0){painted=true;break;}
  if(!painted)throw Error('GODOT_VIEW_CAPTURE_EMPTY_FRAME');
  const encode=(maxWidth:number,maxHeight:number)=>{
   const scale=Math.min(1,maxWidth/sourceWidth,maxHeight/sourceHeight);
   width=Math.max(1,Math.floor(sourceWidth*scale));height=Math.max(1,Math.floor(sourceHeight*scale));
   // This is an in-memory derivative of the captured NativeImage only. Never
   // resize a WebContentsView, window, runtime or any page-owned canvas.
   const output=scale<1?image.resize({width,height,quality:'good'}):image;
   const actual=output.getSize();if(actual.width!==width||actual.height!==height)throw Error('GODOT_VIEW_CAPTURE_DIMENSIONS');
   return output.toPNG();
  };
  png=encode(1920,1080);
  if(Buffer.isBuffer(png)&&png.length>WORLD_VIEW_CAPTURE_MAX_PNG_BYTES)png=encode(1280,720);
 }catch(error){if(error instanceof Error&&['GODOT_VIEW_CAPTURE_DIMENSIONS','GODOT_VIEW_CAPTURE_EMPTY_FRAME'].includes(error.message))throw error;throw Error('GODOT_VIEW_CAPTURE_INVALID_IMAGE');}
 if(!Buffer.isBuffer(png)||png.length<33||png.length>WORLD_VIEW_CAPTURE_MAX_PNG_BYTES)throw Error('GODOT_VIEW_CAPTURE_PNG_LIMIT');
 if(!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||png.toString('ascii',12,16)!=='IHDR'||png.readUInt32BE(16)!==width||png.readUInt32BE(20)!==height)throw Error('GODOT_VIEW_CAPTURE_INVALID_IMAGE');
 verify();
 return{format:'craftmine.godot-view-capture/1',worldId:identity.worldId,buildId:identity.buildId,instanceId:identity.instanceId,candidateId:identity.candidateId??null,scope:identity.candidateId===undefined?'formal':'candidate',capturedAt:new Date().toISOString(),viewWidth,viewHeight,sourceWidth,sourceHeight,width,height,resized:width!==sourceWidth||height!==sourceHeight,pngBase64:png.toString('base64'),sha256:createHash('sha256').update(png).digest('hex')};
}
