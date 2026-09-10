// Real Rust/SQLite/Git and private service, with an explicit fixed executor
// fixture. No engine launch, model, renderer or input simulation.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {CoreClient} from '../../plugins/craftmine-world/core-client.cjs';
import {createPackageTurnLifecycle} from '../../plugins/craftmine-world/package-turn-lifecycle.cjs';
import {createTargetFeedbackService} from '../../plugins/craftmine-world/target-feedback-service.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const binary=process.env.CRAFTMINE_CORE_BIN;if(!binary)throw Error('CRAFTMINE_CORE_BIN required');
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'target-feedback-core-'));
const core=new CoreClient(binary,path.join(directory,'data')),calls=[];
const call=async(method,args)=>{try{const result=await core.call(method,args,60000);calls.push({method,args,result});return result;}catch(error){calls.push({method,args,error:String(error)});throw error;}};
const context={projectId:'seed',sessionId:'seed',turnId:'one'};
let turns;
try{
 await core.start();
 const snapshot={format:'craftmine.godot-progress/1',worldId:'alpha',baseId:'first-person',baseVersion:'0.1.0',stateVersion:1,body:{worldId:'alpha',player:{position:[1,2,3]},inventory:{coins:17},targets:[{id:'target-one',health:40,hitCount:2}]}};
 await call('world.create',{id:'alpha',title:'Parameters',world:{build:{id:'base-a',scene:{format:'craftmine.godot-scene/1',baseId:'first-person'},godot:{}},snapshot,extensions:[]}});
 await call('workspace.open',{context,selectedWorld:'alpha'});
 const script=await fs.readFile(path.resolve(import.meta.dirname,'../../desktop/godot/bases/first-person/scripts/core/target_dummy.gd'),'utf8');
 const scene='[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://scripts/core/target_dummy.gd" id="script"]\n[node name="World" type="Node3D"]\n[node name="Target" type="StaticBody3D" parent="."]\nscript = ExtResource("script")\ntarget_id = &"target-one"\n';
 const project=await call('godotProject.create',{context,worldId:'alpha',toolCallId:'create',baseBuild:'base-a',baseId:'first-person',files:[{path:'project.godot',text:'config_version=5\n[application]\nrun/main_scene="res://world.tscn"\n'},{path:'world.tscn',text:scene},{path:'scripts/core/target_dummy.gd',text:script}]});
 await call('content.migrate.apply',{worldId:'alpha'});
 const evidenceHash=sha('fixed-test-executor');
 await call('godotExecutor.register',{executorId:'fixture',attestation:{format:'craftmine.godot-executor/1',isolation:'fixed-author-fixture',evidenceHash,engineVersion:'4.7.2-stable',capabilities:{import:true,build:true,check:true}}});
 const job=await call('godotBuild.start',{context,worldId:'alpha',toolCallId:'check-seed',revision:project.revision,manifestHash:project.manifestHash,mode:'check'});
 const claim=await call('godotJob.claim',{jobId:job.jobId,token:'fixture-token',executorId:'fixture'});
 const artifact=Buffer.from('<html>fixed fixture, not executed</html>');await fs.mkdir(path.join(claim.artifactsRoot,'web'),{recursive:true});await fs.writeFile(path.join(claim.artifactsRoot,'web/index.html'),artifact);
 const checked=await call('godotJob.finish',{jobId:job.jobId,token:'fixture-token',output:{format:'craftmine.godot-job-result/1',inputHash:claim.inputHash,passed:true,import:{passed:true},compile:{passed:true,errors:[],warnings:[]},check:{passed:true,assertions:[{id:'fixture-only',passed:true}]},artifacts:[{path:'web/index.html',bytes:artifact.length,sha256:sha(artifact)}],engine:{version:'4.7.2-stable',isolation:'fixed-author-fixture',evidenceHash}}});
 const prepared=await call('godotApplication.prepare',{id:'initial',token:'initial-token',candidateId:checked.candidateId,worldId:'alpha',revision:0,snapshot});
 const content=await call('content.status',{worldId:'alpha'});
 await call('content.apply.prepare',{worldId:'alpha',context:{operationId:'initial',worldId:'alpha',repoId:content.repoId,branchId:'main',expectedHeadOid:content.headOid,expectedAppliedOid:content.appliedOid,expectedProgressRevision:0},kind:'apply',targetOid:content.headOid,detail:'Fixed fixture initial application'});
 await call('content.apply.advance',{operationId:'initial'});
 await call('godotApplication.commit',{id:'initial',token:'initial-token',evidence:{format:'craftmine.godot-application/2',inputHash:prepared.inputHash,launch:{passed:true,buildId:job.buildId,instanceId:'fixture',stateHash:sha('fixture-state')},player:null,snapshot}});
 await call('content.apply.confirm',{operationId:'initial',applicationId:'initial',detail:'Fixed fixture application receipt'});
 await call('workspace.endTurn',{sessionId:context.sessionId,turnId:context.turnId,status:'completed'});
 turns=createPackageTurnLifecycle({call,pollMs:10});
 let enqueues=0;
 const options={call,selected:async()=> 'alpha',begin:async params=>{await call('workspace.open',{context:params.context,selectedWorld:params.selectedWorld});await call('task.recordContext',{context:params.context,requestId:params.request.id,text:params.request.text,kind:'request'});return call('task.context',{context:params.context});},enqueue:async()=>{enqueues++;},turns,stagingRoot:path.join(directory,'operations')};
 const service=createTargetFeedbackService(options);
 const described=await service.describe({worldId:'alpha'});assert.equal(described.targets.length,1);
 const request={worldId:'alpha',operationId:'set-feedback',targetId:'target-one',binding:described.targets[0].binding,values:{hitFlashMilliseconds:600}};
 const result=await service.submit(request);assert.equal(result.status,'check-queued');assert.equal(enqueues,1);
 const after=await call('world.read',{id:'alpha'});assert.deepEqual(after.world.snapshot,snapshot);assert.equal(after.world.build.id,job.buildId);
 await assert.rejects(service.describe({worldId:'alpha'}),/UNAPPLIED_DRAFT/);
 await call('godotBuild.cancel',{worldId:'alpha',jobId:result.job.jobId});
 const status=await service.status({worldId:'alpha',operationId:'set-feedback'});assert.equal(status.status,'cancelled');
 const restarted=createTargetFeedbackService(options);const replay=await restarted.submit(request);assert.equal(replay.job.jobId,result.job.jobId);
 assert.equal(calls.filter(item=>item.method==='godotProject.applyFiles').length,1);
 assert.equal(calls.filter(item=>item.method==='godotBuild.start').length,2); // seed + exactly one adjustment
 const report={passed:true,directory,coreSha256:sha(await fs.readFile(binary)),result,status,replay,limits:'Real core and service with fixed executor attestation only; no actual Godot or UI.'};
 await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){console.error(error);process.exitCode=1;}finally{
 await turns?.stop().catch(error=>{console.error(error);process.exitCode=1;});await core.stop();
 await fs.writeFile(path.join(directory,'calls.json'),JSON.stringify(calls,null,2));console.log('Evidence: '+directory);
}
