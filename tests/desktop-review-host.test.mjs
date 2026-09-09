import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const desktop=path.resolve('vendor/pi-desktop/apps/desktop');
register(pathToFileURL(path.join(desktop,'test/helpers/ts-import-hooks.mjs')));
const {PluginRuntime}=await import(pathToFileURL(path.join(desktop,'electron/main/plugin-runtime.ts')));

test('the actual host bridge cancels a review, refuses late success and releases its request ID',async()=>{
  let release,signal;
  const audit=[];
  const runtime=new PluginRuntime({complete:async input=>{
    signal=input.signal;
    return await new Promise(resolve=>{release=()=>resolve({text:'late result',modelKey:input.modelKey});});
  },audit:row=>audit.push(row)});
  const loaded={manifest:{id:'craftmine.world'},permissions:new Set(['agent.complete'])};
  const id='review-'+'a'.repeat(64),input={modelKey:'fixture/model',messages:[{role:'user',content:'request'}]};
  const invoke=(api,args,plugin=loaded)=>runtime.dispatchHostCall(plugin,api,args);
  await assert.rejects(invoke('craftmine.complete',[id,input],{...loaded,manifest:{id:'third-party'}}),/Built-in review unavailable/);
  const first=invoke('craftmine.complete',[id,input]);
  await assert.rejects(invoke('craftmine.complete',[id,input]),/already running/);
  await invoke('craftmine.cancelComplete',[id]);
  assert.equal(signal.aborted,true);
  const cancelled=assert.rejects(first,error=>error.code==='CANCELLED');
  release();await cancelled;
  assert.ok(audit.some(row=>row.errorCode==='CANCELLED'));
  assert.ok(!audit.some(row=>row.errorCode==='TIMEOUT'||row.ok));
  const second=invoke('craftmine.complete',[id,input]);
  assert.equal(signal.aborted,false);release();
  assert.equal((await second).text,'late result');
});
