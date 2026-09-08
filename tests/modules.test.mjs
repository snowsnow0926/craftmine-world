import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ProjectStore } from '../app/store.mjs';
import { compileScene, upgradeScene, EMPTY_SCENE, INITIAL_SNAPSHOT, clone, validateSnapshot, validateObjectScope } from '../app/scene.mjs';
import { GameplaySession } from '../app/gameplay.mjs';
import { validateModule } from '../app/memory.mjs';
import { rayBox, primitiveVertices } from '../app/geometry.mjs';
import { buildPrompt } from '../app/agent.mjs';
import { floraScene,systems,flower } from './scene-fixtures.mjs';

fs.mkdirSync('test-results/modules-core',{recursive:true});
const project=()=>new ProjectStore(fs.mkdtempSync(path.resolve('test-results/modules-core/project-')));
const apply=(p,scene)=>{const b=p.build(scene);p.stage(b,'自然语言创造的花草',p.data.current,null);const tx=p.prepare(b.id,p.data.current,p.data.snapshot);p.commit(tx.id,p.data.snapshot);return b;};

test('薄叶片和小数尺寸保留真实几何，不会量化成整格砖块',()=>{
  const b=compileScene(floraScene());assert.equal(b.voxels.length,0);assert.ok(b.primitives.some(p=>p.size.x===.05));assert.ok(b.primitives.some(p=>p.shape==='blade'));
  assert.ok(b.primitives.filter(p=>p.id.startsWith('flower')||p.id.startsWith('grass')).every(p=>!p.solid));
  const vertices=primitiveVertices(b.primitives);assert.ok(vertices.length>0&&vertices.every(Number.isFinite));
});
test('装饰植物可交错，实体碰撞不能跨对象覆盖；越界和非法颜色拒绝',()=>{
  const s=floraScene();s.objects.push({...clone(s.objects[0]),id:'another-flower'});assert.doesNotThrow(()=>compileScene(s));
  s.objects[0].parts[0].solid=true;s.objects.at(-1).parts[0].solid=true;assert.throws(()=>compileScene(s),/重叠/);
  s.objects.pop();s.objects[0].parts[0].color='url(file)';assert.throws(()=>compileScene(s));s.objects[0].parts[0].color='#ffffff';s.objects[0].parts[0].size.x=.001;assert.throws(()=>compileScene(s));
});
test('失败与丢弃候选不写记忆；应用后重启仍可检索真实定义',()=>{
  const p=project(),b=p.build(floraScene());p.stage(b,'花草',p.data.current,null);assert.equal(p.data.library.length,0);p.discard();assert.equal(p.data.library.length,0);
  apply(p,floraScene());const resumed=new ProjectStore(p.root),memories=resumed.modules.retrieve(resumed.data,'再来一朵花');assert.ok(memories.some(m=>m.name.includes('花')));
  const prompt=buildPrompt({scene:upgradeScene(EMPTY_SCENE),memories,text:'再来一朵花',intent:'execute',context:{},messages:[]});assert.ok(prompt.includes('0.05')&&prompt.includes(memories[0].id));
});
test('模块改作保留旧版本，实例移动不产生新模块，复用不会改其他实例',()=>{
  const p=project(),s=floraScene();apply(p,s);const binding=p.data.moduleBindings.object[s.objects[0].id],first=p.modules.read(p.data,binding.id,1);
  s.objects[0].position.x+=1;apply(p,s);assert.equal(p.data.library.find(m=>m.id===binding.id).versions.length,1);
  s.objects[0].parts[0].size.y+=.1;apply(p,s);assert.equal(p.data.library.find(m=>m.id===binding.id).latest,2);assert.deepEqual(p.modules.read(p.data,binding.id,1),first);
  const before=p.readBuild(p.data.current).scene;p.reuseModule(binding.id,1,INITIAL_SNAPSHOT.player);const after=p.readBuild(p.data.candidate.id).scene;
  assert.deepEqual(after.objects.slice(0,before.objects.length),before.objects);assert.deepEqual(after.objects.at(-1).source,{id:binding.id,version:1});
});
test('对象和玩法模块可导入第二个项目，固定版本且校验篡改与依赖',()=>{
  const a=project(),b=project(),s=floraScene();s.systems=systems();apply(a,s);
  for(const m of a.data.library){const module=a.modules.read(a.data,m.id,1);b.importModule(module);assert.equal(b.modules.read(b.data,m.id,1).hash,module.hash);}
  const health=b.data.library.find(m=>m.kind==='gameplay'&&b.modules.read(b.data,m.id,1).payload.type==='health');b.reuseModule(health.id,1,INITIAL_SNAPSHOT.player);assert.equal(b.readBuild(b.data.candidate.id).scene.systems[0].config.maxHealth,100);
  const broken=a.modules.read(a.data,a.data.library[0].id,1);broken.payload.parts[0].color='#000000';assert.throws(()=>validateModule(broken),/哈希/);
  broken.id='../bad';assert.throws(()=>validateModule(broken));
});
test('旧格式读取哈希不变，首次记忆迁移备份项目；对象修改不能改变玩法',()=>{
  const p=project(),s={...clone(EMPTY_SCENE),objects:[{id:'old-tree',name:'树',position:{x:0,y:6,z:6},parts:[{offset:{x:0,y:0,z:0},size:{x:1,y:3,z:1},material:'wood'}]}]};
  const old=apply(p,s),d=clone(p.data);delete d.library;delete d.moduleBindings;fs.writeFileSync(p.file,JSON.stringify(d));const resumed=new ProjectStore(p.root);
  assert.equal(resumed.data.current,old.id);assert.equal(resumed.readBuild(old.id).hash,old.hash);assert.equal(resumed.data.library.length,1);
  const after=upgradeScene(s);after.systems=systems();assert.throws(()=>validateObjectScope(s,after,'old-tree'));
});
test('未知玩法、缺少依赖和无效存档被拒绝',()=>{
  const s=floraScene();s.systems=[{id:'bad',name:'坏脚本',type:'eval',config:{},source:null}];assert.throws(()=>compileScene(s));s.systems=[];s.objects[0].components.contactDamage=10;assert.throws(()=>compileScene(s),/生命值/);
  assert.throws(()=>validateSnapshot({format:'craftmine.progress/2',player:INITIAL_SNAPSHOT.player,gameplay:{systems:{},targets:{},equipped:'eval'}}));
});
test('射击扣弹、冷却、换弹，近战受距离限制且能击破目标',()=>{
  const o=flower();o.components.health=60;const g=new GameplaySession(systems(),[o]);
  assert.equal(g.attack({id:o.id,distance:10}).damage,20);assert.equal(g.attack({id:o.id,distance:10}).fired,false);
  g.tick(.2);g.attack(null);g.tick(.2);g.attack(null);assert.equal(g.state.systems['system-ranged'].ammo,0);g.tick(.2);assert.equal(g.attack(null).fired,false);
  assert.equal(g.reload(),true);g.tick(.4);assert.equal(g.state.systems['system-ranged'].ammo,3);
  g.equip('melee');assert.equal(g.attack({id:o.id,distance:5}).damage,0);g.tick(.3);assert.equal(g.attack({id:o.id,distance:1}).damage,25);g.tick(.3);assert.equal(g.attack({id:o.id,distance:1}).destroyed,true);
});
test('血量、弹药和目标伤害跨加载保留；调小参数裁剪状态，死亡可复活',()=>{
  const o=flower();o.components.health=60;const g=new GameplaySession(systems(),[o]);g.hurt(25);g.attack({id:o.id,distance:3});
  const state=g.snapshot(),s=systems();s[0].config.maxHealth=50;s[1].config.magazine=1;o.components.health=30;
  const resumed=new GameplaySession(s,[o],state);assert.equal(resumed.player.health,50);assert.equal(resumed.state.systems['system-ranged'].ammo,1);assert.equal(resumed.state.targets[o.id].health,30);
  resumed.fall(20);assert.equal(resumed.dead,true);assert.equal(resumed.attack(null).fired,false);resumed.revive();assert.equal(resumed.player.health,50);
});
test('射线给出最先遮挡的距离，并拒绝背后/范围外目标',()=>{
  const box={min:{x:0,y:6,z:6},max:{x:1,y:8,z:7}};assert.equal(rayBox([.5,7.5,12],[0,0,-1],box,10).distance,5);assert.equal(rayBox([.5,7.5,12],[0,0,1],box,10),null);assert.equal(rayBox([.5,7.5,12],[0,0,-1],box,2),null);
});
test('JSON 字段顺序不改变构建、模块身份或选中范围',()=>{
  const scene=floraScene(),reorder=value=>Array.isArray(value)?value.map(reorder):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([k,v])=>[k,reorder(v)])):value;
  const reordered=reorder(scene);assert.equal(compileScene(scene).hash,compileScene(reordered).hash);assert.doesNotThrow(()=>validateObjectScope(scene,reordered,scene.objects[0].id));
  const p=project();apply(p,scene);apply(p,reordered);assert.ok(p.data.library.every(m=>m.latest===1));
});
