import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { compileBehavior } from '../app/behavior-build.mjs';
import { OBJECT_ID_PATTERN,EMPTY_SCENE,INITIAL_SNAPSHOT,compileScene,applySceneChanges,sceneIndex,sceneFocus,expandSceneObjects,playerBlockedBy } from '../app/scene.mjs';
import { exactKeys } from '../app/gameplay.mjs';
import { BehaviorState } from '../app/behavior-state.mjs';
import { ProjectStore } from '../app/store.mjs';
import { buildPrompt } from '../app/agent-prompt.mjs';
import { emptyProjectContext } from '../app/project-context.mjs';
import { modelProvider,modelId,providerStatus } from '../app/agent-model.mjs';
import { loadLocalConfig } from '../app/local-config.mjs';
import { validateBehavior,validateBehaviorFrame,validateBehaviorResult } from '../app/behavior-contracts.mjs';
import { doorBehavior,behaviorFrame } from './behavior-fixtures.mjs';

test('对象 ID 规则由运行器统一导出，提示词与校验共用同一份',()=>{
  assert.ok(OBJECT_ID_PATTERN.test('tree-1'));
  assert.ok(OBJECT_ID_PATTERN.test('oak-tree-01'));
  assert.ok(!OBJECT_ID_PATTERN.test('tree_1'));
  assert.ok(!OBJECT_ID_PATTERN.test('Tree1'));
  assert.ok(!OBJECT_ID_PATTERN.test('1tree'));
  assert.ok(!OBJECT_ID_PATTERN.test('a'.repeat(49)));
});

test('缺少 export 或使用 CommonJS 导出时，构建阶段就明确拒绝',()=>{
  const missing=doorBehavior();
  missing.code=missing.code.replace('export function step','function step');
  assert.throws(()=>compileBehavior(missing),/必须导出 step/);

  const commonjs=doorBehavior();
  commonjs.code='exports.step = function step({frame,params,state}){return {state,commands:[]};};';
  assert.throws(()=>compileBehavior(commonjs),/CommonJS/);

  const arrow=doorBehavior();
  arrow.code='export const step = ({frame,params,state}) => ({state,commands:[]});';
  assert.doesNotThrow(()=>compileBehavior(arrow));

  const named=doorBehavior();
  named.code='async function step({frame,params,state}){return {state,commands:[]};}\nexport { step };';
  assert.doesNotThrow(()=>compileBehavior(named));

  const asyncFn=doorBehavior();
  asyncFn.code='export async function step({frame,params,state}){return {state,commands:[]};}';
  assert.doesNotThrow(()=>compileBehavior(asyncFn));
});

test('语法错误仍然优先报告为语法错误',()=>{
  const broken=doorBehavior();
  broken.code='export function step( {';
  assert.throws(()=>compileBehavior(broken),/语法错误/);
});

test('提示词包含由运行器生成的 ID 与导出硬约束',()=>{
  const prompt=buildPrompt({scene:EMPTY_SCENE,memories:[],text:'我想要有树',intent:'执行这次需求并返回完整场景',
    context:{current:'v-empty',selected:null,player:INITIAL_SNAPSHOT.player},messages:[],snapshot:INITIAL_SNAPSHOT,
    projectContext:emptyProjectContext(),assets:[]});
  assert.match(prompt,/\^\[a-z\]\[a-z0-9-\]\{0,47\}\$/);
  assert.match(prompt,/并导出 step/);
  assert.match(prompt,/禁止 CommonJS/);
});

