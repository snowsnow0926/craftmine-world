// Real broker + Rust stdio tests for the managed Godot build pipeline.
// The isolated executor is simulated over the same process protocol: no engine
// window, no real input, no pointer lock, no window activation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {compileScene,INITIAL_SNAPSHOT} from '../app/scene.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
const dependencies=createRequire(path.join(process.env.CRAFTMINE_DEPENDENCY_ROOT||root,'vendor/pi-desktop/packages/agent-runtime/package.json'));
const {build}=dependencies('esbuild');
const {CoreClient}=require('../plugins/craftmine-world/core-client.cjs');
const binary=process.env.CRAFTMINE_CORE_BIN;
assert.ok(binary,'Set CRAFTMINE_CORE_BIN to the newly built Rust core');
await mkdir(path.join(root,'test-results'),{recursive:true});
const output=await mkdtemp(path.join(root,'test-results/godot-build-tools-'));
await build({entryPoints:[path.join(root,'plugins/craftmine-world/world-tools.cjs')],
  outfile:path.join(output,'broker.cjs'),bundle:true,platform:'node',format:'cjs',target:'node22',
  alias:{'@babel/parser':dependencies.resolve('@babel/parser')},
  plugins:[{name:'actual-domain-source',setup(builder){
    builder.onResolve({filter:/^\.\/domain\.cjs$/},()=>({path:path.join(root,'plugins/craftmine-world/domain-adapter.mjs')}));
    builder.onResolve({filter:/behavior-syntax\.mjs$/},()=>({path:path.join(root,'plugins/craftmine-world/behavior-syntax.mjs')}));
  }}]});
const {createWorldTools}=require(path.join(output,'broker.cjs'));

const hash=value=>createHash('sha256').update(value).digest('hex');
const files=[{path:'project.godot',text:'config_version=5\n[application]\nconfig/name="Build probe"\nrun/main_scene="res://main.tscn"\n'},
  {path:'main.tscn',text:'[gd_scene load_steps=2 format=3]\n[node name="Main" type="Node3D"]\n'},
  {path:'world.gd',text:'extends Node3D\nvar damage = 12\n'}];
const assetBytes=Buffer.from('managed-asset-bytes');
let sequence=0;

async function fixture(t) {
  const directory=await mkdtemp(path.join(output,'profile-'));
  let client=new CoreClient(binary,directory);
  const hello=await client.start();
  assert.equal(hello.godotProjects,true);
  assert.equal(hello.godotBuildJobs,true);
  assert.equal(hello.godotExecutorGate,true);
  assert.equal(hello.godotExecution,false);
  t.after(()=>client.stop());
  const scene=compileScene({format:'craftmine.scene/3',title:'Build world',night:false,objects:[],systems:[],behaviors:[]});
  const world={build:{...scene,id:'base-a'},snapshot:INITIAL_SNAPSHOT,extensions:[]};
  for(const id of ['alpha','beta'])await client.call('world.create',{id,title:id,world});
  const invocation={projectId:'project',sessionId:'session',turnId:'turn',executionId:'execution'};
  let selectedWorld='alpha',ended=false,fault=null;
  const calls=[];
  const core={start:()=>client.start(),call:async(method,args)=>{
    calls.push(method);
    if(fault?.method===method&&fault.beforeCommit){fault=null;throw Error('Craftmine Rust request timed out');}
    const result=await client.call(method,args);
    if(fault?.method===method) {
      fault=null;
      throw Error('Craftmine Rust request timed out'); // Inject loss after the real commit.
    }
    return result;
  }};
  const tools=createWorldTools(core,async()=>({activeWorldId:selectedWorld}),()=>ended);
  const call=(name,args={},extra={})=>tools.find(tool=>tool.name===name).execute(args,
    {...invocation,toolCallId:'call-'+(++sequence),...extra});
  return {client,call,core,invocation,world,calls,lose:(method,beforeCommit=false)=>{fault={method,beforeCommit};},
    select:id=>{selectedWorld=id;},end:()=>{ended=true;}};
}

