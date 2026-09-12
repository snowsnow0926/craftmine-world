// Reproduce the real retained formal/main divergence using an isolated domain
// copy. Original player data is opened read-only; no engine/model is launched.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {DatabaseSync,backup} from 'node:sqlite';import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {createCreationSourceMigration} from '../vendor/pi-desktop/apps/desktop/electron/main/creation-source-migration.ts';
const repo=path.resolve(import.meta.dirname,'..');
const sourceProfile=path.resolve(process.argv[2]??'C:/Users/WINDOWS/AppData/Local/CraftmineWorld');
const binary=path.resolve(process.argv[3]??'D:/Craftmine World/vendor/pi-desktop/target/release/craftmine-core.exe');
const worldId=process.argv[4]??'world-e2b39ed23ff7';
fs.mkdirSync(path.join(repo,'test-results'),{recursive:true});
const directory=fs.mkdtempSync(path.join(repo,'test-results/fb03-draft-migration-core-')),domain=path.join(directory,'domain');fs.mkdirSync(domain);
const from=path.join(sourceProfile,'plugins/data/craftmine.world');
assert.notEqual(path.resolve(domain),path.resolve(from));
for(const name of ['content-history','godot-source','godot-builds','asset-catalog','settings.json'])if(fs.existsSync(path.join(from,name)))fs.cpSync(path.join(from,name),path.join(domain,name),{recursive:true,filter:file=>!['LOCK','domain-writer.lock','.craftmine-operation.lock','cache'].includes(path.basename(file))});
const read=new DatabaseSync(path.join(from,'tasks.sqlite'),{readOnly:true});await backup(read,path.join(domain,'tasks.sqlite'));read.close();
const {CoreClient}=createRequire(import.meta.url)('../plugins/craftmine-world/core-client.cjs');
const core=new CoreClient(binary,domain),context={projectId:'fb03-draft-migration',sessionId:'fb03-'+randomUUID(),turnId:randomUUID()};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={format:'craftmine.fb03-retained-draft-migration/1',directory,sourceProfile,worldId,coreSha256:hash(fs.readFileSync(binary)),context,modelCalls:0,engineCalls:0,operations:[],advances:[]};
async function index(){let offset=0,first,files=[];do{const p=await core.call('godotProject.index',{context,worldId,offset,limit:32});first??=p;files.push(...p.files);offset=p.nextOffset;}while(offset!=null);return {...first,files};}
try{
 await core.start();report.worldBefore=await core.call('world.read',{id:worldId});
 report.formalBefore=await core.call('godotRuntime.exportSource',{worldId});
 report.contentBefore=await core.call('content.status',{worldId});
 await core.call('workspace.open',{context,selectedWorld:worldId});
 await core.call('task.recordContext',{context,requestId:'fb03-request',text:'给我生成一个AK47',kind:'request'});
 report.sourceBefore=await index();
 const capture={worldId,buildId:report.formalBefore.buildId,sourceRevision:report.formalBefore.sourceRevision,manifestHash:report.formalBefore.manifestHash};
 const migrate=createCreationSourceMigration({directory:path.join(directory,'records'),resourcesRoot:path.join(repo,'desktop/godot'),domain:async(method,args)=>{
   if(method==='godotProject.patch')report.operations.push(...args.operations.map(op=>({path:op.path,expectedHash:op.expectedHash,sha256:hash(op.text),bytes:Buffer.byteLength(op.text)})));
   return core.call(method,args);
 },assertActive:async()=>{const formal=await core.call('godotRuntime.exportSource',{worldId});assert.equal(formal.buildId,capture.buildId);assert.equal(formal.contentOid,report.formalBefore.contentOid);},recordAdvance:(_context,_capture,advance)=>report.advances.push(advance)});
 report.advance=await migrate(context,capture);report.sourceAfter=await index();
 const changed=new Set(report.operations.map(op=>op.path));assert.ok(changed.size>0);
 for(const file of report.sourceBefore.files)if(!changed.has(file.path))assert.deepEqual(report.sourceAfter.files.find(f=>f.path===file.path),file,'unmodified draft '+file.path);
 for(const name of ['scripts/pomeranian_pet.gd','scenes/creation.tscn']){const file=report.sourceBefore.files.find(f=>f.path===name);assert.ok(file,'real retained pet draft');assert.deepEqual(report.sourceAfter.files.find(f=>f.path===name),file);}
 const formalGround=report.formalBefore.files.find(f=>f.path==='scripts/creation_world.gd');assert.equal(report.sourceAfter.files.find(f=>f.path===formalGround.path).sha256,formalGround.sha256,'already-adopted ground remains current');
 report.formalAfter=await core.call('godotRuntime.exportSource',{worldId});report.worldAfter=await core.call('world.read',{id:worldId});
 assert.deepEqual(report.formalAfter,report.formalBefore);assert.deepEqual(report.worldAfter,report.worldBefore);
 report.contentAfter=await core.call('content.status',{worldId});
 assert.equal(report.contentAfter.appliedOid,report.contentBefore.appliedOid);
 report.recovered=await migrate(context,capture);assert.equal(report.recovered.revision,report.advance.revision);assert.equal((await index()).content.contentOid,report.sourceAfter.content.contentOid);
 await core.call('workspace.endTurn',{sessionId:context.sessionId,turnId:context.turnId,status:'completed'});
 report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}finally{await core.stop();fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({directory,passed:report.passed,error:report.error,operations:report.operations}));}
