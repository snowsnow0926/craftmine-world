import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CodexConnection } from '../vendor/pi-desktop/apps/desktop/electron/main/codex-connection.mjs';
import { CLI_VERSION, CodexAppServer } from '../vendor/pi-desktop/packages/agent-runtime/src/codex-app-server.mjs';

test('discovery skips incompatible first PATH candidate and exposes every checked version',async t=>{
  const cwd=await mkdtemp(join(tmpdir(),'codex-discovery-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
  let called=0;const service=new CodexConnection({cwd,pick:async()=>undefined,openExternal:async()=>{throw Error('unexpected browser');},
    discover:async()=>[join(cwd,'old.exe'),join(cwd,'broken.exe'),join(cwd,'compatible.exe')],
    inspectVersion:async path=>{called++;if(path.endsWith('broken.exe'))throw Error('private diagnostic');return path.endsWith('compatible.exe')?CLI_VERSION:'codex-cli 0.1.0';},
    clientFactory:()=>{throw Error('unexpected account access');}});
  const result=await service.invoke({action:'detect'});assert.equal(result.code,'detected');assert.equal(called,3);
  assert(result.path.endsWith('compatible.exe'));assert.deepEqual(result.candidates.map(row=>row.compatible),[false,false,true]);assert(!JSON.stringify(result).includes('private diagnostic'));
});

function fixture(t, options = {}) {
  const binary = resolve('fixture-codex.exe'), opened = [], clients = [];
  let account = options.account === undefined ? { type: 'chatgpt', email: 'player@example.test', planType: 'pro', access_token: 'SECRET' } : options.account;
  class Client extends EventEmitter {
    calls = []; closed = false;
    async start(value) { assert.equal(value.requireAccount, false); if (options.startError) throw Error(options.startError); }
    async call(method, params) {
      this.calls.push({ method, params });
      assert(!['thread/start', 'turn/start', 'account/logout'].includes(method));
      if (method === 'account/read') return options.readAccount ? options.readAccount() : { account };
      if (method === 'model/list') return options.pages?.[params.cursor ?? 'first'] ?? { data: [{model: 'gpt-6-astra', supportedReasoningEfforts: [{reasoningEffort:'xhigh'}]}], nextCursor: null };
      if (method === 'account/login/start') {
        if (options.earlyLogin) this.emit('notification',{method:'account/login/completed',params:{loginId:'login-one',success:true}});
        return { type:'chatgpt', loginId:'login-one', authUrl:options.url ?? 'https://auth.openai.com/authorize?state=private' };
      }
      return {};
    }
    reject(id) { this.rejected = id; }
    async close() { this.closed = true; }
  }
  const cwdPromise = mkdtemp(join(tmpdir(), 'craftmine-codex-connection-'));
  t.after(async () => { await service.dispose(); await rm(await cwdPromise, {recursive:true, force:true}); });
  let service;
  return cwdPromise.then(cwd => {
    service = new CodexConnection({ cwd, pick: async () => binary, detect: async () => options.missing ? undefined : binary,
      openExternal: async url => opened.push(url), inspectVersion: options.inspectVersion ?? (async () => options.version ?? CLI_VERSION),
      clientFactory: () => { const client = new Client(); clients.push(client); return client; } });
    return { service, binary, opened, clients, setAccount: next => { account = next; } };
  });
}
test('detection/picker verifies exact version without touching account or auto opening browser', async t => {
  const f = await fixture(t);
  for (const action of ['detect','pick']) {
    const status = await f.service.invoke({action});
    assert.equal(status.code, 'detected'); assert.equal(status.path, f.binary);
  }
  assert.equal(f.clients.length, 0); assert.deepEqual(f.opened, []);
});
test('verify checks current account plus paginated exact model and effort; returns no credentials', async t => {
  const f = await fixture(t, { pages: { first:{data:[{model:'other'}],nextCursor:'second'},second:{data:[{model:'gpt-6-astra', supportedReasoningEfforts:[{reasoningEffort:'xhigh'}]}],nextCursor:null} } });
  const status = await f.service.invoke({action:'verify',path:f.binary});
  assert.equal(status.code,'ready'); assert.equal(status.model,'gpt-6-astra'); assert.equal(status.effort,'xhigh');
  assert.equal(status.account.email,'player@example.test'); assert(!JSON.stringify(status).includes('SECRET'));
  assert.equal(f.clients[0].calls.filter(x => x.method === 'model/list').length,2);
  assert(f.clients[0].closed);
});
for (const [name, options, expected] of [
  ['missing', {missing:true}, 'CODEX_NOT_FOUND'], ['version',{version:'codex-cli 1.0.0'},'CODEX_VERSION_MISMATCH'],
  ['no login',{account:null},'CODEX_CHATGPT_LOGIN_REQUIRED'], ['API key',{account:{type:'apiKey',apiKey:'SECRET'}},'CODEX_AUTH_MODE_UNSUPPORTED'],
  ['missing model',{pages:{first:{data:[{model:'gpt-5.6-sol'}]}}},'CODEX_MODEL_UNAVAILABLE'],
  ['effort',{pages:{first:{data:[{model:'gpt-6-astra',supportedReasoningEfforts:[{reasoningEffort:'high'}]}]}}},'CODEX_EFFORT_UNAVAILABLE'],
  ['custom endpoint',{startError:'CODEX_CUSTOM_ENDPOINT_UNSUPPORTED'},'CODEX_CUSTOM_ENDPOINT_UNSUPPORTED'],
  ['unexpected diagnostic',{startError:'Bearer SECRET'},'CODEX_CONNECTION_FAILED'],
]) test(`actionable ${name} failure without fallback`,async t=>{
  const f=await fixture(t,options); const status=await f.service.invoke({action:options.missing?'detect':'verify',path:f.binary});
  assert.equal(status.code,expected); assert(!JSON.stringify(status).includes('SECRET'));
  assert(f.clients.every(client=>client.closed));
});
test('login is explicitly opened, matched completion rechecks capabilities, status never exposes URL or tokens',async t=>{
  const f=await fixture(t,{account:null});
  const status=await f.service.invoke({action:'login',path:f.binary});
  assert.equal(status.code,'login_pending'); assert(status.loginPending); assert.equal(f.opened.length,0);
  assert(!JSON.stringify(status).includes('private'));
  await f.service.invoke({action:'openLogin'}); assert.equal(f.opened.length,1);
  const client=f.clients[0]; client.emit('notification',{method:'account/login/completed',params:{loginId:'other',success:true}});
  assert((await f.service.invoke({action:'status'})).loginPending);
  f.setAccount({type:'chatgpt',email:'player@example.test'});
  client.emit('notification',{method:'account/login/completed',params:{loginId:'login-one',success:true}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await f.service.invoke({action:'status'})).code,'ready'); assert(client.closed);
});
test('cancel owns its login, rejects late completion and never logs out',async t=>{
  const f=await fixture(t,{account:null}); await f.service.invoke({action:'login',path:f.binary});
  const client=f.clients[0]; await f.service.invoke({action:'cancel'});
  assert(client.calls.some(x=>x.method==='account/login/cancel'&&x.params.loginId==='login-one'));
  client.emit('notification',{method:'account/login/completed',params:{loginId:'login-one',success:true}});
  assert.equal((await f.service.invoke({action:'status'})).code,'cancelled');
});
test('completion arriving before login response is retained and verified',async t=>{
  let reads=0;
  const f=await fixture(t,{earlyLogin:true,readAccount:async()=>({account:++reads===1?null:{type:'chatgpt'}})});
  await f.service.invoke({action:'login',path:f.binary});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await f.service.invoke({action:'status'})).code,'ready');
});
test('opening login during completion verification cannot invalidate or strand it',async t=>{
  let reads=0,finish;
  const f=await fixture(t,{readAccount:()=>++reads===1?Promise.resolve({account:null}):new Promise(resolve=>{finish=resolve;})});
  await f.service.invoke({action:'login',path:f.binary});
  f.clients[0].emit('notification',{method:'account/login/completed',params:{loginId:'login-one',success:true}});
  assert((await f.service.invoke({action:'openLogin'})).loginPending);
  finish({account:{type:'chatgpt'}});await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await f.service.invoke({action:'status'})).code,'ready');assert.equal(f.opened.length,0);
});
test('failed process clears login and arbitrary RPC/URL inputs are rejected',async t=>{
  const f=await fixture(t,{account:null}); await f.service.invoke({action:'login',path:f.binary});
  f.clients[0].emit('failure',Error('SECRET'));
  assert.equal((await f.service.invoke({action:'status'})).code,'CODEX_CONNECTION_FAILED');
  await assert.rejects(f.service.invoke({action:'account/logout'}),/CODEX_INVALID_REQUEST/);
  await assert.rejects(f.service.invoke({action:'openLogin',url:'https://evil.test'}),/CODEX_INVALID_REQUEST/);
});
for(const url of ['https://auth.openai.com.evil.test/login','http://auth.openai.com/login','https://user:password@auth.openai.com/login'])
  test('rejects unsafe login address '+url,async t=>{
    const f=await fixture(t,{account:null,url});
    assert.equal((await f.service.invoke({action:'login',path:f.binary})).code,'CODEX_LOGIN_URL_INVALID');
    assert.equal(f.opened.length,0); assert(f.clients[0].closed);
  });
