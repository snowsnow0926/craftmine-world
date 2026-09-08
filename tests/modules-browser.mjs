import fs from 'node:fs';
import path from 'node:path';
import { workbench } from './workbench.mjs';
import { gameplayScene,floraScene } from './scene-fixtures.mjs';
import { INITIAL_SNAPSHOT,clone } from '../app/scene.mjs';
if(!process.argv.includes('--explicit-user-input-test'))throw Error('此历史测试包含真实输入。日常验证请运行 tests/background-browser.mjs。');
const w=await workbench('modules-browser');
const enter=async()=>{await w.game().locator('#enter').click();};
const fire=async()=>{await w.page.mouse.down();await w.page.mouse.up();await w.page.waitForTimeout(210);};
try{
  const scene=gameplayScene();await w.load(scene,INITIAL_SNAPSHOT);
  let state=await w.api('/api/state');
  w.check('对象与三个玩法应用后自动记忆',state.library.length===scene.objects.length+3);
  await enter();await w.page.keyboard.press('1');await fire();let snap=await w.snapshot();
  w.check('真实鼠标射击命中靶，扣除血量和弹药',snap.gameplay.targets['target-one'].health===40&&snap.gameplay.systems['system-ranged'].ammo===2);
  await fire();await fire();snap=await w.snapshot();w.check('靶被击破，目标状态归零',snap.gameplay.targets['target-one'].health===0);
  await w.page.keyboard.press('r');await w.page.waitForTimeout(400);w.check('R 换弹恢复弹匣',(await w.snapshot()).gameplay.systems['system-ranged'].ammo===3);
  await w.page.keyboard.press('Escape');
  const near={...clone(INITIAL_SNAPSHOT),player:{...INITIAL_SNAPSHOT.player,z:8}};await w.load(scene,near);await enter();await w.page.keyboard.press('2');await fire();
  w.check('真实近战输入只伤害近处目标',(await w.snapshot()).gameplay.targets['target-one'].health===35);
  await w.page.keyboard.press('Escape');
  // A solid wall blocks the target for ranged attacks.
  const blocked=clone(scene);blocked.objects.push({id:'wall',name:'遮挡墙',position:{x:0,y:6,z:9},source:null,components:{health:0,contactDamage:0},parts:[{shape:'box',offset:{x:0,y:0,z:0},size:{x:1,y:2,z:.2},material:'stone',color:'#ffffff',solid:true}]});
  await w.load(blocked,INITIAL_SNAPSHOT);await enter();await fire();w.check('墙体真实遮挡射击，不穿墙伤害目标',(await w.snapshot()).gameplay.targets['target-one'].health===60);await w.page.keyboard.press('Escape');
  // Walk straight through tiny flowers, with no invisible unit-cube obstacles.
  const flora=floraScene();await w.load(flora,{...clone(INITIAL_SNAPSHOT),player:{...INITIAL_SNAPSHOT.player,x:.275,pitch:-.24}});
  await enter();await w.page.keyboard.down('w');await w.page.waitForTimeout(1000);await w.page.keyboard.up('w');snap=await w.snapshot();w.check('可从花草间行走，没有整格隐形碰撞',snap.player.z<8.4&&Math.abs(snap.player.y-6)<.01);await w.page.keyboard.press('Escape');
  await w.load(flora,{...clone(INITIAL_SNAPSHOT),player:{...INITIAL_SNAPSHOT.player,z:11,pitch:-.3}});await w.saveScreenshot('01-flora');
  state=await w.api('/api/state');const memory=state.library.find(m=>m.name==='粉色野花'),version=memory.latest;
  const [download]=await Promise.all([w.page.waitForEvent('download'),(async()=>{await w.page.locator('[data-view="assets"]').click();const card=w.page.locator(`[data-module-id="${memory.id}"]`);await card.getByRole('button',{name:'导出',exact:true}).click();})()]);
  const file=path.join(w.dir,'exported-module.json');await download.saveAs(file);w.check('浏览器原生导出包含可运行定义与来源',JSON.parse(fs.readFileSync(file)).payload.parts.length>1);
  const card=w.page.locator(`[data-module-id="${memory.id}"]`);await card.getByRole('button',{name:'复用到世界 ↗'}).click();await w.apply();
  state=await w.api('/api/state');const copied=(await w.api('/api/build?id='+state.current)).scene;
  w.check('记忆库按钮直接复用固定版本，无新 LLM 任务',copied.objects.length===flora.objects.length+1&&copied.objects.at(-1).source.id===memory.id&&copied.objects.at(-1).source.version===version&&state.tasks.length===0);
  await w.page.locator('[data-view="assets"]').click();await w.saveScreenshot('02-memory');
  // Reload the runtime with a partial health / ammo state, then restart both processes.
  const partial={format:'craftmine.progress/2',player:clone(INITIAL_SNAPSHOT.player),gameplay:{systems:{'system-health':{type:'health',health:73,maxHealth:100},'system-ranged':{type:'ranged',ammo:1,reloadRemaining:0},'system-melee':{type:'melee'}},targets:{'target-one':{health:35,maxHealth:60}},equipped:'ranged'}};
  await w.load(scene,partial);await w.saveScreenshot('03-gameplay');await w.page.waitForTimeout(3500);await w.close();await w.start();snap=await w.snapshot();
  w.check('服务与浏览器重启保留血量、弹药、靶伤害和模块库',snap.gameplay.systems['system-health'].health===73&&snap.gameplay.systems['system-ranged'].ammo===1&&snap.gameplay.targets['target-one'].health===35&&(await w.api('/api/state')).library.length>=10);
  // A damage volume demonstrates real health loss and revive, without enemy AI.
  const hazard=clone(scene);hazard.objects.push({id:'damage-zone',name:'伤害测试区域',position:{x:-.5,y:6,z:11.5},source:null,components:{health:0,contactDamage:100},parts:[{shape:'box',offset:{x:0,y:0,z:0},size:{x:2,y:.06,z:2},material:'solid',color:'#cc7561',solid:false}]});
  await w.load(hazard,INITIAL_SNAPSHOT);await enter();await w.game().locator('#death').waitFor({state:'visible',timeout:6000});w.check('接触伤害真实扣血并进入死亡状态',(await w.snapshot()).gameplay.systems['system-health'].health===0);await w.game().locator('#revive').click();w.check('复活恢复生命值并保持世界定义',(await w.snapshot()).gameplay.systems['system-health'].health===100);
  w.check('新界面无 JavaScript 错误或横向溢出',w.errors.length===0&&await w.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),w.errors);
}catch(error){w.errors.push(error.stack);console.error(error);process.exitCode=1;}finally{await w.close();console.log('Report: '+path.join(w.dir,'report.json'));}
