// Real Codex calls for both changes. The intervening discussion messages are
// explicitly synthetic window-pressure data and do not trigger model calls.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { workbench } from './workbench.mjs';
import { canonicalJSON } from '../app/canonical.mjs';
const w=await workbench('live-context'),read=()=>w.api('/api/state');
try{
  const example=JSON.parse(fs.readFileSync('examples/door-and-bounce.save.json','utf8')),door=example.scene.objects[0].id,behavior=example.scene.behaviors[0].id;
  await w.load(example.scene,{...example.snapshot,player:{x:1.25,y:6,z:9.6,yaw:0,pitch:0}});
  const notes=[{id:randomUUID(),text:'营地里的小野花花瓣统一用浅蓝色 #a8d8ef，茎叶保持绿色，小野花可以穿行。',objectId:null},{id:randomUUID(),text:'这扇门关闭时给玩家的提示是“营地已安静”，打开时仍能走过门口。保持手动开关。',objectId:door}];
  await w.api('/api/project-context',{revision:0,brief:'一个宁静的雨后营地。每次只处理当下所说的改变，保留其他事物和已有进度。',notes});
  const firstPrompt='给门旁添一株有细茎、几片叶子和花瓣的野花，体量小一点，让入口有点生机，别挡路。只新增这株植物，原有物体和源码都保持原样。';
  const first=await w.request(firstPrompt),firstTask=first.tasks.at(-1),firstBuild=await w.api('/api/build?id='+first.candidate.id),added=firstBuild.scene.objects.filter(o=>!example.scene.objects.some(old=>old.id===o.id));
  fs.writeFileSync(path.join(w.dir,'first-model-build.json'),JSON.stringify(firstBuild,null,2));
  w.check('真实模型从长期约定读取未在本次需求重复的花色，生成可穿行的小花',added.length===1&&added[0].parts.every(p=>p.solid===false)&&added[0].parts.some(p=>p.color.toLowerCase()==='#a8d8ef')&&Math.max(...added[0].parts.map(p=>p.offset.y+p.size.y))<=1.2,added);
  w.check('新增植物保留原有源码与身份',canonicalJSON(firstBuild.scene.behaviors)===canonicalJSON(example.scene.behaviors)&&example.scene.objects.every(o=>canonicalJSON(firstBuild.scene.objects.find(n=>n.id===o.id))===canonicalJSON(o)));
  for(let i=0;i<90;i++)await w.api('/api/tasks',{version:first.current,prompt:`后台验收的背景讨论 ${i+1}：先记下这条讨论，等待当前候选处理。`,intent:'discuss',context:{selected:null,player:example.snapshot.player}});
  w.check('原始需求已退出近期对话和整个对话列表，背景讨论未增加模型任务',(await read()).messages.every(m=>m.text!==firstPrompt)&&(await read()).tasks.length===1);
  await w.apply();await w.game().locator('#interact').evaluate(el=>el.onclick());let latest=await w.snapshot();await w.api('/api/save',{version:(await read()).current,snapshot:latest});
  w.check('后续修改前原世界真实开门并保存最新状态',latest.behaviors.modules[behavior].state.open===true&&latest.behaviors.modules[behavior].overrides[door].offset.x===-1.8);
  await w.close();await w.start();await w.domClick('[data-view="assets"]');await w.page.locator(`[data-object-id="${door}"] button`).evaluate(el=>el.onclick());
  const second=await w.request('让这扇门的关闭提示符合我们给这个营地定下的约定。开关方式照旧，别让我的进度回到初始状态。'),secondTask=second.tasks.at(-1),secondBuild=await w.api('/api/build?id='+second.candidate.id),context=await w.api('/api/tasks/context?id='+secondTask.id);
  fs.writeFileSync(path.join(w.dir,'second-model-build.json'),JSON.stringify(secondBuild,null,2));
  w.check('重启和长对话后，真实模型读取对象约定与早期已应用需求',context.notes.some(n=>n.id===notes[1].id)&&context.acceptedChanges.some(r=>r.id===firstTask.id&&r.request===firstPrompt)&&secondTask.context.selected===door,context);
  w.check('真实代码修改通过隔离检查，花朵和另一条规则保持原样',secondTask.behaviorVerification.every(r=>r.passed)&&canonicalJSON(secondBuild.scene.objects.find(o=>o.id===added[0].id))===canonicalJSON(added[0])&&canonicalJSON(secondBuild.scene.behaviors[1])===canonicalJSON(firstBuild.scene.behaviors[1])&&secondBuild.scene.behaviors[0].code.includes('营地已安静'));
  await w.apply();latest=await w.snapshot();w.check('应用模型修改保留最新开门状态与位移',latest.behaviors.modules[behavior].state.open===true&&latest.behaviors.modules[behavior].overrides[door].offset.x===-1.8);
  // Reposition only this owned test world through its normal full-save transaction.
  await w.load(secondBuild.scene,{...latest,player:{x:-.55,y:6,z:9.6,yaw:0,pitch:0}});await w.game().locator('#interact').evaluate(el=>el.onclick());latest=await w.snapshot();
  const notice=await w.game().locator('#notice').textContent();w.check('实际互动执行修改后的源码，关闭门并显示长期约定中的提示',latest.behaviors.modules[behavior].state.open===false&&notice.includes('营地已安静')&&!latest.behaviors.modules[behavior].error,{notice,state:latest.behaviors.modules[behavior]});
  await w.api('/api/save',{version:(await read()).current,snapshot:latest});await w.saveScreenshot('remembered-door');await w.domClick('#context-open');await w.page.locator('.context-history').evaluate(el=>el.open=true);await w.saveScreenshot('long-term-context');
  const end=await read();w.check('两次真实修改保留可核对的请求、模型产物与应用记录',end.tasks.length===2&&end.tasks.every(t=>t.status==='applied')&&end.projectContext.accepted.length===2,end.tasks.map(t=>({id:t.id,context:t.contextRead,attempts:t.attempts.length,usage:t.usage})));
  w.check('真实多轮验收没有占用鼠标或产生页面异常',!w.errors.length&&await w.game().locator('body').evaluate(()=>document.pointerLockElement===null),w.errors);
}catch(error){w.errors.push(error.stack);console.error(error);await w.saveScreenshot('failure');process.exitCode=1;}finally{await w.close();console.log('Report: '+path.join(w.dir,'report.json'));}
