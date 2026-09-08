import { validateExtensionResult } from './harness/extension-effects.mjs';

// 扩展沙箱：独立 Worker，无 DOM、无网络、无文件、无计时器、不能新建 Worker。
// 宿主只通过 postMessage 递一条命令进去，拿回内核已有的原子效果。
function bootstrap(moduleURL) {
  return `const send=globalThis.postMessage.bind(globalThis);
const listen=globalThis.addEventListener.bind(globalThis);
let implementation;
const clone=globalThis.structuredClone.bind(globalThis);
const stringify=JSON.stringify.bind(JSON);
for(const name of ['fetch','XMLHttpRequest','WebSocket','EventSource','WebTransport','Worker','SharedWorker','importScripts','indexedDB','caches','setTimeout','setInterval','queueMicrotask','postMessage','addEventListener','close']){
  for(let target=globalThis;target;target=Object.getPrototypeOf(target)){
    if(target===globalThis||Object.hasOwn(target,name))Object.defineProperty(target,name,{value:undefined,writable:false,configurable:false});
  }
}
listen('message',async event=>{
  const {sequence,command,world,state}=event.data||{};
  if(!implementation)return;
  try{
    const value=await implementation.apply({command,world,state});
    const serialized=stringify(value);
    if(typeof serialized!=='string'||serialized.length>40000)throw Error('扩展返回数据过大');
    send({type:'result',sequence,value:clone(value)});
  }catch(error){send({type:'error',sequence,message:String(error?.message||error).slice(0,600)});}
});
(async()=>{try{implementation=await import(${JSON.stringify(moduleURL)});if(typeof implementation.apply!=='function')throw Error('扩展需要导出 apply 函数');send({type:'ready'});}
catch(error){send({type:'error',message:String(error?.message||error).slice(0,600)});}})();`;
}

export class ExtensionRunner {
  constructor(extension, { applyTimeoutMs = 200, loadTimeoutMs = 2500 } = {}) {
    this.extension = extension;
    this.applyTimeoutMs = applyTimeoutMs;
    this.closed = false;
    this.sequence = 0;
    this.pending = null;
    this.urls = [];
    this.ready = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    try {
      const moduleURL = URL.createObjectURL(new Blob([extension.code], { type: 'text/javascript' }));
      this.urls.push(moduleURL);
      const workerURL = URL.createObjectURL(new Blob([bootstrap(moduleURL)], { type: 'text/javascript' }));
      this.urls.push(workerURL);
      this.worker = new Worker(workerURL, { name: 'craftmine-extension-' + extension.id });
      this.loadTimer = setTimeout(() => this.fail(Error('扩展初始化超时，已停止该扩展')), loadTimeoutMs);
      this.worker.onmessage = event => this.receive(event.data);
      this.worker.onerror = event => { event.preventDefault(); this.fail(Error('扩展执行失败：' + (event.message || 'Worker 错误'))); };
      this.worker.onmessageerror = () => this.fail(Error('扩展返回了无法传递的数据'));
    } catch (error) { this.fail(error); }
  }
  receive(message) {
    if (this.closed) return;
    if (message?.type === 'ready' && this.readyResolve) { clearTimeout(this.loadTimer); this.readyResolve(); this.readyResolve = null; this.readyReject = null; return; }
    if (message?.type === 'error' && !this.pending) { this.fail(Error(message.message || '扩展模块发生错误')); return; }
    const job = this.pending;
    if (message?.type !== 'result' || !job || message.sequence !== job.sequence) { this.fail(Error('扩展发送了无效或过期的消息')); return; }
    try {
      const result = validateExtensionResult(message.value, this.extension, job.world);
      clearTimeout(job.timer); this.pending = null; job.resolve(result);
    } catch (error) { this.fail(error); }
  }
  async apply({ command, world, state }) {
    await this.ready;
    if (this.closed) throw Error('扩展已停止');
    if (this.pending) throw Error('扩展上一步尚未完成');
    const sequence = ++this.sequence;
    const snapshot = { objects: (world?.objects || []).map(object => ({ ...object })) };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(Error('扩展计算超时，已停止该扩展')), this.applyTimeoutMs);
      this.pending = { sequence, world: snapshot, resolve, reject, timer };
      try { this.worker.postMessage({ sequence, command, world: snapshot, state }); } catch (error) { this.fail(error); }
    });
  }
  fail(error) {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.loadTimer);
    this.worker?.terminate();
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls = [];
    if (this.readyReject) { this.readyReject(error); this.readyResolve = null; this.readyReject = null; }
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = null; }
  }
  dispose() { this.fail(Error('扩展已卸载')); }
}
