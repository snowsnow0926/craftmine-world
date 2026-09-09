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
  await invokeCraftmineNavigation(request('world.create',{title:' Home ',baseId:'craftmine-web/5',token:'forged',activate:true}),deps);
  await invokeCraftmineNavigation(request('world.switch',{id:'alpha',snapshot:{fake:true}}),deps);
  await invokeCraftmineNavigation(request('world.open',{id:'beta'}),deps);
  assert.deepEqual(calls,[{operation:'create',title:'Home',baseId:'craftmine-web/5',starterId:undefined},
    {operation:'switch',id:'alpha'},{operation:'switch',id:'beta'}]);
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
