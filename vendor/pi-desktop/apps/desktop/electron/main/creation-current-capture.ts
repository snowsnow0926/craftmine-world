type Context={projectId:string;sessionId:string;turnId:string};
/** Recheck current permission for model-visible claims; never widen a capture. */
export async function readCurrentCreationCapture(
  context:Context,worldId:string,
  deps:{bound:(context:Context,worldId:string)=>Record<string,any>|null;fullAuto:(sessionId:string)=>Promise<boolean>},
):Promise<Record<string,any>|null>{
  const capture=deps.bound(context,worldId);
  if(!capture||capture.worldId!==worldId)return null;
  if(capture.authorization==='full-auto'&&capture.autoApply===true){
    const permitted=await deps.fullAuto(context.sessionId),current=deps.bound(context,worldId);
    if(!current||current.worldId!==worldId)return null;
    return permitted?current:{...current,autoApply:false};
  }
  return capture;
}
