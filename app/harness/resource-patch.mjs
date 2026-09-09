import {upgradeScene,compileScene,validateObjectScope} from '../scene.mjs';
import {contentHash,fields,integer,requireValue,HARNESS_LIMITS} from './contracts.mjs';
const groups={object:'objects',behavior:'behaviors',system:'systems'};
const resourceKey=(kind,id)=>kind+':'+id;

export function workspaceResource(scene,kind,id){
    requireValue(Object.hasOwn(groups,kind),'INVALID_RESOURCE','只支持对象、行为和系统资源');
    requireValue(typeof id==='string'&&/^[a-z][a-z0-9-]{0,47}$/.test(id),'INVALID_RESOURCE','资源 ID 无效');
    const found=(upgradeScene(scene)[groups[kind]]||[]).find(o=>o.id===id);
    requireValue(found,'NOT_FOUND','资源不存在：'+kind+':'+id);return found;
}

// Pure checked transformation shared by the web workspace and Rust broker.
export function patchWorkspaceScene(original,input,{reads={},extensions=new Set(),baseScene=original,selected=null}={}){
    fields(input,['workspaceRevision','operations']);
    integer(input.workspaceRevision,0,HARNESS_LIMITS.calls,'草稿版本');
    requireValue(Array.isArray(input.operations)&&input.operations.length>0&&input.operations.length<=HARNESS_LIMITS.patchOperations,
      'INVALID_ARGUMENTS','每次需要 1–8 项修改');
    const next=upgradeScene(original),touched=new Set();
    for(const op of input.operations){
      fields(op,['kind','id','expectedHash','value'],['op']);
      const operation=op.op??'replace';
      requireValue(['add','replace'].includes(operation),'INVALID_ARGUMENTS','补丁 op 只支持 add 或 replace');
      requireValue(Object.hasOwn(groups,op.kind),'INVALID_RESOURCE','只支持对象、行为或系统资源');
      requireValue(typeof op.id==='string'&&/^[a-z][a-z0-9-]{0,47}$/.test(op.id),'INVALID_RESOURCE','资源 ID 无效');
      const key=resourceKey(op.kind,op.id);
      requireValue(!touched.has(key),'INVALID_ARGUMENTS','同一补丁不能重复修改资源');touched.add(key);
      requireValue(op.value&&op.value.id===op.id,'IDENTITY_CHANGED','局部替换必须保留资源身份');
      if(operation==='add'){
        requireValue(op.expectedHash===null,'READ_CONFLICT','新增资源的 expectedHash 必须为 null');
        if(op.kind==='behavior'&&next.format==='craftmine.scene/2'){next.format='craftmine.scene/3';next.behaviors=[];}
        requireValue(!next[groups[op.kind]].some(o=>o.id===op.id),'RESOURCE_EXISTS','资源已经存在，不能重复新增：'+key);
        next[groups[op.kind]].push(structuredClone(op.value));
      }else{
        const old=workspaceResource(next,op.kind,op.id),hash=contentHash(old);
        requireValue(op.expectedHash===hash&&reads[key]===hash,'READ_CONFLICT','请先读取要修改的当前资源及哈希');
        next[groups[op.kind]]=next[groups[op.kind]].map(o=>o.id===op.id?structuredClone(op.value):o);
      }
    }
    // Compile against the actual loaded extension catalogue.
    const compiled=compileScene(next,{extensions:extensions});
    validateObjectScope(baseScene,compiled.scene,selected);
    requireValue(contentHash(original)!==contentHash(compiled.scene),'NO_CHANGE','补丁没有修改草稿');
    return {scene:compiled.scene,changed:[...touched]};
}
