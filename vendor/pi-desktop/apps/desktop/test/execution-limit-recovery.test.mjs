import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
register(new URL('./helpers/ts-import-hooks.mjs',import.meta.url));
const {releaseAndContinueTask,isExecutionLimitFailure}=await import('../src/lib/execution-limit-recovery.ts');

function fixture(){
  const calls=[];let selected='world',session='session',released=0,executeError=false;
  const task={binding:{taskId:'task',sessionId:'session'},generation:2};
  const opts={sessionId:'session',assertSession(){assert.equal(session,'session','changed session');},onReleased(){released++;},
    async call(channel,payload){calls.push({channel,payload});
      if(channel==='world.list')return{activeWorldId:selected};
      if(channel==='task.current')return{context:task};
      if(channel==='workbench.prepare')return{operationId:'operation'};
      if(channel==='workbench.execute'){if(executeError)throw Error('uncertain');return{kind:'player-execution-limit-release',taskId:'task',generation:2,worldId:'world',modelReplay:false,resumed:false};}
      if(channel==='task.resume')return{continuation:'running'};
      throw Error('unexpected call');
    }};
  return{opts,calls,task,get released(){return released;},set executeError(v){executeError=v;},set selected(v){selected=v;},set session(v){session=v;}};
}
test('only local execution limit errors offer release, never token/provider/context failures',()=>{
  for(const code of ['COMPACTION_BUDGET_EXHAUSTED','REQUEST_BUDGET_EXHAUSTED','TASK_DEADLINE_EXCEEDED'])assert(isExecutionLimitFailure(code));
  for(const code of ['TOKEN_BUDGET_EXHAUSTED','CONTEXT_OVERFLOW','PROVIDER_UNAUTHORIZED','ordinary text',null])assert(!isExecutionLimitFailure(code));
});
test('explicit action journals release then continues the same saved task without replaying its prompt',async()=>{
  const f=fixture();assert.equal((await releaseAndContinueTask(f.opts)).continuation,'running');
  assert.deepEqual(f.calls.map(x=>x.channel),['world.list','task.current','workbench.prepare','workbench.execute','world.list','task.resume']);
  assert.deepEqual(f.calls.at(-1).payload,{worldId:'world',taskId:'task',generation:2});assert.equal(f.released,1);
  assert.deepEqual(f.calls[2].payload.payload,{taskId:'task',generation:2});
});
test('unknown release outcome never starts a model continuation',async()=>{
  const f=fixture();f.executeError=true;await assert.rejects(releaseAndContinueTask(f.opts),/uncertain/);
  assert.equal(f.released,0);assert(!f.calls.some(x=>x.channel==='task.resume'));
});
test('session or selected world change prevents continuation after a committed release',async()=>{
  for(const changed of ['session','world']){
    const f=fixture();f.opts.onReleased=()=>{if(changed==='session')f.session='another';else f.selected='another';};
    await assert.rejects(releaseAndContinueTask(f.opts));assert(!f.calls.some(x=>x.channel==='task.resume'));
  }
});
test('foreign task owner and mismatched receipt cannot authorize a continuation',async()=>{
  const f=fixture();f.task.binding.sessionId='another';await assert.rejects(releaseAndContinueTask(f.opts),/STALE_TASK/);
  assert(!f.calls.some(x=>x.channel==='workbench.prepare'));
  const other=fixture(),call=other.opts.call;other.opts.call=async(channel,payload)=>channel==='workbench.execute'?{kind:'player-execution-limit-release',taskId:'wrong',generation:2,worldId:'world',modelReplay:false,resumed:false}:call(channel,payload);
  await assert.rejects(releaseAndContinueTask(other.opts),/INVALID_OPERATION_RECEIPT/);assert(!other.calls.some(x=>x.channel==='task.resume'));
});
