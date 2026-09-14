import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const {createAuthorSourceInstaller}=await import(process.env.CRAFTMINE_AUTHOR_INSTALL_MODULE?pathToFileURL(path.resolve(process.env.CRAFTMINE_AUTHOR_INSTALL_MODULE)).href:new URL('../plugins/craftmine-world/author-source-install.mjs',import.meta.url).href);
import {packStaticPackage} from '../plugins/craftmine-world/package-zip.mjs';
import {contentHash} from '../plugins/craftmine-world/package-format.mjs';

const hash=x=>createHash('sha256').update(x).digest('hex');
const context={projectId:'project-one',sessionId:'session-one',turnId:'turn-one'};
async function fixture(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'author-install-'));
  t.after(async()=>{assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('author-install-'));await fs.rm(directory,{recursive:true,force:true});});
  const files={'pet.gd':Buffer.from('extends Node3D\n@export var entity_id: String = ""\n'),'pet.gd.uid':Buffer.from('uid://bauthorpet\n')};
  const content={assetId:'pet',version:1,kind:'object',files:Object.entries(files).map(([path,bytes])=>({path,bytes:bytes.length,sha256:hash(bytes)})),dependencies:[],entry:{entities:['pet'],sceneInstall:{mode:'script-node',script:'pet.gd',nodeType:'Node3D',identityField:'entity_id'}},interfaces:{},compatibility:{},state:{},licenses:{}};
  const archive=packStaticPackage({root:{id:'pet',version:1},resources:[{manifest:{format:'craftmine.resource/1',content,contentHash:contentHash(content)},files}]});
  const sources={'project.godot':'[application]\nrun/main_scene="res://world.tscn"\n','world.tscn':'[gd_scene format=3]\n[node name="World" type="Node3D"]\n[node name="ExistingDog" type="Node3D" parent="."]\nentity_id = "existing-dog"\n'};
  const state={capture:{worldId:'world-one',autoApply:true,authorization:'full-auto'},selected:'world-one',boundWorld:'world-one',ended:false,revokeAt:null,calls:[],enqueued:[]};
  const call=async(method,args)=>{
    state.calls.push({method,args});if(state.revokeAt===method)state.capture.autoApply=false;
    if(method==='task.context')return {world:{id:state.boundWorld}};
    if(method==='world.read')return {id:'world-one',runtimeKind:'godot',revision:3,world:{snapshot:{format:'craftmine.godot-progress/1',baseVersion:'1.0.0'}}};
    if(method==='content.status')return {backend:'git',repoId:'repo-one',appliedOid:'9'.repeat(40),branches:[{name:'refs/heads/main',oid:'8'.repeat(40)}]};
    if(method==='godotProject.index')return {worldId:'world-one',branchId:'main',revision:1,manifestHash:'a'.repeat(64),baseId:'creation-sandbox',engineVersion:'4.7.2-stable',files:Object.entries(sources).map(([path,text])=>({path,bytes:Buffer.byteLength(text),sha256:hash(text)})),nextOffset:null};
    if(method==='godotProject.read')return {sha256:hash(sources[args.path]),text:sources[args.path],nextOffset:null};
    if(method==='package.planInstall')return {ok:true,applied:false,operationId:args.operationId,worldId:'world-one',instances:[{instanceId:'ins-second-pet',assetId:'pet',version:1,contentHash:contentHash(content),installPath:'addons/pet',entityMap:{pet:'second-pet'},localOverrides:[]}],lock:{format:'craftmine.assets-lock/1',assets:[{asset:{assetId:'pet',version:'1',contentHash:contentHash(content)},installPath:'addons/pet',files:content.files.map(f=>({...f,mediaType:'text/plain'})),dependencies:[],overrides:[]}]}};
    if(method==='godotProject.applyFiles')return {revision:2,manifestHash:'b'.repeat(64),commitOid:'c'.repeat(40),assetLockHash:'d'.repeat(64)};
    if(method==='godotBuild.start')return {worldId:'world-one',jobId:'gjob-'+'e'.repeat(64),status:'queued'};
    throw Error('Unexpected '+method);
  };
  const installer=createAuthorSourceInstaller({call,authorize:async c=>{assert.deepEqual(c,context);return state.capture;},selected:async()=>state.selected,stagingRoot:directory,enqueue:async(job,c)=>{state.enqueued.push({job,context:c});return state.enqueueResult??{enqueued:true,jobId:job.jobId};}});
  const args={worldId:'world-one',operationId:'source-test-author',archiveBase64:archive.toString('base64'),expectedSource:{revision:1,manifestHash:'a'.repeat(64)}};
  return {state,args,run:()=>installer(args,context,()=>{if(state.ended)throw Error('TURN_ENDED');}),installer};
}

test('author install preserves existing scene and uses the original host lease for patch and check',async t=>{
  const f=await fixture(t),result=await f.run();assert.equal(result.status,'check-queued');assert.equal(result.applied,false);
  const write=f.state.calls.find(c=>c.method==='godotProject.applyFiles');assert.deepEqual(write.args.context,context);
  const scene=write.args.files.find(f=>f.path==='world.tscn');const text=Buffer.from(scene.bytesBase64,'base64').toString();assert.match(text,/existing-dog/);assert.match(text,/second-pet/);
  assert.deepEqual(f.state.calls.find(c=>c.method==='godotBuild.start').args.context,context);assert.deepEqual(f.state.enqueued[0].context,context);
  assert.equal(f.state.calls.some(c=>/turn.begin|workspace.endTurn|godotApplication|world.update/.test(c.method)),false);
  const again=await f.run();assert.equal(again.job.jobId,result.job.jobId);assert.equal(f.state.calls.filter(c=>c.method==='godotProject.applyFiles').length,1);
});
test('manual, revoked, foreign-world and stopped requests cannot write',async t=>{
  for(const change of [s=>s.capture.autoApply=false,s=>s.capture.authorization='world-policy',s=>s.capture.supersededBy={},s=>s.selected='other',s=>s.boundWorld='other',s=>s.ended=true]){
    const f=await fixture(t);change(f.state);await assert.rejects(f.run());assert.equal(f.state.calls.some(c=>c.method==='godotProject.applyFiles'||c.method==='godotBuild.start'),false);
  }
});
test('permission revoked during source inspection blocks the first mutation',async t=>{
  const f=await fixture(t);f.state.revokeAt='godotProject.read';await assert.rejects(f.run(),/NOT_AUTHORIZED/);assert.equal(f.state.calls.some(c=>c.method==='package.planInstall'||c.method==='godotProject.applyFiles'),false);
});

test('executor refusal is not reported as queued and replay hands off the same persisted job without another dog',async t=>{
  const f=await fixture(t);f.state.enqueueResult={enqueued:false,reason:'GODOT_EXECUTOR_BUSY'};
  await assert.rejects(f.run(),error=>error.code==='GODOT_EXECUTOR_BUSY'&&error.jobId==='gjob-'+'e'.repeat(64)&&/retained/.test(error.message));
  assert.equal(f.state.calls.filter(c=>c.method==='godotProject.applyFiles').length,1);
  f.state.enqueueResult=undefined;const result=await f.run();assert.equal(result.job.jobId,'gjob-'+'e'.repeat(64));
  assert.equal(f.state.enqueued.length,2);assert.equal(f.state.calls.filter(c=>c.method==='godotProject.applyFiles').length,1);assert.equal(f.state.calls.filter(c=>c.method==='godotBuild.start').length,1);
  f.state.enqueueResult={enqueued:false,reason:'GODOT_JOB_ALREADY_ENQUEUED'};assert.equal((await f.run()).job.jobId,result.job.jobId);
});
