import { validateDrawables } from './harness/render-extension.mjs';

// 渲染扩展沙箱：和玩法扩展同一套隔离思路——独立 Worker，无 DOM、无网络、无文件、无计时器、不能新建 Worker。
// 唯一出入口是 emit()：宿主递进去一份只读世界快照，拿回一组内核认识的 drawable。
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
  const {sequence,world,time,dt}=event.data||{};
  if(!implementation)return;
  try{
    const value=await implementation.emit({world,time,dt});
    const serialized=stringify(value);
    if(typeof serialized!=='string'||serialized.length>40000)throw Error('渲染扩展返回数据过大');
    send({type:'result',sequence,value:clone(value)});
  }catch(error){send({type:'error',sequence,message:String(error?.message||error).slice(0,600)});}
});
(async()=>{try{implementation=await import(${JSON.stringify(moduleURL)});if(typeof implementation.emit!=='function')throw Error('渲染扩展需要导出 emit 函数');send({type:'ready'});}
catch(error){send({type:'error',message:String(error?.message||error).slice(0,600)});}})();`;
}

export class RenderRunner {
  constructor(extension, { emitTimeoutMs = 250, loadTimeoutMs = 2500 } = {}) {
    this.extension = extension;
    // budgetMs 是扩展自己声明的单帧预算（用于限额和报告）；硬超时要给 Worker 消息往返留余量，
    // 否则正常的调度抖动会被误判成死循环。
    this.budgetMs = extension?.budgetMs ?? 4;
    this.maxFailures = extension?.maxFailures ?? 3;
    this.emitTimeoutMs = emitTimeoutMs;
    this.loadTimeoutMs = loadTimeoutMs;
    this.disabled = false;
    this.failures = 0;
    this.sequence = 0;
    this.pending = null;
    this.worker = null;
    this.urls = [];
    try { this.ready = this.launch(); }
    catch (error) { this.ready = Promise.reject(error); }
    // 调用方可能只看 runner.disabled 而不 await ready，这里避免未处理的 rejection。
    this.ready.catch(() => {});
  }
  launch() {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    this.boot = { promise, resolve, reject };
    const moduleURL = URL.createObjectURL(new Blob([this.extension.code], { type: 'text/javascript' }));
    const workerURL = URL.createObjectURL(new Blob([bootstrap(moduleURL)], { type: 'text/javascript' }));
    this.urls.push(moduleURL, workerURL);
    const worker = new Worker(workerURL, { name: 'craftmine-render-' + this.extension.id });
    this.worker = worker;
    this.loadTimer = setTimeout(() => this.fatal(Error('渲染扩展初始化超时，已停用该扩展')), this.loadTimeoutMs);
    worker.onmessage = event => this.receive(event.data);
    worker.onerror = event => { event.preventDefault(); this.fatal(Error('渲染扩展执行失败：' + (event.message || 'Worker 错误'))); };
    worker.onmessageerror = () => this.fatal(Error('渲染扩展返回了无法传递的数据'));
    return promise;
  }
  receive(message) {
    if (this.disabled) return;
    if (message?.type === 'ready') { clearTimeout(this.loadTimer); this.boot?.resolve(); return; }
    // 没有在途调用时的 error 说明模块本身坏了，属于装载失败。
    if (message?.type === 'error' && !this.pending) { this.fatal(Error(message.message || '渲染扩展模块发生错误')); return; }
    const job = this.pending;
    if (message?.type !== 'result' || !job || message.sequence !== job.sequence) { this.failCall(Error('渲染扩展发送了无效或过期的消息')); return; }
    try {
      const drawables = validateDrawables(message.value);
      clearTimeout(job.timer); this.pending = null; job.resolve(drawables);
    } catch (error) { this.failCall(error); }
  }
  async emit({ world, time, dt } = {}) {
    if (this.disabled) return [];
    try { await this.boot.promise; } catch { return []; }
    if (this.disabled || this.pending) return [];
    const sequence = ++this.sequence;
    // 只递世界快照，扩展拿不到引擎对象，因此不可能改存档、碰撞或输入。
    const snapshot = {
      objects: (world?.objects || []).map(object => ({
        id: object.id,
        position: object.position ? { ...object.position } : null,
        visible: object.visible !== false,
        solid: object.solid === true,
      })),
    };
    return new Promise(resolve => {
      const timer = setTimeout(() => this.failCall(Error('渲染扩展计算超时，已停用该扩展')), this.emitTimeoutMs);
      this.pending = { sequence, resolve, timer };
      try { this.worker.postMessage({ sequence, world: snapshot, time, dt }); }
      catch (error) { this.failCall(error); }
    });
  }
  // 一次 emit 失败：Worker 可能已经卡死，必须换一个新的；只有累计到 maxFailures 才彻底停用。
  failCall(error) {
    if (this.disabled) return;
    this.failures += 1;
    if (this.pending) { clearTimeout(this.pending.timer); const job = this.pending; this.pending = null; job.resolve([]); }
    if (this.failures >= this.maxFailures) { this.fatal(error); return; }
    this.restart();
  }
  restart() {
    clearTimeout(this.loadTimer);
    this.worker?.terminate();
    this.worker = null;
    this.revoke();
    this.pending = null;
    try { this.ready = this.launch(); this.ready.catch(() => {}); }
    catch (error) { this.fatal(error); }
  }
  // 彻底停用：终止 Worker、释放 blob、拒绝 ready，之后每次 emit 都直接返回空数组。
  fatal(error) {
    if (this.disabled) return;
    this.disabled = true;
    clearTimeout(this.loadTimer);
    this.worker?.terminate();
    this.worker = null;
    this.revoke();
    if (this.boot?.reject) { this.boot.reject(error); this.boot = null; }
    if (this.pending) { clearTimeout(this.pending.timer); const job = this.pending; this.pending = null; job.resolve([]); }
  }
  revoke() {
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls = [];
  }
  dispose() {
    this.disabled = true;
    clearTimeout(this.loadTimer);
    this.worker?.terminate();
    this.worker = null;
    this.revoke();
    // 还没就绪就被卸载时，让 ready 明确失败，调用方不会永远等下去。
    if (this.boot?.reject) { this.boot.reject(Error('渲染扩展已卸载')); this.boot = null; }
    if (this.pending) { clearTimeout(this.pending.timer); const job = this.pending; this.pending = null; job.resolve([]); }
  }
}
