// UiMessage preserves its provider-facing tool name; classification alone uses
// the stable Craftmine tool name for both old and namespaced transcripts.
export function classifyCraftmineTool(name){return typeof name==='string'?name.replace(/^plugin_craftmine_world_/,''):null;}
export function sourceLibraryCallEvidence(messages,oldMessageIds=new Set()){
 return messages.filter(message=>!oldMessageIds.has(message.id)&&classifyCraftmineTool(message.toolName)==='godot_source_library').map(message=>({id:message.id,toolCallId:message.toolCallId,toolName:message.toolName,canonicalToolName:classifyCraftmineTool(message.toolName),args:message.toolArgs,result:message.toolResult,status:message.toolStatus,isError:message.isError}));
}
