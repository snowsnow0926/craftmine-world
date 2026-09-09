import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {compileScene,INITIAL_SNAPSHOT,upgradeScene} from '../../../app/scene.mjs';
import {canonicalJSON} from '../../../app/canonical.mjs';
const require=createRequire(import.meta.url),{CoreClient}=require('../../../plugins/craftmine-world/core-client.cjs');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const binary=process.env.CRAFTMINE_CORE_BIN;
if(!binary||!path.isAbsolute(binary))throw Error('EXPLICIT_TEST_BINARY_REQUIRED');
const context={projectId:'receipt-project',sessionId:'receipt-session',turnId:'receipt-turn'};
async function start(){const base=path.join(root,'test-results/dispatch-e-receipt');await mkdir(base,{recursive:true});const dir=await mkdtemp(path.join(base,'domain-'));const client=new CoreClient(binary,dir);await client.start();return {dir,client,call:(method,args)=>client.call(method,args,15000)};}
async function fixture(call){
  const scene=upgradeScene({format:'craftmine.scene/1',title:'Receipt',night:false,objects:[]}),compiled=compileScene(scene);
  await call('world.create',{id:'receipt-world',title:'Receipt',world:{build:{...compiled,id:'v-'+compiled.hash.slice(0,20)},snapshot:INITIAL_SNAPSHOT,extensions:[]}});
  await call('workspace.open',{context,selectedWorld:'receipt-world'});
  const request={kind:'project-rule',claim:'Keep flowers small',tags:['plants'],supersedes:[]};
  const lookup={projectId:context.projectId,sessionId:context.sessionId,worldId:'receipt-world',operationId:'receipt-one',request};
  const saved=await call('memory.propose',{context,operationId:lookup.operationId,record:{...request,id:'rule:receipt',scope:{projectId:context.projectId},sourceRefs:['user:fixture']}});
  await call('workspace.endTurn',{sessionId:context.sessionId,turnId:context.turnId,status:'completed'});
  return {lookup,saved};
}
test('actual process reads committed memory receipt after end/restart without another proposal',async t=>{
  const f=await start();let client=f.client;t.after(()=>client.stop());const {lookup,saved}=await fixture(f.call);
  assert.deepEqual(await f.call('memory.findReceipt',lookup),saved);
  for(const field of ['projectId','sessionId','worldId'])await assert.rejects(f.call('memory.findReceipt',{...lookup,[field]:'other'}),/OWNER_MISMATCH/);
  for(const [field,value] of [['claim','Different claim'],['kind','workflow'],['tags',['other']],['supersedes',['rule:other']]])await assert.rejects(f.call('memory.findReceipt',{...lookup,request:{...lookup.request,[field]:value}}),/REPLAY_MISMATCH/);
  await assert.rejects(f.call('memory.findReceipt',{...lookup,context}),/UNKNOWN_FIELD/);
  await assert.rejects(f.call('memory.findReceipt',{...lookup,request:{...lookup.request,status:'validated'}}),/UNKNOWN_FIELD/);
  assert.equal(await f.call('memory.findReceipt',{...lookup,operationId:'absent'}),null);
  await client.stop();client=new CoreClient(binary,f.dir);await client.start();assert.deepEqual(await client.call('memory.findReceipt',lookup),saved);
  const memories=await client.call('memory.search',{scope:{projectId:context.projectId,worldId:'receipt-world'}});assert.equal(memories.items.length,1);
});
test('actual process exports schema 2 and restores schema 1 with explicitly unverifiable legacy receipts',async t=>{
  const f=await start();t.after(()=>f.client.stop());const {lookup,saved}=await fixture(f.call);
  const exported=await f.call('backup.export',{operationId:'export-new'});assert.equal(exported.archive.schemaVersion,2);assert.equal((await f.call('backup.inspect',{archive:exported.archive})).valid,true);
  let hash=(await f.call('backup.status',{})).currentHash;await f.call('backup.restore',{operationId:'restore-new',archive:exported.archive,expectedCurrentHash:hash});assert.deepEqual(await f.call('memory.findReceipt',lookup),saved);
  const old=structuredClone(exported.archive);old.schemaVersion=1;old.tables.craftmine_memory_operations.columns.pop();for(const row of old.tables.craftmine_memory_operations.rows)row.pop();old.hash=createHash('sha256').update(canonicalJSON(old.tables)).digest('hex');
  assert.equal((await f.call('backup.inspect',{archive:old})).valid,true);hash=(await f.call('backup.status',{})).currentHash;await f.call('backup.restore',{operationId:'restore-old',archive:old,expectedCurrentHash:hash});
  await assert.rejects(f.call('memory.findReceipt',lookup),/MEMORY_RECEIPT_UNVERIFIABLE/);
  const next=await f.call('backup.export',{operationId:'export-upgraded'});assert.equal(next.archive.schemaVersion,2);assert.equal((await f.call('backup.inspect',{archive:next.archive})).valid,true);
  const unsupported=structuredClone(old);unsupported.schemaVersion=99;await assert.rejects(f.call('backup.inspect',{archive:unsupported}),/VERSION_UNSUPPORTED/);
  const mislabeled=structuredClone(exported.archive);mislabeled.schemaVersion=1;await assert.rejects(f.call('backup.inspect',{archive:mislabeled}),/COLUMNS_MISMATCH/);
});
