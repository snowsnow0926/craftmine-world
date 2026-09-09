import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createPackageTurnLifecycle,createPackageInstallBinding} from '../../plugins/craftmine-world/package-turn-lifecycle.cjs';
import {createManagedPackageInstaller} from '../../plugins/craftmine-world/reuse-service.mjs';
const context={projectId:'craftmine-package-install',sessionId:'package-world',turnId:'install-test'};
// Like the existing host-domain tests, use the built real domain adapter.
const buildRoot=process.env.CRAFTMINE_PLUGIN_TEST_BUILD??fileURLToPath(new URL('../../desktop/build/craftmine.world/',import.meta.url));
const {createHostRequests}=createRequire(import.meta.url)(path.join(buildRoot,'host-requests.cjs'));

test('production package binding uses the real host turn router, exact branch and closes dirty ZIP lease',async()=>{
  const calls=[];let lease=false;
  const call=async(method,args)=>{calls.push([method,args]);
    if(method==='world.read')return {id:'world',runtimeKind:'godot',revision:3,world:{}};
    if(method==='workspace.open'){lease=true;return {worldId:'world'};}
    if(method==='task.recordContext')return {};
    if(method==='task.context')return {world:{id:'world'}};
    if(method==='content.status')return {backend:'git',repoId:'repo',headOid:'wrong-main',appliedOid:'applied',branches:[{name:'refs/heads/branch-two',oid:'actual-head'}]};
    if(method==='godotProject.index')return {branchId:'branch-two'};
    if(method==='workspace.endTurn'){lease=false;return {};}
    throw Error('UNKNOWN_METHOD:'+method);
  };
  const router=createHostRequests({start:async()=>{},call},{}),turns=createPackageTurnLifecycle({call});
  const bind=createPackageInstallBinding({call,begin:args=>router('turn.begin',args),selected:async()=>'world',finish:turns.finish});
  const binding=await bind('world','initial-bind');assert.equal(binding.operation.branchId,'branch-two');assert.equal(binding.operation.expectedHeadOid,'actual-head');await turns.finish(binding.context,'completed');
  const installer=createManagedPackageInstaller({call,bind,turns,enqueue:async()=>{throw Error('must not enqueue');},stagingRoot:await fs.mkdtemp(path.join(os.tmpdir(),'dirty-package-turn-'))});
  await assert.rejects(installer({worldId:'world',operationId:'install-test',archiveBase64:Buffer.from('not a ZIP').toString('base64')}));
  assert.equal(lease,false);assert.equal(calls.at(-1)[0],'workspace.endTurn');assert.equal(calls.at(-1)[1].status,'error');
  assert.equal(calls.some(([method])=>method==='turn.begin'),false);assert.ok(calls.some(([method])=>method==='task.recordContext'));
});

test('queued check keeps its turn until the core reports passed',async()=>{
  let status='queued';const ends=[];
  const turns=createPackageTurnLifecycle({pollMs:1,call:async(method,args)=>{
    if(method==='godotBuild.read')return {status};if(method==='workspace.endTurn'){ends.push(args);return {};}throw Error(method);
  }});
  turns.watch({worldId:'world',jobId:'job'},context);await new Promise(resolve=>setImmediate(resolve));assert.equal(ends.length,0);
  status='passed';await turns.drain();assert.deepEqual(ends,[{sessionId:context.sessionId,turnId:context.turnId,status:'completed'}]);await turns.stop();
});

test('shutdown cancels nonterminal owned job and ends its turn only after confirmed cancellation',async()=>{
  let status='running';const calls=[];
  const turns=createPackageTurnLifecycle({pollMs:1,call:async(method,args)=>{
    calls.push([method,args]);if(method==='godotBuild.read')return {status};if(method==='godotBuild.cancel'){status='cancelled';return {status};}if(method==='workspace.endTurn')return {};throw Error(method);
  }});
  turns.watch({worldId:'world',jobId:'job'},context);await turns.stop();
  assert.equal(calls.at(-1)[0],'workspace.endTurn');assert.equal(calls.at(-1)[1].status,'error');assert.ok(calls.findIndex(([m])=>m==='godotBuild.cancel')<calls.findIndex(([m])=>m==='workspace.endTurn'));
});

test('binding failure after workspace creation always closes its owned task',async()=>{
  const ends=[];const bind=createPackageInstallBinding({call:async()=>({runtimeKind:'godot'}),selected:async()=>'world',begin:async()=>{throw Error('recordContext failed');},finish:async(c,s)=>ends.push([c,s])});
  await assert.rejects(bind('world','install-test'),/recordContext failed/);assert.equal(ends.length,1);assert.equal(ends[0][1],'error');
});
