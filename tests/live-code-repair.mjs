import fs from 'node:fs';
import path from 'node:path';
import { workbench } from './workbench.mjs';
const source=process.argv[2];if(!source)throw Error('请提供已生成的 model-build.json 路径');
const original=JSON.parse(fs.readFileSync(source,'utf8'));
const w=await workbench('live-code-repair');
try{
  const door=original.behaviors.find(b=>b.definition.permissions.includes('objects.write')),id=door.definition.targets[0],parts=original.primitives.filter(p=>p.id===id&&p.solid);
  const point={x:(Math.min(...parts.map(p=>p.min.x))+Math.max(...parts.map(p=>p.max.x)))/2,y:6,z:Math.max(...parts.map(p=>p.max.z))+2,yaw:0,pitch:0};
  await w.load(original.scene,{format:'craftmine.progress/1',player:point});await w.game().locator('#interact').evaluate(el=>el.onclick());
  const before=await w.snapshot();w.check('真实模型的门源码已经打开门',before.behaviors.modules[door.definition.id].state.open===true,before.behaviors);
  const state=await w.request('门板现在悬空了，门把手和下方横条也没贴好。请修复木门外观：每个部件的 offset 是最小角，不是中心，门板底部应在地面 y=6。横条与把手应贴在门板可见一侧。保持两种玩法的源码、参数、ID、stateVersion 和弹跳板完全不变，只调整木门的几何部件，不移动门的对象原点。');
  const repaired=await w.api('/api/build?id='+state.candidate.id);fs.writeFileSync(path.join(w.dir,'model-build.json'),JSON.stringify(repaired,null,2));
  w.check('模型收到视觉反馈后修正门底部，同时保留两份源码',Math.min(...repaired.primitives.filter(p=>p.id===id&&p.solid).map(p=>p.min.y))===6&&JSON.stringify(repaired.scene.behaviors)===JSON.stringify(original.scene.behaviors));
  await w.apply();const after=await w.snapshot();
  w.check('应用外观修改保留门的打开状态、偏移和玩家位置',after.behaviors.modules[door.definition.id].state.open===true&&JSON.stringify(after.behaviors.modules[door.definition.id].overrides)===JSON.stringify(before.behaviors.modules[door.definition.id].overrides)&&JSON.stringify(after.player)===JSON.stringify(before.player),after);
  await w.saveScreenshot('repaired-model-world');
  const probe=await w.page.context().newPage();await probe.goto(new URL('/verify',w.page.url()).href);
  const physics=await probe.frameLocator('iframe').locator('body').evaluate(async(_,{build,id})=>{
    const {makeWorldRuntime}=await import('/app/world-runtime.mjs');const Runtime=makeWorldRuntime({send:()=>{},inform:()=>{},enter:document.getElementById('enter')});
    const engine=new Runtime(document.getElementById('world'),{onTarget:()=>{},onStats:()=>{},onNotice:()=>{},onControl:()=>{}});
    const box=primitives=>({min:{x:Math.min(...primitives.map(p=>p.min.x)),y:Math.min(...primitives.map(p=>p.min.y)),z:Math.min(...primitives.map(p=>p.min.z))},max:{x:Math.max(...primitives.map(p=>p.max.x)),y:Math.max(...primitives.map(p=>p.max.y)),z:Math.max(...primitives.map(p=>p.max.z))}});
    const aim=b=>({x:(b.min.x+b.max.x)/2,y:6,z:b.max.z+2,yaw:0,pitch:0});
    try{
      const doorBox=box(build.primitives.filter(p=>p.id===id&&p.solid));engine.setActive(false);await engine.generateBuild(build,{player:aim(doorBox)});
      const center={x:(doorBox.min.x+doorBox.max.x)/2,z:(doorBox.min.z+doorBox.max.z)/2},closed=engine.collision(center.x,6,center.z);
      await engine.interact();const open=!engine.collision(center.x,6,center.z),moved=box(engine.primitives.filter(p=>p.id===id&&p.solid));engine.p=aim(moved);await engine.interact();const closedAgain=engine.collision(center.x,6,center.z);
      const pad=build.behaviors.find(b=>b.definition.permissions.includes('player.motion')).definition.targets[0],padBox=box(engine.primitives.filter(p=>p.id===pad&&p.solid));
      engine.p={x:(padBox.min.x+padBox.max.x)/2,y:padBox.max.y,z:(padBox.min.z+padBox.max.z)/2,yaw:0,pitch:0};engine.input=true;engine.vy=0;let peak=engine.p.y,launches=0;
      for(let i=0;i<110;i++){const oldVy=engine.vy;engine.update(1/60,i*1000/60);await engine.behaviors.flush();if(engine.vy>8&&oldVy<=0)launches++;peak=Math.max(peak,engine.p.y);}
      return {closed,open,closedAgain,launches,rise:peak-padBox.max.y,failures:engine.behaviors.failures,mouse:document.pointerLockElement};
    }finally{engine.dispose();}
  },{build:repaired,id});await probe.close();
  w.check('真实模型的木门可以打开通行，再关闭阻挡',physics.closed&&physics.open&&physics.closedAgain,physics);
  w.check('真实模型的弹跳源码让玩家升高约三米并有冷却',physics.rise>2.7&&physics.rise<3.3&&physics.launches>=1&&physics.launches<=2&&physics.failures.length===0&&physics.mouse===null,physics);
  await w.api('/api/save',{version:(await w.api('/api/state')).current,snapshot:after});await w.close();await w.start();const restored=await w.snapshot();
  w.check('代码世界重启后仍保留修正后的外观与开门进度',restored.behaviors.modules[door.definition.id].state.open===true&&(await w.api('/api/build?id='+(await w.api('/api/state')).current)).hash===repaired.hash);
  w.check('浏览器无异常',w.errors.length===0,w.errors);
}catch(error){w.errors.push(error.stack);console.error(error);process.exitCode=1;}finally{await w.close();console.log('Report: '+path.join(w.dir,'report.json'));}
