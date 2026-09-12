// Real Rust ownership reads after workspace.endTurn, copied generated content.
// Does not claim a new application transaction; the final package live test does.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {DatabaseSync,backup} from 'node:sqlite';import {createRequire} from 'node:module';import {createHash,randomUUID} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),sourceFile=path.resolve(process.argv[2]??'');assert.ok(process.argv[2]);
const source=JSON.parse(fs.readFileSync(sourceFile,'utf8'));assert.equal(source.format,'craftmine.fb02-ordinary-player/1');
const from=path.join(source.profile,'plugins/data/craftmine.world');assert.ok(from.startsWith(path.join(root,'test-results')+path.sep));
const directory=fs.mkdtempSync(path.join(root,'test-results/creation-after-turn-core-')),domain=path.join(directory,'domain');fs.mkdirSync(domain);
for(const name of ['content-history','godot-source','godot-builds','asset-catalog','settings.json'])if(fs.existsSync(path.join(from,name)))fs.cpSync(path.join(from,name),path.join(domain,name),{recursive:true,filter:file=>!file.endsWith('.lock')});
const db=new DatabaseSync(path.join(from,'tasks.sqlite'),{readOnly:true});await backup(db,path.join(domain,'tasks.sqlite'));db.close();
const binary=path.join(root,'vendor/pi-desktop/target/release/craftmine-core.exe'),require=createRequire(import.meta.url),{CoreClient}=require('../plugins/craftmine-world/core-client.cjs');
const core=new CoreClient(binary,domain),context=source.latest.automatic.context,worldId=source.worldId,jobId=source.latest.application.jobId;
const report={directory,sourceFile,coreSha256:createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),context,worldId,jobId};
try{
 await core.start();report.worldBefore=await core.call('world.read',{id:worldId});
 report.job=await core.call('godotBuild.read',{context,worldId,jobId});assert.equal(report.job.status,'passed');
 report.originalWorkspace=await core.call('workspace.inspect',{context});assert.equal(report.originalWorkspace.task.status,'finished');
 report.originalIndex=await core.call('godotProject.index',{context,worldId,branchId:report.job.branchId??'main',offset:0,limit:1});
 assert.equal(report.originalIndex.currentTaskId,report.job.taskId);
 await core.call('workspace.endTurn',{sessionId:context.sessionId,turnId:context.turnId,status:'completed'});
 report.originalAfter=await core.call('godotProject.index',{context,worldId,offset:0,limit:1});assert.equal(report.originalAfter.currentTaskId,report.job.taskId);
 const next={projectId:'read-after-end',sessionId:'core-proof-'+randomUUID(),turnId:randomUUID()};report.nextContext=next;
 report.opened=await core.call('workspace.open',{context:next,selectedWorld:worldId});
 report.activeIndex=await core.call('godotProject.index',{context:next,worldId,offset:0,limit:1});assert.equal(report.activeIndex.currentTaskId,report.opened.task.binding.taskId);
 await core.call('workspace.endTurn',{sessionId:next.sessionId,turnId:next.turnId,status:'completed'});
 report.finishedWorkspace=await core.call('workspace.inspect',{context:next});report.finishedIndex=await core.call('godotProject.index',{context:next,worldId,offset:0,limit:1});
 assert.equal(report.finishedWorkspace.task.status,'finished');assert.equal(report.finishedIndex.currentTaskId,report.opened.task.binding.taskId);
 assert.equal(report.finishedIndex.manifestHash,report.activeIndex.manifestHash);assert.equal(report.finishedIndex.revision,report.activeIndex.revision);
 const read=new DatabaseSync(path.join(domain,'tasks.sqlite'),{readOnly:true});report.finishedLeases=read.prepare('SELECT COUNT(*) AS count FROM craftmine_world_leases WHERE task_id=?').get(report.opened.task.binding.taskId).count;read.close();assert.equal(report.finishedLeases,0);
 report.worldAfter=await core.call('world.read',{id:worldId});assert.deepEqual(report.worldAfter,report.worldBefore);report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}finally{await core.stop();fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({directory,passed:report.passed,error:report.error}));}
