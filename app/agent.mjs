import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { OUTPUT_SCHEMA,validateObjectScope,upgradeScene,canonicalJSON,decodeAgentScene,applySceneChanges,expandSceneObjects } from './scene.mjs';
import { atomicJSON } from './store.mjs';
import { verifyBehaviors } from './behavior-verify.mjs';
import { checkCreationModule,rememberCreationCheck } from './creation-verify.mjs';
import { GameplaySession } from './gameplay.mjs';
import { BehaviorState } from './behavior-state.mjs';
import { buildPrompt,buildRepairPrompt } from './agent-prompt.mjs';
import { findCodex,generateModel,killProcessTree,modelProvider,providerStatus,deepseekKey,thinkingEnabled } from './agent-model.mjs';
import { ACTION_SCHEMA } from './harness/contracts.mjs';
import { TaskWorkspace } from './harness/workspace.mjs';
import { DomainTools } from './harness/tools.mjs';
import { HarnessLoop } from './harness/orchestrator.mjs';
import { actionPrompt,decideAction } from './harness/loop-model.mjs';
import { extensionCatalog } from './harness/extension.mjs';
export { findCodex,providerStatus,killProcessTree,modelProvider,modelId,thinkingEnabled } from './agent-model.mjs';
export { buildPrompt } from './agent-prompt.mjs';

// 分步工具闭环默认关闭：只有显式设置 CRAFTMINE_HARNESS_LOOP=1 才走新路径，
// 未设置时 run/修复循环与历史行为完全一致。
export const harnessLoopEnabled=()=>String(process.env.CRAFTMINE_HARNESS_LOOP||'').trim()==='1';
// 只有执行意图才走分步闭环；讨论消息不能变成世界改动（计划书 §5.1）。
export const usesHarnessLoop=intent=>harnessLoopEnabled()&&intent==='execute';
// 上下文压缩阈值的人工上限：只用于回归验证「真的会压缩」，生产默认不设。
export const contextCap=()=>{const value=Number(process.env.CRAFTMINE_CONTEXT_CAP);return Number.isFinite(value)&&value>0?Math.floor(value):null;};
// 一个任务内最多压缩几次；压缩后仍超出预算就如实失败，不无限重试。
export const COMPACTION_LIMIT=8;
// 分步闭环的总步数预算（跨压缩累计）。默认 16；长任务可以调大，代价是更多模型调用。
export const harnessSteps=()=>{const value=Number(process.env.CRAFTMINE_HARNESS_STEPS);return Number.isFinite(value)&&value>=1?Math.min(200,Math.floor(value)):16;};

