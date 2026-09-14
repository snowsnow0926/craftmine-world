import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {register} from 'node:module';
register(new URL('../../../vendor/pi-desktop/apps/desktop/test/helpers/ts-import-hooks.mjs', import.meta.url));
const {createGodotWorldFactory} = await import('../../../vendor/pi-desktop/apps/desktop/electron/main/godot-world-creation.ts');
const {createGodotWorldInitializer} = await import('../../../vendor/pi-desktop/apps/desktop/electron/main/godot-world-initialization.ts');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; };
const failed = () => ({worldId: 'retry-world', initId: 'init-one', status: 'failed', playable: false,
  reason: 'GODOT_JOB_FAILED'});
const setup = (initialization, read = () => failed(), changed) => createGodotWorldFactory({
  worldsRoot: 'D:/not-accessed', catalogFile: 'D:/not-accessed', basesRoot: 'D:/not-accessed',
  domain: async method => { assert.equal(method, 'godotWorld.initStatus'); return structuredClone(read()); },
  materialize: () => assert.fail('retry must preserve the managed source'), initialization, changed,
});

test('cancelled retry stays preparing through host preflight, null baseline and marker-clear reply races',async()=>{
  const gate=deferred(),cancelled={...failed(),status:'cancelled',cancelled:true,reason:'GODOT_INITIALIZATION_CANCELLED'};
  let current=cancelled,preparation={attempt:1,pending:false,error:null,status:cancelled,cancelled:true};
  const notifications=[];
  const factory=setup({running:()=>false,error:()=>null,start:()=>gate.promise,preparation:()=>preparation},()=>current,
    id=>notifications.push({id,status:factory.status(id)}));
  const work=factory.retry('retry-world');await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await factory.status('retry-world')).creation.stage,'retry','wrapper preflight has not started a new initializer');
  preparation={attempt:2,pending:true,error:null,status:null};
  assert.equal((await factory.status('retry-world')).creation.stage,'retry','new initializer is awaiting its first Core reply');
  preparation.previousStatus=cancelled;preparation.status=failed();
  assert.equal((await factory.status('retry-world')).creation.stage,'retry','an earlier status read may finish after cancellation was cleared');
  current={...failed(),reason:'GODOT_TASK_PATH_TOO_LONG',projectRevision:3};preparation.pending=false;
  assert.equal((await factory.status('retry-world')).creation.error.code,'GODOT_TASK_PATH_TOO_LONG','actual new terminal is never hidden');
  current={...current,status:'confirmed',playable:true,reason:null};
  assert.equal((await factory.status('retry-world')).state,'ready','durable confirmation wins before scheduler settlement');
  gate.resolve();await work;
  assert.equal(notifications.length,2,'start and final settlement notify all observing lists');
  assert.equal((await notifications.at(-1).status).state,'ready','final notification runs after pending retry is removed');
});

test('an acknowledged retry displays preparation until Core publishes a new attempt', async () => {
  const gate = deferred(); let current = failed(); const original = structuredClone(current);
  const factory = setup({start: () => gate.promise, running: () => false, error: () => null,
    preparation: () => ({attempt:1,pending:true,error:null,status:original})}, () => current);
  const pending = factory.retry('retry-world');
  const preparing = await factory.status('retry-world');
  assert.equal(preparing.state, 'initializing');
  assert.equal(preparing.creation.stage, 'retry');
  assert.equal(preparing.creation.progress, 0);
  assert.equal(preparing.creation.error, null);
  assert.deepEqual(preparing.creation.actions, ['details']);
  assert.deepEqual(current, original, 'presentation cannot rewrite the durable previous failure');
  assert.equal((await factory.status('other-world')).state, 'failed');
  current = {...current, status: 'building', reason: null};
  const building = await factory.status('retry-world');
  assert.equal(building.creation.stage, 'build');
  assert.equal(building.creation.progress, 75, 'the new Core state supersedes preparation');
  current = {...current, status: 'confirmed', playable: true};
  assert.equal((await factory.status('retry-world')).state, 'ready');
  gate.resolve(); await pending;
});

