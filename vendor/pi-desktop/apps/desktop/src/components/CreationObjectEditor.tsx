import {useEffect,useState} from "react";
import {useTranslation} from "react-i18next";
import type {useCreationTarget} from "../hooks/use-creation-target";
import {craftmineWorldBridge} from "../lib/craftmine-worlds";

type Status={operationId:string;sessionId:string;phase:string;receipt?:{operationId:string;undoSupported?:boolean};error?:string};
const statuses=new Map<string,Status>();
const failures:Record<string,string>={CREATION_DELETE_RULE_DEPENDENCY:"世界中有机关脚本，无法确认删除是否会破坏引用，请先处理机关依赖。",CREATION_UNDO_CONFLICT:"对象已被后续修改，不能撤销这一步。",CREATION_UNDO_UNSUPPORTED:"这条旧操作没有可用的撤销记录。",CREATION_ALREADY_UNDONE:"这条操作已经撤销。",CREATION_TARGET_EXPIRED:"指向已过期，请更新指向后重试。",CREATION_TARGET_STALE:"世界已变化，请更新指向后重试。",CREATION_PLAYER_OVERLAP:"对象会挡住玩家，请移动后重试。",CREATION_OCCUPIED:"对象会与其他物件重叠。"};

export function CreationObjectEditor({controller}:{controller:ReturnType<typeof useCreationTarget>}){
  const zh=useTranslation().i18n.language.startsWith("zh");
  const sessionId=controller.sessionId,target=controller.capture?.target;
  const [open,setOpen]=useState(false),[scale,setScale]=useState([1,1,1]),[color,setColor]=useState("#84a866");
  const [status,setStatus]=useState<Status|null>(()=>sessionId?statuses.get(sessionId)??null:null);
  const [error,setError]=useState("");
  const [undo,setUndo]=useState<string|null>(null);
  const bridge=craftmineWorldBridge();
  const busy=!!status&&!['applied','failed'].includes(status.phase);
  useEffect(()=>{setOpen(false);setScale(target?.scale??[1,1,1]);setColor(target?.color??"#84a866");setError("");},[controller.capture?.captureId]);
  useEffect(()=>{setStatus(sessionId?statuses.get(sessionId)??null:null);setUndo(null);},[sessionId]);
  useEffect(()=>{
    if(!sessionId||!controller.capture?.captureId||!bridge)return;
    let alive=true;
    void bridge.call("godot.creationEditHistory",{sessionId,captureId:controller.capture.captureId}).then(value=>{if(alive)setUndo((value as any)?.latestUndoOperationId??null);}).catch(()=>{});
    return()=>{alive=false;};
  },[sessionId,controller.capture?.captureId]);
  useEffect(()=>{
    if(!busy||!status||!bridge)return;
    let alive=true,timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{
      try{
        const next=await bridge.call("godot.creationEditStatus",{operationId:status.operationId}) as Status;
        if(!alive)return;
        statuses.set(next.sessionId,next);setStatus(next);
        window.dispatchEvent(new CustomEvent("craftmine-creation-edit-status",{detail:next}));
        if(next.phase==="applied"){
          setUndo(next.receipt?.undoSupported?next.receipt.operationId:null);
          setOpen(false);void controller.refresh();return;
        }
        if(next.phase==="failed")return;
      }catch(failure){if(alive)setError(String(failure));}
      if(alive)timer=setTimeout(poll,500);
    };
    void poll();return()=>{alive=false;clearTimeout(timer);};
  },[busy,status?.operationId,sessionId]);
  const submit=async(action:"modify"|"delete"|"undo")=>{
    if(!bridge||!sessionId||!controller.capture?.captureId||busy)return;
    setError("");
    try{
      const next=await bridge.call("godot.creationEdit",{sessionId,captureId:controller.capture.captureId,operationId:crypto.randomUUID(),action,...(action==="modify"?{changes:{scale,color}}:{}),...(action==="undo"?{undoOperationId:undo}:{})}) as Status;
      statuses.set(sessionId,next);setStatus(next);window.dispatchEvent(new CustomEvent("craftmine-creation-edit-status",{detail:next}));
    }catch(failure){setError(failure instanceof Error?failure.message:String(failure));}
  };
  const problem=error||status?.error;
  return <div className="creation-object-editor">
    <div className="creation-target-row">
      <button type="button" disabled={!sessionId||!target?.entityId||busy} onClick={()=>setOpen(!open)}>{zh?"编辑对象":"Edit object"}</button>
      <button type="button" disabled={!sessionId||!undo||busy||!controller.capture?.captureId} onClick={()=>void submit("undo")}>{zh?"撤销上次操作":"Undo last edit"}</button>
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
    {status&&<span role="status">{zh?({preparing:"正在准备编辑…",editing:"正在修改…",checking:"正在检查…",applying:"正在应用…",applied:"编辑已应用",failed:"编辑未完成"} as Record<string,string>)[status.phase]:status.phase}</span>}
    {problem&&<span role="alert" className="creation-target-note">{zh?(failures[Object.keys(failures).find(code=>problem.includes(code))??""]??problem):problem}</span>}
  </div>;
}
