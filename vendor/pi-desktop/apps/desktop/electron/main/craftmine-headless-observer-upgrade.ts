type Access={invoke:(channel:string,...args:unknown[])=>Promise<any>;panel:(channel:string,payload:Record<string,unknown>)=>Promise<any>;observe:()=>Promise<any>;active:(sessionId:string)=>boolean};
const id=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9._-]{1,128}$/.test(value);
/** Only the protected ordinary headless controller receives this finite API. */
export function createHeadlessObserverUpgrade(access:Access){
  let identity:{sessionId:string;worldId:string}|undefined,hintId:string|undefined,operationId:string|undefined,busy=false;
  return async(method:string,payload:unknown)=>{
    const p=payload as Record<string,unknown>;
    if(!p||typeof p!=='object'||Array.isArray(p)||!id(p.sessionId)||!id(p.worldId))throw Error('HEADLESS_UPGRADE_IDENTITY_REQUIRED');
    if(!['playerObserverHint','playerObserverUpgrade','playerObserverStatus'].includes(method))throw Error('HEADLESS_UPGRADE_METHOD_DENIED');
    const fields=method==='playerObserverHint'?['sessionId','worldId']:method==='playerObserverUpgrade'?['sessionId','worldId','upgradeId','operationId']:['sessionId','worldId','operationId'];
    if(Object.keys(p).length!==fields.length||Object.keys(p).some(key=>!fields.includes(key)))throw Error('HEADLESS_UPGRADE_FIELDS_DENIED');
    const sessionId=p.sessionId,worldId=p.worldId;
    if(identity&&(identity.sessionId!==sessionId||identity.worldId!==worldId))throw Error('HEADLESS_UPGRADE_IDENTITY_CHANGED');
    if((await access.observe())?.worldId!==worldId)throw Error('HEADLESS_UPGRADE_WORLD_CHANGED');
    if(method==='playerObserverStatus'){
      if(!operationId||p.operationId!==operationId)throw Error('HEADLESS_UPGRADE_OPERATION_CHANGED');
      const status=await access.panel('godot.creationEditStatus',{sessionId,worldId,operationId});
      return {...status,active:access.active(sessionId)};
    }
    if(busy||access.active(sessionId))throw Error('HEADLESS_UPGRADE_BUSY');
    busy=true;
    try{
      if(method==='playerObserverHint'){
        const record=await access.invoke('sessionGet',sessionId);
        if(record?.session?.id!==sessionId)throw Error('HEADLESS_UPGRADE_SESSION_REQUIRED');
        await access.invoke('notificationSetViewingSession',{sessionId});
        const hint=await access.panel('godot.creationTarget',{sessionId});
        if(hint?.worldId!==worldId)throw Error('HEADLESS_UPGRADE_WORLD_CHANGED');
        identity={sessionId,worldId};hintId=id(hint.upgradeId)&&hint.captureId===null&&hint.target===null&&hint.reason==='SCENE_OBJECT_OBSERVER_UPGRADE_REQUIRED'?hint.upgradeId:undefined;
        return hint;
      }
      if(!identity||!hintId||p.upgradeId!==hintId||!id(p.operationId))throw Error('HEADLESS_UPGRADE_HINT_REQUIRED');
      if(operationId)throw Error('HEADLESS_UPGRADE_ALREADY_STARTED');
      operationId=p.operationId;
      return access.panel('godot.creationEdit',{sessionId,captureId:hintId,operationId,action:'upgrade-observer'});
    }finally{busy=false;}
  };
}
