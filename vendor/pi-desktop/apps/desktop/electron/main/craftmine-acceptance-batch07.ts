import {randomUUID} from "node:crypto";
import type {BrowserWindow,WebContents} from "electron";

type Access={enabled:boolean;window:()=>BrowserWindow|null;world:()=>WebContents|null;
  call:<T=any>(method:string,args:Record<string,unknown>)=>Promise<T>;
  toolName:(name:string)=>string;begin:(sessionId:string,turnId:string)=>void;
  finish:(sessionId:string)=>Promise<void>};

// Fixed fixture author and fixed gameplay scenarios; no arbitrary source, RPC,
// filesystem path, provider or event can be supplied over this parent channel.
export function installBatch07NativeAcceptance(access:Access):void {
  if(!access.enabled||process.env.CRAFTMINE_BATCH07_NATIVE!=="1"||!process.send)return;
  let sessionId="",worldId="",turnId="",sequence=0,ref:any=null,grant:any=null;
  const contents=()=>{const value=access.world();if(!value)throw Error("World view unavailable");return value;};
  const page=(source:string)=>contents().executeJavaScript(source,false);
  const panel=(channel:string,args:Record<string,unknown>={})=>page(`pluginBridge.invoke(${JSON.stringify(channel)},${JSON.stringify({worldId,...args})})`);
  const raw=(name:string,args:unknown)=>access.call("tools.execute",{sessionId,turnId,toolCallId:`batch07-${++sequence}`,toolName:access.toolName(name),args,mode:"agent",declaredRisk:"medium",timeoutMs:10000});
  const tool=async(name:string,args:unknown)=>{const result=await raw(name,args);if(!result.ok)throw Error(name+": "+JSON.stringify(result));return result.content;};
  async function initialize(fresh=false){
    if(fresh){sessionId="";turnId="";}
    if(sessionId)throw Error("Already initialized");
    worldId=await page("document.body.dataset.worldId");
    const modelId=process.env.CRAFTMINE_F_MODEL||"",secret=process.env.CRAFTMINE_F_KEY||"";
    if(!/^deepseek-[a-z0-9.-]+$/i.test(modelId)||!secret)throw Error("Explicit authorized model required");
    const restored=fresh?undefined:process.env.CRAFTMINE_BATCH07_SESSION;
    if(restored){
      if(!/^[a-f0-9-]{36}$/.test(restored))throw Error("Invalid fixed recovery session");
      const existing=await access.call("session.get",{id:restored});if(existing.session?.id!==restored)throw Error("Recovery session missing");sessionId=restored;
      const window=access.window();if(!window)throw Error("Desktop unavailable");
      await window.webContents.executeJavaScript(`piDesktop.invoke(piDesktop.channels.invoke.notificationSetViewingSession,${JSON.stringify({sessionId})})`,false);
      return {sessionId,worldId,modelId,reopened:true};
    }
    const created=await access.call("session.create",{title:"Batch07 fixed authored gameplay acceptance"});sessionId=created.session.id;
    const provider=await access.call("providers.create",{name:"Isolated real batch07 reviewer",vendorKey:"deepseek",protocol:"openai_compatible",type:"openai_compatible",baseUrl:"https://api.deepseek.com",authKind:"api_key_and_base_url",secretValue:secret,apiStyle:"chat_completions",defaultModelId:modelId,models:[{id:modelId,contextWindow:1000000,maxTokens:32768,thinkingLevels:["off","low","medium","high"]}]});
    await access.call("session.configure",{id:sessionId,mode:"agent",permissionMode:"auto",providerId:provider.provider.id,modelId,thinkingLevel:process.env.CRAFTMINE_F_THINKING||"high"});
    const window=access.window();if(!window)throw Error("Desktop unavailable");
    await window.webContents.executeJavaScript(`piDesktop.invoke(piDesktop.channels.invoke.notificationSetViewingSession,${JSON.stringify({sessionId})})`,false);
    return {sessionId,worldId,modelId,authorship:"fixed-D-fixture; actual PI tool dispatch; actual model review"};
  }
  async function apply(acknowledgeWarnings=false){
    const jobs=await panel("verification.list",{limit:16}),job=(Array.isArray(jobs)?jobs:jobs.items).find((j:any)=>j.current&&j.status==="passed");
    if(!job)throw Error("No current passed verification");
    return page(`(async()=>{
      await craftmineView.preview(${JSON.stringify(job.id)});
      const deadline=Date.now()+240000;
      const button=()=>${acknowledgeWarnings}&&!document.getElementById('apply-world-warnings').hidden?document.getElementById('apply-world-warnings'):document.getElementById('apply-world');
      while(button().disabled&&Date.now()<deadline){
        const reviews=await pluginBridge.invoke('review.list',{verificationId:${JSON.stringify(job.id)}});
        if(reviews[0]&&['failed','cancelled','interrupted'].includes(reviews[0].status))throw Error(JSON.stringify(reviews[0]));
        if(reviews[0]?.status==='completed'&&reviews[0].acceptance?.passed===false&&!${acknowledgeWarnings})throw Error('Explicit player acknowledgement required: '+JSON.stringify(reviews[0]));
        await new Promise(r=>setTimeout(r,250));
      }
      if(button().disabled)throw Error('Actual review did not enable application');
      const acknowledged=button().id==='apply-world-warnings',reviewNotes=document.getElementById('review-notes').textContent;
      document.getElementById('apply-form').requestSubmit(button());
      while(Date.now()<deadline){if(!document.body.dataset.previewLoaded&&document.body.dataset.worldLoaded==='true')return {verificationId:${JSON.stringify(job.id)},acknowledged,reviewNotes,snapshot:await craftmineView.snapshot()};await new Promise(r=>setTimeout(r,100));}
      throw Error('Actual application timeout');
    })()`);
  }
  async function run(method:string):Promise<unknown>{
    if(method==="initialize")return initialize();
    if(method==="initializeDestination"){
      const candidate=JSON.parse(process.env.CRAFTMINE_BATCH07_CAPTURE_REF||'null');
      if(!candidate||Object.keys(candidate).sort().join(',')!=='hash,id,version'||!/^saved-[a-f0-9]{32}$/.test(candidate.id)||!Number.isSafeInteger(candidate.version)||!/^[a-f0-9]{64}$/.test(candidate.hash))throw Error('Invalid fixed captured reference');
      ref=candidate;return initialize(true);
    }
    if(method.startsWith("game:")){
      const name=method.slice(5);
      if(!["observe","fall","ranged-hit","ranged-miss","ranged-far","attack-now","equip-melee","equip-ranged","melee-far","melee-hit","drain","reload","reload-complete","tick"].includes(name))throw Error("Unknown fixed game scenario");
      const frames=contents().mainFrame.framesInSubtree.filter(frame=>frame!==contents().mainFrame);
      if(frames.length!==1)throw Error("Exactly one formal game frame required");
      return frames[0]!.executeJavaScript(`globalThis.__craftmineNativeAcceptance.invoke(${JSON.stringify(name)})`,false);
    }
    if(method==="save")return page("craftmineView.prepareClose()");
    if(method==="snapshot")return {worldId:await page("document.body.dataset.worldId"),snapshot:await page("craftmineView.snapshot()")};
    if(!sessionId)throw Error("Initialize first");
    if(method==="sourceWorld"){
      const list=await panel('world.list'),source=list.worlds.find((world:any)=>world.title==='花园训练场');
      if(!source)throw Error('Fixed source world missing');
      if(await page("document.body.dataset.worldId")===source.id){worldId=source.id;return {id:worldId,unchanged:true};}
      await page(`(()=>{const select=document.getElementById('world-list');select.value=${JSON.stringify(source.id)};select.dispatchEvent(new Event('change'));})()`);
      const deadline=Date.now()+15000;while(Date.now()<deadline){const state=await page("({id:document.body.dataset.worldId,loaded:document.body.dataset.worldLoaded,busy:document.getElementById('world-list').disabled})");if(state.id===source.id&&state.loaded==='true'&&!state.busy){worldId=state.id;return state;}await new Promise(r=>setTimeout(r,100));}throw Error('Source world switch timed out');
    }
    if(method==="author"){
      const turn=await access.call("session.beginTurn",{sessionId});turnId=turn.turnId;access.begin(sessionId,turnId);
      await access.call("session.appendMessage",{sessionId,turnId,message:{id:randomUUID(),role:"user",content:"保留已导入花园训练场的树、花草、射击近战生命值、击破训练靶奖励和按G吸血的玩法。只把 training-target 名称改为复用训练靶。验证所有已有玩法仍可运行，然后保留候选让我应用。",createdAt:new Date().toISOString(),status:"complete"}});
      const inspected=await tool("project_inspect",{}),read=await tool("resource_read",{kind:"object",id:"training-target"}),value=JSON.parse(read.text);value.name="复用训练靶";
      const patch=await tool("workspace_patch",{workspaceRevision:inspected.workspaceRevision,operations:[{op:"replace",kind:"object",id:value.id,expectedHash:read.hash,value}]});
      const verification=await tool("verification_submit",{workspaceRevision:patch.workspaceRevision,summary:"固定示例作者：保留完整花园训练场，仅修改训练靶名称"});
      return {inspected,patch,verification,sessionId,turnId};
    }
    if(method==="jobs")return {verifications:await panel("verification.list",{limit:16}),context:await panel("task.current")};
    if(method==="budget")return page(`(async()=>{
      const before=await pluginBridge.invoke('task.current',{worldId:document.body.dataset.worldId});
      if(!before.context)throw Error('Actual current task missing');
      await craftmineView.showWorkbench('task');
      const deadline=Date.now()+20000;
      const find=label=>[...document.querySelectorAll('[data-workbench-page="task"] button')].find(button=>button.textContent===label);
      while(!find('保存累计额度')&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
      const saveButton=find('保存累计额度');if(!saveButton||saveButton.disabled)throw Error('Actual budget control unavailable: '+document.querySelector('[data-workbench-page="task"]')?.textContent);
      saveButton.form.querySelector('input[type="number"]').value='100';saveButton.form.requestSubmit(saveButton);
      let limited;
      while(Date.now()<deadline){limited=await pluginBridge.invoke('task.current',{worldId:document.body.dataset.worldId});if(limited.context?.budget.limits.maxTokens===100)break;await new Promise(r=>setTimeout(r,100));}
      if(limited?.context?.budget.limits.maxTokens!==100)throw Error('Actual finite budget did not persist');
      while((!find('解除本地累计 token 上限')||find('解除本地累计 token 上限').disabled)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
      const unlimited=find('解除本地累计 token 上限');if(!unlimited||unlimited.disabled)throw Error('Actual unlimited control unavailable');unlimited.form.requestSubmit(unlimited);
      let after;
      while(Date.now()<deadline){after=await pluginBridge.invoke('task.current',{worldId:document.body.dataset.worldId});if(after.context?.budget.limits.maxTokens===null)break;await new Promise(r=>setTimeout(r,100));}
      if(after?.context?.budget.limits.maxTokens!==null)throw Error('Actual unlimited budget did not persist');
      return {before,limited,after,text:document.querySelector('[data-workbench-page="task"]').textContent};
    })()`);
    if(method==="retryReview"){
      const jobs=await panel("verification.list",{limit:16}),job=(Array.isArray(jobs)?jobs:jobs.items).find((j:any)=>j.current&&j.status==="passed");
      if(!job)throw Error("No current passed verification");
      return panel("review.start",{verificationId:job.id});
    }
    if(method==="apply")return apply();
    if(method==="applyWarnings")return apply(true);
    if(method==="finish"){await access.finish(sessionId);turnId="";return {finished:true};}
    if(method==="capture"){const result=await panel("library.capture",{operationId:"batch07-capture-garden",kind:"creation",resourceId:"training-rewards",tags:["batch07-native-garden"]});ref=result.ref;return result;}
    if(method==="newWorld"){
      const previous=worldId;
      await page("document.getElementById('world-name').value='作品库复用训练场';document.getElementById('create-form').requestSubmit()");
      const deadline=Date.now()+15000;while(Date.now()<deadline){const state=await page("({id:document.body.dataset.worldId,loaded:document.body.dataset.worldLoaded})");if(state.id!==previous&&state.loaded==='true'){worldId=state.id;return {...state,session:await initialize(true)};}await new Promise(r=>setTimeout(r,100));}throw Error("New world timeout");
    }
    if(method==="install"){if(!ref)throw Error("Capture first");return panel("library.install",{operationId:"batch07-install-garden",ref,position:{x:-1.1,y:6,z:8}});}
    if(method==="memory")return panel("memory.propose",{operationId:"batch07-training-rule",kind:"project-rule",claim:"这个训练世界复用组合玩法时保留扩展的固定版本。",tags:["batch07"]});
    if(method==="backup"){const exported=await panel("backup.export",{operationId:"batch07-backup"});grant=await panel("backup.inspect");return {exported,inspected:grant};}
    if(method==="restoreBackup"){if(!grant?.grantId)throw Error("Inspect first");return panel("backup.restore",{operationId:"batch07-restore-"+grant.grantId,grantId:grant.grantId,expectedCurrentHash:grant.expectedCurrentHash});}
    throw Error("Unknown fixed batch07 operation");
  }
  process.on("message",(message:any)=>{
    if(message?.type!=="craftmine-acceptance-batch07"||typeof message.id!=="string")return;
    if(Object.keys(message).some(key=>!["type","id","method"].includes(key))){process.send?.({type:message.type,id:message.id,error:"Unexpected acceptance fields"});return;}
    void run(message.method).then(result=>process.send?.({type:message.type,id:message.id,result}),error=>process.send?.({type:message.type,id:message.id,error:String(error?.message||error)}));
  });
}
