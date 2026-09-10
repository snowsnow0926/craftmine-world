// Authored source compiler -> pinned Godot physics -> real Rust progress restart.
// No model reliability, visual rendering, microphone, or desktop UI claim.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {createGodotProbeEnvironment} from '../desktop/godot/toolchain.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sourceRoot=path.resolve(process.env.CRAFTMINE_STORY_SOURCE_ROOT || root);
const require=createRequire(import.meta.url);
const {compileCreationOperation}=require(path.join(sourceRoot,'plugins/craftmine-world/creation-operations.cjs'));
const {createCreationSourceService}=require(path.join(sourceRoot,'plugins/craftmine-world/creation-source-service.cjs'));
const {CoreClient}=require('../plugins/craftmine-world/core-client.cjs');
const {createPortableRestoreService}=require('../plugins/craftmine-world/portable-restore-service.cjs');
const {materializeBase}=await import(pathToFileURL(path.join(sourceRoot,'desktop/godot/shared/materialize.mjs')));
const {deriveAdditiveProgress}=await import(pathToFileURL(path.join(sourceRoot,'desktop/godot/shared/progress-migration.mjs')));
const sha=value=>createHash('sha256').update(value).digest('hex');
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const out=fs.mkdtempSync(path.join(root,'test-results/creation-story-'));
const project=path.join(out,'project');
const report={kind:'真实引擎造物故事与 Rust 跨重启保存',sourceRoot,out,checks:[],stages:[],limits:['固定作者输入，未调用模型，不能作为首次创作成功率','headless 物理与状态验证，不声称画面、语音或桌面面板验收','验收专用 executor 注册实际导出件，不声称生产沙箱执行器验收'],errors:[]};
let core;
const check=(name,value)=>{report.checks.push({name,passed:!!value});assert.ok(value,name);console.log('PASS '+name);};
try {
  const environment=await createGodotProbeEnvironment(out,{web:true,threads:true});report.engineVersion=environment.actualVersion;report.runs=environment.runs;
  const presetLiteral=fs.readFileSync(path.join(sourceRoot,'vendor/pi-desktop/crates/craftmine-core/src/godot_host_resources.rs'),'utf8').match(/const EXPORT_PRESET: &str = ("(?:\\.|[^"\\])*");/);
  const preset=JSON.parse(presetLiteral[1]);assert.ok(preset.includes('script_export_mode=0'));
  const prepareExport=directory=>{fs.copyFileSync(path.join(sourceRoot,'desktop/godot/web/shell.html'),path.join(directory,'craftmine_host_shell.html'));fs.writeFileSync(path.join(directory,'export_presets.cfg'),preset.replace('custom_template/release=""','custom_template/release='+JSON.stringify(environment.webTemplate.replaceAll('\\','/'))));};
  const exportProject=async(label,directory,destination)=>{
    const fixtures=new Map(['story.gd','story-config.json'].filter(name=>fs.existsSync(path.join(directory,name))).map(name=>[name,fs.readFileSync(path.join(directory,name))]));
    try{for(const name of fixtures.keys())fs.rmSync(path.join(directory,name));await environment.run(label,['--path',directory,'--export-release','Web',path.join(destination,'index.html')],{timeout:120000});fs.copyFileSync(path.join(sourceRoot,'desktop/godot/web/bridge.js'),path.join(destination,'bridge.js'));}
    finally{for(const [name,bytes]of fixtures)fs.writeFileSync(path.join(directory,name),bytes);}
  };
  materializeBase({baseId:'creation-sandbox',worldId:'creation-story',out:project});
  fs.copyFileSync(path.join(root,'tests/fixtures/creation-story.gd'),path.join(project,'story.gd'));
  const source={worldId:'creation-story',buildId:'story-build',instanceId:'story-instance',revision:1,manifestHash:'a'.repeat(64),files:{}};
  for(const name of ['world/creation.json','world/creation-operations.json'])if(fs.existsSync(path.join(project,name))){const text=fs.readFileSync(path.join(project,name),'utf8');source.files[name]={text,sha256:sha(text)};}
  let observation;
  const stage=async(name,restore,buildId='story-build',worldId='creation-story',projectRoot=project)=>{
    fs.writeFileSync(path.join(projectRoot,'story-config.json'),JSON.stringify({stage:name,restore,buildId,worldId}));
    const label=String(report.stages.length).padStart(2,'0')+'-'+name;
    await environment.run(label+'-import',['--path',projectRoot,'--editor','--import']);
    const stdout=await environment.run(label,['--path',projectRoot,'--script','res://story.gd'],{timeout:60000});
    const lines=stdout.split(/\r?\n/).filter(line=>line.startsWith('CRAFTMINE_CREATION_STORY='));assert.equal(lines.length,1);
    const result=JSON.parse(lines[0].slice('CRAFTMINE_CREATION_STORY='.length));report.stages.push(result);observation=result.observation;
    check(name+'：真实 headless 进程完成',result.headless);return result;
  };
  let operationNumber=0;
  const apply=patch=>{
    const snapshotId='story-capture-'+operationNumber;
    const targetSnapshot={snapshotId,worldId:source.worldId,buildId:source.buildId,instanceId:source.instanceId,sourceRevision:source.revision,manifestHash:source.manifestHash,playerPosition:observation.player.position,target:{...observation.creation.target,revision:JSON.parse(source.files['world/creation.json'].text).revision}};
    const request={operationId:'story-op-'+operationNumber++,expected:{worldId:source.worldId,buildId:source.buildId,instanceId:source.instanceId,revision:source.revision,manifestHash:source.manifestHash,targetSnapshotId:snapshotId},...patch};
    const result=compileCreationOperation({source,targetSnapshot,request});
    for(const op of result.operations){assert.equal(op.expectedHash,source.files[op.path]?.sha256??null);fs.mkdirSync(path.dirname(path.join(project,op.path)),{recursive:true});fs.writeFileSync(path.join(project,op.path),op.text);source.files[op.path]={text:op.text,sha256:sha(op.text)};}
    source.revision++;source.manifestHash=sha(JSON.stringify(source.files));return result;
  };
  await stage('blank');
  apply({action:'place',id:'story-tree',kind:'tree'});
  await stage('tree');
  apply({action:'modify',targetId:'story-tree',changes:{scale:[1,2,1]}});
  await stage('enlarged');
  apply({action:'duplicate',targetId:'story-tree',count:1,offset:[8,0,0]});
  apply({action:'place',id:'story-chest',kind:'chest',position:[2,0,4],parameters:{rewardId:'story-token',rewardCount:2}});
  apply({action:'place',id:'story-door',kind:'door',position:[-4,0,2]});
  apply({action:'place',id:'marker-a',kind:'marker',position:[-2,0,4],parameters:{label:'A'}});
  apply({action:'place',id:'marker-b',kind:'marker',position:[-2,0,6],parameters:{label:'B'}});
  apply({action:'sequence-door',ruleId:'story-rule',doorId:'story-door',sequence:['marker-a','marker-b']});
  let played=await stage('play');
  check('造物源码产生实际树、宝箱、门和标记',played.observation.creation.entities.length===6);
  const trees=played.observation.creation.entities.filter(entity=>entity.kind==='tree');
  check('有限复制在真实场景保留两个独立稳定身份与大小',trees.length===2&&trees[0].id!==trees[1].id&&trees.every(tree=>tree.scale[1]===2));
  const suppliedBinary=process.env.CRAFTMINE_CORE_BINARY;
  assert.ok(suppliedBinary&&path.isAbsolute(suppliedBinary),'Set CRAFTMINE_CORE_BINARY to a built actual Rust core executable');
  const binary=path.join(out,'craftmine-core.exe');fs.copyFileSync(suppliedBinary,binary);
  report.core={binary,suppliedBinary,sha256:sha(fs.readFileSync(binary))};
  const data=path.join(out,'core-data');fs.mkdirSync(data);
  core=new CoreClient(binary,data);await core.start();
  await core.call('world.create',{id:'creation-story',title:'造物验收',world:{build:{id:'story-build',scene:{format:'craftmine.godot-scene/1',baseId:'creation-sandbox'},godot:{}},snapshot:played.restored,extensions:[]}});
  const exportRoot=path.join(out,'export');fs.mkdirSync(exportRoot);
  prepareExport(project);
  await exportProject('story-web-export',project,exportRoot);
  const context={projectId:'story-fixture',sessionId:'story-fixture',turnId:'story-turn'};
  await core.call('workspace.open',{context,selectedWorld:'creation-story'});
  const authoredFiles=fs.readdirSync(project,{recursive:true}).filter(name=>!name.split(/[\\/]/).some(part=>part.startsWith('.'))&&!['story.gd','story-config.json','managed-base.json','export_presets.cfg','craftmine_host_shell.html'].includes(name)&&!name.endsWith('.uid')&&fs.lstatSync(path.join(project,name)).isFile()).map(name=>({path:name.replaceAll('\\','/'),text:fs.readFileSync(path.join(project,name),'utf8')}));
  let indexed=await core.call('godotProject.create',{context,worldId:'creation-story',toolCallId:'story-source',baseBuild:'story-build',baseId:'creation-sandbox',files:authoredFiles.slice(0,16)});
  for(let offset=16;offset<authoredFiles.length;offset+=16)indexed=await core.call('godotProject.patch',{context,worldId:'creation-story',toolCallId:'story-source-'+offset,revision:indexed.revision,manifestHash:indexed.manifestHash,operations:authoredFiles.slice(offset,offset+16).map(file=>({op:'put',...file,expectedHash:null}))});
  await core.call('godotExecutor.register',{executorId:'authored-story-fixture',attestation:{format:'craftmine.godot-executor/1',isolation:'authored-test-fixture',evidenceHash:sha('real-godot-story-logs'),engineVersion:'4.7.2-stable',capabilities:{import:true,build:true,check:true}}});
  const job=await core.call('godotBuild.start',{context,worldId:'creation-story',toolCallId:'story-check',revision:indexed.revision,manifestHash:indexed.manifestHash,mode:'check'});
  const claim=await core.call('godotJob.claim',{jobId:job.jobId,token:'story-claim',executorId:'authored-story-fixture'});
  fs.cpSync(exportRoot,path.join(claim.artifactsRoot,'web'),{recursive:true});
  const artifacts=fs.readdirSync(claim.artifactsRoot,{recursive:true}).filter(name=>fs.lstatSync(path.join(claim.artifactsRoot,name)).isFile()).map(name=>{const bytes=fs.readFileSync(path.join(claim.artifactsRoot,name));return {path:name.replaceAll('\\','/'),bytes:bytes.length,sha256:sha(bytes)};});
  const finished=await core.call('godotJob.finish',{jobId:job.jobId,token:'story-claim',output:{format:'craftmine.godot-job-result/1',inputHash:claim.inputHash,passed:true,import:{passed:true,log:'Actual headless import and Web export logs recorded beside report.json'},compile:{passed:true,errors:[],warnings:[]},check:{passed:true,assertions:[{id:'authored-headless-story',passed:true}]},artifacts,engine:{version:'4.7.2-stable',isolation:'authored-test-fixture',evidenceHash:claim.evidenceHash}}});
  const prepared=await core.call('godotApplication.prepare',{id:'story-apply',token:'story-apply-token',worldId:'creation-story',candidateId:finished.candidateId,revision:0,snapshot:played.restored});
  await core.call('godotApplication.commit',{id:'story-apply',token:'story-apply-token',evidence:{format:'craftmine.godot-application/2',inputHash:prepared.inputHash,launch:{passed:true,buildId:prepared.buildId,instanceId:'story-initial',stateHash:sha(JSON.stringify(played.restored))},player:null,snapshot:played.restored}});
  played=await stage('play',undefined,prepared.buildId);
  const snapshot=played.saved.state;
  const applied=await core.call('world.read',{id:'creation-story'});
  const saved=await core.call('godotRuntime.saveProgress',{worldId:'creation-story',buildId:prepared.buildId,revision:applied.revision,snapshot,runnerReceipt:played.saved.runnerReceipt});
  check('真实 Godot 运行回执通过 Rust 保存校验',saved.receipt.revision===applied.revision+1);
  await core.stop();core=new CoreClient(binary,data);await core.start();
  const reopened=await core.call('world.read',{id:'creation-story'});
  assert.deepEqual(reopened.world.snapshot,snapshot);check('Rust 进程重启后完整进度一致',true);
  await core.stop();core=null;
  const restored=await stage('reopen',reopened.world.snapshot,prepared.buildId);
  assert.deepEqual(restored.restored,snapshot);check('新 Godot 进程恢复全部字段与游玩进度',true);
  check('重开宝箱不重复发放奖励',restored.saved.state.body.inventory['story-token']===2);
  // Continue authoring after the saved game has reopened. Defaults come from a
  // separate actual candidate process, then both JS and Rust derive migration.
  core=new CoreClient(binary,data);await core.start();
  const nextContext={...context,turnId:'story-continue'};
  const sourceWorkspace=await core.call('workspace.open',{context:nextContext,selectedWorld:'creation-story'});
  const beforeEdit=await core.call('godotProject.index',{context:nextContext,worldId:'creation-story',offset:0,limit:32});
  const bound={format:'craftmine.creation-target/1',worldId:'creation-story',buildId:prepared.buildId,instanceId:'story-instance',sourceRevision:beforeEdit.revision,manifestHash:beforeEdit.manifestHash,snapshotId:'continued-native-capture',sampledAt:restored.sampledAt,playerPosition:restored.observation.player.position,target:restored.observation.creation.target};
  const sourceService=createCreationSourceService({core,capture:async()=>structuredClone(bound),assertActive:()=>{},sample:async()=>{
    const observed=await stage('service-sample',snapshot,prepared.buildId);
    return {worldId:bound.worldId,buildId:bound.buildId,instanceId:bound.instanceId,sampledAt:observed.sampledAt,player:observed.observation.player};
  }});
  const sourceRequest={operationId:'continued-service-rock',expected:{worldId:bound.worldId,buildId:bound.buildId,instanceId:bound.instanceId,revision:beforeEdit.revision,manifestHash:beforeEdit.manifestHash,targetSnapshotId:bound.snapshotId},action:'place',id:'later-rock',kind:'rock',position:[6,0,6]};
  const serviceArgs={context:nextContext,workspace:sourceWorkspace,request:sourceRequest};
  const serviceResult=await sourceService(serviceArgs);report.sourceService=serviceResult;
  check('生产源码服务真实 RPC 放置并返回待检查草稿',!serviceResult.applied&&serviceResult.checkRequired&&!serviceResult.replayed);
  const replay=await sourceService(serviceArgs);check('生产源码服务真实回执恢复不重复创建物体',replay.replayed&&replay.source.revision===serviceResult.source.revision);
  for(const name of ['world/creation.json','world/creation-operations.json']){
    let text='',offset=0;do{const read=await core.call('godotProject.read',{context:nextContext,worldId:bound.worldId,...serviceResult.source,path:name,offset,limit:16000});text+=read.text;offset=read.nextOffset;}while(offset!=null);
    source.files[name]={text,sha256:sha(text)};fs.writeFileSync(path.join(project,name),text);
  }
  source.revision=serviceResult.source.revision;source.manifestHash=serviceResult.source.manifestHash;
  source.buildId=prepared.buildId;
  apply({action:'place',id:'later-door',kind:'door',position:[-8,0,4]});
  apply({action:'sequence-door',ruleId:'later-rule',doorId:'later-door',sequence:['marker-b','marker-a']});
  apply({action:'environment',timeOfDay:18});
  const defaults=await stage('candidate-defaults');
  const migration=deriveAdditiveProgress(snapshot,defaults.restored);
  report.migration=migration;
  const continued=await stage('continued',migration.snapshot);
  assert.deepEqual(continued.restored,migration.snapshot);check('真实候选恢复新增对象和规则，同时保留旧进度',true);
  await exportProject('continued-web-export',project,exportRoot);
  let nextIndex=await core.call('godotProject.index',{context:nextContext,worldId:'creation-story',offset:0,limit:32});
  const oldFiles=[...nextIndex.files];let nextOffset=nextIndex.nextOffset;
  while(nextOffset!=null){const page=await core.call('godotProject.index',{context:nextContext,worldId:'creation-story',revision:nextIndex.revision,manifestHash:nextIndex.manifestHash,offset:nextOffset,limit:32});oldFiles.push(...page.files);nextOffset=page.nextOffset;}
  const updates=Object.entries(source.files).filter(([name,file])=>oldFiles.find(old=>old.path===name)?.sha256!==file.sha256).map(([name,file])=>({op:'put',path:name,text:file.text,expectedHash:oldFiles.find(old=>old.path===name)?.sha256??null}));
  nextIndex=await core.call('godotProject.patch',{context:nextContext,worldId:'creation-story',toolCallId:'continued-source',revision:nextIndex.revision,manifestHash:nextIndex.manifestHash,operations:updates});
  await core.call('godotExecutor.register',{executorId:'authored-story-fixture',attestation:{format:'craftmine.godot-executor/1',isolation:'authored-test-fixture',evidenceHash:sha('real-godot-story-logs'),engineVersion:'4.7.2-stable',capabilities:{import:true,build:true,check:true}}});
  const nextJob=await core.call('godotBuild.start',{context:nextContext,worldId:'creation-story',toolCallId:'continued-check',revision:nextIndex.revision,manifestHash:nextIndex.manifestHash,mode:'check'});
  const nextClaim=await core.call('godotJob.claim',{jobId:nextJob.jobId,token:'continued-claim',executorId:'authored-story-fixture'});
  fs.cpSync(exportRoot,path.join(nextClaim.artifactsRoot,'web'),{recursive:true});
  const nextArtifacts=fs.readdirSync(nextClaim.artifactsRoot,{recursive:true}).filter(name=>fs.lstatSync(path.join(nextClaim.artifactsRoot,name)).isFile()).map(name=>{const bytes=fs.readFileSync(path.join(nextClaim.artifactsRoot,name));return {path:name.replaceAll('\\','/'),bytes:bytes.length,sha256:sha(bytes)};});
  await core.call('godotJob.checkDescriptor',{jobId:nextJob.jobId,token:'continued-claim',artifacts:nextArtifacts});
  const nextFinished=await core.call('godotJob.finish',{jobId:nextJob.jobId,token:'continued-claim',output:{format:'craftmine.godot-job-result/1',inputHash:nextClaim.inputHash,passed:true,import:{passed:true,log:'Actual continued world import and Web export logs'},compile:{passed:true,errors:[],warnings:[]},check:{passed:true,assertions:[{id:'continued-native-load',passed:true}],defaultsSnapshot:defaults.restored,progressMigration:migration},artifacts:nextArtifacts,engine:{version:'4.7.2-stable',isolation:'authored-test-fixture',evidenceHash:nextClaim.evidenceHash}}});
  const nextPrepared=await core.call('godotApplication.prepare',{id:'continued-apply',token:'continued-apply-token',worldId:'creation-story',candidateId:nextFinished.candidateId,revision:reopened.revision,snapshot});
  assert.deepEqual(nextPrepared.input.snapshot,migration.snapshot);check('Rust 独立推导的第二次采用迁移与实际候选一致',true);
  const nativeContinued=await stage('continued',nextPrepared.input.snapshot,nextPrepared.buildId);
  await core.call('godotApplication.commit',{id:'continued-apply',token:'continued-apply-token',evidence:{format:'craftmine.godot-application/2',inputHash:nextPrepared.inputHash,launch:{passed:true,buildId:nextPrepared.buildId,instanceId:'story-instance',stateHash:sha(JSON.stringify(nativeContinued.restored))},player:null,snapshot:nativeContinued.restored}});
  const secondApplied=await core.call('world.read',{id:'creation-story'});assert.deepEqual(secondApplied.world.snapshot,migration.snapshot);
  check('二次正式采用完成且未重置游玩进度',secondApplied.world.build.id===nextPrepared.buildId);
  await core.call('godotWorld.copy',{sourceWorldId:'creation-story',targetWorldId:'creation-copy',title:'造物世界独立副本',progress:'formal'});
  const copied=await core.call('world.read',{id:'creation-copy'});
  const expectedCopy=structuredClone(migration.snapshot);expectedCopy.worldId='creation-copy';expectedCopy.body.worldId='creation-copy';
  assert.deepEqual(copied.world.snapshot,expectedCopy);check('第二世界复制仅替换世界身份并保留完整进度',true);
  const copyContext={projectId:'copy-fixture',sessionId:'copy-fixture',turnId:'copy-read'};
  await core.call('content.migrate.apply',{worldId:'creation-copy'});
  await core.call('godotWorld.prepareRebuildSource',{worldId:'creation-copy'});
  await core.call('godotWorld.prepareCopyRuntime',{worldId:'creation-copy'});
  let copyWorkspace=await core.call('workspace.open',{context:copyContext,selectedWorld:'creation-copy'});
  const copyIndex=await core.call('godotProject.index',{context:copyContext,worldId:'creation-copy',offset:0,limit:32});
  let ledgerText='',ledgerOffset=0;do{const read=await core.call('godotProject.read',{context:copyContext,worldId:'creation-copy',revision:copyIndex.revision,manifestHash:copyIndex.manifestHash,path:'world/creation-operations.json',offset:ledgerOffset,limit:16000});ledgerText+=read.text;ledgerOffset=read.nextOffset;}while(ledgerOffset!=null);
  const copiedOperations=JSON.parse(ledgerText).operations;
  check('复制源码操作账本重绑定新世界且保留历史身份',copiedOperations.length>0&&copiedOperations.every(entry=>entry.receipt.worldId==='creation-copy'));
  const copyProject=path.join(out,'copy-project'),copyExport=path.join(out,'copy-export');fs.mkdirSync(copyProject);fs.mkdirSync(copyExport);
  const copyFiles=[...copyIndex.files];let copyOffset=copyIndex.nextOffset;
  while(copyOffset!=null){const next=await core.call('godotProject.index',{context:copyContext,worldId:'creation-copy',revision:copyIndex.revision,manifestHash:copyIndex.manifestHash,offset:copyOffset,limit:32});copyFiles.push(...next.files);copyOffset=next.nextOffset;}
  for(const file of copyFiles){let text='',offset=0;do{const read=await core.call('godotProject.read',{context:copyContext,worldId:'creation-copy',revision:copyIndex.revision,manifestHash:copyIndex.manifestHash,path:file.path,offset,limit:16000});text+=read.text;offset=read.nextOffset;}while(offset!=null);assert.equal(sha(text),file.sha256);fs.mkdirSync(path.dirname(path.join(copyProject,file.path)),{recursive:true});fs.writeFileSync(path.join(copyProject,file.path),text);}
  fs.copyFileSync(path.join(root,'tests/fixtures/creation-story.gd'),path.join(copyProject,'story.gd'));
  const copyNative=await stage('continued',expectedCopy,nextPrepared.buildId,'creation-copy',copyProject);assert.deepEqual(copyNative.restored,expectedCopy);
  prepareExport(copyProject);await exportProject('copied-web-export',copyProject,copyExport);
  const copyJob=await core.call('godotBuild.start',{context:copyContext,worldId:'creation-copy',toolCallId:'copied-check',revision:copyIndex.revision,manifestHash:copyIndex.manifestHash,mode:'check'});
  const copyClaim=await core.call('godotJob.claim',{jobId:copyJob.jobId,token:'copied-claim',executorId:'authored-story-fixture'});
  fs.cpSync(copyExport,path.join(copyClaim.artifactsRoot,'web'),{recursive:true});
  const copyArtifacts=fs.readdirSync(copyClaim.artifactsRoot,{recursive:true}).filter(name=>fs.lstatSync(path.join(copyClaim.artifactsRoot,name)).isFile()).map(name=>{const bytes=fs.readFileSync(path.join(copyClaim.artifactsRoot,name));return {path:name.replaceAll('\\','/'),bytes:bytes.length,sha256:sha(bytes)};});
  const copyFinished=await core.call('godotJob.finish',{jobId:copyJob.jobId,token:'copied-claim',output:{format:'craftmine.godot-job-result/1',inputHash:copyClaim.inputHash,passed:true,import:{passed:true,log:'Actual copied source import and Web export logs'},compile:{passed:true,errors:[],warnings:[]},check:{passed:true,assertions:[{id:'copy-native-load',passed:true}]},artifacts:copyArtifacts,engine:{version:'4.7.2-stable',isolation:'authored-test-fixture',evidenceHash:copyClaim.evidenceHash}}});
  const copyPrepared=await core.call('godotApplication.prepare',{id:'copy-apply',token:'copy-apply-token',worldId:'creation-copy',candidateId:copyFinished.candidateId,revision:copied.revision,snapshot:expectedCopy});
  const adoptedCopy=await stage('continued',expectedCopy,copyPrepared.buildId,'creation-copy',copyProject);
  await core.call('godotApplication.commit',{id:'copy-apply',token:'copy-apply-token',evidence:{format:'craftmine.godot-application/2',inputHash:copyPrepared.inputHash,launch:{passed:true,buildId:copyPrepared.buildId,instanceId:'story-instance',stateHash:sha(JSON.stringify(adoptedCopy.restored))},player:null,snapshot:adoptedCopy.restored}});
  check('复制世界独立构建与正式采用后真实重开成功',(await core.call('godotRuntime.describe',{worldId:'creation-copy'})).copiedFromWorldId==null);
  copyContext.turnId='copy-edit';copyWorkspace=await core.call('workspace.open',{context:copyContext,selectedWorld:'creation-copy'});
  const editableCopy=await core.call('godotProject.index',{context:copyContext,worldId:'creation-copy',offset:0,limit:32});
  const copyBound={...bound,worldId:'creation-copy',buildId:copyPrepared.buildId,sourceRevision:editableCopy.revision,manifestHash:editableCopy.manifestHash,snapshotId:'copy-native-capture',sampledAt:adoptedCopy.sampledAt,playerPosition:adoptedCopy.observation.player.position,target:adoptedCopy.observation.creation.target};
  const editCopy=createCreationSourceService({core,capture:async()=>copyBound,assertActive:()=>{},sample:async()=>{const sample=await stage('copy-sample',expectedCopy,copyPrepared.buildId,'creation-copy',copyProject);return {worldId:copyBound.worldId,buildId:copyBound.buildId,instanceId:copyBound.instanceId,sampledAt:sample.sampledAt,player:sample.observation.player};}});
  const copyEdit=await editCopy({context:copyContext,workspace:copyWorkspace,request:{operationId:'copy-only-object',action:'place',id:'copy-only-object',kind:'marker',position:[12,0,12],expected:{worldId:copyBound.worldId,buildId:copyBound.buildId,instanceId:copyBound.instanceId,revision:editableCopy.revision,manifestHash:editableCopy.manifestHash,targetSnapshotId:copyBound.snapshotId}}});
  report.copyEdit=copyEdit;check('独立采用的复制世界可通过生产源码服务继续创造',copyEdit.receipt.createdIds.includes('copy-only-object'));
  const originalAfterCopyEdit=await core.call('godotProject.index',{context:nextContext,worldId:'creation-story',offset:0,limit:32});
  check('复制世界后续编辑未修改原世界源码',originalAfterCopyEdit.manifestHash===nextIndex.manifestHash);
  assert.deepEqual((await core.call('world.read',{id:'creation-story'})).world.snapshot,migration.snapshot);check('创建副本后原世界未改变',true);
  for(const worldId of ['creation-story','creation-copy'])await core.call('content.migrate.apply',{worldId});
  const copiedContentBeforeBackup=await core.call('content.status',{worldId:'creation-copy'});
  const archivePath=path.join(out,'story-backup.craftmine');
  await core.call('backup.exportPortable',{operationId:'story-backup',archivePath},120000);
  const verified=await core.call('backup.verifyPortable',{archivePath},120000);check('真实完整备份通过内容校验',verified.valid);
  const restoreService=createPortableRestoreService({core,rootDirectory:data});
  const beforeBackupHash=(await core.call('backup.status',{})).currentHash;
  const activated=await restoreService.restore({operationId:'story-restore',archivePath,archiveHash:verified.archiveHash,expectedCurrentHash:beforeBackupHash});
  check('完整备份恢复并激活独立数据目录',activated.activated);
  assert.deepEqual((await core.call('world.read',{id:'creation-story'})).world.snapshot,migration.snapshot);
  assert.deepEqual((await core.call('world.read',{id:'creation-copy'})).world.snapshot,expectedCopy);
  await core.stop();core=new CoreClient(binary,data);await core.start();
  assert.deepEqual((await core.call('world.read',{id:'creation-story'})).world.snapshot,migration.snapshot);
  assert.deepEqual((await core.call('world.read',{id:'creation-copy'})).world.snapshot,expectedCopy);
  assert.equal((await core.call('content.status',{worldId:'creation-copy'})).headOid,copiedContentBeforeBackup.headOid);
  check('恢复后重启服务，两个世界及进度仍完整',true);
} catch(error){report.errors.push(String(error.stack));console.error(error.stack);process.exitCode=1;}
finally{await core?.stop();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log('Evidence: '+out);}
