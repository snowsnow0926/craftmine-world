import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export type PlayerWorldKind='web'|'godot';
type Row={id:string;title?:string;runtimeKind?:string;baseId?:string;base?:{id?:string};state?:string;creation?:{progress?:number;error?:{message?:string}|null;actions?:string[]}|null};
type Link={operationId:string;worldId?:string;returnWorldId?:string|null};
type Index={format:'craftmine.player-worlds/1';slots:Partial<Record<PlayerWorldKind,Link>>};
type Slot={kind:PlayerWorldKind;worldId:string|null;title:string;state:'empty'|'ready'|'initializing'|'failed';error?:string;progress?:number};
type Dependencies={directory:string;list():Promise<{worlds:Row[];activeWorldId:string|null}>;
  inspect?(row:Row):Promise<Row>;
  navigate(request:Record<string,unknown>):Promise<unknown>;retry(worldId:string):Promise<unknown>;cancel(worldId:string):Promise<unknown>;changed():void};
const kinds:PlayerWorldKind[]=['godot','web'];
const title=(kind:PlayerWorldKind)=>kind==='godot'?'Godot 3D 世界':'Web 世界';
export function playerWorldKind(row:Row):PlayerWorldKind|null {
  if(row.runtimeKind==='legacy')return 'web';
  return row.runtimeKind==='godot'&&(row.baseId??row.base?.id)==='creation-sandbox'?'godot':null;
}
const validId=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9._-]{1,128}$/.test(value);

