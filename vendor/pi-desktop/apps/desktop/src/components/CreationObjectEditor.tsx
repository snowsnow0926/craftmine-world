import {useEffect,useRef,useState} from "react";
import {useTranslation} from "react-i18next";
import type {useCreationTarget} from "../hooks/use-creation-target";
import {craftmineWorldBridge} from "../lib/craftmine-worlds";

type Status={operationId:string;sessionId:string;worldId?:string;phase:string;receipt?:{operationId:string;undoSupported?:boolean};error?:string};
const statuses=new Map<string,Status>();
const cacheKey=(sessionId:string,worldId:string)=>JSON.stringify([sessionId,worldId]);
const readStatus=(scope:string):Status|null=>{
  if(statuses.has(scope))return statuses.get(scope)!;
  try{const value=JSON.parse(sessionStorage.getItem("creation-edit:"+scope)??"null");if(value&&cacheKey(value.sessionId,value.worldId)===scope&&typeof value.operationId==="string")return value;}catch{}
  return null;
};
const saveStatus=(scope:string,status:Status)=>{statuses.set(scope,status);try{sessionStorage.setItem("creation-edit:"+scope,JSON.stringify(status));}catch{}};
const failures:Record<string,string>={CREATION_DELETE_RULE_DEPENDENCY:"世界中有机关脚本，无法确认删除是否会破坏引用，请先处理机关依赖。",CREATION_UNDO_CONFLICT:"对象已被后续修改，不能撤销这一步。",CREATION_UNDO_UNSUPPORTED:"这条旧操作没有可用的撤销记录。",CREATION_ALREADY_UNDONE:"这条操作已经撤销。",CREATION_TARGET_EXPIRED:"指向已过期，请更新指向后重试。",CREATION_TARGET_STALE:"世界已变化，请更新指向后重试。",CREATION_PLAYER_OVERLAP:"对象会挡住玩家，请移动后重试。",CREATION_OCCUPIED:"对象会与其他物件重叠。"};

