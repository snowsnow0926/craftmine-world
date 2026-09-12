// Real Core + actual Kenney ZIP/source transactions. Live references are
// explicitly synthetic host fixtures: no engine, physical hit, player or model.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {CoreClient} from '../../plugins/craftmine-world/core-client.cjs';
import {createManagedPackageInstaller} from '../../plugins/craftmine-world/reuse-service.mjs';
import {materializeBase} from '../../desktop/godot/shared/materialize.mjs';
import {parseScene} from '../../desktop/godot/shared/scene_materializer.mjs';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'../..');
const hash=b=>createHash('sha256').update(b).digest('hex');
const binary=process.env.CRAFTMINE_CORE_BIN;
if(!binary)throw Error('CRAFTMINE_CORE_BIN required');
const pluginRoot=process.env.CRAFTMINE_MODULE_PLUGIN_ROOT;
const loaderPath=process.env.CRAFTMINE_MODULE_QUERY_LOADER||path.join(root,'plugins/craftmine-world/godot-module-parameter-query.cjs');
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const out=fs.mkdtempSync(path.join(root,'test-results/module-parameters-core-'));
const report={format:'craftmine.module-parameters-core/1',out,coreBinary:binary,coreSha256:hash(fs.readFileSync(binary)),
 scope:'real Core and existing ZIP installer; synthetic host capture/live refs; no engine/model/player/physical/candidate/apply/cold-runtime claim',
 engineCalls:0,modelCalls:0,checks:[],installs:[],queries:[],pluginRoot:pluginRoot??null};
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
save();console.log('EVIDENCE_DIRECTORY='+out);
const check=(ok,label)=>{report.checks.push({passed:!!ok,label});save();assert.ok(ok,label);};
const core=new CoreClient(binary,path.join(out,'data')),context={projectId:'module-query-project',sessionId:'module-query-session',turnId:'source-test'},worldId='module-query-world';
let phase='setup',queryActive=false,capture,trace=[],settingsReads=0,installer,toolList;
const call=async(method,params)=>{
 if(queryActive)assert.ok(['task.context','godotProject.index','godotProject.read'].includes(method),'query must not call '+method);
 const record={method,...(params.path?{path:params.path}:{}),...(params.offset!==undefined?{offset:params.offset}:{}),...(params.limit!==undefined?{limit:params.limit}:{}),phase};
 if(queryActive)trace.push(record);
 const result=await core.call(method,params,60000);
 if(queryActive&&method==='godotProject.index')Object.assign(record,{totalFiles:result.totalFiles,files:result.files.length,nextOffset:result.nextOffset});
 return result;
};
const indexAll=async()=>{
 let offset=0,first;const files=[];
 do{const page=await call('godotProject.index',{context,worldId,offset,limit:32,...(first?{revision:first.revision,manifestHash:first.manifestHash}:{})});first??=page;assert.equal(page.manifestHash,first.manifestHash);files.push(...page.files);offset=page.nextOffset;}while(offset!=null);
 return {...first,files};
};
const readText=async(index,name)=>{
 let offset=0,text='';
 do{const part=await call('godotProject.read',{context,worldId,revision:index.revision,manifestHash:index.manifestHash,path:name,offset,limit:16000});text+=part.text;offset=part.nextOffset;}while(offset!=null);
 assert.equal(hash(text),index.files.find(file=>file.path===name).sha256);return text;
};
const snapshotCapture=(index,entityId)=>{
 const target={objectId:'101',nodePath:entityId,nodeClass:'StaticBody3D',scriptPath:'res://addons/kenney-city-building/module.gd',scenePath:'res://addons/kenney-city-building/module.tscn',position:[-4,.5,-4],normal:[0,0,1],ancestors:[],identityScope:'runtime-instance',sourceUse:'context-only'};
 return {format:'craftmine.creation-target/1',snapshotId:'synthetic-capture',worldId,buildId:'synthetic-not-running-build',instanceId:'synthetic-not-running-instance',sourceRevision:index.revision,manifestHash:index.manifestHash,sceneObjectTarget:target,synthetic:true};
};
const sample=async()=>({worldId,buildId:capture.buildId,instanceId:capture.instanceId,sampledAt:new Date().toISOString(),baseId:'creation-sandbox',creation:{sceneObjectRefs:[structuredClone(capture.sceneObjectTarget)]},synthetic:true});
let directQuery;
async function query(args,label){
 phase=label;trace=[];queryActive=true;
 try{
  const result=pluginRoot?await toolList.find(tool=>tool.name==='godot_project_query').execute(args,{...context,toolCallId:label,executionId:'execute-'+label}):await directQuery({context,args});
  report.queries.push({label,args,trace:structuredClone(trace),result});save();return result;
 }finally{queryActive=false;}
}
async function patch(index,operations,toolCallId){
 phase='ordinary-patch';
 if(pluginRoot)return toolList.find(tool=>tool.name==='godot_project_patch').execute({revision:index.revision,manifestHash:index.manifestHash,operations},{...context,toolCallId,executionId:'execute-'+toolCallId});
 const status=await call('content.status',{worldId});
 return call('godotProject.patch',{context,worldId,toolCallId,revision:index.revision,manifestHash:index.manifestHash,operations,operation:{operationId:'patch-'+toolCallId,worldId,repoId:status.repoId,branchId:'main',expectedHeadOid:status.headOid,expectedAppliedOid:null,expectedProgressRevision:null}});
}
try{
 await core.start();
 const base=path.join(out,'base');materializeBase({baseId:'creation-sandbox',worldId,out:base});
 const files=fs.readdirSync(base,{recursive:true}).map(name=>name.split(path.sep).join('/')).filter(name=>fs.statSync(path.join(base,name)).isFile()&&name!=='managed-base.json').map(name=>{
  const bytes=fs.readFileSync(path.join(base,name)),text=bytes.toString('utf8');assert.ok(Buffer.from(text).equals(bytes));return{path:name,text};
 });
 files.find(file=>file.path==='scenes/creation.tscn').text+='\n'+Array.from({length:100},(_,i)=>'; bounded paging fixture '+i+' '+'.'.repeat(210)).join('\n')+'\n';
 for(let i=0;i<40;i++)files.push({path:'audit/padding-'+String(i).padStart(2,'0')+'.json',text:'{}\n'});
 await call('world.create',{id:worldId,title:'Synthetic module query source fixture',world:{build:{id:'base-a',scene:{format:'craftmine.scene/3',objects:[]}},snapshot:{format:'craftmine.progress/1',baseVersion:'1.0.0',player:{x:.5,y:7.6,z:.5,yaw:0,pitch:0}},extensions:[]}});
 await call('workspace.open',{context,selectedWorld:worldId});
 const first=[files.find(file=>file.path==='project.godot'),...files.filter(file=>file.path!=='project.godot').slice(0,15)];
 let pin=await call('godotProject.create',{context,worldId,toolCallId:'create-base',baseBuild:'base-a',baseId:'creation-sandbox',files:first});
 const remaining=files.filter(file=>!first.some(value=>value.path===file.path));
 for(let offset=0;offset<remaining.length;offset+=16)pin=await call('godotProject.patch',{context,worldId,toolCallId:'complete-base-'+offset,revision:pin.revision,manifestHash:pin.manifestHash,operations:remaining.slice(offset,offset+16).map(file=>({op:'put',...file,expectedHash:null}))});
 await call('content.migrate.apply',{worldId});
 installer=createManagedPackageInstaller({call,stagingRoot:path.join(out,'installer'),bind:async(worldId,operationId)=>{
  const status=await call('content.status',{worldId}),worldRecord=await call('world.read',{id:worldId});
  return{context,worldRecord,operation:{operationId,worldId,repoId:status.repoId,branchId:'main',expectedHeadOid:status.headOid,expectedAppliedOid:status.appliedOid,expectedProgressRevision:worldRecord.revision}};
 },enqueue:async()=>assert.fail('no executor registered; must stay blocked')});
 const zip=fs.readFileSync(path.join(root,'docs/evidence/gu6-kenney-modules-20260912/building.zip'));report.zipSha256=hash(zip);
 for(const name of ['first','second']){
  const result=await installer({worldId,operationId:'install-building-'+name,archiveBase64:zip.toString('base64')});report.installs.push(result);
  check(result.status==='source-saved-check-blocked'&&result.job.status==='blocked'&&result.applied===false,'actual source install '+name+' recorded, engine check explicitly blocked');
 }
 let index=await indexAll(),registry=JSON.parse(await readText(index,'craftmine.instances.json'));
 assert.equal(registry.instances.length,2);const [a,b]=registry.instances.map(item=>item.entityMap.building);
 check(a!==b,'two real installer entity maps have independent identities');
 capture=snapshotCapture(index,a);report.syntheticCapture=structuredClone(capture);report.initialSource={revision:index.revision,manifestHash:index.manifestHash,files:index.files};
 if(pluginRoot){
  const {createWorldTools}=require(path.join(pluginRoot,'world-tools.cjs'));
  report.packedFiles=Object.fromEntries(['world-tools.cjs','godot-module-parameter-query.cjs','godot-module-parameters.mjs','manifest.json'].map(name=>[name,hash(fs.readFileSync(path.join(pluginRoot,name)))]));
  toolList=createWorldTools({start:()=>core.start(),call},async()=>{settingsReads++;if(queryActive)assert.fail('read-only query must not read settings');return{activeWorldId:worldId};},()=>false,undefined,undefined,{creationTarget:async()=>structuredClone(capture),sampleLiveState:sample});
 }else{
  const bytes=fs.readFileSync(loaderPath),copied=path.join(out,'query-loader.cjs');fs.writeFileSync(copied,bytes);report.loaderSha256=hash(bytes);report.loaderPath=loaderPath;
  directQuery=require(copied).createModuleParameterQuery({core:{call},capture:async()=>structuredClone(capture),sample,loadHelper:()=>import(pathToFileURL(path.join(root,'plugins/craftmine-world/godot-module-parameters.mjs')).href)});
 }
 const captured=await query({mode:'module-parameters'},'capture');
 check(captured.binding.entityId===a&&captured.values.model_scale_percent===100,'real indexed instance source values captured');
 const traceCapture=report.queries.at(-1).trace;
 check(traceCapture.some(row=>row.method==='godotProject.index'&&row.offset>=32),'actual full source index crossed page boundary');
 check(traceCapture.some(row=>row.method==='godotProject.read'&&row.path==='scenes/creation.tscn'&&row.offset>=16000),'actual parent scene read crossed chunk boundary');
 check(!traceCapture.some(row=>row.method==='godotProject.read'&&/\.(glb|png)$/.test(row.path)),'query loaded only required text, no GLB/texture bytes');
 const preview=await query({mode:'module-parameter-preview',bindingHash:captured.binding.bindingHash,changes:{model_scale_percent:250,quarter_turns:1,solid:false,label:'persisted-source-A'}},'preview');
 check(preview.applied===false&&preview.operations.length===1&&preview.operations[0].path==='scenes/creation.tscn','preview emits one ordinary parent source patch only');
 const noOp=await query({mode:'module-parameter-preview',bindingHash:captured.binding.bindingHash,changes:{model_scale_percent:100}},'no-op');
 check(noOp.operations.length===0&&noOp.changed===false&&noOp.checkRequired===false,'same-value preview does not invent a write or required check');
 check(settingsReads===0,'query modes did not read settings or open workspace');
 const before=await readText(index,'scenes/creation.tscn'),peerBefore=parseScene(before).nodes.find(node=>node.name===b).lines;
 report.patch=await patch(index,preview.operations,'apply-proposed-instance-parameters');
 let after=await indexAll(),afterText=await readText(after,'scenes/creation.tscn'),nodes=parseScene(afterText).nodes;
 const aNode=nodes.find(node=>node.name===a),bNode=nodes.find(node=>node.name===b);
 check(aNode.properties.model_scale_percent==='250'&&aNode.properties.quarter_turns==='1'&&aNode.properties.solid==='false'&&aNode.properties.label==='"persisted-source-A"','ordinary Core patch changed A authored source parameters');
 check(JSON.stringify(bNode.lines)===JSON.stringify(peerBefore),'peer B parent block unchanged');
 const changed=index.files.filter(file=>after.files.find(next=>next.path===file.path)?.sha256!==file.sha256).map(file=>file.path);
 check(JSON.stringify(changed)===JSON.stringify(['scenes/creation.tscn'])&&after.files.length===index.files.length,'only parent source file changed; registry, lock and all shared payload unchanged');
 phase='stale-source';await assert.rejects(query({mode:'module-parameters'},'stale-source'),/MODULE_CAPTURE_SOURCE_STALE/);check(true,'stale source capture rejected after ordinary patch');
 capture=snapshotCapture(after,a);
 await assert.rejects(query({mode:'module-parameter-preview',bindingHash:captured.binding.bindingHash,changes:{solid:true}},'stale-binding'),/MODULE_PARAMETER_BINDING_CHANGED/);check(true,'old preview binding rejected after refreshed source capture');
 const refreshed=await query({mode:'module-parameters'},'refreshed-capture');
 check(refreshed.values.model_scale_percent===250&&refreshed.values.solid===false,'fresh synthetic capture reads persisted source overrides');
 await core.stop();await core.start();
 const reopened=await query({mode:'module-parameters'},'core-reopened-capture');
 const sameLabel=await query({mode:'module-parameter-preview',bindingHash:reopened.binding.bindingHash,changes:{label:reopened.values.label}},'core-reopened-label-noop');
 check(sameLabel.operations.length===0&&sameLabel.changed===false&&sameLabel.checkRequired===false,'same label after actual Core restart produces no source write or job');
 report.finalSource={revision:after.revision,manifestHash:after.manifestHash,files:after.files};
 report.formalWorld=await call('world.read',{id:worldId});check(report.formalWorld.world.build.id==='base-a','formal runnable build was never adopted by this source test');
 if(pluginRoot)for(const [name,digest]of Object.entries(report.packedFiles))assert.equal(hash(fs.readFileSync(path.join(pluginRoot,name))),digest,'packed artifact changed during test: '+name);
 report.passed=true;save();console.log(JSON.stringify({passed:true,out,checks:report.checks.length,engineCalls:0,modelCalls:0,entry:pluginRoot?'packed-createWorldTools':'copied-root-loader'}));
}catch(error){report.error={message:error.message,code:error.errorCode??error.code,phase};save();throw error;}
finally{await installer?.drain();await core.stop();}
