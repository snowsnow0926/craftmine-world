import fs from 'node:fs';
import path from 'node:path';
import { workbench } from './workbench.mjs';
const mode=process.argv.includes('--live-cancel')?'live-cancel':process.argv.includes('--live')?'live':process.argv.includes('--cancel')?'cancel':'scripted';
const w=await workbench('repair-'+mode,{preload:'./tests/repair-fixture-provider.mjs',env:{CRAFTMINE_REPAIR_FIXTURE:mode}});
const read=()=>w.api('/api/state');
async function waitForTask(predicate,timeout=245000){const start=Date.now();while(Date.now()-start<timeout){const t=(await read()).tasks.at(-1);if(t&&predicate(t))return t;await new Promise(resolve=>setTimeout(resolve,150));}throw Error('Task observation timeout');}
try{
  const original=JSON.parse(fs.readFileSync('examples/door-and-bounce.save.json','utf8')),id=original.scene.objects[0].id,behaviorId=original.scene.behaviors[0].id;
  await w.load(original.scene,{...original.snapshot,player:{x:1.25,y:6,z:9.6,yaw:0,pitch:0}});
  const before=await read();await w.domClick('[data-view="assets"]');await w.page.locator('#object-list button').first().evaluate(el=>el.onclick());
  await w.page.evaluate(()=>{document.getElementById('prompt').value='这扇门打开以后通道还是有点窄，把它向左滑开的距离改为 2.4 米。保留现在的开关状态、外观和旁边的弹跳板。';document.getElementById('composer').requestSubmit();});
  const repairing=await waitForTask(t=>t.attempts?.length>=2||['failed','ready','cancelled'].includes(t.status));
  w.check('实际源码错误被检查发现，记录失败事件并自动开始第二次尝试',repairing.attempts.length>=2&&repairing.attempts[0].diagnostic.stage==='behavior'&&repairing.attempts[0].diagnostic.details[0].failedEvent==='interact:'+id,repairing.attempts);
  if(['cancel','live-cancel'].includes(mode)){
    if(mode==='live-cancel')process.kill(repairing.attempts.at(-1).testProviderPid,0);
    await w.api('/api/cancel',{});const cancelled=await waitForTask(t=>t.status==='cancelled');
    w.check('修复中可以取消，所有尝试停止且不产生候选',cancelled.attempts.length===2&&cancelled.attempts.at(-1).status==='cancelled'&&(await read()).candidate===null);
    w.check('取消后当前世界和位置保留',(await read()).current===before.current&&(await w.snapshot()).player.x===1.25);
    if(mode==='live-cancel'){let gone=false;try{process.kill(repairing.attempts.at(-1).testProviderPid,0);}catch(e){gone=e.code==='ESRCH';}w.check('取消真正结束了已确认存活的 Codex 执行进程',gone);}
  }else{
    await w.game().locator('#interact').evaluate(el=>el.onclick());const latest=await w.snapshot();await w.api('/api/save',{version:before.current,snapshot:latest});
    w.check('生成和修复期间旧世界仍可互动，并保存刚打开的门',latest.behaviors.modules[behaviorId].state.open===true&&(await read()).current===before.current);
    const ready=await waitForTask(t=>['ready','failed','cancelled'].includes(t.status));w.check('修复结果通过检查才形成候选',ready.status==='ready'&&ready.attempts.at(-1).status==='passed',ready);
    const bad=await w.api('/api/tasks/attempt?id='+ready.id+'&number=1'),good=await w.api('/api/tasks/attempt?id='+ready.id+'&number='+ready.attempts.length);
    w.check('首次失败源码、报错与修复后的源码都可查看',bad.response.scene.behaviors[0].code.includes('missingDoorMotion')&&bad.verification.passed===false&&good.verification.passed===true);
    if(mode==='live')w.check('修复阶段使用真实模型，记录实际用量',ready.attempts.slice(1).some(a=>a.usage?.output_tokens>0)&&ready.attempts[0].generator==='test-fixture');
    await w.apply();const updated=await read(),build=await w.api('/api/build?id='+updated.current),snap=await w.snapshot();
    w.check('应用修复保留最新开门状态与偏移，未重置旁边的规则',snap.behaviors.modules[behaviorId].state.open===true&&snap.behaviors.modules[behaviorId].overrides[id].offset.x===-1.8&&JSON.stringify(build.scene.behaviors[1])===JSON.stringify(original.scene.behaviors[1]));
    const pose={x:1.25-1.8,y:6,z:9.6,yaw:0,pitch:0};await w.load(build.scene,{...snap,player:pose});await w.game().locator('#interact').evaluate(el=>el.onclick());
    await w.load(build.scene,{...await w.snapshot(),player:{...pose,x:1.25}});await w.game().locator('#interact').evaluate(el=>el.onclick());const opened=await w.snapshot();
    w.check('修复后的源码实际再次开门，新距离为 2.4 米',opened.behaviors.modules[behaviorId].state.open&&Math.abs(opened.behaviors.modules[behaviorId].overrides[id].offset.x+2.4)<.001,opened.behaviors);
    await w.domClick('[data-view="develop"]');await w.page.locator('#task-list > article > details').first().evaluate(el=>el.open=true);
    const attempt=w.page.locator('.attempt-record').first();await attempt.evaluate(el=>el.open=true);await attempt.locator('button').evaluate(el=>el.onclick());
    w.check('界面展示每次失败的实际产物',await attempt.locator('pre').evaluate(el=>!el.hidden&&el.textContent.includes('missingDoorMotion')));
    await attempt.evaluate(el=>el.scrollIntoView({block:'center'}));await w.saveScreenshot('repair-records');
    await w.api('/api/save',{version:(await read()).current,snapshot:opened});await w.close();await w.start();
    w.check('重启后修复记录和最新玩法进度继续保留',(await read()).tasks.at(-1).attempts.length===ready.attempts.length&&(await w.snapshot()).behaviors.modules[behaviorId].state.open===true);
  }
  w.check('后台验证没有鼠标锁定或页面异常',await w.game().locator('body').evaluate(()=>document.pointerLockElement===null)&&!w.errors.length,w.errors);
}catch(error){w.errors.push(error.stack);console.error(error);process.exitCode=1;}finally{await w.close();console.log('Report: '+path.join(w.dir,'report.json'));}
