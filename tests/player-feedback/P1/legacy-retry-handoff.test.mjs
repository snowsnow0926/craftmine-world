import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import {classifyLegacyRetryHandoff} from './legacy-retry-handoff.mjs';
const baseline={id:'legacy-owned',state:'failed',updatedAt:123,creation:{operationId:'init-old',stage:'confirm',error:{code:'GODOT_INITIAL_LOAD_FAILED'}}};
test('only the identical old failure has strictly less than 30 seconds of handoff grace',()=>{
 assert.equal(classifyLegacyRetryHandoff(structuredClone(baseline),baseline,29999,false),'old-failed-handoff');
 assert.throws(()=>classifyLegacyRetryHandoff(baseline,baseline,30000,false),/HANDOFF_TIMEOUT/);
 assert.throws(()=>classifyLegacyRetryHandoff(baseline,baseline,-1,false),/TIME_INVALID/);
});
test('new failures, including identical failure after preparing, reject immediately',()=>{
 for(const row of [{...baseline,updatedAt:124},{...baseline,creation:{...baseline.creation,operationId:'new'}},{...baseline,creation:{...baseline.creation,error:{code:'GODOT_JOB_FAILED'}}}])assert.throws(()=>classifyLegacyRetryHandoff(row,baseline,1,false),/NEW_FAILURE/);
 assert.throws(()=>classifyLegacyRetryHandoff(baseline,baseline,1,true),/NEW_FAILURE/);
});
test('identity, missing row, cancelled and unknown states remain failures',()=>{
 assert.throws(()=>classifyLegacyRetryHandoff({...baseline,id:'other'},baseline,1,false),/IDENTITY/);
 assert.throws(()=>classifyLegacyRetryHandoff(undefined,baseline,1,false),/IDENTITY/);
 for(const state of ['cancelled','interrupted','unknown'])assert.throws(()=>classifyLegacyRetryHandoff({...baseline,state},baseline,1,false),/NEW_FAILURE/);
 assert.throws(()=>classifyLegacyRetryHandoff(baseline,{...baseline,state:'ready'},1,false),/BASELINE/);
});

// Execute the actual checked-in retry step, not a duplicate continuation rule.
// Its client/world callbacks are controlled observations; no native process runs.
const driver=fs.readFileSync(new URL('./legacy-retry-client.mjs',import.meta.url),'utf8');
const start=driver.indexOf(" await step('explicit product retry checks a new candidate and confirms first load'");
const end=driver.indexOf(" await step('save full native progress and cleanly close'",start);
assert.ok(start>=0&&end>start);const actualStep=driver.slice(start,end);
async function exercise(rows,{baselineRead=baseline,reply={status:'running',worldId:baseline.id}}={}){
 const report={retryCalls:0,retryTransitions:[],retryBaseline:structuredClone(baseline)},calls=[];let index=0,clock=0,readyCalls=0;
 const context={assert,structuredClone,JSON,Date:class extends Date{static now(){return clock;}},worldId:baseline.id,report,classifyLegacyRetryHandoff,
  save(){},evidence:value=>value,step:async(_name,fn)=>fn(),
  nav:async(channel,payload)=>{calls.push({channel,payload});if(channel==='world.creationRetry')return reply;assert.equal(channel,'world.list');return {worlds:[calls.length===1?structuredClone(baselineRead):rows[index++]]};},
  until:async(fn,predicate)=>{for(let n=0;n<10;n++){clock=n*1000;const value=await fn();if(predicate(value))return value;}throw Error('FIXTURE_POLL_LIMIT');},
  runtimeReady:async()=>{readyCalls++;},rpc:async method=>{assert.equal(method,'godotCaptureView');return {width:1280,height:720,pixelStats:{sampledColors:5}};}};
 let error;try{await vm.runInNewContext('(async()=>{'+actualStep+'})()',context);}catch(e){error=e;}
 return {report,calls,error,readyCalls};
}
test('actual driver waits for old row then preparing then ready with one retry',async()=>{
 const result=await exercise([structuredClone(baseline),{...baseline,state:'initializing'},{...baseline,state:'ready'}]);
 assert.equal(result.error,undefined);assert.equal(result.report.retryCalls,1);assert.equal(result.calls.filter(call=>call.channel==='world.creationRetry').length,1);assert.equal(result.readyCalls,1);
 assert.deepEqual(Array.from(result.report.retryTransitions,entry=>entry.phase),['old-failed-handoff','preparing','ready']);
});
test('actual driver stops on a new failure without calling runtime or retry again',async()=>{
 for(const rows of [[{...baseline,updatedAt:124}],[{...baseline,state:'checking'},structuredClone(baseline)]]){
  const result=await exercise(rows);assert.match(String(result.error),/NEW_FAILURE/);assert.equal(result.report.retryCalls,1);assert.equal(result.calls.filter(call=>call.channel==='world.creationRetry').length,1);assert.equal(result.readyCalls,0);assert.deepEqual(result.report.lastRetryRow,rows.at(-1));
 }
});
test('actual driver refuses a changed pre-call baseline before dispatching any retry',async()=>{
 const result=await exercise([],{baselineRead:{...baseline,updatedAt:124}});assert.match(String(result.error),/FAILED_BASELINE_CHANGED/);assert.equal(result.report.retryCalls,0);assert.equal(result.calls.some(call=>call.channel==='world.creationRetry'),false);
});
test('actual driver rejects a scheduling reply for another world',async()=>{
 const result=await exercise([],{reply:{status:'running',worldId:'other'}});assert.ok(result.error);assert.equal(result.report.retryCalls,1);assert.equal(result.readyCalls,0);
});
