import { validateBehavior,validateBehaviorFrame,validateBehaviorResult,jsonRecord,BEHAVIOR_LIMITS } from './behavior-contracts.mjs';

function bootstrap(moduleURL){
  return `const send=globalThis.postMessage.bind(globalThis);
const listen=globalThis.addEventListener.bind(globalThis);
let implementation;
const clone=globalThis.structuredClone.bind(globalThis);
const stringify=JSON.stringify.bind(JSON);
// Reduce exposed APIs before evaluating the authored module. CSP also blocks network/eval.
for(const name of ['fetch','XMLHttpRequest','WebSocket','EventSource','WebTransport','Worker','SharedWorker','importScripts','indexedDB','caches','setTimeout','setInterval','queueMicrotask','postMessage','addEventListener','close']){
  for(let target=globalThis;target;target=Object.getPrototypeOf(target)){
    if(target===globalThis||Object.hasOwn(target,name))Object.defineProperty(target,name,{value:undefined,writable:false,configurable:false});
  }
}
listen('message',async event=>{
  const {sequence,frame,params,state}=event.data||{};
  if(!implementation)return;
  try{
    const value=await implementation.step({frame,params,state});
    const serialized=stringify(value);
    if(typeof serialized!=='string'||serialized.length>40000)throw Error('玩法返回数据过大');
    send({type:'result',sequence,value:clone(value)});
  }catch(error){send({type:'error',sequence,message:String(error?.message||error).slice(0,600)});}
});
(async()=>{try{implementation=await import(${JSON.stringify(moduleURL)});if(typeof implementation.step!=='function')throw Error('源码需要导出 step 函数');send({type:'ready'});}
catch(error){send({type:'error',message:String(error?.message||error).slice(0,600)});}})();`;
}

export class BehaviorRunner {
  constructor(input,{stepTimeoutMs=150,loadTimeoutMs=2500,localCoordinates=false}={}){
    this.definition=validateBehavior(input);this.stepTimeoutMs=stepTimeoutMs;this.closed=false;this.sequence=0;this.pending=null;this.urls=[];
    this.state=structuredClone(this.definition.initialState);
    this.coordinates={local:localCoordinates};
    this.ready=new Promise((resolve,reject)=>{this.readyResolve=resolve;this.readyReject=reject;});
    try{
      const moduleURL=URL.createObjectURL(new Blob([this.definition.code],{type:'text/javascript'}));this.urls.push(moduleURL);
      const workerURL=URL.createObjectURL(new Blob([bootstrap(moduleURL)],{type:'text/javascript'}));this.urls.push(workerURL);
      // Chromium rejects module-worker entry points created in an opaque sandbox.
      // A classic Blob worker can load the authored ES module after reducing APIs.
      this.worker=new Worker(workerURL,{name:'craftmine-behavior-'+this.definition.id});
      this.loadTimer=setTimeout(()=>this.fail(Error('玩法初始化超时，已停止该模块')),loadTimeoutMs);
      this.worker.onmessage=event=>this.receive(event.data);
      this.worker.onerror=event=>{event.preventDefault();this.fail(Error('玩法执行失败：'+(event.message||'Worker 错误')));};
      this.worker.onmessageerror=()=>this.fail(Error('玩法返回了无法传递的数据'));
    }catch(error){this.fail(error);}
  }
  receive(message){
    if(this.closed)return;
    if(message?.type==='ready'&&this.readyResolve){clearTimeout(this.loadTimer);this.readyResolve();this.readyResolve=null;this.readyReject=null;return;}
    if(message?.type==='error'){this.fail(Error(message.message||'玩法模块发生错误'));return;}
    const job=this.pending;
    if(message?.type!=='result'||!job||message.sequence!==job.sequence){this.fail(Error('玩法发送了无效或过期的消息'));return;}
    try{
      const result=validateBehaviorResult(message.value,this.definition,job.frame,this.coordinates);
      clearTimeout(job.timer);this.pending=null;this.state=structuredClone(result.state);job.resolve(result);
    }catch(error){this.fail(error);}
  }
  async step(frame,state=this.state){
    await this.ready;if(this.closed)throw Error('玩法模块已停止');if(this.pending)throw Error('玩法上一步尚未完成');
    const checked=validateBehaviorFrame(frame,this.coordinates),saved=jsonRecord(state,BEHAVIOR_LIMITS.state),sequence=++this.sequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>this.fail(Error('玩法计算超时，已停止该模块')),this.stepTimeoutMs);
      this.pending={sequence,frame:checked,resolve,reject,timer};
      try{this.worker.postMessage({sequence,frame:checked,params:this.definition.params,state:saved});}catch(error){this.fail(error);}
    });
  }
  fail(error){
    if(this.closed)return;this.closed=true;clearTimeout(this.loadTimer);this.worker?.terminate();
    for(const url of this.urls)URL.revokeObjectURL(url);this.urls=[];
    if(this.readyReject){this.readyReject(error);this.readyResolve=null;this.readyReject=null;}
    if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(error);this.pending=null;}
  }
  dispose(){this.fail(Error('玩法模块已卸载'));}
}
