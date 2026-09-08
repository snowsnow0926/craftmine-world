import { upgradeScene } from '../scene.mjs';
import { BEHAVIOR_API_GUIDE,BEHAVIOR_CAPABILITIES,BEHAVIOR_LIMITS,BEHAVIOR_PERMISSIONS,BEHAVIOR_REQUIREMENTS } from '../behavior-contracts.mjs';
import { contentHash,fields,integer,requireValue,TOOL_NAMES } from './contracts.mjs';

export const TOOL_GUIDE=[
  'project.inspect {}：读取草稿版本和资源目录，不含完整源码。',
  'world.query {kind:"object"|"behavior"|"system",ids?:[ID],offset?:0,limit?:16}：查目录和依赖。',
  'resource.read {kind,id,start?:0,limit?:16000}：读取草稿资源 JSON 文本及哈希，next 非空时继续分段。',
  'module.read {id,version,start?:0,limit?:16000}：按固定库版本读取，不能使用本机文件路径。',
  'capabilities.read {}：读实际行为事件、权限、限制和接口说明。',
  'workspace.patch {workspaceRevision,operations:[{kind,id,expectedHash,value}]}：原子替换已读取的既有资源。value 为完整资源 JSON 对象。仅允许修改当前任务范围，保留 ID、绑定与兼容状态版本。一次最多 8 项。',
  'candidate.build {}：对当前草稿构建并检查；源码检查不是完整玩法验收。',
].join('\n');
const group={object:'objects',behavior:'behaviors',system:'systems'};
export class DomainTools{
  constructor(workspace,{build}={}){this.workspace=workspace;this.build=build;}
  async execute(name,args,{callId}={}){
    requireValue(TOOL_NAMES.includes(name),'UNKNOWN_TOOL','未授权工具：'+name);
    const w=this.workspace;
    if(name==='project.inspect'){
      fields(args,[]);const m=w.readManifest(),scene=upgradeScene(w.scene(m));
      return {base:m.base,selected:m.selected,workspaceRevision:m.revision,title:scene.title,
        resources:Object.entries(group).flatMap(([kind,key])=>(scene[key]||[]).map(o=>describe(kind,o))),
        modules:w.store.data.library.slice(0,24).map(m=>({id:m.id,name:m.name,kind:m.kind,latest:m.latest})),
        moduleIndexTruncated:w.store.data.library.length>24};
    }
    if(name==='world.query'){
      fields(args,['kind'],['ids','offset','limit']);
      requireValue(Object.hasOwn(group,args.kind),'INVALID_RESOURCE','资源类型无效');
      const offset=args.offset??0,limit=args.limit??16;integer(offset,0,256,'目录起点');integer(limit,1,32,'目录数量');
      if(args.ids!==undefined)requireValue(Array.isArray(args.ids)&&args.ids.length<=32&&args.ids.every(x=>typeof x==='string'),'INVALID_ARGUMENTS','资源 ID 列表无效');
      const m=w.readManifest(),list=(upgradeScene(w.scene(m))[group[args.kind]]||[]).filter(o=>args.ids===undefined||args.ids.includes(o.id));
      return {workspaceRevision:m.revision,resources:list.slice(offset,offset+limit).map(o=>describe(args.kind,o)),next:offset+limit<list.length?offset+limit:null,total:list.length};
    }
    if(name==='resource.read'){fields(args,['kind','id'],['start','limit']);return w.readResource(args);}
    if(name==='module.read'){
      fields(args,['id','version'],['start','limit']);
      const start=args.start??0,limit=args.limit??16000;integer(start,0,2000000,'读取起点');integer(limit,1,16000,'读取长度');
      const module=w.store.modules.read(w.store.data,args.id,args.version),chars=Array.from(JSON.stringify(module,null,2)),end=Math.min(chars.length,start+limit);
      requireValue(start<=chars.length,'INVALID_ARGUMENTS','读取起点超过模块末尾');
      return {id:module.id,version:module.version,hash:module.hash,text:chars.slice(start,end).join(''),start,next:end<chars.length?end:null,totalChars:chars.length};
    }
    if(name==='capabilities.read'){
      fields(args,[]);return {runtime:'craftmine-web/5',capabilities:BEHAVIOR_CAPABILITIES,permissions:BEHAVIOR_PERMISSIONS,
        requires:BEHAVIOR_REQUIREMENTS,limits:BEHAVIOR_LIMITS,guide:BEHAVIOR_API_GUIDE};
    }
    if(name==='workspace.patch')return w.patch(args,callId);
    if(name==='candidate.build'){fields(args,[]);requireValue(typeof this.build==='function','TOOL_UNAVAILABLE','当前没有配置候选验证器');return this.build();}
  }
}
function describe(kind,value){
  return {kind,id:value.id,name:value.name,hash:contentHash(value),
    ...(kind==='behavior'?{targets:value.targets,stateVersion:value.stateVersion,codeChars:value.code.length}:{}),
    ...(kind==='object'?{position:value.position}:{}),
    ...(kind==='system'?{type:value.type}:{})};
}
