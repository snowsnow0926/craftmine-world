import fs from 'node:fs';
import path from 'node:path';
import { atomicJSON } from '../store.mjs';
import { upgradeScene } from '../scene.mjs';
import {patchWorkspaceScene,workspaceResource} from './resource-patch.mjs';
import { contentHash,fields,integer,requireValue,HARNESS_LIMITS } from './contracts.mjs';

const resourceKey=(kind,id)=>kind+':'+id;
const taskPattern=/^[a-f0-9-]{36}$/;
const callPattern=/^[a-zA-Z0-9-]{1,80}$/;

// The server owns a single-writer project lock. Mutations below are synchronous:
// reread -> compare -> publish has no async boundary within that owner process.
export class TaskWorkspace {
  constructor(store,{id,base,selected=null}){
    requireValue(taskPattern.test(id)&&store.data.tasks.some(t=>t.id===id&&t.base===base),'INVALID_TASK','开发任务不存在');
    this.store=store;this.id=id;this.base=base;this.selected=selected;
    this.root=fs.realpathSync(store.root);
    this.dir=this.safePath('tasks',id,'workspace');
    this.file=this.safePath('tasks',id,'workspace','manifest.json');
    this.events=this.safePath('tasks',id,'workspace','events.jsonl');
    if(!fs.existsSync(this.file)){
      requireValue(base===store.data.current,'STALE_BASE','世界代码基准已经改变');
      const scene=store.readBuild(base).scene;
      requireValue(selected===null||scene.objects.some(o=>o.id===selected),'INVALID_SCOPE','所选对象不存在');
      const revision=this.writeRevision(0,scene);
      atomicJSON(this.file,{format:'craftmine.workspace/1',taskId:id,base,selected,revision:0,head:revision,reads:{},receipts:[],validation:null});
    }
    this.readManifest();
  }
  safePath(...parts){
    let current=this.root;
    for(const part of parts){
      requireValue(typeof part==='string'&&part!=='.'&&part!=='..'&&!/[\\/:]/.test(part),'INVALID_PATH','资源路径无效');
      current=path.join(current,part);
      if(fs.existsSync(current))requireValue(!fs.lstatSync(current).isSymbolicLink(),'INVALID_PATH','开发资源不能经过符号链接或目录联接');
    }
    return current;
  }
  readManifest(){
    this.safePath('tasks',this.id,'workspace','manifest.json');
    const m=JSON.parse(fs.readFileSync(this.file,'utf8'));
    requireValue(m.format==='craftmine.workspace/1'&&m.taskId===this.id&&m.base===this.base&&m.selected===this.selected,
      'INVALID_WORKSPACE','开发草稿身份不匹配');
    integer(m.revision,0,HARNESS_LIMITS.calls,'草稿版本');
    return m;
  }
  revisionPath(head){
    requireValue(typeof head==='string'&&/^\d+-[a-f0-9]{64}\.json$/.test(head),'INVALID_WORKSPACE','草稿资源引用无效');
    return this.safePath('tasks',this.id,'workspace','revisions',head);
  }
  writeRevision(revision,scene){
    const head=revision+'-'+contentHash(scene)+'.json',file=this.revisionPath(head);
    if(!fs.existsSync(file))atomicJSON(file,scene);
    else requireValue(contentHash(JSON.parse(fs.readFileSync(file,'utf8')))===contentHash(scene),'CORRUPT_ARTIFACT','草稿文件已损坏');
    return head;
  }
  scene(manifest=this.readManifest()){
    const scene=JSON.parse(fs.readFileSync(this.revisionPath(manifest.head),'utf8'));
    requireValue(manifest.head===manifest.revision+'-'+contentHash(scene)+'.json','CORRUPT_ARTIFACT','草稿哈希不匹配');
    return scene;
  }
  journal(type,data){
    this.safePath('tasks',this.id,'workspace','events.jsonl');
    fs.mkdirSync(this.dir,{recursive:true});
    const fd=fs.openSync(this.events,'a');
    try{fs.writeSync(fd,JSON.stringify({type,time:Date.now(),...data})+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  }
  assertMutable(){
    const task=this.store.data.tasks.find(t=>t.id===this.id);
    requireValue(task&&['running','validating'].includes(task.status),'TASK_INACTIVE','任务已经停止，不能提交迟到操作');
    requireValue(this.store.data.current===this.base&&!this.store.data.candidate&&!this.store.data.applying,'STALE_BASE','正式世界或候选已经改变');
  }
  resource(kind,id,scene=this.scene()){
    return workspaceResource(scene,kind,id);
  }
  readResource({kind,id,start=0,limit=HARNESS_LIMITS.readChars}){
    integer(start,0,200000,'读取起点');integer(limit,1,HARNESS_LIMITS.readChars,'读取长度');
    const m=this.readManifest(),value=this.resource(kind,id,this.scene(m)),hash=contentHash(value);
    const text=canonicalText(value),chars=Array.from(text),end=Math.min(chars.length,start+limit);
    requireValue(start<=chars.length,'INVALID_ARGUMENTS','读取起点超过资源末尾');
    // Read provenance survives restart, independently of model conversation.
    m.reads[resourceKey(kind,id)]=hash;
    requireValue(Object.keys(m.reads).length<=256,'READ_LIMIT','本任务读取资源数量超过上限');
    atomicJSON(this.file,m);
    return {kind,id,hash,workspaceRevision:m.revision,text:chars.slice(start,end).join(''),start,next:end<chars.length?end:null,totalChars:chars.length};
  }
  patch(input,callId){
    this.assertMutable();fields(input,['workspaceRevision','operations']);
    requireValue(callPattern.test(callId),'INVALID_CALL','工具调用 ID 无效');
    const m=this.readManifest(),requestHash=contentHash(input),prior=m.receipts.find(r=>r.callId===callId);
    if(prior){
      requireValue(prior.requestHash===requestHash,'REPLAY_MISMATCH','相同调用 ID 不能提交不同操作');
      return structuredClone(prior.result);
    }
    integer(input.workspaceRevision,0,HARNESS_LIMITS.calls,'草稿版本');
    requireValue(input.workspaceRevision===m.revision,'STALE_DRAFT','草稿已改变，请重新读取');
    requireValue(Array.isArray(input.operations)&&input.operations.length>0&&input.operations.length<=HARNESS_LIMITS.patchOperations,
      'INVALID_ARGUMENTS','每次需要 1–8 项修改');
    requireValue(m.receipts.length<HARNESS_LIMITS.calls,'CALL_LIMIT','草稿修改次数已达上限');
    const patched=patchWorkspaceScene(this.scene(m),input,{reads:m.reads,extensions:this.store.extensionSet(),baseScene:this.store.readBuild(this.base).scene,selected:this.selected});
    this.journal('patch.prepared',{callId,requestHash,fromRevision:m.revision});
    const revision=m.revision+1,head=this.writeRevision(revision,patched.scene);
    const result={workspaceRevision:revision,headHash:contentHash(patched.scene),changed:patched.changed};
    const updated={...m,revision,head,validation:null,receipts:[...m.receipts,{callId,requestHash,result}]};
    this.assertMutable();
    atomicJSON(this.file,updated);
    // A lost trailing receipt can be recovered from the published manifest.
    try{this.journal('patch.committed',{callId,requestHash,result});}catch{/* manifest remains authoritative */}
    return structuredClone(result);
  }
  validated(build,report){
    this.assertMutable();const m=this.readManifest();
    requireValue(contentHash(build.scene)===contentHash(this.scene(m)),'STALE_EVIDENCE','验证结果不是当前草稿');
    requireValue(report.passed===true,'FAILED_CHECK','候选未通过检查');
    m.validation={revision:m.revision,head:m.head,build:build.id,report:structuredClone(report)};
    atomicJSON(this.file,m);return m.validation;
  }
}

function canonicalText(value){return JSON.stringify(value,null,2);}
