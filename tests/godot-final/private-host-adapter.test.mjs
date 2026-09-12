import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(path.resolve('vendor/pi-desktop/packages/agent-runtime/package.json'));
const {transformSync}=require('esbuild');
const source=fs.readFileSync('vendor/pi-desktop/apps/desktop/electron/main/plugin-runtime.ts','utf8');
const start=source.indexOf('  async requestCraftmineHost('),end=source.indexOf('\n  /**',start);
assert.ok(start>0&&end>start);
const compiled=transformSync('class Adapter { '+source.slice(start,end)+' }; globalThis.Adapter=Adapter;',{loader:'ts',target:'node24'}).code;
const scope={apiError:(code,message)=>Object.assign(Error(message),{code})};vm.runInNewContext(compiled,scope);
test('production host adapter reaches recovery and package finalization without widening arbitrary RPC',async()=>{
  const adapter=new scope.Adapter(),child={child:{}},calls=[];
  adapter.loaded=new Map([['craftmine.world',child]]);
  adapter.sendToChild=async(...args)=>{calls.push(args);return {ok:true};};
  for(const method of ['task.recoverable','package.sourceJob'])assert.equal((await adapter.requestCraftmineHost(method,{worldId:'world'})).ok,true);
  assert.deepEqual(calls.map(call=>call[1].payload.method),['task.recoverable','package.sourceJob']);
  assert.ok(calls.every(call=>call[0]===child&&call[1].method==='lifecycle.craftmineRequest'));
  await assert.rejects(adapter.requestCraftmineHost('arbitrary.shell',{}),/Unsupported/);assert.equal(calls.length,2);
});

const plumbingStart=source.indexOf('  private sendToChild('),plumbingEnd=source.indexOf('\n  /**',plumbingStart);
assert.ok(plumbingStart>0&&plumbingEnd>plumbingStart);
const transportCompiled=transformSync('class Adapter { '+source.slice(start,end)+source.slice(plumbingStart,plumbingEnd)+' }; globalThis.Adapter=Adapter;',{loader:'ts',target:'node24'}).code;
function transport(t){
 t.mock.timers.enable({apis:['setTimeout']});
 const context={apiError:scope.apiError,setTimeout,clearTimeout};vm.runInNewContext(transportCompiled,context);
 const adapter=new context.Adapter(),calls=[],loaded={manifest:{id:'craftmine.world'},nextCallId:0,pending:new Map(),child:{postMessage:message=>calls.push(message)}};
 adapter.loaded=new Map([['craftmine.world',loaded]]);
 return {adapter,loaded,calls,answer(value){adapter.handleChildMessage(loaded,{t:'res',id:calls.at(-1).id,ok:true,value});}};
}

test('source install and proposal can exceed 15 seconds and receive one normal durable receipt',async t=>{
 const f=transport(t);
 for(const method of ['installSource','installSourceProposal']){
  let settled=false;const before=f.calls.length;
  const request=f.adapter.requestCraftmineHost('package.request',{method,args:{worldId:'world'}});request.then(()=>{settled=true;},()=>{settled=true;});
  t.mock.timers.tick(16_500);await Promise.resolve();assert.equal(settled,false);assert.equal(f.calls.length,before+1);
  const receipt={status:'check-queued',source:{revision:6},instanceIds:['existing-wall']};f.answer(receipt);assert.deepEqual(await request,receipt);assert.equal(f.loaded.pending.size,0);
 }
});

test('ordinary package reads still time out at 15 seconds without implicit retry',async t=>{
 const f=transport(t);
 for(const method of ['sourceList','sourceProposals','sourceJob','read','exportSource']){
  const before=f.calls.length,request=f.adapter.requestCraftmineHost('package.request',{method,args:{worldId:'world'}});
  const rejected=assert.rejects(request,error=>error.code==='TIMEOUT');t.mock.timers.tick(15_000);await rejected;assert.equal(f.calls.length,before+1);
 }
});

test('a timeout after 60 seconds is not evidence that the durable installation was rolled back',async t=>{
 const f=transport(t);let durableRevision=5;
 f.loaded.child.postMessage=message=>{f.calls.push(message);setTimeout(()=>{durableRevision=6;f.answer({status:'check-queued',source:{revision:durableRevision}});},65_000);};
 const request=f.adapter.requestCraftmineHost('package.request',{method:'installSource',args:{worldId:'world'}});
 const rejected=assert.rejects(request,error=>error.code==='TIMEOUT');t.mock.timers.tick(60_000);await rejected;
 // A late durable result may exist. The transport drops the late response but
 // neither repeats the installation nor sends a cancellation/rollback request.
 assert.equal(durableRevision,5);t.mock.timers.tick(5_000);
 assert.equal(durableRevision,6);assert.equal(f.calls.length,1);assert.equal(f.loaded.pending.size,0);
});
