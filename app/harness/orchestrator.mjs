import { HARNESS_LIMITS,integer,parseAction,requireValue } from './contracts.mjs';
import { TOOL_GUIDE } from './tools.mjs';
import { capabilitiesText } from './capabilities.mjs';

export const HARNESS_LOOP_FORMAT = 'craftmine.harness-loop/1';
export const HARNESS_STATE_FORMAT = 'craftmine.harness-state/1';

// 轨迹只保留短结果：大文本截断并标注，需要完整内容时模型必须重新调用读取工具。
// 唯一例外是 state.lastResult，它保存最近一次成功结果的完整值（大小已由工具自身限制）。
const TRACE_RESULT_CHARS = 1200;
const ARGUMENT_CHARS = 400;
const TRACE_ENTRIES = 64;

const messageOf = error => String(error?.message ?? error ?? '未知错误').slice(0,2000);
const codeOf = error => (typeof error?.code === 'string' ? error.code : null);

function argumentSummary(args){
  let text;
  try{ text=JSON.stringify(args ?? {}); }catch{ text='[参数无法序列化]'; }
  return text.length<=ARGUMENT_CHARS?{text}:{text:text.slice(0,ARGUMENT_CHARS),truncated:true};
}

function compactResult(value,budget){
  if(value===undefined)return null;
  let text;
  try{ text=JSON.stringify(value); }catch{ return {truncated:true,note:'结果无法序列化'}; }
  if(typeof text!=='string')return null;
  if(text.length<=budget)return value;
  return {truncated:true,note:`结果超过 ${budget} 字符，已截断；需要完整内容请重新调用读取工具`,preview:text.slice(0,budget)};
}

function buildReference(result){
  if(!result||typeof result!=='object')return {id:null,hash:null,objects:null};
  return {
    id:typeof result.id==='string'?result.id:null,
    hash:typeof result.hash==='string'?result.hash:null,
    objects:Array.isArray(result.scene?.objects)?result.scene.objects.length:null,
  };
}

function budgetValue(value,fallback,label){
  if(value===undefined)return fallback;
  integer(value,0,10000,label);
  return value;
}

