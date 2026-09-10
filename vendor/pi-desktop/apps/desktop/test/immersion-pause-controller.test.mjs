import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
register(pathToFileURL(fileURLToPath(new URL('./helpers/ts-import-hooks.mjs',import.meta.url))));
const {createImmersionPauseController}=await import('../electron/main/immersion-pause-controller.ts');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const fixture=()=>{const calls=[];return {calls,callbacks:{pause:async()=>{calls.push('pause');},resume:async()=>{calls.push('resume');}}};};

test('new instances are paused and the overlay cannot undo manual pause',async()=>{
  const c=createImmersionPauseController(),f=fixture(),token={};
  await c.attach(token,f.callbacks);
  assert.equal(c.paused(token),true);assert.deepEqual(f.calls,['pause']);
  await c.setOverlay(true);await c.setOverlay(false);
  assert.deepEqual(f.calls,['pause']);
  await c.setManual(token,false);assert.equal(c.paused(token),false);
  await c.setOverlay(true);assert.equal(c.paused(token),true);
  await c.setManual(token,true);await c.setOverlay(false);
  assert.equal(c.paused(token),true);
  assert.deepEqual(f.calls,['pause','resume','pause']);
});

test('overlay close resumes only manually running instances',async()=>{
  const c=createImmersionPauseController(),a=fixture(),b=fixture();
  await c.attach('a',a.callbacks);await c.attach('b',b.callbacks);
  await c.setManual('a',false);await c.setOverlay(true);await c.setOverlay(false);
  assert.deepEqual(a.calls,['pause','resume','pause','resume']);
  assert.deepEqual(b.calls,['pause']);
  assert.equal(c.paused('a'),false);assert.equal(c.paused('b'),true);
});

test('rapid toggles serialize commands and reconcile latest intent before resolving callers',async()=>{
  const c=createImmersionPauseController(),gate=deferred(),calls=[];
  let inFlight=0,maximum=0;
  await c.attach('a',{pause:async()=>{calls.push('pause');},resume:async()=>{
    inFlight++;maximum=Math.max(maximum,inFlight);calls.push('resume');await gate.promise;inFlight--;
  }});
  const resume=c.setManual('a',false);await tick();
  let settled=false;
  const open=c.setOverlay(true).then(()=>{settled=true;});
  const close=c.setOverlay(false);
  const reopen=c.setOverlay(true);
  await tick();assert.equal(settled,false);assert.deepEqual(calls,['pause','resume']);
  gate.resolve();await Promise.all([resume,open,close,reopen]);
  assert.deepEqual(calls,['pause','resume','pause']);assert.equal(maximum,1);
  assert.equal(c.paused('a'),true);
});

test('a changed overlay while pause acknowledgement waits is reconciled',async()=>{
  const c=createImmersionPauseController(),gate=deferred(),calls=[];let count=0;
  await c.attach('a',{pause:async()=>{calls.push('pause');if(++count===2)await gate.promise;},resume:async()=>{calls.push('resume');}});
  await c.setManual('a',false);
  const open=c.setOverlay(true);await tick();const close=c.setOverlay(false);
  gate.resolve();await Promise.all([open,close]);
  assert.deepEqual(calls,['pause','resume','pause','resume']);assert.equal(c.paused('a'),false);
});

test('detached acknowledgements reject without touching a new runtime',async()=>{
  const c=createImmersionPauseController(),gate=deferred(),oldCalls=[];
  const pending=c.attach('old',{pause:async()=>{oldCalls.push('pause');await gate.promise;},resume:async()=>{oldCalls.push('resume');}});
  const rejected=assert.rejects(pending,/IMMERSION_RUNTIME_DETACHED/);
  await tick();c.detach('old');
  const fresh=fixture();await c.attach('new',fresh.callbacks);
  assert.throws(()=>c.setManual('old',false),/IMMERSION_RUNTIME_DETACHED/);
  assert.throws(()=>c.attach('old',fresh.callbacks),/IMMERSION_RUNTIME_TOKEN_REUSED/);
  gate.resolve();await rejected;
  assert.deepEqual(oldCalls,['pause']);assert.deepEqual(fresh.calls,['pause']);
  c.detach('old');assert.equal(c.paused('new'),true);
});

test('failure rejects all waiters, latches manual pause and never auto-resumes',async()=>{
  const c=createImmersionPauseController(),gate=deferred(),calls=[];let first=true;
  await c.attach('a',{pause:async()=>{calls.push('pause');},resume:async()=>{
    calls.push('resume');if(first){first=false;await gate.promise;}
  }});
  const resume=c.setManual('a',false);await tick();
  const overlay=c.setOverlay(true);
  const rejected=[assert.rejects(resume,/transport failed/),assert.rejects(overlay,/transport failed/)];
  gate.reject(new Error('transport failed'));await Promise.all(rejected);
  assert.equal(c.paused('a'),true);
  await c.setOverlay(false);
  assert.deepEqual(calls,['pause','resume','pause']);assert.equal(c.paused('a'),true);
  await c.setManual('a',false);assert.deepEqual(calls,['pause','resume','pause','resume']);
});

test('overlay observes every runtime even when one fails to pause',async()=>{
  const c=createImmersionPauseController(),good=fixture();let fail=false;
  await c.attach('bad',{pause:async()=>{if(fail)throw Error('pause failed');},resume:async()=>{}});
  await c.attach('good',good.callbacks);await c.setManual('bad',false);await c.setManual('good',false);
  fail=true;await assert.rejects(c.setOverlay(true),/pause failed/);
  assert.equal(c.paused('bad'),true);assert.equal(c.paused('good'),true);
  assert.deepEqual(good.calls,['pause','resume','pause']);
});

test('manual intent remains distinct from overlay hold and attached status',async()=>{
  const c=createImmersionPauseController(),f=fixture(),token={};
  assert.equal(c.has(token),false);
  await c.attach(token,f.callbacks);assert.equal(c.has(token),true);
  assert.equal(c.manualPaused(token),true);
  await c.setManual(token,false);await c.setOverlay(true);
  assert.equal(c.paused(token),true);assert.equal(c.manualPaused(token),false);
  await c.setManual(token,true);assert.equal(c.manualPaused(token),true);
  c.detach(token);assert.equal(c.has(token),false);
  assert.throws(()=>c.manualPaused(token),/IMMERSION_RUNTIME_DETACHED/);
});
