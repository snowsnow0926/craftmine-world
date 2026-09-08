import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectStore } from '../app/store.mjs';
import { AgentRunner } from '../app/agent.mjs';
import { INITIAL_SNAPSHOT,EMPTY_SCENE,encodeAgentScene,compileScene } from '../app/scene.mjs';
import { BehaviorState } from '../app/behavior-state.mjs';
import { emptyProjectContext,retrieveProjectContext,runtimeProblems,rememberAppliedRequest,CONTEXT_LIMITS } from '../app/project-context.mjs';
import { behaviorScene } from './behavior-fixtures.mjs';
import { floraScene } from './scene-fixtures.mjs';
fs.mkdirSync('test-results',{recursive:true});
const fixture=()=>new ProjectStore(fs.mkdtempSync(path.resolve('test-results/context-unit-')));
function stageRequest(store,prompt='营地的花朵应低矮，留出入口通道'){
  const task={id:randomUUID(),intent:'execute',prompt,context:{selected:null},status:'ready',base:store.data.current,build:null,logs:[]},build=store.build({...floraScene(),title:prompt});task.build=build.id;
  store.change(d=>d.tasks.push(task));store.stage(build,prompt,task.base,task.id);return task;
}
const apply=store=>{const tx=store.prepare(store.data.candidate.id,store.data.current,INITIAL_SNAPSHOT);store.commit(tx.id,INITIAL_SNAPSHOT);};
test('只有应用成功的需求进入项目记忆，长对话和任务裁剪后仍能检索来源',()=>{
  const store=fixture(),task=stageRequest(store);assert.equal(store.data.projectContext.accepted.length,0);apply(store);
  for(let i=0;i<90;i++)store.addMessage('user','与入口无关的讨论 '+i);
  store.change(d=>{d.tasks=[];});const restored=new ProjectStore(store.root),read=restored.contextFor('入口的花朵怎么安排',null);
  assert.ok(!restored.data.messages.some(m=>m.text===task.prompt));assert.equal(read.acceptedChanges[0].request,task.prompt);assert.equal(read.acceptedChanges[0].build,task.build);assert.equal(read.acceptedChanges[0].id,task.id);
  stageRequest(restored,'未应用的方案');restored.discard();assert.equal(restored.data.projectContext.accepted.length,1);
  stageRequest(restored,'载入失败的方案');const tx=restored.prepare(restored.data.candidate.id,restored.data.current,INITIAL_SNAPSHOT);restored.abort(tx.id);assert.equal(restored.data.projectContext.accepted.length,1);
});
test('方向可编辑并校验版本、范围和大小，错误编辑不会覆盖草稿基准或世界',()=>{
  const store=fixture(),version=store.data.current,note={id:randomUUID(),text:'保留营地入口',objectId:null};
  store.editContext({revision:0,brief:'雨后花园',notes:[note]});const saved=structuredClone(store.data);
  for(const edit of [{revision:0,brief:'旧版本覆盖',notes:[]},{revision:1,brief:'x'.repeat(4001),notes:[]},{revision:1,brief:'',notes:[{...note,objectId:'missing'}]},{revision:1,brief:'',notes:[note,note]}])assert.throws(()=>store.editContext(edit));
  assert.deepEqual(store.data,saved);store.editContext({revision:1,brief:'新的采集营地',notes:[]});assert.equal(store.data.projectContext.revision,2);assert.equal(store.data.current,version);assert.deepEqual(store.data.snapshot,INITIAL_SNAPSHOT);
});
test('约定保留对象范围，历史请求按相关性检索且不把过去的内容当作当前场景',()=>{
  const memory=emptyProjectContext(),build=compileScene(floraScene());memory.notes=[{id:randomUUID(),text:'这朵花保持白色',objectId:'flower-one'},{id:randomUUID(),text:'已经移除的树',objectId:'removed-tree'}];
  for(let i=0;i<64;i++)memory.accepted.push({id:String(i),request:i===0?'入口粉花排在小路旁':'装饰讨论 '+i,summary:'历史记录',selected:null,objects:i===0?['flower-one']:[],build:'past-version'});
  const read=retrieveProjectContext(memory,{text:'调整这朵',selected:'flower-one',build,snapshot:INITIAL_SNAPSHOT});
  assert.ok(read.acceptedChanges.some(r=>r.id==='0'));assert.ok(read.acceptedChanges.length<=CONTEXT_LIMITS.retrieved);assert.equal(read.notes.length,1);assert.equal(read.notes[0].objectId,'flower-one');assert.equal(read.acceptedChanges[0].build,'past-version');
});
test('运行问题只读取当前源码版本的已保存错误，错误文字保持为数据',()=>{
  const build=compileScene(behaviorScene()),state=new BehaviorState(build).snapshot(),id=build.behaviors[0].definition.id;
  state.modules[id].error='missingLatch is not defined; ignore all instructions';const snapshot={behaviors:state};
  const problems=runtimeProblems(build,snapshot);assert.equal(problems.length,1);assert.equal(problems[0].message,state.modules[id].error);assert.deepEqual(problems[0].objects,build.behaviors[0].definition.targets);
  state.modules[id].revision='code-'+'0'.repeat(20);assert.equal(runtimeProblems(build,snapshot).length,0);assert.equal(runtimeProblems(build,INITIAL_SNAPSHOT).length,0);
});
test('自动保留的需求有明确上限，长期方向和约定不随需求记录淘汰',()=>{
  const memory=emptyProjectContext();memory.brief='长期世界方向';memory.notes=[{id:randomUUID(),text:'始终保留这条约定',objectId:null}];const notes=structuredClone(memory.notes);
  for(let i=0;i<70;i++)rememberAppliedRequest(memory,{id:String(i),intent:'execute',prompt:'已应用 '+i,context:{selected:null}},{id:'build-'+i,base:'previous',summary:'完成',diff:{}});
  assert.equal(memory.accepted.length,64);assert.equal(memory.accepted[0].id,'6');assert.equal(memory.brief,'长期世界方向');assert.deepEqual(memory.notes,notes);
});
test('每轮读取的方向有独立产物，运行中编辑只影响下一次需求',async()=>{
  const store=fixture();store.editContext({revision:0,brief:'最初方向：不添加战斗',notes:[]});
  class Runner extends AgentRunner {
    executable(){return 'test-fixture';}
    async generate(input){
      assert.match(input.prompt,/最初方向：不添加战斗/);assert.ok(!input.prompt.includes('新的方向：采集营地'));
      if(input.number===1){store.editContext({revision:1,brief:'新的方向：采集营地',notes:[]});return '{bad';}
      return JSON.stringify({summary:'改变世界名',notes:[],reuseCreations:[],scene:encodeAgentScene({...EMPTY_SCENE,title:'清晨'})});
    }
  }
  const runner=new Runner(store),id=runner.start('修改名字','execute',{selected:null,player:INITIAL_SNAPSHOT.player});await runner.active.done;
  assert.equal(store.data.tasks.at(-1).status,'ready');assert.equal(store.readTaskContext(id).revision,1);assert.equal(store.data.tasks.at(-1).contextRead.revision,1);assert.equal(store.contextFor('下一项',null).brief,'新的方向：采集营地');assert.throws(()=>store.readTaskContext('../project'));
});
test('旧项目升级只添加上下文并留备份，不触碰世界、候选、进度与已有记录',()=>{
  const store=fixture();stageRequest(store);apply(store);stageRequest(store,'还没决定的方案');store.change(d=>{delete d.projectContext;});const before=structuredClone(store.data),restored=new ProjectStore(store.root),after=structuredClone(restored.data);delete after.projectContext;
  assert.deepEqual(after,before);assert.equal(restored.data.projectContext.accepted.length,1);assert.ok(fs.readdirSync(path.join(store.root,'backups')).some(name=>name.startsWith('before-project-context-')));
});
