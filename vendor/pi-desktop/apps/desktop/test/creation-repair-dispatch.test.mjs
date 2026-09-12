import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createCreationRepairDispatcher,creationRepairPrompt,repairFollowsLatestRequest,repairOwnsUncheckedWork} from '../electron/main/creation-repair-dispatch.ts';
const input={context:{projectId:'project',sessionId:'session',turnId:'original-turn'},worldId:'world-1',jobId:'gjob-'+'a'.repeat(64),reason:'GDScript parse error'};
function fixture(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fb02-auto-repair-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));let allowed=true,state={state:'absent'};const calls=[];
  const deps={directory,authorize:async()=>{if(!allowed)throw Error('CREATION_AUTO_APPLY_NOT_AUTHORIZED');},lookup:async()=>state,
    submit:async(original,request)=>{calls.push({original,request});return {accepted:true,turnId:'repair-turn'};}};
  return {deps,calls,create:()=>createCreationRepairDispatcher(deps),set allowed(v){allowed=v;},set state(v){state=v;}};
}
test('repair keeps the original goal and uses ordinary submit without model/limit overrides',async t=>{
  const f=fixture(t);await f.create().dispatch(input);assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].original.context,input.context);assert.match(f.calls[0].request.content,/不是新的玩家要求/);assert.match(f.calls[0].request.content,/保留已有作品、草稿和进度/);
  assert.deepEqual(Object.keys(f.calls[0].request).sort(),['content','messageId']);assert.match(creationRepairPrompt(input),/检查任务：gjob-/);
});
test('restart reconciles an existing dispatched turn instead of sending again',async t=>{
  const f=fixture(t);const original=await f.create().dispatch(input);f.state={state:'checked',turnId:'repair-turn'};
  const resumed=await f.create().dispatch(input);assert.equal(f.calls.length,1);assert.equal(resumed.messageId,original.messageId);assert.equal(resumed.recovered,true);
});
test('revoking full-auto prevents both new dispatch and receipt recovery',async t=>{
  const f=fixture(t);await f.create().dispatch(input);f.allowed=false;f.state={state:'running',turnId:'repair-turn'};
  await assert.rejects(f.create().dispatch(input),/NOT_AUTHORIZED/);assert.equal(f.calls.length,1);
});
test('interrupted submission retries through ordinary history preservation with a new message identity',async t=>{
  const f=fixture(t);const original=await f.create().dispatch(input);f.state={state:'retry',turnId:'repair-turn'};
  const next=await f.create().dispatch(input);assert.notEqual(next.messageId,original.messageId);assert.equal(f.calls[1].request.retryFrom,original.messageId);
});
test('cancelled and superseded work cannot silently duplicate',async t=>{
  for(const state of ['cancelled','superseded']){const f=fixture(t);await f.create().dispatch(input);f.state={state,turnId:'repair-turn'};await assert.rejects(f.create().dispatch(input));assert.equal(f.calls.length,1);}
});

test('completed repair without a check continues without truncating valuable completed work',async t=>{
  const f=fixture(t);const original=await f.create().dispatch(input);f.state={state:'no-check',turnId:'repair-turn'};
  const next=await f.create().dispatch(input);assert.notEqual(next.messageId,original.messageId);assert.equal(f.calls.length,2);
  assert.equal(f.calls[1].request.retryFrom,undefined);assert.match(f.calls[1].request.content,/仅构建或导入成功不等于检查通过/);
  f.state={state:'running',turnId:'continued-turn'};const resumed=await f.create().dispatch(input);
  assert.equal(resumed.messageId,next.messageId);assert.equal(f.calls.length,2);
});
test('first late repair also rejects a newer player request without needing an existing receipt',()=>{
  assert.equal(repairFollowsLatestRequest('original-turn','snapshot-a','new-player-turn',{snapshotId:'snapshot-b',autoApply:true}),false);
  assert.equal(repairFollowsLatestRequest('original-turn','snapshot-a','generic-new-turn',null),false);
  assert.equal(repairFollowsLatestRequest('original-turn','snapshot-a','original-turn',null),true);
  assert.equal(repairFollowsLatestRequest('original-turn','snapshot-a','owned-repair-turn',{snapshotId:'snapshot-a',autoApply:true}),true);
  assert.equal(repairFollowsLatestRequest('original-turn','snapshot-a','cancelled-repair-turn',{snapshotId:'snapshot-a',autoApply:false}),false);
});

test('only unchecked build/import work within the same frozen intent can keep original repair alive',()=>{
  const context={...input.context,turnId:'repair-turn'},capture={worldId:input.worldId,snapshotId:'snapshot-a',autoApply:true};
  const job={worldId:input.worldId,kind:'build',taskId:'work-'+createHash('sha256').update(JSON.stringify([context.sessionId,context.turnId])).digest('hex')};
  assert.equal(repairOwnsUncheckedWork(input,'snapshot-a',job,[{context,capture}]),true);
  for(const change of [{kind:'check'},{kind:'import'},{worldId:'other'},{taskId:'another'},{kind:'unknown'}])assert.equal(repairOwnsUncheckedWork(input,'snapshot-a',{...job,...change},[{context,capture}]),false);
  for(const change of [{autoApply:false},{snapshotId:'newer-player-intent'},{worldId:'other'}])assert.equal(repairOwnsUncheckedWork(input,'snapshot-a',job,[{context,capture:{...capture,...change}}]),false);
});
