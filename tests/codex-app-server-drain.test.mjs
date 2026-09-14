import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {CodexAppServer,protocolDiagnostic} from '../vendor/pi-desktop/packages/agent-runtime/src/codex-app-server.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t,{handshake=true}={}){
  const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
  const writes=[],failures=[],notifications=[],requests=[];let ended=0,killed=0,closed=false;
  const end=child.stdin.end.bind(child.stdin);child.stdin.end=(...args)=>{ended++;return end(...args);};child.kill=()=>{killed++;return true;};
  child.stdin.on('data',bytes=>{const m=JSON.parse(bytes.toString());writes.push(m);if(!handshake||m.id===undefined)return;
    const result=m.method==='initialize'?{userAgent:'fixture'}:m.method==='config/read'?{config:{}}:m.method==='account/read'?{account:{type:'chatgpt'}}:undefined;
    if(result!==undefined)child.stdout.write(JSON.stringify({id:m.id,result})+'\n');
  });
  const client=new CodexAppServer({binary:'never-run',cwd:process.cwd(),spawnProcess:()=>child});
  client.on('failure',e=>failures.push(e.message));client.on('notification',m=>notifications.push(m));client.on('request',m=>requests.push(m));
  async function transportClose(code=0){if(closed)return;closed=true;child.stdout.end();child.stderr.end();await tick();child.emit('close',code);}
  t.after(async()=>{if(!client.processExited)child.emit('exit',0);await transportClose();await client.close();});
  return{child,client,writes,failures,notifications,requests,transportClose,counts:()=>({ended,killed})};
}
test('exit stops new writes but a split pending RPC and late terminal notification drain before idempotent normal close',async t=>{
  const f=fixture(t);await f.client.start();const rpc=f.client.call('thread/read',{threadId:'t'}),id=f.writes.at(-1).id;
  f.child.stdout.write(JSON.stringify({id,result:{thread:{id:'t'}}}).slice(0,12));
  const close=f.client.close();assert.equal(f.client.close(),close);f.child.emit('exit',0);
  assert.equal(f.client.closed,false);assert.equal(f.client.pending.size,1);assert.deepEqual(f.failures,[]);
  const before=f.writes.length;await assert.rejects(f.client.call('new-call',{}),/CODEX_TRANSPORT_CLOSED/);f.client.respond(99,{});f.client.reject(99);assert.equal(f.writes.length,before);
  f.child.stdin.emit('error',Error('late EPIPE while draining'));
  f.child.stdout.write(JSON.stringify({id,result:{thread:{id:'t'}}}).slice(12)+'\n');
  f.child.stdout.write(JSON.stringify({method:'turn/completed',params:{turn:{id:'turn',status:'completed'}}})+'\n');
  f.child.stdout.write(JSON.stringify({id:99,method:'item/tool/call',params:{tool:'must-not-replay'}})+'\n');
  assert.deepEqual(await rpc,{thread:{id:'t'}});assert.equal(f.notifications.length,1);assert.equal(f.requests.length,0);
  await f.transportClose();await close;await f.client.close();assert.deepEqual(f.failures,[]);assert.equal(f.client.pending.size,0);assert.deepEqual(f.counts(),{ended:1,killed:0});
});
test('unexpected exit rejects outstanding RPC only after stdio close, with one failure notification',async t=>{
  const f=fixture(t);await f.client.start();let settled=false;const rpc=f.client.call('wait',{});void rpc.then(()=>settled=true,()=>settled=true);
  f.child.emit('exit',7);await tick();assert.equal(settled,false);assert.equal(f.failures.length,0);assert.equal(f.client.pending.size,1);
  const rejected=assert.rejects(rpc,/CODEX_PROCESS_EXIT:7/);await f.transportClose(7);await rejected;
  assert.deepEqual(f.failures,['CODEX_PROCESS_EXIT:7']);f.child.emit('error',Error('duplicate shutdown noise'));await f.client.close();assert.equal(f.failures.length,1);
});
test('normal close rejects missing final RPC responses without emitting a new turn failure',async t=>{
  const f=fixture(t);await f.client.start();const pending=f.client.call('wait',{}),rejected=assert.rejects(pending,/CODEX_PROCESS_EXIT:0/);
  const close=f.client.close();f.child.emit('exit',0);await f.transportClose();await close;await rejected;assert.deepEqual(f.failures,[]);
});
test('an unterminated final JSON response is delivered by stdout EOF before transport close',async t=>{
  const f=fixture(t);await f.client.start();const pending=f.client.call('thread/turns/list',{threadId:'t'}),id=f.writes.at(-1).id,close=f.client.close();
  f.child.emit('exit',0);f.child.stdout.write(JSON.stringify({id,result:{data:[],nextCursor:null}}));
  await f.transportClose();assert.deepEqual(await pending,{data:[],nextCursor:null});await close;assert.deepEqual(f.failures,[]);
});
test('async spawn error rejects initialization and duplicate close cannot leak raw startup data',async t=>{
  const f=fixture(t,{handshake:false});const start=f.client.start(),rejected=assert.rejects(start,/^Error: CODEX_PROCESS_START_FAILED$/);
  f.child.emit('error',Error('C:/private/start Bearer confidential'));await rejected;await f.transportClose(-2);await f.client.close();assert.deepEqual(f.failures,['CODEX_PROCESS_START_FAILED']);assert.equal(f.client.pending.size,0);
});
test('synchronous spawn failure is normalized and close without a child is idempotent',async()=>{
  const client=new CodexAppServer({binary:'never-run',cwd:process.cwd(),spawnProcess:()=>{throw Error('private startup details');}}),failures=[];client.on('failure',e=>failures.push(e.message));
  await assert.rejects(client.start(),/^Error: CODEX_PROCESS_START_FAILED$/);const close=client.close();assert.equal(client.close(),close);await close;assert.deepEqual(failures,['CODEX_PROCESS_START_FAILED']);
});
test('close before start prevents a late process launch rather than reopening a disposed transport',async()=>{
  let spawned=0;const client=new CodexAppServer({binary:'never-run',cwd:process.cwd(),spawnProcess:()=>{spawned++;throw Error('must not spawn');}});
  await client.close();await assert.rejects(client.start(),/CODEX_TRANSPORT_CLOSED/);assert.equal(spawned,0);
});
test('unexpected stdin errors reject pending calls once and prohibit subsequent writes',async t=>{
  const f=fixture(t);await f.client.start();const a=f.client.call('wait-a',{}),b=f.client.call('wait-b',{}),settled=Promise.allSettled([a,b]);
  f.child.stdin.emit('error',Error('EPIPE with private data'));const values=await settled;assert(values.every(v=>v.status==='rejected'&&v.reason.message==='CODEX_TRANSPORT_CLOSED'));
  await assert.rejects(f.client.call('later',{}),/CODEX_TRANSPORT_CLOSED/);assert.deepEqual(f.failures,['CODEX_TRANSPORT_CLOSED']);await f.transportClose(1);assert.equal(f.failures.length,1);
});
test('synchronous stdin write failures also reject already pending calls with a bounded transport error',async t=>{
  const f=fixture(t);await f.client.start();const first=f.client.call('wait',{});f.child.stdin.write=()=>{throw Error('raw EPIPE account details');};const second=f.client.call('trigger',{});
  const values=await Promise.allSettled([first,second]);assert(values.every(v=>v.status==='rejected'&&v.reason.message==='CODEX_TRANSPORT_CLOSED'));assert.equal(f.client.pending.size,0);assert.deepEqual(f.failures,['CODEX_TRANSPORT_CLOSED']);
});
test('interrupted recovery diagnostics recognize only requested safe methods without raw payload data',()=>{
  for(const rpcMethod of ['thread/read','thread/turns/list','turn/interrupt']){
    const value=protocolDiagnostic({rpcMethod,rpcCode:-32602,diagnostic:'safe error',params:{secret:'never copied'}},'interrupted-recovery');assert.deepEqual(value,{stage:'interrupted-recovery',rpcMethod,rpcCode:-32602,message:'safe error'});
  }
});
