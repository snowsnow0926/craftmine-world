// Fresh private Rust database + real packaged tool/domain implementation; zero model/engine calls.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),binary=process.env.CRAFTMINE_CORE_BIN;assert.ok(binary&&path.isAbsolute(binary),'Explicit current CRAFTMINE_CORE_BIN required');
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});const out=fs.mkdtempSync(path.join(root,'test-results/godot-generic-core-')),plugin=path.join(out,'plugin'),ownedCore=path.join(out,'craftmine-core.exe');fs.copyFileSync(binary,ownedCore);
execFileSync(process.execPath,[path.join(root,'desktop/build-world-plugin.mjs'),'--output',plugin],{cwd:root,windowsHide:true,stdio:'pipe'});
const require=createRequire(import.meta.url),{CoreClient}=require(path.join(plugin,'core-client.cjs')),{createWorldTools}=require(path.join(plugin,'world-tools.cjs'));
const core=new CoreClient(ownedCore,path.join(out,'data')),context={projectId:'routing-project',sessionId:'routing-session',turnId:'routing-turn'},worldId='routing-world';
const report={format:'craftmine.godot-generic-read-core/1',out,coreSha256:createHash('sha256').update(fs.readFileSync(ownedCore)).digest('hex'),implementationHashes:Object.fromEntries(['world-tools.cjs','godot-generic-read.cjs','manifest.json'].map(name=>[name,createHash('sha256').update(fs.readFileSync(path.join(plugin,name))).digest('hex')])),checks:[],modelRequests:0,passed:false};
const check=(name,ok)=>{report.checks.push({name,passed:!!ok});assert.ok(ok,name);};
try{
 report.hello=await core.start();const initial=JSON.parse(fs.readFileSync(path.join(root,'desktop/godot/shared/initial-states/creation-sandbox-blank.json'),'utf8')).snapshot;initial.worldId=worldId;initial.body.worldId=worldId;
 await core.call('world.create',{id:worldId,title:'Generic read routing fixture',world:{build:{id:'base-creation',scene:{format:'craftmine.godot-scene/1',baseId:'creation-sandbox'},godot:{}},snapshot:initial,extensions:[]}});
 const workspace=await core.call('workspace.open',{context,selectedWorld:worldId});
 const source=await core.call('godotProject.create',{context,worldId,baseBuild:workspace.task.binding.baseBuild,baseId:'creation-sandbox',toolCallId:'setup-source',files:[{path:'project.godot',text:'config_version=5\n[application]\nconfig/name="Generic reader probe"\n'}]});
 const tools=createWorldTools(core,async()=>({activeWorldId:worldId}),()=>false),call=name=>tools.find(tool=>tool.name===name).execute({}, {...context,toolCallId:'read-'+name,executionId:'read-execution'});
 const inspected=await call('project_inspect');report.inspected=inspected;
 check('actual Rust Godot workspace reaches the generic project reader',inspected.runtimeKind==='godot'&&inspected.baseId==='creation-sandbox'&&inspected.project.revision===source.revision&&inspected.project.manifestHash===source.manifestHash&&inspected.project.files.some(file=>file.path==='project.godot'));
 check('Godot inspection never manufactures legacy resources',!Object.hasOwn(inspected,'objects')&&!Object.hasOwn(inspected,'resources'));
 const capabilities=await call('capabilities_read');report.capabilities=capabilities;const contract=JSON.parse(capabilities.text);
 check('actual core capability flags and source identity reach generic capabilities',contract.runtimeKind==='godot'&&contract.project.manifestHash===source.manifestHash&&contract.tools.find(tool=>tool.name==='godot_project_index')?.reachable===true);
 const after=await core.call('godotProject.index',{context,worldId,limit:1});check('generic reads do not modify the source revision or manifest',after.revision===source.revision&&after.manifestHash===source.manifestHash);report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}finally{await core.stop();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.passed,checks:report.checks,error:report.error}));}
