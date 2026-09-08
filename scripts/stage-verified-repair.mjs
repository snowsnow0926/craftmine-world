// Maintenance tool: stage a verified flora repair, never commit it or change progress.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectStore,atomicJSON } from '../app/store.mjs';
import { canonicalJSON,upgradeScene } from '../app/scene.mjs';
const artifactPath=path.resolve(process.argv[2]||''),root=path.resolve(process.env.CRAFTMINE_DATA_DIR||'.craftmine');
if(!process.argv[2])throw Error('需要明确的已验证修复产物路径');
const lock=path.join(root,'server.lock');
if(fs.existsSync(lock)){const {pid}=JSON.parse(fs.readFileSync(lock));try{process.kill(pid,0);throw Error('请先停止此项目的本地服务，避免并发写入');}catch(e){if(e.code!=='ESRCH')throw e;}}
const artifact=JSON.parse(fs.readFileSync(artifactPath,'utf8'));
// Inspect the current pointer before opening the store (which may migrate memory).
const existing=JSON.parse(fs.readFileSync(path.join(root,'project.json'),'utf8'));
if(existing.current!==artifact.sourceVersion||existing.candidate||existing.applying||existing.tasks.some(t=>['running','validating','cancelling'].includes(t.status)))throw Error('世界已改变或还有待处理工作，未覆盖或替换任何候选');
const store=new ProjectStore(root),before=upgradeScene(store.readBuild(existing.current).scene),after=upgradeScene(artifact.scene);
if(before.title!==after.title||before.night!==after.night||canonicalJSON(before.systems)!==canonicalJSON(after.systems)||before.objects.length!==after.objects.length)throw Error('修复超出了花草范围');
let changed=0;
for(const o of after.objects){const old=before.objects.find(p=>p.id===o.id);if(!old||canonicalJSON(old.position)!==canonicalJSON(o.position))throw Error('修复改变了对象身份或位置');
  o.source=old.source;
  if(canonicalJSON(old)!==canonicalJSON(o)){if(!/^(flower-|grass-clump-)/.test(o.id))throw Error('修复改变了花草以外的对象');if(o.parts.some(p=>p.solid||p.material!=='solid'))throw Error('修复仍使用碰撞或非植物材质');changed++;}
}
if(!changed)throw Error('没有待修复内容');
const build=store.build(after),id=randomUUID(),dir=path.join(root,'tasks',id),time=Date.now();
atomicJSON(path.join(dir,'scene.before.json'),before);atomicJSON(path.join(dir,'scene.after.json'),after);
atomicJSON(path.join(dir,'verification.json'),{artifact:artifactPath,sourceTask:artifact.task.id,sourceVersion:artifact.sourceVersion,checks:'真实 LLM 生成；独立浏览器载入与几何检查通过；此维护操作只准备候选'});
store.change(d=>d.tasks.push({id,base:d.current,intent:'execute',prompt:'把现有砖块花草修成细茎小花和薄叶草丛',status:'ready',started:time,finished:time,build:build.id,usage:artifact.task.usage,context:{player:d.snapshot.player,selected:null,version:d.current},logs:[{time,text:`真实 LLM 生成的 ${changed} 个植物修复已通过独立世界验证；原树、位置和对象 ID 均保留。`},{time,text:'已准备修复候选，当前世界和进度尚未改变。'}]}));
store.stage(build,'修复三朵砖花与两丛方块草',existing.current,id,['真实 LLM 生成结果已在独立世界通过载入和绘制检查','当前世界基准、原树、对象 ID 和位置核对通过','新花草使用细尺寸、纯色部件与无碰撞叶片']);
store.addMessage('system','花草修复候选已准备好：把原来的砖块花草换成细茎、彩色花瓣和薄叶草丛。原树、对象位置和最新进度保留；应用成功后自动记入创作记忆库。');
console.log(JSON.stringify({current:store.data.current,candidate:build.id,changed,modules:store.data.library.length}));