test('Git authoring binds immutable revisions and replays after subsequent commits',async t=>{
  const f=await fixture(t);
  await f.call('godot_project_create',{baseId:'first-person',files});
  await f.client.call('content.migrate.apply',{worldId:'alpha'});
  const before=await f.client.call('world.read',{id:'alpha'});
  const firstIndex=await f.call('godot_project_index');
  const status=await f.client.call('content.status',{worldId:'alpha'});
  assert.deepEqual(firstIndex.content,{repoId:status.repoId,branchId:'main',contentOid:status.headOid});
  const request={revision:firstIndex.revision,manifestHash:firstIndex.manifestHash,
    operations:[{op:'put',path:'one.gd',text:'extends Node\n',expectedHash:null}]};
  const first=await f.call('godot_project_patch',request,{toolCallId:'git-first'});
  const secondIndex=await f.call('godot_project_index');
  assert.equal(secondIndex.content.contentOid,first.commitOid);
  const second=await f.call('godot_project_patch',{revision:secondIndex.revision,manifestHash:secondIndex.manifestHash,
    operations:[{op:'put',path:'two.gd',text:'extends Node\n',expectedHash:null}]});
  assert.notEqual(second.commitOid,first.commitOid);
  // A fresh broker must reconstruct the original operation without a RAM cache.
  const fresh=createWorldTools(f.core,async()=>({activeWorldId:'alpha'}));
  const replay=await fresh.find(tool=>tool.name==='godot_project_patch').execute(request,
    {...f.invocation,toolCallId:'git-first'});
  assert.deepEqual(replay,first);
  await assert.rejects(f.call('godot_project_patch',{...request,operations:[{...request.operations[0],text:'extends Node\n# changed\n'}]},
    {toolCallId:'git-first'}),/REPLAY_MISMATCH/);
  await assert.rejects(f.call('godot_project_patch',request),/PROJECT_.*CONFLICT/);
  await assert.rejects(f.call('godot_project_patch',{...request,operation:{expectedHeadOid:second.commitOid}}),error=>error.code==='INVALID_ARGUMENTS');
  assert.equal((await f.client.call('content.status',{worldId:'alpha'})).headOid,second.commitOid);
  assert.deepEqual(await f.client.call('world.read',{id:'alpha'}),before);
});

test('Git authoring recovers a lost committed reply using its exact operation context',async t=>{
  const f=await fixture(t);
  const created=await f.call('godot_project_create',{baseId:'first-person',files});
  await f.client.call('content.migrate.apply',{worldId:'alpha'});
  const before=await f.client.call('content.status',{worldId:'alpha'});
  f.lose('godotProject.patch');
  const result=await f.call('godot_project_patch',{revision:created.revision,manifestHash:created.manifestHash,
    operations:[{op:'put',path:'recovered.gd',text:'extends Node\n',expectedHash:null}]});
  assert.notEqual(result.commitOid,before.headOid);
  assert.equal(result.commitOid,(await f.client.call('content.status',{worldId:'alpha'})).headOid);
  assert.ok(f.calls.includes('godotProject.receipt'));
});

// A registered, attested executor uses the same process protocol as the runner.
async function registerExecutor(f,capabilities={import:true,build:true,check:true}) {
  return f.client.call('godotExecutor.register',{executorId:'executor-a',attestation:{
    format:'craftmine.godot-executor/1',isolation:'appcontainer',evidenceHash:hash('isolation-evidence'),
    engineVersion:'4.7.2-stable',capabilities}});
}

async function runJob(f,job,token,{passed=true,assertions}={}) {
  const claimed=await f.client.call('godotJob.claim',{jobId:job.jobId,token,executorId:'executor-a'});
  const artifact='<html>build</html>';
  const artifactPath=path.join(claimed.artifactsRoot,'web');
  await mkdir(artifactPath,{recursive:true});
  await writeFile(path.join(artifactPath,'index.html'),artifact);
  await f.client.call('godotJob.progress',{jobId:job.jobId,token,stage:'compile',percent:50});
  return f.client.call('godotJob.finish',{jobId:job.jobId,token,output:{
    format:'craftmine.godot-job-result/1',inputHash:claimed.inputHash,passed,
    import:{passed:true,log:'imported'},
    compile:{passed:true,errors:[],warnings:[]},
    check:{passed,assertions:assertions||[{id:'crosshair.center',passed,detail:'screen centre'}]},
    artifacts:[{path:'web/index.html',sha256:hash(artifact),bytes:Buffer.byteLength(artifact)}],
    engine:{version:'4.7.2-stable',isolation:'appcontainer',evidenceHash:hash('isolation-evidence')}}});
}

