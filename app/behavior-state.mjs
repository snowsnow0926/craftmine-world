import { exactKeys,identifier,bounded } from './gameplay.mjs';
import { jsonRecord,validateBehaviorResult,validateInventory,validateItem,validatePanel } from './behavior-contracts.mjs';
import { checkAppearanceBounds } from './asset-binding.mjs';
import { intersects } from './geometry.mjs';

const vector=v=>{exactKeys(v,['x','y','z']);for(const n of Object.values(v))bounded(n,-80,80);};
const table=(v,limit)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length>limit||Object.keys(v).some(k=>!identifier(k)||['constructor','prototype'].includes(k)))throw Error('代码玩法存档索引无效');};
export function validateBehaviorState(value){
  const capable=value?.format==='craftmine.behavior-state/3',archived=capable||value?.format==='craftmine.behavior-state/2';
  exactKeys(value,['format','time','modules','inventory',...(archived?['archive']:[]),...(capable?['items']:[])]);if(!archived&&value.format!=='craftmine.behavior-state/1')throw Error('代码玩法存档格式不兼容');bounded(value.time,0,1e12);
  table(value.modules,8);validateInventory(value.inventory);
  if(capable){table(value.items,128);for(const item of Object.values(value.items))validateItem(item);}
  let archivedModules=[];
  if(archived){
    if(!Array.isArray(value.archive)||value.archive.length>32)throw Error('历史玩法进度超过 32 份上限，请先导出整理');const seen=new Set();
    for(const entry of value.archive){exactKeys(entry,['id','record']);const key=entry.id+'@'+entry.record?.stateVersion;if(!identifier(entry.id)||seen.has(key))throw Error('历史玩法进度索引无效');seen.add(key);}
    archivedModules=value.archive.map(e=>e.record);
  }
  for(const module of [...Object.values(value.modules),...archivedModules]){
    exactKeys(module,['stateVersion','revision','state','overrides','error',...(capable?['panels']:[])]);
    if(!Number.isInteger(module.stateVersion)||module.stateVersion<1||module.stateVersion>10000||!/^code-[a-f0-9]{20}$/.test(module.revision)||typeof module.error!=='string'||module.error.length>600)throw Error('代码玩法状态版本无效');
    jsonRecord(module.state);table(module.overrides,16);
    if(capable){table(module.panels,3);for(const panel of Object.values(module.panels))validatePanel(panel);}
    for(const patch of Object.values(module.overrides)){
      exactKeys(patch,['offset','visible','solid','color']);vector(patch.offset);
      if(typeof patch.visible!=='boolean'||(patch.solid!==null&&typeof patch.solid!=='boolean')||(patch.color!==null&&!/^#[0-9a-fA-F]{6}$/.test(patch.color)))throw Error('代码玩法对象状态无效');
    }
  }
  return structuredClone(value);
}
export class BehaviorState {
  constructor(build,saved,gameplay){
    if(saved)validateBehaviorState(saved);
    this.build=build;this.definitions=build.behaviors||[];
    const capable=saved?.format==='craftmine.behavior-state/3'||this.definitions.some(b=>b.definition.format==='craftmine.behavior/3');
    const normalize=record=>({...structuredClone(record),...(capable?{panels:structuredClone(record.panels||{})}:{})});
    this.value={format:capable?'craftmine.behavior-state/3':'craftmine.behavior-state/2',time:saved?.time||0,modules:{},inventory:structuredClone(saved?.inventory||{}),archive:(saved?.archive||[]).map(e=>({id:e.id,record:normalize(e.record)})),...(capable?{items:structuredClone(saved?.items||{})}:{})};
    const remember=(id,record)=>{this.value.archive=this.value.archive.filter(e=>e.id!==id||e.record.stateVersion!==record.stateVersion);this.value.archive.push({id,record:normalize(record)});};
    for(const [id,record]of Object.entries(saved?.modules||{}))if(!this.definitions.some(b=>b.definition.id===id&&b.definition.stateVersion===record.stateVersion))remember(id,record);
    for(const artifact of this.definitions){
      const d=artifact.definition,current=saved?.modules[d.id],old=current?.stateVersion===d.stateVersion?current:this.value.archive.find(e=>e.id===d.id&&e.record.stateVersion===d.stateVersion)?.record;
      if(current&&!old)throw Error(`「${d.name}」需要迁移状态 v${current.stateVersion} → v${d.stateVersion}，原进度已保留`);
      this.value.archive=this.value.archive.filter(e=>e.id!==d.id||e.record.stateVersion!==d.stateVersion);
      const record=normalize(old||{stateVersion:d.stateVersion,revision:artifact.id,state:structuredClone(d.initialState),overrides:{},error:''});
      if(record.revision!==artifact.id)record.error='';record.revision=artifact.id;
      if(capable&&!d.capabilities?.includes('hud.panel@1'))record.panels={};
      for(const id of Object.keys(record.overrides))if(!d.targets.includes(id)||!d.permissions.includes('objects.write'))delete record.overrides[id];
      this.value.modules[d.id]=record;
    }
    validateBehaviorState(this.value);
    this.view=this.materialize(this.value);
    if(saved){
      const bins=new Map();
      for(const p of this.view.primitives)if(p.visible&&p.solid&&gameplay?.targets[p.id]?.health!==0){
        const seen=new Set();
        for(let x=Math.floor(p.min.x/4);x<=Math.floor(p.max.x/4);x++)for(let y=Math.floor(p.min.y/4);y<=Math.floor(p.max.y/4);y++)for(let z=Math.floor(p.min.z/4);z<=Math.floor(p.max.z/4);z++){
          const key=`${x},${y},${z}`,near=bins.get(key)||[];
          for(const other of near)if(!seen.has(other)){seen.add(other);if(p.id!==other.id&&intersects(p,other))throw Error('恢复的玩法状态与新场景实体重叠，原进度已保留');}
          near.push(p);bins.set(key,near);
        }
      }
    }
  }
  materialize(value){
    const overrides=Object.assign({},...Object.values(value.modules).map(m=>m.overrides));
    const objects=this.build.scene.objects.map(o=>{
      const p=overrides[o.id];return {...o,position:Object.fromEntries(['x','y','z'].map(k=>[k,o.position[k]+(p?.offset[k]||0)])),visible:p?.visible??true,...(o.appearance?{appearanceTint:p?.color||null}:{})};
    });
    for(const o of objects){for(const n of Object.values(o.position))bounded(n,-40,40);checkAppearanceBounds(o);}
    const primitives=(this.build.primitives||[]).map(p=>{
      const patch=overrides[p.id];if(!patch)return {...p,visible:true};
      return {...p,min:Object.fromEntries(['x','y','z'].map(k=>[k,p.min[k]+patch.offset[k]])),max:Object.fromEntries(['x','y','z'].map(k=>[k,p.max[k]+patch.offset[k]])),solid:patch.solid===null?p.solid:patch.solid&&p.shape==='box',color:patch.color||p.color,visible:patch.visible};
    });
    for(const p of primitives)if(p.min.x< -46||p.min.z< -46||p.min.y<5.99999||p.max.x>46||p.max.z>46||p.max.y>38)throw Error('玩法移动使物体超出世界边界');
    return {objects,primitives};
  }
  apply(artifact,result,frame){
    const definition=artifact.definition,checked=validateBehaviorResult(result,definition,frame);
    if(!checked.commands.length){this.value.modules[definition.id].state=checked.state;return {changed:[],effects:[]};}
    const next=structuredClone(this.value),record=next.modules[definition.id],changed=new Set(),effects=[];
    for(const c of checked.commands){
      if(c.type==='object.patch'){
        const base=this.build.scene.objects.find(o=>o.id===c.id),old=record.overrides[c.id]||{offset:{x:0,y:0,z:0},visible:true,solid:null,color:null};
        const patch={offset:c.position?Object.fromEntries(['x','y','z'].map(k=>[k,c.position[k]-base.position[k]])):old.offset,visible:c.visible??old.visible,solid:c.solid??old.solid,color:c.color??old.color};
        if(JSON.stringify(old)!==JSON.stringify(patch)){record.overrides[c.id]=patch;changed.add(c.id);}
      }else if(c.type==='inventory.add'){
        const count=(next.inventory[c.item]||0)+c.count;if(count<0||count>9999)throw Error('库存不足或超过容量，整步操作未应用');
        if(count)next.inventory[c.item]=count;else delete next.inventory[c.item];
      }else if(c.type==='inventory.define'){
        next.items[c.item]??={name:c.name,description:c.description};
      }else if(c.type==='hud.panel'){
        if(c.panel===null)delete record.panels[c.key];else record.panels[c.key]=c.panel;
      }else effects.push(c);
    }
    record.state=checked.state;
    validateBehaviorState(next);const view=changed.size?this.materialize(next):this.view;
    const dead=new Set(this.build.scene.objects.filter(o=>o.components.health>0&&frame.objects.find(p=>p.id===o.id)?.health===0).map(o=>o.id));
    const solids=view.primitives.filter(p=>p.solid&&p.visible&&!dead.has(p.id));
    const body={min:{x:frame.player.position.x-.29,y:frame.player.position.y+.002,z:frame.player.position.z-.29},max:{x:frame.player.position.x+.29,y:frame.player.position.y+1.718,z:frame.player.position.z+.29}};
    for(const p of solids)if(changed.has(p.id)){
      if(intersects(body,p))throw Error('玩法移动会把玩家困在物体中，整步操作未应用');
      if(solids.some(other=>other.id!==p.id&&intersects(p,other)))throw Error('玩法移动造成实心物体重叠，整步操作未应用');
    }
    this.value=next;this.view=view;return {changed:[...changed],effects};
  }
  snapshot(){return structuredClone(this.value);}
}
