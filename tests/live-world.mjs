// Real model generation from an empty project. Checkpoints let later phases use
// this exact world without paying for or repeating earlier successful requests.
import fs from 'node:fs';
import path from 'node:path';
import { workbench } from './workbench.mjs';
import { playWorld } from './world-probe.mjs';
const arg=name=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:null;
const resumeDir=arg('--resume'),phase=arg('--phase')||'harvest',retry=process.argv.includes('--retry');
const w=await workbench('live-world',{resumeDir}),checkpointFile=path.join(w.dir,'world-checkpoint.json');
let checkpoint=fs.existsSync(checkpointFile)?JSON.parse(fs.readFileSync(checkpointFile,'utf8')):{format:'craftmine.world-test/1',stage:'empty',tasks:[]};
const record=()=>fs.writeFileSync(checkpointFile,JSON.stringify(checkpoint,null,2));
try{
  if(phase==='harvest'){
  if(checkpoint.stage==='empty'){
    const state=await w.api('/api/state');if(state.tasks.length||state.candidate)throw Error('首次生成必须是空白测试项目');
    const prompt='我想从这块空地开始做一个小营地。先长出两棵能看出树干和树冠的树，树之间和出生点留出可以走动的空地。给我近战能力，用近战真正砍倒树：每棵要挥击三次才倒下，倒下以后不再挡路，每棵只掉落一次 2 份木材。背包要显示中文“木材”，重新进入后砍掉的树和已经拿到的木材还在。暂时只做这个采木玩法，后面我会继续加制作和任务。';
    const generated=await w.request(prompt),task=generated.tasks.at(-1);checkpoint.tasks.push(task.id);record();
    const build=await w.api('/api/build?id='+generated.candidate.id);fs.writeFileSync(path.join(w.dir,'harvest-model-build.json'),JSON.stringify(build,null,2));
    await w.apply();checkpoint.stage='harvest-generated';record();
  }
  if(checkpoint.stage!=='harvest-generated')throw Error('采木阶段已经完成，请继续下一阶段，不重复生成');
  const state=await w.api('/api/state'),build=await w.api('/api/build?id='+state.current),trees=build.scene.objects.filter(o=>o.components.health>0),snapshot=await w.snapshot();
  w.check('真实模型从空白生成两棵可受伤的树、近战系统与新采集源码',trees.length===2&&trees.every(o=>o.name.includes('树'))&&build.scene.systems.some(s=>s.type==='melee')&&build.scene.behaviors.some(d=>d.code.includes('inventory.add')),build.scene.behaviors.map(d=>({id:d.id,name:d.name,format:d.format})));
  const tested=await playWorld(w,build,snapshot,[{type:'attack',id:trees[0].id,count:2},{type:'attack',id:trees[0].id,count:1},{type:'tick'},{type:'tick'}]);fs.writeFileSync(path.join(w.dir,'harvest-play.json'),JSON.stringify(tested,null,2));
  w.check('两次近战仍未砍倒树，没有提前掉落木材',tested.steps[0].snapshot.gameplay.targets[trees[0].id].health>0&&!Object.values(tested.steps[0].snapshot.behaviors.inventory).some(n=>n>0),tested.steps[0]);
  const items=tested.snapshot.behaviors.items||{},wood=Object.keys(items).find(id=>items[id].name==='木材');
  w.check('第三次真实近战砍倒树、移除网格并掉落两份中文木材',tested.steps[1].snapshot.gameplay.targets[trees[0].id].health===0&&!tested.steps[1].mesh&&!!wood&&tested.snapshot.behaviors.inventory[wood]===2,tested.steps[1]);
  w.check('另一棵树保留，后续事件没有重复发放掉落或停止源码',tested.snapshot.gameplay.targets[trees[1].id].health===trees[1].components.health&&!tested.failures.length&&!tested.pointerLock,tested.failures);
  await w.load(build.scene,tested.snapshot);await w.api('/api/save',{version:(await w.api('/api/state')).current,snapshot:await w.snapshot()});await w.close();await w.start();const restored=await w.snapshot();
  w.check('第一次重启保留已砍倒的树和两份木材，start 不重复发奖励',restored.behaviors.inventory[wood]===2&&restored.gameplay.targets[trees[0].id].health===0&&restored.gameplay.targets[trees[1].id].health>0&&await w.game().locator('#inventory-hud').innerText().then(t=>t.includes('木材')));
  checkpoint={...checkpoint,stage:'harvest-tested',trees:trees.map(o=>o.id),wood,harvestBuild:state.current};record();
  fs.writeFileSync(path.join(w.dir,'harvest-played.save.json'),JSON.stringify(await w.api('/api/export'),null,2));await w.saveScreenshot('harvest-after-restart');
  w.check('采木阶段的真实请求、源码和用量可核对，后台没有页面错误',!w.errors.length&&(await w.api('/api/state')).tasks.filter(t=>checkpoint.tasks.includes(t.id)).every(t=>t.status==='applied'),(await w.api('/api/state')).tasks.map(t=>({id:t.id,status:t.status,attempts:t.attempts,usage:t.usage})));
  }else if(phase==='craft'){
    if(!resumeDir||!['harvest-tested','craft-generated'].includes(checkpoint.stage))throw Error('制作阶段需要已验证采木的同一独立项目');
    if(process.argv.includes('--recheck')){
      if(checkpoint.stage!=='craft-generated')throw Error('重新试玩仅允许已生成、已应用的同一制作世界');
      const archive='report-before-craft-recheck-'+Date.now()+'.json';fs.copyFileSync(path.join(w.dir,'report.json'),path.join(w.dir,archive));checkpoint.rechecks=[...(checkpoint.rechecks||[]),{report:archive,reason:'修正测试对象选择：工作台名称包含木门时，不得把工作台当成门。复用原始模型产物重新试玩，没有新增模型调用。'}];record();w.errors.splice(0);w.report();
    }
    if(retry){
      const previous=await w.api('/api/state'),last=previous.tasks.at(-1);if(checkpoint.stage!=='harvest-tested'||!['failed','interrupted','cancelled'].includes(last?.status)||previous.candidate||previous.applying)throw Error('只可在已记录失败且原世界完整的恢复点重试');
      const archive='report-before-craft-retry-'+last.id+'-'+Date.now()+'.json';fs.copyFileSync(path.join(w.dir,'report.json'),path.join(w.dir,archive));checkpoint.failedTasks=[...(checkpoint.failedTasks||[]),{id:last.id,error:last.error,report:archive}];record();w.errors.splice(0);w.report();
      w.check('制作失败和超时有完整记录，重试前采木世界与库存保留',(await w.snapshot()).behaviors.inventory[checkpoint.wood]===2&&previous.current===checkpoint.harvestBuild,last.error);
    }
    if(checkpoint.stage==='harvest-tested'){
      const prompt='继续做这个营地。我已经砍掉一棵树，背包里有 2 份木材，另一棵树留着。请加一个能按 E 互动的木工作台：消耗 3 份木材，在旁边制作一扇能开关、关上挡路、打开可以穿过的木门。第一次材料不足要明确提示缺多少，材料足够才扣除并制作，门只能制作一次，重复互动不能重复扣料。没有制作时门不要出现或挡路。再加一个一直看得到、保存后还在的任务提示，指引采木和制作，完成后显示完成。保留原有树、近战和已经拿到的物品以及已砍树的进度，不要复活树或凭空送材料；工作台和门留出能靠近与通行的空间。';
      const generated=await w.request(prompt+(retry?' 上次失败是因为把未制作的门放在 y=-4 的地下。请将门直接定义在地面 y=6 的合法位置，只在 start 里根据保存的制作状态用 object.patch 的 visible:false、solid:false 隐藏未制作的门，绝不使用地下或边界外的位置来隐藏。工作台与门用少量清楚的部件即可，源码简洁并保留所需功能。':'')),task=generated.tasks.at(-1);checkpoint.tasks.push(task.id);record();
      const build=await w.api('/api/build?id='+generated.candidate.id);fs.writeFileSync(path.join(w.dir,'craft-model-build.json'),JSON.stringify(build,null,2));await w.apply();checkpoint.stage='craft-generated';record();
    }
    const state=await w.api('/api/state'),build=await w.api('/api/build?id='+state.current),snapshot=await w.snapshot();
    const bench=build.scene.objects.find(o=>/工作台/.test(o.name)),door=build.scene.objects.find(o=>o.id!==bench?.id&&/门/.test(o.name)&&!/门框/.test(o.name));
    w.check('第二轮真实模型增加工作台、门和任务源码，原有采木进度保持',!!bench&&!!door&&snapshot.behaviors.inventory[checkpoint.wood]===2&&snapshot.gameplay.targets[checkpoint.trees[0]].health===0&&snapshot.gameplay.targets[checkpoint.trees[1]].health>0,build.scene.objects.map(o=>({id:o.id,name:o.name})));
    const tested=await playWorld(w,build,snapshot,[{type:'interact',id:bench.id},{type:'attack',id:checkpoint.trees[1],count:3},{type:'interact',id:bench.id},{type:'interact',id:door.id},{type:'interact',id:bench.id},{type:'interact',id:door.id},{type:'interact',id:door.id}]);
    fs.writeFileSync(path.join(w.dir,'craft-play.json'),JSON.stringify(tested,null,2));
    w.check('材料不足时给出正常提示，保留两份木材且门不阻挡',tested.steps[0].snapshot.behaviors.inventory[checkpoint.wood]===2&&!tested.steps[0].collisions[door.id]&&tested.steps[0].notices.some(t=>/不足|还缺|需要/.test(t))&&!tested.steps[0].failures.length,tested.steps[0]);
    w.check('砍倒剩下的树获得四份木材，两处原树干都不再阻挡',tested.steps[1].snapshot.behaviors.inventory[checkpoint.wood]===4&&checkpoint.trees.every(id=>tested.steps[1].snapshot.gameplay.targets[id].health===0&&!tested.steps[1].collisions[id]));
    w.check('工作台真实扣除三份木材并制作有碰撞的门',tested.steps[2].snapshot.behaviors.inventory[checkpoint.wood]===1&&tested.steps[2].collisions[door.id],tested.steps[2]);
    w.check('门可互动打开，关闭又挡路，再次打开可通行',!tested.steps[3].collisions[door.id]&&tested.steps[5].collisions[door.id]&&!tested.steps[6].collisions[door.id]);
    w.check('重复制作不重复扣料，任务保存完成进度且源码没有停止',tested.snapshot.behaviors.inventory[checkpoint.wood]===1&&!tested.failures.length&&Object.values(tested.snapshot.behaviors.modules).some(m=>Object.values(m.panels||{}).some(p=>/完成|已制作|已建成/.test(JSON.stringify(p)))),tested.snapshot.behaviors);
    await w.load(build.scene,tested.snapshot);await w.api('/api/save',{version:(await w.api('/api/state')).current,snapshot:await w.snapshot()});await w.close();await w.start();const restored=await w.snapshot();
    w.check('第二次重启保留两棵已砍的树、一份木材和制作任务',restored.behaviors.inventory[checkpoint.wood]===1&&checkpoint.trees.every(id=>restored.gameplay.targets[id].health===0)&&await w.game().locator('#task-hud').innerText().then(t=>/完成|已制作|已建成/.test(t)));
    const afterRestart=await playWorld(w,build,restored,[{type:'interact',id:door.id}]);w.check('重启后门继续开关，库存没有变化',afterRestart.steps[0].collisions[door.id]&&afterRestart.snapshot.behaviors.inventory[checkpoint.wood]===1&&!afterRestart.failures.length);
    checkpoint={...checkpoint,stage:'craft-tested',bench:bench.id,door:door.id,craftBuild:state.current};record();fs.writeFileSync(path.join(w.dir,'craft-played.save.json'),JSON.stringify(await w.api('/api/export'),null,2));await w.saveScreenshot('crafted-door-after-restart');
    w.check('两轮真实创作均已应用，源码产物与用量有记录，没有页面异常',!w.errors.length&&(await w.api('/api/state')).tasks.filter(t=>checkpoint.tasks.includes(t.id)).every(t=>t.status==='applied'),(await w.api('/api/state')).tasks.map(t=>({id:t.id,status:t.status,attempts:t.attempts,usage:t.usage})));
  }else throw Error('未知验收阶段');
}catch(error){w.errors.push(error.stack);console.error(error);await w.saveScreenshot('failure');process.exitCode=1;}finally{await w.close();console.log('Report: '+path.join(w.dir,'report.json'));}
