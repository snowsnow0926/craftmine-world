import {useCallback, useEffect, useRef, useState} from "react";
import "./world-brief.css";

type Entry = {id:string;kind:"goal"|"preserve";text:string;review:string};
type Snapshot = {worldId:string;formalBuildId:string;revision:number;entries:Entry[];
  proposals:Array<{id:string;proposal:{entries:Array<{kind:string;text:string}>;revision:number}}>;
  recentRequests:Array<{taskId:string;requestId:string;text:string;truncated:boolean;taskStatus:string}>;
  latestNativeCheck:null|{status:string;matchesFormalBuild:boolean}};
const labels:Record<string,string> = {
  WORLD_BUSY:"当前操作结束后再保存作品目标。", WORLD_CHANGED:"世界已切换，请重新打开作品目标。",
  WORLD_BRIEF_REVISION_CONFLICT:"目标已被更新，请刷新后再修改。", WORLD_BRIEF_BUILD_CHANGED:"世界版本已变化，请重新试玩后确认。",
  WORLD_BRIEF_PROPOSAL_STALE:"这条建议基于旧目标，请让 AI 重新整理。", WORLD_BRIEF_GOAL_LIMIT:"最多保留 32 项，请先整理已有目标。",
};

/** Player goals and human review, never a synthetic gameplay pass checklist. */
export function WorldBriefPanel({worldId,bridge,zh,onContinue}:{worldId:string;
  bridge:{call:(channel:string,args:Record<string,unknown>)=>Promise<unknown>;onChanged?:(listener:()=>void)=>()=>void};zh:boolean;
  onContinue:(text:string)=>Promise<void>}) {
  const [open,setOpen]=useState(false),[data,setData]=useState<Snapshot|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [kind,setKind]=useState("goal"),[text,setText]=useState(""),[editing,setEditing]=useState<string|null>(null);
  const current=useRef(worldId),epoch=useRef(0),locked=useRef(false);current.current=worldId;
  const refresh=useCallback(async()=>{
    const ticket=++epoch.current;
    const value=await bridge.call("world.brief",{worldId,action:"read"}) as Snapshot;
    if(!value||value.worldId!==worldId||!Number.isSafeInteger(value.revision)||!Array.isArray(value.entries)||!Array.isArray(value.proposals)||!Array.isArray(value.recentRequests))throw Error("WORLD_BRIEF_RESPONSE_INVALID");
    if(current.current===worldId&&ticket===epoch.current)setData(value);
  },[worldId,bridge]);
  useEffect(()=>{setData(null);setText("");setEditing(null);setError("");return()=>{++epoch.current;};},[worldId]);
  useEffect(()=>{
    if(!open)return;
    const changed=()=>{setData(null);void refresh().catch(e=>{if(current.current===worldId)setError(String(e.message));});};
    changed();const off=bridge.onChanged?.(changed);window.addEventListener("craftmine-world-changed",changed);
    return()=>{++epoch.current;off?.();window.removeEventListener("craftmine-world-changed",changed);};
  },[open,refresh,bridge,worldId]);
  const act=async(action:string,params:Record<string,unknown>={})=>{
    if(locked.current||!data)return;locked.current=true;setBusy(true);setError("");
    const origin=worldId;
    try {await bridge.call("world.brief",{worldId,action,expectedRevision:data.revision,operationId:crypto.randomUUID(),...params});
      if(current.current===origin){setText("");setEditing(null);await refresh();}}
    catch(e){if(current.current===origin)setError((e as Error).message);}
    finally{locked.current=false;if(current.current===origin)setBusy(false);}
  };
  const continueGoal=async(entry:Entry)=>{
    if(locked.current)return;locked.current=true;setBusy(true);setError("");
    try {await onContinue(zh?`继续当前世界的作品目标：${entry.text}\n请读取作品目标和实际世界，保留其他已确认要求；检查实际玩法，未验证的部分明确说明。`:`Continue this world's goal: ${entry.text}\nRead the world brief and actual world. Preserve other confirmed requirements, check actual behavior and clearly state unverified parts.`);}
    catch(e){setError((e as Error).message);}finally{locked.current=false;setBusy(false);}
  };
  return <details className="world-brief-panel" data-world-brief={worldId} open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary>{zh?"作品目标与进展":"World goals and progress"}</summary>
    {open&&<div className="world-brief-body">
      <form onSubmit={event=>{event.preventDefault();void refresh().catch(e=>setError(String(e.message)));}}><button disabled={busy}>{zh?"刷新当前版本":"Refresh current version"}</button></form>
      {data&&<>
        <p>{zh?"目标随作品保留；试玩认可仅适用于对应版本。":"Goals stay with this world; playtest acceptance applies to its reviewed version."}</p>
        <p data-world-native-check>{!data.latestNativeCheck?(zh?"尚无原生检查记录":"No native check recorded"):
          data.latestNativeCheck.matchesFormalBuild?(zh?`当前版本原生检查：${data.latestNativeCheck.status}；玩法目标另行试玩确认。`:`Current native check: ${data.latestNativeCheck.status}; review gameplay goals separately.`):
          (zh?"最近检查属于其他版本，不能代表当前目标已完成。":"The latest check belongs to another build and does not establish current goals.")}</p>
        <div>{data.entries.map(entry=><div key={entry.id} className="world-brief-goal" data-world-brief-goal={entry.id}>
          <strong>{entry.kind==="preserve"?(zh?"保留要求":"Preserve"):(zh?"目标":"Goal")}</strong><p>{entry.text}</p>
          <span>{entry.review==="player-accepted-current-build"?(zh?"你已认可本版":"You accepted this build"):entry.review==="player-accepted-older-build"?(zh?"旧版已认可，本版待复查":"Older build accepted; current review pending"):(zh?"待试玩确认":"Awaiting playtest review")}</span>
          <div className="world-brief-actions">
            <button disabled={busy} onClick={()=>void continueGoal(entry)}>{zh?"继续这个目标":"Continue goal"}</button>
            <button disabled={busy} onClick={()=>{setEditing(entry.id);setKind(entry.kind);setText(entry.text);}}>{zh?"编辑":"Edit"}</button>
            <button disabled={busy} onClick={()=>void act("review",{id:entry.id,buildId:data.formalBuildId,accepted:entry.review!=="player-accepted-current-build"})}>{entry.review==="player-accepted-current-build"?(zh?"重新待办":"Mark pending"):(zh?"我已试玩并认可":"I played and accept")}</button>
            <button disabled={busy} onClick={()=>void act("remove",{id:entry.id})}>{zh?"移除":"Remove"}</button>
          </div>
        </div>)}</div>
        <form data-world-brief-add onSubmit={event=>{event.preventDefault();void act(editing?"update":"add",{...(editing?{id:editing}:{}),kind,text});}}>
          <label>{zh?"类型":"Type"}<select value={kind} onChange={event=>setKind(event.target.value)}><option value="goal">{zh?"想完成的目标":"Goal to create"}</option><option value="preserve">{zh?"后续需要保留":"Preserve in later edits"}</option></select></label>
          <textarea aria-label={zh?"作品目标":"World goal"} value={text} maxLength={500} required onChange={event=>setText(event.target.value)}/>
          <button disabled={busy||!text.trim()}>{editing?(zh?"保存修改":"Save edit"):(zh?"加入作品目标":"Add world goal")}</button>
          {editing&&<button type="button" onClick={()=>{setEditing(null);setText("");}}>{zh?"取消编辑":"Cancel edit"}</button>}
        </form>
        {data.proposals.map(item=><details key={item.id} data-world-brief-proposal={item.id}><summary>{zh?"AI 整理建议，尚未采纳":"AI proposal, not accepted"}</summary>
          {item.proposal.entries.map((entry,index)=><p key={index}>{entry.text}</p>)}
          <button disabled={busy||item.proposal.revision!==data.revision} onClick={()=>void act("accept-proposal",{proposalId:item.id})}>{zh?"加入作品目标":"Add to world goals"}</button>
          <button disabled={busy} onClick={()=>void act("dismiss-proposal",{proposalId:item.id})}>{zh?"忽略建议":"Dismiss proposal"}</button>
        </details>)}
        {data.recentRequests.length>0&&<details><summary>{zh?"最近的原始需求":"Recent original requests"}</summary>{data.recentRequests.map(row=><p key={`${row.taskId}:${row.requestId}`}>{row.text}{row.truncated?"…":""}</p>)}</details>}
      </>}
      {error&&<p role="alert">{zh?(labels[Object.keys(labels).find(key=>error.includes(key))??""]??"暂时无法处理作品目标，请刷新后重试。"):"Could not update world goals. Refresh and retry."}<small>{error.match(/WORLD_[A-Z_]+/)?.[0]}</small></p>}
    </div>}
  </details>;
}
