import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createCraftmineBackupService,backupServiceErrorCode} from '../vendor/pi-desktop/apps/desktop/electron/main/craftmine-backup-service.ts';
import {backupErrorMessage} from '../plugins/craftmine-world/backup-errors.mjs';
const archiveHash='a'.repeat(64),currentHash='b'.repeat(64);

async function fixture(t,beforeRestore){
 const base=await fs.realpath(os.tmpdir()),dir=await fs.mkdtemp(path.join(base,'craftmine-backup-errors-'));
 t.after(async()=>{const resolved=await fs.realpath(dir);if(path.dirname(resolved)!==base||!path.basename(resolved).startsWith('craftmine-backup-errors-'))throw Error('Unexpected temporary target');await fs.rm(resolved,{recursive:true,force:true});});
 const file=path.join(dir,'synthetic.craftmine');await fs.writeFile(file,'synthetic archive for contract fixture');
 const calls=[];
 const service=createCraftmineBackupService({pickFile:async()=>file,beforeRestore,afterRestore:async input=>{calls.push(['afterRestore',input]);},
  domainCall:async(method,args)=>{
   calls.push([method,args]);
   if(method==='backup.inspectPortable')return{headerValid:true,archiveHash};
   if(method==='backup.verifyPortable')return{valid:true,archiveHash,verifiedFiles:1,entries:1};
   if(method==='backup.status')return{currentHash};
   if(method==='backup.restorePortableActive')return{id:args.operationId,status:'completed',activated:true,currentHash:archiveHash};
   throw Error('Unexpected fixture method');
  }});
 const grant=await service.request('backup.inspect');
 return{service,calls,args:{operationId:'restore-fixture',grantId:grant.grantId,expectedCurrentHash:grant.expectedCurrentHash}};
}

test('exact lifecycle Error.message codes survive pre-restore failure without starting restore',async t=>{
 for(const code of ['BACKUP_PROGRESS_CHANGED_REINSPECT','WORLD_BUSY','ACTIVE_TASK_EXISTS']){
  const f=await fixture(t,async()=>{throw Error(code);});
  await assert.rejects(f.service.request('backup.restore',f.args),error=>{assert.equal(error.code,code);assert.equal(error.message,code);return true;});
  assert.equal(f.calls.some(([method])=>method==='backup.restorePortableActive'||method==='afterRestore'),false);
  assert.equal((await f.service.request('backup.status')).currentHash,currentHash);
 }
});

test('unrecognized messages and private details never become backup service output',()=>{
 for(const error of [null,undefined,'WORLD_BUSY',Error('SOME_UNRECOGNIZED_CODE'),Error('WORLD_BUSY C:/private/secret'),
  Error('BACKUP_PROGRESS_CHANGED_REINSPECT\nsecret-token'),Error('C:/private/backup.craftmine contains secret'),
  Object.assign(Error('private text'),{code:'C:/private/path'})]){
  const code=backupServiceErrorCode(error);assert.equal(code,'BACKUP_OPERATION_FAILED');
  const shown=backupErrorMessage(Error(code));assert.ok(shown);assert.equal(shown.includes('secret'),false);assert.equal(shown.includes('C:/private'),false);
 }
 assert.equal(backupServiceErrorCode(Object.assign(Error('C:/private/filename'),{code:'ENOENT'})),'ENOENT');
 assert.equal(backupServiceErrorCode({errorCode:'BACKUP_FILE_CHANGED',code:'OTHER',message:'private detail'}),'BACKUP_FILE_CHANGED');
});

test('only an explicit retry after the lifecycle gate clears invokes the unchanged CAS request',async t=>{
 let blocked=true;
 const f=await fixture(t,async()=>{if(blocked)throw Error('WORLD_BUSY');});
 await assert.rejects(f.service.request('backup.restore',f.args),/WORLD_BUSY/);
 assert.equal(f.calls.some(([method])=>method==='backup.restorePortableActive'),false);
 blocked=false;
 const result=await f.service.request('backup.restore',f.args);assert.equal(result.activated,true);
 const calls=f.calls.filter(([method])=>method==='backup.restorePortableActive');assert.equal(calls.length,1);
 assert.equal(calls[0][1].expectedCurrentHash,currentHash);assert.equal(calls[0][1].operationId,f.args.operationId);
});

test('workbench hints survive standard Electron wrapping and do not search arbitrary text',()=>{
 for(const code of ['BACKUP_PROGRESS_CHANGED_REINSPECT','WORLD_BUSY','ACTIVE_TASK_EXISTS']){
  const direct=backupErrorMessage(Error(code));assert.ok(direct);
  assert.equal(backupErrorMessage(Error(`Error invoking remote method 'pi-plugin-panel-invoke': Error: ${code}`)),direct);
  assert.equal(backupErrorMessage({code,message:'private source'}),direct);
 }
 assert.match(backupErrorMessage(Error('BACKUP_PROGRESS_CHANGED_REINSPECT')),/先保存.*重新选择并检查备份/);
 assert.match(backupErrorMessage(Error('WORLD_BUSY')),/等待完成/);
 assert.equal(backupErrorMessage(Error('WORLD_BUSY C:/private/secret')),null);
 assert.equal(backupErrorMessage(Error("Error invoking remote method 'other-channel': Error: WORLD_BUSY")),null);
 assert.equal(backupErrorMessage(Error('some text BACKUP_PROGRESS_CHANGED_REINSPECT')),null);
});
