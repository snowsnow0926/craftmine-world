// No native input, Pointer Lock, window focus, or use of the user's browser.
import path from 'node:path';
import { workbench } from './workbench.mjs';
import { floraScene,gameplayScene } from './scene-fixtures.mjs';
import { INITIAL_SNAPSHOT,clone } from '../app/scene.mjs';
const w=await workbench('background-browser');
try{
  w.check('后台测试已禁用鼠标锁定',await w.game().locator('canvas').evaluate(c=>document.pointerLockElement===null&&c.requestPointerLock.toString().includes('disabled')));
  const scene=gameplayScene();await w.load(scene,INITIAL_SNAPSHOT);
  w.check('细粒度植物与玩法在独立 WebGL 窗口载入',(await w.api('/api/build?id='+(await w.api('/api/state')).current)).primitives.some(p=>p.shape==='blade')&&await w.game().locator('#health-hud').isVisible());
  await w.domClick('[data-view="assets"]');
  let state=await w.api('/api/state');const module=state.library.find(m=>m.name==='粉色野花'),before=state.tasks.length;
  await w.page.evaluate(id=>{const card=document.querySelector(`[data-module-id="${id}"]`);[...card.querySelectorAll('button')].find(b=>b.textContent.includes('复用到世界')).click();},module.id);
  await w.apply();state=await w.api('/api/state');const reused=(await w.api('/api/build?id='+state.current)).scene;
  w.check('页面脚本调用复用按钮生成候选并加载实际副本',reused.objects.length===scene.objects.length+1&&reused.objects.at(-1).source.id===module.id&&state.tasks.length===before);
  const original=clone(reused.objects);await w.domClick('[data-view="assets"]');await w.saveScreenshot('01-memory');
  const exported=await w.api('/api/modules/export?id='+module.id+'&version=1');w.check('导出数据含校验哈希、版本、实际几何',exported.hash.length===64&&exported.version===1&&exported.payload.parts.length>1);
  // Invalid module payload must not mutate the project.
  const bad=clone(exported);bad.payload.parts[0].size.y=400;
  await w.api('/api/modules/import',bad).then(()=>{throw Error('Invalid module accepted');},()=>{});
  w.check('非法模块导入不会改变当前世界',(await w.api('/api/state')).current===state.current);
  const fixture=floraScene(),pose={...clone(INITIAL_SNAPSHOT),player:{...INITIAL_SNAPSHOT.player,z:11,pitch:-.3}};
  await w.load(fixture,pose);await w.saveScreenshot('02-flora');
  const partial={format:'craftmine.progress/2',player:clone(INITIAL_SNAPSHOT.player),gameplay:{systems:{'system-health':{type:'health',health:73,maxHealth:100},'system-ranged':{type:'ranged',ammo:1,reloadRemaining:0},'system-melee':{type:'melee'}},targets:{'target-one':{health:35,maxHealth:60}},equipped:'ranged'}};
  await w.load(scene,partial);await w.saveScreenshot('03-gameplay');
  const beforeFailure=await w.api('/api/state');
  const failScene=clone(scene);failScene.title='候选故障注入';await w.api('/api/import',{format:'craftmine.save/1',scene:failScene,snapshot:partial});
  state=await w.api('/api/state');const candidate=state.candidate;
  await w.page.route('**/api/build?id='+candidate.id,route=>route.fulfill({contentType:'application/json',body:JSON.stringify({id:candidate.id,scene:null})}));
  await w.page.locator('#candidate').waitFor({state:'visible'});await w.domClick('#apply');await w.page.waitForFunction(()=>document.getElementById('toast').textContent.includes('已回到原世界'));
  const aborted=await w.api('/api/state');w.check('候选载入失败保住世界与玩法进度',aborted.current===beforeFailure.current&&aborted.snapshot.gameplay.systems['system-health'].health===73&&!aborted.applying);
  await w.page.unroute('**/api/build?id='+candidate.id);await w.api('/api/discard',{});
  await w.page.waitForTimeout(3200);await w.close();await w.start();const restored=await w.snapshot();
  w.check('后台重启验证血量、弹药和目标进度持久化',restored.gameplay.systems['system-health'].health===73&&restored.gameplay.systems['system-ranged'].ammo===1&&restored.gameplay.targets['target-one'].health===35);
  // Pure logic can be imported in the sandboxed browser without injecting input.
  const behavior=await w.game().locator('body').evaluate(async()=>{const {GameplaySession}=await import('/app/gameplay.mjs');const g=new GameplaySession([{id:'gun',name:'枪',type:'ranged',source:null,config:{damage:20,range:30,cooldown:.2,magazine:3,reloadSeconds:.5}}],[{id:'dummy',components:{health:50}}]);g.attack({id:'dummy',distance:5});return g.snapshot();});
  w.check('真实浏览器模块执行射击逻辑，无鼠标键盘输入',behavior.targets.dummy.health===30&&behavior.systems.gun.ammo===2);
  const isolated=await w.game().locator('body').evaluate(()=>{try{parent.document.body;return false;}catch{return true;}});w.check('玩法窗口仍与工作台隔离',isolated);
  w.check('后台验收无浏览器异常和桌面溢出',w.errors.length===0&&await w.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),w.errors);
}catch(error){w.errors.push(error.stack);console.error(error);process.exitCode=1;}finally{await w.close();console.log('Report: '+path.join(w.dir,'report.json'));}
