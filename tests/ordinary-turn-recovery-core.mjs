// Actual private plugin router and packaged Rust. No model or native engine.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {DatabaseSync,backup} from 'node:sqlite';import {randomUUID} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(path.join(root,'vendor/pi-desktop/packages/agent-runtime/package.json'));
const out=fs.mkdtempSync(path.join(root,'test-results/ordinary-turn-recovery-'));const report={out,checks:[],scope:'real private turn.begin router and Core; copied retained state or authored task fixture; no model execution'};
await require('esbuild').build({entryPoints:[path.join(root,'plugins/craftmine-world/host-requests.cjs')],outfile:path.join(out,'router.cjs'),bundle:true,platform:'node',format:'cjs',plugins:[{name:'domain',setup(b){b.onResolve({filter:/^\.\/domain\.cjs$/},()=>({path:path.join(root,'plugins/craftmine-world/domain-adapter.mjs')}));}}]});
const {CoreClient}=createRequire(import.meta.url)('../plugins/craftmine-world/core-client.cjs'),{createHostRequests}=createRequire(import.meta.url)(path.join(out,'router.cjs'));
const directory=path.join(out,'domain');fs.mkdirSync(directory);
const source=process.argv[2];const sessionId=process.argv[3]??'recovery-session';
if(source){const db=new DatabaseSync(path.join(source,'plugins/data/craftmine.world/tasks.sqlite'),{readOnly:true});await backup(db,path.join(directory,'tasks.sqlite'));db.close();report.source=source;}
const binary=process.env.CRAFTMINE_CORE_BIN;if(!binary)throw Error('CRAFTMINE_CORE_BIN required');const core=new CoreClient(binary,directory);await core.start();
const calls=[],call=async(method,args)=>{calls.push({method,args});return core.call(method,args);};
const router=createHostRequests({call,start:()=>core.start()},{});const check=name=>{report.checks.push(name);console.log('PASS '+name);};
try{
 let projectId='recovery-project',worldId='world-recovery',original;
 if(source){const db=new DatabaseSync(path.join(directory,'tasks.sqlite'),{readOnly:true});const row=db.prepare('SELECT project_id,world_id FROM craftmine_session_worlds WHERE session_id=?').get(sessionId);db.close();assert.ok(row);projectId=row.project_id;worldId=row.world_id;original=await call('workspace.current',{projectId,sessionId});}
 else {
  const context={projectId,sessionId,turnId:'original-turn'};
  await call('world.create',{id:worldId,title:'Preserved world',world:{build:{id:'base',scene:{format:'craftmine.scene/3',objects:[],systems:[],behaviors:[]}},snapshot:{format:'craftmine.progress/1',player:{x:0,y:6,z:0,yaw:0,pitch:0}},extensions:[]}});
  await router('turn.begin',{context,selectedWorld:worldId,request:{id:'original-request',text:'Preserve the existing creation'}});
  original=await call('workspace.current',{projectId,sessionId});
  const facts=await call('task.context',{context});
  await call('budget.reserve',{binding:facts.binding,generation:facts.generation,requestId:'first-physical-request',purpose:'creation',estimatedInputTokens:70,maxOutputTokens:30,limits:{maxRequests:80,maxTokens:1000000,maxCompactions:8,deadlineAt:Date.now()+1800000}});
  await call('budget.settle',{binding:facts.binding,generation:facts.generation,requestId:'first-physical-request',status:'known',usage:{inputTokens:10,outputTokens:20}});
  // Explicit authored clock fixture, never the source profile or production DB.
  const clockDb=new DatabaseSync(path.join(directory,'tasks.sqlite'));clockDb.prepare("UPDATE craftmine_budget_limits SET limits=json_set(limits,'$.deadlineAt',1) WHERE owner=?").run(facts.budget.ownerTaskId);clockDb.close();
  await assert.rejects(call('budget.reserve',{binding:facts.binding,generation:facts.generation,requestId:'expired-physical-request',purpose:'creation',estimatedInputTokens:70,maxOutputTokens:30}),/TASK_DEADLINE_EXCEEDED/);
  await call('workspace.endTurn',{sessionId,turnId:context.turnId,status:'aborted'});
 }
 const before=await call('task.context',{context:{projectId,sessionId,turnId:original.task.binding.turnId}}),world=await call('world.read',{id:worldId});
 assert.equal(before.recovery,'interrupted');
 const context={projectId,sessionId,turnId:randomUUID()},request={context,selectedWorld:worldId,request:{id:randomUUID(),text:'Continue this world, preserving what I already created'}};
 await assert.rejects(router('turn.begin',request),/EXPLICIT_RECOVERY_REQUIRED/);check('ordinary private callers without the explicit continuation intent keep the old recovery guard');
 await assert.rejects(router('turn.begin',{...request,selectedWorld:'different-world',resumeInterrupted:true}),/RECOVERY_WORLD_BINDING_MISMATCH/);check('continuation cannot redirect an interrupted draft into another selected world');
 await assert.rejects(router('turn.begin',{...request,request:{id:'bad',text:''},resumeInterrupted:true}),/INVALID_HOST_TEXT/);
 const blocker={projectId,sessionId:'different-live-session',turnId:randomUUID()};
 await call('workspace.open',{context:blocker,selectedWorld:worldId});
 await assert.rejects(router('turn.begin',{...request,resumeInterrupted:true}),/WORLD_BUSY/);
 assert.equal((await call('workspace.current',{projectId,sessionId})).task.binding.taskId,original.task.binding.taskId);
 check('another live world lease cannot be stolen by continuation');
 await call('workspace.endTurn',{sessionId:blocker.sessionId,turnId:blocker.turnId,status:'completed'});
 const result=await router('turn.begin',{...request,resumeInterrupted:true});
 report.recovery={beforeBudget:before.budget,afterBudget:result.budget,beforeGeneration:before.generation,afterGeneration:result.generation,worldId};
 assert.equal(result.binding.turnId,context.turnId);assert.equal(result.world.id,worldId);assert.equal(result.generation,before.generation+1);assert.equal(result.budget.ownerTaskId,before.budget.ownerTaskId);
 assert.equal(result.budget.requestCount,before.budget.requestCount);assert.equal(result.status,'running');assert.equal(result.lease.owned,true);
 assert.deepEqual({...result.budget,limits:{...result.budget.limits,deadlineAt:before.budget.limits.deadlineAt}},before.budget,'all accounting and non-clock limits retained');
 if(before.budget.limits.deadlineAt!==null)assert.ok(result.budget.limits.deadlineAt>Date.now(),'explicit new-message recovery renews the finite window');
 const readDb=new DatabaseSync(path.join(directory,'tasks.sqlite'),{readOnly:true});
 assert.equal(readDb.prepare('SELECT text FROM craftmine_task_requirements WHERE task_id=? AND request_id=?').get(result.binding.taskId,request.request.id).text,request.request.text);readDb.close();
 for(const requirement of before.requirements.filter(item=>item.kind==='request'))assert.ok(result.requirements.some(item=>item.id===requirement.id&&item.text===requirement.text),'original goal retained');
 const after=await call('workspace.current',{projectId,sessionId});assert.deepEqual(after.task.draft,original.task.draft);assert.equal(after.resumedFrom,original.task.binding.taskId);assert.deepEqual(await call('world.read',{id:worldId}),world);
 check('new user continuation resumes exact retained draft, budget and world under the new turn');
 const replay=await router('turn.begin',{...request,resumeInterrupted:true});assert.equal(replay.binding.taskId,result.binding.taskId);assert.equal(replay.generation,result.generation);check('lost acknowledgement replay cannot create another task or reset the generation');
 assert.equal(replay.budget.limits.deadlineAt,result.budget.limits.deadlineAt,'same turn acknowledgement cannot extend the deadline');
 assert.ok(!result.requirements.some(item=>item.id===request.request.id),'continued request is outside the bounded first-request projection');
 const refreshed=await router('task.context',{context,request:request.request});assert.equal(refreshed.binding.taskId,result.binding.taskId);
 await assert.rejects(router('task.context',{context,request:{...request.request,text:request.request.text+' changed'}}),/REPLAY_MISMATCH/);
 const correction={id:randomUUID(),text:'A newly supplied correction remains a correction'};
 await router('task.context',{context,request:correction});
 const requirementDb=new DatabaseSync(path.join(directory,'tasks.sqlite'),{readOnly:true});
 assert.equal(requirementDb.prepare('SELECT kind FROM craftmine_task_requirements WHERE task_id=? AND request_id=?').get(result.binding.taskId,request.request.id).kind,'request');
 assert.equal(requirementDb.prepare('SELECT kind FROM craftmine_task_requirements WHERE task_id=? AND request_id=?').get(result.binding.taskId,correction.id).kind,'correction');requirementDb.close();
 check('request preflight preserves the full journal kind outside bounded context, rejects changed text, and records only new corrections');
 await assert.rejects(router('task.resume',{context,worldId,taskId:original.task.binding.taskId,generation:before.generation,renewRequestWindow:true}),/fields|字段|field|UNKNOWN|UNEXPECTED/i);
 if(!source){const admitted=await router('budget.reserve',{context,binding:result.binding,generation:result.generation,requestId:'continued-physical-request',purpose:'creation',estimatedInputTokens:70,maxOutputTokens:30});assert.equal(admitted.budget.requestCount,before.budget.requestCount+1);assert.equal(admitted.budget.actualTokens,before.budget.actualTokens);check('expired authored production window admits the next request without resetting previous accounting');}
 await assert.rejects(router('turn.begin',{...request,context:{projectId,sessionId,turnId:original.task.binding.turnId},resumeInterrupted:true}),/TURN_ENDED/);check('the ended original turn remains revoked');
 await call('workspace.endTurn',{sessionId,turnId:context.turnId,status:'completed'});report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}finally{await core.stop();report.methods=calls.map(x=>x.method);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.passed,error:report.error}));}
