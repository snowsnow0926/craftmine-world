// Actual Codex calls, using an isolated copy of the user's scene; never writes .craftmine.
import fs from 'node:fs';
import path from 'node:path';
import { workbench } from './workbench.mjs';
import { INITIAL_SNAPSHOT, EMPTY_SCENE, clone, canonicalJSON, upgradeScene } from '../app/scene.mjs';
import { legacyFloraScene } from './scene-fixtures.mjs';
const repairCurrent=process.argv.includes('--repair-current');
const original=repairCurrent?JSON.parse(fs.readFileSync('.craftmine/project.json','utf8')):{current:null,snapshot:clone(INITIAL_SNAPSHOT)};
const source=repairCurrent?JSON.parse(fs.readFileSync(path.join('.craftmine','builds',original.current,'scene.json'),'utf8')):legacyFloraScene();
const w=await workbench('live-memory');
try{
  await w.load(source,original.snapshot);
  const ids=source.objects.filter(o=>o.id.startsWith('flower-')||o.id.startsWith('grass-clump-')).map(o=>o.id);
  if(!ids.length)throw Error('This repair test requires the original brick-flower scene');
  let state=await w.request(`修复这些花草对象：${ids.join('、')}。它们之前被做成了巨大的砖块。请保持每个对象的 ID 和 position 不变，改成精致小巧的细茎、彩色花瓣与花蕊、薄叶片，草丛用高低错落的尖 blade。每个对象高度在0.3到0.9米，宽不超过1米，所有植物部件无碰撞；花瓣、草叶、茎用纯色 solid 材质。不要用石砖、沙块或草地方块。保持阔叶树完全不变，包括所有字段。不要新增或移除对象，不要启用玩法。`);
  const build=await w.api('/api/build?id='+state.candidate.id),scene=build.scene;
  const flora=scene.objects.filter(o=>ids.includes(o.id));
  w.check('真实 LLM 把砖花改成小数尺寸彩色植物',flora.length===ids.length&&flora.every(o=>Math.max(...o.parts.map(p=>p.offset.y+p.size.y))-Math.min(...o.parts.map(p=>p.offset.y))<=1&&o.parts.every(p=>!p.solid&&p.material==='solid')));
  w.check('真实修复保留对象位置和原树',scene.objects.length===source.objects.length&&scene.objects.every(o=>canonicalJSON(o.position)===canonicalJSON(source.objects.find(s=>s.id===o.id).position))&&canonicalJSON(scene.objects.find(o=>o.id==='tree-001'))===canonicalJSON(upgradeScene(source).objects.find(o=>o.id==='tree-001')));
  await w.apply();
  fs.writeFileSync(path.join(w.dir,'repair-candidate.json'),JSON.stringify({sourceVersion:original.current,scene,task:(await w.api('/api/state')).tasks.at(-1)},null,2));
  await w.saveScreenshot('01-real-flora-repair');
  state=await w.api('/api/state');w.check('真实应用后每种植物有历史版本可复用',ids.every(id=>{const binding=state.moduleBindings.object[id];return state.library.find(m=>m.id===binding.id).versions.length>=2;}));
  // Remove instances from the test world: memory must survive independently.
  await w.load(EMPTY_SCENE,INITIAL_SNAPSHOT);
  state=await w.request('我想要有树。请优先复用创作记忆里之前的“阔叶树”定义，保持原先的几何外观，在我前方空地生成一个新实例，source 记录真实模块版本。');
  const reused=await w.api('/api/build?id='+state.candidate.id);
  w.check('世界已空，真实 LLM 仍读取并引用先前的树模块',state.tasks.at(-1).memories.some(m=>m.name==='阔叶树')&&state.tasks.at(-1).usedModules.length>0&&reused.scene.objects.some(o=>o.source));
  await w.apply();
  state=await w.request('在当前世界增加 100 点玩家生命值、基础射击枪械、近战剑，两个武器都能使用。增加一个60点血量的训练靶用于试射，靶放在我前方5米且与树错开。只使用已支持的 health/ranged/melee 系统和目标组件，不要移除或修改原树。');
  const gameplay=await w.api('/api/build?id='+state.candidate.id);
  w.check('真实 LLM 生成三个可执行玩法系统和可受伤目标',gameplay.scene.systems.length===3&&gameplay.scene.objects.some(o=>o.components.health===60));
  await w.apply();
  w.check('真实生成的玩法在浏览器初始化血条与武器',await w.game().locator('#health-hud').isVisible()&&await w.game().locator('#weapon-hud').isVisible()&&(await w.snapshot()).format==='craftmine.progress/2');
  await w.saveScreenshot('02-real-gameplay');await w.domClick('[data-view="assets"]');await w.saveScreenshot('03-real-memory');
  w.check('真实 LLM 联调期间没有浏览器异常',w.errors.length===0,w.errors);
}catch(error){w.errors.push(error.stack);console.error(error);process.exitCode=1;}finally{await w.close();console.log('Report: '+path.join(w.dir,'report.json'));}
