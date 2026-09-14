import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmOperatorWorldSession,operatorWorldSessionExpectation} from './helpers/operator-world-session.mjs';

function fixture(states,options={}){
  let index=0,starts=0,timeouts=0,reads=0;
  const current=()=>states[Math.min(index,states.length-1)];
  const access={worldId:'new-world',excludedSessionId:'old-session',
    until:async(read,ready)=>{for(let i=0;i<8;i++){const value=await read();if(ready(value))return value;index++;}throw Error('FIXTURE_NOT_READY');},
    readUi:async()=>{reads++;return {restoring:false,startReady:false,...current().ui};},
    readBinding:async()=>{if(current().error)throw current().error;return {worldId:'new-world',sessionId:null,...current().binding};},
    startCreation:async()=>{starts++;},onReadTimeout:()=>{timeouts++;},...options};
  return {run:()=>confirmOperatorWorldSession(access),counts:()=>({index,starts,timeouts,reads})};
}
test('waits through old DOM selection and missing then exact new-world host binding',async()=>{
  const f=fixture([{ui:{sessionId:'old-session'}},{ui:{sessionId:'old-session'},binding:{sessionId:'new-session'}},{ui:{sessionId:'new-session'},binding:{sessionId:'new-session'}}]);
  assert.equal((await f.run()).sessionId,'new-session');assert.equal(f.counts().index,2);assert.equal(f.counts().starts,0);
});
test('rejects actual host binding to the old template session',async()=>{
  await assert.rejects(fixture([{ui:{sessionId:'old-session'},binding:{sessionId:'old-session'}}]).run(),/TEMPLATE_COPY_REQUIRES_INDEPENDENT_SESSION/);
});
test('rejects wrong host world and genuine cold session change',async()=>{
  await assert.rejects(fixture([{binding:{worldId:'other'}}]).run(),/WORLD_SESSION_BOUND_WORLD_CHANGED/);
  await assert.rejects(fixture([{ui:{sessionId:'new-session'},binding:{sessionId:'new-session'}}],{expectedSessionId:'expected'}).run(),/COLD_REOPEN_SESSION_CHANGED/);
});
test('does not accept selection changed during host lookup',async()=>{
  let uiReads=0;const f=fixture([{binding:{sessionId:'new-session'}}],{readUi:async()=>({sessionId:++uiReads===1?'new-session':'other-session'})});
  await assert.rejects(f.run(),/FIXTURE_NOT_READY/);
});
test('ordinary Start creating dispatched at most once, never while restoring',async()=>{
  const f=fixture([{ui:{startReady:true,restoring:true}},{ui:{startReady:true}},{ui:{startReady:true}},{ui:{sessionId:'new-session'},binding:{sessionId:'new-session'}}]);
  assert.equal((await f.run()).sessionId,'new-session');assert.equal(f.counts().starts,1);
});
test('retries only recognized read timeout and preserves unknown errors',async()=>{
  const f=fixture([{error:Error('Craftmine Rust request timed out')},{ui:{sessionId:'new-session'},binding:{sessionId:'new-session'}}]);
  assert.equal((await f.run()).sessionId,'new-session');assert.equal(f.counts().timeouts,1);
  await assert.rejects(fixture([{error:Error('PERMISSION_DENIED')}]).run(),/PERMISSION_DENIED/);
  await assert.rejects(fixture([{ui:{error:'Actual conversation failure'}}]).run(),/Actual conversation failure/);
});
test('recovers only exact unfinished template copy without accepting stale report session',()=>{
  const original={worldId:'new-world',sessionId:'old-session',lastTemplateCopy:{oldWorldId:'old-world',oldSessionId:'old-session',newWorldId:'new-world'}};
  assert.deepEqual(operatorWorldSessionExpectation(original),{expectedSessionId:undefined,excludedSessionId:'old-session',pendingCopy:true});
  assert.equal(original.sessionId,'old-session');
  assert.equal(operatorWorldSessionExpectation({...original,worldId:'other-world'}).expectedSessionId,'old-session');
  assert.equal(operatorWorldSessionExpectation({...original,sessionId:'confirmed',lastTemplateCopy:{...original.lastTemplateCopy,newSessionId:'confirmed'}}).expectedSessionId,'confirmed');
});
