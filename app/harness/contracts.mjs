import { createHash } from 'node:crypto';
import { canonicalJSON } from '../canonical.mjs';

export const HARNESS_LIMITS = Object.freeze({steps:16,calls:48,patchOperations:8,readChars:16000,actionBytes:180000});
export const TOOL_NAMES = Object.freeze(['project.inspect','world.query','resource.read','module.read','capabilities.read','workspace.patch','candidate.build','memory.search','memory.remember','task.plan','task.step','task.finish','evidence.read','verify.run']);
export const ACTION_SCHEMA = {
  type:'object',additionalProperties:false,required:['kind','tool','argumentsJSON','summary'],
  properties:{
    kind:{type:'string',enum:['tool','finish']},
    tool:{anyOf:[{type:'string',enum:TOOL_NAMES},{type:'null'}]},
    argumentsJSON:{type:'string'},
    summary:{type:'string'},
  },
};
export const contentHash = value => createHash('sha256').update(canonicalJSON(value)).digest('hex');
export class HarnessError extends Error {
  constructor(code,message){super(message);this.name='HarnessError';this.code=code;}
}
export function requireValue(condition,code,message){if(!condition)throw new HarnessError(code,message);}
export function fields(value,required,optional=[]){
  requireValue(value && typeof value==='object' && !Array.isArray(value),'INVALID_ARGUMENTS','工具参数必须是对象');
  requireValue(required.every(k=>Object.hasOwn(value,k)) && Object.keys(value).every(k=>[...required,...optional].includes(k)),
    'INVALID_ARGUMENTS','工具参数字段不完整或包含不支持的字段');
}
export function integer(value,min,max,label){
  requireValue(Number.isInteger(value)&&value>=min&&value<=max,'INVALID_ARGUMENTS',label+'超出允许范围');
}
// 模型有时会把整个循环「演」出来：先给一个操作 JSON，再编造 <result> 和后续几步。
// 宿主不猜意图，只做确定性提取：按顺序找第一个满足操作 schema 的完整 JSON 对象。
// 这样「模型不守格式」不会直接毁掉任务，但伪造的结果也永远不会被当成真的执行过。
function jsonObjects(text){
  const found=[];let depth=0,start=-1,inString=false,escaped=false;
  for(let index=0;index<text.length;index+=1){
    const character=text[index];
    if(inString){
      if(escaped){escaped=false;continue;}
      if(character==='\\'){escaped=true;continue;}
      if(character==='"')inString=false;
      continue;
    }
    if(character==='"'){inString=true;continue;}
    if(character==='{'){if(depth===0)start=index;depth+=1;continue;}
    if(character==='}'){depth-=1;if(depth===0&&start>=0){found.push(text.slice(start,index+1));start=-1;}else if(depth<0)depth=0;}
  }
  return found;
}
function normalizeAction(action){
  fields(action,['kind','tool','argumentsJSON','summary']);
  requireValue(['tool','finish'].includes(action.kind)&&typeof action.summary==='string'&&action.summary.trim().length>0&&action.summary.length<=2000,
    'INVALID_ACTION','操作类型或说明无效');
  requireValue(typeof action.argumentsJSON==='string','INVALID_ACTION','argumentsJSON 必须是 JSON 字符串');
  let args;try{args=JSON.parse(action.argumentsJSON);}catch{throw new HarnessError('INVALID_ACTION','工具参数不是有效 JSON');}
  requireValue(args&&typeof args==='object'&&!Array.isArray(args),'INVALID_ARGUMENTS','工具参数必须是对象');
  requireValue(action.kind==='finish'?action.tool===null:TOOL_NAMES.includes(action.tool),'UNKNOWN_TOOL','工具未授权或不存在');
  if(action.kind==='finish')fields(args,[]);
  return {...action,args};
}
export function parseAction(raw){
  requireValue(typeof raw==='string'&&Buffer.byteLength(raw)<=HARNESS_LIMITS.actionBytes,'INVALID_ACTION','模型操作超过大小限制');
  const candidates=[];
  try{candidates.push(JSON.parse(raw));}catch{/* 整段不是单个对象，继续按括号切分 */ }
  for(const chunk of jsonObjects(raw)){try{candidates.push(JSON.parse(chunk));}catch{/* 坏片段直接跳过 */ }}
  let firstError=null;
  for(const candidate of candidates){
    try{return normalizeAction(candidate);}
    catch(error){firstError??=error;}
  }
  if(firstError&&candidates.length)throw firstError;
  throw new HarnessError('INVALID_ACTION','模型操作不是有效 JSON');
}
