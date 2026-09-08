import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { OUTPUT_SCHEMA,validateObjectScope,upgradeScene,canonicalJSON,decodeAgentScene } from './scene.mjs';
import { atomicJSON } from './store.mjs';
import { verifyBehaviors } from './behavior-verify.mjs';
import { checkCreationModule,rememberCreationCheck } from './creation-verify.mjs';
import { GameplaySession } from './gameplay.mjs';
import { BehaviorState } from './behavior-state.mjs';
import { buildPrompt,buildRepairPrompt } from './agent-prompt.mjs';
import { findCodex,generateModel,killProcessTree } from './agent-model.mjs';
export { findCodex,providerStatus,killProcessTree } from './agent-model.mjs';
export { buildPrompt } from './agent-prompt.mjs';

export const REPAIR_LIMIT=2;
export const TASK_TIMEOUT=240000;
const stageNames={response:'回复格式',scene:'场景构建',scope:'修改范围',memory:'记忆来源',behavior:'源码运行',progress:'已有进度',provider:'模型连接',storage:'本地保存',commit:'候选提交',deadline:'总时限',cancelled:'取消'};
const retryStages=new Set(['response','scene','scope','memory','progress']);
class CheckFailure extends Error {
  constructor(message,details){super(message);this.details=details;this.repairable=true;}
}
export class AgentRunner {
  constructor(store,options={}){this.store=store;this.options=options;this.child=null;this.active=null;}
  executable(){return findCodex();}
  start(text,intent,context){
    if(this.active||this.store.data.candidate||this.store.data.applying){
      if(intent==='discuss'){this.store.addMessage('user',text);this.store.addMessage('system','讨论已记录。当前任务或候选仍待处理，这条消息没有触发修改。');return null;}
      throw Error('请先完成任务，或应用／丢弃当前候选');
    }
    this.store.idle();const executable=this.executable();if(!executable)throw Error('未找到 Codex CLI，请先安装并登录');
    const id=randomUUID(),base=this.store.data.current,started=Date.now(),timeoutMs=this.options.timeoutMs??TASK_TIMEOUT;
    this.store.addMessage('user',text);
    this.store.change(d=>{d.tasks.push({id,base,intent,prompt:text,context,status:'running',started,attempts:[],limits:{repairs:REPAIR_LIMIT,timeoutMs},logs:[{time:started,text:'已固定当前场景版本，正在启动真实 LLM。'}]});d.tasks=d.tasks.slice(-40);});
    const active={id,cancelled:false,timedOut:false,abort:new AbortController(),deadline:started+timeoutMs};this.active=active;
    const timer=setTimeout(()=>{active.timedOut=true;active.abort.abort();killProcessTree(this.child);},timeoutMs);
    active.done=this.run(executable,active,text,intent,context,base).catch(error=>{
      const message=this.stoppedMessage(active)||String(error.message||error).slice(0,2000);
      this.update(id,t=>{t.status=active.cancelled?'cancelled':'failed';t.error=message;t.finished=Date.now();});
      this.store.addMessage('system',active.cancelled?'任务已取消，当前世界保持不变。':'任务未完成：'+message);
    }).finally(()=>{clearTimeout(timer);if(this.active===active){this.active=null;this.child=null;}});
    return id;
  }
  stoppedMessage(active){return active.cancelled?'任务已取消':active.timedOut||Date.now()>=active.deadline?'任务达到总时限，已停止生成和修复；原世界与进度保留':'';}
  assertActive(active){const message=this.stoppedMessage(active);if(message)throw Error(message);}
  update(id,fn){this.store.change(d=>{const task=d.tasks.find(t=>t.id===id);if(task)fn(task);});}
  log(id,text){this.update(id,t=>{t.logs.push({time:Date.now(),text});t.logs=t.logs.slice(-60);});}
  attempt(active,number,fn){this.update(active.id,t=>fn(t.attempts.find(a=>a.number===number),t));}
  cancel(){
    if(!this.active)throw Error('当前没有运行中的任务');this.active.cancelled=true;this.active.abort.abort();
    try{this.update(this.active.id,t=>{t.status='cancelling';});}finally{killProcessTree(this.child);}
  }
  generate(input){return generateModel({...input,onChild:child=>{this.child=child;},onLog:text=>this.log(input.active.id,text),onUsage:usage=>{
    this.attempt(input.active,input.number,(attempt,task)=>{attempt.usage=usage;task.usage={};for(const a of task.attempts)for(const [key,n]of Object.entries(a.usage||{}))if(Number.isFinite(n))task.usage[key]=(task.usage[key]||0)+n;});
  }});}
  async run(executable,active,text,intent,context,base){
    const store=this.store,dir=path.join(store.root,'tasks',active.id),scene=upgradeScene(store.readBuild(base).scene),memories=store.modules.retrieve(store.data,text,context.selected);
    this.update(active.id,t=>{t.memories=memories.map(m=>({id:m.id,version:m.version,name:m.name,kind:m.kind}));});
    this.log(active.id,memories.length?'已从创作记忆中读取：'+memories.map(m=>`${m.name} v${m.version}`).join('、'):'记忆库中暂无相关成果，本次从零创作。');
    atomicJSON(path.join(dir,'scene.before.json'),scene);atomicJSON(path.join(dir,'response.schema.json'),OUTPUT_SCHEMA);
    const projectContext=store.contextFor(text,context.selected,store.readBuild(base));
    atomicJSON(path.join(dir,'project-context.json'),projectContext);
    this.update(active.id,t=>{t.contextRead={revision:projectContext.revision,notes:projectContext.notes.map(n=>n.id),requests:projectContext.acceptedChanges.map(r=>r.id),problems:projectContext.runtimeProblems.map(p=>p.id)};});
    this.log(active.id,`已读取创作方向、${projectContext.notes.length} 条长期约定、${projectContext.acceptedChanges.length} 条已应用需求和 ${projectContext.runtimeProblems.length} 个已保存的运行问题。`);
    const basePrompt=buildPrompt({scene,memories,text,intent,context,messages:store.data.messages.slice(-8),snapshot:store.data.snapshot,projectContext});
    let previous;
    for(let number=1;number<=REPAIR_LIMIT+1;number++){
      this.assertActive(active);const attemptDir=path.join(dir,'attempts',String(number));let phase='storage',raw='',build;
      this.update(active.id,t=>{t.status='running';t.attempts.push({number,kind:number===1?'generate':'repair',status:'running',phase:'provider',started:Date.now()});});
      const setPhase=value=>{phase=value;this.attempt(active,number,(a,t)=>{a.phase=value;if(value!=='provider')t.status='validating';});};
      try{
        const prompt=previous?buildRepairPrompt(basePrompt,{number,...previous,snapshot:store.data.snapshot}):basePrompt;
        atomicJSON(path.join(attemptDir,'response.schema.json'),OUTPUT_SCHEMA);fs.writeFileSync(path.join(attemptDir,'request.txt'),prompt,'utf8');
        if(number===1)fs.writeFileSync(path.join(dir,'request.txt'),prompt,'utf8');
        this.log(active.id,number===1?'第 1 次生成开始。':`自动修复 ${number-1}/${REPAIR_LIMIT}：根据${stageNames[previous.diagnostic.stage]}的实际报错修正，同一总时限继续计时。`);
        setPhase('provider');raw=await this.generate({executable,dir:attemptDir,prompt,active,number});this.assertActive(active);
        setPhase('storage');fs.writeFileSync(path.join(attemptDir,'response.json'),raw,'utf8');
        setPhase('response');if(typeof raw!=='string'||Buffer.byteLength(raw)>1_000_000)throw Error('模型回复超过大小限制');
        const result=JSON.parse(raw);
        if(!result||typeof result.summary!=='string'||!result.summary.trim()||result.summary.length>3000||!Array.isArray(result.notes)||result.notes.length>20||result.notes.some(s=>typeof s!=='string'||s.length>1000))throw Error('模型回复格式无效');
        const explanation=result.summary+(result.notes.length?'\n\n'+result.notes.join('\n'):'');
        if(intent==='discuss'||result.scene===null){
          if(previous&&intent!=='discuss')throw Error('修复必须返回完整候选场景，不能以文字回复替代原需求');
          this.assertActive(active);this.attempt(active,number,(a,t)=>{a.status='discussed';a.finished=Date.now();t.status='discussed';t.finished=Date.now();});store.addMessage('assistant',explanation);return;
        }
        setPhase('scene');let nextScene=decodeAgentScene(result.scene);
        setPhase('memory');if(!Array.isArray(result.reuseCreations)||result.reuseCreations.length>4)throw Error('创作记忆复用请求无效');
        for(const ref of result.reuseCreations){
          if(!ref||Object.keys(ref).length!==3||!Object.hasOwn(ref,'position'))throw Error('创作记忆复用字段无效');
          if(!memories.some(m=>m.kind==='creation'&&m.id===ref.id&&m.version===ref.version))throw Error('不能复用未提供的创作记忆版本');
          const module=store.modules.read(store.data,ref.id,ref.version);
          setPhase('behavior');const report=await checkCreationModule(store,module,{origin:this.options.verificationOrigin,signal:active.abort.signal,deadline:active.deadline});this.assertActive(active);
          setPhase('storage');rememberCreationCheck(store,module,report);
          setPhase('scene');nextScene=store.modules.instantiate(store.data,nextScene,ref.id,ref.version,context.player,ref.position);
        }
        setPhase('scene');build=store.build(nextScene);this.attempt(active,number,a=>{a.build=build.id;});
        setPhase('scope');validateObjectScope(scene,build.scene,context.selected);
        if(previous&&build.id===base)throw Error('修复结果与原场景完全相同，没有完成原始修改需求');
        setPhase('memory');const used=this.checkSources(scene,build.scene,memories);this.update(active.id,t=>{t.usedModules=used;});
        setPhase('storage');atomicJSON(path.join(attemptDir,'scene.after.json'),build.scene);
        const checks=['场景格式与稳定 ID 校验通过','细粒度几何、碰撞与构造预算通过','玩法配置、依赖与模块来源校验通过','独立场景产物已构建，SHA-256 已记录'];
        setPhase('progress');this.checkProgress(build);
        if(build.behaviors.length){
          setPhase('behavior');this.log(active.id,'正在独立后台浏览器中运行源码，检查事件、命令、超时和状态恢复。');
          const report=await verifyBehaviors(build,{origin:this.options.verificationOrigin,signal:active.abort.signal,deadline:active.deadline});this.assertActive(active);
          setPhase('storage');atomicJSON(path.join(attemptDir,'behavior-verification.json'),report);atomicJSON(path.join(store.root,'builds',build.id,'behavior-verification.json'),report);
          this.update(active.id,t=>{t.behaviorVerification=report.modules.map(m=>({id:m.id,revision:m.revision,passed:m.passed,error:m.error}));});
          setPhase('behavior');if(!report.passed)throw new CheckFailure(report.modules.filter(m=>!m.passed).map(m=>m.id+'：'+m.error).join('；'),report.modules.filter(m=>!m.passed).map(m=>({id:m.id,revision:m.revision,error:m.error,failedEvent:m.failedEvent,events:m.events})));
          checks.push('真实代码在隔离 Worker 通过事件序列与恢复检查；玩法体验仍需试玩');
        }
        setPhase('progress');this.checkProgress(build);
        checks.push('最近保存的玩法进度兼容性通过；应用时仍读取最新进度');
        this.assertActive(active);
        setPhase('storage');fs.copyFileSync(path.join(attemptDir,'response.json'),path.join(dir,'response.json'));atomicJSON(path.join(dir,'scene.after.json'),build.scene);
        const reportFile=path.join(attemptDir,'behavior-verification.json');if(fs.existsSync(reportFile))fs.copyFileSync(reportFile,path.join(dir,'behavior-verification.json'));
        if(build.id===base){this.attempt(active,number,(a,t)=>{a.status='unchanged';a.finished=Date.now();t.status='unchanged';t.finished=Date.now();});this.log(active.id,'场景未发生变化，没有创建候选。');return;}
        setPhase('commit');this.assertActive(active);store.stage(build,result.summary,base,active.id,checks);
        store.addMessage('assistant','候选方案（尚未应用到世界）：\n'+explanation);
        this.attempt(active,number,(a,t)=>{a.status='passed';a.finished=Date.now();t.status='ready';t.build=build.id;t.finished=Date.now();});
        this.log(active.id,number>1?`经过 ${number-1} 次自动修复，候选检查通过。失败记录仍可查看。`:'候选构建已就绪。应用前可查看场景和源码。');return;
      }catch(error){
        const stopped=this.stoppedMessage(active),stage=stopped?(active.cancelled?'cancelled':'deadline'):phase;
        const retryable=!stopped&&!error.code&&(retryStages.has(stage)||error.repairable===true)&&intent==='execute';
        const diagnostic={stage,title:stageNames[stage],message:(stopped||String(error.message||error)).slice(0,2000),repairable:retryable,details:error.details||[],time:Date.now()};
        atomicJSON(path.join(attemptDir,'diagnostic.json'),diagnostic);
        this.attempt(active,number,a=>{a.status=active.cancelled?'cancelled':'failed';a.diagnostic=diagnostic;a.finished=Date.now();});
        this.log(active.id,`第 ${number} 次尝试未通过${diagnostic.title}：${diagnostic.message}`);
        if(!retryable||number>REPAIR_LIMIT)throw Error(diagnostic.message+(retryable?'；已达到两次自动修复上限，可调整需求后重试。':''));
        previous={diagnostic,response:raw};
      }
    }
  }
  checkProgress(build){
    const latest=this.store.data.snapshot,gameplay=new GameplaySession(build.scene.systems,build.scene.objects,latest.gameplay);
    new BehaviorState(build,latest.behaviors,gameplay.state);
  }
  checkSources(scene,next,memories){
    const oldSources=new Set([...scene.objects,...scene.systems].filter(o=>o.source).map(o=>canonicalJSON(o.source))),used=[];
    const record=ref=>{if(memories.some(m=>m.id===ref.id&&m.version===ref.version)&&!used.some(m=>m.id===ref.id&&m.version===ref.version))used.push(ref);};
    for(const definition of [...next.objects,...next.systems])if(definition.source){
      const ref=definition.source;
      if(!oldSources.has(canonicalJSON(ref))){
        const memory=memories.find(m=>m.id===ref.id&&m.version===ref.version);if(!memory)throw Error('模型引用了未提供的模块版本，候选未采纳');
        const inCreation=memory.kind==='creation'&&next.behaviors.some(d=>d.binding&&canonicalJSON(d.binding.source)===canonicalJSON(ref)&&d.binding.objects.some(o=>o.world===definition.id));
        if(!inCreation&&memory.kind!==(next.objects.includes(definition)?'object':'gameplay'))throw Error('模块来源类别不匹配');
      }record(ref);
    }
    for(const d of next.behaviors)if(d.binding){
      const ref=d.binding.source,old=scene.behaviors?.find(b=>b.id===d.id)?.binding?.source;
      if(canonicalJSON(old)!==canonicalJSON(ref)&&!memories.some(m=>m.kind==='creation'&&m.id===ref.id&&m.version===ref.version))throw Error('代码绑定引用了未提供的创作记忆');record(ref);
    }
    return used;
  }
}
