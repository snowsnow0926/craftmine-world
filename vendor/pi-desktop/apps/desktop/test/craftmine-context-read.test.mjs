import test from 'node:test';
import assert from 'node:assert/strict';
import {readCraftminePromptContext} from '../electron/main/craftmine-context-read.ts';
const context={projectId:'p',sessionId:'s',turnId:'t'},request={id:'r',text:'Create'};
test('completed context never tries to record another correction',async()=>{
 const calls=[],finished={status:'finished',lease:{owned:false},world:{buildId:'actually-applied'}};
 const result=await readCraftminePromptContext(async(method,args)=>{calls.push(args);return finished;},context,request);
 assert.equal(result,finished);assert.deepEqual(calls,[{context}]);
});
test('completion during correction write returns current finished facts without renewing lease',async()=>{
 const calls=[];let count=0;
 const result=await readCraftminePromptContext(async(method,args)=>{calls.push({method,args});count++;if(count===1)return {status:'running'};if(count===2)throw Error('TASK_INACTIVE');return {status:'finished',lease:{owned:false},world:{buildId:'new'}};},context,request);
 assert.equal(result.world.buildId,'new');assert.equal(calls.length,3);assert.ok(calls.every(call=>call.method==='task.context'));
});
test('a real correction error is not hidden when the task is still running or cancelled',async()=>{
 for(const status of ['running','cancelled']){
  let count=0;await assert.rejects(readCraftminePromptContext(async()=>{count++;if(count===2)throw Error('REAL_FAILURE');return {status:count===1?'running':status};},context,request),/REAL_FAILURE/);
 }
});
