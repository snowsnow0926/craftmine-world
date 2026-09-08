// Two real model requests; PNG patterns and the starting door are explicit fixtures.
import fs from 'node:fs';
import path from 'node:path';
import { workbench } from './workbench.mjs';
import { behaviorScene } from './behavior-fixtures.mjs';
import { png } from './asset-fixtures.mjs';
import { sceneDiff,canonicalJSON } from '../app/scene.mjs';
const resumeDir=process.argv[2]==='--resume'?process.argv[3]:null;
const w=await workbench('live-assets',{resumeDir}),read=()=>w.api('/api/state'),scene=behaviorScene(),pose={format:'craftmine.progress/1',player:{x:0,y:6,z:10,yaw:0,pitch:0}};
async function image(old=null){const bytes=png(32,80,(x,y)=>(x<3||x>28||y<4||y>75)?[190,130,70,255]:(x+y)%13<5?(old?[210,210,145,255]:[100,180,140,255]):(old?[80,110,190,255]:[45,95,70,255]));const result=await w.api('/api/assets/import',{id:old?.id||null,baseVersion:old?.version||null,name:'铜叶纹门面',filename:'door-surface.png',mime:'image/png',data:bytes.toString('base64')});return w.api('/api/assets/read?id='+result.id+'&version='+result.version);}
const appearanceOnly=(before,after)=>{const items=sceneDiff(before,after).details.items;return items.length===1&&items[0].id==='door-one'&&items[0].fields.join()==='appearance';};
try{
  let task1,one,b;
  if(resumeDir){const state=await read();if(state.tasks.length!==1||state.tasks[0].status!=='applied'||state.candidate||state.applying||w.checks.length!==3)throw Error('测试不在已完成第一次生成的恢复点');task1=state.tasks[0];one=await w.api('/api/build?id='+state.current);const ref=one.scene.objects[0].appearance.asset;b=await w.api('/api/assets/read?id='+ref.id+'&version=2');if(ref.version!==1||!state.snapshot.behaviors.modules['sliding-door'].state.open)throw Error('恢复点缺少第一版素材或最新开门进度');}
  else{
  await w.load(scene,pose);const a=await image();await w.domClick('[data-view="assets"]');await w.page.locator('[data-object-id="door-one"] button').evaluate(el=>el.onclick());
  const first=await w.request('我导入了一张叫“铜叶纹门面”的图片，把这扇木滑门的外观换成它。门的大小、位置、碰撞和开关方式都照旧，其他对象与源码也保持原样，只更换 appearance。');task1=first.tasks.at(-1);one=await w.api('/api/build?id='+first.candidate.id);
  fs.writeFileSync(path.join(w.dir,'first-model-build.json'),JSON.stringify(one,null,2));
  w.check('真实模型使用已导入的素材身份与固定版本生成外观候选',one.scene.objects[0].appearance?.asset.id===a.id&&one.scene.objects[0].appearance.asset.hash===a.hash&&one.scene.objects[0].appearance.asset.version===1&&appearanceOnly(scene,one.scene));
  const manifest1=JSON.parse(fs.readFileSync(path.join(w.dir,'project','tasks',task1.id,'assets-read.json'),'utf8'));w.check('任务记录保留实际读取的素材描述，提示词不携带文件 Base64',manifest1.some(m=>m.id===a.id&&m.hash===a.hash)&&!fs.readFileSync(path.join(w.dir,'project','tasks',task1.id,'request.txt'),'utf8').includes(a.data));
  await w.game().locator('#interact').evaluate(el=>el.onclick());await w.apply();w.check('应用真实模型的外观修改后，候选形成之后的开门进度保留',(await w.snapshot()).behaviors.modules['sliding-door'].state.open&&one.scene.behaviors[0].code===scene.behaviors[0].code);
  b=await image(a);await w.api('/api/save',{version:(await read()).current,snapshot:await w.snapshot()});await w.close();await w.start();}
  await w.domClick('[data-view="assets"]');await w.page.locator('[data-object-id="door-one"] button').evaluate(el=>el.onclick());
  const second=await w.request('门面我刚导入了同一素材的新稿，请换上最新那一版。现在开着的门就让它开着，之前的大小、摆放和所有玩法都照旧。'),task2=second.tasks.at(-1),two=await w.api('/api/build?id='+second.candidate.id);
  fs.writeFileSync(path.join(w.dir,'second-model-build.json'),JSON.stringify(two,null,2));
  w.check('重启后真实模型区分当前旧引用与库中新版，仅切换所选对象外观',two.scene.objects[0].appearance.asset.id===b.id&&two.scene.objects[0].appearance.asset.version===2&&two.scene.objects[0].appearance.asset.hash===b.hash&&appearanceOnly(one.scene,two.scene)&&canonicalJSON(two.scene.behaviors)===canonicalJSON(scene.behaviors));
  await w.apply();let latest=await w.snapshot();w.check('第二次真实修改保留源码状态及打开位移',latest.behaviors.modules['sliding-door'].state.open&&latest.behaviors.modules['sliding-door'].overrides['door-one'].offset.x===1.2);
  await w.load(two.scene,{...latest,player:{x:1.2,y:6,z:10,yaw:0,pitch:0}});await w.game().locator('#interact').evaluate(el=>el.onclick());latest=await w.snapshot();w.check('换成新版图片后的门实际执行原源码并关闭',latest.behaviors.modules['sliding-door'].state.open===false&&latest.behaviors.modules['sliding-door'].overrides['door-one'].solid===true&&!latest.behaviors.modules['sliding-door'].error);
  await w.api('/api/save',{version:(await read()).current,snapshot:latest});const exported=await w.api('/api/export');fs.writeFileSync(path.join(w.dir,'model-created-world.save.json'),JSON.stringify(exported,null,2));w.check('真实模型修改后的作品可导出源码、最新进度和所用素材版本',exported.format==='craftmine.save/2'&&exported.assets.length===1&&exported.assets[0].version===2&&exported.snapshot.behaviors.modules['sliding-door'].state.open===false);
  await w.saveScreenshot('model-changed-door');w.check('两次真实调用有产物与用量记录，后台没有鼠标锁定或页面错误',(await read()).tasks.filter(t=>[task1.id,task2.id].includes(t.id)).every(t=>t.status==='applied'&&t.attempts.some(a=>a.status==='passed'))&&!w.errors.length&&await w.game().locator('body').evaluate(()=>document.pointerLockElement===null),(await read()).tasks.map(t=>({id:t.id,status:t.status,attempts:t.attempts,usage:t.usage})));
}catch(error){w.errors.push(error.stack);console.error(error);await w.saveScreenshot('failure');process.exitCode=1;}finally{await w.close();console.log('Report: '+path.join(w.dir,'report.json'));}