test('overlapping retry requests join existing work without scheduling recovery after it finishes', async () => {
  const existing = deferred(); const calls = [];
  const factory = setup({running: () => true, error: () => null, start: (id, options) => {
    calls.push({id, recover: options?.recover === true});
    return existing.promise;
  }});
  const a = factory.retry('retry-world'), b = factory.retry('retry-world');
  assert.equal((await factory.status('retry-world')).state, 'initializing');
  assert.equal(calls.length, 1);
  existing.resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [{id: 'retry-world', recover: false}]);
  await Promise.all([a, b]);
  const terminal = await factory.status('retry-world');
  assert.equal(terminal.state, 'failed', 'finishing the scheduler is not proof of a successful build');
  assert.equal(terminal.creation.error.code, 'GODOT_JOB_FAILED');
  assert.ok(terminal.creation.actions.includes('retry'));
});

test('an absent initializer cannot acknowledge a retry', async () => {
  assert.throws(() => setup(undefined).retry('retry-world'), /GODOT_BASES_UNAVAILABLE/);
  const factory = setup({start:async()=>{},running:()=>false,error:()=>null});
  assert.throws(() => factory.retry('../foreign'), /INVALID_WORLD_ID/);
});

test('restart does not turn a previous scheduling acknowledgement into durable retry authority', async () => {
  const gate = deferred(); const original = failed();
  const first = setup({running: () => false, error: () => null, start: () => gate.promise,
    preparation: () => ({attempt:1,pending:true,error:null,status:original})}, () => original);
  const pending = first.retry('retry-world');
  assert.equal((await first.status('retry-world')).creation.stage, 'retry');
  const restarted = setup({running: () => false, error: () => null,
    start: () => assert.fail('a terminal durable failure needs explicit retry')}, () => original);
  assert.equal((await restarted.status('retry-world')).state, 'failed');
  gate.resolve(); await pending;
});

// Real initializer and real managed-source reads, controlled Core-shaped RPCs.
// No Core persistence, engine, client, input or model is involved.
async function fixture({launchFailure=false, preparationFailure=false, readyCandidate=false}={}) {
  const root=path.resolve(import.meta.dirname,'../../../test-results');
  await fs.mkdir(root,{recursive:true});
  const worldsRoot=await fs.mkdtemp(path.join(root,'retry-presentation-'));
  const worldId='retry-world',directory=path.join(worldsRoot,worldId);
  await fs.mkdir(directory);
  const text='config_version=5\n',sha256=createHash('sha256').update(text).digest('hex');
  await fs.writeFile(path.join(directory,'project.godot'),text);
  await fs.writeFile(path.join(directory,'managed-base.json'),JSON.stringify({worldId,baseId:'first-person',files:[{path:'project.godot',bytes:Buffer.byteLength(text),sha256}]}));
  const state={current:failed(),calls:[],start:deferred(),ending:deferred(),ended:deferred()};
  if(launchFailure)state.current={...state.current,reason:'GODOT_INITIAL_LOAD_FAILED',failureStage:'confirm',candidateId:'candidate-one',launchFailure:{worldId,initId:'init-one',candidateId:'candidate-one',applicationId:'application-one'}};
  if(readyCandidate)state.current={...state.current,status:'checked',reason:null,candidateId:'candidate-one'};
  const domain=async(method,args)=>{
    state.calls.push(method);
    if(method==='godotWorld.initStatus')return structuredClone(state.current);
    if(method==='godotWorld.initLaunchRetry')throw Error('GODOT_INIT_LAUNCH_STALE');
    if(method==='task.recoverable'){if(preparationFailure)throw Error('GODOT_INITIAL_SOURCE_MISSING');return {items:[]};}
    if(method==='turn.begin')return {binding:{baseBuild:'base-one'}};
    if(method==='godotProject.index')return {revision:1,manifestHash:'same-source',files:[{path:'project.godot',sha256}],nextOffset:null};
    if(method==='content.status')return {backend:'git'};
    if(method==='godotCandidate.list')return {items:readyCandidate?[{status:'ready',manifestHash:'same-source',candidateId:'candidate-one'}]:[]};
    if(method==='godotExecutor.status')return {buildAvailable:true,checkAvailable:true};
    if(method==='godotBuild.start'){state.start.resolve();return {jobId:'new-job'};}
    if(method==='godotBuild.read'){state.current={...state.current,status:'failed',reason:'GODOT_JOB_ENDED'};return {status:'cancelled'};}
    if(method==='workspace.endTurn'){state.ending.resolve();await state.ended.promise;return {};}
    assert.fail('unexpected RPC '+method);
  };
  state.initializer=createGodotWorldInitializer({worldsRoot,domain,selection:async()=>worldId,firstLoad:async()=>{assert.ok(readyCandidate);throw Error('FIRST_LOAD_PREPARE_FAILED');}});
  state.factory=createGodotWorldFactory({worldsRoot,catalogFile:'D:/not-accessed',basesRoot:'D:/not-accessed',domain,materialize:()=>assert.fail('must not materialize'),initialization:state.initializer});
  return state;
}

