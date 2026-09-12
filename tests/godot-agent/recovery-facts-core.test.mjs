// A real isolated durable store with synthetic executor output. No Godot or model.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {compileScene,INITIAL_SNAPSHOT} from '../../app/scene.mjs';
const require=createRequire(import.meta.url);
const {CoreClient}=require('../../plugins/craftmine-world/core-client.cjs');
const {projectFacts}=require('../../plugins/craftmine-world/godot-observe.cjs');
const {usageSummary}=require('../../plugins/craftmine-world/godot-jobs.cjs');
const binary=process.env.CRAFTMINE_CORE_BIN;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
test('fresh fact readers recover the same failed durable job and source divergence after core restart',{skip:binary?false:'CRAFTMINE_CORE_BIN required'},async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'craftmine-recovery-facts-'));
 const binarySha256=hash(await readFile(binary));
 let core=new CoreClient(binary,directory);t.after(()=>core.stop());await core.start();
 const context={projectId:'recovery-project',sessionId:'recovery-session',turnId:'recovery-turn'};
 const scene=compileScene({format:'craftmine.scene/3',title:'Recovery facts fixture',night:false,objects:[],systems:[],behaviors:[]});
 const world={build:{...scene,id:'base-fixture'},snapshot:INITIAL_SNAPSHOT,extensions:[]};
 await core.call('world.create',{id:'w',title:'w',world});
 const workspace=await core.call('workspace.open',{context,selectedWorld:'w'});
 const source=await core.call('godotProject.create',{context,worldId:'w',toolCallId:'source-fixture',baseBuild:workspace.task.binding.baseBuild,baseId:'first-person',files:[
  {path:'project.godot',text:'config_version=5\n[application]\nconfig/name="Recovery facts"\nrun/main_scene="res://main.tscn"\n'},
  {path:'main.tscn',text:'[gd_scene format=3]\n[node name="Main" type="Node3D"]\n'},
  {path:'actor.gd',text:'extends Node\nfunc broken(:\n pass\n'}]});
 const proof=hash('synthetic executor fixture');
 await core.call('godotExecutor.register',{executorId:'fixture-executor',attestation:{format:'craftmine.godot-executor/1',isolation:'appcontainer',evidenceHash:proof,engineVersion:'4.7.2-stable',capabilities:{import:true,build:true,check:true}}});
 const job=await core.call('godotBuild.start',{context,worldId:'w',toolCallId:'failed-job',revision:source.revision,manifestHash:source.manifestHash,mode:'check'});
 const claimed=await core.call('godotJob.claim',{jobId:job.jobId,token:'fixture-token',executorId:'fixture-executor'});
 const finished=await core.call('godotJob.finish',{jobId:job.jobId,token:'fixture-token',output:{format:'craftmine.godot-job-result/1',inputHash:claimed.inputHash,passed:false,
  import:{passed:false,log:'SCRIPT ERROR: Parse Error: Expected parameter name.\n   at: GDScript::reload (res://actor.gd:2)'},
  compile:{passed:false,errors:['SCRIPT ERROR: Parse Error: Expected parameter name.'],warnings:[]},
  check:{passed:false,assertions:[{id:'runtime.not-run',passed:false,detail:'GODOT_COMPILE_FAILED'}]},artifacts:[],
  engine:{version:'4.7.2-stable',isolation:'appcontainer',evidenceHash:proof}}});
 assert.equal(finished.status,'failed');
 const first=await projectFacts({core,context,worldId:'w'});
 assert.equal(first.recovery.latestJob.available,true,JSON.stringify(first.recovery));
 assert.equal(first.recovery.latestJob.scope,'current-task');assert.equal(first.recovery.latestJob.sourceComparison.relation,'same-source');
 assert.equal(first.candidates.items[0].candidateId,finished.candidateId);assert.equal(first.recovery.latestJob.candidate.status,'rejected');
 assert.equal(await core.call('godotBuild.latest',{worldId:'w',sessionId:'different-session'}),null,'latest query must not silently become world-latest');
 const script=await core.call('godotProject.read',{context,worldId:'w',revision:source.revision,manifestHash:source.manifestHash,path:'actor.gd',offset:0,limit:16000});
 await core.call('godotProject.patch',{context,worldId:'w',toolCallId:'advance-source',revision:source.revision,manifestHash:source.manifestHash,
  operations:[{op:'put',path:'actor.gd',expectedHash:script.sha256,text:'extends Node\nfunc repaired():\n pass\n'}]});
 const beforeRestart=await projectFacts({core,context,worldId:'w'});
 assert.equal(beforeRestart.recovery.latestJob.sourceComparison.relation,'different-source');assert.equal(beforeRestart.recovery.latestJob.sourceStale,true);
 const budget=structuredClone(beforeRestart.recovery.budget.value),fingerprint=beforeRestart.recovery.latestJob.diagnostics.diagnostics[0].fingerprint;
 assert.ok(budget.ownerTaskId);assert.ok(Object.hasOwn(budget.limits,'maxTokens'));
 await core.stop();core=new CoreClient(binary,directory);await core.start();
 const recovered=await projectFacts({core,context,worldId:'w'});
 assert.equal(recovered.recovery.latestJob.jobId,job.jobId);assert.equal(recovered.recovery.latestJob.status,'failed');
 assert.equal(recovered.recovery.latestJob.outputHash,finished.outputHash);assert.equal(recovered.recovery.latestJob.sourceComparison.relation,'different-source');
 assert.equal(recovered.recovery.latestJob.diagnostics.diagnostics[0].fingerprint,fingerprint);assert.deepEqual(recovered.recovery.budget.value,budget);
 assert.equal(recovered.recovery.latestJob.candidate.candidateId,finished.candidateId);assert.equal(recovered.recovery.latestJob.candidate.status,'rejected');
 const original=await core.call('godotBuild.read',{context,worldId:'w',jobId:job.jobId});assert.equal(original.outputHash,finished.outputHash);assert.equal(original.status,'failed');
 const usage=await usageSummary(core,{context,worldId:'w'});assert.equal(usage.items[0].jobId,job.jobId);assert.ok(Array.isArray(usage.unknown));
 console.log(JSON.stringify({evidenceType:'real-core-synthetic-executor',binary,binarySha256,directory,jobId:job.jobId,candidateId:finished.candidateId,fingerprint,budgetOwner:budget.ownerTaskId}));
});
