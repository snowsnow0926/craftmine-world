import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {describeTargetFeedback,patchTargetFeedback,validateTargetFeedbackDefaults} from '../../desktop/godot/shared/target-feedback-configuration.mjs';
const base=path.resolve(import.meta.dirname,'../../desktop/godot/bases/first-person');
const scenePath='scenes/training_range.tscn',template='scenes/actors/target_dummy.tscn',profile='data/balance/training_range.tres';
function fixture(){const files=new Map();for(const name of [scenePath,template,profile,'scripts/core/target_dummy.gd','scripts/core/base_world.gd','scripts/core/balance_profile.gd','scenes/actors/player.tscn','scripts/core/player_controller.gd'])files.set(name,fs.readFileSync(path.join(base,name)));return {files,scenePath,sceneText:files.get(scenePath).toString(),targetId:'target_b'};}
function replace(input,name,from,to){const files=new Map(input.files);files.set(name,Buffer.from(files.get(name).toString().replace(from,to)));return {...input,files,sceneText:files.get(input.scenePath).toString()};}
function override(input){return replace(input,scenePath,'target_id = &"target_b"','target_id = &"target_b"\nhit_flash_seconds = 0.8');}
const sha=b=>createHash('sha256').update(b).digest('hex');
test('default resolves below instance override with exact source provenance and original binding',()=>{
 const initial=override(replace(fixture(),profile,'hit_flash_seconds = 0.12','hit_flash_seconds = 0.25'));
 const withTemplate=replace(initial,template,'max_health = 50.0','max_health = 50.0\nhit_flash_seconds = 0.35');
 const cases=[[initial,250,'balance-profile',profile],[withTemplate,350,'packed-scene',template],
  [replace(initial,profile,'hit_flash_seconds = 0.25',''),120,'balance-profile-script','scripts/core/balance_profile.gd'],
  [replace(initial,scenePath,'balance_profile = ExtResource("2_balance")','balance_profile = null'),120,'target-script','scripts/core/target_dummy.gd']];
 for(const [args,value,kind,sourcePath]of cases){const result=describeTargetFeedback(args);assert.equal(result.values.hitFlashMilliseconds,800);assert.equal(result.defaults.values.hitFlashMilliseconds,value);assert.deepEqual(result.defaults.source,{kind,path:sourcePath,sha256:sha(args.files.get(sourcePath))});assert.deepEqual(validateTargetFeedbackDefaults(result.defaults),result.defaults);
  const patch=patchTargetFeedback({...args,binding:result.binding,values:result.defaults.values});assert.equal(patch.text,args.sceneText.replace('hit_flash_seconds = 0.8','hit_flash_seconds = '+value/1000));assert.equal(patch.values.hitFlashMilliseconds,value);assert.equal(describeTargetFeedback({...args,targetId:'target_a'}).values.hitFlashMilliseconds,value);
  assert.equal(args.files.get(sourcePath).toString().includes('hit_flash_seconds = 0.8'),false);
 }
});
test('direct target current explicit value is not misreported as its own template default',()=>{
 const scene='[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://scripts/core/target_dummy.gd" id="script"]\n[node name="World" type="Node3D"]\n[node name="Direct" type="StaticBody3D" parent="."]\nscript = ExtResource("script")\ntarget_id = &"direct"\nhit_flash_seconds = 0.9\n';
 const files=new Map([['world.tscn',Buffer.from(scene)],['scripts/core/target_dummy.gd',fs.readFileSync(path.join(base,'scripts/core/target_dummy.gd'))]]);const result=describeTargetFeedback({scenePath:'world.tscn',sceneText:scene,targetId:'direct',files});assert.equal(result.values.hitFlashMilliseconds,900);assert.equal(result.defaults.values.hitFlashMilliseconds,120);assert.equal(result.defaults.source.kind,'target-script');
});
test('default provenance changes cannot reuse the old source binding and CRLF stays exact',()=>{
 let args=override(fixture());args=replace(args,scenePath,args.sceneText,args.sceneText.replaceAll('\n','\r\n'));const before=describeTargetFeedback(args),changed=replace(args,profile,'hit_flash_seconds = 0.12','hit_flash_seconds = 0.3');
 assert.throws(()=>patchTargetFeedback({...changed,binding:before.binding,values:before.defaults.values}),/STALE_BINDING/);
 const patch=patchTargetFeedback({...args,binding:before.binding,values:before.defaults.values});assert.equal(patch.text,args.sceneText.replace('hit_flash_seconds = 0.8','hit_flash_seconds = 0.12'));
});
test('unknown default sources and public default metadata never broaden the finite contract',()=>{
 const args=fixture();assert.throws(()=>describeTargetFeedback(replace(args,'scripts/core/target_dummy.gd','0.12','0.18')),/UNKNOWN_SCRIPT/);
 const valid=describeTargetFeedback(args).defaults;
 for(const mutate of [v=>v.source.kind='custom',v=>v.source.path='C:/private/config.tres',v=>v.source.sha256='bad',v=>v.values.hitFlashMilliseconds=0,v=>v.values.hitFlashMilliseconds=1001,v=>v.values.hitFlashMilliseconds=1.5,v=>v.values.other=1,v=>v.mode='inherit']){const v=structuredClone(valid);mutate(v);assert.throws(()=>validateTargetFeedbackDefaults(v));}
});
