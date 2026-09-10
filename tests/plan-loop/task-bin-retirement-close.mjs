// Pure in-memory ChildProcess event ordering; not OS pipe/native evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
const {captureBinRetirement} = createRequire(import.meta.url)('../../plugins/craftmine-world/godot-task-bin-retirement.cjs');
const source = fs.readFileSync(new URL('../../plugins/craftmine-world/godot-executor.cjs', import.meta.url), 'utf8');
const start = source.indexOf('  function runBroker(request) {');
const end = source.indexOf('  function validateBrokerReceipt(', start);
assert.ok(start >= 0 && end > start);
const runSource = source.slice(start, end).trim();
assert.match(source, /const RETIREMENT_CLOSE_TIMEOUT_MS = 5000;/);

function scenario() {
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  child.stdin = {write:() => true}; child.kill = () => true;
  const timers = new Set();
  const deps = {
    spawnBroker:() => child, BROKER_PROFILE_PREFIX:'craftmine.godot.task.', BROKER_RESPONSE_BYTES:8*1024*1024,
    BROKER_FRAME_BYTES:65536, BROKER_SCHEMA_VERSION:1, CANCEL_GRACE_MS:15000,
    JOB_TIMEOUT_MS:600000, RETIREMENT_CLOSE_TIMEOUT_MS:5000,
    bounded:(text,max) => text.slice(-max), recoverTasks:async() => null, warn:() => {},
    setTimeout:(fn,ms) => {const timer={fn,ms,unref(){}};timers.add(timer);return timer;},
    clearTimeout:timer => timers.delete(timer),
  };
  // Fixed production function extracted from this checkout, with event-only
  // dependencies. No evaluated authored source or public evaluation API.
  const runBroker = new Function(...Object.keys(deps), `return (${runSource});`)(...Object.values(deps));
  const requestId='im-'+'a'.repeat(24), engineSha='b'.repeat(64), brokerSha='c'.repeat(64);
  const response={schemaVersion:1,taskId:requestId,requestId,operation:'import',state:'succeeded',exitCode:0,error:null,
    processVerification:{verified:true},networkPreflight:{verified:true,jobActiveProcesses:0},
    cleanup:{verified:true,profileHresult:0,workRemoved:true,error:null},recoveryJournal:{cleared:true,error:null},
    brokerSha256:brokerSha,binRetirement:{format:'craftmine.godot-bin-retirement/1',taskId:requestId,
      identityNonce:'d'.repeat(64),engineJobActiveProcesses:0,nativeJobActiveProcesses:0,files:[
        {path:'Godot_v4.7.2-stable_win64.exe',bytes:4,sha256:engineSha},
        {path:'broker-preflight.exe',bytes:4,sha256:brokerSha}]} };
  const pending=runBroker({requestId,operation:'import',tasksRoot:os.tmpdir(),binary:'unused-fixture',engineRoot:os.tmpdir(),
    projectRoot:os.tmpdir(),sourceBinding:{},inputHash:'e'.repeat(64)});
  const capture=run=>captureBinRetirement({tasksRoot:path.resolve(os.tmpdir()),run,requestId,operation:'import',
    expectedEngineSha256:engineSha,expectedBrokerSha256:brokerSha});
  return {child,timers,response,pending,capture};
}

test('exit before close grants no capability; a clean full close grants it afterward', async()=>{
  const f=scenario(); f.child.stdout.emit('data',JSON.stringify(f.response)+'\n');f.child.emit('exit',0,null);
  const run=await f.pending;let closed=false;run.retirementClose.then(()=>{closed=true;});await Promise.resolve();
  assert.equal(closed,false);assert.throws(()=>f.capture(run),/STDIO_UNCONFIRMED/);
  f.child.emit('close',0,null);const proof=await run.retirementClose;
  assert.equal(proof.stdioClosed,true);assert.deepEqual(proof.response,f.response);
  assert.equal(typeof f.capture({...run,closedTransport:proof}),'function');assert.equal(f.timers.size,0);
});

for(const fault of ['late-invalid-stdout','late-stderr','stdout-error','stderr-error','close-timeout']){
  test(`${fault} preserves the exit result but cannot authorize retirement`,async()=>{
    const f=scenario();f.child.stdout.emit('data',JSON.stringify(f.response)+'\n');f.child.emit('exit',0,null);
    const run=await f.pending;
    if(fault==='late-invalid-stdout')f.child.stdout.emit('data','LATE_INVALID_JSON\n');
    if(fault==='late-stderr')f.child.stderr.emit('data','late BROKER_ERROR: fixture\n');
    if(fault==='stdout-error')f.child.stdout.emit('error',Error('fixture stdout failed'));
    if(fault==='stderr-error')f.child.stderr.emit('error',Error('fixture stderr failed'));
    if(fault==='close-timeout'){
      const timer=[...f.timers].find(timer=>timer.ms===5000);assert.ok(timer);timer.fn();
    }else f.child.emit('close',0,null);
    const proof=await run.retirementClose;
    assert.throws(()=>f.capture({...run,closedTransport:proof}),/STDIO_UNCONFIRMED/);
    assert.equal(run.response.state,'succeeded','optional cleanup must not rewrite an existing result');
    if(fault==='late-invalid-stdout')assert.ok(proof.parseError);
    if(fault==='late-stderr'){assert.equal(proof.lateStderr,true);assert.equal(proof.stderr,'late BROKER_ERROR: fixture\n');}
    if(fault==='close-timeout'){
      assert.equal(proof.reason,'GODOT_BROKER_STDIO_CLOSE_TIMEOUT');
      f.child.emit('close',0,null);assert.equal(await run.retirementClose,proof,'late close cannot revive expired eligibility');
    }
    assert.equal(f.timers.size,0);
  });
}

test('existing early stderr remains observable and is not blanket reclassified as build failure',async()=>{
  const f=scenario();f.child.stderr.emit('data','authored early diagnostic\n');
  f.child.stdout.emit('data',JSON.stringify(f.response)+'\n');f.child.emit('exit',0,null);
  const run=await f.pending;f.child.emit('close',0,null);const proof=await run.retirementClose;
  assert.equal(proof.lateStderr,false);assert.equal(proof.stderr,run.stderr);
  assert.equal(typeof f.capture({...run,closedTransport:proof}),'function');
});
