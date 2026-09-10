import {app,BrowserWindow} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {CoreClient} from '../plugins/craftmine-world/core-client.cjs';
import {createGodotExecutor} from '../plugins/craftmine-world/godot-executor.cjs';
import {createCreationSourceService} from '../plugins/craftmine-world/creation-source-service.cjs';
import {GodotBuildVerifier} from '../vendor/pi-desktop/apps/desktop/electron/main/godot-build-verifier';
import {GodotWorldViewHost} from '../vendor/pi-desktop/apps/desktop/electron/main/godot-world-view-host';
import {createGodotRuntimeAdapter} from '../vendor/pi-desktop/apps/desktop/electron/main/godot-runtime-adapter';
import {createGodotCandidateCoordinator} from '../vendor/pi-desktop/apps/desktop/electron/main/godot-candidate-coordinator';
import {createCreationTargetService} from '../vendor/pi-desktop/apps/desktop/electron/main/creation-target-service';
import {createCreationAutoApplyService} from '../vendor/pi-desktop/apps/desktop/electron/main/creation-auto-apply-service';
import {validCreationRequirement} from '../vendor/pi-desktop/apps/desktop/electron/main/creation-check-requirements';
import {createCraftmineLiveSampler} from '../vendor/pi-desktop/apps/desktop/electron/main/craftmine-live-sample';
import {createCraftmineRequestHooks} from '../vendor/pi-desktop/packages/agent-runtime/src/craftmine-context';
const out=process.env.CRAFTMINE_CREATION_CHAIN_OUT,report={kind:'真实生产LPAC执行器、Godot导出、Web检查及自动采用',checks:[],cases:[],rpc:[],limits:['使用固定作者输入，不代表真实模型首轮创作成功率。','主进程授权上下文由测试直接绑定；未驱动用户桌面UI。']};
const write=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
let core,executor,host,owner,coordinator;
const finish=async code=>{await executor?.stop().catch(()=>{});await coordinator?.closeForDeparture().catch(()=>{});await host?.close().catch(()=>{});host?.dispose();await core?.stop().catch(()=>{});write();app.exit(code);};
const fatal=async error=>{report.passed=false;report.failure=String(error?.stack??error);await finish(1);};
process.on('uncaughtException',fatal);process.on('unhandledRejection',fatal);app.on('window-all-closed',()=>{});
const check=(name,value)=>{report.checks.push({name,passed:!!value});write();assert.ok(value,name);};
app.whenReady().then(async()=>{
 const fixture=JSON.parse(fs.readFileSync(path.join(out,'fixtures.json'),'utf8')),{worldId}=fixture;
 owner=new BrowserWindow({show:false,focusable:false,width:1100,height:780,webPreferences:{offscreen:true,contextIsolation:true,nodeIntegration:false,sandbox:true}});await owner.loadFile(path.join(__dirname,'owner.html'));
 core=new CoreClient(process.env.CRAFTMINE_CORE_BIN,path.join(out,'core-data'));report.hello=await core.start();
 const call=async(method,args={},timeout)=>{try{const result=await core.call(method,args,timeout);if(['godotJob.claim','godotJob.checkDescriptor','godotJob.finish','godotApplication.prepare','godotApplication.commit'].includes(method)){report.rpc.push({method,args,result});write();}return result;}catch(error){report.rpc.push({method,args,error:String(error)});write();throw error;}};
 const adapter=createGodotRuntimeAdapter({domain:call,selection:async()=>worldId,instance:()=>host?.instance??null});
 host=new GodotWorldViewHost({window:()=>owner,allowedRoots:adapter.allowedRoots,descriptor:adapter.descriptor,progress:adapter.progress});host.setBounds({x:0,y:0,width:1060,height:740});host.setVisible(true);
 coordinator=createGodotCandidateCoordinator({host,adapter,selection:async()=>worldId,domain:call});
 const targets=createCreationTargetService({directory:path.join(out,'captures'),selection:async()=>worldId,instance:()=>host.instance,descriptor:id=>call('godotRuntime.describe',{worldId:id}),sample:createCraftmineLiveSampler(()=>host)});
 let activeContext=null,fixtureRequirements=null;
 // The harness is the trusted author for this fixed integration fixture. These
 // expectations are fixed before any source operation; no model chooses them.
 const boundCapture=async()=>{const capture=await targets.bound(activeContext,worldId);return {...capture,creationRequirements:fixtureRequirements};};
 const auto=createCreationAutoApplyService({capture:async context=>{assert.deepEqual(context,activeContext);return boundCapture();},domain:call,apply:(...args)=>coordinator.autoApplyVerified(...args)});
 const verifier=new GodotBuildVerifier({deadlineMs:90000});
 executor=createGodotExecutor({call},{dataPath:path.join(out,'core-data'),logger:console,verifier:{godotCheck:async descriptor=>{
  const item=report.cases.find(item=>item.job.jobId===descriptor.jobId);assert.ok(item);item.descriptor=descriptor;write();const evidence=await verifier.check(descriptor);item.runtime=evidence;write();return evidence;
 },cancelGodotCheck:id=>verifier.cancel(String(id)),creationCheckCompleted:async input=>{
  const item=report.cases.find(item=>item.job.jobId===input.jobId);item.completionInput=input;
  item.application=activeContext?await auto.completed(input):{status:'manual'};write();return item.application;
 }}});
 report.preflight=await executor.start();check('生产LPAC执行器和Web检查均可用',report.preflight.available&&report.preflight.checkAvailable);
 let context={projectId:'managed-creation-test',sessionId:'managed-creation-test',turnId:'blank'};
 await call('world.create',{id:worldId,title:'造物生产链验收',world:{build:{id:'base-creation',scene:{format:'craftmine.godot-scene/1',baseId:'creation-sandbox'},godot:{}},snapshot:fixture.snapshot,extensions:[]}});
 await call('workspace.open',{context,selectedWorld:worldId});
 let source=await call('godotProject.create',{context,worldId,toolCallId:'create',baseBuild:'base-creation',baseId:'creation-sandbox',files:[{path:'project.godot',text:Buffer.from(fixture.files.find(file=>file.path==='project.godot').bytesBase64,'base64').toString('utf8')}]});
 source=await call('godotProject.applyFiles',{context,worldId,toolCallId:'source',revision:source.revision,manifestHash:source.manifestHash,files:fixture.files.filter(file=>file.path!=='project.godot').map(file=>({...file,expectedHash:null}))},30000);
 async function run(name){
  const job=await call('godotBuild.start',{context,worldId,toolCallId:'check-'+name,revision:source.revision,manifestHash:source.manifestHash,mode:'check',...(name==='sequence'?{checkRequirements:{creation:fixtureRequirements.requirements}}:{})},30000);
  const item={name,job,before:await call('world.read',{id:worldId})};report.cases.push(item);write();
  assert.equal(executor.enqueue({jobId:job.jobId,worldId,mode:'check'},context).enqueued,true);
  const deadline=Date.now()+360000;
  while(executor.status().jobs.includes(job.jobId)){if(Date.now()>deadline)throw Error('CREATION_CHAIN_TIMEOUT');await new Promise(resolve=>setTimeout(resolve,300));}
  item.terminal=await call('godotBuild.read',{context,worldId,jobId:job.jobId});
  if(item.terminal.candidateId)item.candidate=await call('godotCandidate.read',{worldId,candidateId:item.terminal.candidateId});
  item.after=await call('world.read',{id:worldId});write();return item;
 }
 const blank=await run('blank');check('空白世界真实导入、导出和Web检查通过',blank.terminal.status==='passed'&&blank.candidate.candidate.status==='ready');
 const fontParts=fixture.files.filter(file=>/^assets\/fonts\/cjk-[01]\.json$/.test(file.path));
 check('完整中文字体分片通过大源码事务、LPAC导出和运行加载',fontParts.length===2&&fontParts.reduce((sum,file)=>sum+Buffer.from(file.bytesBase64,'base64').length,0)>5500000&&blank.runtime.passed&&blank.runtime.errors.ok);
 check('检查不会提前改变正式世界',JSON.stringify(blank.before)===JSON.stringify(blank.after));
 // Bootstrap using the actual candidate instance save receipt, never authored launch evidence.
 const prepared=await call('godotApplication.prepare',{id:'bootstrap',token:'bootstrap-token',worldId,candidateId:blank.terminal.candidateId,revision:blank.before.revision,snapshot:blank.before.world.snapshot});
 const descriptor=await adapter.describeCandidate(worldId,'bootstrap','bootstrap-token');await host.stageCandidate(descriptor,{first:true});
 const saved=await host.candidateRequest('save');assert.equal(saved.status,'confirmed');assert.deepEqual(saved.state,prepared.input.snapshot);
 await call('godotApplication.commit',{id:'bootstrap',token:'bootstrap-token',evidence:{format:'craftmine.godot-application/2',inputHash:prepared.inputHash,launch:{passed:true,buildId:descriptor.buildId,instanceId:host.candidateInstance.instanceId,stateHash:saved.runnerReceipt.snapshotSha256},player:null,snapshot:saved.state}});
 await host.promoteCandidate(await adapter.describe(worldId));check('真实候选首载回执建立正式世界',host.instance.buildId===blank.job.buildId);
 context={...context,turnId:'sequence'};activeContext=context;const workspace=await call('workspace.open',{context,selectedWorld:worldId});
 await targets.policy({worldId,autoApply:true});const display=await targets.capture(1,{projectId:context.projectId,sessionId:context.sessionId});
 const capture=await targets.validate(1,{creationTarget:{captureId:display.captureId}},{projectId:context.projectId,sessionId:context.sessionId});await targets.bind(1,capture,context,worldId);
 const expected={format:'craftmine.creation-requirements/1',requestHash:createHash('sha256').update(JSON.stringify(fixture.scene)).digest('hex'),entities:fixture.scene.entities.map(({id,kind,position,scale,color})=>({id,kind,position,scale,color,visible:true,solid:true})),counts:['tree','rock','chest','door','marker'].map(kind=>({kind,count:fixture.scene.entities.filter(entity=>entity.kind===kind).length})),doorSequence:{doorId:'new-door',steps:['mark-a','mark-b']}};
 assert.ok(validCreationRequirement(expected));fixtureRequirements={status:'verifiable',requirements:structuredClone(expected)};report.hostFixtureRequirements=structuredClone(fixtureRequirements);
 source=await call('godotProject.index',{context,worldId});report.sourceOperations=[];
 const createSource=createCreationSourceService({core:{call},capture:async()=>targets.bound(context,worldId),assertActive:input=>assert.deepEqual(input,activeContext),sample:async input=>{const envelope=await createCraftmineLiveSampler(()=>host)(input);return {...envelope,...envelope.payload};}});
 const operations=[...fixture.scene.entities.map(entity=>({action:'place',...entity})),{action:'sequence-door',ruleId:'ordered-door',doorId:'new-door',sequence:['mark-a','mark-b']}];
 for(const [index,operation] of operations.entries()){
  const result=await createSource({context,workspace,request:{...operation,operationId:'managed-op-'+index,expected:{worldId,buildId:capture.buildId,instanceId:capture.instanceId,revision:source.revision,manifestHash:source.manifestHash,targetSnapshotId:capture.snapshotId}}});
  report.sourceOperations.push(result);source=result.source;write();
 }
 check('真实主进程捕获驱动生产造物事务并连续推进源码',report.sourceOperations.length===5&&report.sourceOperations.every(item=>item.checkRequired&&!item.applied&&!item.replayed));
 const sequence=await run('sequence');check('新增树和源码机关通过生产Web检查',sequence.terminal.status==='passed'&&sequence.runtime.passed);
 check('执行器终态回调自动采用成功',sequence.application?.status==='applied'&&sequence.after.world.build.id===sequence.job.buildId);
 check('采用保留最新背包并增加新门与机关进度',sequence.after.world.snapshot.body.inventory['kept-token']===7&&sequence.after.world.snapshot.body.doors['new-door']===false&&sequence.after.world.snapshot.body.rules['ordered-door'].cursor===0);
 const completedContext=await call('task.context',{context});report.completedContext=completedContext;
 const hooks=createCraftmineRequestHooks({getContext:async()=>completedContext,domainCall:call});
 const reservation=await hooks.beforeRequest({requestId:'completed-closeout',purpose:'creation',model:{contextWindow:128000},maxOutputTokens:1000,context:{systemPrompt:'Headless closeout preflight only',messages:[{role:'user',content:'汇报本次结果',timestamp:1}],tools:[{name:'creation_operation',description:'Write',parameters:{type:'object'}}]}});
 check('真实Rust已完成任务可只读收尾且没有重新获取写租约',completedContext.status==='finished'&&!completedContext.lease.owned&&reservation.readOnlyCloseout&&reservation.context.tools.length===0&&JSON.stringify(reservation.context.messages).includes(sequence.job.buildId));
 await hooks.afterRequest({reservation,status:'cancelled',errorCode:'HEADLESS_PREFLIGHT_ONLY'});
 report.live=await host.request('observe-envelope',{});check('正式运行实例显示新树和源码机关',report.live.payload.creation.entities.some(entity=>entity.id==='new-tree')&&report.live.buildId===sequence.job.buildId);
 context={...context,turnId:'invalid-rule'};activeContext=context;await call('workspace.open',{context,selectedWorld:worldId});source=await call('godotProject.index',{context,worldId});
 const sceneFile=source.files.find(file=>file.path==='world/creation.json');
 const sceneRead=await call('godotProject.read',{context,worldId,revision:source.revision,manifestHash:source.manifestHash,path:sceneFile.path});const invalidScene=JSON.parse(sceneRead.text);invalidScene.revision++;invalidScene.rules[0].sha256='0'.repeat(64);
 source=await call('godotProject.patch',{context,worldId,toolCallId:'invalid-rule',revision:source.revision,manifestHash:source.manifestHash,operations:[{op:'put',path:'world/creation.json',text:JSON.stringify(invalidScene),expectedHash:sceneFile.sha256}]});
 const invalid=await run('invalid-rule');check('不匹配的机关源码哈希被真实检查拒绝',invalid.terminal.status==='failed'&&invalid.candidate?.candidate.status==='rejected'&&invalid.runtime.errors.runtime.some(message=>message.includes('Authored rule source hash mismatch')));
 check('失败规则没有触发自动采用且正式构建未变',!invalid.completionInput&&invalid.after.world.build.id===sequence.job.buildId&&JSON.stringify(invalid.before)===JSON.stringify(invalid.after));
 check('所有所属窗口保持隐藏且不可获取焦点',!owner.isVisible()&&!owner.isFocusable());
 await executor.stop();executor=null;await host.close();await core.stop();await core.start();const restarted=await call('world.read',{id:worldId});check('Rust重启仍保持成功采用版本和完整进度',JSON.stringify(restarted)===JSON.stringify(invalid.after));
 report.passed=true;await finish(0);
}).catch(fatal);
