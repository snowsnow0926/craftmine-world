import path from 'node:path';
import { workbench } from './workbench.mjs';
import { behaviorScene } from './behavior-fixtures.mjs';
import { verifyBehaviors } from '../app/behavior-verify.mjs';
import { compileScene } from '../app/scene.mjs';
const w=await workbench('code-world');
const spawn={format:'craftmine.progress/1',player:{x:0,y:6,z:10,yaw:0,pitch:0}};
try{
  const build=compileScene(behaviorScene()),verification=await verifyBehaviors(build,{origin:new URL(w.page.url()).origin});
  w.check('候选后台检查实际运行两种源码和状态恢复',verification.passed,verification);
  await w.load(behaviorScene(),spawn);
  await w.game().locator('#interact').evaluate(el=>el.onclick());
  let saved=await w.snapshot();
  w.check('游戏内互动触发源码，门的开关和位置状态已改变',saved.format==='craftmine.progress/3'&&saved.behaviors.modules['sliding-door'].state.open&&saved.behaviors.modules['sliding-door'].overrides['door-one'].offset.x===1.2,saved.behaviors);
  await w.api('/api/save',{version:(await w.api('/api/state')).current,snapshot:saved});
  await w.close();await w.start();saved=await w.snapshot();
  w.check('重启服务与世界后保留门的打开状态和对象变化',saved.behaviors.modules['sliding-door'].state.open&&saved.behaviors.modules['sliding-door'].overrides['door-one'].solid===false);
  const previous=(await w.api('/api/state')).current,incompatible=behaviorScene();incompatible.behaviors[0].stateVersion=2;
  await w.api('/api/import',{format:'craftmine.save/1',scene:incompatible,snapshot:saved});await w.page.locator('#candidate').waitFor({state:'visible'});await w.domClick('#apply');
  await w.page.waitForFunction(()=>document.getElementById('toast').textContent.includes('需要迁移状态'),{},{timeout:10000});
  const rejectedState=await w.api('/api/state');
  w.check('不兼容代码更新中止应用事务，保住最新开门状态和候选',rejectedState.current===previous&&!rejectedState.applying&&rejectedState.candidate&&rejectedState.snapshot.behaviors.modules['sliding-door'].state.open);
  await w.api('/api/discard',{});
  const probe=await w.page.context().newPage();await probe.goto(new URL('/verify',w.page.url()).href);
  const physics=await probe.frameLocator('iframe').locator('body').evaluate(async(_,{build,spawn})=>{
    const {makeWorldRuntime}=await import('/app/world-runtime.mjs');
    const notices=[],Runtime=makeWorldRuntime({send:()=>{},inform:text=>notices.push(text),enter:document.getElementById('enter')});
    const engine=new Runtime(document.getElementById('world'),{onTarget:()=>{},onStats:()=>{},onNotice:()=>{},onControl:()=>{}});
    try{
      engine.setActive(false);await engine.generateBuild(build,spawn);
      const closed=engine.collision(0,6,7);await engine.interact();const open=!engine.collision(0,6,7);
      const visibleMoved=engine.primitives.find(p=>p.id==='door-one').min.x===.7&&engine.meshes.has('object:door-one');
      engine.p={x:3,y:6.15,z:7,yaw:0,pitch:0};engine.input=true;engine.vy=0;let highest=engine.p.y;
      for(let i=0;i<80;i++){engine.update(1/60,i*1000/60);await engine.behaviors.flush();highest=Math.max(highest,engine.p.y);}
      engine.render(2);return {closed,open,visibleMoved,highest,bounces:engine.behaviors.data.value.modules['spring-pad'].state.bounces,errors:engine.behaviors.failures,mouse:document.pointerLockElement,notices};
    }finally{engine.dispose();}
  },{build,spawn});await probe.close();
  w.check('门源码同时改变实际渲染几何和碰撞',physics.closed&&physics.open&&physics.visibleMoved,physics);
  w.check('接触弹跳板触发真实物理上升，游戏无需鼠标锁定',physics.highest>8.5&&physics.bounces>=1&&physics.mouse===null&&physics.errors.length===0,physics);
  const bad=behaviorScene();bad.behaviors[0].code='export function step(){while(true){}}';const rejected=await verifyBehaviors(compileScene(bad),{origin:new URL(w.page.url()).origin});
  w.check('后台发现死循环并拒绝该代码，另一个模块仍完成检查',!rejected.passed&&!rejected.modules[0].passed&&rejected.modules[1].passed,rejected);
  let importError='';try{await w.api('/api/import',{format:'craftmine.save/1',scene:bad,snapshot:saved});}catch(error){importError=error.message;}
  w.check('导入的失控源码不能形成世界候选',importError.includes('后台检查')&&!(await w.api('/api/state')).candidate,importError);
  w.check('后台验证不改变正在游玩的项目',(await w.snapshot()).behaviors.modules['sliding-door'].state.open);
  await w.saveScreenshot('door-world');w.check('浏览器无未处理异常',w.errors.length===0,w.errors);
}catch(error){w.errors.push(error.stack);console.error(error);process.exitCode=1;}finally{await w.close();console.log('Report: '+path.join(w.dir,'report.json'));}
