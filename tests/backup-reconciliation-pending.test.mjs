import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createCraftmineBackupService} from '../vendor/pi-desktop/apps/desktop/electron/main/craftmine-backup-service.ts';
import {backupRestorePendingMessage,backupErrorMessage} from '../plugins/craftmine-world/backup-errors.mjs';

const archiveHash='a'.repeat(64),currentHash='b'.repeat(64),pendingCode='BACKUP_RESTORED_RECONCILIATION_PENDING';
async function fixture({reply,afterFailure=true}={}){
 const base=await fs.realpath(os.tmpdir()),dir=await fs.mkdtemp(path.join(base,'backup-reconciliation-')),file=path.join(dir,'synthetic.craftmine');
 await fs.writeFile(file,'synthetic backup boundary fixture, not a real world');
 const calls=[];
 const service=createCraftmineBackupService({pickFile:async()=>file,beforeRestore:async value=>{calls.push(['before',value]);},
  afterRestore:async value=>{calls.push(['after',value]);if(value.activated&&afterFailure)throw Error('CREATION_PACK_SOURCE_PIN_MISSING C:/private/secret');},
  domainCall:async(method,args)=>{calls.push([method,args]);if(method==='backup.inspectPortable')return{headerValid:true,archiveHash};if(method==='backup.verifyPortable')return{valid:true,archiveHash,verifiedFiles:1,entries:1};if(method==='backup.status')return{currentHash};
   if(method==='backup.restorePortableActive'){if(reply instanceof Error)throw reply;return reply??{id:args.operationId,status:'completed',activated:true,currentHash:archiveHash,rebuildRequired:['gbd-'+'c'.repeat(64)]};}throw Error('Unexpected method');}});
 const grant=await service.request('backup.inspect');
 return{service,calls,dir,args:{operationId:'restore-pending-fixture',grantId:grant.grantId,expectedCurrentHash:grant.expectedCurrentHash}};
}
test('confirmed activation followed by reconciliation failure returns one durable partial result',async()=>{
 const f=await fixture(),result=await f.service.request('backup.restore',f.args);
 assert.equal(result.status,'reconciliation-pending');assert.equal(result.activated,true);assert.equal(result.errorCode,pendingCode);assert.equal(result.operationId,f.args.operationId);assert.equal(result.currentHash,archiveHash);
 assert.deepEqual(await f.service.request('backup.status',{operationId:f.args.operationId}),result);
 assert.deepEqual(await f.service.request('backup.restore',f.args),result);
 await assert.rejects(f.service.request('backup.cancel',{operationId:f.args.operationId}),/BACKUP_ALREADY_ACTIVATED/);
 assert.deepEqual(await f.service.request('backup.status',{operationId:f.args.operationId}),result);
 assert.equal(f.calls.filter(([op])=>op==='backup.restorePortableActive').length,1);
 assert.deepEqual(f.calls.filter(([op])=>op==='after').map(([,value])=>value.activated),[true]);
 assert.equal(f.calls.filter(([op])=>op==='before').length,1);
 assert.equal(JSON.stringify(result).includes('private'),false);assert.equal(JSON.stringify(result).includes('secret'),false);
 await assert.rejects(f.service.request('backup.restore',{...f.args,operationId:'different-operation'}),/BACKUP_GRANT_EXPIRED/);
});
test('concurrent retry shares one activation and one reconciliation failure',async()=>{
 const f=await fixture();const [one,two]=await Promise.all([f.service.request('backup.restore',f.args),f.service.request('backup.restore',f.args)]);
 assert.deepEqual(one,two);assert.equal(f.calls.filter(([op])=>op==='backup.restorePortableActive').length,1);assert.equal(f.calls.filter(([op])=>op==='after').length,1);
});
test('unknown lost receipt and unconfirmed activation never manufacture an activated outcome',async()=>{
 for(const reply of [Error('unknown transport loss with private filename'),{status:'completed',activated:false},{status:'running',activated:true}]){
  const f=await fixture({reply});await assert.rejects(f.service.request('backup.restore',f.args));
  const status=await f.service.request('backup.status',{operationId:f.args.operationId});assert.notEqual(status.activated,true);assert.notEqual(status.status,'reconciliation-pending');
  assert.deepEqual(f.calls.filter(([op])=>op==='after').map(([,value])=>value.activated),[false]);
 }
});
test('normal reconciliation remains completed',async()=>{
 const f=await fixture({afterFailure:false});const result=await f.service.request('backup.restore',f.args);assert.equal(result.status,'completed');assert.equal(result.activated,true);assert.equal(result.errorCode,undefined);
});
test('UI distinguishes restored data from pending startup using exact finite fields',()=>{
 const result={status:'reconciliation-pending',activated:true,errorCode:pendingCode};const message=backupRestorePendingMessage(result);
 assert.match(message,/资料已恢复/);assert.match(message,/启动或界面交接尚未完成/);assert.match(message,/重新打开应用/);assert.match(message,/不要再次恢复/);
 for(const changed of [{...result,activated:false},{...result,status:'completed'},{...result,errorCode:'private text'}])assert.equal(backupRestorePendingMessage(changed),null);
 assert.equal(backupErrorMessage({errorCode:pendingCode,message:'private text'}),message);
 assert.match(backupErrorMessage(Error('BACKUP_ALREADY_ACTIVATED')),/不能取消/);
});

