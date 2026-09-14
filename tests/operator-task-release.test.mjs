import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {operatorReleaseIdentity,operatorReleasePageScript} from './helpers/operator-task-release.mjs';
const live=()=>({active:false,context:{world:{id:'w'},binding:{taskId:'t',sessionId:'s'},generation:4,recovery:'interrupted'}});
test('release identity rejects other worlds, sessions, running tasks and stale recovery',()=>{
  const owner={worldId:'w',sessionId:'s'};assert.deepEqual(operatorReleaseIdentity(live(),owner),{...owner,taskId:'t',generation:4});
  for(const change of [v=>v.active=true,v=>v.context.world.id='other',v=>v.context.binding.sessionId='other',v=>v.context.recovery='running',v=>v.context.generation=-1]){const value=live();change(value);assert.throws(()=>operatorReleaseIdentity(value,owner));}
});
async function run({value=live(),headless=true,worldId='w',count=1,disabled=false,error=false,submit=true}={}){
  const calls=[],form={querySelector:selector=>selector==='button:disabled'?(disabled?{}:null):{textContent:'解除本地次数与时长限制后继续'},requestSubmit:()=>calls.push('requestSubmit')};
  const document={body:{dataset:{worldId}},querySelector:selector=>selector.startsWith('form')?(count?form:null):selector==='.workbench-notice'?{textContent:error?'explicit UI failure':'已更新',dataset:{error:String(error)}}:{hidden:false,textContent:'current task'},querySelectorAll:()=>Array(count).fill(form)};
  const context={__craftmineHeadless:headless,document,pluginBridge:{invoke:async(channel,payload)=>{calls.push({channel,payload});return value;}}};
  return {result:await vm.runInNewContext(operatorReleasePageScript({worldId:'w',sessionId:'s',taskId:'t',generation:4},submit),context),calls};
}
test('ordinary form performs only a read and requestSubmit, never direct release/resume calls',async()=>{
  const {result,calls}=await run();assert.equal(result.submitted,true);assert.equal(calls.length,2);assert.equal(calls[0].channel,'task.current');assert.equal(calls[1],'requestSubmit');
  const read=await run({submit:false});assert.equal(read.calls.length,1);assert.equal(read.result.formCount,1);
});
test('wrong identity, absent or ambiguous form, disabled button and explicit errors prevent submission',async()=>{
  const changed=live();changed.context.generation=5;
  for(const options of [{headless:false},{worldId:'other'},{value:changed},{count:0},{count:2},{disabled:true},{error:true}])await assert.rejects(()=>run(options));
});
