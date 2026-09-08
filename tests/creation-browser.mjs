import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { workbench } from './workbench.mjs';
import { canonicalJSON,EMPTY_SCENE,INITIAL_SNAPSHOT } from '../app/scene.mjs';
import { ModuleLibrary } from '../app/memory.mjs';
const [a,b]=await Promise.all([workbench('creation-source'),workbench('creation-target')]);
const original=JSON.parse(fs.readFileSync('examples/door-and-bounce.save.json','utf8'));
async function state(w){return w.api('/api/state');}
async function build(w){return w.api('/api/build?id='+(await state(w)).current);}
async function aim(w,id){
  const current=await build(w),snap=await w.snapshot(),d=current.scene.behaviors.find(d=>d.targets.includes(id)),offset=snap.behaviors.modules[d.id].overrides[id]?.offset||{x:0,y:0,z:0};
  const parts=current.primitives.filter(p=>p.id===id&&p.solid),x=(Math.min(...parts.map(p=>p.min.x))+Math.max(...parts.map(p=>p.max.x)))/2+offset.x,z=Math.max(...parts.map(p=>p.max.z))+offset.z+2;
  await w.load(current.scene,{...snap,player:{x,y:6,z,yaw:0,pitch:0}});
}
try{
  await a.load(original.scene,original.snapshot);let sourceState=await state(a);
  const entry=sourceState.library.find(m=>m.kind==='creation'&&m.name.includes('木门')),v1=await a.api('/api/modules/export?id='+entry.id+'&version=1');
  a.check('实际模型的门源码、参数、对象关系、依赖与检查用例已进入记忆',v1.format==='craftmine.module/2'&&v1.payload.scripts.length===1&&v1.payload.tests.events.includes('interact')&&v1.dependencies.includes('behavior@2'),v1);
  await b.api('/api/modules/import',v1);let destination=await state(b);
  await b.api('/api/modules/reuse',{version:destination.current,id:v1.id,moduleVersion:1,player:original.snapshot.player});await b.apply();destination=await state(b);
  const instanceId=destination.activeCreations[0],installed=destination.moduleBindings.creation[instanceId],runtimeId=installed.behaviors[0].world,objectId=installed.objects[0].world;
  b.check('第二个独立项目从记忆创建独立实例，源码逐字保留',(await build(b)).scene.behaviors[0].code===v1.payload.scripts[0].definition.code&&objectId!==v1.payload.objects[0].key);
  await aim(b,objectId);await b.game().locator('#interact').evaluate(el=>el.onclick());let snap=await b.snapshot();
  b.check('跨项目副本在新坐标实际开门，原始实例未被修改',snap.behaviors.modules[runtimeId].state.open&&!(await a.snapshot()).behaviors.modules[original.scene.behaviors[0].id].state.open,snap.behaviors);
  const edited=structuredClone(original.scene);edited.behaviors.find(d=>d.params.travel).params.travel=2.4;await a.load(edited,await a.snapshot());sourceState=await state(a);
  const v2=await a.api('/api/modules/export?id='+v1.id+'&version=2');await b.api('/api/modules/import',v2);
  a.check('改作生成 v2，旧 v1 源码与参数仍可复核',v2.payload.scripts[0].definition.params.travel===2.4&&canonicalJSON(await a.api('/api/modules/export?id='+v1.id+'&version=1'))===canonicalJSON(v1));
  b.check('导入新版不自动改写正在游玩的旧实例',(await build(b)).scene.behaviors[0].params.travel===1.8);
  await b.api('/api/creations/change',{version:(await state(b)).current,instanceId,moduleVersion:2});await b.apply();snap=await b.snapshot();
  b.check('切换指定实例版本保留身份、打开状态和既有偏移',(await build(b)).scene.behaviors[0].id===runtimeId&&snap.behaviors.modules[runtimeId].state.open&&snap.behaviors.modules[runtimeId].overrides[objectId].offset.x===-1.8);
  await aim(b,objectId);await b.game().locator('#interact').evaluate(el=>el.onclick());await aim(b,objectId);await b.game().locator('#interact').evaluate(el=>el.onclick());snap=await b.snapshot();
  b.check('新版源码参数在下一次真实互动中生效',snap.behaviors.modules[runtimeId].overrides[objectId].offset.x===-2.4,snap.behaviors);
  await b.api('/api/creations/change',{version:(await state(b)).current,instanceId,moduleVersion:1});await b.apply();const beforeUninstall=(await state(b)).current;
  b.check('回退模块版本仍保留兼容的开门状态',(await build(b)).scene.behaviors[0].params.travel===1.8&&(await b.snapshot()).behaviors.modules[runtimeId].state.open);
  await b.api('/api/creations/change',{version:beforeUninstall,instanceId,moduleVersion:null});await b.apply();snap=await b.snapshot();
  b.check('卸载移除整个创作并保存可恢复的玩法进度',!(await build(b)).scene.objects.length&&!Object.keys(snap.behaviors.modules).length&&snap.behaviors.archive.some(e=>e.id===runtimeId&&e.record.state.open));
  await b.api('/api/rollback',{id:beforeUninstall});await b.apply();snap=await b.snapshot();
  b.check('恢复历史世界时找回已卸载实例的状态与偏移',snap.behaviors.modules[runtimeId].state.open&&snap.behaviors.modules[runtimeId].overrides[objectId].offset.x===-2.4);
  await b.api('/api/save',{version:(await state(b)).current,snapshot:snap});await b.close();await b.start();
  b.check('重启后模块身份、旧版本和运行进度均保留',(await b.snapshot()).behaviors.modules[runtimeId].state.open&&(await b.api('/api/modules/export?id='+v1.id+'&version=1')).hash===v1.hash);
  const malicious=structuredClone(v2);malicious.version=3;malicious.payload.scripts[0].definition.code='export function step(){while(true){}}';malicious.hash=createHash('sha256').update(canonicalJSON({kind:'creation',payload:malicious.payload})).digest('hex');let rejected='';try{await b.api('/api/modules/import',malicious);}catch(e){rejected=e.message;}
  b.check('即使模块哈希正确，失控源码也不能导入本地记忆',rejected.includes('后台检查')&&(await state(b)).library.find(m=>m.id===v1.id).latest===2,rejected);
  const memory=new ModuleLibrary(path.join(b.dir,'project'),()=>{throw Error('Fixture placement must not write');}),beforeCopies=await state(b);
  let pair=memory.instantiate(beforeCopies,EMPTY_SCENE,v1.id,1,original.snapshot.player);
  pair=memory.instantiate(beforeCopies,pair,v1.id,1,original.snapshot.player);await b.load(pair,INITIAL_SNAPSHOT);
  const [first,second]=pair.behaviors;await aim(b,first.targets[0]);await b.game().locator('#interact').evaluate(el=>el.onclick());snap=await b.snapshot();
  b.check('同一候选里复用两个实例，第一扇门互动不改变第二扇门',snap.behaviors.modules[first.id].state.open&&!snap.behaviors.modules[second.id].state.open);
  await aim(b,second.targets[0]);await b.game().locator('#interact').evaluate(el=>el.onclick());snap=await b.snapshot();
  b.check('自动放置为源码的已知活动范围留出空间，两扇门都能打开',pair.behaviors.every(d=>snap.behaviors.modules[d.id].state.open&&!snap.behaviors.modules[d.id].error),snap.behaviors);
  await b.saveScreenshot('portable-door-memory');b.check('全过程没有获取鼠标锁定或页面异常',await b.game().locator('body').evaluate(()=>document.pointerLockElement===null)&&b.errors.length===0&&a.errors.length===0,[...a.errors,...b.errors]);
}catch(error){b.errors.push(error.stack);console.error(error);process.exitCode=1;}finally{await Promise.all([a.close(),b.close()]);console.log('Source report: '+path.join(a.dir,'report.json'));console.log('Target report: '+path.join(b.dir,'report.json'));}
