// HTTP-only fixture contract. Does not start Electron, Godot or a real model.
import assert from 'node:assert/strict';
import test from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {startInterruptibleProvider,PARTIAL_TEXT} from './helpers/interruptible-provider.mjs';

test('unfinished stream survives finishFuture, abort is recorded, new stream completes',async()=>{
 const provider=await startInterruptibleProvider();
 const controller=new AbortController();
 const request=()=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'protocol-interruption-fixture',stream:true,messages:[{role:'user',content:'fixture'}]})});
 try{
  const response=await fetch(provider.url+'/chat/completions',{...request(),signal:controller.signal});
  assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/event-stream/);
  const reader=response.body.getReader(),first=new TextDecoder().decode((await reader.read()).value);
  assert.ok(first.includes(PARTIAL_TEXT));assert.ok(!first.includes('[DONE]'));
  provider.finishFuture();assert.equal(provider.requests[0].finished,false);
  controller.abort();await reader.read().catch(()=>{});
  for(let n=0;n<30&&!provider.requests[0].closed;n++)await delay(10);
  assert.equal(provider.requests[0].closed,true);assert.equal(provider.requests[0].finished,false);
  const completed=await fetch(provider.url+'/chat/completions',request()),text=await completed.text();
  const chunks=text.split('\n\n').filter(Boolean).map(line=>line.slice(6));
  assert.equal(chunks.at(-1),'[DONE]');
  const values=chunks.slice(0,-1).map(JSON.parse);
  assert.equal(values.at(-1).choices[0].finish_reason,'stop');
  assert.equal(values[0].choices[0].delta.content,PARTIAL_TEXT);
  assert.equal(provider.requests[1].finished,true);
  assert.deepEqual(Object.keys(provider.requests[0]).sort(),['closed','finished','model','number','stream']);
 }finally{controller.abort();await provider.close();}
});

test('fixture rejects other models and non-streaming requests',async()=>{
 const provider=await startInterruptibleProvider();
 try{
  for(const input of [{model:'commercial-model',stream:true},{model:'protocol-interruption-fixture',stream:false}]){
   const result=await fetch(provider.url+'/chat/completions',{method:'POST',body:JSON.stringify(input)});
   assert.equal(result.status,400);assert.match(await result.text(),/UNEXPECTED_PROVIDER_REQUEST/);
  }
  assert.equal(provider.requests.length,0);
 }finally{await provider.close();}
});
