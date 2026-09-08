import fs from 'node:fs';
import path from 'node:path';
import { workbench } from './workbench.mjs';
const w=await workbench('live-code');
try{
  let state=await w.request('在我前方做一扇能按 E 开关的木滑门：开门时向旁边移开一米多并能走过去，再互动关上。门旁边隔开几米放一个青绿色弹跳板，踩上去弹高约三米，要有短暂冷却。请真正编写这两种交互的玩法代码，位置要方便试玩，门不要挡住弹跳板。');
  const task=state.tasks.at(-1),build=await w.api('/api/build?id='+state.candidate.id);fs.writeFileSync(path.join(w.dir,'model-build.json'),JSON.stringify(build,null,2));
  w.check('真实模型输出源码，候选有实际后台验证记录',build.behaviors.length>=2&&task.behaviorVerification.length>=2&&task.behaviorVerification.every(c=>c.passed),task);
  await w.apply();const snapshot=await w.snapshot();
  w.check('模型源码随候选真正载入世界并保存模块状态',snapshot.format==='craftmine.progress/3'&&Object.keys(snapshot.behaviors.modules).length>=2,snapshot.behaviors);
  await w.saveScreenshot('model-world');
  w.check('真实生成与后台检查未获取鼠标锁定',await w.game().locator('body').evaluate(()=>document.pointerLockElement===null));
  w.check('模型代码世界没有浏览器异常',w.errors.length===0,w.errors);
}catch(error){w.errors.push(error.stack);console.error(error);process.exitCode=1;}finally{await w.close();console.log('Report: '+path.join(w.dir,'report.json'));}
