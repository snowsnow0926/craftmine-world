export type HeadlessPermissionInput = {sessionId:string;requestId?:string;decision?:'allow-once'|'deny'};
const fail=():never=>{throw Error('HEADLESS_PERMISSION_INVALID');};
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:fail();
const id=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9._:-]{1,160}$/.test(value);
export function validateHeadlessPermissionInput(mode:'pending'|'resolve',raw:unknown):HeadlessPermissionInput{
  const value=object(raw);
  if(!['pending','resolve'].includes(mode)||Object.keys(value).sort().join(',')!==(mode==='pending'?'sessionId':'decision,requestId,sessionId')||!id(value.sessionId))return fail();
  if(mode==='pending')return {sessionId:value.sessionId};
  if(!id(value.requestId)||(value.decision!=='allow-once'&&value.decision!=='deny'))return fail();
  return {sessionId:value.sessionId,requestId:value.requestId,decision:value.decision};
}
function preview(value:unknown,depth=0):unknown{
  if(depth>20)return fail();
  if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number')return value;
  if(Array.isArray(value))return value.map(item=>preview(item,depth+1));
  return Object.fromEntries(Object.entries(object(value)).map(([key,item])=>[key,/^(authorization|api[_-]?key|secret(Value)?|password|access[_-]?token|refresh[_-]?token|credential(s)?)$/i.test(key)?'[redacted]':preview(item,depth+1)]));
}
/** The same bounded argument preview shown in the permission card, without provider/store state. */
export function projectHeadlessPermission(raw:unknown,sessionId:string){
  if(raw==null)return null;
  const value=object(raw);
  if(value.sessionId!==sessionId||!id(value.requestId)||!id(value.toolCallId)||typeof value.toolName!=='string'||value.toolName.length>300||!['low','medium','high'].includes(String(value.risk))||typeof value.reason!=='string'||value.reason.length>4000)return fail();
  const result={sessionId,requestId:value.requestId,toolCallId:value.toolCallId,toolName:value.toolName,risk:value.risk as string,argsPreview:preview(value.argsPreview),reason:value.reason};
  if(JSON.stringify(result).length>96000)return fail();
  return result;
}
