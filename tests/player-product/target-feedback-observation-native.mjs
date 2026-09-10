// Actual shared adapter/bridge observation with fixed authored source and
// explicitly injected invalid-node fixtures. No client/model/input claims.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {materializeBase} from '../../desktop/godot/shared/materialize.mjs';
import {describeTargetFeedback,patchTargetFeedback} from '../../desktop/godot/shared/target-feedback-configuration.mjs';
import {validateObservationEnvelope} from '../../desktop/godot/shared/observation.mjs';
import {assertTargetFeedbackObservation} from './target-feedback-observation.mjs';
const engine=process.env.CRAFTMINE_GODOT_BIN;if(!engine)throw Error('CRAFTMINE_GODOT_BIN required');
const hash=value=>createHash('sha256').update(value).digest('hex');
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'target-feedback-observation-')),project=path.join(directory,'project');
materializeBase({baseId:'first-person',worldId:'feedback-world',template:'training-range',out:project});
const scenePath='scenes/training_range.tscn',files=new Map();
for(const name of [scenePath,'scenes/actors/target_dummy.tscn','scripts/core/target_dummy.gd','scripts/core/base_world.gd','scripts/core/balance_profile.gd','data/balance/training_range.tres','scenes/actors/player.tscn','scripts/core/player_controller.gd'])files.set(name,await fs.readFile(path.join(project,name)));
const profile250Explicit120Fixture=process.argv.includes('--profile-250-explicit-120-fixture');
const desiredMilliseconds=profile250Explicit120Fixture?120:500;
if(profile250Explicit120Fixture){
 const name='data/balance/training_range.tres',previous=files.get(name).toString('utf8'),modified=previous.replace('hit_flash_seconds = 0.12','hit_flash_seconds = 0.25');
 assert.notEqual(modified,previous);files.set(name,Buffer.from(modified));await fs.writeFile(path.join(project,name),modified);
}
const args={scenePath,sceneText:files.get(scenePath).toString('utf8'),targetId:'target_a',files};
const description=describeTargetFeedback(args);if(profile250Explicit120Fixture)assert.equal(description.values.hitFlashMilliseconds,250);
const patch=patchTargetFeedback({...args,binding:description.binding,values:{hitFlashMilliseconds:desiredMilliseconds}});
assert.equal(patch.changed,true);
const isolatedProfileFixture=process.argv.includes('--isolate-balance-profile-fixture');
const sceneText=isolatedProfileFixture?patch.text.replace(/^balance_profile = ExtResource\("2_balance"\)$/m,'balance_profile = null'):patch.text;
if(isolatedProfileFixture)assert.notEqual(sceneText,patch.text,'expected fixed scene profile property');
await fs.writeFile(path.join(project,scenePath),sceneText);
await fs.writeFile(path.join(project,'feedback_observe.gd'),`extends SceneTree

func _initialize() -> void:
	call_deferred("run")

func request(runtime: Node) -> Dictionary:
	return await runtime.handle_request({"worldId":"feedback-world","buildId":"fixture-build","instanceId":"fixture-instance","op":"observe-envelope","args":{}})

func run() -> void:
	change_scene_to_file(ProjectSettings.get_setting("application/run/main_scene"))
	for index in range(20):
		await process_frame
	var runtime = root.get_node("CraftmineRuntime")
	var host = current_scene
	# Complete the shared bridge's one-time world identity binding first.
	await request(runtime)
	var before: Dictionary = host.world_state.capture()
	var original_payload: Dictionary = host.snapshot()
	var observation: Dictionary = await request(runtime)
	var observed_without_addition: Dictionary = observation.result.payload.duplicate(true)
	observed_without_addition.erase("targetFeedback")
	observed_without_addition.erase("surfaceSize")
	observed_without_addition.erase("logicalViewportSize")
	var same_payload: bool = observed_without_addition == original_payload
	var same_progress: bool = before == host.world_state.capture()
	var target = host.get_node("Targets/TargetA")
	var original_duration: float = target.hit_flash_seconds
	var failures := []
	# Deliberate invalid runtime data tests; these assignments are never used as
	# success evidence for the authored 500 ms observation above.
	for duration in [0.0, -1.0, 1.001, NAN, 0.0015]:
		target.hit_flash_seconds = duration
		failures.append({"case":"invalid-duration","observation":await request(runtime)})
	target.hit_flash_seconds = original_duration
	target.target_id = &"bad/id"
	failures.append({"case":"invalid-id","observation":await request(runtime)})
	target.target_id = &"target_a"
	var duplicate = target.duplicate()
	host.add_child(duplicate)
	failures.append({"case":"duplicate-id","observation":await request(runtime)})
	duplicate.free()
	var outsider = target.duplicate()
	root.add_child(outsider)
	var outside_observation: Dictionary = await request(runtime)
	outsider.free()
	var unknown := Node3D.new()
	host.add_child(unknown)
	unknown.add_to_group("base_targets")
	var unknown_observation: Dictionary = await request(runtime)
	unknown.free()
	var additions := []
	var known = load("res://scripts/core/target_dummy.gd")
	for index in range(256):
		var addition = known.new()
		addition.target_id = StringName("extra_%d" % index)
		host.add_child(addition)
		additions.append(addition)
	failures.append({"case":"too-many-targets","observation":await request(runtime)})
	for addition in additions:
		addition.free()
	var report := {"observation":observation,"samePayload":same_payload,"sameProgress":same_progress,"outsideObservation":outside_observation,"unknownObservation":unknown_observation,"faults":failures}
	var file = FileAccess.open("res://observation-result.json", FileAccess.WRITE)
	file.store_string(JSON.stringify(report,"  "))
	file.close()
	quit(0)
`);
async function run(label,args){
 const env={...process.env,APPDATA:path.join(directory,'appdata'),LOCALAPPDATA:path.join(directory,'localdata')};
 await Promise.all([fs.mkdir(env.APPDATA,{recursive:true}),fs.mkdir(env.LOCALAPPDATA,{recursive:true})]);
 const child=spawn(engine,args,{cwd:project,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
 child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
 const timeout=setTimeout(()=>child.kill(),60000);
 const result=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',(code,signal)=>resolve({code,signal}));}).finally(()=>clearTimeout(timeout));
 await fs.writeFile(path.join(directory,label+'.json'),JSON.stringify({engine,args,...result,stdout,stderr},null,2));
 assert.equal(result.code,0,label+' failed: '+directory);assert.ok(!/SCRIPT ERROR|Parse Error/.test(stdout+stderr));
}
try{
 await run('import',['--headless','--path',project,'--editor','--import','--quit']);
 const results=[];
 for(const phase of ['first-load','fresh-process-reload']){
  await run(phase,['--headless','--path',project,'--script','res://feedback_observe.gd']);
  const report=JSON.parse(await fs.readFile(path.join(project,'observation-result.json'),'utf8'));
  const expected={worldId:'feedback-world',buildId:'fixture-build',targetId:'target_a',hitFlashMilliseconds:desiredMilliseconds};
  const actual=report.observation.result.payload.targetFeedback.targets.find(target=>target.targetId==='target_a')?.hitFlashMilliseconds;
  assertTargetFeedbackObservation(report.observation.result,{...expected,hitFlashMilliseconds:actual});assert.equal(validateObservationEnvelope(report.observation.result).ok,true);
  assert.equal(report.samePayload,true);assert.equal(report.sameProgress,true);
  assertTargetFeedbackObservation(report.outsideObservation.result,{...expected,hitFlashMilliseconds:actual});assertTargetFeedbackObservation(report.unknownObservation.result,{...expected,hitFlashMilliseconds:actual});
  assert.equal(report.faults.length,8);
  for(const fault of report.faults){const feedback=fault.observation.result.payload.targetFeedback;assert.equal(validateObservationEnvelope(fault.observation.result).ok,true);assert.deepEqual(feedback.targets,[]);assert.equal(feedback.error,{'invalid-duration':'TARGET_FEEDBACK_INVALID_DURATION','invalid-id':'TARGET_FEEDBACK_INVALID_ID','duplicate-id':'TARGET_FEEDBACK_DUPLICATE_ID','too-many-targets':'TARGET_FEEDBACK_TOO_MANY_TARGETS'}[fault.case]);}
  results.push({phase,expectedMilliseconds:desiredMilliseconds,actualMilliseconds:actual,parameterEffective:actual===desiredMilliseconds,...report});
 }
 const passed=results.every(result=>result.parameterEffective);
 await fs.writeFile(path.join(directory,'report.json'),JSON.stringify({passed,observerChecksPassed:true,isolatedProfileFixture,profile250Explicit120Fixture,describedMilliseconds:description.values.hitFlashMilliseconds,directory,engineSha256:hash(await fs.readFile(engine)),adapterSha256:hash(await fs.readFile(path.join(project,'craftmine_shared/base_adapter.gd'))),sceneSha256:hash(sceneText),results,limits:'Real shared bridge and adapter, fixed headless source load/reload and injected invalid-node tests; no client adoption or saved profile acceptance. An ineffective authored parameter remains a failed acceptance even if observer checks pass. When isolatedProfileFixture=true, this test-only scene disables BalanceProfile to isolate the observer; it is not the shipped training template.'},null,2));
 assert.equal(passed,true,'authored parameter was overridden at runtime; see retained report');
 console.log(JSON.stringify({passed:true,directory,phases:results.length,faultsPerPhase:8}));
}catch(error){console.error(error);console.error('Evidence: '+directory);process.exitCode=1;}