/** Two durable preferences over existing Core worlds, never a second world store. */
export function createPlayerWorlds(deps:Dependencies){
  const file=path.join(deps.directory,'player-worlds.json');
  let pending:{kind:PlayerWorldKind;action:'enter'|'cancel';work:Promise<Slot>}|null=null;
  function readIndex():Index {
    if(!fs.existsSync(file))return {format:'craftmine.player-worlds/1',slots:{}};
    if(fs.statSync(file).size>16384)throw Error('PLAYER_WORLD_INDEX_INVALID');
    const data=JSON.parse(fs.readFileSync(file,'utf8'));
    if(data?.format!=='craftmine.player-worlds/1'||!data.slots||typeof data.slots!=='object'||Array.isArray(data.slots)
      ||Object.keys(data.slots).some(key=>!kinds.includes(key as PlayerWorldKind)))throw Error('PLAYER_WORLD_INDEX_INVALID');
    for(const link of Object.values(data.slots) as any[])if(!link||!validId(link.operationId)
      ||link.worldId!==undefined&&!validId(link.worldId)
      ||link.returnWorldId!=null&&!validId(link.returnWorldId))throw Error('PLAYER_WORLD_INDEX_INVALID');
    return data;
  }
  function write(index:Index){
    fs.mkdirSync(deps.directory,{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';
    try{fs.writeFileSync(temp,JSON.stringify(index),{flag:'wx'});fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
    deps.changed();
  }
  function choose(kind:PlayerWorldKind,index:Index,list:{worlds:Row[];activeWorldId:string|null}):Row|undefined {
    const id=index.slots[kind]?.worldId;
    if(id)return list.worlds.find(row=>row.id===id&&playerWorldKind(row)===kind);
    const compatible=list.worlds.filter(row=>playerWorldKind(row)===kind);
    return compatible.find(row=>row.id===list.activeWorldId)??(compatible.length===1?compatible[0]:undefined);
  }
  function present(kind:PlayerWorldKind,row?:Row,missingId?:string):Slot {
    if(!row)return missingId?{kind,worldId:missingId,title:title(kind),state:'failed',error:'这个主世界暂时不可用，请在存档管理中恢复或选择已有世界。'}
      :{kind,worldId:null,title:title(kind),state:'empty'};
    const state=row.state==='initializing'?'initializing':row.state==='failed'?'failed':row.runtimeKind==='legacy'||row.state==='ready'?'ready':'failed';
    return {kind,worldId:row.id,title:row.title||title(kind),state,
      ...(row.creation?.error?.message?{error:row.creation.error.message}:{}),
      ...(typeof row.creation?.progress==='number'?{progress:row.creation.progress}:{})};
  }
  const inspect=async(row?:Row)=>row&&deps.inspect?deps.inspect(row):row;
  const api={
    async read(){
      const list=await deps.list(),index=readIndex();
      return {slots:await Promise.all(kinds.map(async kind=>{
        const row=choose(kind,index,list);
        try{return present(kind,await inspect(row),index.slots[kind]?.worldId);}
        catch{return {...present(kind,row,index.slots[kind]?.worldId),state:'failed' as const,error:'暂时无法读取这个世界的状态，请重试。'};}
      })),
        activeKind:playerWorldKind(list.worlds.find(row=>row.id===list.activeWorldId)??{id:''}),activeWorldId:list.activeWorldId};
    },
    /** Called only after successful explicit navigation; old bases remain untouched. */
    async remember(worldId:string){
      const list=await deps.list(),row=list.worlds.find(row=>row.id===worldId),kind=row&&playerWorldKind(row);
      if(!kind||list.activeWorldId!==worldId)return;
      const index=readIndex();if(index.slots[kind]?.worldId===worldId)return;
      index.slots[kind]={...index.slots[kind],operationId:index.slots[kind]?.operationId??randomUUID(),worldId};write(index);
    },
    cancel(input:unknown){
      if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).join(',')!=='kind'||!kinds.includes((input as any).kind))return Promise.reject(Error('PLAYER_WORLD_REQUEST_INVALID'));
      if(pending)return Promise.reject(Error('WORLD_BUSY'));
      const kind=(input as {kind:PlayerWorldKind}).kind;
      const work=(async()=>{
      const index=readIndex(),link=index.slots[kind];
      if(!link?.worldId)throw Error('PLAYER_WORLD_UNAVAILABLE');
      const list=await deps.list(),row=await inspect(list.worlds.find(value=>value.id===link.worldId));
      if(!row||list.activeWorldId!==link.worldId)throw Error('PLAYER_WORLD_CHANGED');
      if(kind==='godot'&&row.state==='initializing')await deps.cancel(link.worldId);
      // Other explicit navigation can occur outside this service. Do not
      // overwrite it after an asynchronous initializer cancellation.
      if((await deps.list()).activeWorldId!==link.worldId)throw Error('PLAYER_WORLD_CHANGED');
      if(link.returnWorldId&&link.returnWorldId!==link.worldId)await deps.navigate({operation:'switch',id:link.returnWorldId});
      const current=await deps.list();return {...present(kind,await inspect(current.worlds.find(value=>value.id===link.worldId)),link.worldId),activeWorldId:current.activeWorldId};
      })().finally(()=>{pending=null;});
      pending={kind,action:'cancel',work};return work;
    },
    enter(input:unknown):Promise<Slot>{
      if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).join(',')!=='kind'||!kinds.includes((input as any).kind))return Promise.reject(Error('PLAYER_WORLD_REQUEST_INVALID'));
      const kind=(input as {kind:PlayerWorldKind}).kind;
      if(pending)return pending.action==='enter'&&pending.kind===kind?pending.work:Promise.reject(Error('WORLD_BUSY'));
      const work=(async()=>{
        let index=readIndex(),list=await deps.list(),row=choose(kind,index,list);
        if(index.slots[kind]?.worldId&&!row)throw Error('PLAYER_WORLD_UNAVAILABLE');
        if(!row){
          const link=index.slots[kind]??{operationId:randomUUID(),returnWorldId:list.activeWorldId};index.slots[kind]=link;write(index);
          // Persist the operation before dispatch. Both adapters must recover a
          // lost acknowledgement through exactly this operation identity.
          const created=await deps.navigate({operation:'create',title:title(kind),baseId:kind==='godot'?'creation-sandbox':'craftmine-web/5',starterId:'blank',operationId:link.operationId}) as any;
          const worldId=created?.id??created?.worldId??created?.record?.id;
          if(!validId(worldId))throw Error('PLAYER_WORLD_CREATE_UNCONFIRMED');
          index=readIndex();index.slots[kind]={...link,worldId};write(index);
          list=await deps.list();row=choose(kind,index,list);
          if(!row)throw Error('PLAYER_WORLD_CREATE_UNCONFIRMED');
        }else if(index.slots[kind]?.worldId!==row.id){index.slots[kind]={operationId:index.slots[kind]?.operationId??randomUUID(),worldId:row.id};write(index);}
        row=(await inspect(row))!;
        const slot=present(kind,row);
        if((slot.state==='initializing'||slot.state==='failed')&&list.activeWorldId!==row.id){
          index=readIndex();index.slots[kind]={...index.slots[kind]!,returnWorldId:list.activeWorldId};write(index);
        }
        if(slot.state==='failed'){
          if(!row.creation?.actions?.includes('retry'))throw Error('PLAYER_WORLD_RECOVERY_REQUIRED');
          if(list.activeWorldId!==row.id)await deps.navigate({operation:'switch',id:row.id});
          await deps.retry(row.id);
          const current=await deps.list();
          if(current.activeWorldId!==row.id)throw Error('PLAYER_WORLD_ENTRY_UNCONFIRMED');
          return present(kind,await inspect(current.worlds.find(value=>value.id===row!.id)),row.id);
        }
        // Even an already-selected placeholder must cross the explicit open
        // lifecycle: passive status reads cannot restart a stopped initializer.
        await deps.navigate({operation:'switch',id:row.id});
        const confirmed=await deps.list();
        if(confirmed.activeWorldId!==row.id)throw Error('PLAYER_WORLD_ENTRY_UNCONFIRMED');
        return present(kind,await inspect(confirmed.worlds.find(value=>value.id===row!.id)),row.id);
      })().finally(()=>{pending=null;});
      pending={kind,action:'enter',work};return work;
    },
  };return api;
}
