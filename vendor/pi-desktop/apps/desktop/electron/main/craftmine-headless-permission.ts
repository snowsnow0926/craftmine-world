import {validateHeadlessPermissionInput} from '../../shared/headless-permission-contract.ts';
export function validateHeadlessPermissionEnvelope(request:Record<string,unknown>,authorized:boolean){
  if(!authorized)throw Error('HEADLESS_PERMISSION_PARENT_REQUIRED');
  if(Object.keys(request).sort().join(',')!=='id,method,payload,type'||request.type!=='craftmine-headless'||typeof request.id!=='string'||!/^[a-zA-Z0-9._:-]{1,160}$/.test(request.id)||!['headlessPermissionPending','headlessPermissionResolve'].includes(String(request.method)))throw Error('HEADLESS_PERMISSION_ENVELOPE_INVALID');
  const mode=request.method==='headlessPermissionPending'?'pending':'resolve';
  const payload=validateHeadlessPermissionInput(mode,request.payload);
  return `(()=>{if(!globalThis.__craftmineHeadless||!globalThis.__craftmineHeadlessPermission)throw Error('HEADLESS_PERMISSION_RENDERER_UNAVAILABLE');return globalThis.__craftmineHeadlessPermission.${mode}(${JSON.stringify(payload)});})()`;
}
