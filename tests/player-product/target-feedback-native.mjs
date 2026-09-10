// Actual fixed Godot headless scene load and target behavior. No model, UI,
// application receipt or full-progress acceptance is simulated by this test.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {describeTargetFeedback,patchTargetFeedback} from '../../desktop/godot/shared/target-feedback-configuration.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const engine=process.env.CRAFTMINE_GODOT_BIN;if(!engine)throw Error('CRAFTMINE_GODOT_BIN required');
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'target-feedback-native-')),project=path.join(directory,'project');
await fs.mkdir(path.join(project,'scripts/core'),{recursive:true});
const script=await fs.readFile(path.resolve(import.meta.dirname,'../../desktop/godot/bases/first-person/scripts/core/target_dummy.gd'));
await fs.writeFile(path.join(project,'scripts/core/target_dummy.gd'),script);
await fs.writeFile(path.join(project,'project.godot'),'config_version=5\n[application]\nconfig/name="TargetFeedbackOwnedAcceptance"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n');
const scene='[gd_scene load_steps=4 format=3]\n[ext_resource type="Script" path="res://scripts/core/target_dummy.gd" id="script"]\n[sub_resource type="StandardMaterial3D" id="base"]\nalbedo_color = Color(0.2, 0.3, 0.4, 1)\n[sub_resource type="BoxMesh" id="mesh"]\n[node name="World" type="Node3D"]\n[node name="Target" type="StaticBody3D" parent="."]\nscript = ExtResource("script")\ntarget_id = &"target-one"\n[node name="Mesh" type="MeshInstance3D" parent="Target"]\nmesh = SubResource("mesh")\nmaterial_override = SubResource("base")\n';
const scenes=[];
for(const milliseconds of [1,500,1000]){
 const scenePath=`target-${milliseconds}.tscn`,args={sceneText:scene,scenePath,targetId:'target-one',files:new Map([[scenePath,Buffer.from(scene)],['scripts/core/target_dummy.gd',script]])};
 const patched=patchTargetFeedback({...args,binding:describeTargetFeedback(args).binding,values:{hitFlashMilliseconds:milliseconds}});
 await fs.writeFile(path.join(project,scenePath),patched.text);scenes.push({milliseconds,scenePath,sha256:sha(patched.text)});
}
await fs.writeFile(path.join(project,'acceptance.gd'),`extends SceneTree

func _initialize() -> void:
	call_deferred("run")

func run() -> void:
	var results: Array = []
	var all_passed := true
	for milliseconds in [1, 500, 1000]:
		var packed = load("res://target-%d.tscn" % milliseconds)
		if packed == null:
			quit(2)
			return
		var scene = packed.instantiate()
		root.add_child(scene)
		var target = scene.get_node("Target")
		target.set_process(false)
		var original = target.mesh_instance.material_override
		var damage: Dictionary = target.apply_damage(1.0)
		var seconds := float(milliseconds) / 1000.0
		var remaining: float = target._flash_remaining
		var changed: bool = target.mesh_instance.material_override != original
		target._process(seconds / 2.0)
		var midpoint: float = target._flash_remaining
		var retained: bool = target.mesh_instance.material_override != original
		target._process(seconds)
		var end_remaining: float = target._flash_remaining
		var restored: bool = target.mesh_instance.material_override == original
		var passed: bool = is_equal_approx(target.hit_flash_seconds, seconds) and is_equal_approx(remaining, seconds) and changed and is_equal_approx(midpoint, seconds / 2.0) and retained and end_remaining == 0.0 and restored and damage.applied == 1.0 and target.health == 49.0 and target.hit_count == 1
		results.append({"milliseconds":milliseconds,"property":target.hit_flash_seconds,"remainingAfterDamage":remaining,"materialChanged":changed,"remainingMidpoint":midpoint,"materialRetained":retained,"remainingAtEnd":end_remaining,"materialRestored":restored,"snapshot":target.snapshot(),"passed":passed})
		all_passed = all_passed and passed
		scene.free()
	var report := {"passed":all_passed,"cases":results,"scope":"Actual PackedScene load, damage, flash and controlled process delta; no visual screenshot or full client lifecycle."}
	var file = FileAccess.open("res://native-result.json", FileAccess.WRITE)
	file.store_string(JSON.stringify(report, "  "))
	file.close()
	print(JSON.stringify(report))
	quit(0 if all_passed else 1)
`);
async function run(label,args){
 const env={...process.env,APPDATA:path.join(directory,'appdata'),LOCALAPPDATA:path.join(directory,'localdata')};
 await Promise.all([fs.mkdir(env.APPDATA,{recursive:true}),fs.mkdir(env.LOCALAPPDATA,{recursive:true})]);
 const child=spawn(engine,args,{cwd:project,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
 child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
 const timer=setTimeout(()=>child.kill(),60000);
 const result=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',(code,signal)=>resolve({code,signal}));}).finally(()=>clearTimeout(timer));
 await fs.writeFile(path.join(directory,label+'.json'),JSON.stringify({engine,args,...result,stdout,stderr},null,2));
 assert.equal(result.code,0,`${label} failed; evidence ${directory}`);assert.ok(!/SCRIPT ERROR|Parse Error/.test(stdout+stderr));
}
try{
 await run('import',['--headless','--path',project,'--editor','--import','--quit']);
 await run('run',['--headless','--path',project,'--script','res://acceptance.gd']);
 const report=JSON.parse(await fs.readFile(path.join(project,'native-result.json'),'utf8'));assert.equal(report.passed,true);assert.equal(report.cases.length,3);
 await fs.writeFile(path.join(directory,'report.json'),JSON.stringify({...report,engineSha256:sha(await fs.readFile(engine)),scriptSha256:sha(script),scenes,directory},null,2));
 console.log(JSON.stringify({passed:true,cases:3,directory}));
}catch(error){console.error(error);console.error('Evidence: '+directory);process.exitCode=1;}
