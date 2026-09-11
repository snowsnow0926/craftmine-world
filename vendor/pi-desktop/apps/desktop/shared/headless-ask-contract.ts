import type {AskToolRequest} from '@pi-desktop/shared';
type ObjectValue=Record<string,unknown>;
export type HeadlessAskInput={sessionId:string;requestId?:string;choices?:Array<number[]|null>};
const fail=():never=>{throw Error('HEADLESS_ASK_INVALID');};
const object=(value:unknown):ObjectValue=>value&&typeof value==='object'&&!Array.isArray(value)?value as ObjectValue:fail();
const id=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9._:-]{1,160}$/.test(value);
const text=(value:unknown,max:number):value is string=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
export function validateHeadlessAskInput(mode:'pending'|'resolve',raw:unknown):HeadlessAskInput{
 if(mode!=='pending'&&mode!=='resolve')return fail();
 const value=object(raw),keys=Object.keys(value).sort().join(',');
 if(keys!==(mode==='pending'?'sessionId':'choices,requestId,sessionId')||!id(value.sessionId))return fail();
 if(mode==='pending')return {sessionId:value.sessionId};
 if(!id(value.requestId)||!Array.isArray(value.choices)||value.choices.length<1||value.choices.length>8||value.choices.some(v=>v!==null&&(!Array.isArray(v)||v.length<1||v.length>12||new Set(v).size!==v.length||v.some(n=>!Number.isSafeInteger(n)||n<0||n>=12))))return fail();
 return {sessionId:value.sessionId,requestId:value.requestId,choices:structuredClone(value.choices) as Array<number[]|null>};
}
/** Finite projection only: never return store state, provider data or credentials. */
export function projectHeadlessAsk(raw:unknown,sessionId:string):AskToolRequest|null{
 if(raw==null)return null;
 const value=object(raw);
 if(value.sessionId!==sessionId||!id(value.requestId)||!id(value.toolCallId)||!Array.isArray(value.questions)||value.questions.length<1||value.questions.length>8)return fail();
 const questions=value.questions.map(raw=>{
  const q=object(raw);
  if(!text(q.question,2000)||!Array.isArray(q.options)||q.options.length>12||q.options.some(v=>!text(v,2000))||(q.multiSelect!==undefined&&typeof q.multiSelect!=='boolean'))return fail();
  return {question:q.question,options:[...q.options] as string[],...(q.multiSelect!==undefined?{multiSelect:q.multiSelect as boolean}:{})};
 });
 const projected={sessionId,requestId:value.requestId,toolCallId:value.toolCallId,questions};
 if(JSON.stringify(projected).length>24000)return fail();
 return projected;
}
export function headlessAskAnswers(ask:AskToolRequest,choices:Array<number[]|null>):Array<string[]|null>{
 if(choices.length!==ask.questions.length)return fail();
 return choices.map((selected,index)=>{
  if(selected===null)return null;
  const question=ask.questions[index];
  if(!question.multiSelect&&selected.length!==1||selected.some(i=>i>=question.options.length))return fail();
  return selected.map(i=>question.options[i]);
 });
}
