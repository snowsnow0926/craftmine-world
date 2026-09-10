import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {describeTargetFeedback,patchTargetFeedback,targetFeedbackConfiguration,validateTargetFeedbackConfiguration} from '../../desktop/godot/shared/target-feedback-configuration.mjs';
import {contentHash,validateResourceManifest} from '../../plugins/craftmine-world/package-format.mjs';
const root=path.resolve(import.meta.dirname,'../..'),base=path.join(root,'desktop/godot/bases/first-person');
const script=fs.readFileSync(path.join(base,'scripts/core/target_dummy.gd'));
const hash=value=>createHash('sha256').update(value).digest('hex');
const scene=`[gd_scene load_steps=2 format=3]
[ext_resource type="Script" path="res://scripts/core/target_dummy.gd" id="script"]
[node name="World" type="Node3D"]
[node name="Left" type="Node3D" parent="."]
[node name="Same" type="StaticBody3D" parent="Left"]
script = ExtResource("script")
target_id = &"left-target"
display_name = "同名"
max_health = 50.0

[node name="Right" type="Node3D" parent="."]
[node name="Same" type="StaticBody3D" parent="Right"]
script = ExtResource("script")
target_id = &"right-target"
display_name = "同名"
hit_flash_seconds = 0.25
`;
function fixture(text=scene,targetId='left-target'){
 const files=new Map([['world.tscn',Buffer.from(text)],['scripts/core/target_dummy.gd',Buffer.from(script)]]);
 return {sceneText:text,scenePath:'world.tscn',targetId,files};
}
function apply(args,value){return patchTargetFeedback({...args,binding:describeTargetFeedback(args).binding,values:{hitFlashMilliseconds:value}});}
test('CP configuration is exact, integer canonical, and remains in the existing resource format',()=>{
 const configuration=targetFeedbackConfiguration();assert.equal(configuration.parameters[0].unit,'毫秒');
 assert.deepEqual(validateTargetFeedbackConfiguration(configuration),configuration);
 const content={assetId:'test-target',version:1,kind:'object',files:[],dependencies:[],entry:{},interfaces:{configuration},compatibility:{},state:{},licenses:{}};
 const manifest={format:'craftmine.resource/1',content,contentHash:contentHash(content)};
 assert.equal(validateResourceManifest(manifest).contentHash,manifest.contentHash);
 for(const mutate of [v=>v.parameters[0].maximum=9999,v=>v.parameters.push({id:'max_health'}),v=>v.scope='template']){
  const changed=targetFeedbackConfiguration();mutate(changed);assert.throws(()=>validateTargetFeedbackConfiguration(changed),/UNSUPPORTED/);
 }
});
test('same names are separated by explicit stable IDs and only chosen physical text changes',()=>{
 const args=fixture(),description=describeTargetFeedback(args);assert.equal(description.values.hitFlashMilliseconds,120);
 const changed=apply(args,700);
 assert.equal(changed.text,scene.replace('[node name="Same" type="StaticBody3D" parent="Left"]\n','[node name="Same" type="StaticBody3D" parent="Left"]\nhit_flash_seconds = 0.7\n'));
 assert.equal(changed.previousHash,hash(scene));assert.equal(changed.sha256,hash(changed.text));
 assert.equal(args.files.get('scripts/core/target_dummy.gd').equals(script),true);
 assert.equal(describeTargetFeedback(fixture(changed.text,'right-target')).values.hitFlashMilliseconds,250);
});
test('existing override replacement preserves CRLF, property spacing and unrelated bytes',()=>{
 const text=scene.replace('hit_flash_seconds = 0.25','hit_flash_seconds\t=\t0.25').replaceAll('\n','\r\n');
 assert.equal(apply(fixture(text,'right-target'),1).text,text.replace('hit_flash_seconds\t=\t0.25','hit_flash_seconds\t=\t0.001'));
 for(const value of [0,1000])assert.equal(apply(fixture(),value).values.hitFlashMilliseconds,value);
 const noop=apply(fixture(),120);assert.equal(noop.changed,false);assert.equal(noop.text,scene);
});
test('official training scene and direct known PackedScene root resolve without modifying template',()=>{
 const scenePath='scenes/training_range.tscn',text=fs.readFileSync(path.join(base,scenePath),'utf8');
 const template='scenes/actors/target_dummy.tscn',templateBytes=fs.readFileSync(path.join(base,template));
 const args={sceneText:text,scenePath,targetId:'target_b',files:new Map([[scenePath,Buffer.from(text)],[template,templateBytes],['scripts/core/target_dummy.gd',script]])};
 const result=apply(args,400);assert.equal(result.values.hitFlashMilliseconds,400);
 assert.ok(result.text.includes('[node name="TargetB" parent="Targets" instance=ExtResource("11_target")]\n'+'hit_flash_seconds = 0.4\n'));
 assert.equal(args.files.get(template),templateBytes);assert.equal(result.binding.dependencies.length,3);
});
test('old scene, dependency or target binding cannot authorize a patch',()=>{
 const args=fixture(),binding=describeTargetFeedback(args).binding;
 for(const changed of [fixture(scene+'# edit\n'),fixture(scene,'right-target')])assert.throws(()=>patchTargetFeedback({...changed,binding,values:{hitFlashMilliseconds:500}}),/STALE_BINDING/);
 const forged=structuredClone(binding);forged.dependencies=[];
 assert.throws(()=>patchTargetFeedback({...args,binding:forged,values:{hitFlashMilliseconds:500}}),/STALE_BINDING/);
 const files=new Map(args.files);files.set('scripts/core/target_dummy.gd',Buffer.concat([script,Buffer.from('\n# changed')]));
 assert.throws(()=>patchTargetFeedback({...args,files,binding,values:{hitFlashMilliseconds:500}}),/UNKNOWN_SCRIPT/);
});
test('missing, duplicate, inherited, expression and unknown targets are refused',()=>{
 const cases=[
  [scene.replace('target_id = &"left-target"','target_id = &"right-target"'),'DUPLICATE_ID'],
  [scene.replace('target_id = &"left-target"','target_id = get_id()'),'EXPLICIT_ID_REQUIRED'],
  [scene.replace('target_id = &"left-target"',''),'TARGET_NOT_FOUND'],
  [scene.replace('target_id = &"left-target"','target_id = &"left-target"\ntarget_id = &"else"'),'DUPLICATE_PROPERTY'],
  [scene.replace('[node name="World" type="Node3D"]','[node name="World" instance=ExtResource("scene")]'),'INHERITED_SCENE'],
  [scene.replace('res://scripts/core/target_dummy.gd','res://scripts/custom.gd'),'UNKNOWN_SCRIPT'],
  [scene.replace('max_health = 50.0','hit_flash_seconds = do_something()'),'VALUE_EXPRESSION'],
  [scene.replace('max_health = 50.0','hit_flash_seconds = 0.1\nhit_flash_seconds = 0.2'),'DUPLICATE_PROPERTY'],
  [scene.replace('max_health = 50.0','  hit_flash_seconds = 0.8'),'EXPRESSION_REFUSED'],
  [scene.replace('target_id = &"left-target"','target_id = &"left-target"\n target_id = &"right-target"'),'EXPRESSION_REFUSED'],
  [scene.replace('parent="Left"]','parent="Left" parent="Right"]'),'SCENE_UNSUPPORTED'],
 ];
 for(const [text,code]of cases)assert.throws(()=>describeTargetFeedback(fixture(text)),new RegExp(code));
 assert.throws(()=>describeTargetFeedback(fixture(scene,'";execute()')),/INVALID_ARGUMENT/);
});
test('source bytes mismatch and ambiguous external resource declarations are refused',()=>{
 const args=fixture();args.files.set('world.tscn',Buffer.from(scene+'\n'));
 assert.throws(()=>describeTargetFeedback(args),/SOURCE_MISMATCH/);
 const resource='[ext_resource type="Script" path="res://scripts/core/target_dummy.gd" id="script"]';
 assert.throws(()=>describeTargetFeedback(fixture(scene.replace(resource,resource+'\n'+resource))),/DUPLICATE_RESOURCE/);
 assert.throws(()=>describeTargetFeedback(fixture(scene.replace('parent="Right"]','parent="Left"]'))),/DUPLICATE_NODE/);
});
test('invalid values and unrecognized property requests never return modified text',()=>{
 const args=fixture(),binding=describeTargetFeedback(args).binding;
 for(const value of [-1,1001,0.5,NaN,Infinity,'500',null,undefined])assert.throws(()=>patchTargetFeedback({...args,binding,values:{hitFlashMilliseconds:value}}),/VALUE_INVALID/);
 assert.throws(()=>patchTargetFeedback({...args,binding,values:{hitFlashMilliseconds:100,max_health:1}}),/INVALID_ARGUMENT/);
 assert.throws(()=>patchTargetFeedback({...args,binding,values:{hitFlashMilliseconds:100},property:'script'}),/INVALID_ARGUMENT/);
});
