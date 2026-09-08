import fs from 'node:fs';
import path from 'node:path';
import { workbench } from './workbench.mjs';
import { EMPTY_SCENE,INITIAL_SNAPSHOT } from '../app/scene.mjs';
const w=await workbench('live-creation'),example=JSON.parse(fs.readFileSync('examples/door-and-bounce.save.json','utf8'));
try{
  await w.load(example.scene,example.snapshot);const entry=(await w.api('/api/state')).library.find(m=>m.kind==='creation'&&m.name.includes('木门')),module=await w.api('/api/modules/export?id='+entry.id+'&version=1');
  await w.load(EMPTY_SCENE,INITIAL_SNAPSHOT);
  const ready=await w.request('我们以前做过一扇能互动开关的木滑门，现在这个世界是空的。请从创作记忆里把那扇门复用回来，放在前方。我要保留原有的代码和参数，不重新设计或改写，也不要加弹跳板。');
  const task=ready.tasks.at(-1),build=await w.api('/api/build?id='+ready.candidate.id),d=build.scene.behaviors[0];
  w.check('真实模型检索并引用空白世界之外的完整创作记忆',task.memories.some(m=>m.id===module.id)&&task.usedModules.some(m=>m.id===module.id)&&d.binding.source.id===module.id,task);
  w.check('记忆复用保留原始源码与参数，由宿主创建新身份',d.code===module.payload.scripts[0].definition.code&&JSON.stringify(d.params)===JSON.stringify(module.payload.scripts[0].definition.params)&&d.targets[0]!==module.payload.objects[0].key&&build.scene.behaviors.length===1);
  await w.apply();let snap=await w.snapshot();const parts=build.primitives.filter(p=>p.id===d.targets[0]&&p.solid),player={x:(Math.min(...parts.map(p=>p.min.x))+Math.max(...parts.map(p=>p.max.x)))/2,y:6,z:Math.max(...parts.map(p=>p.max.z))+2,yaw:0,pitch:0};
  await w.load(build.scene,{...snap,player});await w.game().locator('#interact').evaluate(el=>el.onclick());snap=await w.snapshot();
  w.check('通过自然语言复用的实例可以实际开门',snap.behaviors.modules[d.id].state.open===true,snap.behaviors);
  const record=(await w.api('/api/state')).library.find(m=>m.id===module.id);
  w.check('验证记录与观察到的活动范围保存在本机记忆',record.verifications['1'].passed&&record.verifications['1'].hash===module.hash&&record.verifications['1'].bounds.min.x< -1,record.verifications);
  await w.saveScreenshot('remembered-door');w.check('没有鼠标锁定或浏览器异常',await w.game().locator('body').evaluate(()=>document.pointerLockElement===null)&&!w.errors.length,w.errors);
}catch(error){w.errors.push(error.stack);console.error(error);process.exitCode=1;}finally{await w.close();console.log('Report: '+path.join(w.dir,'report.json'));}
