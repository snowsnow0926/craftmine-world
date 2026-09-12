import test from 'node:test';import assert from 'node:assert/strict';import {register} from 'node:module';
register(new URL('./helpers/ts-import-hooks.mjs',import.meta.url));
const {PluginRuntime}=await import('../electron/main/plugin-runtime.ts');
test('actual PluginRuntime lifecycle gate and child RPC transport admit archive and exact initialization cancellation methods',async()=>{
 const runtime=new PluginRuntime({}),sent=[];
 const loaded={manifest:{id:'craftmine.world'},pending:new Map(),nextCallId:1,child:{postMessage(message){sent.push(message);queueMicrotask(()=>runtime.handleChildMessage(loaded,{t:'res',id:message.id,ok:true,value:message.payload}));}}};
 runtime.loaded.set('craftmine.world',loaded);
 for(const method of ['world.archiveStatus','world.archiveFailed','world.archivedList','world.restoreArchived','godotWorld.initCancel','godotWorld.initCancelClear']){
  const params=method==='world.archivedList'?{}:method.startsWith('godotWorld.')?{worldId:'world-one'}:method==='world.archiveFailed'?{id:'world-one',revision:0,baseBuild:'base-a'}:{id:'world-one'};
  assert.deepEqual(await runtime.requestCraftmineHost(method,params),{method,params});
  assert.equal(sent.at(-1).method,'lifecycle.craftmineRequest');assert.equal(loaded.pending.size,0);
 }
 const count=sent.length;
 for(const method of ['world.deleteFiles','godotExecutor.cancel','arbitrary.execute'])await assert.rejects(runtime.requestCraftmineHost(method,{}),/Unsupported/);
 assert.equal(sent.length,count);runtime.loaded.clear();await assert.rejects(runtime.requestCraftmineHost('world.archivedList',{}),/service unavailable/);
});
