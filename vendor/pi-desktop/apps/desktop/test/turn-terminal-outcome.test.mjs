import test from 'node:test';import assert from 'node:assert/strict';
import {createTurnTerminalOutcomes} from '../electron/main/turn-terminal-outcome.ts';

test('shutdown abort intent wins agent_end that arrives synchronously inside sidecar.abort',async()=>{
 const outcomes=createTurnTerminalOutcomes(),persisted=[];
 outcomes.markAbort('session','turn','APP_SHUTDOWN_INTERRUPTED');
 const sidecar={async abort(){persisted.push(outcomes.resolve('session','turn','completed'));outcomes.observeMessage('session','turn',{role:'assistant',status:'aborted',error:{code:'REQUEST_INTERRUPTED'}});}};
 await sidecar.abort();
 assert.deepEqual(persisted,[{status:'aborted',errorCode:'APP_SHUTDOWN_INTERRUPTED',source:'abort-intent'}]);
 assert.equal(outcomes.resolve('session','turn','completed').status,'aborted');
});

test('explicit player stop outranks provider failure and a competing shutdown in either order',()=>{
 for(const shutdownFirst of [true,false]) {
  const state=createTurnTerminalOutcomes();state.observeMessage('s','t',{role:'assistant',status:'error',error:{code:'PROVIDER_UNAVAILABLE'}});
  if(shutdownFirst)state.markAbort('s','t','APP_SHUTDOWN_INTERRUPTED');
  state.markAbort('s','t','TURN_ABORTED');
  if(!shutdownFirst)state.markAbort('s','t','APP_SHUTDOWN_INTERRUPTED');
  assert.deepEqual(state.resolve('s','t','error','PROVIDER_UNAVAILABLE'),{status:'aborted',errorCode:'TURN_ABORTED',source:'abort-intent'});
 }
});

test('aborted assistant message followed by agent_end cannot become completed',()=>{
 for(const status of ['aborted','cancelled','error']) {
  const state=createTurnTerminalOutcomes();state.observeMessage('s','t',{role:'assistant',status,error:{code:'REQUEST_INTERRUPTED'}});
  assert.deepEqual(state.resolve('s','t','completed'),{status:'aborted',errorCode:'REQUEST_INTERRUPTED',source:'assistant-aborted'});
 }
});

test('real provider failure outranks a later aborted bubble without an explicit stop',()=>{
 const state=createTurnTerminalOutcomes();state.observeMessage('s','t',{role:'assistant',status:'error',error:{code:'PROVIDER_IDLE_TIMEOUT'}});
 state.observeMessage('s','t',{role:'assistant',status:'aborted'});
 state.observeMessage('s','t',{role:'assistant',status:'complete'});
 assert.deepEqual(state.resolve('s','t','completed'),{status:'error',errorCode:'PROVIDER_IDLE_TIMEOUT',source:'assistant-error'});
});

test('requested terminal error and abort remain failures without message evidence',()=>{
 const state=createTurnTerminalOutcomes();
 assert.deepEqual(state.resolve('s','t','error','RATE_LIMITED'),{status:'error',errorCode:'RATE_LIMITED',source:'requested'});
 assert.deepEqual(state.resolve('s','t','error','REQUEST_INTERRUPTED'),{status:'aborted',errorCode:'REQUEST_INTERRUPTED',source:'requested'});
 assert.equal(state.resolve('s','t','aborted').status,'aborted');
});

test('normal tool errors, streaming metadata and child-agent errors do not fail the parent turn',()=>{
 const state=createTurnTerminalOutcomes();
 for(const message of [
  {role:'tool',status:'error',error:{code:'COMPILE_FAILED'}},
  {role:'user',status:'aborted'},
  {role:'assistant',status:'streaming',error:{code:'TRANSIENT_METADATA'}},
  {role:'assistant',status:'complete',error:{code:'OLD_METADATA'},content:'I repaired the error.'},
  {role:'assistant',status:'error',parentToolCallId:'child-tool',error:{code:'CHILD_FAILED'}},
  {role:'assistant',status:'error',agentName:'worker',error:{code:'CHILD_FAILED'}},
 ])state.observeMessage('s','t',message);
 assert.deepEqual(state.resolve('s','t','completed'),{status:'completed',source:'requested'});
});