test('managed build: blocked without an executor, queued after attestation, real candidate',async t=>{
  const f=await fixture(t);
  const created=await f.call('godot_project_create',{baseId:'first-person',files});
  const asset=await f.call('godot_asset_put',{name:'hero.png',mediaType:'image/png',
    sha256:hash(assetBytes),bytesBase64:assetBytes.toString('base64')});
  assert.equal(asset.path,'assets/hero.png');
  assert.equal(asset.bytes,assetBytes.length);
  const listed=await f.call('godot_asset_list');
  assert.equal(listed.totalAssets,1);
  assert.equal(listed.items[0].sha256,hash(assetBytes));
  const pin={revision:created.revision,manifestHash:created.manifestHash};
  const blocked=await f.call('godot_build_start',{...pin,mode:'check'});
  assert.equal(blocked.status,'blocked');
  assert.equal(blocked.executionAvailable,false);
  assert.equal(blocked.blockedReason,'GODOT_EXECUTION_UNAVAILABLE');
  assert.equal(blocked.materialized.files,7);
  await assert.rejects(f.client.call('godotJob.claim',{jobId:blocked.jobId,token:randomUUID(),
    executorId:'executor-a'}),/GODOT_EXECUTOR_UNAVAILABLE/);
  await registerExecutor(f);
  const queued=await f.call('godot_build_read',{jobId:blocked.jobId});
  assert.equal(queued.status,'queued');
  assert.equal(queued.sourceStale,false);
  const finished=await runJob(f,blocked,randomUUID());
  assert.equal(finished.status,'passed');
  assert.ok(finished.candidateId);
  const candidate=await f.call('godot_candidate_read',{candidateId:finished.candidateId});
  assert.equal(candidate.candidate.status,'ready');
  assert.equal(candidate.candidate.buildId,blocked.buildId);
  assert.equal(candidate.check.assertions[0].id,'crosshair.center');
  assert.equal((await f.call('godot_candidate_list')).items.length,1);
  // A build never publishes itself to the formal world.
  assert.deepEqual((await f.client.call('world.read',{id:'alpha'})).world,f.world);
});

test('stale sources and cross-world edits stay refused through the broker',async t=>{
  const f=await fixture(t);
  const created=await f.call('godot_project_create',{baseId:'first-person',files});
  const pin={revision:created.revision,manifestHash:created.manifestHash};
  const file=await f.call('godot_file_read',{...pin,path:'world.gd'});
  const patched=await f.call('godot_project_patch',{...pin,operations:[
    {op:'put',path:'world.gd',text:file.text.replace('12','7'),expectedHash:file.sha256}]});
  await assert.rejects(f.call('godot_build_start',{...pin,mode:'build'}),/GODOT_SOURCE_STALE/);
  await registerExecutor(f);
  const started=await f.call('godot_build_start',{revision:patched.revision,manifestHash:patched.manifestHash,mode:'build'});
  assert.equal(started.worldId,'alpha');
  assert.equal(started.sourceRevision,patched.revision);
  // Selecting another world cannot redirect the bound project.
  f.select('beta');
  const stillAlpha=await f.call('godot_build_read',{jobId:started.jobId});
  assert.equal(stillAlpha.worldId,'alpha');
  assert.equal((await f.client.call('world.read',{id:'beta'})).world.build.id,'base-a');
  for(const key of ['worldId','context','toolCallId','baseBuild'])await assert.rejects(
    f.call('godot_build_start',{...pin,mode:'build',[key]:'forged'}));
  await assert.rejects(f.call('godot_asset_put',{name:'hero.png',mediaType:'image/png',
    sha256:hash(assetBytes),bytesBase64:assetBytes.toString('base64'),worldId:'beta'}));
});

test('a cancelled job refuses a late result and never yields a candidate',async t=>{
  const f=await fixture(t);
  const created=await f.call('godot_project_create',{baseId:'first-person',files});
  const pin={revision:created.revision,manifestHash:created.manifestHash};
  await registerExecutor(f);
  const job=await f.call('godot_build_start',{...pin,mode:'check'});
  const token=randomUUID();
  const claimed=await f.client.call('godotJob.claim',{jobId:job.jobId,token,executorId:'executor-a'});
  const cancelled=await f.call('godot_build_cancel',{jobId:job.jobId});
  assert.equal(cancelled.status,'cancelled');
  await assert.rejects(f.client.call('godotJob.finish',{jobId:job.jobId,token,output:{
    format:'craftmine.godot-job-result/1',inputHash:claimed.inputHash,passed:true,
    import:{passed:true},compile:{passed:true,errors:[]},
    check:{passed:true,assertions:[{id:'a',passed:true}]},artifacts:[],
    engine:{version:'4.7.2-stable',isolation:'appcontainer',evidenceHash:hash('isolation-evidence')}}}),
    /GODOT_JOB_INACTIVE/);
  const read=await f.call('godot_build_read',{jobId:job.jobId});
  assert.equal(read.status,'cancelled');
  assert.equal(read.candidateId,null);
  assert.equal((await f.call('godot_candidate_list')).items.length,0);
});