test('cancel during version detection prevents a late connection',async t=>{
  let release; const f=await fixture(t,{inspectVersion:()=>new Promise(resolve=>{release=resolve;})});
  const pending=f.service.invoke({action:'verify',path:f.binary});
  while(!release) await new Promise(resolve=>setImmediate(resolve));
  await f.service.invoke({action:'cancel'}); release(CLI_VERSION); await pending;
  assert.equal(f.clients.length,0); assert.equal((await f.service.invoke({action:'status'})).code,'cancelled');
});
test('restricted real transport initializes without credentials and completes fixture login with no thread',async t=>{
  const cwd=await mkdtemp(join(tmpdir(),'craftmine-connection-transport-')),calls=[],clients=[];
  const service=new CodexConnection({cwd,pick:async()=>undefined,openExternal:async()=>assert.fail('No browser should open'),
    inspectVersion:async()=>CLI_VERSION,clientFactory:options=>{
      const client=new CodexAppServer({...options,spawnProcess:(binary,args,config)=>{
        assert.equal(config.windowsHide,true);assert.equal(config.shell,false);assert.equal(config.env.OPENAI_API_KEY,undefined);
        return spawn(process.execPath,[resolve('tests/fixtures/codex-connection-server.cjs')],config);
      }});
      const original=client.call.bind(client);client.call=(method,params)=>{calls.push(method);return original(method,params);};
      clients.push(client);return client;
    }});
  t.after(async()=>{await service.dispose();await rm(cwd,{recursive:true,force:true});});
  assert.equal((await service.invoke({action:'login',path:resolve('mock.exe')})).code,'login_pending');
  while((await service.invoke({action:'status'})).loginPending)await new Promise(resolve=>setTimeout(resolve,10));
  const state=await service.invoke({action:'status'});assert.equal(state.code,'ready');
  assert(!JSON.stringify(state).includes('MUST_NOT_LEAVE_HOST'));assert(!calls.some(method=>/thread|turn|logout/.test(method)));
  await clients[0].exited;
});
