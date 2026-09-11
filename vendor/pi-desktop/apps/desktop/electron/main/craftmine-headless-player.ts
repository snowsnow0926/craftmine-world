type Access={invoke:(channel:string,...args:unknown[])=>Promise<any>;panel:(channel:string,payload:Record<string,unknown>)=>Promise<any>;observe:()=>Promise<any>;active:(sessionId:string)=>boolean;latest:(worldId:string,sessionId:string)=>Promise<any>};
const object=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const id=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9._-]{1,128}$/.test(value);
export function unwrapPlayerDesktopResult(result:any){
  if(!result||typeof result.ok!=='boolean')throw Error('HEADLESS_PLAYER_DESKTOP_RESULT_INVALID');
  if(!result.ok)throw Object.assign(Error(result.error?.message??'Desktop request failed'),{code:result.error?.code});
  return result.data;
}
/** Ordinary desktop APIs inside the existing protected headless controller. */
export function createHeadlessPlayer(access:Access){
  let binding:{sessionId:string;worldId:string}|null=null,busy=false,lastMessageId:string|undefined;
  let creationKey:string|undefined,creationAttempt:Promise<any>|undefined;
  const sent=new Set<string>();
  return async(method:string,payload:unknown)=>{
    if(method==='playerCreateSession'){
      if(!object(payload)||!id(payload.worldId)||typeof payload.title!=='string'||!payload.title.trim()||payload.title.length>80)throw Error('HEADLESS_PLAYER_SESSION_CREATE_INVALID');
      if(Object.keys(payload).sort().join(',')!=='title,worldId')throw Error('HEADLESS_PLAYER_FIELDS_DENIED');
      const worldId=payload.worldId,title=payload.title.trim(),key=JSON.stringify([worldId,title]);
      const observed=await access.observe();
      if(observed?.worldId!==worldId||observed?.baseId!=='creation-sandbox')throw Error('HEADLESS_PLAYER_WORLD_CHANGED');
      if(creationAttempt){if(creationKey!==key)throw Error('HEADLESS_PLAYER_SESSION_CREATE_ALREADY_REQUESTED');return creationAttempt;}
      if(binding||busy)throw Error('HEADLESS_PLAYER_BUSY');
      creationKey=key;busy=true;
      // Retain a failed attempt too: a lost reply must never trigger another
      // session.create. After process loss, inspect ordinary session history.
      creationAttempt=(async()=>{
        const created=await access.invoke('sessionCreate',{title});
        if(!id(created?.session?.id))throw Error('HEADLESS_PLAYER_CREATED_SESSION_INVALID');
        const sessionId=created.session.id,record=await access.invoke('sessionGet',sessionId);
        if(record?.session?.id!==sessionId)throw Error('HEADLESS_PLAYER_CREATED_SESSION_INVALID');
        if((await access.observe())?.worldId!==worldId)throw Error('HEADLESS_PLAYER_WORLD_CHANGED');
        return {format:'craftmine.ordinary-player-session/1',worldId,sessionId,creation:'ordinary-sessionCreate',modelRequestsStarted:0};
      })().finally(()=>{busy=false;});
      return creationAttempt;
    }
    if(!object(payload)||!id(payload.sessionId)||!id(payload.worldId))throw Error('HEADLESS_PLAYER_IDENTITY_REQUIRED');
    const {sessionId,worldId}=payload;
    if(!['playerSetup','playerPrompt','playerStatus','playerAbort'].includes(method))throw Error('HEADLESS_PLAYER_METHOD_DENIED');
    const allowed=method==='playerSetup'?['sessionId','worldId','config','secret']:method==='playerPrompt'?['sessionId','worldId','text','messageId']:['sessionId','worldId'];
    if(Object.keys(payload).some(key=>!allowed.includes(key)))throw Error('HEADLESS_PLAYER_FIELDS_DENIED');
    if(method!=='playerSetup'&&(!binding||binding.sessionId!==sessionId||binding.worldId!==worldId))throw Error('HEADLESS_PLAYER_BINDING_CHANGED');
    if(method==='playerAbort')return access.invoke('agentAbort',{sessionId});
    if((await access.observe())?.worldId!==worldId)throw Error('HEADLESS_PLAYER_WORLD_CHANGED');
    if(method==='playerStatus')return {sessionId,worldId,active:access.active(sessionId),record:await access.invoke('sessionGet',sessionId),metrics:await access.invoke('sessionTurnMetrics',{sessionId,...(lastMessageId?{messageId:lastMessageId}:{})}),observation:await access.observe(),application:await access.panel('godot.creationTaskStatus',{sessionId}),job:await access.latest(worldId,sessionId)};
    if(busy||access.active(sessionId))throw Error('HEADLESS_PLAYER_BUSY');
    busy=true;
    try{
      const existing=await access.invoke('sessionGet',sessionId);
      if(existing?.session?.id!==sessionId)throw Error('HEADLESS_PLAYER_EXISTING_SESSION_REQUIRED');
      if(method==='playerSetup'){
        if(binding)throw Error('HEADLESS_PLAYER_ALREADY_SETUP');
        const config=payload.config;
        if(!object(config)||config.format!=='craftmine.player-config-snapshot/1'||config.credentialsIncluded!==false||config.vendorKey!=='deepseek'||config.baseUrl!=='https://api.deepseek.com'||config.protocol!=='openai_compatible'||config.apiStyle!=='chat_completions'||typeof config.modelId!=='string'||!/^deepseek-[a-zA-Z0-9._-]+$/.test(config.modelId)||!Array.isArray(config.thinkingLevels)||!config.thinkingLevels.includes(config.thinkingLevel)||!['off','minimal','low','medium','high','xhigh','max'].includes(config.thinkingLevel)||!Number.isSafeInteger(config.contextWindow)||config.contextWindow<=0||!Number.isSafeInteger(config.maxTokens)||config.maxTokens<=0||typeof payload.secret!=='string'||!payload.secret)throw Error('HEADLESS_PLAYER_CONFIGURATION_REQUIRED');
        if(!object(config.modelBinding)||config.modelBinding.id!==config.modelId||config.modelBinding.contextWindow!==config.contextWindow||config.modelBinding.maxTokens!==config.maxTokens||JSON.stringify(config.modelBinding.thinkingLevels)!==JSON.stringify(config.thinkingLevels)||config.mode!=='agent'||!['inherit','ask','accept-edits','auto'].includes(config.permissionMode))throw Error('HEADLESS_PLAYER_COMPLETE_BINDING_REQUIRED');
        const created=await access.invoke('providersCreate',{name:'Isolated player configuration',vendorKey:config.vendorKey,protocol:config.protocol,type:config.protocol,baseUrl:config.baseUrl,authKind:'api_key_and_base_url',secretValue:payload.secret,apiStyle:config.apiStyle,defaultModelId:config.modelId,models:[config.modelBinding]});
        const configured=await access.invoke('sessionConfigure',sessionId,{mode:config.mode,permissionMode:config.permissionMode,providerId:created.provider.id,modelId:config.modelId,thinkingLevel:config.thinkingLevel});
        if(configured.session?.id!==sessionId||configured.session.modelId!==config.modelId||configured.session.thinkingLevel!==config.thinkingLevel)throw Error('HEADLESS_PLAYER_CONFIGURATION_MISMATCH');
        binding={sessionId,worldId};await access.invoke('notificationSetViewingSession',{sessionId});
        return {...binding,modelId:configured.session.modelId,thinkingLevel:configured.session.thinkingLevel,providerId:created.provider.id,contextWindow:config.contextWindow,maxTokens:config.maxTokens,permissionMode:configured.session.permissionMode};
      }
      if(typeof payload.text!=='string'||!payload.text.trim()||!id(payload.messageId))throw Error('HEADLESS_PLAYER_PROMPT_REQUIRED');
      if(sent.has(payload.messageId))throw Error('HEADLESS_PLAYER_ALREADY_SENT');
      const target=await access.panel('godot.creationTarget',{sessionId});
      if(!target?.captureId||target.worldId!==worldId)throw Error('HEADLESS_PLAYER_TARGET_CHANGED');
      sent.add(payload.messageId);
      lastMessageId=payload.messageId;
      const result=await access.invoke('agentPrompt',{sessionId,viewingSessionId:sessionId,messageId:payload.messageId,content:payload.text,requestContext:{creationTarget:{captureId:target.captureId}}});
      return {sessionId,worldId,messageId:payload.messageId,text:payload.text,target,result};
    }finally{busy=false;}
  };
}
