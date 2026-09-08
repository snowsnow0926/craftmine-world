import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EMPTY_SCENE, INITIAL_SNAPSHOT, compileScene, clone, validateSnapshot, sceneDiff } from './scene.mjs';
import { ModuleLibrary } from './memory.mjs';

export function atomicJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temp, 'wx');
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
}
export class ProjectStore {
  constructor(root) {
    this.root = path.resolve(root); this.file = path.join(this.root, 'project.json');
    this.modules = new ModuleLibrary(this.root, atomicJSON);
    fs.mkdirSync(this.root, { recursive: true });
    if (!fs.existsSync(this.file)) {
      const build = this.build(EMPTY_SCENE);
      atomicJSON(this.file, { format: 'craftmine.project/1', current: build.id, snapshot: clone(INITIAL_SNAPSHOT), candidate: null, applying: null, tasks: [], messages: [], library:[],moduleBindings:{object:{},gameplay:{},creation:{}},activeCreations:[],history: [{ id: build.id, summary: '空白世界', time: Date.now() }] });
    }
    this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (this.data.format !== 'craftmine.project/1') throw Error('项目格式不兼容，未覆盖原文件');
    validateSnapshot(this.data.snapshot); this.readBuild(this.data.current);
    if(!this.data.library){
      atomicJSON(path.join(this.root,'backups','before-memory-upgrade-'+Date.now()+'.json'),this.data);
      this.change(d=>{d.library=[];d.moduleBindings={object:{},gameplay:{}};this.modules.capture(d,this.readBuild(d.current).scene,'从已确认的历史世界保存的创作',d.current);});
    }
    if(!this.data.moduleBindings.creation){
      atomicJSON(path.join(this.root,'backups','before-creation-memory-'+Date.now()+'.json'),this.data);
      this.change(d=>this.modules.capture(d,this.readBuild(d.current).scene,'从已有代码世界保存的创作',d.current));
    }
    if (this.data.applying || this.data.tasks.some(t => ['running','validating','cancelling'].includes(t.status))) this.change(data => {
      data.applying = null;
      for (const task of data.tasks) if (['running','validating','cancelling'].includes(task.status)) { task.status = 'interrupted'; task.error = '本地服务中断，当前世界未改变。'; }
    });
  }
  change(fn) { const next = clone(this.data); fn(next); atomicJSON(this.file, next); this.data = next; return next; }
  build(scene) {
    const compiled = compileScene(scene), id = 'v-' + compiled.hash.slice(0, 20), dir = path.join(this.root, 'builds', id);
    if (!fs.existsSync(path.join(dir, 'build.json'))) {
      atomicJSON(path.join(dir, 'scene.json'), compiled.scene);
      atomicJSON(path.join(dir, 'build.json'), { ...compiled, id });
    }
    return { ...compiled, id };
  }
  readBuild(id) {
    if (typeof id !== 'string' || !/^v-[a-f0-9]{20}$/.test(id)) throw Error('版本 ID 无效');
    const stored = JSON.parse(fs.readFileSync(path.join(this.root, 'builds', id, 'build.json'), 'utf8'));
    const checked = compileScene(stored.scene);
    if (stored.hash !== checked.hash || id !== 'v-' + checked.hash.slice(0,20)) throw Error('构建校验失败，保留原世界');
    return { ...checked, id };
  }
  idle() { if (this.data.applying || this.data.candidate || this.data.tasks.some(t => ['running','validating','cancelling'].includes(t.status))) throw Error('请先完成当前任务或处理候选更新'); }
  addMessage(role, text) { this.change(d => { d.messages.push({ role, text: String(text).slice(0,5000), time: Date.now() }); d.messages = d.messages.slice(-80); }); }
  save(version, snapshot) {
    if (version !== this.data.current || this.data.applying) throw Error('存档版本已过期或正在切换，请刷新工作台');
    this.change(d => { d.snapshot = validateSnapshot(snapshot); });
  }
  stage(build, summary, base, taskId, checks = []) {
    if (this.data.current !== base || this.data.applying || this.data.candidate) throw Error('候选基准已过期');
    this.change(d => { d.candidate = { id: build.id, base, summary, taskId, checks, diff: sceneDiff(this.readBuild(base).scene, build.scene), time: Date.now() }; });
  }
  rollback(id) {
    this.idle(); if (!this.data.history.some(v => v.id === id)) throw Error('版本不在历史中');
    this.stage(this.readBuild(id), '恢复此前的场景版本', this.data.current, null, ['历史产物重新校验通过']);
  }
  prepare(candidateId, version, snapshot) {
    const d = this.data, c = d.candidate;
    if (d.applying || !c || c.id !== candidateId || c.base !== d.current || version !== d.current) throw Error('候选或运行版本已过期');
    const latest = validateSnapshot(snapshot), transaction = { id: randomUUID(), previous: d.current, candidate: c.id, snapshot: latest, loadSnapshot: c.importSnapshot || latest, time: Date.now() };
    atomicJSON(path.join(this.root, 'backups', transaction.id + '.json'), { ...d, snapshot: latest, applying: null });
    this.change(next => { next.snapshot = latest; next.applying = transaction; });
    return transaction;
  }
  commit(transactionId, snapshot) {
    const tx = this.data.applying;
    if (!tx || tx.id !== transactionId || tx.previous !== this.data.current || this.data.candidate?.id !== tx.candidate) throw Error('应用事务已经失效');
    const latest = validateSnapshot(snapshot), build = this.readBuild(tx.candidate);
    this.change(d => {
      const origin=d.tasks.find(t=>t.id===d.candidate.taskId)?.prompt||d.candidate.summary;
      const remembered=this.modules.capture(d,build.scene,origin,tx.candidate);
      d.current = tx.candidate; d.snapshot = latest; d.lastCommit = tx.id;
      d.history.push({ id: tx.candidate, summary: d.candidate.summary, time: Date.now() }); d.history = d.history.slice(-30);
      const task = d.tasks.find(t => t.id === d.candidate.taskId);
      if (task) { task.status = 'applied'; task.remembered=remembered;task.logs.push({time:Date.now(),text:`浏览器载入与绘制检查完成，场景版本和进度已保存；记住了 ${remembered.length} 个新模块版本。`}); }
      d.messages.push({role:'system',text:d.candidate.importSnapshot?'完整存档已应用，恢复了文件中的场景和位置；切换前的世界已备份。':'候选已应用到世界，已保存最新兼容进度。可以继续体验和修改。',time:Date.now()});
      d.messages = d.messages.slice(-80);
      d.candidate = null; d.applying = null;
    });
  }
  abort(id) { if (this.data.applying?.id === id) this.change(d => { d.applying = null; }); }
  discard() {
    if (this.data.applying) throw Error('正在应用，暂时不能丢弃');
    this.change(d => { const task = d.tasks.find(t => t.id === d.candidate?.taskId); if (task) task.status = 'discarded'; d.candidate = null; });
  }
  importModule(input){this.idle();this.change(d=>this.modules.register(d,input));}
  reuseModule(id,version,player){
    this.idle();const module=this.modules.read(this.data,id,version);
    const scene=this.modules.instantiate(this.data,this.readBuild(this.data.current).scene,id,version,player);
    const build=this.build(scene);if(build.id===this.data.current)throw Error('该玩法模块已经使用这个版本和参数');
    this.stage(build,`复用「${module.name}」v${version}`,this.data.current,null,['已读取记忆库中的实际模块定义','兼容声明、依赖、版本哈希与场景构建校验通过']);
  }
  exportSave() { return { format: 'craftmine.save/1', scene: this.readBuild(this.data.current).scene, snapshot: clone(this.data.snapshot) }; }
  importSave(save) {
    this.idle(); if (save?.format !== 'craftmine.save/1') throw Error('不是此版本的完整存档');
    const snapshot = validateSnapshot(save.snapshot), build = this.build(save.scene);
    // Full-state restoration still goes through the same browser-validated transaction.
    this.change(d => { d.candidate = { id:build.id, base:d.current, summary:'导入完整存档（恢复文件中的世界与位置）', taskId:null, checks:['存档格式与场景构建校验通过'], diff:sceneDiff(this.readBuild(d.current).scene,build.scene), importSnapshot:snapshot, time:Date.now() }; });
  }
}