// 纯逻辑分步循环：模型每一步只输出一个操作 JSON，由本类校验、执行、记账。
// 它不认识任何模型实现，decide 由调用方注入，因此可以完全用脚本化动作测试。
export class HarnessLoop {
  constructor({workspace,tools,decide,requirement='',intent='execute',budget,steps,calls,signal=null,traceChars=TRACE_RESULT_CHARS,onStep=null}={}){
    requireValue(workspace&&typeof workspace.readManifest==='function','INVALID_ARGUMENTS','分步闭环需要一个开发草稿工作区');
    requireValue(tools&&typeof tools.execute==='function','INVALID_ARGUMENTS','分步闭环需要领域工具集');
    requireValue(typeof decide==='function','INVALID_ARGUMENTS','分步闭环需要一个决策函数');
    this.workspace=workspace;this.tools=tools;this.decide=decide;
    this.requirement=String(requirement??'');this.intent=String(intent??'execute');
    this.stepBudget=budgetValue(steps??budget?.steps,HARNESS_LIMITS.steps,'步数预算');
    this.callBudget=budgetValue(calls??budget?.calls,HARNESS_LIMITS.calls,'工具调用预算');
    integer(traceChars,64,100000,'轨迹结果长度');
    this.traceChars=traceChars;this.signal=signal;this.onStep=typeof onStep==='function'?onStep:null;
    this.steps=[];this.trace=[];this.lastResult=null;this.lastError=null;
    this.built=null;this.builtRevision=null;this.round=0;this.calls=0;
  }
  readRevision(){
    try{ return this.workspace.readManifest().revision; }catch{ return null; }
  }
  callId(round){return `call-${String(this.workspace.id).slice(0,8)}-${round}`;}
  // 每一轮都重新读取草稿事实，模型看到的版本号必须是最新的。
  state(round=this.round+1){
    const manifest=this.workspace.readManifest();
    return {
      format:HARNESS_STATE_FORMAT,
      step:round,requirement:this.requirement,intent:this.intent,
      base:manifest.base,selected:manifest.selected,draftRevision:manifest.revision,
      remainingSteps:Math.max(0,this.stepBudget-(round-1)),
      remainingCalls:Math.max(0,this.callBudget-this.calls),
      guide:TOOL_GUIDE,capabilities:capabilitiesText(),
      trace:this.trace.map(entry=>({...entry})),
      lastResult:this.lastResult,lastError:this.lastError,built:this.built,
    };
  }
  recordStep(entry){
    this.steps.push(entry);
    if(entry.status!=='finish'){
      this.trace.push({step:entry.step,tool:entry.tool,status:entry.status,code:entry.code,message:entry.message,result:entry.result});
      if(this.trace.length>TRACE_ENTRIES)this.trace.splice(0,this.trace.length-TRACE_ENTRIES);
    }
    if(this.onStep){try{this.onStep({...entry});}catch{/* 观察者异常不能中断闭环 */}}
  }
  reject(round,{tool=null,args=null,code='INVALID_ACTION',message}){
    const entry={step:round,tool,arguments:argumentSummary(args),modelSummary:null,status:'rejected',code,message,durationMs:0,result:null};
    this.recordStep(entry);
    this.lastError={code,message};
    this.lastResult=null;
  }
  finishGuard(){
    if(!this.built)return '还没有成功调用 candidate.build，不能结束';
    const revision=this.readRevision();
    if(revision===null)return '开发草稿当前不可读，不能结束';
    if(revision!==this.builtRevision)return `草稿在构建之后又发生了变化（${this.builtRevision} → ${revision}），请重新调用 candidate.build`;
    return null;
  }
  async run(){
    let status='budget',summary='',error=null;
    while(true){
      if(this.signal?.aborted){status='cancelled';error='分步闭环已取消，草稿保留';break;}
      if(this.round>=this.stepBudget){status='budget';error=`步数预算已用完（上限 ${this.stepBudget} 步），草稿保留，未生成候选`;break;}
      this.round+=1;
      let raw;
      try{ raw=await this.decide(this.state(this.round)); }
      catch(decideError){
        if(this.signal?.aborted){status='cancelled';error=messageOf(decideError);}
        else if(codeOf(decideError)==='EMPTY_ACTION'){
          // 模型返回空内容属于可重试的格式问题，不能因此判死整个任务。
          this.reject(this.round,{code:'EMPTY_ACTION',message:messageOf(decideError)});
          continue;
        }
        else{
          status='failed';error='模型决策失败：'+messageOf(decideError);
          this.recordStep({step:this.round,tool:null,arguments:null,modelSummary:null,status:'failed',code:codeOf(decideError),message:error,durationMs:0,result:null});
        }
        break;
      }
      if(this.signal?.aborted){status='cancelled';error='分步闭环已取消，草稿保留';break;}
      if(typeof raw!=='string'){this.reject(this.round,{message:'模型必须返回操作 JSON 字符串'});continue;}
      let action;
      try{ action=parseAction(raw); }
      catch(parseError){this.reject(this.round,{code:codeOf(parseError)||'INVALID_ACTION',message:messageOf(parseError)});continue;}
      if(action.kind==='finish'){
        const guard=this.finishGuard();
        if(guard){this.reject(this.round,{tool:null,args:action.args,code:'BUILD_REQUIRED',message:guard});continue;}
        this.recordStep({step:this.round,tool:null,arguments:argumentSummary(action.args),modelSummary:action.summary,status:'finish',code:null,message:action.summary,durationMs:0,result:null});
        status='finished';summary=action.summary;break;
      }
      // 结束动作不消耗工具调用预算，否则刚构建完候选就会被预算挡住。
      if(this.calls>=this.callBudget){status='budget';error=`工具调用预算已用完（上限 ${this.callBudget} 次），草稿保留，未生成候选`;break;}
      const startedAt=Date.now();
      this.calls+=1;
      let result=null,failure=null;
      try{ result=await this.tools.execute(action.tool,action.args,{callId:this.callId(this.round)}); }
      catch(toolError){ failure=toolError; }
      const durationMs=Date.now()-startedAt;
      const entry={
        step:this.round,tool:action.tool,arguments:argumentSummary(action.args),modelSummary:action.summary,
        status:failure?'error':'ok',code:failure?codeOf(failure):null,message:failure?messageOf(failure):null,durationMs,
        result:failure?null:compactResult(result,this.traceChars),
      };
      this.recordStep(entry);
      if(failure){this.lastError={code:entry.code||'TOOL_ERROR',message:entry.message};this.lastResult=null;continue;}
      this.lastError=null;
      if(action.tool==='candidate.build'){
        // 构建结果里带整份场景，只把引用交给下一步，避免把世界塞进提示。
        this.built=buildReference(result);this.builtRevision=this.readRevision();this.lastResult=this.built;
      }else this.lastResult=result;
    }
    return {
      format:HARNESS_LOOP_FORMAT,status,steps:this.steps.map(entry=>({...entry})),
      draftRevision:this.readRevision(),build:this.built,error,summary,
    };
  }
}
