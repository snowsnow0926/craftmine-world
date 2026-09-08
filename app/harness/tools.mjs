import { upgradeScene } from '../scene.mjs';
import { BEHAVIOR_API_GUIDE,BEHAVIOR_LIMITS } from '../behavior-contracts.mjs';
import { capabilitiesCatalog } from './capabilities.mjs';
import { contentHash,fields,integer,requireValue,TOOL_NAMES } from './contracts.mjs';
import { MemoryStore } from './memory-store.mjs';
import { TaskStore } from './task-store.mjs';

export const TOOL_GUIDE=[
  'project.inspect {}：读取草稿版本和资源目录，不含完整源码。',
  'world.query {kind:"object"|"behavior"|"system",ids?:[ID],offset?:0,limit?:16}：查目录和依赖。',
  'resource.read {kind,id,start?:0,limit?:16000}：读取草稿资源 JSON 文本及哈希，next 非空时继续分段。',
  'module.read {id,version,start?:0,limit?:16000}：按固定库版本读取，不能使用本机文件路径。',
  'capabilities.read {}：读实际行为事件、权限、限制和接口说明。',
  'memory.search {text,kind?,projectId?,limit?:5}：检索项目约定、已验证经验和历史，返回来源与命中原因。',
  'memory.remember {record:{id,kind,scope,claim,status,sourceRefs,appliesTo?,tags?}}：提议一条记忆；没有来源、或含凭据会被拒绝；同 ID 改写必须声明 supersedes。',
  'task.plan {steps:[文字或{text,status}]}：登记本次任务的步骤和完成条件，最多 12 步。',
  'task.step {id,status:"doing"|"done"|"dropped",note?}：更新某一步的状态；结束任务前每一步都必须 done 或 dropped。',
  'evidence.read {ref,start?:0,limit?:4000}：读取某条证据原件，next 非空时继续分段。',
  'verify.run {requirement?}：运行宿主登记的玩法验收；未配置时明确返回不可用，不会假装跑过。',
  'workspace.patch {workspaceRevision,operations:[{kind,id,expectedHash,value}]}：原子替换已读取的既有资源。value 为完整资源 JSON 对象。仅允许修改当前任务范围，保留 ID、绑定与兼容状态版本。一次最多 8 项。',
  'candidate.build {}：对当前草稿构建并检查；源码检查不是完整玩法验收。结果自动记为该任务的证据。',
  'task.finish {summary,candidateRef?|noChangeReason?,evidenceRefs:[ref]}：提交完成回执；宿主检查计划是否全部结束、证据是否存在，模型无权自己宣布完成。',
].join('\n');
const group={object:'objects',behavior:'behaviors',system:'systems'};
export class DomainTools{
  constructor(workspace,{build,verify,extensions=null}={}){this.workspace=workspace;this.build=build;this.verify=verify;this.extensions=Array.isArray(extensions)?extensions:[];this.memory=new MemoryStore(workspace.store);this.tasks=new TaskStore(workspace.store,{id:workspace.id});}
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
      fields(args,[]);return {...capabilitiesCatalog({extensions:this.extensions}),limits:BEHAVIOR_LIMITS,guide:BEHAVIOR_API_GUIDE};
    }
    if(name==='workspace.patch')return w.patch(args,callId);
    if(name==='candidate.build'){
      fields(args,[]);requireValue(typeof this.build==='function','TOOL_UNAVAILABLE','当前没有配置候选验证器');
      const report=await this.build();
      const evidence=this.tasks.recordEvidence('candidate-build',{build:report?.id??null,hash:report?.hash??null,passed:report?.passed!==false,at:Date.now()});
      return {...report,evidenceRef:evidence.ref};
    }
    if(name==='verify.run'){
      fields(args,[],['requirement']);
      requireValue(typeof this.verify==='function','TOOL_UNAVAILABLE','当前没有配置玩法验收执行器，不能假装跑过');
      const report=await this.verify(args);
      const evidence=this.tasks.recordEvidence('verify-run',{requirement:args.requirement??null,passed:report?.passed===true,summary:report?.summary??null,at:Date.now()});
      return {...report,evidenceRef:evidence.ref};
    }
    if(name==='evidence.read'){
      fields(args,['ref'],['start','limit']);
      return this.tasks.readEvidence(args.ref,{...(args.start!==undefined?{start:args.start}:{}),...(args.limit!==undefined?{limit:args.limit}:{})});
    }
    if(name==='memory.search'){
      fields(args,[],['text','kind','projectId','limit']);
      const query={...(args.text!==undefined?{text:args.text}:{}),...(args.kind!==undefined?{kind:args.kind}:{}),...(args.projectId!==undefined?{projectId:args.projectId}:{}),...(args.limit!==undefined?{limit:args.limit}:{})};
      const found=this.memory.search(query);
      return {records:found.map(record=>({id:record.id,kind:record.kind,claim:record.claim,status:record.status,sourceRefs:record.sourceRefs,score:record.score,reasons:record.reasons})),total:found.length};
    }
    if(name==='memory.remember'){
      fields(args,['record']);
      requireValue(args.record&&typeof args.record==='object'&&!Array.isArray(args.record),'INVALID_ARGUMENTS','记忆记录必须是对象');
      return this.memory.remember(args.record);
    }
    if(name==='task.plan'){
      fields(args,['steps']);return this.tasks.plan(args.steps);
    }
    if(name==='task.step'){
      fields(args,['id','status'],['note']);
      requireValue(typeof args.id==='string'&&typeof args.status==='string','INVALID_ARGUMENTS','步骤 ID 和状态必须是字符串');
      return this.tasks.updateStep(args.id,args.status,{note:args.note??''});
    }
    if(name==='task.finish'){
      fields(args,['summary'],['candidateRef','noChangeReason','evidenceRefs']);
      requireValue(Array.isArray(args.evidenceRefs)&&args.evidenceRefs.every(ref=>typeof ref==='string'),'INVALID_ARGUMENTS','证据引用必须是字符串数组');
      return this.tasks.finish({summary:args.summary,candidateRef:args.candidateRef??null,noChangeReason:args.noChangeReason??null,evidenceRefs:args.evidenceRefs});
    }
  }
}
function describe(kind,value){
  return {kind,id:value.id,name:value.name,hash:contentHash(value),
    ...(kind==='behavior'?{targets:value.targets,stateVersion:value.stateVersion,codeChars:value.code.length}:{}),
    ...(kind==='object'?{position:value.position}:{}),
    ...(kind==='system'?{type:value.type}:{})};
}
