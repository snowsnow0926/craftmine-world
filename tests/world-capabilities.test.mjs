import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { capable,capabilityScene } from './world-capabilities-fixtures.mjs';
import { behaviorScene,behaviorFrame,doorBehavior } from './behavior-fixtures.mjs';
import { validateBehavior,validateBehaviorFrame,validateBehaviorResult } from '../app/behavior-contracts.mjs';
import { BehaviorState,validateBehaviorState } from '../app/behavior-state.mjs';
import { BehaviorBinding } from '../app/behavior-binding.mjs';
import { compileScene,encodeAgentScene,decodeAgentScene,canonicalJSON,OUTPUT_SCHEMA,withAppearanceFormat,INITIAL_SNAPSHOT,EMPTY_SCENE } from '../app/scene.mjs';
import { captureCreation,creationGroups,materializeCreation,creationDependencies } from '../app/creation.mjs';
import { ModuleLibrary,validateModule } from '../app/memory.mjs';
import { atomicJSON,ProjectStore } from '../app/store.mjs';
import { defaultAppearance } from '../app/asset-binding.mjs';
import { png } from './asset-fixtures.mjs';
const frame=()=>({...behaviorFrame(),inventory:{}});
const panel=(key='quest')=>({type:'hud.panel',key,panel:{title:'制作进度',lines:['木材 1 / 3']}});
const item={type:'inventory.define',item:'wood',name:'木材',description:'用于制作'};
const make=()=>{const build=compileScene(capabilityScene());return {build,state:new BehaviorState(build),artifact:build.behaviors[0]};};
test('新能力显式声明；旧源码不能使用新增命令，未知能力和权限组合拒绝',()=>{
  assert.doesNotThrow(()=>validateBehavior(capable('test')));
  for(const capabilities of [['shell@1'],['hud.panel@1','hud.panel@1']])assert.throws(()=>validateBehavior(capable('test',{capabilities})),/能力/);
  assert.throws(()=>validateBehavior(capable('test',{permissions:[]})),/权限/);
  for(const command of [item,panel()]){
    assert.throws(()=>validateBehaviorResult({state:{},commands:[command]},capable('test',{capabilities:[]}),frame()),/能力/);
    assert.throws(()=>validateBehaviorResult({state:{},commands:[command]},{...doorBehavior(),permissions:['inventory.write','hud.message']},behaviorFrame()),/能力/);
  }
});
test('库存快照只发给声明读取能力的模块，拒绝负数、超容量和污染 ID',()=>{
  const d=capable('test');assert.throws(()=>validateBehaviorFrame(behaviorFrame(),{definition:d}),/能力/);
  assert.throws(()=>validateBehaviorFrame(frame(),{definition:doorBehavior()}),/能力/);
  for(const inventory of [{wood:-1},{wood:1.5},{wood:10000},{constructor:1},Object.fromEntries(Array.from({length:129},(_,i)=>['item-'+i,1]))])assert.throws(()=>validateBehaviorFrame({...frame(),inventory},{definition:d}));
  const original={...frame(),inventory:{wood:3}},copy=validateBehaviorFrame(original,{definition:d});copy.inventory.wood=999;assert.equal(original.inventory.wood,3);
});
test('物品和任务内容受限，纯文本符号保留，未知字段不能带入宿主',()=>{
  const d=capable('test');assert.doesNotThrow(()=>validateBehaviorResult({state:{},commands:[{...item,name:'<img src=x>'},panel()]},d,frame()));
  for(const command of [{...item,name:'x'.repeat(41)},{...item,description:'x'.repeat(201)},{...item,item:'constructor'},{...panel(),key:'constructor'},{...panel(),html:'x'},{...panel(),panel:{title:'x',lines:Array(7).fill('x')}},{...panel(),panel:{title:'x',lines:['x'.repeat(121)]}}])assert.throws(()=>validateBehaviorResult({state:{},commands:[command]},d,frame()));
});
test('扣料失败整步回滚物品定义、任务面板、库存和源码状态',()=>{
  const {state,artifact}=make(),before=state.snapshot();
  assert.throws(()=>state.apply(artifact,{state:{rewarded:true},commands:[item,panel(),{type:'inventory.add',item:'wood',count:-3}]},frame()),/库存/);
  assert.deepEqual(state.snapshot(),before);
  state.apply(artifact,{state:{},commands:[item,panel(),{type:'inventory.add',item:'wood',count:3}]},frame());
  assert.equal(state.value.items.wood.name,'木材');assert.equal(state.value.inventory.wood,3);assert.equal(state.value.modules.gatherer.panels.quest.title,'制作进度');
  const full=state.snapshot();assert.throws(()=>state.apply(artifact,{state:{},commands:[panel('a'),panel('b'),panel('c')]},frame()),/索引/);assert.deepEqual(state.snapshot(),full);
});
test('相同物品身份保持首次名称；相同面板 key 分属各源码模块，删除只影响自身',()=>{
  const {state,artifact,build}=make();state.apply(artifact,{state:{},commands:[item,panel()]},frame());
  state.apply(build.behaviors[2],{state:{},commands:[{...item,name:'其他名称'},panel()]},frame());
  assert.equal(state.value.items.wood.name,'木材');state.apply(artifact,{state:{},commands:[{type:'hud.panel',key:'quest',panel:null}]},frame());
  assert.equal(Object.keys(state.value.modules.gatherer.panels).length,0);assert.equal(state.value.modules.quest.panels.quest.title,'制作进度');
});
test('旧进度按需升级，旧世界保持原格式；卸载隐藏面板，兼容恢复保留库存和任务',()=>{
  const legacy=new BehaviorState(compileScene(behaviorScene())).snapshot();assert.equal(legacy.format,'craftmine.behavior-state/2');
  const {state,artifact,build}=make();state.apply(artifact,{state:{collected:3},commands:[item,panel(),{type:'inventory.add',item:'wood',count:3}]},frame());
  const saved=state.snapshot(),empty=compileScene({...capabilityScene(),behaviors:[]}),removed=new BehaviorState(empty,saved);
  assert.equal(removed.value.format,'craftmine.behavior-state/3');assert.deepEqual(removed.value.modules,{});assert.equal(removed.value.archive[0].record.panels.quest.title,'制作进度');
  const restored=new BehaviorState(build,removed.snapshot());assert.deepEqual(restored.snapshot(),saved);
  const migrated=new BehaviorState(build,legacy);assert.deepEqual(migrated.value.archive[0].record.panels,{});validateBehaviorState(migrated.snapshot());
  const noCap=capabilityScene();noCap.behaviors[0].capabilities=[];assert.deepEqual(new BehaviorState(compileScene(noCap),saved).value.modules.gatherer.panels,{});
});
test('含新能力的源码跨 Agent 编解码及实例绑定保留，复制不改共享物品 ID 或原始代码',()=>{
  const scene=capabilityScene();assert.deepEqual(decodeAgentScene(encodeAgentScene(scene)),scene);
  for(const schema of OUTPUT_SCHEMA.properties.scene.anyOf.filter(s=>s.properties))assert.ok(schema.properties.behaviors.items.anyOf.some(s=>s.properties.format.enum.includes('craftmine.behavior/3')&&s.required.includes('capabilities')));
  const payload=captureCreation(creationGroups(scene)[0],scene),copy=materializeCreation(payload,{id:'memory',version:1},{x:10,y:6,z:-10},'copy');
  const d=copy.behaviors[0],binding=new BehaviorBinding(d);assert.equal(binding.authored.format,'craftmine.behavior/3');assert.deepEqual(binding.authored.capabilities,d.capabilities);assert.equal(d.code,scene.behaviors[0].code);
  const input={...frame(),event:{type:'interact',targetId:d.targets[0]},objects:copy.objects.map(o=>({id:o.id,position:o.position,solid:true,visible:true,health:0})),inventory:{wood:3}},local=binding.frame(input);assert.deepEqual(local.inventory,{wood:3});
  assert.equal(binding.result({state:{},commands:[item]},input).commands[0].item,'wood');assert.equal(canonicalJSON(captureCreation(creationGroups(copy)[0],copy)),canonicalJSON(payload));
});
test('新创作导出使用 module/4 与 web/5，声明能力依赖并拒绝伪装旧运行版本',()=>{
  fs.mkdirSync('test-results',{recursive:true});const root=fs.mkdtempSync('test-results/capabilities-unit-'),library=new ModuleLibrary(root,atomicJSON),data={library:[]};
  library.capture(data,capabilityScene(),'验证新能力','test-build');const ref=data.library.find(e=>e.kind==='creation'),module=library.read(data,ref.id,ref.latest);
  assert.equal(module.format,'craftmine.module/4');assert.equal(module.runtime,'craftmine-web/5');assert.ok(module.dependencies.includes('inventory.read@1'));assert.ok(module.dependencies.includes('hud.panel@1'));assert.deepEqual(module.dependencies,creationDependencies(module.payload));
  assert.throws(()=>validateModule({...module,format:'craftmine.module/2',runtime:'craftmine-web/3'}),/运行约定/);
  assert.throws(()=>validateModule({...module,dependencies:module.dependencies.filter(d=>d!=='hud.panel@1')}),/依赖/);
  const hash=createHash('sha256').update(canonicalJSON({kind:module.kind,payload:module.payload})).digest('hex');assert.equal(module.hash,hash);assert.ok(fs.existsSync(path.join(root,'modules',ref.id,'1.json')));
});
test('新能力和固定素材一起打包到第二项目，模块运行版本不会因外观降级',()=>{
  fs.mkdirSync('test-results',{recursive:true});const a=new ProjectStore(fs.mkdtempSync('test-results/capability-assets-source-')),b=new ProjectStore(fs.mkdtempSync('test-results/capability-assets-target-'));
  const asset=a.assets.prepare(a.data,{id:null,baseVersion:null,name:'任务木门',filename:'quest-door.png',mime:'image/png',data:png(4,10,[160,190,90,255]).toString('base64')});a.change(d=>a.assets.register(d,asset));
  const scene=withAppearanceFormat({...capabilityScene(),format:'craftmine.scene/4'});scene.objects[0].appearance=defaultAppearance(scene.objects[0],asset);a.importSave({format:'craftmine.save/1',scene,snapshot:INITIAL_SNAPSHOT});const tx=a.prepare(a.data.candidate.id,a.data.current,a.data.snapshot);a.commit(tx.id,tx.loadSnapshot);
  const ref=a.data.library.find(m=>m.kind==='creation'),pack=a.exportModule(ref.id,ref.latest);assert.equal(pack.format,'craftmine.module-package/1');assert.equal(pack.module.format,'craftmine.module/4');assert.ok(pack.module.dependencies.includes('assets@1'));assert.ok(pack.module.dependencies.includes('inventory.read@1'));assert.deepEqual(pack.assets,[asset]);
  b.importModule(pack);assert.deepEqual(b.exportModule(ref.id,ref.latest),pack);const generated=b.modules.instantiate(b.data,EMPTY_SCENE,ref.id,ref.latest,INITIAL_SNAPSHOT.player),build=b.build(generated);
  assert.equal(generated.format,'craftmine.scene/4');assert.equal(generated.objects[0].appearance.asset.hash,asset.hash);assert.ok(build.behaviors.every(s=>s.definition.format==='craftmine.behavior/3'));assert.equal(build.assets[0].hash,asset.hash);
});
test('隐藏物体仍受场地约束，诊断准确指出对象、部件和实际坐标',()=>{
  const scene=capabilityScene();scene.objects[0].position.y=-4;
  assert.throws(()=>compileScene(scene),error=>error.message.includes('door-one')&&error.message.includes('第 1 个部件')&&error.message.includes('"y":-4')&&error.message.includes('visible:false'));
});
