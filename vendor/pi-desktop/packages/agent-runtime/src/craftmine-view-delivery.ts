import type {AgentToolResult} from '@earendil-works/pi-agent-core';
export const GODOT_VIEW_CAPTURE_TOOL='plugin_craftmine_world_godot_view_capture';
const unavailable=(reason:string):AgentToolResult<unknown>=>{
  const details={format:'craftmine.godot-view-capture/1',status:'unavailable',delivery:'not-delivered',reason,imageCount:0};
  return {content:[{type:'text',text:JSON.stringify(details)}],details,isError:true} as AgentToolResult<unknown>;
};
/** This new tool must never report successful image delivery after dropping pixels. */
export function unavailableViewDelivery(toolName:string,supportsImages:boolean):AgentToolResult<unknown>|null {
  if(toolName!==GODOT_VIEW_CAPTURE_TOOL||supportsImages)return null;
  return unavailable('MODEL_IMAGE_INPUT_UNAVAILABLE');
}
export function missingViewDelivery(toolName:string,content:unknown):AgentToolResult<unknown>|null {
  if(toolName!==GODOT_VIEW_CAPTURE_TOOL)return null;
  const value=content as {images?:unknown[];reason?:unknown}|null;
  if(Array.isArray(value?.images)&&value.images.length===1){
    const image=value.images[0] as {data?:unknown;mimeType?:unknown}|null;
    if(typeof image?.data==='string'&&image.data.length>0&&image.mimeType==='image/png')return null;
  }
  const reason=typeof value?.reason==='string'&&['MODEL_IMAGE_INPUT_UNAVAILABLE','MODEL_CHANGED_DURING_CAPTURE','VIEW_CAPTURE_NOT_WIRED'].includes(value.reason)?value.reason:'VIEW_CAPTURE_IMAGE_MISSING';
  return unavailable(reason);
}
