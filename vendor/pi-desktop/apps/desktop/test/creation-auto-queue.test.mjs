import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createCreationAutoQueue} from '../electron/main/creation-auto-queue.ts';
const input={jobId:'gjob-'+'a'.repeat(64),context:{projectId:'project',sessionId:'chat',turnId:'turn'}};
function fixture(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'creation-auto-queue-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const state={calls:0,busy:true};
 const deps={directory,world:async()=> 'world',perform:async()=>{state.calls++;if(state.busy)throw Error('CREATION_WORLD_DEFERRED');return {status:'applied',worldId:'world',candidateId:'candidate'};}};
 return {deps,state,queue:createCreationAutoQueue(deps)};}
test('late completion stays durable while another world is open and automatically applies after return',async t=>{const {queue,state}=fixture(t);
 assert.equal((await queue.completed(input)).status,'deferred');state.busy=false;await queue.resume();assert.equal(queue.status(input.jobId,'chat').status,'applied');assert.equal(state.calls,2);
 await queue.completed(input);assert.equal(state.calls,2);
});
test('restart recovers deferred ownership and rereads the live guard',async t=>{const {queue,state,deps}=fixture(t);await queue.completed(input);
 const restored=createCreationAutoQueue(deps);state.busy=false;await restored.resume();assert.equal(restored.status(input.jobId,'chat').status,'applied');
});
test('user cancellation is durable and prevents queued work from restarting',async t=>{const {queue,state,deps}=fixture(t);await queue.completed(input);queue.cancel('chat','turn');state.busy=false;
 const restored=createCreationAutoQueue(deps);await restored.resume();assert.equal(state.calls,1);assert.equal(restored.status(input.jobId,'chat').status,'cancelled');
});
test('safe shutdown suspends attempts and cancellation of exit resumes them',async t=>{const {queue,state}=fixture(t);await queue.completed(input);await queue.suspend();state.busy=false;await queue.resume();assert.equal(state.calls,1);await queue.continue();assert.equal(state.calls,2);});
test('identity or source failure is recorded and never retried blindly',async t=>{const {deps,state}=fixture(t);deps.perform=async()=>{state.calls++;throw Error('CREATION_CHECK_SOURCE_CHANGED');};const queue=createCreationAutoQueue(deps);
 assert.equal((await queue.completed(input)).status,'failed');await queue.resume();assert.equal(state.calls,1);
});
test('queue rejects caller-added authority and foreign identities',async t=>{const {queue,state}=fixture(t);await assert.rejects(queue.completed({...input,approved:true}));await assert.rejects(queue.completed({...input,context:{...input.context,worldId:'other'}}));assert.equal(state.calls,0);});

test('restart discovery recovers a terminal check whose completion callback was lost',async t=>{
 const {deps,state}=fixture(t);state.busy=false;deps.discover=async()=>[{...input,worldId:'world'}];const queue=createCreationAutoQueue(deps);
 await queue.resume();assert.equal(queue.status(input.jobId,'chat').status,'applied');assert.equal(state.calls,1);
});
test('repair state is revisited through the durable idempotent dispatcher after restart',async t=>{
 const {deps,state}=fixture(t);deps.perform=async()=>{state.calls++;return {status:'repairing',reason:'CREATION_AUTOMATIC_REPAIR_STARTED'};};const queue=createCreationAutoQueue(deps);
 assert.equal((await queue.completed(input)).status,'repairing');await queue.resume();await createCreationAutoQueue(deps).resume();assert.equal(state.calls,3);assert.equal(queue.status(input.jobId,'chat').status,'repairing');
});

test('an active automatic repair keeps its recovery state while its model is still working',async t=>{
 const {deps}=fixture(t);let active=false;deps.perform=async()=>{if(active)throw Error('CREATION_TURN_BUSY');return {status:'repairing'};};const queue=createCreationAutoQueue(deps);
 await queue.completed(input);active=true;await queue.resume();assert.equal(queue.status(input.jobId,'chat').status,'repairing');
});

test('structured host transport outage is deferred and rechecked after restart, not made a permanent source failure',async t=>{
 const {deps,state}=fixture(t);let outage=true;deps.perform=async()=>{state.calls++;if(outage)throw Object.assign(Error('host-core exited'),{errorCode:'HOST_UNAVAILABLE'});return {status:'applied',worldId:'world',candidateId:'candidate',recovered:true};};
 const queue=createCreationAutoQueue(deps);assert.equal((await queue.completed(input)).status,'deferred');outage=false;
 const restored=createCreationAutoQueue(deps);await restored.resume();assert.equal(restored.status(input.jobId,'chat').status,'applied');assert.equal(state.calls,2);
});
