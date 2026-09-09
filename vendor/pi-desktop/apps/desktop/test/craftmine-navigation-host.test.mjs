import assert from 'node:assert/strict';
import test from 'node:test';
import {register} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
register(pathToFileURL(fileURLToPath(new URL('./helpers/ts-import-hooks.mjs',import.meta.url))));
const {invokeCraftmineNavigation}=await import('../electron/main/craftmine-navigation-host.ts');
const request=(channel,payload={})=>({pluginId:'craftmine.world',channel,payload});

test('navigation keeps raw writes and host execution credentials out of the renderer',async()=>{
  const calls=[];
  const deps={invoke:async(...args)=>calls.push(args),navigate:async(...args)=>calls.push(args)};
  for(const channel of ['world.saveProgress','godot.applicationPrepare','godot.applicationCommit','godotExecutor.register','fs.readText']) {
    await assert.rejects(invokeCraftmineNavigation(request(channel),deps),/PERMISSION_DENIED/);
  }
  await assert.rejects(invokeCraftmineNavigation({pluginId:'another',channel:'world.list'},deps),/PERMISSION_DENIED/);
  assert.deepEqual(calls,[]);
});

test('create and both switch names go through live-view checkpointing',async()=>{
  const calls=[];
  const deps={invoke:async()=>{throw Error('raw mutation must not run');},navigate:async(value)=>{calls.push(value);return value;}};
  await invokeCraftmineNavigation(request('world.create',{title:' Home ',baseId:'craftmine-web/5',token:'forged',activate:true,operationId:'op-home-1'}),deps);
  await invokeCraftmineNavigation(request('world.switch',{id:'alpha',snapshot:{fake:true}}),deps);
  await invokeCraftmineNavigation(request('world.open',{id:'beta'}),deps);
  assert.deepEqual(calls,[{operation:'create',title:'Home',baseId:'craftmine-web/5',starterId:undefined,operationId:'op-home-1'},
    {operation:'switch',id:'alpha'},{operation:'switch',id:'beta'}]);
  await assert.rejects(invokeCraftmineNavigation(request('world.create',{title:'x',operationId:'../evil'}),deps),/INVALID_OPERATION_ID/);
});

test('failed save propagates without an independent world.open or retry',async()=>{
  let calls=0;
  const deps={invoke:async()=>{throw Error('unexpected raw call');},navigate:async()=>{calls++;throw Error('SAVE_FAILED');}};
  await assert.rejects(invokeCraftmineNavigation(request('world.switch',{id:'beta'}),deps),/SAVE_FAILED/);
  assert.equal(calls,1);
});

test('reads use the real plugin and malformed mutation requests have no effects',async()=>{
  const facts={worlds:[{id:'real'}]};
  const deps={invoke:async(channel)=>{assert.equal(channel,'world.list');return facts;},navigate:async()=>{throw Error('unexpected mutation');}};
  assert.equal(await invokeCraftmineNavigation(request('world.list'),deps),facts);
  for(const input of [request('world.switch',{id:''}),request('world.create',{title:' '}),request('world.create',[])]) {
    await assert.rejects(invokeCraftmineNavigation(input,deps),/INVALID_/);
  }
});

test('auxiliary surfaces open through the retained view and never mutate a world',async()=>{
  const calls=[];
  const deps={invoke:async(channel,payload)=>{calls.push(['invoke',channel,payload]);return {};},
    navigate:async()=>{throw Error('surface must not navigate worlds');},
    showSurface:async(value)=>{calls.push(['surface',value]);return {ok:true};}};
  await invokeCraftmineNavigation(request('world.surface',{surface:{kind:'workbench',tab:'library'},section:'works'}),deps);
  await invokeCraftmineNavigation(request('world.surface',{surface:{kind:'checks'},section:'checks'}),deps);
  assert.deepEqual(calls,[
    ['surface',{operation:'surface',surface:{kind:'workbench',tab:'library'},section:'works'}],
    ['surface',{operation:'surface',surface:{kind:'checks'},section:'checks'}],
  ]);
  for(const payload of [{}, {surface:{kind:'workbench'}}, {surface:{kind:'workbench',tab:'../evil'}},
    {surface:{kind:'workbench',tab:'library'},section:'Not A Section'}, {surface:{kind:'nope'}}]) {
    await assert.rejects(invokeCraftmineNavigation(request('world.surface',payload),deps),/INVALID_SURFACE_REQUEST/);
  }
  assert.equal(calls.length,2);
});

test('the tasks summary may read recoverable drafts but no other new channel',async()=>{
  const seen=[];
  const deps={invoke:async(channel)=>{seen.push(channel);return {};},navigate:async()=>{throw Error('no');},
    showSurface:async()=>{throw Error('no');}};
  await invokeCraftmineNavigation(request('task.recoverable',{worldId:'w1'}),deps);
  assert.deepEqual(seen,['task.recoverable']);
  await assert.rejects(invokeCraftmineNavigation(request('task.resume',{taskId:'t'}),deps),/PERMISSION_DENIED/);
});
