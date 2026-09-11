import {validateHeadlessAskInput} from '../../shared/headless-ask-contract.ts';
export function headlessAskScript(mode:'pending'|'resolve',payload:unknown){
 const input=validateHeadlessAskInput(mode,payload);
 return `(()=>{if(!globalThis.__craftmineHeadless||!globalThis.__craftmineHeadlessAsk)throw Error('HEADLESS_ASK_RENDERER_UNAVAILABLE');return globalThis.__craftmineHeadlessAsk.${mode}(${JSON.stringify(input)});})()`;
}
export function validateHeadlessAskEnvelope(request:Record<string,unknown>,authorized:boolean){
 if(!authorized)throw Error('HEADLESS_ASK_PARENT_REQUIRED');
 if(Object.keys(request).sort().join(',')!=='id,method,payload,type'||request.type!=='craftmine-headless'||typeof request.id!=='string'||!/^[a-zA-Z0-9._:-]{1,160}$/.test(request.id)||!['headlessAskPending','headlessAskResolve'].includes(String(request.method)))throw Error('HEADLESS_ASK_ENVELOPE_INVALID');
 return headlessAskScript(request.method==='headlessAskPending'?'pending':'resolve',request.payload);
}