const {build}=createRequire(new URL('../vendor/pi-desktop/packages/agent-runtime/package.json',import.meta.url))('esbuild');
async function load(name){const output=await build({entryPoints:[path.resolve('vendor/pi-desktop/apps/desktop/electron/main/'+name+'.ts')],bundle:true,platform:'node',format:'esm',write:false});return import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));}
test('operation journal retains pending outcome across restart instead of replaying restore',async()=>{
 const {createCraftmineOperationJournal}=await load('craftmine-operation-journal'),f=await fixture();
 const owner={worldId:'world',projectId:'project',sessionId:'session'},journal=createCraftmineOperationJournal(f.dir);
 const prepared=await journal.prepare(owner,'backup.restore',{grantId:f.args.grantId,expectedCurrentHash:currentHash},f.args.operationId);
 const result=await journal.execute(owner,prepared.operationId,()=>f.service.request('backup.restore',f.args));
 const restarted=createCraftmineOperationJournal(f.dir),rows=await restarted.list(owner);assert.equal(rows[0].state,'completed');assert.equal(rows[0].result.status,'reconciliation-pending');assert.ok(backupRestorePendingMessage(rows[0].result));
 assert.deepEqual(await restarted.execute(owner,prepared.operationId,()=>{throw Error('must not replay');}),result);
});
test('panel recovery reuses pending status without invoking backup.restore again',async()=>{
 const {createCraftminePanelGateway}=await load('craftmine-panel-gateway'),{createCraftmineOperationJournal}=await load('craftmine-operation-journal'),f=await fixture(),pending=await f.service.request('backup.restore',f.args);let restores=0;
 const panel=createCraftminePanelGateway({operations:createCraftmineOperationJournal(f.dir),viewingSession:()=>null,session:async()=>null,activeTurn:()=>undefined,
  begin:async()=>{throw Error('no task');},end:async()=>{},stop:async()=>{},resume:async()=>{},interrupt:async()=>{},diagnostics:async()=>({}),
  domain:async(method)=>{if(method==='selection.read')return{worldId:'world'};throw Error('unexpected domain');},
  backup:async(channel)=>{if(channel==='backup.status')return pending;restores++;throw Error('must not replay');}});
 const prepared=await panel('workbench.prepare',{worldId:'world',channel:'backup.restore',payload:{grantId:f.args.grantId,expectedCurrentHash:currentHash}});
 assert.deepEqual(await panel('workbench.execute',{worldId:'world',operationId:prepared.operationId}),pending);assert.equal(restores,0);
});
test('journal rejects arbitrary error details and unconfirmed partial outcomes',async()=>{
 const {createCraftmineOperationJournal}=await load('craftmine-operation-journal'),f=await fixture(),owner={worldId:'world',projectId:'project',sessionId:'session'};
 const journal=createCraftmineOperationJournal(f.dir),prepared=await journal.prepare(owner,'backup.restore',{grantId:f.args.grantId,expectedCurrentHash:currentHash});
 for(const result of [{status:'reconciliation-pending',activated:false,errorCode:pendingCode},{status:'reconciliation-pending',activated:true,errorCode:'C:/private/secret'},{status:'completed',activated:true,errorCode:pendingCode}]){
  await assert.rejects(journal.execute(owner,prepared.operationId,async()=>result),/INVALID_OPERATION_RECEIPT/);
 }
});
