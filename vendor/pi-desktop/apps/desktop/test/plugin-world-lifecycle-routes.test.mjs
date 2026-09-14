import test from 'node:test';import assert from 'node:assert/strict';import {register} from 'node:module';
register(new URL('./helpers/ts-import-hooks.mjs',import.meta.url));
const {PluginRuntime}=await import('../electron/main/plugin-runtime.ts');
test('actual PluginRuntime lifecycle gate and child RPC transport admit archive and exact initialization cancellation methods',async()=>{
 const runtime=new PluginRuntime({}),sent=[];
 const loaded={manifest:{id:'craftmine.world'},pending:new Map(),nextCallId:1,child:{postMessage(message){sent.push(message);queueMicrotask(()=>runtime.handleChildMessage(loaded,{t:'res',id:message.id,ok:true,value:message.payload}));}}};
 runtime.loaded.set('craftmine.world',loaded);
 for(const method of ['world.archiveStatus','world.archiveFailed','world.archivedList','world.restoreArchived','godotWorld.initCancel','godotWorld.initCancelClear','worldTemplate.list','worldTemplate.read','worldTemplate.describe','worldTemplate.save','worldTemplate.status','worldTemplate.cancel','worldTemplate.prepare','worldTemplate.importArchive','worldTemplate.exportArchive']){
  const params=method==='world.archivedList'?{}:method.startsWith('godotWorld.')?{worldId:'world-one'}:method==='world.archiveFailed'?{id:'world-one',revision:0,baseBuild:'base-a'}:{id:'world-one'};
  assert.deepEqual(await runtime.requestCraftmineHost(method,params),{method,params});
  assert.equal(sent.at(-1).method,'lifecycle.craftmineRequest');assert.equal(loaded.pending.size,0);
 }
 const count=sent.length;
 for(const method of ['world.deleteFiles','godotExecutor.cancel','arbitrary.execute','worldTemplate.delete','worldTemplate.execute','worldTemplate.import'])await assert.rejects(runtime.requestCraftmineHost(method,{}),/Unsupported/);
 assert.equal(sent.length,count);runtime.loaded.clear();await assert.rejects(runtime.requestCraftmineHost('world.archivedList',{}),/service unavailable/);
});
test('player execution policy recovery traverses the actual private bridge without allowing arbitrary budget writes',async()=>{
 const runtime=new PluginRuntime({}),sent=[];
 const loaded={manifest:{id:'craftmine.world'},pending:new Map(),nextCallId:1,child:{postMessage(message){sent.push(message);queueMicrotask(()=>runtime.handleChildMessage(loaded,{t:'res',id:message.id,ok:true,value:message.payload}));}}};
 runtime.loaded.set('craftmine.world',loaded);
 const params={projectId:'project',sessionId:'session',worldId:'world',taskId:'task',generation:1,operationId:'player-release'};
 for(const method of ['budget.releaseExecutionLimits','budget.findExecutionReleaseReceipt'])assert.deepEqual(await runtime.requestCraftmineHost(method,params),{method,params});
 for(const method of ['budget.reset','budget.clearLedger','budget.setLimits'])await assert.rejects(runtime.requestCraftmineHost(method,params),/Unsupported/);
 assert.equal(sent.length,2);assert.equal(loaded.pending.size,0);
});
