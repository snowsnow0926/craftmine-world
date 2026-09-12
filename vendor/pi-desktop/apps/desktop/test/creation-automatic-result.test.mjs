import test from 'node:test';import assert from 'node:assert/strict';
import {creationTaskStatus}from'../electron/main/creation-task-status.ts';
const job={worldId:'world-a',jobId:'job-a',candidateId:'candidate-a',buildId:'build-a',taskId:'task-a',status:'passed'};
const formal={worldId:'world-a',buildId:'build-a',baseId:'creation-sandbox'};
const receipt={worldId:'world-a',jobId:'job-a',context:{sessionId:'session-a'},status:'applied'};
test('only the matching durable automatic receipt marks an adopted result automatic',()=>{
 assert.equal(creationTaskStatus('world-a','session-a',job,formal,false,receipt).automaticallyApplied,true);
 for(const value of [null,{...receipt,worldId:'other'},{...receipt,jobId:'other'},{...receipt,context:{sessionId:'other'}},{...receipt,status:'manual'},{...receipt,status:'failed'}])assert.equal(creationTaskStatus('world-a','session-a',job,formal,false,value).automaticallyApplied,undefined);
 assert.equal(creationTaskStatus('world-a','session-a',job,{...formal,buildId:'old-build'},false,receipt).automaticallyApplied,undefined);
});