test('模型后端按显式配置与密钥推断，模型 ID 可配置',()=>{
  const saved={provider:process.env.CRAFTMINE_MODEL_PROVIDER,key:process.env.CRAFTMINE_DEEPSEEK_API_KEY,alt:process.env.DEEPSEEK_API_KEY,model:process.env.CRAFTMINE_MODEL};
  try{
    delete process.env.CRAFTMINE_MODEL_PROVIDER;delete process.env.CRAFTMINE_DEEPSEEK_API_KEY;delete process.env.DEEPSEEK_API_KEY;delete process.env.CRAFTMINE_MODEL;
    assert.equal(modelProvider(),'codex');
    assert.equal(modelId(),'');

    process.env.CRAFTMINE_DEEPSEEK_API_KEY='sk-fixture';
    assert.equal(modelProvider(),'deepseek');
    assert.equal(modelId(),'deepseek-v4.1-flash-expires-on-0910');
    assert.equal(providerStatus().available,true);
    assert.match(providerStatus().message,/DeepSeek 官方 API/);

    process.env.CRAFTMINE_MODEL='deepseek-v4-flash';
    assert.equal(modelId(),'deepseek-v4-flash');

    process.env.CRAFTMINE_MODEL_PROVIDER='codex';
    assert.equal(modelProvider(),'codex');
    assert.equal(modelId(),'deepseek-v4-flash');

    delete process.env.CRAFTMINE_MODEL_PROVIDER;delete process.env.CRAFTMINE_DEEPSEEK_API_KEY;delete process.env.CRAFTMINE_MODEL;
    process.env.CRAFTMINE_MODEL_PROVIDER='deepseek';
    assert.equal(providerStatus().available,false);
    assert.match(providerStatus().message,/未配置 DeepSeek 密钥/);
  }finally{
    for(const [key,value] of Object.entries({CRAFTMINE_MODEL_PROVIDER:saved.provider,CRAFTMINE_DEEPSEEK_API_KEY:saved.key,DEEPSEEK_API_KEY:saved.alt,CRAFTMINE_MODEL:saved.model})){
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
});

test('本地密钥文件在数据目录加载，不覆盖已有环境变量，非法内容直接报错',()=>{
  fs.mkdirSync('test-results',{recursive:true});
  const dir=fs.mkdtempSync(path.resolve('test-results/local-config-')),file=path.join(dir,'secrets.json');
  assert.deepEqual(loadLocalConfig(file,{}),[]);

  fs.writeFileSync(file,JSON.stringify({CRAFTMINE_DEEPSEEK_API_KEY:'sk-from-file',CRAFTMINE_MODEL_PROVIDER:'deepseek'}));
  const env={CRAFTMINE_MODEL_PROVIDER:'codex'};
  assert.deepEqual(loadLocalConfig(file,env),['CRAFTMINE_DEEPSEEK_API_KEY']);
  assert.equal(env.CRAFTMINE_DEEPSEEK_API_KEY,'sk-from-file');
  assert.equal(env.CRAFTMINE_MODEL_PROVIDER,'codex');

  fs.writeFileSync(file,'{ not json');
  assert.throws(()=>loadLocalConfig(file,{}),/有效 JSON/);
  fs.writeFileSync(file,JSON.stringify({bad_key:'x'}));
  assert.throws(()=>loadLocalConfig(file,{}),/键名无效/);
  fs.writeFileSync(file,JSON.stringify({CRAFTMINE_MODEL:42}));
  assert.throws(()=>loadLocalConfig(file,{}),/非空字符串/);
});

test('实心重叠报错给出双方 ID、重叠区域与最小分离方向',()=>{
  const box=(id,x)=>({id,name:id,position:{x,y:6,z:0},source:null,components:{health:0,contactDamage:0},
    parts:[{shape:'box',offset:{x:0,y:0,z:0},size:{x:2,y:2,z:2},material:'stone',color:'#8a8a8a',solid:true}]});
  const scene={format:'craftmine.scene/3',title:'重叠',night:false,systems:[],behaviors:[],objects:[box('box-a',0),box('box-b',1)]};
  assert.throws(()=>compileScene(scene),error=>{
    assert.match(error.message,/box-a/);
    assert.match(error.message,/box-b/);
    assert.match(error.message,/最小分离方向/);
    assert.match(error.message,/重叠区域/);
    return true;
  });
});

test('字段不匹配报错指出缺少与多出的键',()=>{
  assert.throws(()=>exactKeys({a:1,b:2},['a']),/多出 b/);
  assert.throws(()=>exactKeys({a:1},['a','b']),/缺少 b/);
  assert.throws(()=>exactKeys(null,['a']),/需要一个 JSON 对象/);
  assert.doesNotThrow(()=>exactKeys({a:1,b:2},['a','b']));
});

const box=(id,x)=>({id,name:id.toUpperCase(),position:{x,y:6,z:0},source:null,components:{health:0,contactDamage:0},
  parts:[{shape:'box',offset:{x:0,y:0,z:0},size:{x:1,y:1,z:1},material:'stone',color:'#8a8a8a',solid:true}]});
const patchScene=()=>({format:'craftmine.scene/3',title:'局部修改',night:false,systems:[],behaviors:[],objects:[box('box-a',0),box('box-b',10)]});
const doorDefinition={format:'craftmine.behavior/1',id:'door-x',name:'门',description:'开关',stateVersion:1,
  code:'export function step({frame,params,state}){return {state,commands:[]};}',
  initialStateJSON:'{"open":false}',paramsJSON:'{}',targets:['box-a'],permissions:['objects.write']};

test('局部修改只改动指定对象，其余对象与基准场景保持不变',()=>{
  const base=patchScene();
  const next=applySceneChanges(base,[{op:'object.patch',id:'box-a',parts:[{...base.objects[0].parts[0],size:{x:1,y:2,z:1}}]}]);
  assert.equal(next.objects.length,2);
  assert.equal(next.objects.find(o=>o.id==='box-a').parts[0].size.y,2);
  assert.deepEqual(next.objects.find(o=>o.id==='box-b'),base.objects[1]);
  assert.equal(base.objects[0].parts[0].size.y,1,'基准场景不能被就地改写');
  assert.doesNotThrow(()=>compileScene(next));
});

test('局部修改支持增删对象、设置模块与系统，并拒绝无效操作',()=>{
  const base=patchScene();
  const added=applySceneChanges(base,[{op:'object.add',object:box('box-c',20)}]);
  assert.equal(added.objects.length,3);
  assert.equal(applySceneChanges(added,[{op:'object.remove',id:'box-c'}]).objects.length,2);

  const withBehavior=applySceneChanges(base,[{op:'behavior.set',behavior:doorDefinition}]);
  assert.equal(withBehavior.behaviors.length,1);
  assert.deepEqual(withBehavior.behaviors[0].initialState,{open:false});
  assert.equal(applySceneChanges(withBehavior,[{op:'behavior.remove',id:'door-x'}]).behaviors.length,0);

  const withSystem=applySceneChanges(base,[{op:'system.set',system:{id:'life',name:'生命值',type:'health',config:{maxHealth:100,fallDamage:5,regenPerSecond:0},source:null}}]);
  assert.equal(withSystem.systems.length,1);
  assert.equal(applySceneChanges(withSystem,[{op:'system.remove',id:'life'}]).systems.length,0);

  assert.throws(()=>applySceneChanges(base,[{op:'object.patch',id:'missing'}]),/不存在/);
  assert.throws(()=>applySceneChanges(base,[{op:'object.add',object:base.objects[0]}]),/已存在/);
  assert.throws(()=>applySceneChanges(base,[{op:'object.patch',id:'box-a'},{op:'object.patch',id:'box-a'}]),/重复操作/);
  assert.throws(()=>applySceneChanges(base,[{op:'unknown',id:'box-a'}]),/不支持/);
  assert.throws(()=>applySceneChanges(base,[{op:'object.patch',id:'box-a',extra:1}]),/字段无效/);
  assert.throws(()=>applySceneChanges(base,[]),/1–64/);
});

test('输入侧按需读取：索引给概要，焦点只展开相关对象，read 可补读',()=>{
  const scene={format:'craftmine.scene/3',title:'按需读取',night:false,systems:[],behaviors:[],
    objects:[box('obj-0',0),box('obj-1',6),box('obj-2',12),box('obj-3',18),box('obj-4',24),box('obj-5',30)]};

  const index=sceneIndex(scene,{player:{x:0,y:6,z:0},selected:null});
  assert.equal(index.format,'craftmine.index/1');
  assert.equal(index.count,6);
  assert.equal(typeof index.objects[0].parts,'number','索引只给部件数量，不给完整定义');
  assert.deepEqual(index.objects[0].size,[1,1,1]);
  assert.ok(JSON.stringify(index).length<JSON.stringify(scene).length,'索引比完整场景小');

  assert.deepEqual(sceneFocus(scene,{player:null,selected:null,text:'把 obj-4 变高'}).map(o=>o.id),['obj-4']);
  assert.deepEqual(sceneFocus(scene,{selected:'obj-2'}).map(o=>o.id),['obj-2']);
  const near=sceneFocus(scene,{player:{x:0,y:6,z:0},selected:null,text:''}).map(o=>o.id);
  assert.deepEqual(near,['obj-0','obj-1','obj-2'],'14 米内的对象才会被展开');

  assert.deepEqual(expandSceneObjects(scene,['obj-3']).map(o=>o.id),['obj-3']);
  assert.throws(()=>expandSceneObjects(scene,['missing']),/不存在/);
  assert.throws(()=>expandSceneObjects(scene,[]),/1–12/);
  assert.throws(()=>expandSceneObjects(scene,new Array(13).fill('obj-0')),/1–12/);
});

test('提示词带索引与焦点，不再包含整个场景',()=>{
  const scene={format:'craftmine.scene/3',title:'提示词',night:false,systems:[],behaviors:[],
    objects:[box('obj-0',0),box('obj-1',6)]};
  const prompt=buildPrompt({scene,memories:[],text:'把 obj-1 抬高一点',intent:'执行',
    context:{current:'v-test',selected:null,player:{x:0,y:6,z:0}},messages:[],snapshot:INITIAL_SNAPSHOT,
    projectContext:emptyProjectContext(),assets:[]});
  assert.match(prompt,/场景索引（数据/);
  assert.match(prompt,/已展开的对象完整定义（数据/);
  assert.match(prompt,/"obj-1"/);
  assert.match(prompt,/read/);
  assert.ok(!prompt.includes('当前完整场景（数据）'),'不再整场景进提示');
});

test('object.patch 命令允许省略字段（省略等于保留），未知字段仍被拒绝',()=>{
  const definition=doorBehavior(),frame=behaviorFrame(),coordinates={local:false,definition};
  const omitted=validateBehaviorResult({state:{open:true},commands:[{type:'object.patch',id:'door-one'}]},definition,frame,coordinates);
  assert.deepEqual(omitted.commands[0],{type:'object.patch',id:'door-one',position:null,visible:null,solid:null,color:null});
  assert.throws(()=>validateBehaviorResult({state:{open:true},commands:[{type:'object.patch',id:'door-one',extra:1}]},definition,frame,coordinates),/多出 extra/);
});

test('音效命令需要 audio.play 权限，且只接受内置音效名',()=>{
  const definition={...doorBehavior(),permissions:['audio.play']},frame=behaviorFrame(),coordinates={local:false,definition};
  const accepted=validateBehaviorResult({state:{open:true},commands:[{type:'audio.play',sound:'shoot'}]},definition,frame,coordinates);
  assert.equal(accepted.commands[0].sound,'shoot');
  assert.throws(()=>validateBehaviorResult({state:{open:true},commands:[{type:'audio.play',sound:'boom'}]},definition,frame,coordinates),/音效名称无效/);
  const noPermission=doorBehavior();
  assert.throws(()=>validateBehaviorResult({state:{open:true},commands:[{type:'audio.play',sound:'shoot'}]},noPermission,frame,{local:false,definition:noPermission}),/权限/);
});

test('应用候选时用玩家此刻的位置检查：站在新实心几何里会被拒绝并指出对象',()=>{
  fs.mkdirSync('test-results',{recursive:true});
  const compiled=compileScene(patchScene());
  assert.equal(playerBlockedBy(compiled,{x:0.5,y:6,z:0.5}),'box-a');
  assert.equal(playerBlockedBy(compiled,{x:5,y:6,z:5}),null);

  const store=new ProjectStore(fs.mkdtempSync(path.resolve('test-results/harness-blocked-')));
  const build=store.build(patchScene());
  store.stage(build,'挡住玩家',store.data.current,null);
  const inside={...INITIAL_SNAPSHOT,player:{...INITIAL_SNAPSHOT.player,x:0.5,y:6,z:0.5}};
  const away={...INITIAL_SNAPSHOT,player:{...INITIAL_SNAPSHOT.player,x:5,y:6,z:5}};
  assert.throws(()=>store.prepare(build.id,store.data.current,inside),/会挡住你：.*box-a/);
  assert.doesNotThrow(()=>store.prepare(build.id,store.data.current,away));
});

test('按键声明：只能声明引擎未占用的键，最多 4 个且不能重复',()=>{
  assert.doesNotThrow(()=>validateBehavior({...doorBehavior(),keys:['KeyG']}));
  assert.doesNotThrow(()=>validateBehavior(doorBehavior()),'keys 是可选字段');
  assert.throws(()=>validateBehavior({...doorBehavior(),keys:['KeyR']}),/按键声明无效/,'R 被换弹占用');
  assert.throws(()=>validateBehavior({...doorBehavior(),keys:['KeyG','KeyG']}),/按键声明无效/);
  assert.throws(()=>validateBehavior({...doorBehavior(),keys:['KeyG','KeyH','KeyJ','KeyK','KeyL']}),/按键声明无效/);
});

test('提示词说明按键事件与 frame.keys 不存在，避免模型写出空操作',()=>{
  const prompt=buildPrompt({scene:EMPTY_SCENE,memories:[],text:'按 G 刷新怪物',intent:'执行',
    context:{current:'v-test',selected:null,player:INITIAL_SNAPSHOT.player},messages:[],snapshot:INITIAL_SNAPSHOT,
    projectContext:emptyProjectContext(),assets:[]});
  assert.match(prompt,/不存在 frame\.keys/);
  assert.match(prompt,/keys:\[可选按键\]/);
  assert.match(prompt,/KeyG/);
});

test('复活目标命令需要 targets.write 权限，且只能用于声明的目标',()=>{
  const definition={...doorBehavior(),permissions:['targets.write'],targets:['door-one']};
  const frame=behaviorFrame(),coordinates={local:false,definition};
  const accepted=validateBehaviorResult({state:{open:false},commands:[{type:'target.revive',id:'door-one'}]},definition,frame,coordinates);
  assert.equal(accepted.commands[0].id,'door-one');
  assert.throws(()=>validateBehaviorResult({state:{open:false},commands:[{type:'target.revive',id:'other'}]},definition,frame,coordinates),/未授权/);
  const noPermission=doorBehavior();
  assert.throws(()=>validateBehaviorResult({state:{open:false},commands:[{type:'target.revive',id:'door-one'}]},noPermission,frame,{local:false,definition:noPermission}),/权限/);
});

test('按键事件通过帧校验，未声明的键和未知事件类型被拒绝',()=>{
  const definition={...doorBehavior(),keys:['KeyG']},base=behaviorFrame();
  assert.doesNotThrow(()=>validateBehaviorFrame({...base,event:{type:'key',targetId:null,code:'KeyG'}},{local:false,definition}));
  assert.throws(()=>validateBehaviorFrame({...base,event:{type:'key',targetId:null,code:'KeyR'}},{local:false,definition}),/事件无效/);
  assert.throws(()=>validateBehaviorFrame({...base,event:{type:'unknown',targetId:null}},{local:false,definition}),/事件无效/);
});

test('改代码（状态版本兼容）不会重置已领取的一次性奖励与背包',()=>{
  const behavior=code=>({format:'craftmine.behavior/1',id:'reward-chest',name:'奖励箱',description:'一次性奖励',stateVersion:1,code,
    initialState:{rewarded:false},params:{},targets:['box-a'],permissions:['inventory.write']});
  const base={format:'craftmine.scene/3',title:'奖励',night:false,systems:[],objects:[box('box-a',0)]};
  const frame=()=>({...behaviorFrame(),inventory:{}});

  const before=compileScene({...base,behaviors:[behavior('export function step({frame,params,state}){return {state,commands:[]};}')]});
  const stateBefore=new BehaviorState(before);
  stateBefore.apply(before.behaviors[0],{state:{rewarded:true},commands:[{type:'inventory.add',item:'wood',count:3}]},frame());
  assert.equal(stateBefore.value.inventory.wood,3);
  const saved=stateBefore.snapshot();

  const after=compileScene({...base,behaviors:[behavior('export function step({frame,params,state}){return {state:{...state,revision:2},commands:[]};}')]});
  const stateAfter=new BehaviorState(after,saved);
  assert.deepEqual(stateAfter.value.modules['reward-chest'].state,{rewarded:true},'已领取状态必须保留');
  assert.equal(stateAfter.value.inventory.wood,3,'背包不能被重置');
});
