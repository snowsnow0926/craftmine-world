// Real native check, first-load, application, observation and persistence.
// No model calls, authored executor registration, OS input or application stubs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {main} from '../scripts/codex-world-author.mjs';
import {readState} from '../scripts/lib/codex-world-session.mjs';
import {CodexWorldHost} from '../scripts/lib/codex-world-host.mjs';
import {startCodexLiveService} from '../scripts/lib/codex-live-service.mjs';
import {checkCurrentSource} from '../scripts/codex-live-world.mjs';

const [runtime,plugin,dataArg]=process.argv.slice(2);
for(const value of [runtime,plugin,dataArg])assert(value&&path.isAbsolute(value),'Pass absolute runtime, built plugin and NEW data directory');
const data=path.resolve(dataArg),worldId='live-'+randomUUID();
await main(['init','--data',data,'--runtime',runtime,'--plugin',plugin,'--world',worldId]);
const state=readState(data),report={worldId,data,modelCalls:0,passed:false,stages:[]};
let host,live,context,saveFault=false;
const start=async(engines=true)=>{
  host=new CodexWorldHost({state,data});
  const original=host.core.call.bind(host.core);
  host.core.call=(method,args,...rest)=>{
    if(saveFault&&method==='godotRuntime.saveProgress')return Promise.reject(Object.assign(Error('INJECTED_SAVE_FAILURE'),{errorCode:'INJECTED_SAVE_FAILURE'}));
    return original(method,args,...rest);
  };
  live=await startCodexLiveService({core:host.core,state,data});
  host=new CodexWorldHost({state,data,core:host.core,services:live});await host.start({engines});
};
const stop=async()=>{
  await host.stop({beforeCoreStop:()=>live.stop()});
  const guards=JSON.parse(await fs.readFile(path.join(live.directory,'guards.json'),'utf8'));
  assert.deepEqual(guards.violations,[]);assert.deepEqual(guards.pageErrors,[]);
};
const begin=async text=>{context={projectId:state.projectId,sessionId:state.sessionId,turnId:randomUUID()};await host.begin(context,text);};
const tool=(name,args={})=>host.tools.find(t=>t.name===name).execute(args,{...context,toolCallId:randomUUID(),executionId:'native-live-test'});
try {
  await start();
  assert.equal((await live.call('open')).status,'source-only');
  await assert.rejects(live.call('capture'),/CAPTURE_UNAVAILABLE/);
  const first=await checkCurrentSource(host,state);assert.equal(first.status,'passed');
  const applied=await live.call('apply',{candidateId:first.candidateId});assert.equal(applied.status,'applied');
  const initial=await host.core.call('godotWorld.initStatus',{worldId});assert.equal(initial.playable,true);assert.equal(initial.status,'confirmed');
  const formal=await host.core.call('godotRuntime.describe',{worldId});assert.equal(formal.buildId,first.buildId);
  const capture=await live.capture();assert.equal(capture.scope,'formal');assert.equal(capture.buildId,formal.buildId);
  assert.equal(createHash('sha256').update(await fs.readFile(capture.imagePath)).digest('hex'),capture.sha256);
  report.stages.push({stage:'first-load',candidateId:first.candidateId,buildId:formal.buildId,applicationId:initial.applicationId,capture});
  await begin('Validate existing live observation and image tools.');
  const observation=await tool('godot_runtime_state',{scope:'live'});
  assert.equal(observation.live.available,true);assert.equal(observation.live.instanceId,capture.instanceId);
  const image=await tool('godot_view_capture',{buildId:capture.buildId,instanceId:capture.instanceId});assert.equal(image.images.length,1);
  const performance=await tool('godot_performance_observe');assert(!JSON.stringify(performance).includes('NOT_WIRED'));
  await assert.rejects(live.toolServices.captureView({context:{...context,sessionId:'foreign'},worldId,buildId:capture.buildId,instanceId:capture.instanceId}),/BINDING_MISMATCH/);
  await host.end(context,'completed');
  await assert.rejects(live.toolServices.captureView({context,worldId,buildId:capture.buildId,instanceId:capture.instanceId}),/ACTIVE_TURN_REQUIRED/);
  await assert.rejects(live.call('observe',{worldId:'foreign'}),/WORLD_MISMATCH/);
  await assert.rejects(live.call('capture',{buildId:'foreign'}),/BUILD_MISMATCH/);
  const before=await live.call('snapshot');
  await live.call('walk',{forward:1,right:0,frames:15});await live.call('pause');
  const moved=await live.call('snapshot');assert.notDeepEqual(moved.state.body.player.position,before.state.body.player.position);
  const saved=await live.call('save');assert.equal(saved.status,'persisted');
  assert.deepEqual((await host.core.call('world.read',{id:worldId})).world.snapshot,saved.snapshot);
  const diagnostics=await live.call('diagnostics');assert.equal(diagnostics.hidden,true);assert.equal(diagnostics.focusable,false);assert.equal(diagnostics.offscreen,true);
  assert.equal(diagnostics.graphics.hardwareAcceleration,true);assert.equal(diagnostics.graphics.angle,'platform-default');
  assert(diagnostics.views.length);for(const view of diagnostics.views){assert.equal(view.runtime.node,'undefined');assert.deepEqual(view.runtime.guard,{pointerLock:0,focus:0});}
  const oldInstance=capture.instanceId;await stop();
  report.stages.push({stage:'saved-after-physics-walk',receipt:saved.receipt,snapshot:saved.snapshot,diagnostics});

  await start();const reopened=await live.call('open');assert.notEqual(reopened.instance.instanceId,oldInstance);assert.equal(reopened.instance.buildId,formal.buildId);
  await live.call('pause');assert.deepEqual((await live.call('snapshot')).state,saved.snapshot);
  assert.deepEqual(await host.sourceIdentity(),state.sourceIdentity);
  await live.call('resume');
  // A real source revision produces a new checked candidate. Nothing fabricates
  // native job success or registers an authored executor/launch receipt.
  await begin('Native test adds a source comment for a later checked candidate.');
  const index=await tool('godot_project_index');
  const source=await tool('godot_file_read',{revision:index.revision,manifestHash:index.manifestHash,path:'project.godot'});
  const text=source.text??source.content;assert.equal(typeof text,'string');
  await tool('godot_project_patch',{revision:index.revision,manifestHash:index.manifestHash,
    operations:[{op:'put',path:'project.godot',text:text+'\n; native live lifecycle second revision\n',expectedHash:index.files.find(f=>f.path==='project.godot').sha256}]});
  await host.end(context,'completed');
  const second=await checkCurrentSource(host,state);assert.equal(second.status,'passed');assert.notEqual(second.buildId,formal.buildId);
  const preview=await live.call('preview',{candidateId:second.candidateId});assert.equal(preview.status,'preview');
  const previewCapture=await live.capture({candidateId:second.candidateId});assert.equal(previewCapture.scope,'candidate');
  assert.equal((await host.core.call('world.read',{id:worldId})).world.build.id,formal.buildId);
  await assert.rejects(live.call('capture'),/CAPTURE_BUSY/);
  await live.call('previewClose');assert.equal((await host.core.call('world.read',{id:worldId})).world.build.id,formal.buildId);
  const secondApplied=await live.call('apply',{candidateId:second.candidateId});assert.equal(secondApplied.status,'applied');
  await live.call('pause');const finalSave=await live.call('save');assert.equal(finalSave.status,'persisted');
  assert.deepEqual(finalSave.snapshot.body.player.position,saved.snapshot.body.player.position);
  // A save failure is not a successful close. The instance remains retryable.
  saveFault=true;assert.equal((await live.call('save')).status,'failed');
  await assert.rejects(live.call('close'),/INJECTED_SAVE_FAILURE/);
  assert.equal((await live.call('status')).instance.buildId,second.buildId);
  saveFault=false;assert.equal((await live.call('save')).status,'persisted');
  const finalCapture=await live.capture();await stop();
  await start(false);const cold=await live.call('open');await live.call('pause');
  assert.equal(cold.instance.buildId,second.buildId);assert.deepEqual((await live.call('snapshot')).state,finalSave.snapshot);
  report.stages.push({stage:'second-candidate-preview-apply-cold-reopen',candidateId:second.candidateId,buildId:second.buildId,previewCapture,finalCapture,snapshot:finalSave.snapshot});
  await stop();report.passed=true;
} finally {
  await fs.writeFile(path.join(data,'live-native-report.json'),JSON.stringify(report,null,2));
  await live?.abandon();await host?.core.stop();
}
console.log(JSON.stringify({passed:report.passed,report:path.join(data,'live-native-report.json'),stages:report.stages.map(s=>s.stage),modelCalls:0}));