export function CreationObjectEditor({controller}:{controller:ReturnType<typeof useCreationTarget>}){
  const zh=useTranslation().i18n.language.startsWith("zh");
  const sessionId=controller.sessionId,target=controller.capture?.target,worldId=controller.capture?.worldId??null;
  const scope=sessionId&&worldId?cacheKey(sessionId,worldId):"";
  const scopeRef=useRef(scope);scopeRef.current=scope;
  const submitted=useRef(false);
  const [open,setOpen]=useState(false),[scale,setScale]=useState([1,1,1]),[color,setColor]=useState("#84a866");
  const [status,setStatus]=useState<Status|null>(()=>scope?readStatus(scope):null);
  const [error,setError]=useState("");
  const [undo,setUndo]=useState<string|null>(null);
  const bridge=craftmineWorldBridge();
  const visibleStatus=status&&status.sessionId===sessionId&&status.worldId===worldId?status:null;
  const busy=!!visibleStatus&&!['applied','failed','interrupted'].includes(visibleStatus.phase);
  const publish=(next:Status,expectedScope=scope)=>{
    saveStatus(expectedScope,next);
    if(scopeRef.current===expectedScope)setStatus(next);
    window.dispatchEvent(new CustomEvent("craftmine-creation-edit-status",{detail:next}));
  };
  useEffect(()=>{setOpen(false);setScale(target?.scale??[1,1,1]);setColor(target?.color??"#84a866");setError("");},[controller.capture?.captureId]);
  useEffect(()=>{setStatus(scope?readStatus(scope):null);setUndo(null);setError("");submitted.current=false;},[scope]);
  useEffect(()=>{
    if(!sessionId||!controller.capture?.captureId||!bridge)return;
    let alive=true;
    void bridge.call("godot.creationEditHistory",{sessionId,captureId:controller.capture.captureId}).then(value=>{if(alive)setUndo((value as any)?.latestUndoOperationId??null);}).catch(()=>{});
    return()=>{alive=false;};
  },[sessionId,controller.capture?.captureId]);
  useEffect(()=>{
    if(!busy||!visibleStatus||!bridge||!sessionId||!worldId)return;
    let alive=true,timer:ReturnType<typeof setTimeout>,missing=0;
    const poll=async()=>{
      try{
        const next=await bridge.call("godot.creationEditStatus",{operationId:visibleStatus.operationId,sessionId,worldId}) as Status;
        if(!alive)return;
        if(next.sessionId!==sessionId||next.operationId!==visibleStatus.operationId||(next.worldId!==undefined&&next.worldId!==worldId))throw Error("CREATION_EDIT_CONTEXT_CHANGED");
        setError("");publish({...next,worldId});
        if(next.phase==="applied"){
          submitted.current=false;
          setUndo(next.receipt?.undoSupported?next.receipt.operationId:null);
          setOpen(false);void controller.refresh();return;
        }
        if(["failed","interrupted"].includes(next.phase)){submitted.current=false;return;}
      }catch(failure){
        if(!alive)return;
        const message=String(failure);setError(message);
        if(message.includes("CONTEXT_CHANGED")||message.includes("PLAYER_CONTEXT_CHANGED"))return;
        if(message.includes("NOT_FOUND")&&++missing>=10){publish({...visibleStatus,phase:"interrupted",error:"请求结果尚未确认，请重新读取原操作状态。"});submitted.current=false;return;}
      }
      if(alive)timer=setTimeout(poll,500);
    };
    void poll();return()=>{alive=false;clearTimeout(timer);};
  },[busy,visibleStatus?.operationId,scope]);
  const submit=async(action:"modify"|"delete"|"undo")=>{
    if(!bridge||!sessionId||!worldId||!controller.capture?.captureId||busy||visibleStatus?.phase==="interrupted"||submitted.current)return;
    submitted.current=true;setError("");
    const operationId=crypto.randomUUID(),requestScope=scope;
    const pending:Status={sessionId,worldId,operationId,phase:"preparing"};publish(pending);
    try{
      const next=await bridge.call("godot.creationEdit",{sessionId,captureId:controller.capture.captureId,operationId,action,...(action==="modify"?{changes:{scale,color}}:{}),...(action==="undo"?{undoOperationId:undo}:{})}) as Status;
      if(next.sessionId!==sessionId||next.operationId!==operationId||(next.worldId!==undefined&&next.worldId!==worldId))throw Error("CREATION_EDIT_CONTEXT_CHANGED");
      // The status poll may have already observed a later phase while this
      // original response was delayed. Never move that operation backwards.
      const current=readStatus(requestScope);
      if(!current||current.operationId!==operationId||current.phase==="preparing")publish({...next,worldId},requestScope);
    }catch(failure){
      if(scopeRef.current!==requestScope)return;
      const known=readStatus(requestScope);if(known?.operationId===operationId&&["applied","failed"].includes(known.phase))return;
      const message=failure instanceof Error?failure.message:String(failure);setError(message);
      // The accepted request may still be running. Poll its retained ID instead
      // of sending a second operation after an uncertain transport failure.
    }
  };
  const problem=error||visibleStatus?.error;
  return <div className="creation-object-editor">
    <div className="creation-target-row">
      <button type="button" disabled={!sessionId||!target?.entityId||!target.scale||!target.color||busy||visibleStatus?.phase==="interrupted"} onClick={()=>setOpen(!open)}>{zh?"编辑对象":"Edit object"}</button>
      <button type="button" title={zh?"支持本版记录的放置、参数修改、复制和删除；旧记录与规则修改暂不可撤销。":"Supports recorded placement, property edits, duplication and deletion; older records and rule edits cannot be undone."} disabled={!sessionId||!undo||busy||visibleStatus?.phase==="interrupted"||!controller.capture?.captureId} onClick={()=>void submit("undo")}>{zh?"撤销上次操作":"Undo last edit"}</button>
    </div>
    {open&&<fieldset disabled={busy}>
      <legend>{target?.entityName??target?.entityId}</legend>
      <div className="creation-target-row">{["X","Y","Z"].map((axis,index)=><label key={axis}>{axis}<input aria-label={`${zh?"尺寸":"Scale"} ${axis}`} type="number" min="0.25" max="4" step="0.25" value={scale[index]} onChange={event=>setScale(values=>values.map((value,i)=>i===index?Number(event.target.value):value))} style={{width:65}}/></label>)}
        <label>{zh?"颜色":"Color"}<input aria-label={zh?"对象颜色":"Object color"} type="color" value={color} onChange={event=>setColor(event.target.value)}/></label>
      </div>
      <div className="creation-target-row">
        <button type="button" disabled={scale.some(n=>!Number.isFinite(n)||n<.25||n>4)} onClick={()=>void submit("modify")}>{zh?"检查并应用":"Check and apply"}</button>
        <button type="button" onClick={()=>void submit("delete")}>{zh?"删除对象":"Delete object"}</button>
        <button type="button" onClick={()=>setOpen(false)}>{zh?"取消":"Cancel"}</button>
      </div>
    </fieldset>}
    {visibleStatus&&<span role="status">{zh?({preparing:"正在准备编辑…",editing:"正在修改…",checking:"正在检查…",applying:"正在应用…",applied:"编辑已应用",failed:"编辑未完成",interrupted:"编辑结果待核对"} as Record<string,string>)[visibleStatus.phase]:visibleStatus.phase}</span>}
    {visibleStatus?.phase==="interrupted"&&<button type="button" onClick={()=>{setError("");publish({...visibleStatus,phase:"preparing"});}}>{zh?"重新读取原操作状态":"Recheck original operation"}</button>}
    {problem&&<span role="alert" className="creation-target-note">{zh?(failures[Object.keys(failures).find(code=>problem.includes(code))??""]??problem):problem}</span>}
  </div>;
}
