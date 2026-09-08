import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AgentRunner } from '../app/agent.mjs';
import { ProjectStore } from '../app/store.mjs';
import { EMPTY_SCENE,INITIAL_SNAPSHOT,encodeAgentScene } from '../app/scene.mjs';
import { floraScene } from './scene-fixtures.mjs';
import { behaviorScene } from './behavior-fixtures.mjs';
import { BehaviorState } from '../app/behavior-state.mjs';
import { GameplaySession } from '../app/gameplay.mjs';

fs.mkdirSync('test-results',{recursive:true});
const fixture=()=>new ProjectStore(fs.mkdtempSync(path.resolve('test-results/agent-unit-')));
const response=scene=>JSON.stringify({summary:'修改后的候选',notes:[],reuseCreations:[],scene:encodeAgentScene(scene)});
const changed=()=>({...encodeAgentScene(EMPTY_SCENE),title:'新的世界'});
class ScriptedRunner extends AgentRunner {
  constructor(store,generate,options){super(store,options);this.respond=generate;this.calls=[];}
  executable(){return 'fixture-provider';}
  generate(input){this.calls.push(input);return this.respond(input,this);}
}
async function run(runner,{selected=null}={}){
  const id=runner.start('按当前需求修改','execute',{version:runner.store.data.current,player:INITIAL_SNAPSHOT.player,selected});
  await runner.active.done;return runner.store.data.tasks.find(t=>t.id===id);
}
test('格式错误进入有限修复，失败原文保留，只有通过的结果形成候选',async()=>{
  const store=fixture(),before=store.data.current,library=structuredClone(store.data.library),runner=new ScriptedRunner(store,async input=>{
    if(input.number===1)return '{ invalid JSON';
    assert.match(input.prompt,/回复格式/);assert.match(input.prompt,/invalid JSON/);
    store.save(before,{...INITIAL_SNAPSHOT,player:{...INITIAL_SNAPSHOT.player,x:9}});return response(changed());
  });
  const task=await run(runner);assert.equal(task.status,'ready');assert.deepEqual(task.attempts.map(a=>a.status),['failed','passed']);
  assert.equal(store.data.current,before);assert.equal(store.data.candidate.base,before);assert.equal(store.data.snapshot.player.x,9);assert.deepEqual(store.data.library,library);
  assert.equal(store.readAttempt(task.id,1).response,'{ invalid JSON');assert.equal(store.readAttempt(task.id,1).diagnostic.stage,'response');
  assert.equal(store.readAttempt(task.id,2).response.scene.title,'新的世界');assert.throws(()=>store.readAttempt('../../project',1));
  assert.deepEqual(new ProjectStore(store.root).data.tasks.at(-1).attempts,task.attempts);
});
test('修复仍以原始选中范围校验，不能把越界修改当成新基准',async()=>{
  const store=fixture(),scene=floraScene();store.importSave({format:'craftmine.save/1',scene,snapshot:INITIAL_SNAPSHOT});let tx=store.prepare(store.data.candidate.id,store.data.current,INITIAL_SNAPSHOT);store.commit(tx.id,INITIAL_SNAPSHOT);
  const runner=new ScriptedRunner(store,async input=>{const edited=structuredClone(scene);edited.objects[input.number===1?1:0].parts[0].color='#aabbcc';return response(edited);});
  const task=await run(runner,{selected:scene.objects[0].id});assert.equal(task.status,'ready');assert.equal(task.attempts[0].diagnostic.stage,'scope');
  assert.deepEqual(store.readBuild(store.data.candidate.id).scene.objects[1],scene.objects[1]);
});
test('持续无效输出最多三次尝试，保留所有失败记录且不生成候选',async()=>{
  const store=fixture(),runner=new ScriptedRunner(store,async()=>'{bad'),task=await run(runner);
  assert.equal(runner.calls.length,3);assert.equal(task.status,'failed');assert.match(task.error,/两次自动修复上限/);assert.equal(store.data.candidate,null);
  for(const a of task.attempts)assert.equal(store.readAttempt(task.id,a.number).diagnostic.repairable,true);
});
test('修复中取消会阻止迟到的成功结果成为候选，也不会继续下一次',async()=>{
  const store=fixture();let second;const started=new Promise(resolve=>second=resolve);
  const runner=new ScriptedRunner(store,async input=>{if(input.number===1)return '{bad';second();await new Promise(resolve=>input.active.abort.signal.addEventListener('abort',resolve,{once:true}));return response(changed());});
  const done=run(runner);await started;runner.cancel();const task=await done;
  assert.equal(task.status,'cancelled');assert.equal(task.attempts.at(-1).diagnostic.stage,'cancelled');assert.equal(runner.calls.length,2);assert.equal(store.data.candidate,null);
});
test('全部尝试共用总时限，超时终止当前生成并停止修复',async()=>{
  const store=fixture(),deadlines=[];
  const runner=new ScriptedRunner(store,async input=>{deadlines.push(input.active.deadline);if(input.number===1)return '{bad';await new Promise(resolve=>input.active.abort.signal.addEventListener('abort',resolve,{once:true}));return response(changed());},{timeoutMs:200});
  const task=await run(runner);assert.equal(task.status,'failed');assert.equal(task.attempts.at(-1).diagnostic.stage,'deadline');assert.equal(new Set(deadlines).size,1);assert.equal(runner.calls.length,2);assert.equal(store.data.candidate,null);
});
test('模型连接失败不消耗自动改写次数，运行中断的记录重启后明确标记',async()=>{
  const store=fixture(),runner=new ScriptedRunner(store,async()=>{throw Error('Provider unavailable');}),task=await run(runner);
  assert.equal(task.attempts.length,1);assert.equal(task.attempts[0].diagnostic.repairable,false);assert.equal(task.attempts[0].diagnostic.stage,'provider');
  store.change(d=>{const t=d.tasks.at(-1);t.status='validating';t.attempts.at(-1).status='running';});
  const restored=new ProjectStore(store.root);assert.equal(restored.data.tasks.at(-1).status,'interrupted');assert.equal(restored.data.tasks.at(-1).attempts.at(-1).status,'interrupted');
});
test('不兼容状态在后台运行前形成进度诊断，不清空既有开门状态',async()=>{
  const store=fixture(),scene=behaviorScene(),build=store.build(scene),state=new BehaviorState(build);state.value.modules['sliding-door'].state.open=true;
  const snapshot={...INITIAL_SNAPSHOT,format:'craftmine.progress/3',gameplay:new GameplaySession(scene.systems,scene.objects).snapshot(),behaviors:state.snapshot()};
  store.importSave({format:'craftmine.save/1',scene,snapshot});const tx=store.prepare(store.data.candidate.id,store.data.current,INITIAL_SNAPSHOT);store.commit(tx.id,snapshot);
  const changed=structuredClone(scene);changed.behaviors[0].stateVersion=2;
  const runner=new ScriptedRunner(store,async()=>response(changed)),task=await run(runner);
  assert.equal(task.status,'failed');assert.equal(task.attempts.length,3);assert.ok(task.attempts.every(a=>a.diagnostic.stage==='progress'));
  assert.equal(store.data.snapshot.behaviors.modules['sliding-door'].state.open,true);assert.equal(store.data.candidate,null);
});
