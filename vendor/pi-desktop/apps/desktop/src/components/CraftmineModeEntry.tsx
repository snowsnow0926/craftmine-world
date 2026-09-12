import {useRef,useState} from "react";
import {useTranslation} from "react-i18next";
import {Box, Globe2} from "lucide-react";
import {usePlayerWorlds} from "../hooks/use-player-worlds";
import type {PlayerWorldKind} from "../lib/player-worlds";
import {useAppStore,beginPlayerWorldEntry} from "../stores/app-store";
import {WindowControls} from "./WindowControls";
import "../styles/craftmine-mode-entry.css";

/** Two fixed host-owned slots. Opening a world never submits a model request. */
export function CraftmineModeEntry({onSelect,onCancel,onManage}: {
  onSelect:(mode:"play",worldId?:string)=>void;
  onCancel?:()=>void;
  onManage?:()=>void;
}) {
  const {i18n}=useTranslation();
  const chinese=i18n.language.startsWith("zh");
  const {worlds,error,pending,canCancel,cancelling,cancel,refresh,enter}=usePlayerWorlds();
  const opening=useRef(false);
  const [entryError,setEntryError]=useState("");
  const choose=async(kind:PlayerWorldKind)=>{
    if(opening.current)return;
    opening.current=true;
    setEntryError("");
    try {
      const complete=await beginPlayerWorldEntry();
      const id=await enter(kind);
      if(id&&!await complete(id,()=>onSelect("play",id)))setEntryError(chinese?"对话或输入已改变。内容已保留，请再次选择世界。":"Your conversation or input changed. It was preserved; choose the world again.");
    } catch(failure){setEntryError(failure instanceof Error?failure.message:String(failure));}
    finally {opening.current=false;}
  };
  const manage=()=>{
    const state=useAppStore.getState();state.setSettingsTab("general");state.setPage("settings");
    (onManage??onCancel)?.();
    window.dispatchEvent(new CustomEvent("craftmine-world-archives-open"));
  };
  return <main className="craftmine-mode-entry" aria-labelledby="craftmine-mode-entry-title" data-mode-entry>
    <header className="craftmine-mode-entry-titlebar"><span>CRAFTMINE WORLD</span><WindowControls/></header>
    <div className="craftmine-mode-entry-content no-drag">
      <h1 id="craftmine-mode-entry-title">{chinese?"选择你的世界":"Choose your world"}</h1>
      <div className="craftmine-mode-choices">
        {(["godot","web"] as const).map(kind=>{
          const slot=worlds?.slots.find(slot=>slot.kind===kind);
          const active=worlds?.activeKind===kind;
          const label=kind==="godot"?"Godot 3D":chinese?"Web 世界":"Web world";
          return <button key={kind} type="button" className="craftmine-mode-choice" data-player-world={kind}
            data-world-id={slot?.worldId??undefined} data-world-state={slot?.state??"loading"}
            disabled={!slot||pending!==null} onClick={()=>void choose(kind)}>
            {kind==="godot"?<Box className="craftmine-mode-icon" size={48} aria-hidden/>:<Globe2 className="craftmine-mode-icon" size={48} aria-hidden/>}
            <h2>{label}</h2>
            <p>{kind==="godot"?(chinese?"进入三维世界，用对话创造和修改。":"Enter your 3D world. Create and change it through conversation."):(chinese?"进入网页世界，继续搭建和探索。":"Enter your web world. Keep building and exploring.")}</p>
            {slot?.worldId&&<span className="craftmine-mode-current-world">{slot.title}{active?(chinese?" · 当前世界":" · Current world"):""}</span>}
            <span className="craftmine-mode-choice-action">{pending===kind?(chinese?"正在准备并进入…":"Preparing and entering…")
              :slot?.state==="failed"?(chinese?"重试进入":"Retry entering")
              :slot?.state==="initializing"?(chinese?"继续准备并进入":"Continue preparing and enter")
              :chinese?"进入世界":"Enter world"}</span>
            {slot?.state==="initializing"&&typeof slot.progress==="number"&&Number.isFinite(slot.progress)&&<progress max={100} value={Math.max(0,Math.min(100,slot.progress))} aria-label={chinese?"世界准备进度":"World preparation progress"}/>}
            {slot?.error&&<span>{slot.error}</span>}
          </button>;
        })}
      </div>
      {pending&&<p role="status" data-player-world-pending={pending}>{chinese?"正在保存当前进度并打开所选世界…":"Saving current progress and opening the selected world…"}</p>}
      {canCancel&&<button type="button" data-player-world-cancel disabled={cancelling} onClick={()=>void cancel()}>{cancelling?(chinese?"正在取消准备…":"Cancelling preparation…"):(chinese?"取消准备，保留世界":"Cancel preparation and keep world")}</button>}
      {(error||entryError)&&<p role="alert" data-player-world-error>{entryError||error}</p>}
      {!worlds&&!error&&<p role="status">{chinese?"正在读取世界…":"Loading your worlds…"}</p>}
      {error&&<button type="button" disabled={!!pending} onClick={()=>void refresh()}>{chinese?"重新读取":"Refresh"}</button>}
      {worlds?.activeWorldId&&!worlds.activeKind&&<p role="status">{chinese?"当前打开的是旧作品，可在高级存档管理中继续访问。":"The current world is a legacy project. It remains available in advanced save management."}</p>}
      <button type="button" className="craftmine-mode-manage" disabled={!!pending} onClick={manage}>{chinese?"设置与高级存档管理":"Settings and advanced saves"}</button>
    </div>
    {onCancel&&worlds?.activeKind&&worlds.slots.some(slot=>slot.kind===worlds.activeKind&&slot.worldId===worlds.activeWorldId&&slot.state==="ready")&&<button type="button" className="craftmine-mode-back no-drag" disabled={!!pending} onClick={onCancel}>{chinese?"返回当前世界":"Return to current world"}</button>}
  </main>;
}
