import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const require=createRequire(path.join(root,'vendor/pi-desktop/packages/agent-runtime/package.json'));
async function module(name){const out=await require('esbuild').build({entryPoints:[path.join(root,'vendor/pi-desktop/apps/desktop/electron/main/'+name+'.ts')],bundle:true,platform:'node',format:'esm',write:false});return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));}
const {createCraftmineTelemetry,CRAFTMINE_FRAME_SAMPLE_SCRIPT}=await module('craftmine-telemetry');
const {createCraftmineDiagnosticsService}=await module('craftmine-diagnostics-service');
const {readCraftmineBuildIdentity}=await module('craftmine-build-identity');
class Contents extends EventEmitter {
  destroyed=false;result={intervals:[16,18],hidden:false};calls=[];
  isDestroyed(){return this.destroyed;}
  async executeJavaScript(script,gesture){this.calls.push({script,gesture});return this.result;}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){let clock=100;let telemetry;const diagnostics=createCraftmineDiagnosticsService({pickFile:async()=>null,snapshot:async()=>({telemetry:telemetry.status(),credentials:{status:'protected'}})});telemetry=createCraftmineTelemetry({observe:diagnostics.observe,clock:()=>clock,processStartedAt:0});return {telemetry,diagnostics,set:value=>clock=value};}
test('actual lifecycle boundaries record startup once and bounded renderer cadence without input',async t=>{
  const f=fixture(),contents=new Contents();t.after(()=>f.telemetry.dispose());f.telemetry.attachWindow(contents);f.telemetry.attachWindow(contents);
  let result=await f.diagnostics.request('diagnostics.status');assert.equal(result.metrics.startup.samples,0);assert.equal('p50Ms' in result.metrics.frame,false);
  f.set(250);contents.emit('did-finish-load');await tick();contents.emit('did-finish-load');await tick();
  result=await f.diagnostics.request('diagnostics.status');assert.equal(result.metrics.startup.samples,1);assert.equal(result.metrics.startup.p50Ms,250);assert.equal(result.metrics.frame.samples,4);
  assert.equal(contents.calls.every(call=>call.gesture===false),true);assert.equal(CRAFTMINE_FRAME_SAMPLE_SCRIPT.includes('requestPointerLock'),false);assert.equal(CRAFTMINE_FRAME_SAMPLE_SCRIPT.includes('.focus('),false);
  contents.emit('destroyed');assert.equal(contents.listenerCount('did-finish-load'),0);
});
test('hidden and invalid renderer reports stay absent rather than becoming zero-duration frames',async t=>{
  const f=fixture(),contents=new Contents();t.after(()=>f.telemetry.dispose());contents.result={intervals:[],hidden:true};f.telemetry.attachWindow(contents);contents.emit('did-finish-load');await tick();
  contents.result={intervals:Array(121).fill(1),hidden:false};contents.emit('did-finish-load');await tick();
  const result=await f.diagnostics.request('diagnostics.status');assert.equal(result.metrics.frame.samples,0);assert.equal('p95Ms' in result.metrics.frame,false);assert.equal(result.metrics.sampling.hiddenFrameWindows,1);assert.equal(result.metrics.sampling.failedFrameWindows,1);
});
test('concurrent host jobs retain identity, count failures and separate completion workflow sources',async t=>{
  const f=fixture();t.after(()=>f.telemetry.dispose());const event=(session,turn,type)=>f.telemetry.observeAgentEvent({sessionId:session,turnId:turn,event:{type,content:'private user text'}});
  event('s','one','agent_start');f.set(120);event('s','one','agent_start');event('s','two','agent_start');f.set(150);event('s','one','agent_end');f.set(180);event('s','two','error');event('s','two','agent_end');
  f.set(200);assert.equal(await f.telemetry.measureCompletion(async()=>{f.set(230);return 'value';}),'value');
  const error=Error('secret native message');await assert.rejects(f.telemetry.measureCompletion(async()=>{f.set(250);throw error;}),value=>value===error);
  const result=await f.diagnostics.request('diagnostics.status');assert.equal(result.metrics.modelJob.samples,4);assert.equal(result.metrics.modelJob.bySource.agent_turn.samples,2);assert.equal(result.metrics.modelJob.bySource.one_shot_completion.samples,2);assert.equal(result.metrics.modelJob.outcomes.failed,2);assert.equal(JSON.stringify(result).includes('private user text'),false);assert.equal(JSON.stringify(result).includes('secret native message'),false);
});
test('aborted jobs and bounded storage do not create unknown zero samples',async t=>{
  const f=fixture();t.after(()=>f.telemetry.dispose());f.telemetry.finishAgentJob('missing','missing','aborted');assert.equal((await f.diagnostics.request('diagnostics.status')).metrics.modelJob.samples,0);
  f.telemetry.observeAgentEvent({sessionId:'s',turnId:'t',event:{type:'agent_start'}});f.set(200);f.telemetry.finishAgentJob('s','t','aborted');
  assert.equal((await f.diagnostics.request('diagnostics.status')).metrics.modelJob.outcomes.aborted,1);
  for(let i=0;i<250;i++)f.diagnostics.observe('frame',16,{source:'desktop_animation_interval'});
  assert.equal((await f.diagnostics.request('diagnostics.status')).metrics.frame.samples,200);assert.throws(()=>f.diagnostics.observe('frame',16,{source:'private-path'}),/INVALID_METRIC_SOURCE/);
});
test('packaged provenance uses only the bounded trusted manifest and leaves development fields absent',async()=>{
  const dir=await fs.mkdtemp(path.join(root,'desktop/build/batch07/build-identity-'));assert.deepEqual(readCraftmineBuildIdentity(dir),{});await fs.mkdir(path.join(dir,'source'));
  const file=path.join(dir,'source/build-manifest.json');await fs.writeFile(file,JSON.stringify({format:'craftmine.build/1',appId:'world.craftmine.desktop',commit:'a'.repeat(40),sourceArchiveHash:'b'.repeat(64),privatePath:'C:/private',secret:'synthetic-secret'}));
  const identity=readCraftmineBuildIdentity(dir);assert.equal(identity.commit,'a'.repeat(40));assert.equal(identity.manifestHash.length,64);assert.equal(JSON.stringify(identity).includes('synthetic-secret'),false);
  await fs.writeFile(file,'x'.repeat(128*1024+1));assert.deepEqual(readCraftmineBuildIdentity(dir),{});
});

test('isolated installer execute refuses a local host before filesystem authority', {skip:process.platform!=='win32'},()=>{
  const env={...process.env};delete env.GITHUB_ACTIONS;delete env.RUNNER_ENVIRONMENT;delete env.RUNNER_TEMP;
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-File',path.join(root,'desktop/ci/windows-isolated-validation.ps1'),'-Execute'],{env,encoding:'utf8',windowsHide:true,timeout:10000});
  assert.notEqual(result.status,0);assert.match(result.stderr,/ISOLATED_RUNNER_REQUIRED/);assert.doesNotMatch(result.stderr,/EXPLICIT_PACKAGE_AND_HASH_REQUIRED/);
});
