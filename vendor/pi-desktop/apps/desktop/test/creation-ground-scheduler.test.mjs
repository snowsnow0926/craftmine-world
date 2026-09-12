import test from 'node:test';
import assert from 'node:assert/strict';
import {createCreationGroundScheduler} from '../electron/main/creation-ground-scheduler.ts';

function fixture() {
  let time=0,id=0,current={worldId:'world-1',instanceId:'instance-1'},blocked=false,last=null;
  const timers=new Map(),calls=[],changes=[],outcomes=[];
  const service=createCreationGroundScheduler({current:()=>current,blocked:()=>blocked,lastStatus:()=>last,
    start:async worldId=>{calls.push(worldId);const value=outcomes.shift()??{status:'skipped'};if(value instanceof Error){last={status:'cancelled',reason:String(value)};throw value;}if(typeof value==='function')return value();return value;},
    now:()=>time,setTimer:(fn,ms)=>{timers.set(++id,{fn,at:time+ms});return id;},clearTimer:id=>timers.delete(id),
    changed:entry=>changes.push(entry),idleDelayMs:10,retryDelayMs:100});
  async function tick(ms=0){time+=ms;for(const [id,item] of [...timers])if(item.at<=time){timers.delete(id);item.fn();}for(let i=0;i<8;i++)await Promise.resolve();}
  return {service,calls,outcomes,changes,timers,tick,get current(){return current;},set current(value){current=value;},set blocked(value){blocked=value;}};
}

test('cancelled maintenance resumes on the same instance after player work settles',async()=>{
  const f=fixture();f.outcomes.push(new Error('GROUND_UPGRADE_PLAYER_WORK_STARTED'),{status:'applied'});
  f.service.schedule('world-1','instance-1');await f.tick();assert.equal(f.calls.length,1);
  f.blocked=true;await f.tick(10);await f.tick(50);assert.equal(f.calls.length,1);
  f.blocked=false;await f.tick(10);assert.equal(f.calls.length,2);assert.equal(f.service.status('world-1','instance-1').phase,'done');
  f.service.schedule('world-1','instance-1');await f.tick(1000);assert.equal(f.calls.length,2);
});
test('ready broadcasts coalesce and a world busy at entry is not forgotten',async()=>{
  const f=fixture();f.blocked=true;for(let i=0;i<5;i++)f.service.schedule('world-1','instance-1');
  assert.equal(f.timers.size,1);await f.tick();assert.equal(f.calls.length,0);
  f.blocked=false;await f.tick(10);assert.equal(f.calls.length,1);
});
test('another selected world is never changed by a delayed retry',async()=>{
  const f=fixture();f.outcomes.push({status:'cancelled'});f.service.schedule('world-1','instance-1');await f.tick();
  f.current={worldId:'world-2',instanceId:'instance-2'};await f.tick(10);assert.deepEqual(f.calls,['world-1']);
  f.service.schedule('world-2','instance-2');await f.tick();assert.deepEqual(f.calls,['world-1','world-2']);
});
test('quit suspension cancels retry timers; failed quit can resume the same world',async()=>{
  const f=fixture();f.outcomes.push({status:'cancelled'},{status:'applied'});f.service.schedule('world-1','instance-1');await f.tick();
  f.service.suspend();await f.tick(100);assert.equal(f.calls.length,1);assert.equal(f.timers.size,0);
  f.service.resume();await f.tick();assert.equal(f.calls.length,2);f.service.dispose();f.service.resume();await f.tick(1000);assert.equal(f.calls.length,2);
});
test('executor failures retry with backoff and preserve the diagnostic until recovery',async()=>{
  const f=fixture();f.outcomes.push({status:'failed',reason:'executor unavailable'},{status:'applied'});f.service.schedule('world-1','instance-1');await f.tick();
  assert.equal(f.service.status('world-1','instance-1').phase,'retrying');assert.equal(f.service.status('world-1','instance-1').error,'executor unavailable');
  f.service.schedule('world-1','instance-1');await f.tick(99);assert.equal(f.calls.length,1);await f.tick(1);assert.equal(f.calls.length,2);
  assert.equal(f.service.status('world-1','instance-1').error,undefined);
});
test('a promoted instance queued during apply is reconsidered when the owned job finishes',async()=>{
  const f=fixture();let resolve;f.outcomes.push(()=>new Promise(done=>{resolve=done;}));f.service.schedule('world-1','instance-1');await f.tick();
  f.current={worldId:'world-1',instanceId:'instance-2'};f.service.schedule('world-1','instance-2');await f.tick();assert.equal(f.calls.length,1);
  resolve({status:'applied'});await f.tick();await f.tick(10);assert.equal(f.calls.length,2);
});
