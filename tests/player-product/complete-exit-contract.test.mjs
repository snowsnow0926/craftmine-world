import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createCompleteOutput,completeEnvironment,requireRestoreConflict} from '../godot-final/complete-contract.mjs';
import {assertCleanHeadlessShutdown} from './shutdown-exit-audit.mjs';
const source=fs.readFileSync(new URL('../godot-final/client-complete.mjs',import.meta.url),'utf8');
const stopSource=source.slice(source.indexOf('async function stop(){'),source.indexOf('\nasync function settled'));
const clean=()=>({exit:{code:0},exitAudit:{violations:[],pageErrors:[],shutdownFailures:[]}});
test('actual complete stop audits already-exited launches and all required terminal facts',async()=>{
 for(const mutate of [null,l=>l.exitAudit.shutdownFailures.push({code:'CLOSE_TIMEOUT'}),l=>delete l.exitAudit.shutdownFailures,l=>l.exit.code=1,l=>l.forcedStop=true,l=>l.exitAudit.violations.push('input'),l=>l.exitAudit.pageErrors.push('page')]){
  const launch=clean();mutate?.(launch);const context={launch,ended:true,assertCleanHeadlessShutdown};
  const promise=vm.runInNewContext(stopSource+'\nstop()',context);
  if(mutate)await assert.rejects(promise);else await promise;
 }
});
test('actual complete stop audits a newly completed orderly quit',async()=>{
 const context={launch:clean(),ended:false,exit:Promise.resolve(),delay:()=>Promise.resolve(),assertCleanHeadlessShutdown,child:{kill:()=>assert.fail('unexpected kill')}};
 context.rpc=async()=>{context.ended=true;};await vm.runInNewContext(stopSource+'\nstop()',context);
});
test('actual finalizer persists exit failure even after a previous test failure',async()=>{
 const tail=source.slice(source.lastIndexOf('\nfinally{'));
 for(const existing of [undefined,'earlier failure']){
  const report={steps:[{passed:true}],...(existing?{fatal:existing}:{})};let writes=0;
  const context={report,stop:async()=>{throw Error('shutdown rejected');},process:{exitCode:0},save:()=>writes++,console:{error(){},log(){}},out:'fixture'};
  await vm.runInNewContext('(async()=>{try{}'+tail+'})()',context);
  assert.equal(writes,1);assert.equal(context.process.exitCode,1);assert.equal(report.passed,false);assert.ok(report.finishedAt);assert.match(report.shutdownError,/shutdown rejected/);
  if(existing)assert.equal(report.fatal,existing);
 }
});
test('output root is absolute, fresh and rejects directory links',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cm-complete-contract-'));
 assert.throws(()=>createCompleteOutput(root,'relative'),/ABSOLUTE/);
 const a=createCompleteOutput(root,path.join(root,'results'));const b=createCompleteOutput(root,path.join(root,'results'));assert.notEqual(a,b);
 const link=path.join(root,'linked');fs.symlinkSync(path.join(root,'results'),link,'junction');
 assert.throws(()=>createCompleteOutput(root,path.join(link,'nested')),/LINK_OR_FILE/);
 // Keep the tiny test-owned directory as evidence; never recursively remove a linked path.
});
test('child environment drops runtime, renderer, Node and acceptance overrides',()=>{
 const result=completeEnvironment({PATH:'unchanged',CRAFTMINE_GODOT_ENGINE_ROOT:'bad',CRAFTMINE_GODOT_BASES:'bad',CRAFTMINE_TEST_BACKUP:'1',PI_DESKTOP_HOST_BIN:'bad',ELECTRON_RENDERER_URL:'bad',NODE_OPTIONS:'bad',node_options:'bad'},{out:'out',profile:'profile',token:'token',core:'sealed-core',host:'sealed-host',bases:'sealed-bases'});
 assert.equal(result.PATH,'unchanged');assert.equal(result.CRAFTMINE_GODOT_BASES,'sealed-bases');assert.equal(result.CRAFTMINE_CORE_BIN,'sealed-core');
 for(const key of ['CRAFTMINE_GODOT_ENGINE_ROOT','CRAFTMINE_TEST_BACKUP','ELECTRON_RENDERER_URL','NODE_OPTIONS','node_options'])assert.equal(result[key],undefined);
});
function fixture(error='BACKUP_CURRENT_HASH_CONFLICT'){
 const grant={status:'ready',bodiesVerified:true,grantId:'grant',archiveHash:'a'.repeat(64),expectedCurrentHash:'b'.repeat(64)};
 return {grant,operationId:'wrong-cas-operation',expectedSelection:'world',expectedProgress:{all:['fields',1]},restore:async args=>{assert.notEqual(args.expectedCurrentHash,grant.expectedCurrentHash);throw Error(error);},inspect:async()=>({...grant,grantId:'fresh',expectedCurrentHash:'c'.repeat(64)}),readSelection:async()=>'world',readProgress:async()=>({all:['fields',1]}),compare:(a,b)=>({equal:JSON.stringify(a)===JSON.stringify(b),differences:['changed']})};
}
test('CAS fault requires exact production error and reinspection for a new grant',async()=>{
 const result=await requireRestoreConflict(fixture());assert.equal(result.grant.grantId,'fresh');assert.equal(result.fault.code,'BACKUP_CURRENT_HASH_CONFLICT');
 for(const code of ['Error: BACKUP_CURRENT_HASH_CONFLICT',"Error invoking remote method 'pi-plugin-panel-invoke': Error: BACKUP_CURRENT_HASH_CONFLICT","Error: Error invoking remote method 'pi-plugin-panel-invoke': Error: BACKUP_CURRENT_HASH_CONFLICT"]){
  const wrapped=await requireRestoreConflict(fixture(code));assert.equal(wrapped.grant.grantId,'fresh');
 }
 for(const code of ['Timed out: worldPanel','BACKUP_OPERATION_FAILED','BACKUP_LIFECYCLE_RECOVERY_FAILED','Timed out: BACKUP_CURRENT_HASH_CONFLICT','BACKUP_CURRENT_HASH_CONFLICT_EXTRA',"Error invoking remote method 'other-channel': Error: BACKUP_CURRENT_HASH_CONFLICT",'BACKUP_CURRENT_HASH_CONFLICT\ntransport failure'])await assert.rejects(requireRestoreConflict(fixture(code)));
});
test('CAS fault cannot pass on changed selection or any changed persistent field',async()=>{
 await assert.rejects(requireRestoreConflict({...fixture(),readSelection:async()=>'other'}));
 await assert.rejects(requireRestoreConflict({...fixture(),readProgress:async()=>({all:['fields',2]})}));
 await assert.rejects(requireRestoreConflict({...fixture(),inspect:async()=>({...fixture().grant,archiveHash:'d'.repeat(64)})}));
});
