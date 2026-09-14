// Real Rust catalog, task, source CAS and check job; no engine, model or UI.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {CoreClient} from '../plugins/craftmine-world/core-client.cjs';
import {packStaticPackage} from '../plugins/craftmine-world/package-zip.mjs';
import {contentHash} from '../plugins/craftmine-world/package-format.mjs';
import {createAuthorSourceInstaller} from '../plugins/craftmine-world/author-source-install.mjs';
const {createSourceLibraryService}=createRequire(import.meta.url)('../plugins/craftmine-world/source-library-service.cjs');
const root=path.resolve(import.meta.dirname,'..'),binary=process.env.CRAFTMINE_CORE_BIN;
const hash=value=>createHash('sha256').update(value).digest('hex');
const context={projectId:'author-project',sessionId:'author-session',turnId:'author-turn'},worldId='author-world';
const writeMethods=['content.migrate.apply','package.planInstall','godotProject.applyFiles','godotBuild.start'];
async function fixture(t){
 const results=path.join(root,'test-results');await fs.mkdir(results,{recursive:true});
 const directory=await fs.mkdtemp(path.join(results,'author-source-core-'));
 const core=new CoreClient(binary,path.join(directory,'data'));
 const state={capture:{worldId,autoApply:true,authorization:'full-auto'},selected:worldId,ended:false,calls:[],enqueued:[]};
 const evidence={format:'craftmine.author-source-install-core/1',binary,coreSha256:hash(await fs.readFile(binary)),limits:['Permission/selection are explicit host fixtures; cancellation and foreign-world tests additionally use real Core APIs.','The actual Core creates the check job with its real unavailable-executor state.','No engine rendering, model invocation, candidate adoption or user profile is involved.'],checks:[]};
 const call=async(method,args)=>{const entry={method,args};state.calls.push(entry);try{const result=await core.call(method,args,120000);entry.succeeded=true;return result;}catch(error){entry.succeeded=false;entry.error=error.errorCode??error.code??error.message;throw error;}};
 t.after(async()=>{await core.stop();evidence.calls=state.calls.map(c=>({method:c.method,succeeded:c.succeeded,...(c.error?{error:c.error}:{}),...(c.args.context?{context:c.args.context}:{}),...(c.args.worldId?{worldId:c.args.worldId}:{})}));await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(evidence,null,2)+'\n');console.log('Evidence: '+path.join(directory,'report.json'));});
 await core.start();
 const initial=JSON.parse(await fs.readFile(path.join(root,'desktop/godot/shared/initial-states/creation-sandbox-blank.json'),'utf8')).snapshot;
 initial.worldId=worldId;initial.body.worldId=worldId;
 await call('world.create',{id:worldId,title:'Author install Core fixture',world:{build:{id:'base-author',scene:{format:'craftmine.godot-scene/1',baseId:'creation-sandbox'},godot:{}},snapshot:initial,extensions:[]}});
 const workspace=await call('workspace.open',{context,selectedWorld:worldId});
 await call('godotProject.create',{context,worldId,toolCallId:'setup-source',baseBuild:workspace.task.binding.baseBuild,baseId:'creation-sandbox',files:[
  {path:'project.godot',text:'config_version=5\n[application]\nrun/main_scene="res://world.tscn"\n'},
  {path:'world.tscn',text:'[gd_scene format=3]\n[node name="World" type="Node3D"]\n[node name="ExistingDog" type="Node3D" parent="."]\nmetadata/entity_id = "existing-dog"\n'}]});
 await call('content.migrate.apply',{worldId});
 const files={'pet.gd':Buffer.from('extends Node3D\n@export var entity_id: String = ""\n'),'pet.gd.uid':Buffer.from('uid://bauthorpet\n')};
 const content={assetId:'pet',version:1,kind:'object',files:Object.entries(files).map(([path,bytes])=>({path,bytes:bytes.length,sha256:hash(bytes)})),dependencies:[],entry:{entities:['pet'],sceneInstall:{mode:'script-node',script:'pet.gd',nodeType:'Node3D',identityField:'entity_id'}},interfaces:{},compatibility:{},state:{},licenses:{}};
 const archive=packStaticPackage({root:{id:'pet',version:1},resources:[{manifest:{format:'craftmine.resource/1',content,contentHash:contentHash(content)},files}]});
 const sourcePath=path.join(directory,'pet.zip');await fs.writeFile(sourcePath,archive);
 await call('asset.import',{operationId:'seed-author-pet',sourceRoot:directory,sourcePath,assetId:'fixture.pet',version:1,kind:'object',mediaKind:'package',path:'pet.zip',mediaType:'application/x-godot-package',displayName:'Pet contract fixture',source:{origin:'fixture',author:'test',license:'CC0-1.0',licenseStatus:'verified'},tags:['fixture']});
 const asset=await call('asset.read',{assetId:'fixture.pet',version:1}),ref={assetId:'fixture.pet',version:1,contentHash:asset.version_.contentHash};
 const installer=createAuthorSourceInstaller({call,authorize:async received=>{assert.deepEqual(received,context);return state.capture;},selected:async()=>state.selected,stagingRoot:path.join(directory,'author-installs'),enqueue:async(job,owner)=>{state.enqueued.push({job,owner});return {enqueued:true,jobId:job.jobId};}});
 const service=createSourceLibraryService({call,directory:path.join(directory,'proposals'),installSource:async()=>assert.fail('Must not open a separate manual installation'),installAuthorSource:installer});
 const assertActive=()=>{if(state.ended)throw Error('TURN_ENDED');};
 return {core,call,state,evidence,ref,workspace,installer,service,run:(args,id='fixed-author-call')=>service.tool(args,context,worldId,id,assertActive)};
}
for(const group of [false,true])test(`real Core ${group?'group':'single'} author installation retains task ownership and immutable replay`,{skip:!binary},async t=>{
 const f=await fixture(t),before=await f.call('godotProject.index',{context,worldId,limit:32});
 const args=group?{mode:'install-group',items:[{ref:f.ref,position:{x:3,y:0,z:-4}},{ref:f.ref,position:{x:-3,y:0,z:-4}}]}:{mode:'install',ref:f.ref,position:{x:3,y:0,z:-4}};
 const begin=f.state.calls.length,result=await f.run(args),after=await f.call('godotProject.index',{context,worldId,limit:32});
 assert.equal(result.applied,false);assert.equal(after.revision,before.revision+1);assert.equal(after.currentTaskId,before.currentTaskId);
 assert.equal(result.instanceIds.length,group?2:1);assert.equal(new Set(result.instanceIds).size,result.instanceIds.length);
 const scene=await f.call('godotProject.read',{context,worldId,revision:after.revision,manifestHash:after.manifestHash,path:'world.tscn',offset:0,limit:16000});
 assert.match(scene.text,/name="ExistingDog"/);assert.match(scene.text,/existing-dog/);assert.match(scene.text,/position = Vector3\(3, 0, -4\)/);
 if(group)assert.match(scene.text,/position = Vector3\(-3, 0, -4\)/);
 for(const id of result.instanceIds)assert.match(scene.text,new RegExp(id));
 const job=await f.call('godotBuild.read',{worldId,jobId:result.jobId});
 assert.equal(job.taskId,before.currentTaskId);assert.equal(job.worldId,worldId);assert.equal(job.sourceRevision,after.revision);assert.equal(job.manifestHash,after.manifestHash);assert.equal(job.kind,'check');
 assert.equal(job.status,'blocked','No executor is registered: an actual Core blocked job is required, never a fabricated pass');assert.equal(f.state.enqueued.length,0);
 const replay=await f.run(args);assert.deepEqual(replay,result);
 const events=f.state.calls.slice(begin);
 for(const method of ['godotProject.applyFiles','godotBuild.start']){
  const calls=events.filter(c=>c.method===method);assert.equal(calls.length,1);assert.deepEqual(calls[0].args.context,context);
 }
 assert.equal(events.some(c=>/workspace.open|workspace.endTurn|turn.begin|package.install|godotApplication/.test(c.method)),false);
 const unchanged=await f.call('godotProject.index',{context,worldId,limit:1});assert.equal(unchanged.revision,after.revision);assert.equal(unchanged.manifestHash,after.manifestHash);
 await assert.rejects(f.run(group?{...args,items:[...args.items].reverse()}:{...args,position:{x:4,y:0,z:-4}}),/SOURCE_LIBRARY_PROPOSAL_CONFLICT/);
 f.evidence.checks.push({group,passed:true,taskId:job.taskId,sourceBefore:{revision:before.revision,manifestHash:before.manifestHash},sourceAfter:{revision:after.revision,manifestHash:after.manifestHash},jobId:job.jobId,jobStatus:job.status,jobReason:job.reason,instanceIds:result.instanceIds,originalEntityPreserved:true,replayAddedNoWrites:true});
});
test('real Core author source cannot mutate after host cancellation, permission revoke or world change',{skip:!binary},async t=>{
 const f=await fixture(t),before=await f.call('godotProject.index',{context,worldId,limit:1});
 const reset=()=>{f.state.ended=false;f.state.selected=worldId;f.state.capture={worldId,autoApply:true,authorization:'full-auto'};};
 for(const [name,change]of [['cancel',()=>f.state.ended=true],['permission',()=>f.state.capture.autoApply=false],['selection',()=>f.state.selected='other-world'],['capture',()=>f.state.capture.worldId='other-world']]){
  reset();change();const begin=f.state.calls.length;
  await assert.rejects(f.run({mode:'install',ref:f.ref},'refused-'+name));
  assert.equal(f.state.calls.slice(begin).some(c=>writeMethods.includes(c.method)),false);f.evidence.checks.push({name,passed:true,noCoreMutation:true});
 }
 reset();const after=await f.call('godotProject.index',{context,worldId,limit:1});assert.equal(after.revision,before.revision);assert.equal(after.manifestHash,before.manifestHash);
 const otherWorld='other-world',record=await f.call('world.read',{id:worldId}),document=structuredClone(record.world);
 document.build.id='base-other';document.snapshot.worldId=otherWorld;document.snapshot.body.worldId=otherWorld;
 await f.call('world.create',{id:otherWorld,title:'Foreign target fixture',world:document});
 f.state.selected=otherWorld;f.state.capture.worldId=otherWorld;
 const begin=f.state.calls.length;
 await assert.rejects(f.service.tool({mode:'install',ref:f.ref},context,otherWorld,'core-foreign-world'),/PROJECT_WORLD_BINDING_MISMATCH/);
 assert.equal(f.state.calls.slice(begin).some(c=>writeMethods.includes(c.method)),false);
 f.evidence.checks.push({name:'real-Core-foreign-world',passed:true,noCoreMutation:true});
});
test('actual Core ended-turn fence prevents installation even when a stale host capture still grants full-auto',{skip:!binary},async t=>{
 const f=await fixture(t);
 const before=await f.call('godotProject.index',{context,worldId,limit:1});
 await f.call('workspace.endTurn',{sessionId:context.sessionId,turnId:context.turnId,status:'aborted'});
 const begin=f.state.calls.length;
 await assert.rejects(f.run({mode:'install',ref:f.ref},'durably-ended-author'),/TASK_INACTIVE/);
 const attempted=f.state.calls.slice(begin).filter(c=>c.method==='godotProject.applyFiles');
 assert.equal(attempted.length,1);assert.equal(attempted[0].succeeded,false);assert.equal(attempted[0].error,'TASK_INACTIVE');
 assert.equal(f.state.calls.slice(begin).some(c=>c.method==='godotBuild.start'),false);
 const after=await f.call('godotProject.index',{context,worldId,limit:1});assert.equal(after.revision,before.revision);assert.equal(after.manifestHash,before.manifestHash);
 f.evidence.checks.push({name:'real-Core-ended-turn',passed:true,sourceUnchanged:true,writeRejected:'TASK_INACTIVE',checkNotCreated:true});
});
