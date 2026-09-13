// Uses an operator-authorized, idle profile and a real prior application receipt.
// No import, export, model call, candidate registration or authored source edit.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readState,acquireLock} from '../scripts/lib/codex-world-session.mjs';
import {CodexWorldHost} from '../scripts/lib/codex-world-host.mjs';
import {startCodexLiveService} from '../scripts/lib/codex-live-service.mjs';

const [data,applicationFile]=process.argv.slice(2);
assert(data&&applicationFile&&path.isAbsolute(data)&&path.isAbsolute(applicationFile),'Pass absolute idle profile and prior operator application report');
const expected=JSON.parse(await fs.readFile(applicationFile,'utf8'));
assert.equal(expected.format,'craftmine.codex-live-operation/1');assert.equal(expected.action,'apply');
assert.equal(expected.result.status,'applied');assert.equal(expected.retirement.saveStatus,'persisted');
const state=readState(data);assert.equal(expected.worldId,state.worldId);
assert.deepEqual(expected.sourceIdentity,state.sourceIdentity);
const unlock=acquireLock(data),host=new CodexWorldHost({state,data});let live,retirement,report;
try {
  live=await startCodexLiveService({core:host.core,state,data});await host.start({engines:false});
  assert.deepEqual(await host.sourceIdentity(),state.sourceIdentity);
  const before=await host.core.call('world.read',{id:state.worldId});
  assert.deepEqual(before.world.build,expected.result.record.world.build);
  const descriptor=await host.core.call('godotRuntime.describe',{worldId:state.worldId});
  const verifyArtifacts=async()=>{
    for(const artifact of descriptor.artifacts){
      const bytes=await fs.readFile(path.join(descriptor.root,artifact.path));
      assert.equal(bytes.length,artifact.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),artifact.sha256);
    }
  };
  await verifyArtifacts();
  const opened=await live.call('open');await live.call('pause');
  assert.equal(opened.instance.buildId,before.world.build.id);
  assert.notEqual(opened.instance.instanceId,expected.result.capture.instanceId);
  const snapshot=await live.call('snapshot');assert.deepEqual(snapshot.state,before.world.snapshot);
  const capture=await live.capture();assert.equal(capture.scope,'formal');
  const diagnostics=await live.call('diagnostics');
  assert.equal(diagnostics.hidden,true);assert.equal(diagnostics.focusable,false);assert.equal(diagnostics.offscreen,true);
  assert.equal(diagnostics.graphics.hardwareAcceleration,true);assert.equal(diagnostics.graphics.angle,'platform-default');
  for(const view of diagnostics.views){assert.equal(view.runtime.node,'undefined');assert.deepEqual(view.runtime.guard,{pointerLock:0,focus:0});}
  await verifyArtifacts();
  retirement=await live.call('close');assert.equal(retirement.saved.status,'persisted');
  assert.deepEqual(retirement.saved.snapshot,before.world.snapshot);
  const after=await host.core.call('world.read',{id:state.worldId});assert.deepEqual(after.world,before.world);
  report={format:'craftmine.retained-reopen-test/1',passed:true,worldId:state.worldId,sourceIdentity:state.sourceIdentity,
    source:after.world.build.godot,buildId:after.world.build.id,revision:after.revision,
    priorApplication:applicationFile,artifactsVerified:descriptor.artifacts.length,sourceEdits:0,modelCalls:0,
    beforeInstance:expected.result.capture.instanceId,reopenedInstance:opened.instance.instanceId,
    snapshot:snapshot.state,capture,graphics:diagnostics.graphics,retirement};
  await host.stop({beforeCoreStop:()=>live.stop()});
  const guards=JSON.parse(await fs.readFile(path.join(live.directory,'guards.json'),'utf8'));
  assert.deepEqual(guards.violations,[]);assert.deepEqual(guards.pageErrors,[]);
  const reportFile=path.join(live.directory,'retained-reopen-report.json');
  await fs.writeFile(reportFile,JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:true,report:reportFile,buildId:report.buildId,capture:report.capture.imagePath}));
} finally {
  try {await host.stop({beforeCoreStop:()=>live?.stop()});}
  catch(error){await live?.abandon();await host.core.stop();throw error;}
  finally {unlock();}
}
