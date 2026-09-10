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
const {CoreClient}=require('../plugins/craftmine-world/core-client.cjs');
const {materializeBase}=await import(pathToFileURL(path.join(sourceRoot,'desktop/godot/shared/materialize.mjs')));
const sha=value=>createHash('sha256').update(value).digest('hex');
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const out=fs.mkdtempSync(path.join(root,'test-results/creation-story-'));
const project=path.join(out,'project');
const report={kind:'真实引擎造物故事与 Rust 跨重启保存',sourceRoot,out,checks:[],stages:[],limits:['固定作者输入，未调用模型，不能作为首次创作成功率','headless 物理与状态验证，不声称画面、语音或桌面面板验收','验收专用 executor 注册实际导出件，不声称生产沙箱执行器验收'],errors:[]};
let core;
const check=(name,value)=>{report.checks.push({name,passed:!!value});assert.ok(value,name);console.log('PASS '+name);};
try {
  const environment=await createGodotProbeEnvironment(out,{web:true});report.engineVersion=environment.actualVersion;report.runs=environment.runs;
  materializeBase({baseId:'creation-sandbox',worldId:'creation-story',out:project});
  fs.copyFileSync(path.join(root,'tests/fixtures/creation-story.gd'),path.join(project,'story.gd'));
  const source={worldId:'creation-story',buildId:'story-build',instanceId:'story-instance',revision:1,manifestHash:'a'.repeat(64),files:{}};
  for(const name of ['world/creation.json','world/creation-operations.json'])if(fs.existsSync(path.join(project,name))){const text=fs.readFileSync(path.join(project,name),'utf8');source.files[name]={text,sha256:sha(text)};}
  let observation;
  const stage=async(name,restore,buildId='story-build')=>{
    fs.writeFileSync(path.join(project,'story-config.json'),JSON.stringify({stage:name,restore,buildId}));
    await environment.run(name+'-import',['--path',project,'--editor','--import']);
    const stdout=await environment.run(name,['--path',project,'--script','res://story.gd'],{timeout:60000});
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
  apply({action:'place',id:'story-chest',kind:'chest',position:[2,0,4],parameters:{rewardId:'story-token',rewardCount:2}});
  apply({action:'place',id:'story-door',kind:'door',position:[-4,0,2]});
  apply({action:'place',id:'marker-a',kind:'marker',position:[-2,0,4],parameters:{label:'A'}});
  apply({action:'place',id:'marker-b',kind:'marker',position:[-2,0,6],parameters:{label:'B'}});
  apply({action:'sequence-door',ruleId:'story-rule',doorId:'story-door',sequence:['marker-a','marker-b']});
  let played=await stage('play');
  check('造物源码产生实际树、宝箱、门和标记',played.observation.creation.entities.length===5);
  const suppliedBinary=process.env.CRAFTMINE_CORE_BINARY;
  assert.ok(suppliedBinary&&path.isAbsolute(suppliedBinary),'Set CRAFTMINE_CORE_BINARY to a built actual Rust core executable');
  const binary=path.join(out,'craftmine-core.exe');fs.copyFileSync(suppliedBinary,binary);
  report.core={binary,suppliedBinary,sha256:sha(fs.readFileSync(binary))};
  const data=path.join(out,'core-data');fs.mkdirSync(data);
  core=new CoreClient(binary,data);await core.start();
  await core.call('world.create',{id:'creation-story',title:'造物验收',world:{build:{id:'story-build',scene:{format:'craftmine.godot-scene/1',baseId:'creation-sandbox'},godot:{}},snapshot:played.restored,extensions:[]}});
  const exportRoot=path.join(out,'export');fs.mkdirSync(exportRoot);
  fs.writeFileSync(path.join(project,'export_presets.cfg'),`[preset.0]\nname="Web"\nplatform="Web"\nrunnable=true\nexport_filter="all_resources"\ninclude_filter="*.json"\nexclude_filter="story.gd,story-config.json"\n[preset.0.options]\ncustom_template/release=${JSON.stringify(environment.webTemplate.replaceAll('\\','/'))}\nvariant/thread_support=false\nhtml/focus_canvas_on_start=false\n`);
  await environment.run('story-web-export',['--path',project,'--export-release','Web',path.join(exportRoot,'index.html')],{timeout:120000});
  const context={projectId:'story-fixture',sessionId:'story-fixture',turnId:'story-turn'};
  await core.call('workspace.open',{context,selectedWorld:'creation-story'});
  const authoredFiles=fs.readdirSync(project,{recursive:true}).filter(name=>!name.split(/[\\/]/).some(part=>part.startsWith('.'))&&!['story.gd','story-config.json','managed-base.json','export_presets.cfg'].includes(name)&&!name.endsWith('.uid')&&fs.lstatSync(path.join(project,name)).isFile()).map(name=>({path:name.replaceAll('\\','/'),text:fs.readFileSync(path.join(project,name),'utf8')}));
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
} catch(error){report.errors.push(String(error.stack));console.error(error.stack);process.exitCode=1;}
finally{await core?.stop();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log('Evidence: '+out);}
