// Opt-in evaluator of the actual renderer -> host -> model -> product tool path.
// It is reachable only in an already validated, isolated headless profile.
import {createEvaluationBudget} from "./creation-evaluation-budget";
import {evaluationGroundHasSpace} from "./creation-evaluation-placement";
import {assertEvaluationSession,recordEvaluationSession} from "./creation-evaluation-session";
import {randomUUID} from "node:crypto";
import type {BrowserWindow} from "electron";

let requestBudget:ReturnType<typeof createEvaluationBudget>|undefined;
export function reserveCreationEvaluationRequest(requestId:string){requestBudget?.reserve(requestId);}
const prompts:Record<string,string>={
  CA01:"在这里放一棵树",
  CA02:"把这棵树变大一倍",
  CA03:"复制这棵树两个，排开一点",
  CA04:"把时间设为18点",
  CA05:"让这棵树可以按E砍伐，砍掉时给背包增加一块木头，5秒后重新长出来。保存重开后保留木头和树的生长状态。",
  CA06:"在这里再放一块石头，保留已有物体和游玩进度",
  CA07:"在这个副本的这里放一棵树，保留之前的内容",
  HOLDOUT01:"这棵树的颜色改成#88bb44，其他东西保持原样",
};
type Access={enabled:boolean;window:()=>BrowserWindow|null;call:(method:string,input:Record<string,unknown>)=>Promise<any>;active:(sessionId:string)=>boolean;observe:()=>Promise<any>;action:(op:string,args:Record<string,unknown>)=>Promise<any>;domain:(method:string,args:Record<string,unknown>)=>Promise<any>};
export function installCreationEvaluation(access:Access){
  if(!access.enabled||process.env.CRAFTMINE_CREATION_EVAL!=="1"||!process.send)return;
  requestBudget=createEvaluationBudget(process.env.CRAFTMINE_DATA_DIR??"",40);
  let sessionId="";const submitted=new Set<string>();
  const desktop=async(source:string)=>{const window=access.window();if(!window||window.isDestroyed())throw Error("EVALUATION_WINDOW_UNAVAILABLE");return window.webContents.executeJavaScript(source,false);};
  const invoke=(name:string,args:unknown)=>desktop(`piDesktop.invoke(piDesktop.channels.invoke[${JSON.stringify(name)}],${JSON.stringify(args)})`);
  const register=async(session:any)=>{const list=await access.call("providers.list",{});const provider=list.providers?.find((item:any)=>item.id===session?.providerId);recordEvaluationSession(process.env.CRAFTMINE_DATA_DIR??"",assertEvaluationSession(session,provider,process.env.CRAFTMINE_EVAL_MODEL??"",process.env.CRAFTMINE_EVAL_THINKING??"high"));};
  const run=async(method:string,caseId?:string)=>{
    if(method==="initialize"){
      if(sessionId)throw Error("EVALUATION_ALREADY_INITIALIZED");
      const modelId=process.env.CRAFTMINE_EVAL_MODEL??"",secret=process.env.CRAFTMINE_EVAL_KEY??"";
      if(!/^deepseek-[a-z0-9.-]+$/.test(modelId)||!secret)throw Error("EVALUATION_EXPLICIT_MODEL_REQUIRED");
      const previous=process.env.CRAFTMINE_EVAL_SESSION;
      if(previous){
        if(!/^[a-f0-9-]{36}$/.test(previous))throw Error("EVALUATION_SESSION_INVALID");
        const found=await access.call("session.get",{id:previous});
        if(found.session?.id!==previous)throw Error("EVALUATION_SESSION_MISSING");
        await register(found.session);
        sessionId=previous;await invoke("notificationSetViewingSession",{sessionId});return {sessionId,modelId,reopened:true};
      }
      const created=await access.call("session.create",{title:"造物世界真实模型评测"});sessionId=created.session.id;
      const provider=await access.call("providers.create",{name:"Isolated creation evaluation",vendorKey:"deepseek",protocol:"openai_compatible",type:"openai_compatible",baseUrl:"https://api.deepseek.com",authKind:"api_key_and_base_url",secretValue:secret,apiStyle:"chat_completions",defaultModelId:modelId,
        models:[{id:modelId,contextWindow:1000000,maxTokens:16384,thinkingLevels:["off","low","high"]}]});
      await access.call("session.configure",{id:sessionId,mode:"agent",permissionMode:"auto",providerId:provider.provider.id,modelId,thinkingLevel:process.env.CRAFTMINE_EVAL_THINKING??"high"});
      await register((await access.call("session.get",{id:sessionId})).session);
      await invoke("notificationSetViewingSession",{sessionId});
      return {sessionId,modelId};
    }
    if(!sessionId)throw Error("EVALUATION_NOT_INITIALIZED");
    if(method==="resume-play")return access.action("resume",{});
    if(method==="pause-play")return access.action("pause",{});
    if(method==="copy-world"){
      if(access.active(sessionId))throw Error("EVALUATION_ACTIVE_TASK");
      const sourceSessionId=sessionId,source=(await access.call("session.get",{id:sourceSessionId})).session;
      const original=await access.observe(),sourceWorldId=original?.worldId;
      if(!source||!sourceWorldId)throw Error("EVALUATION_COPY_SOURCE_REQUIRED");
      await desktop(`(()=>{const button=document.querySelector('[data-godot-copy-world] button');if(!button||button.disabled)throw Error('EVALUATION_COPY_BUTTON_UNAVAILABLE');const key=Object.keys(button).find(key=>key.startsWith('__reactProps'));if(!key||typeof button[key].onClick!=='function')throw Error('EVALUATION_COPY_CALLBACK_UNAVAILABLE');button[key].onClick();})()`);
      const deadline=Date.now()+600000;let selected:{sessionId:string;worldId:string}|null=null;
      while(Date.now()<deadline){
        const state=await desktop(`(()=>{const copy=document.querySelector('[data-godot-copy-world]');return {sessionId:copy?.dataset.copySession,worldId:copy?.dataset.copyTargetWorld,viewing:document.querySelector('[data-world-session]')?.dataset.worldSession,error:copy?.querySelector('[role="alert"]')?.textContent};})()`);
        if(state.error)throw Error(state.error);
        if(state.sessionId&&state.sessionId!==sourceSessionId&&state.worldId&&state.worldId!==sourceWorldId&&state.viewing===state.sessionId){selected=state;break;}
        await new Promise(resolve=>setTimeout(resolve,250));
      }
      if(!selected)throw Error("EVALUATION_COPY_SESSION_TIMEOUT");
      const live=await access.observe();if(live?.worldId!==selected.worldId)throw Error("EVALUATION_COPY_WORLD_CHANGED");
      const created=(await access.call("session.get",{id:selected.sessionId})).session;
      if(!created||created.id===sourceSessionId||created.messages?.length)throw Error("EVALUATION_COPY_SESSION_NOT_FRESH");
      // The product used normal new-chat defaults. This opt-in evaluator then
      // keeps the same explicitly selected test model without changing providers.
      await access.call("session.configure",{id:created.id,mode:source.mode,providerId:source.providerId,modelId:source.modelId,thinkingLevel:source.thinkingLevel,permissionMode:source.permissionMode});
      await access.call("session.rename",{id:created.id,title:"造物世界真实模型评测"});
      await register((await access.call("session.get",{id:created.id})).session);
      sessionId=created.id;await invoke("notificationSetViewingSession",{sessionId});
      return {status:"ready",sourceWorldId,worldId:selected.worldId,targetWorldId:selected.worldId,sourceSessionId,sessionId,budget:requestBudget?.snapshot(),modelRequestsAdded:0};
    }
    if(method==="chop-tree"){
      const observed=await access.observe(),creation=observed?.payload?.creation;
      if(observed?.baseId!=="creation-sandbox"||!creation?.entities?.some((entity:any)=>entity.kind==="tree"&&entity.id===creation.target?.entityId))throw Error("EVALUATION_TREE_NOT_TARGETED");
      return access.action("interact",{});
    }
    if(method==="wait-regrowth")return access.action("wait",{frames:300});
    if(method==="aim-ground"||method==="aim-tree"){
      const sample=await access.observe();if(sample.baseId!=="creation-sandbox")throw Error("EVALUATION_CREATION_BASE_REQUIRED");
      let yaw=.55,pitch=-.4;
      if(method==="aim-ground"){
        for(const groundPitch of [-.4,-.55,-.7])for(const angle of [.55,-.55,1.1,-1.1,0,2,-2,3]){
          const result=await access.action("look",{yaw:angle,pitch:groundPitch});if(result?.error)throw Error(result.error);
          const observation=await access.observe();
          if(evaluationGroundHasSpace(observation))return {result,observation};
        }
        throw Error("EVALUATION_GROUND_NOT_TARGETED");
      }
      if(method==="aim-tree"){
        const tree=sample.payload?.creation?.entities?.find((item:any)=>item.kind==="tree");
        const obstacle=sample.payload?.creation?.obstacles?.find((item:any)=>item.entityId===tree?.id);
        const player=sample.payload?.player?.position;
        if(!tree||!obstacle||!Array.isArray(player))throw Error("EVALUATION_TREE_ABSENT");
        const center=obstacle.min.map((v:number,i:number)=>(v+obstacle.max[i])/2);
        const dx=center[0]-player[0],dy=center[1]-(player[1]+.6),dz=center[2]-player[2];
        yaw=Math.atan2(-dx,-dz);pitch=Math.atan2(dy,Math.hypot(dx,dz));
      }
      const result=await access.action("look",{yaw,pitch});
      if(result?.error)throw Error(result.error);
      return {result,observation:await access.observe()};
    }
    if(method==="capture")return desktop(`piDesktop.pluginPanelInvoke("craftmine.world","godot.creationTarget",${JSON.stringify({sessionId})})`);
    if(method==="enable-auto-apply"){
      const observed=await access.observe();if(observed.baseId!=="creation-sandbox")throw Error("EVALUATION_CREATION_BASE_REQUIRED");
      return desktop(`piDesktop.pluginPanelInvoke("craftmine.world","godot.creationPolicy",${JSON.stringify({worldId:observed.worldId,autoApply:true})})`);
    }
    if(method==="snapshot"){
      const observation=await access.observe().catch(()=>null);
      const worldId=observation?.worldId;
      return {sessionId,budget:requestBudget?.snapshot(),active:access.active(sessionId),record:await access.call("session.get",{id:sessionId}),metrics:await access.call("session.turnMetrics",{sessionId}).catch(()=>null),observation,
        world:worldId?await access.domain("world.read",{id:worldId}):null,
        job:worldId?await access.domain("godotBuild.latest",{worldId,sessionId}):null};
    }
    if(method==="abort")return invoke("agentAbort",{sessionId});
    if(method==="prompt"){
      if(!caseId||!Object.hasOwn(prompts,caseId)||submitted.has(caseId)||access.active(sessionId))throw Error("EVALUATION_CASE_DENIED");
      const target=await desktop(`piDesktop.pluginPanelInvoke("craftmine.world","godot.creationTarget",${JSON.stringify({sessionId})})`);
      if(!target.captureId)throw Error("EVALUATION_TARGET_UNAVAILABLE");
      submitted.add(caseId);
      const content=prompts[caseId];
      const result=await invoke("agentPrompt",{sessionId,viewingSessionId:sessionId,messageId:randomUUID(),content,requestContext:{creationTarget:{captureId:target.captureId}}});
      return {caseId,content,target,result};
    }
    throw Error("EVALUATION_METHOD_DENIED");
  };
  process.on("message",(message:any)=>{
    if(message?.type!=="craftmine-creation-evaluation"||typeof message.id!=="string")return;
    if(Object.keys(message).some(k=>!["type","id","method","caseId"].includes(k)))return;
    void run(message.method,message.caseId).then(result=>process.send?.({type:message.type,id:message.id,result}),error=>process.send?.({type:message.type,id:message.id,error:String(error?.message??error)}));
  });
}