export const REPAIR_LIMIT=2;
export const TASK_TIMEOUT=240000;
// 开启思考后单次调用可能接近 200 秒，必须给整个任务留出更多时间。
export const TASK_TIMEOUT_THINKING=Number(process.env.CRAFTMINE_TASK_TIMEOUT_MS||1200000);
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
    this.store.idle();const provider=modelProvider(),executable=provider==='codex'?this.executable():null;
    if(provider==='codex'&&!executable)throw Error('未找到 Codex CLI，请先安装并登录');
    if(provider==='deepseek'&&!deepseekKey())throw Error('未配置 DeepSeek 密钥，请设置 CRAFTMINE_DEEPSEEK_API_KEY 后重启本地服务');
    const id=randomUUID(),base=this.store.data.current,started=Date.now(),timeoutMs=this.options.timeoutMs??(thinkingEnabled()?TASK_TIMEOUT_THINKING:TASK_TIMEOUT);
    this.store.addMessage('user',text);
    this.store.change(d=>{d.tasks.push({id,base,intent,prompt:text,context,status:'running',started,attempts:[],limits:{repairs:REPAIR_LIMIT,timeoutMs},logs:[{time:started,text:'已固定当前场景版本，正在启动真实 LLM。'}]});d.tasks=d.tasks.slice(-40);});
    const active={id,cancelled:false,timedOut:false,abort:new AbortController(),deadline:started+timeoutMs};this.active=active;
    const timer=setTimeout(()=>{active.timedOut=true;active.abort.abort();killProcessTree(this.child);},timeoutMs);
    const pipeline=usesHarnessLoop(intent)?this.runHarness(executable,active,text,intent,context,base):this.run(executable,active,text,intent,context,base);
    active.done=pipeline.catch(error=>{
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
  // 同一个 attempt 内可能有多次模型调用（闭环每步一次、单次路径的按需读取追问），用量必须累加。
  applyUsage(active,number,usage){this.attempt(active,number,(attempt,task)=>{attempt.usage={...(attempt.usage||{})};for(const [key,n]of Object.entries(usage||{}))if(Number.isFinite(n))attempt.usage[key]=(attempt.usage[key]||0)+n;task.usage={};for(const a of task.attempts)for(const [key,n]of Object.entries(a.usage||{}))if(Number.isFinite(n))task.usage[key]=(task.usage[key]||0)+n;});}
  generate(input){return generateModel({...input,schema:input.schema||OUTPUT_SCHEMA,onChild:child=>{this.child=child;},onLog:text=>this.log(input.active.id,text),onUsage:usage=>this.applyUsage(input.active,input.number,usage)});}
  async run(executable,active,text,intent,context,base){
    const store=this.store,dir=path.join(store.root,'tasks',active.id),scene=upgradeScene(store.readBuild(base).scene),memories=store.modules.retrieve(store.data,text,context.selected);
    this.update(active.id,t=>{t.memories=memories.map(m=>({id:m.id,version:m.version,name:m.name,kind:m.kind}));});
    this.log(active.id,memories.length?'已从创作记忆中读取：'+memories.map(m=>`${m.name} v${m.version}`).join('、'):'记忆库中暂无相关成果，本次从零创作。');
    atomicJSON(path.join(dir,'scene.before.json'),scene);atomicJSON(path.join(dir,'response.schema.json'),OUTPUT_SCHEMA);
    const projectContext=store.contextFor(text,context.selected,store.readBuild(base));
    atomicJSON(path.join(dir,'project-context.json'),projectContext);
    this.update(active.id,t=>{t.contextRead={revision:projectContext.revision,notes:projectContext.notes.map(n=>n.id),requests:projectContext.acceptedChanges.map(r=>r.id),problems:projectContext.runtimeProblems.map(p=>p.id)};});
    this.log(active.id,`已读取创作方向、${projectContext.notes.length} 条长期约定、${projectContext.acceptedChanges.length} 条已应用需求和 ${projectContext.runtimeProblems.length} 个已保存的运行问题。`);
    const assets=store.assets.manifest(store.data,scene,text);atomicJSON(path.join(dir,'assets-read.json'),assets);
    // 世界不使用素材时，提示里不必带 scene/4 的整份重复 schema。
    const promptSchema=assets.length||scene.objects.some(o=>o.appearance)?OUTPUT_SCHEMA:{...OUTPUT_SCHEMA,properties:{...OUTPUT_SCHEMA.properties,scene:{anyOf:OUTPUT_SCHEMA.properties.scene.anyOf.slice(0,2)}}};
    const basePrompt=buildPrompt({assets,scene,memories,text,intent,context,messages:store.data.messages.slice(-8),snapshot:store.data.snapshot,projectContext});
    let previous;
    for(let number=1;number<=REPAIR_LIMIT+1;number++){
      this.assertActive(active);const attemptDir=path.join(dir,'attempts',String(number));let phase='storage',raw='',build,readRound=false;
      this.update(active.id,t=>{t.status='running';t.attempts.push({number,kind:number===1?'generate':'repair',status:'running',phase:'provider',started:Date.now()});});
      const setPhase=value=>{phase=value;this.attempt(active,number,(a,t)=>{a.phase=value;if(value!=='provider')t.status='validating';});};
      try{
        const prompt=previous?buildRepairPrompt(basePrompt,{number,...previous,snapshot:store.data.snapshot}):basePrompt;
        atomicJSON(path.join(attemptDir,'response.schema.json'),promptSchema);fs.writeFileSync(path.join(attemptDir,'request.txt'),prompt,'utf8');
        if(number===1)fs.writeFileSync(path.join(dir,'request.txt'),prompt,'utf8');
        this.log(active.id,number===1?'第 1 次生成开始。':`自动修复 ${number-1}/${REPAIR_LIMIT}：根据${stageNames[previous.diagnostic.stage]}的实际报错修正，同一总时限继续计时。`);
        setPhase('provider');raw=await this.generate({executable,dir:attemptDir,prompt,schema:promptSchema,active,number});this.assertActive(active);
        setPhase('storage');fs.writeFileSync(path.join(attemptDir,'response.json'),raw,'utf8');
        setPhase('response');if(typeof raw!=='string'||Buffer.byteLength(raw)>1_000_000)throw Error('模型回复超过大小限制');
        const validResult=value=>Boolean(value)&&typeof value.summary==='string'&&Boolean(value.summary.trim())&&value.summary.length<=3000&&Array.isArray(value.notes)&&value.notes.length<=20&&value.notes.every(s=>typeof s==='string'&&s.length<=1000);
        let result=JSON.parse(raw);
        if(!validResult(result))throw Error('模型回复格式无效');
        if(Array.isArray(result.read)&&result.read.length){
          if(readRound)throw Error('已经补充过一次读取，请直接给出 changes 或完整 scene');
          if(Array.isArray(result.changes)&&result.changes.length)throw Error('read 与 changes 不能同时返回');
          if(result.scene!==null&&result.scene!==undefined)throw Error('read 与 scene 不能同时返回');
          readRound=true;const extra=expandSceneObjects(scene,result.read);
          const followup=prompt+`\n\n你请求读取的对象完整定义（数据）：${JSON.stringify(extra)}\n现在请直接给出 changes 或完整 scene，不要再返回 read。`;
          setPhase('storage');fs.writeFileSync(path.join(attemptDir,'request.read.txt'),followup,'utf8');
          this.log(active.id,`模型请求读取 ${extra.length} 个对象的完整定义，已补充后继续。`);
          setPhase('provider');raw=await this.generate({executable,dir:attemptDir,prompt:followup,schema:promptSchema,active,number});this.assertActive(active);
          setPhase('storage');fs.writeFileSync(path.join(attemptDir,'response.read.json'),raw,'utf8');
          setPhase('response');if(typeof raw!=='string'||Buffer.byteLength(raw)>1_000_000)throw Error('模型回复超过大小限制');
          result=JSON.parse(raw);
          if(!validResult(result))throw Error('模型回复格式无效');
        }
        const explanation=result.summary+(result.notes.length?'\n\n'+result.notes.join('\n'):'');
        const hasChanges=Array.isArray(result.changes)&&result.changes.length>0;
        if(hasChanges&&result.scene!==null&&result.scene!==undefined)throw Error('局部修改（changes）与完整场景（scene）只能二选一');
        if(intent==='discuss'||(result.scene===null&&!hasChanges)){
          if(previous&&intent!=='discuss')throw Error('修复必须返回候选场景或局部修改，不能以文字回复替代原需求');
          this.assertActive(active);this.attempt(active,number,(a,t)=>{a.status='discussed';a.finished=Date.now();t.status='discussed';t.finished=Date.now();});store.addMessage('assistant',explanation);return;
        }
        setPhase('scene');let nextScene=hasChanges?applySceneChanges(scene,result.changes):decodeAgentScene(result.scene);
        setPhase('memory');if(!Array.isArray(result.reuseCreations)||result.reuseCreations.length>4)throw Error('创作记忆复用请求无效');
        for(const ref of result.reuseCreations){
          if(!ref||Object.keys(ref).length!==3||!Object.hasOwn(ref,'position'))throw Error('创作记忆复用字段无效');
          if(!memories.some(m=>m.kind==='creation'&&m.id===ref.id&&m.version===ref.version))throw Error('不能复用未提供的创作记忆版本');
          const module=store.modules.read(store.data,ref.id,ref.version);
          setPhase('behavior');const report=await checkCreationModule(store,module,{origin:this.options.verificationOrigin,extensions:structuredClone(this.store.data.extensions),signal:active.abort.signal,deadline:active.deadline});this.assertActive(active);
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
          const report=await verifyBehaviors(build,{origin:this.options.verificationOrigin,extensions:structuredClone(this.store.data.extensions),signal:active.abort.signal,deadline:active.deadline});this.assertActive(active);
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
  // 分步工具闭环：模型逐步调用领域工具读世界、改草稿，最后构建候选。
  // 默认关闭，只有 CRAFTMINE_HARNESS_LOOP=1 时由 start 调用。
  async runHarness(executable,active,text,intent,context,base){
    const store=this.store,number=1;
    this.update(active.id,t=>{t.status='running';t.attempts.push({number,kind:'harness',status:'running',phase:'provider',started:Date.now()});});
    const setPhase=phase=>{this.attempt(active,number,(a,t)=>{a.phase=phase;if(phase!=='provider')t.status='validating';});};
    this.log(active.id,'分步工具闭环已开启，模型将逐步读取世界、局部修改草稿，再构建候选。');
    const workspace=new TaskWorkspace(store,{id:active.id,base,selected:context?.selected??null});
    const loopDir=path.join(workspace.dir,'loop');fs.mkdirSync(loopDir,{recursive:true});
    atomicJSON(path.join(loopDir,'response.schema.json'),ACTION_SCHEMA);
    let draftBuild=null;
    const extensions=extensionCatalog(store.data.extensions);
    const tools=new DomainTools(workspace,{extensions,build:()=>{
      setPhase('scene');
      const build=store.build(workspace.scene());
      draftBuild=build;
      setPhase('storage');
      workspace.validated(build,{passed:true,checks:['草稿通过场景编译与稳定 ID 校验','独立构建产物已生成，SHA-256 已记录']});
      return build;
    },verify:async({requirement}={})=>{
      // verify.run 真的跑：把当前草稿送进隔离 Worker，走一遍事件与恢复检查。
      setPhase('behavior');
      const build=draftBuild||store.build(workspace.scene());
      const report=await verifyBehaviors(build,{origin:this.options.verificationOrigin,extensions:structuredClone(this.store.data.extensions),signal:active.abort.signal,deadline:active.deadline});
      this.assertActive(active);
      setPhase('storage');
      return {...report,summary:`玩法验收（隔离 Worker 事件与恢复检查）${report.passed?'通过':'未通过'}${requirement?`：${requirement}`:''}`,scope:'接口与事件序列检查；不等同于玩家需求验收'};
    }});
    const statusLabels={ok:'完成',error:'失败',rejected:'被拒绝',failed:'决策失败',finish:'结束'};
    // options.harnessDecide 只用于测试注入假模型，生产不设置它；其余记录行为一致。
    const decide=async state=>{
      this.assertActive(active);
      const prompt=actionPrompt(state);
      fs.writeFileSync(path.join(loopDir,`step-${state.step}.request.txt`),prompt,'utf8');
      setPhase('provider');
      const raw=this.options.harnessDecide
        ?await this.options.harnessDecide(state,{prompt})
        :await decideAction({executable,dir:loopDir,prompt,schema:ACTION_SCHEMA,signal:active.abort.signal,
          onChild:child=>{this.child=child;},
          onLog:logText=>this.log(active.id,logText),
          onUsage:usage=>this.applyUsage(active,number,usage)});
      if(typeof raw==='string')fs.writeFileSync(path.join(loopDir,`step-${state.step}.action.json`),raw,'utf8');
      const responseFile=path.join(loopDir,'response.json');
      if(fs.existsSync(responseFile))fs.copyFileSync(responseFile,path.join(loopDir,`step-${state.step}.response.json`));
      return raw;
    };
    const startLoop=(checkpoint=null,resumeTrace=null)=>new HarnessLoop({
      workspace,tools,requirement:text,intent,signal:active.abort.signal,
      contextWindow:providerStatus().contract?.capabilities?.contextWindow?.value ?? null,
      contextCap:contextCap(),
      steps:harnessSteps(),
      extensions,checkpoint,resumeTrace,
      intentRevision:(store.data.tasks.find(t=>t.id===active.id)?.revision??0),
      onStep:step=>{
        const label=statusLabels[step.status]||step.status;
        const detail=step.message?`：${step.message}`:step.status==='ok'?`（${step.durationMs} 毫秒）`:'';
        this.log(active.id,`第 ${step.step} 步：${step.tool||'结束'} ${label}${detail}`);
      },
      decide,
    });
    let result=await startLoop().run();
    // 上下文到压缩阈值时由宿主压缩：机器检查点一条不少，原始轨迹只留短账目，然后继续。
    // 压缩不是「让模型自己忘记」：模型无权决定丢什么，丢什么由机器检查点决定。
    let compactions=0;
    while(result.status==='context'&&compactions<COMPACTION_LIMIT){
      compactions+=1;
      // 压缩只丢原始载荷，不丢机器事实：哪些资源已经改过、草稿到了第几版，仍然告诉模型。
      const ledger=result.steps.map(entry=>{
        const summary=entry.result&&typeof entry.result==='object'?entry.result:null;
        return {step:entry.step,tool:entry.tool,status:entry.status,code:entry.code,message:entry.message,
          ...(Array.isArray(summary?.changed)?{changed:summary.changed}:{}),
          ...(Number.isInteger(summary?.workspaceRevision)?{workspaceRevision:summary.workspaceRevision}:{}),
          ...(typeof summary?.evidenceRef==='string'?{evidenceRef:summary.evidenceRef}:{}),
          ...(typeof summary?.id==='string'?{id:summary.id}:{}),
          ...(typeof summary?.hash==='string'?{hash:summary.hash}:{})};
      });
      atomicJSON(path.join(workspace.dir,`compaction-${compactions}.json`),{checkpoint:result.checkpoint,context:result.context,ledger});
      this.log(active.id,`上下文到压缩阈值，宿主执行第 ${compactions} 次压缩：保留 ${result.checkpoint.completedSteps.length} 条机器事实，把 ${result.steps.length} 步原始轨迹压成短账目后继续。`);
      const resumed=startLoop(result.checkpoint,ledger);
      const seeded=resumed.steps.length;
      const next=await resumed.run();
      result=next;
      // 压缩后一步都没走又撞阈值：基线本身超预算，如实失败，不空转。
      if(next.steps.length<=seeded)break;
    }
    this.attempt(active,number,a=>{a.loop={status:result.status,steps:result.steps.length,draftRevision:result.draftRevision,build:result.build?.id??null,compactions};});
    atomicJSON(path.join(workspace.dir,'loop.json'),result);
    if(result.status!=='finished'){
      const message=result.error||'分步闭环未完成，草稿保留，未生成候选';
      this.attempt(active,number,a=>{a.status=result.status==='cancelled'?'cancelled':'failed';a.diagnostic={stage:'harness',title:'分步闭环',message,repairable:false,details:[],time:Date.now()};a.finished=Date.now();});
      throw Error(message);
    }
    const build=draftBuild||store.readBuild(result.build.id);
    setPhase('progress');this.checkProgress(build);
    const checks=[
      `分步工具闭环完成：${result.steps.length} 步，其中 ${result.steps.filter(step=>step.status==='ok').length} 次工具调用成功`,
      `草稿经过 ${result.draftRevision} 个不可变版本，候选基于当前草稿构建`,
      '独立场景产物已构建，SHA-256 已记录',
    ];
    // 候选必须真的能跑：源码验证和单次生成路径一样，不能只看场景编译。
    if(build.behaviors?.length){
      setPhase('behavior');this.log(active.id,'正在独立后台浏览器中运行源码，检查事件、命令、超时和状态恢复。');
      const report=await verifyBehaviors(build,{origin:this.options.verificationOrigin,extensions:structuredClone(this.store.data.extensions),signal:active.abort.signal,deadline:active.deadline});this.assertActive(active);
      setPhase('storage');atomicJSON(path.join(store.root,'builds',build.id,'behavior-verification.json'),report);
      this.update(active.id,t=>{t.behaviorVerification=report.modules.map(m=>({id:m.id,revision:m.revision,passed:m.passed,error:m.error}));});
      const failed=report.modules.filter(m=>!m.passed);
      if(failed.length){
        const message=failed.map(m=>m.id+'：'+m.error).join('；');
        this.attempt(active,number,a=>{a.status='failed';a.diagnostic={stage:'behavior',title:stageNames.behavior,message,repairable:false,details:failed.map(m=>({id:m.id,revision:m.revision,error:m.error,failedEvent:m.failedEvent,events:m.events})),time:Date.now()};a.finished=Date.now();});
        throw Error('创作源码未通过后台检查：'+message);
      }
      checks.push('真实代码在隔离 Worker 通过事件序列与恢复检查；玩法体验仍需试玩');
    }
    this.assertActive(active);
    if(build.id===base){
      this.attempt(active,number,(a,t)=>{a.status='unchanged';a.finished=Date.now();t.status='unchanged';t.finished=Date.now();});
      this.log(active.id,'草稿最终与基准场景相同，没有创建候选。');return;
    }
    setPhase('commit');this.assertActive(active);
    store.stage(build,result.summary,base,active.id,checks);
    store.addMessage('assistant','候选方案（尚未应用到世界）：\n'+result.summary);
    this.attempt(active,number,(a,t)=>{a.status='passed';a.finished=Date.now();t.status='ready';t.build=build.id;t.finished=Date.now();});
    this.log(active.id,`分步闭环完成，共 ${result.steps.length} 步；候选 ${build.id} 已就绪，草稿保留在任务目录。`);
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
