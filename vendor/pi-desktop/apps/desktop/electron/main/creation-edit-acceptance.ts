import type {BrowserWindow} from 'electron';
type Access={enabled:boolean;window:()=>BrowserWindow|null;call:(method:string,args:Record<string,unknown>)=>Promise<any>;observe:()=>Promise<any>;action:(op:string,args:Record<string,unknown>)=>Promise<any>;seed:(owner:number,sessionId:string,captureId:string)=>Promise<any>;active:(sessionId:string)=>boolean};
/** Finite product-edit scenarios, only in a validated private headless profile. */
export function installCreationEditAcceptance(access:Access){
  if(!access.enabled||process.env.CRAFTMINE_EDIT_ACCEPTANCE!=='1'||!process.send)return;
  let sessionId='';
  const desktop=(script:string)=>{const window=access.window();if(!window||window.isDestroyed())throw Error('EDIT_ACCEPTANCE_WINDOW_REQUIRED');return window.webContents.executeJavaScript(script,false);};
  const panel=(channel:string,payload:Record<string,unknown>)=>desktop(`piDesktop.pluginPanelInvoke("craftmine.world",${JSON.stringify(channel)},${JSON.stringify(payload)})`);
  async function run(method:string,payload:Record<string,unknown>={}){
    if(method==='initialize'){
      if(sessionId)throw Error('EDIT_ACCEPTANCE_ALREADY_INITIALIZED');
      const previous=process.env.CRAFTMINE_EDIT_SESSION;
      if(previous){const detail=await access.call('session.get',{id:previous});if(detail.session?.title!=='直接编辑无模型验收')throw Error('EDIT_ACCEPTANCE_SESSION_INVALID');sessionId=previous;}
      else sessionId=(await access.call('session.create',{title:'直接编辑无模型验收'})).session.id;
      await desktop(`piDesktop.invoke(piDesktop.channels.invoke.notificationSetViewingSession,{sessionId:${JSON.stringify(sessionId)}})`);return {sessionId,reopened:!!previous};
    }
    if(!sessionId)throw Error('EDIT_ACCEPTANCE_SESSION_REQUIRED');
    if(method==='aim-ground'||method==='aim-tree'){
      const sample=await access.observe();if(sample.baseId!=='creation-sandbox')throw Error('EDIT_ACCEPTANCE_CREATION_REQUIRED');
      if(method==='aim-ground')for(const yaw of [.55,-.55,1.1,-1.1,0,2,-2,3]){await access.action('look',{yaw,pitch:-.4});const observed=await access.observe();if(observed.payload.creation.target.surface==='ground')return observed;}
      else {
        const tree=sample.payload.creation.entities.find((item:any)=>item.kind==='tree'),box=sample.payload.creation.obstacles.find((item:any)=>item.entityId===tree?.id),player=sample.payload.player.position;
        if(!box)throw Error('EDIT_ACCEPTANCE_TREE_ABSENT');const center=box.min.map((n:number,i:number)=>(n+box.max[i])/2),dx=center[0]-player[0],dy=center[1]-(player[1]+.6),dz=center[2]-player[2];
        await access.action('look',{yaw:Math.atan2(-dx,-dz),pitch:Math.atan2(dy,Math.hypot(dx,dz))});return access.observe();
      }
      throw Error('EDIT_ACCEPTANCE_GROUND_ABSENT');
    }
    if(method==='capture')return panel('godot.creationTarget',{sessionId});
    if(method==='seed'){
      const target=await panel('godot.creationTarget',{sessionId});if(!target.captureId||target.target?.surface!=='ground')throw Error('EDIT_ACCEPTANCE_GROUND_REQUIRED');
      return access.seed(access.window()!.webContents.id,sessionId,target.captureId);
    }
    if(method==='snapshot')return {sessionId,active:access.active(sessionId),record:await access.call('session.get',{id:sessionId}),metrics:await access.call('session.turnMetrics',{sessionId}).catch(()=>null),observation:await access.observe()};
    if(['godot.creationTarget','godot.creationEdit','godot.creationEditStatus','godot.creationEditHistory','godot.creationTaskStatus','godot.creationPolicy'].includes(method)){
      if(method==='godot.creationPolicy'&&Object.keys(payload).length)throw Error('EDIT_ACCEPTANCE_READ_ONLY_POLICY');
      if(!['godot.creationEditStatus','godot.creationPolicy'].includes(method)&&payload.sessionId!==sessionId)throw Error('EDIT_ACCEPTANCE_SESSION_INVALID');return panel(method,payload);
    }
    throw Error('EDIT_ACCEPTANCE_METHOD_DENIED');
  }
  process.on('message',(message:any)=>{
    if(message?.type!=='craftmine-edit-acceptance'||typeof message.id!=='string'||Object.keys(message).some(key=>!['type','id','method','payload'].includes(key)))return;
    void run(message.method,message.payload).then(result=>process.send?.({type:message.type,id:message.id,result}),error=>process.send?.({type:message.type,id:message.id,error:String(error?.message??error)}));
  });
}
