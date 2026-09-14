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

Object.assign(failures,{CREATION_MIGRATION_NEEDED:"旧版底座含有自定义改动，需要手动适配；源码和存档已保留。",CREATION_MIGRATION_DRAFT_CONFLICT:"当前还有未采用的源码修改，请先处理草稿。正式世界保持原样。"});
Object.assign(failures,{CREATION_PLACEMENT_GROUND_REQUIRED:"请切回当前指向并对准空地，再放置物体。",CREATION_OUT_OF_BOUNDS:"物体超出世界边界，请缩小偏移或减少数量。",CREATION_ENTITY_LIMIT:"世界物体数量已达上限，请先整理物体。",CREATION_DUPLICATE_LIMIT:"复制数量应为 1–8 个，偏移距离至少为 0.5。"});

export function CreationObjectEditor({controller}:{controller:ReturnType<typeof useCreationTarget>}){
  const zh=useTranslation().i18n.language.startsWith("zh");
  const sessionId=controller.sessionId,target=controller.capture?.target,worldId=controller.capture?.worldId??null;
  const scope=sessionId&&worldId?cacheKey(sessionId,worldId):"";
  const scopeRef=useRef(scope);scopeRef.current=scope;
  const submitted=useRef(false);
  const [open,setOpen]=useState(false),[scale,setScale]=useState([1,1,1]),[color,setColor]=useState("#84a866");
  const [position,setPosition]=useState([0,0,0]),[rotationY,setRotationY]=useState(0);
  const [preview,setPreview]=useState<{status:string;valid?:boolean;reason?:string}|null>(null);
  const previewHandle=useRef<{id:string;sequence:number;sessionId:string;captureId:string}|null>(null);
  const [placing,setPlacing]=useState(false),[kind,setKind]=useState("tree"),[count,setCount]=useState(1),[offset,setOffset]=useState([2,0,0]);
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
  useEffect(()=>{setOpen(false);setPlacing(false);setScale(target?.scale??[1,1,1]);setColor(target?.color??"#84a866");setPosition(target?.entityPosition??target?.position??[0,0,0]);setRotationY(target?.rotationY??0);setPreview(null);setError("");},[controller.capture?.captureId]);
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
          setOpen(false);setPlacing(false);void controller.refresh();return;
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
  const cancelPreview=async()=>{
    const previous=previewHandle.current;previewHandle.current=null;setPreview(null);
    if(previous&&bridge)await bridge.call('godot.creationPreview',{sessionId:previous.sessionId,captureId:previous.captureId,previewId:previous.id,sequence:previous.sequence+1,action:'cancel'}).catch(()=>{});
  };
  useEffect(()=>()=>{void cancelPreview();},[scope,controller.capture?.captureId]);
  useEffect(()=>{if(!open&&!placing)void cancelPreview();},[open,placing]);
  useEffect(()=>{if(preview?.status!=='visible')return;const timer=setTimeout(()=>void cancelPreview(),60000);return()=>clearTimeout(timer);},[preview]);
  const resetTransform=()=>{setPosition(target?.entityPosition??target?.position??[0,0,0]);setRotationY(target?.rotationY??0);setScale(target?.scale??[1,1,1]);setColor(target?.color??"#84a866");};
  const transformValid=position.length===3&&position.every((n,i)=>Number.isFinite(n)&&n>=(i===1?0:-28)&&n<=(i===1?16:28))&&Number.isFinite(rotationY)&&Math.abs(rotationY)<=180&&scale.every(n=>Number.isFinite(n)&&n>=.25&&n<=4);
  const showPreview=async()=>{
    if(!bridge||!sessionId||!controller.capture?.captureId||!transformValid||busy)return;
    const handle=previewHandle.current??{id:crypto.randomUUID(),sequence:0,sessionId,captureId:controller.capture.captureId};previewHandle.current=handle;
    const sequence=++handle.sequence;setPreview({status:'preparing'});
    try{const result=await bridge.call('godot.creationPreview',{sessionId,captureId:handle.captureId,previewId:handle.id,sequence,action:placing?'place':'modify',...(placing?{kind}:{}),position,rotationY,scale,color}) as any;
      if(previewHandle.current===handle&&handle.sequence===sequence)setPreview(result);
    }catch(failure){if(previewHandle.current===handle&&handle.sequence===sequence)setPreview({status:'failed',reason:String(failure)});}
  };
  // Debounce only an explicitly opened preview; fields alone start no runtime action.
  useEffect(()=>{if(!previewHandle.current)return;const timer=setTimeout(()=>void showPreview(),180);return()=>clearTimeout(timer);},[position,rotationY,scale,color,kind]);
  const transformControls=<>
    <div className="creation-target-row">{['X','Y','Z'].map((axis,index)=><label key={axis}>{zh?'位置':'Position'} {axis}<input aria-label={(zh?'位置':'Position')+' '+axis} type="number" min={index===1?0:-28} max={index===1?16:28} step="0.5" value={position[index]} onChange={event=>setPosition(values=>values.map((value,i)=>i===index?Number(event.target.value):value))} style={{width:65}}/></label>)}
    <label>{zh?'朝向':'Yaw'}<input aria-label={zh?'朝向角度':'Yaw degrees'} type="number" min="-180" max="180" step="15" value={rotationY} onChange={event=>setRotationY(Number(event.target.value))} style={{width:70}}/>°</label></div>
    <div className="creation-target-row">{["X","Y","Z"].map((axis,index)=><span key={axis}><button type="button" aria-label={(zh?"移动":"Move")+" "+axis+" -0.5"} onClick={()=>setPosition(values=>values.map((n,i)=>i===index?Math.max(i===1?0:-28,n-.5):n))}>{axis} −</button><button type="button" aria-label={(zh?"移动":"Move")+" "+axis+" +0.5"} onClick={()=>setPosition(values=>values.map((n,i)=>i===index?Math.min(i===1?16:28,n+.5):n))}>{axis} +</button></span>)}<button type="button" onClick={()=>setRotationY(value=>(value+195)%360-180)}>{zh?"旋转 15°":"Rotate 15°"}</button></div>
    <div className="creation-target-row"><button type="button" disabled={!transformValid||busy||open&&(!target?.entityPosition||target.rotationY===undefined)} onClick={()=>void showPreview()}>{zh?'预览摆放':'Preview placement'}</button>{preview&&<><button type="button" onClick={()=>void cancelPreview()}>{zh?'关闭预览':'Close preview'}</button><span role="status">{preview.status==='visible'?(preview.valid?(zh?'预览位置可用':'Preview position available'):(zh?'预览位置存在碰撞或越界':'Preview position blocked')):preview.status==='preparing'?(zh?'正在预览…':'Preparing preview…'):(zh?'当前世界暂不支持预览':'Preview unavailable for this world')}</span></>}</div>
    {preview?.reason&&<span className="creation-target-note">{failures[Object.keys(failures).find(code=>preview.reason!.includes(code))??'']??preview.reason}</span>}
  </>;
  const submit=async(action:"modify"|"delete"|"undo"|"place"|"duplicate"|"upgrade-observer")=>{
    const captureId=action==='upgrade-observer'?controller.capture?.upgradeId:controller.capture?.captureId;
    if(!bridge||!sessionId||!worldId||!captureId||busy||visibleStatus?.phase==="interrupted"||submitted.current)return;
    submitted.current=true;setError("");
    await cancelPreview();
    const operationId=crypto.randomUUID(),requestScope=scope;
    const pending:Status={sessionId,worldId,operationId,phase:"preparing"};publish(pending);
    try{
      const next=await bridge.call("godot.creationEdit",{sessionId,captureId,operationId,action,...(action==="modify"?{changes:{scale,color,...(target?.entityPosition&&target.rotationY!==undefined?{position,rotationY}:{})}}:{}),...(action==="undo"?{undoOperationId:undo}:{}),...(action==="place"?{kind,placement:{position,rotationY,scale,color}}:{}),...(action==="duplicate"?{count,offset}:{})}) as Status;
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
    {controller.capture?.upgradeId&&<button type="button" disabled={!sessionId||busy||controller.loading||visibleStatus?.phase==='interrupted'} onClick={()=>void submit('upgrade-observer')}>{zh?'更新世界观察组件并检查':'Update world observer and check'}</button>}
    <div className="creation-target-row">
      <button type="button" disabled={!sessionId||!controller.capture?.captureId||target?.surface!=="ground"||(controller.capture as {source?:string}|null)?.source==="recent"||busy||visibleStatus?.phase==="interrupted"} onClick={()=>{resetTransform();setPlacing(!placing);setOpen(false);}}>{zh?"在此放置":"Place here"}</button>
      <button type="button" disabled={!sessionId||!target?.entityId||!target.scale||!target.color||busy||visibleStatus?.phase==="interrupted"} onClick={()=>{resetTransform();setOpen(!open);setPlacing(false);}}>{zh?"编辑对象":"Edit object"}</button>
      <button type="button" title={zh?"支持本版记录的放置、参数修改、复制和删除；旧记录与规则修改暂不可撤销。":"Supports recorded placement, property edits, duplication and deletion; older records and rule edits cannot be undone."} disabled={!sessionId||!undo||busy||visibleStatus?.phase==="interrupted"||!controller.capture?.captureId} onClick={()=>void submit("undo")}>{zh?"撤销上次操作":"Undo last edit"}</button>
    </div>
    {placing&&<fieldset disabled={busy}>
      <legend>{zh?"在当前空地放置物体，无需模型":"Place an object on the selected ground without a model"}</legend>
      <label>{zh?"物体类型":"Object type"}<select aria-label={zh?"放置类型":"Placement kind"} value={kind} onChange={event=>setKind(event.target.value)}>{[["tree","树","Tree"],["rock","石头","Rock"],["chest","宝箱","Chest"],["door","门","Door"],["marker","标记","Marker"]].map(([value,cn,en])=><option key={value} value={value}>{zh?cn:en}</option>)}</select></label>
      <span className="creation-target-note">{zh?"默认尺寸与绿色外观；宝箱奖励一个造物代币，门初始关闭。采用后可编辑或撤销。":"Default size and green appearance; chests reward one creation token and doors start closed. Edit or undo after adoption."}</span>
      {transformControls}
      <button type="button" disabled={!transformValid} onClick={()=>void submit("place")}>{zh?"放置并检查":"Place and check"}</button>
      <button type="button" onClick={()=>setPlacing(false)}>{zh?"取消":"Cancel"}</button>
    </fieldset>}
    {open&&<fieldset disabled={busy}>
      <legend>{target?.entityName??target?.entityId}</legend>
      {target?.entityPosition&&target.rotationY!==undefined&&transformControls}
      <div className="creation-target-row">{["X","Y","Z"].map((axis,index)=><label key={axis}>{axis}<input aria-label={`${zh?"尺寸":"Scale"} ${axis}`} type="number" min="0.25" max="4" step="0.25" value={scale[index]} onChange={event=>setScale(values=>values.map((value,i)=>i===index?Number(event.target.value):value))} style={{width:65}}/></label>)}
        <label>{zh?"颜色":"Color"}<input aria-label={zh?"对象颜色":"Object color"} type="color" value={color} onChange={event=>setColor(event.target.value)}/></label>
      </div>
      <div className="creation-target-row">
        <label>{zh?"复制数量":"Copies"}<input aria-label={zh?"复制数量":"Copy count"} type="number" min="1" max="8" step="1" value={count} onChange={event=>setCount(Number(event.target.value))}/></label>
        {["X","Y","Z"].map((axis,index)=><label key={axis}>{zh?"偏移":"Offset"} {axis}<input aria-label={`${zh?"复制偏移":"Copy offset"} ${axis}`} type="number" min="-8" max="8" step="0.5" value={offset[index]} onChange={event=>setOffset(values=>values.map((value,i)=>i===index?Number(event.target.value):value))} style={{width:65}}/></label>)}
        <button type="button" disabled={!Number.isInteger(count)||count<1||count>8||offset.some(n=>!Number.isFinite(n)||Math.abs(n)>8)||Math.hypot(...offset)<.5} onClick={()=>void submit("duplicate")}>{zh?"复制并检查":"Duplicate and check"}</button>
      </div>
      <span className="creation-target-note">{zh?"每个副本相对上一个偏移，使用当前已采用的属性；未提交的尺寸和颜色不随复制生效。占用或越界时整次操作不生效。":"Copies use adopted properties and successive offsets. Unsubmitted size or color edits are not copied. Occupied or out-of-bounds placement rejects the whole operation."}</span>
      <div className="creation-target-row">
        <button type="button" disabled={!transformValid} onClick={()=>void submit("modify")}>{zh?"检查并应用":"Check and apply"}</button>
        <button type="button" onClick={()=>void submit("delete")}>{zh?"删除对象":"Delete object"}</button>
        <button type="button" onClick={()=>setOpen(false)}>{zh?"取消":"Cancel"}</button>
      </div>
    </fieldset>}
    {visibleStatus&&<span role="status">{zh?({preparing:"正在准备编辑…",editing:"正在修改…",checking:"正在检查…",applying:"正在应用…",applied:"编辑已应用",failed:"编辑未完成",interrupted:"编辑结果待核对"} as Record<string,string>)[visibleStatus.phase]:visibleStatus.phase}</span>}
    {visibleStatus?.phase==="interrupted"&&<button type="button" onClick={()=>{setError("");publish({...visibleStatus,phase:"preparing"});}}>{zh?"重新读取原操作状态":"Recheck original operation"}</button>}
    {problem&&<span role="alert" className="creation-target-note">{zh?(failures[Object.keys(failures).find(code=>problem.includes(code))??""]??problem):problem}</span>}
  </div>;
}
