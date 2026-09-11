import type {AskToolResolution} from '@pi-desktop/shared';
import {headlessAskAnswers,projectHeadlessAsk,validateHeadlessAskInput} from '../../shared/headless-ask-contract.ts';
type Access={head(sessionId:string):unknown;resolve(sessionId:string,resolution:AskToolResolution):Promise<void>};
/** Installed only on the isolated renderer. Main separately gates parent IPC. */
export function createHeadlessAskBridge(access:Access){
 const observed=new Map<string,string>(),pending=new Set<string>(),completed=new Map<string,{choices:string;result:unknown}>();
 const key=(sessionId:string,requestId:string)=>JSON.stringify([sessionId,requestId]);
 return Object.freeze({
  pending(raw:unknown){
   const input=validateHeadlessAskInput('pending',raw),ask=projectHeadlessAsk(access.head(input.sessionId),input.sessionId);
   if(ask){const id=key(ask.sessionId,ask.requestId);if(observed.size>=32&&!observed.has(id))observed.delete(observed.keys().next().value!);observed.set(id,JSON.stringify(ask));}
   return ask;
  },
  async resolve(raw:unknown){
   const input=validateHeadlessAskInput('resolve',raw),id=key(input.sessionId,input.requestId!),selection=JSON.stringify(input.choices),done=completed.get(id);
   if(done){if(done.choices!==selection)throw Error('HEADLESS_ASK_ALREADY_RESOLVED');return structuredClone(done.result);}
   if(pending.has(id))throw Error('HEADLESS_ASK_BUSY');
   const ask=projectHeadlessAsk(access.head(input.sessionId),input.sessionId);
   if(!ask||ask.requestId!==input.requestId||observed.get(id)!==JSON.stringify(ask))throw Error('HEADLESS_ASK_CHANGED');
   const answers=headlessAskAnswers(ask,input.choices!);pending.add(id);
   try{
    await access.resolve(input.sessionId,{sessionId:input.sessionId,requestId:input.requestId!,answers});
    const result={status:'resolved',requestId:ask.requestId,sessionId:ask.sessionId,toolCallId:ask.toolCallId,answers};
    if(completed.size>=32)completed.delete(completed.keys().next().value!);completed.set(id,{choices:selection,result});observed.delete(id);return structuredClone(result);
   }finally{pending.delete(id);}
  },
 });
}
export function installHeadlessAskBridge(scope:Record<string,unknown>,access:Access){
 if(!scope.__craftmineHeadless)return false;
 Object.defineProperty(scope,'__craftmineHeadlessAsk',{value:createHeadlessAskBridge(access),writable:false,configurable:false});return true;
}
