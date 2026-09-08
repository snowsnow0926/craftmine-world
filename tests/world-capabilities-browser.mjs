import path from 'node:path';
import fs from 'node:fs';
import { workbench } from './workbench.mjs';
import { capable,capabilityScene } from './world-capabilities-fixtures.mjs';
import { compileScene,EMPTY_SCENE,INITIAL_SNAPSHOT } from '../app/scene.mjs';
import { verifyBehaviors } from '../app/behavior-verify.mjs';

const w=await workbench('world-capabilities');let other;
try{
  const scene=capabilityScene(),build=compileScene(scene),report=await verifyBehaviors(build,{origin:new URL(w.page.url()).origin});
  w.check('新增能力源码通过真实 Worker 事件和恢复检查',report.passed,report);
  const raceScene={...scene,behaviors:['z-first','a-second'].map(id=>capable(id,{capabilities:['inventory.read@1'],permissions:['inventory.write'],code:`export function step({frame,state}){if(frame.event.type!=='tick')return {state,commands:[]};if((frame.inventory.wood||0)<3)return {state:{waiting:true},commands:[]};return {state:{crafted:true},commands:[{type:'inventory.add',item:'wood',count:-3}]}}`}))};
  raceScene.behaviors.push({format:'craftmine.behavior/1',id:'legacy',name:'旧接口',description:'旧源码不接收库存',stateVersion:1,initialState:{},params:{},targets:[],permissions:[],code:'export function step({frame,state}){if("inventory" in frame)throw Error("旧接口不应收到库存");return {state,commands:[]}}'});
  const probe=await w.page.context().newPage();await probe.goto(new URL('/verify',w.page.url()).href);
  const result=await probe.frameLocator('iframe').locator('body').evaluate(async(_,{build,raceBuild,spawn})=>{
    const {BehaviorSession}=await import('/app/behavior-session.mjs');let session;
    const context=()=>({player:{position:{x:0,y:6,z:15},grounded:true,health:null},objects:[]});
    session=new BehaviorSession(raceBuild,null,{context,apply:()=>{}});session.data.value.inventory.wood=3;
    await session.start();await session.execute({type:'tick',targetId:null},.1,true);const race=session.snapshot(),raceErrors=session.failures;session.dispose();
    const {makeWorldRuntime}=await import('/app/world-runtime.mjs'),notices=[];
    const Runtime=makeWorldRuntime({send:()=>{},inform:text=>notices.push(text),enter:document.getElementById('enter')});
    const engine=new Runtime(document.getElementById('world'),{onTarget:()=>{},onStats:()=>{},onNotice:()=>{},onControl:()=>{}});
    try{
      engine.setActive(false);await engine.generateBuild(build,spawn);engine.inspectObject('door-one');const closed=engine.collision(0,6,7);
      await engine.interact();const insufficient=notices.at(-1),before=engine.behaviors.snapshot();
      engine.inspectObject('pad-one');for(let i=0;i<3;i++)await engine.interact();const collected=engine.behaviors.snapshot();
      engine.inspectObject('door-one');await engine.interact();const crafted=engine.behaviors.snapshot(),open=!engine.collision(0,6,7);
      for(let i=0;i<4;i++)await engine.interact();engine.render(1);
      return {race,raceErrors,closed,insufficient,before,collected,crafted,open,snapshot:{format:'craftmine.progress/3',player:{...engine.p},gameplay:engine.play.snapshot(),behaviors:engine.behaviors.snapshot()},failures:engine.behaviors.failures,locked:document.pointerLockElement!==null};
    }finally{engine.dispose();}
  },{build,raceBuild:compileScene(raceScene),spawn:INITIAL_SNAPSHOT});await probe.close();
  fs.writeFileSync(path.join(w.dir,'runtime-evidence.json'),JSON.stringify(result,null,2));
  w.check('两个配方依场景顺序读取最新库存，只有第一个消耗，另一个正常等待',result.race.modules['z-first'].state.crafted&&result.race.modules['a-second'].state.waiting&&!result.race.inventory.wood&&!result.raceErrors.length,result.race);
  w.check('旧源码不收到新增库存上下文',!result.race.modules.legacy.error);
  w.check('材料不足是正常提示，门仍有碰撞且源码未停止',result.closed&&result.insufficient.includes('需要 3 份木材')&&!result.before.modules.crafter.error&&!result.before.inventory['made-door']);
  w.check('真实交互收集三份材料，任务读取同一事件里已提交的库存',result.collected.inventory.wood===3&&result.collected.modules.quest.panels.main.lines[0].includes('3 / 3'),result.collected);
  w.check('Worker 改写自己的库存快照不会给宿主凭空添加物品',!result.collected.inventory.unauthorized);
  w.check('制作消耗材料并实际开门，任务发放一次奖励',result.open&&!result.crafted.inventory.wood&&result.crafted.inventory['made-door']===1&&result.crafted.inventory.token===1&&result.crafted.modules.quest.state.rewarded,result.crafted);
  w.check('重复开关门不重复扣料或发奖，全部源码继续运行',result.snapshot.behaviors.inventory.token===1&&!result.failures.length&&!result.locked);
  await w.load(scene,result.snapshot);
  w.check('背包显示物品名称和说明，任务显示持久进度',await w.game().locator('#inventory-hud').innerText().then(t=>t.includes('纪念币')&&t.includes('已制木门'))&&await w.game().locator('[data-item="token"]').getAttribute('title')==='制作任务的一次性奖励'&&await w.game().locator('#task-hud').innerText().then(t=>t.includes('任务完成')));
  await w.saveScreenshot('completed-quest');
  await w.api('/api/save',{version:(await w.api('/api/state')).current,snapshot:await w.snapshot()});await w.close();await w.start();
  w.check('重启后中文物品定义、任务面板与一次性奖励完整恢复',(await w.snapshot()).behaviors.inventory.token===1&&await w.game().locator('#task-hud').innerText().then(t=>t.includes('任务完成'))&&(await w.snapshot()).behaviors.items.wood.name==='木材');
  await w.game().locator('#interact').evaluate(el=>el.onclick());
  w.check('重启后的实际开门继续可用，奖励不重复',(await w.snapshot()).behaviors.inventory.token===1&&!(await w.snapshot()).behaviors.modules.crafter.error);
  await w.api('/api/save',{version:(await w.api('/api/state')).current,snapshot:await w.snapshot()});const exported=await w.api('/api/export'),sourceState=await w.api('/api/state'),ref=sourceState.library.find(m=>m.kind==='creation'),module=await w.api('/api/modules/export?id='+ref.id+'&version='+ref.latest);
  w.check('记忆导出声明新运行版本并包含三份原始源码',module.format==='craftmine.module/4'&&module.runtime==='craftmine-web/5'&&module.payload.scripts.length===3&&module.dependencies.includes('hud.panel@1'));
  other=await workbench('world-capabilities-target');await other.api('/api/import',exported);await other.apply();
  other.check('完整存档在第二项目恢复任务和共享背包',(await other.snapshot()).behaviors.inventory.token===1&&await other.game().locator('#task-hud').innerText().then(t=>t.includes('任务完成')));
  await other.game().locator('#interact').evaluate(el=>el.onclick());other.check('第二项目能继续操作，原项目进度不随之改变',(await other.snapshot()).behaviors.modules.crafter.state.open!==exported.snapshot.behaviors.modules.crafter.state.open&&(await w.snapshot()).behaviors.modules.crafter.state.open===exported.snapshot.behaviors.modules.crafter.state.open);
  await other.load(EMPTY_SCENE,INITIAL_SNAPSHOT);await other.api('/api/modules/import',module);await other.api('/api/modules/reuse',{version:(await other.api('/api/state')).current,id:module.id,moduleVersion:module.version,player:INITIAL_SNAPSHOT.player});await other.apply();
  const installed=await other.api('/api/state'),runtime=await other.snapshot(),activeId=installed.activeCreations[0],bindings=installed.moduleBindings.creation[activeId],questId=bindings.behaviors.find(p=>p.local==='quest').world;
  other.check('从空白世界复用源码模块，任务重新开始且物品定义自动注册',!runtime.behaviors.inventory.token&&!runtime.behaviors.modules[questId].state.rewarded&&runtime.behaviors.items.wood.name==='木材'&&await other.game().locator('#task-hud').innerText().then(t=>t.includes('0 / 3')));
  const beforeUninstall=installed.current;await other.api('/api/creations/change',{version:beforeUninstall,instanceId:activeId,moduleVersion:null});await other.apply();
  other.check('卸载隐藏该创作面板，任务进度归档，物品定义保留',await other.game().locator('#task-hud').isHidden()&&(await other.snapshot()).behaviors.archive.some(e=>e.id===questId&&e.record.panels.main)&&(await other.snapshot()).behaviors.items.wood.name==='木材');
  await other.api('/api/rollback',{id:beforeUninstall});await other.apply();
  other.check('恢复创作找回同一面板和状态，没有无故完成任务',(await other.snapshot()).behaviors.modules[questId].panels.main.title==='第一扇门'&&!(await other.snapshot()).behaviors.modules[questId].state.rewarded);
  const literal=structuredClone(exported);literal.snapshot.behaviors.items.token.name='<img src=x onerror=alert(1)>';
  // Suppress the fixture's start panel update to inspect the restored literal text.
  literal.scene.behaviors.find(d=>d.id==='quest').code=literal.scene.behaviors.find(d=>d.id==='quest').code.replace("['start','interact']","['interact']");
  literal.snapshot.behaviors.modules.quest.panels.main.title='<script>bad()</script>';await other.api('/api/import',literal);await other.apply();
  other.check('物品和任务内容只作为文字绘制，不能生成 HTML 元素',await other.game().locator('#task-hud h2').innerText()==='<script>bad()</script>'&&await other.game().locator('[data-item="token"] span').innerText()==='<img src=x onerror=alert(1)>'&&await other.game().locator('#task-hud script,#inventory-hud img').count()===0);
  await other.page.setViewportSize({width:740,height:820});const layout=await other.game().locator('body').evaluate(()=>{const r=document.getElementById('task-hud').getBoundingClientRect(),i=document.getElementById('inventory-hud').getBoundingClientRect();return {width:innerWidth,height:innerHeight,task:{x:r.x,y:r.y,right:r.right,bottom:r.bottom},inventory:{x:i.x,y:i.y,right:i.right,bottom:i.bottom},overflow:document.documentElement.scrollWidth>innerWidth,lock:document.pointerLockElement!==null};});
  other.check('窄世界窗口内任务与背包保持可见且没有横向溢出',!layout.overflow&&!layout.lock&&layout.task.x>=0&&layout.task.right<=layout.width&&layout.inventory.x>=0&&layout.inventory.bottom<=layout.height,layout);await other.saveScreenshot('task-small-window');
  other.check('全部验证使用独立后台浏览器，没有页面异常',!other.errors.length&&!w.errors.length,[...w.errors,...other.errors]);
}catch(error){w.errors.push(error.stack);console.error(error);process.exitCode=1;}finally{await other?.close();await w.close();console.log('Report: '+path.join(w.dir,'report.json'));if(other)console.log('Target: '+path.join(other.dir,'report.json'));}
