import {projectHeadlessPermission,validateHeadlessPermissionInput} from '../../shared/headless-permission-contract.ts';
type Access={head(sessionId:string):unknown;resolve(sessionId:string,requestId:string,decision:'allow-once'|'deny'):Promise<void>};
export function createHeadlessPermissionBridge(access:Access){
  const observed=new Map<string,string>(),attempted=new Set<string>();
  const key=(sessionId:string,requestId:string)=>JSON.stringify([sessionId,requestId]);
  return Object.freeze({
    pending(raw:unknown){
      const input=validateHeadlessPermissionInput('pending',raw),head=projectHeadlessPermission(access.head(input.sessionId),input.sessionId);
      if(head){const identity=key(head.sessionId,head.requestId);if(observed.size>=128&&!observed.has(identity))observed.delete(observed.keys().next().value!);observed.set(identity,JSON.stringify(head));}
      return head;
    },
    async resolve(raw:unknown){
      const input=validateHeadlessPermissionInput('resolve',raw),identity=key(input.sessionId,input.requestId!);
      if(attempted.has(identity))throw Error('HEADLESS_PERMISSION_ALREADY_ATTEMPTED');
      const head=projectHeadlessPermission(access.head(input.sessionId),input.sessionId);
      if(!head||head.requestId!==input.requestId||observed.get(identity)!==JSON.stringify(head))throw Error('HEADLESS_PERMISSION_CHANGED');
      // The ordinary store owns queue removal, including an expired/lost receipt.
      // Never repeat an uncertain decision or promote it into a session grant.
      attempted.add(identity);observed.delete(identity);
      await access.resolve(input.sessionId,input.requestId!,input.decision!);
      return {status:'resolved',sessionId:input.sessionId,requestId:input.requestId,toolCallId:head.toolCallId,decision:input.decision};
    },
  });
}
export function installHeadlessPermissionBridge(scope:Record<string,unknown>,access:Access){
  if(!scope.__craftmineHeadless)return false;
  Object.defineProperty(scope,'__craftmineHeadlessPermission',{value:createHeadlessPermissionBridge(access),writable:false,configurable:false});return true;
}
