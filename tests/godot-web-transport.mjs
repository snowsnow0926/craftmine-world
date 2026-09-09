// Native MessageChannel regressions. No browser, UI input or game process.
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {webcrypto} from 'node:crypto';
import {connectGodotFrame} from '../desktop/godot/web/host.mjs';

const savedGlobals=new Map(['location','MessageChannel','crypto'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
Object.defineProperty(globalThis,'location',{configurable:true,value:new URL('http://127.0.0.1:41001/desktop')});
Object.defineProperty(globalThis,'MessageChannel',{configurable:true,value:MessageChannel});
if(!globalThis.crypto)Object.defineProperty(globalThis,'crypto',{configurable:true,value:webcrypto});
function bounded(promise,label){
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Test watchdog: '+label)),2000);})]).finally(()=>clearTimeout(timer));
}
function fixture({timeoutMs=300,autoReady=true}={}){
  let gamePort,scope;
  const requests=[],waiters=[];
  const frame={src:'http://127.0.0.1:41002/world/index.html',contentWindow:{
    postMessage(message,origin,ports){
      assert.equal(origin,'http://127.0.0.1:41002');assert.equal(ports.length,1);
      // Native transfer detaches the sender port and preserves structured-clone semantics.
      const received=structuredClone({message,port:ports[0]},{transfer:[ports[0]]});
      gamePort=received.port;
      const {protocol,worldId,buildId,session}=received.message;
      scope={protocol,worldId,buildId,session};
      gamePort.onmessage=event=>{if(waiters.length)waiters.shift()(event.data);else requests.push(event.data);};
      gamePort.start();if(autoReady)gamePort.postMessage({...scope,type:'ready'});
    },
  }};
  const handle=connectGodotFrame(frame,{worldId:'world-a',buildId:'build-a',timeoutMs});
  return {
    handle,
    next:()=>bounded(requests.length?Promise.resolve(requests.shift()):new Promise(resolve=>waiters.push(resolve)),'receive request'),
    send:value=>gamePort.postMessage({...scope,...value}),
    reply:(request,result)=>gamePort.postMessage({...scope,type:'response',id:request.id,result}),
    close:()=>{handle.dispose();gamePort.close();},
  };
}
const cases=[];
const add=(name,run)=>cases.push({name,run});
async function echo(f,value={ok:true}){
  const result=f.handle.request('snapshot');const request=await f.next();f.reply(request,value);
  assert.deepEqual(await bounded(result,'echo'),value);
}
add('Native request and response preserve a cloned payload',async f=>{
  const args={nested:{values:[1,'two',true]}};
  const result=f.handle.request('snapshot',args),request=await f.next();
  assert.deepEqual(request.args,args);assert.notEqual(request.args,args);
  f.reply(request,{state:request.args});assert.deepEqual(await result,{state:args});
});
for(const [label,override] of [['world',{worldId:'wrong-world'}],['build',{buildId:'wrong-build'}],['session',{session:'wrong-session'}],['protocol',{protocol:'other/1'}]]){
  add('Wrong '+label+' response is ignored',async f=>{
    const result=f.handle.request('snapshot'),request=await f.next();
    f.send({type:'response',id:request.id,result:'wrong',...override});
    f.reply(request,'correct');assert.equal(await result,'correct');
  });
}
for(const [label,make] of [
  ['cyclic',()=>{const value={};value.self=value;return value;}],
  ['BigInt',()=>({value:1n})],
  ['oversized',()=>({value:'x'.repeat(70000)})],
]){
  add(label+' response rejects explicitly and preserves subsequent requests',async f=>{
    const result=f.handle.request('snapshot');
    const rejection=assert.rejects(bounded(result,label+' response'),error=>{
      assert.match(error.message,/invalid|serializ|malformed|oversized|size|large/i);
      assert.doesNotMatch(error.message,/timed out|watchdog/i);return true;
    });
    const request=await f.next();f.reply(request,make());await rejection;await echo(f);
  });
}
for(const [label,make] of [
  ['cyclic',()=>{const value={};value.self=value;return value;}],
  ['BigInt',()=>({value:1n})],
  ['oversized',()=>({value:'x'.repeat(70000)})],
  ['uncloneable function',()=>({value:()=>{}})],
]){
  add(label+' request rejects explicitly without consuming pending capacity',async f=>{
    await assert.rejects(f.handle.request('snapshot',make()),/invalid preview request/i);
    await echo(f);
  });
}
add('Diagnostics retain at most 32 entries and do not stop requests',async f=>{
  for(let index=0;index<50;index++)f.send({type:'runtime-error',error:'diagnostic-'+index+':'+ 'x'.repeat(3000)});
  await echo(f);assert.equal(f.handle.errors.length,32);assert.ok(f.handle.errors.every(value=>value.length<=2000));
  const external=f.handle.errors;external.length=0;assert.equal(f.handle.errors.length,32);
});
add('Exit promptly rejects every outstanding request',async f=>{
  const first=f.handle.request('save'),second=f.handle.request('snapshot');
  const outcomes=Promise.allSettled([first,second]);await f.next();await f.next();
  f.send({type:'exited',exitCode:1});const values=await bounded(outcomes,'exit rejection');
  assert.ok(values.every(value=>value.status==='rejected'&&/exit|closed|unavailable/i.test(value.reason.message)));
  f.send({type:'ready'});await assert.rejects(f.handle.request('snapshot'),/not ready|closed|exit/i);
});
add('Disposal rejects outstanding requests and later use',async f=>{
  const result=f.handle.request('save');const rejection=assert.rejects(bounded(result,'dispose rejection'),/closed|disposed/i);
  await f.next();f.handle.dispose();await rejection;
  await assert.rejects(f.handle.request('snapshot'),/not ready|closed/i);
});
add('Request timeout releases capacity and accepts subsequent requests',async f=>{
  const result=f.handle.request('snapshot');const rejection=assert.rejects(bounded(result,'request timeout'),/timed out/i);
  const expired=await f.next();await rejection;f.reply(expired,{stale:true});await echo(f);
});
add('Sixteen pending requests are bounded and can all complete',async f=>{
  const results=Array.from({length:16},()=>f.handle.request('snapshot'));
  await assert.rejects(f.handle.request('snapshot'),/too many/i);
  for(let index=0;index<16;index++)f.reply(await f.next(),{index});
  assert.equal((await Promise.all(results)).length,16);await echo(f);
});
let passed=0;
try{
  assert.throws(()=>connectGodotFrame({src:location.origin},{worldId:'a',buildId:'b'}),/separate HTTP/i);
  console.log('PASS Same privileged origin is rejected');passed++;
  for(const value of [0,-1,Infinity,NaN,60001])assert.throws(()=>connectGodotFrame({src:'http://127.0.0.1:41002'},{worldId:'a',buildId:'b',timeoutMs:value}),/timeout/i);
  console.log('PASS Invalid timeout bounds are rejected');passed++;
  for(const value of [undefined,null,42,{},'', 'x'.repeat(129),'world/escape'])for(const key of ['worldId','buildId'])assert.throws(()=>connectGodotFrame({src:'http://127.0.0.1:41002'},{worldId:'a',buildId:'b',[key]:value}),/identity/i);
  console.log('PASS Invalid world/build identity types and values are rejected');passed++;
  const unready=fixture({timeoutMs:50,autoReady:false});
  try{await assert.rejects(bounded(unready.handle.ready,'startup timeout'),/startup timed out/i);}finally{unready.close();}
  console.log('PASS Startup timeout terminates an unready connection');passed++;
  for(const entry of cases){
    const f=fixture();
    try{await bounded(f.handle.ready,'ready');await entry.run(f);console.log('PASS '+entry.name);passed++;}finally{f.close();}
  }
  console.log(JSON.stringify({kind:'native-message-channel-godot-preview',passed,total:cases.length+4}));
}finally{
  for(const [key,descriptor] of savedGlobals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
}