test('lost responses recover the committed receipt without a second write',async t=>{
  const f=await fixture(t);
  await f.call('godot_project_create',{baseId:'first-person',files});
  f.lose('godotAsset.put');
  const asset=await f.call('godot_asset_put',{name:'hero.png',mediaType:'image/png',
    sha256:hash(assetBytes),bytesBase64:assetBytes.toString('base64')},{toolCallId:'asset-once'});
  assert.equal(asset.replayed,false);
  assert.equal(f.calls.filter(name=>name==='godotAsset.put').length,1);
  assert.equal(f.calls.filter(name=>name==='godotBuild.receipt').length,1);
  assert.equal((await f.call('godot_asset_list')).totalAssets,1);
  const index=await f.call('godot_project_index');
  const pin={revision:index.revision,manifestHash:index.manifestHash};
  await registerExecutor(f);
  f.lose('godotBuild.start');
  const first=await f.call('godot_build_start',{...pin,mode:'check'},{toolCallId:'build-once'});
  const second=await f.call('godot_build_start',{...pin,mode:'check'},{toolCallId:'build-once'});
  assert.deepEqual(second,first);
  assert.equal(f.calls.filter(name=>name==='godotBuild.start').length,2);
  // One receipt lookup for the lost asset write and one for the lost job start.
  assert.equal(f.calls.filter(name=>name==='godotBuild.receipt').length,2);
  await assert.rejects(f.call('godot_build_start',{...pin,mode:'build'},{toolCallId:'build-once'}),/REPLAY_MISMATCH/);
});

test('only the player application transaction can publish a candidate',async t=>{
  const f=await fixture(t);
  const created=await f.call('godot_project_create',{baseId:'first-person',files});
  const pin={revision:created.revision,manifestHash:created.manifestHash};
  await registerExecutor(f);
  const job=await f.call('godot_build_start',{...pin,mode:'check'});
  const finished=await runJob(f,job,randomUUID());
  const prepared=await f.client.call('godotApplication.prepare',{id:'apply-one',token:'token-a',
    candidateId:finished.candidateId,worldId:'alpha',revision:0,snapshot:INITIAL_SNAPSHOT});
  assert.equal(prepared.status,'prepared');
  assert.deepEqual((await f.client.call('world.read',{id:'alpha'})).world,f.world);
  const evidence=(buildId,player)=>({format:'craftmine.godot-application/1',inputHash:prepared.inputHash,
    launch:{passed:true,buildId,instanceId:'instance-1',stateHash:hash('launched')},player});
  await assert.rejects(f.client.call('godotApplication.commit',{id:'apply-one',token:'token-a',
    evidence:evidence(`gbd-${'1'.repeat(64)}`,INITIAL_SNAPSHOT.player)}),/GODOT_LAUNCH_REQUIRED/);
  const applied=await f.client.call('godotApplication.commit',{id:'apply-one',token:'token-a',
    evidence:evidence(job.buildId,INITIAL_SNAPSHOT.player)});
  assert.equal(applied.status,'applied');
  const world=(await f.client.call('world.read',{id:'alpha'})).world;
  assert.equal(world.build.id,job.buildId);
  assert.equal(world.build.scene.format,'craftmine.godot-scene/1');
  assert.deepEqual(world.snapshot,INITIAL_SNAPSHOT);
  // The applied build closes the authoring turn, so read the candidate through
  // the host panel path instead of reopening a workspace lease.
  const candidate=await f.client.call('godotCandidate.read',{worldId:'alpha',candidateId:finished.candidateId});
  assert.equal(candidate.candidate.status,'applied');
  await assert.rejects(f.call('godot_candidate_read',{candidateId:finished.candidateId}),/TASK_INACTIVE/);
  // The previous world document is retained for recovery.
  const replay=await f.client.call('godotApplication.commit',{id:'apply-one',token:'token-a',
    evidence:evidence(job.buildId,INITIAL_SNAPSHOT.player)});
  assert.equal(replay.outputHash,applied.outputHash);
  assert.equal((await f.client.call('world.read',{id:'alpha'})).revision,1);
});

test('tool catalogue declares managed build tools without host identity',async()=>{
  const manifest=JSON.parse(await readFile(path.join(root,'plugins/craftmine-world/manifest.json'),'utf8'));
  const tools=manifest.contributes.agentTools.filter(tool=>tool.name.startsWith('godot_'));
  assert.equal(tools.length,21);
  for(const tool of tools)for(const key of ['worldId','context','toolCallId','baseBuild'])
    assert.ok(!Object.hasOwn(tool.schema.properties,key),`${tool.name} must not accept ${key}`);
  assert.ok(tools.every(tool=>tool.schema.additionalProperties===false));
  const build=tools.find(tool=>tool.name==='godot_build_start');
  assert.deepEqual(build.schema.properties.mode.enum,['build','check']);
  assert.equal(build.schema.properties.manifestHash.pattern,'^[0-9a-f]{64}$');
  assert.equal(tools.find(tool=>tool.name==='godot_asset_put').schema.properties.bytesBase64.maxLength,131136);
  assert.equal(tools.find(tool=>tool.name==='godot_build_read').schema.properties.jobId.pattern,'^gjob-[0-9a-f]{64}$');
  const performance=tools.find(tool=>tool.name==='godot_performance_observe');
  assert.ok(performance&&performance.risk==='low');
});
console.log('evidence_directory='+output);
