import fs from 'node:fs';
import path from 'node:path';
import { workbench } from './workbench.mjs';

const w=await workbench('creation-ui');
try{
  const original=JSON.parse(fs.readFileSync('examples/door-and-bounce.save.json','utf8'));await w.load(original.scene,original.snapshot);
  await w.domClick('[data-view="assets"]');
  w.check('记忆库明确显示包含源码的完整创作卡片',await w.page.locator('#memory-list .module-card').filter({hasText:'完整创作 · 含源码'}).count()===2);
  const instance=w.page.locator('#system-list .system-card').filter({hasText:'木门'}).filter({hasText:'完整创作'});
  w.check('实例提供固定版本选择、更新和卸载操作',await instance.locator('select option').count()===1&&await instance.locator('button').count()===2);
  await instance.evaluate(el=>el.scrollIntoView({block:'center'}));await w.saveScreenshot('creation-version-controls');
  await w.page.setViewportSize({width:900,height:800});
  w.check('窄窗口中的记忆和版本管理没有横向溢出',await w.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const before=await w.api('/api/state');
  await instance.locator('button').filter({hasText:'卸载'}).evaluate(el=>el.onclick());await w.page.locator('#candidate').waitFor({state:'visible'});
  w.check('从界面卸载先形成候选，当前世界仍未改变',(await w.api('/api/state')).current===before.current);
  await w.apply();const after=await w.api('/api/state');
  w.check('应用后只卸载所选完整创作，弹跳板仍在世界里',after.activeCreations.length===1&&(await w.api('/api/build?id='+after.current)).scene.behaviors[0].name.includes('弹跳'));
  w.check('后台界面验收没有鼠标锁定或页面异常',await w.game().locator('body').evaluate(()=>document.pointerLockElement===null)&&!w.errors.length,w.errors);
}catch(error){w.errors.push(error.stack);console.error(error);process.exitCode=1;}finally{await w.close();console.log('Report: '+path.join(w.dir,'report.json'));}
