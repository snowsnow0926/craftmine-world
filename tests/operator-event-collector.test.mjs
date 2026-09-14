import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperatorEventCollector,isRecoverableOperatorCaptureError,recoverOperatorObserver} from './helpers/operator-event-collector.mjs';
const event=(type,message,extras={})=>({sessionId:'s',turnId:'t',ts:1,event:{type,...(message?{message}:{}),...extras}});
test('thousands of growing thinking snapshots stay one metadata entry while retaining complete terminal text',()=>{
  const collector=createOperatorEventCollector();let thinking='';
  for(let n=0;n<35000;n++){thinking+='a';collector.push(event('message_update',{id:'m',role:'assistant',thinking,content:''},{deltaThinking:'a'}));}
  assert.equal(collector.status().pendingRecords,1);
  const update=collector.drain();assert.equal(update.events.length,1);assert.equal(update.events[0].event.capture.observedUpdates,35000);assert.equal(update.events[0].event.capture.deltaThinkingCharacters,35000);assert(JSON.stringify(update).length<1500);assert.equal(update.events[0].event.message.thinking,undefined);
  assert.equal(update.coverage.peakPendingRecords,1);assert.equal(update.coverage.omittedUpdateBodyCharacters,35000*35001/2);assert(update.coverage.collectedBytes<1000);collector.acknowledge(update.deliveryId);
  const terminal=event('message_end',{id:'m',role:'assistant',thinking,content:'complete',usage:{totalTokens:20}});collector.push(terminal);assert.deepEqual(collector.drain().events,[terminal]);
});
test('interleaved sessions, errors, tools, usage and questions keep their identity and full receipts',()=>{
  const collector=createOperatorEventCollector();collector.push(event('message_update',{id:'a',thinking:'aa'},{deltaThinking:'aa'}));collector.push({...event('message_update',{id:'a',thinking:'bb'}),sessionId:'other'});
  const records=[event('error',null,{error:{code:'REAL_FAILURE',message:'retain'}}),event('tool_end',null,{result:{isError:true,content:'raw failure'}}),event('model_call',null,{usage:{totalTokens:42}}),event('asktool',null,{questions:[{question:'original question'}]})];for(const row of records)collector.push(row);
  const drained=collector.drain();for(const record of records)assert(drained.events.some(row=>JSON.stringify(row)===JSON.stringify(record)));assert.equal(drained.events.filter(row=>row.event.type==='message_update').length,2);collector.acknowledge(drained.deliveryId);assert.equal(collector.drain().events.length,0);
});
test('lost CDP response can retrieve the same unacknowledged batch without losing terminal or ask events',()=>{
  const collector=createOperatorEventCollector(),ask=event('asktool',null,{requestId:'q',questions:['original']});collector.push(ask);const first=collector.drain();collector.push(event('error',null,{code:'later'}));assert.deepEqual(collector.drain(),first);assert.equal(collector.acknowledge('wrong-id'),false);assert.deepEqual(collector.drain(),first);collector.acknowledge(first.deliveryId);assert.equal(collector.drain().events[0].event.code,'later');
});
test('update metadata stays before subsequent tool/status/error/ask boundaries without message IDs',()=>{
  for(const type of ['tool_start','status','error','asktool','permission']){
    const collector=createOperatorEventCollector();collector.push(event('message_update',{id:'first',thinking:'earlier'}));collector.push(event('message_update',{id:'second',thinking:'later'}));const boundary=event(type,null,{requestId:'unique'});collector.push(boundary);
    const rows=collector.drain().events;assert.deepEqual(rows.map(row=>row.event.type),['message_update','message_update',type]);assert.equal(rows[0].event.message.id,'first');assert.equal(rows[1].event.message.id,'second');assert.deepEqual(rows[2],boundary);
  }
});
test('observation timeouts reconnect without model actions; repeated failure waits for explicit operator retry',async()=>{
  let attempts=0,operatorRequests=0;const states=[];
  await recoverOperatorObserver({assertAlive(){},notify:value=>states.push(value.state),connect:async()=>{attempts++;if(attempts<=3)throw Error('PAGE_RPC_TIMEOUT:observer');},waitForOperator:async()=>{operatorRequests++;}});
  assert.equal(attempts,4);assert.equal(operatorRequests,1);assert(states.includes('degraded-awaiting-operator'));assert.equal(states.at(-1),'healthy');
  await assert.rejects(()=>recoverOperatorObserver({assertAlive(){throw Error('OPERATOR_CANCELLED');},notify(){},connect:async()=>{throw Error('must not connect');},waitForOperator:async()=>{}}),/OPERATOR_CANCELLED/);
});
test('only observation transport errors are recoverable, never model/identity/permission failures',()=>{
  for(const value of ['PAGE_RPC_TIMEOUT:operator-event-drain','PAGE_CONNECTION_CLOSED:sessionGet','Execution context was destroyed'])assert(isRecoverableOperatorCaptureError(Error(value)));
  for(const value of ['DESKTOP_EXITED','PLAYER_MODEL_CHANGED','RELEASE_TASK_IDENTITY_CHANGED','COMPACTION_BUDGET_EXHAUSTED'])assert(!isRecoverableOperatorCaptureError(Error(value)));
});