test('a fast new Core terminal stays visible during actual initializer endTurn, even without a building poll',async()=>{
  const f=await fixture();
  const a=f.factory.retry('retry-world'),b=f.factory.retry('retry-world');assert.equal(a,b);
  await f.ending.promise;
  assert.equal(f.initializer.running('retry-world'),true);
  assert.equal(f.initializer.preparation('retry-world').pending,false);
  const result=await f.factory.status('retry-world');
  assert.equal(result.state,'failed');assert.equal(result.creation.stage,'build');
  assert.equal(result.creation.error.code,'GODOT_JOB_ENDED');
  assert.equal(f.calls.filter(m=>m==='godotBuild.start').length,1);
  f.ended.resolve();await a;
  assert.equal((await f.factory.status('retry-world')).creation.error.code,'GODOT_JOB_ENDED');
});

test('real initializer resolved preparation failure supersedes the unchanged old durable reason only',async()=>{
  const f=await fixture({launchFailure:true});
  const original=structuredClone(f.current);
  await f.factory.retry('retry-world');
  assert.equal(f.initializer.error('retry-world'),'Error: GODOT_INIT_LAUNCH_STALE');
  const result=await f.factory.status('retry-world');
  assert.equal(result.state,'failed');assert.match(result.creation.error.message,/GODOT_INIT_LAUNCH_STALE/);
  assert.deepEqual(f.current,original);assert.ok(!f.calls.includes('turn.begin'));
  f.current={...failed(),reason:'GODOT_TASK_PATH_TOO_LONG',projectRevision:2};
  assert.equal((await f.factory.status('retry-world')).creation.error.code,'GODOT_TASK_PATH_TOO_LONG');
  f.current={...f.current,status:'building',reason:null};
  assert.equal((await f.factory.status('retry-world')).state,'initializing');
});

test('current preparation failure is actionable, but a fresh initializer attempt invalidates it',async()=>{
  const f=await fixture({preparationFailure:true});
  await f.factory.retry('retry-world');
  assert.match((await f.factory.status('retry-world')).creation.error.message,/缺少源码文件/);
  const old=f.initializer.preparation('retry-world').attempt;
  await f.initializer.start('retry-world'); // No recover permission: terminal Core state is untouched.
  assert.ok(f.initializer.preparation('retry-world').attempt>old);
  assert.equal((await f.factory.status('retry-world')).creation.error.code,'GODOT_JOB_FAILED');
  assert.ok(!f.calls.includes('godotBuild.start'));
});

test('an existing candidate stops preparation before firstLoad and its host error remains visible',async()=>{
  const f=await fixture({readyCandidate:true});
  const pending=f.factory.retry('retry-world');await f.ending.promise;
  assert.equal(f.initializer.preparation('retry-world').pending,false);
  f.ended.resolve();await pending;
  const result=await f.factory.status('retry-world');
  assert.equal(result.state,'failed');assert.match(result.creation.error.message,/FIRST_LOAD_PREPARE_FAILED/);
  assert.ok(!f.calls.includes('godotBuild.start'));
});
