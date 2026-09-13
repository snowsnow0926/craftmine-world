// Normal native source/package/check/application lifecycle with an actual hidden
// Electron-rendered Godot runtime. No model, general renderer eval or OS input.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {main} from '../scripts/codex-world-author.mjs';
import {readState} from '../scripts/lib/codex-world-session.mjs';
import {CodexWorldHost} from '../scripts/lib/codex-world-host.mjs';
import {startCodexLiveService} from '../scripts/lib/codex-live-service.mjs';
import {checkCurrentSource} from '../scripts/codex-live-world.mjs';
const [runtime,plugin,output,selected='both',mode='fresh']=process.argv.slice(2);
for(const value of [runtime,plugin,output])assert(value&&path.isAbsolute(value),'Pass absolute existing runtime, built plugin and NEW report directory');
assert.ok(['flight','city','both'].includes(selected));
assert.ok(['fresh','resume'].includes(mode));if(mode==='fresh')await fs.mkdir(output);const sha=b=>createHash('sha256').update(b).digest('hex');
const report=mode==='resume'?JSON.parse(await fs.readFile(path.join(output,'report.json'),'utf8')):{format:'craftmine.reusable-content-formal-runtime/1',output,modelCalls:0,physicalInputSent:false,worlds:[],passed:false};
if(mode==='resume'){await fs.copyFile(path.join(output,'report.json'),path.join(output,'prior-attempt-'+randomUUID()+'.json'));delete report.error;report.passed=false;}
const saveReport=()=>fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
const controller=new AbortController();process.on('SIGINT',()=>controller.abort());process.on('SIGTERM',()=>controller.abort());
const flightArea=`extends "res://scripts/creation_world.gd"
func _build_environment() -> void:
 var environment := WorldEnvironment.new()
 environment.environment = Environment.new()
 environment.environment.background_mode = Environment.BG_COLOR
 environment.environment.background_color = Color("719abb")
 environment.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
 environment.environment.ambient_light_color = Color("c8dfed")
 environment.environment.ambient_light_energy = 0.65
 add_child(environment)
 sun = DirectionalLight3D.new()
 sun.rotation_degrees = Vector3(-45,-30,0)
 add_child(sun)
 _box(self,Vector3(5000,0.4,5000),Vector3(0,-0.2,0),Color("4f6b5a"))
 _solid(self,Vector3(5000,0.4,5000),Vector3(0,-0.2,0),"ground")
 _box(self,Vector3(56,0.01,2400),Vector3(-6,0.005,-800),Color("555b62"))
 marker = MeshInstance3D.new()
 marker.mesh = SphereMesh.new()
 marker.visible = false
 add_child(marker)
 var statue := Node3D.new()
 statue.name = "ExistingStatue"
 statue.position = Vector3(100,0,10)
 add_child(statue)
 _box(statue,Vector3(2,4,2),Vector3(0,2,0),Color("d89c41"))
`;
async function run(kind){
 const previous=mode==='resume'?report.worlds.find(w=>w.kind===kind):null;
 if(mode==='resume')assert.ok(previous?.formalBuildId,'Resume only an existing formally adopted receiving world');
 const data=path.join(output,kind),worldId=previous?.worldId??'reuse-'+kind+'-'+randomUUID().slice(0,8);
 const entry=previous??{kind,data,worldId,stages:[],passed:false};if(!previous)report.worlds.push(entry);else{delete entry.error;delete entry.shutdownError;entry.passed=false;}await saveReport();
 if(!previous)await main(['init','--data',data,'--runtime',runtime,'--plugin',plugin,'--world',worldId]);
 const state=readState(data);let host,live,context;
 const start=async()=>{host=new CodexWorldHost({state,data});live=await startCodexLiveService({core:host.core,state,data});host=new CodexWorldHost({state,data,core:host.core,services:live});await host.start();entry.helper=live.directory;await saveReport();};
 const stop=async()=>{if(!host)return;await host.stop({beforeCoreStop:()=>live.stop()});const guards=JSON.parse(await fs.readFile(path.join(live.directory,'guards.json'),'utf8'));assert.deepEqual(guards.violations,[]);assert.deepEqual(guards.pageErrors,[]);entry.stages.push({stage:'retired',helper:live.directory,guards});host=null;live=null;await saveReport();};
 const begin=async text=>{context={projectId:state.projectId,sessionId:state.sessionId,turnId:randomUUID()};await host.begin(context,text);};
 const tool=(name,args={})=>host.tools.find(t=>t.name===name).execute(args,{...context,toolCallId:randomUUID(),executionId:'reusable-formal-native'});
 const capture=async label=>{const result=await live.capture();assert.equal(result.scope,'formal');assert.equal(sha(await fs.readFile(result.imagePath)),result.sha256);entry.stages.push({stage:'capture',label,...result});await saveReport();return result;};
 const check=async()=>{const checked=await checkCurrentSource(host,state,{signal:controller.signal});assert.equal(checked.status,'passed');entry.stages.push({stage:'native-check',result:checked});await saveReport();return checked;};
 const readSource=async()=>{const {context:sourceContext}=await host.core.call('godotProject.sourceContext',{worldId});let offset=0;const files=[];do{const page=await host.core.call('godotProject.index',{context:sourceContext,worldId,offset,limit:32});files.push(...page.files);offset=page.nextOffset??0;}while(offset);return files;};
 const install=async(assetId,position)=>{
  const catalog=JSON.parse(await fs.readFile(path.join(plugin,'builtin-source-library/catalog.json'),'utf8')),asset=catalog.entries.find(e=>e.assetId===assetId);assert.ok(asset);
  const bytes=await fs.readFile(path.join(plugin,'builtin-source-library',asset.file));assert.equal(sha(bytes),asset.sha256);
  const result=await host.installSource({worldId,operationId:'install-'+randomUUID(),archiveBase64:bytes.toString('base64'),position});entry.stages.push({stage:'source-package-install',assetId,sha256:asset.sha256,result});await saveReport();
  const jobId=result.job?.jobId??result.job?.id;assert.ok(jobId,'Normal source installer must report its native check job');
  for(;;){if(controller.signal.aborted)throw Error('TEST_CANCELLED');const job=await host.core.call('godotBuild.read',{worldId,jobId});if(['passed','failed','blocked','cancelled','interrupted'].includes(job.status)){entry.stages.push({stage:'package-native-check',job});await saveReport();assert.equal(job.status,'passed');break;}await delay(500);}
  const candidates=await host.core.call('godotCandidate.list',{worldId,offset:0,limit:32}),candidate=candidates.items.find(c=>c.checkJobId===jobId);assert.ok(candidate);return {result,candidate};
 };
 try{
  await start();let original,final;
  if(previous){await live.call('open');original=entry.originalSource;const candidates=await host.core.call('godotCandidate.list',{worldId,offset:0,limit:32});final={result:entry.stages.filter(s=>s.stage==='source-package-install').at(-1).result,candidate:candidates.items.find(c=>c.buildId===entry.formalBuildId)};assert.ok(final.candidate);}
  else {
  const first=await check();const initial=await live.call('apply',{candidateId:first.candidateId});assert.equal(initial.status,'applied');entry.stages.push({stage:'base-first-load',result:initial});await capture('original-blank');
  await live.call('pause');original=await readSource();entry.originalSource=original;
  if(kind==='flight'){
   await begin('Author an explicit open runway receiving world while preserving the original controller, runtime and base source.');
   const index=await tool('godot_project_index'),scene=await tool('godot_file_read',{revision:index.revision,manifestHash:index.manifestHash,path:'scenes/creation.tscn'});
   const text=scene.text.replace('path="res://scripts/creation_world.gd"','path="res://scripts/open_flight_area.gd"');assert.notEqual(text,scene.text);
   await tool('godot_project_patch',{revision:index.revision,manifestHash:index.manifestHash,operations:[{op:'put',path:'scenes/creation.tscn',text,expectedHash:sha(Buffer.from(scene.text))},{op:'put',path:'scripts/open_flight_area.gd',text:flightArea,expectedHash:null}]});
   await host.end(context,'completed');context=null;
  }
  const packages=kind==='flight'?[['cw.module.reusable-j20',{x:-6,y:2.18,z:0}]]:[['cw.city.ward-street',{x:-10,y:0,z:-5}],['cw.city.gate-section',{x:2,y:0,z:24}],['cw.city.ward-building',{x:18,y:0,z:-14}]];
  if(kind==='city'){
   await live.call('resume');await live.call('look',{yaw:0,pitch:0});await live.call('walk',{forward:0,right:1,frames:150});await live.call('pause');
   const outside=(await live.call('snapshot')).state;assert.ok(outside.body.player.position[0]>5.5);
   const outsideSave=await live.call('save');assert.equal(outsideSave.status,'persisted');
   entry.stages.push({stage:'ordinary-walk-and-save-outside-new-ground-before-adoption',player:outside.body.player,receipt:outsideSave.receipt});await saveReport();
  }
  for(const [assetId,position]of packages){final=await install(assetId,position);const adopted=await live.call('apply',{candidateId:final.candidate.candidateId});assert.equal(adopted.status,'applied');entry.stages.push({stage:'component-adopted',assetId,result:adopted});await saveReport();}
  }
  if(previous&&kind==='city'&&!entry.stages.some(s=>s.stage==='component-adopted'&&s.assetId==='cw.city.ward-building')){
   final=await install('cw.city.ward-building',{x:18,y:0,z:-14});const adopted=await live.call('apply',{candidateId:final.candidate.candidateId});assert.equal(adopted.status,'applied');entry.stages.push({stage:'component-adopted',assetId:'cw.city.ward-building',result:adopted});await saveReport();
  }
  await live.call('pause');const formal=await host.core.call('godotRuntime.describe',{worldId});assert.equal(formal.buildId,final.candidate.buildId);entry.formalBuildId=formal.buildId;
  const current=await readSource();for(const file of original)if(file.path!=='scenes/creation.tscn')assert.equal(current.find(f=>f.path===file.path)?.sha256,file.sha256,'Original source changed: '+file.path);entry.sourcePreserved=true;
  await capture('adopted-content');
  const identity=()=>live.call('status').then(s=>({worldId:s.instance.worldId,buildId:s.instance.buildId,instanceId:s.instance.instanceId}));
  const segment=async (label,segment)=>{await live.call('resume');const result=await live.gameplay(await identity(),{...segment,capture:segment.capture??false});await live.call('pause');assert.equal(result.status,'completed');assert.equal(result.release.released,true);entry.stages.push({stage:'gameplay',label,result});await saveReport();return result;};
  await live.call('resume');
  if(kind==='flight'){
   await live.call('walk',{forward:0,right:-1,frames:40});await live.call('pause');
   const snap=(await live.call('snapshot')).state,matching=Object.entries(snap.body.components??{}).filter(([id,body])=>id.startsWith(final.result.instanceIds[0]+'-')&&body.format==='craftmine.reusable-j20-state/1');assert.equal(matching.length,1);
   const [componentId,plane]=matching[0],p=snap.body.player.position;
   assert.ok(plane);entry.componentId=componentId;
   const d=[plane.position[0]-p[0],plane.position[1]-p[1]-0.65,plane.position[2]-p[2]];
   await live.call('resume');
   await live.call('look',{yaw:Math.atan2(-d[0],-d[2]),pitch:Math.atan2(d[1],Math.hypot(d[0],d[2]))});
   await segment('normal E boarding',{keys:['KeyE'],frames:2,settleFrames:2});
   assert.equal((await live.call('snapshot')).state.body.components[componentId].piloted,true);
   await capture('boarded-aircraft');
   await segment('runway acceleration',{keys:['KeyW'],frames:400,settleFrames:0});
   await segment('pitch up takeoff',{keys:['ArrowDown'],frames:40,settleFrames:25});
   const airborne=(await live.call('snapshot')).state.body.components[componentId];assert.equal(airborne.grounded,false);assert.equal(airborne.crashed,false);assert.ok(airborne.position[1]>5);entry.airborne=airborne;
   await segment('gear and cockpit',{keys:['KeyG','KeyC'],frames:3,settleFrames:2});await capture('airborne-cockpit');
  }else{
   await live.call('look',{yaw:0,pitch:-0.05});if(!previous){await live.call('walk',{forward:0,right:-1,frames:118});await live.call('walk',{forward:1,right:0,frames:110});}await live.call('pause');
   const snapshot=(await live.call('snapshot')).state;assert.ok(snapshot.body.player.position[2]<0);assert.ok(snapshot.body.player.position[0]<5);assert.ok(snapshot.body.player.position[1]>0.91);entry.cityWalk=snapshot.body.player;await capture('city-street-walk');
   const p=snapshot.body.player.position;await live.call('resume');await live.call('look',{yaw:Math.atan2(-(18-p[0]),-(-14-p[2])),pitch:0.08});await live.call('pause');await capture('standalone-house-in-receiving-world');
  }
  await live.call('pause');const saved=await live.call('save');assert.equal(saved.status,'persisted');assert.deepEqual((await host.core.call('world.read',{id:worldId})).world.snapshot,saved.snapshot);
  entry.saved=saved;const oldInstance=(await live.call('status')).instance.instanceId;await stop();
  await start();const reopened=await live.call('openPaused');assert.notEqual(reopened.instance.instanceId,oldInstance);assert.equal(reopened.instance.buildId,formal.buildId);await live.call('pause');
  assert.deepEqual((await live.call('snapshot')).state,saved.snapshot);entry.stages.push({stage:'cold-reopen-exact',instance:reopened.instance});
  if(kind==='flight'){await segment('resume restored aircraft camera',{frames:2});assert.equal((await live.call('snapshot')).state.body.components[entry.componentId].piloted,true);await capture('cold-restored-flight');}
  else await capture('cold-restored-city');
  const again=await live.call('save');assert.equal(again.status,'persisted');entry.reopenedSave=again;await stop();entry.passed=true;
 }catch(error){entry.error=String(error.stack??error);if(host){try{entry.jobs=await host.core.call('godotBuild.list',{worldId,offset:0,limit:8});}catch{}try{entry.diagnostics=await live.call('diagnostics');}catch{}}throw error;
 }finally{if(context&&host)await host.end(context,'error').catch(()=>{});if(host)try{await stop();}catch(error){entry.shutdownError=String(error);await live?.abandon();await host?.core.stop();}await saveReport();}
}
try{for(const kind of selected==='both'?['flight','city']:[selected])await run(kind);report.passed=true;}catch(error){report.error=String(error.stack??error);process.exitCode=1;}finally{await saveReport();console.log(JSON.stringify({passed:report.passed,report:path.join(output,'report.json'),error:report.error?.split('\n')[0]}));}