test('old turn and release events never alter a new turn in the same session or another owner',()=>{
 const state=createTurnTerminalOutcomes();state.markAbort('session','old');
 assert.equal(state.resolve('session','new','completed').status,'completed');
 assert.equal(state.resolve('other','old','completed').status,'completed');
 state.observeMessage('session','new',{role:'assistant',status:'error',error:{code:'NEW_FAILURE'}});
 state.release('session','old');state.release('session','old');
 assert.equal(state.resolve('session','new','completed').errorCode,'NEW_FAILURE');
 state.observeMessage('session','old',{role:'assistant',status:'aborted'});
 assert.equal(state.resolve('session','new','completed').errorCode,'NEW_FAILURE');
 state.release('session','new');assert.equal(state.resolve('session','new','completed').status,'completed');
});

test('identity tuple is collision-free and missing identity cannot create shared terminal evidence',()=>{
 const state=createTurnTerminalOutcomes();state.markAbort('a:b','c');
 assert.equal(state.resolve('a','b:c','completed').status,'completed');
 for(const action of [()=>state.markAbort('s',''),()=>state.observeMessage('','t',{role:'assistant',status:'error'}),()=>state.resolve('s',undefined,'completed'),()=>state.release('s','\n')])assert.throws(action,/TURN_TERMINAL_IDENTITY_REQUIRED/);
});

test('generic missing error metadata can be enriched without losing the terminal failure',()=>{
 const state=createTurnTerminalOutcomes();state.observeMessage('s','t',{role:'assistant',status:'error'});
 assert.equal(state.resolve('s','t','completed').errorCode,'ASSISTANT_ERROR');
 state.observeMessage('s','t',{role:'assistant',status:'error',error:{code:'MODEL_UNAVAILABLE'}});
 state.observeMessage('s','t',{role:'assistant',status:'error',error:{code:'SECONDARY'}});
 assert.equal(state.resolve('s','t','completed').errorCode,'MODEL_UNAVAILABLE');
});

test('actual overflow recovery sequence clears only its old error after checkpoint and a new successful response',()=>{
 const state=createTurnTerminalOutcomes();state.observeMessage('s','t',{role:'assistant',status:'error',error:{code:'CONTEXT_TOO_LARGE'}});
 state.observeRecovery('s','t',{reason:'overflow',ok:true,willRetry:true});
 assert.equal(state.resolve('s','t','completed').status,'error','compaction does not itself complete the requested task');
 state.observeMessage('s','t',{role:'assistant',status:'streaming'});assert.equal(state.resolve('s','t','completed').status,'error');
 state.observeMessage('s','t',{role:'assistant',status:'complete'});assert.equal(state.resolve('s','t','completed').status,'completed');
});

test('failed/unrelated recovery and later error or stop cannot erase terminal evidence',()=>{
 for(const event of [{reason:'overflow',ok:false,willRetry:false},{reason:'manual',ok:true,willRetry:true},{reason:'overflow',ok:true,willRetry:false}]) {
  const state=createTurnTerminalOutcomes();state.observeMessage('s','t',{role:'assistant',status:'error',error:{code:'CONTEXT_TOO_LARGE'}});state.observeRecovery('s','t',event);state.observeMessage('s','t',{role:'assistant',status:'complete'});assert.equal(state.resolve('s','t','completed').status,'error');
 }
 for(const next of ['error','aborted','explicit-stop']) {
  const state=createTurnTerminalOutcomes();state.observeMessage('s','t',{role:'assistant',status:'error',error:{code:'CONTEXT_TOO_LARGE'}});state.observeRecovery('s','t',{reason:'overflow',ok:true,willRetry:true});
  if(next==='explicit-stop')state.markAbort('s','t');else state.observeMessage('s','t',{role:'assistant',status:next,error:{code:next==='error'?'PROVIDER_FAILED':'REQUEST_INTERRUPTED'}});
  state.observeMessage('s','t',{role:'assistant',status:'complete'});const result=state.resolve('s','t','completed');assert.notEqual(result.status,'completed');
  assert.equal(result.errorCode,next==='error'?'PROVIDER_FAILED':next==='aborted'?'REQUEST_INTERRUPTED':'TURN_ABORTED');
 }
});
