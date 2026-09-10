// Fixed authored configuration evidence only; no model, window, or input.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {describeTargetFeedback,patchTargetFeedback} from '../../desktop/godot/shared/target-feedback-configuration.mjs';
const root=path.resolve(import.meta.dirname,'../..'),engine=process.argv[2];
if(!engine)throw Error('Provide the pinned Godot editor executable');
const sha=b=>createHash('sha256').update(b).digest('hex');
const lock=JSON.parse(await fs.readFile(path.join(root,'desktop/godot/toolchain.lock.json'),'utf8'));
assert.equal(sha(await fs.readFile(engine)),lock.editor.executableSha256);
await fs.mkdir(path.join(root,'test-results'),{recursive:true});
const out=await fs.mkdtemp(path.join(root,'test-results/target-default-native-')),bin=path.join(out,'engine.exe');
await fs.copyFile(engine,bin);await fs.writeFile(path.join(out,'_sc_'),'');
const report={format:'craftmine.target-feedback-default-native/1',kind:'fixed-authored-headless-godot',engineSha256:lock.editor.executableSha256,checks:[],completed:false,passed:false,out};
const env={...process.env,APPDATA:path.join(out,'appdata'),LOCALAPPDATA:path.join(out,'local'),USERPROFILE:path.join(out,'home')};
for(const directory of [env.APPDATA,env.LOCALAPPDATA,env.USERPROFILE,...['Documents','Desktop','Downloads','Music','Pictures','Videos'].map(name=>path.join(env.USERPROFILE,name))])await fs.mkdir(directory,{recursive:true});
const scenePath='scenes/training_range.tscn',profilePath='data/balance/training_range.tres',templatePath='scenes/actors/target_dummy.tscn';
const names=[scenePath,profilePath,templatePath,'scripts/core/target_dummy.gd','scripts/core/base_world.gd','scripts/core/balance_profile.gd','scenes/actors/player.tscn','scripts/core/player_controller.gd'];
try{
 for(const [kind,expected]of [['packed-scene',350],['balance-profile',250],['balance-profile-script',120],['target-script',120]]){
  const project=path.join(out,kind);await fs.cp(path.join(root,'desktop/godot/bases/first-person'),project,{recursive:true});
  const files=new Map(await Promise.all(names.map(async name=>[name,await fs.readFile(path.join(project,name))])));
  const replace=(name,from,to)=>files.set(name,Buffer.from(files.get(name).toString().replace(from,to)));
  replace(scenePath,'target_id = &"target_b"','target_id = &"target_b"\nhit_flash_seconds = 0.8');
  replace(profilePath,'hit_flash_seconds = 0.12','hit_flash_seconds = 0.25');
  if(kind==='packed-scene')replace(templatePath,'max_health = 50.0','max_health = 50.0\nhit_flash_seconds = 0.35');
  if(kind==='balance-profile-script')replace(profilePath,'hit_flash_seconds = 0.25','');
  if(kind==='target-script')replace(scenePath,'balance_profile = ExtResource("2_balance")','balance_profile = null');
  const args={scenePath,sceneText:files.get(scenePath).toString(),files,targetId:'target_b'},description=describeTargetFeedback(args);
  assert.equal(description.defaults.source.kind,kind);assert.equal(description.defaults.values.hitFlashMilliseconds,expected);
  const patch=patchTargetFeedback({...args,binding:description.binding,values:description.defaults.values});
  assert.equal(patch.text,args.sceneText.replace('hit_flash_seconds = 0.8',`hit_flash_seconds = ${expected/1000}`));
  for(const [name,bytes]of files)await fs.writeFile(path.join(project,name),bytes);
  await fs.writeFile(path.join(project,'scenes/default_inherited.tscn'),args.sceneText.replace('\nhit_flash_seconds = 0.8',''));
  await fs.writeFile(path.join(project,'scenes/default_after.tscn'),patch.text);
  await fs.writeFile(path.join(project,'test_default.gd'),`extends SceneTree
var checks: Array[String] = []
var failed := false
func verify(ok: bool, label: String) -> void:
 if not ok:
  failed = true
  push_error("DEFAULT_FAIL " + label)
  quit(1)
  assert(ok, label)
 checks.append(label)
func _initialize() -> void:
 paused = true
 call_deferred("run")
func make_world(scene: String):
 var world = load(scene).instantiate()
 root.add_child(world)
 return world
func run() -> void:
 var restart = "--restart" in OS.get_cmdline_user_args()
 var saved: Dictionary
 if not restart:
  var inherited = make_world("res://scenes/default_inherited.tscn")
  verify(is_equal_approx(inherited.get_node("Targets/TargetB").hit_flash_seconds, ${expected/1000}), "actual inherited value matches parser provenance")
  inherited.free()
  var before = make_world("res://scenes/training_range.tscn")
  verify(is_equal_approx(before.get_node("Targets/TargetB").hit_flash_seconds, 0.8), "current instance override800 remains distinct")
  before.get_node("Targets/TargetA").apply_damage(3.0)
  before.get_node("Targets/TargetB").apply_damage(7.0)
  saved = before.world_state.capture()
  var file = FileAccess.open("res://saved.json", FileAccess.WRITE)
  file.store_string(JSON.stringify(saved))
  file.close()
  before.free()
 else:
  saved = JSON.parse_string(FileAccess.get_file_as_string("res://saved.json"))
 var after = make_world("res://scenes/default_after.tscn")
 verify(after.world_state.apply(saved) == "", "full progress restore accepted")
 verify(JSON.parse_string(JSON.stringify(after.world_state.capture())) == JSON.parse_string(JSON.stringify(saved)), "all progress fields and other targets exactly preserved")
 var selected = after.get_node("Targets/TargetB")
 verify(is_equal_approx(selected.hit_flash_seconds, ${expected/1000}), "selected explicit default survives ready and restore")
 var profile = BalanceProfile.new()
 profile.hit_flash_seconds = 0.7
 profile.apply_to(after)
 verify(is_equal_approx(selected.hit_flash_seconds, ${expected/1000}), "explicit value does not resume dynamic inheritance")
 verify(JSON.parse_string(JSON.stringify(after.world_state.capture())) == JSON.parse_string(JSON.stringify(saved)), "profile configuration does not mutate saved progress")
 print("DEFAULT_RESULT " + JSON.stringify({"passed":not failed,"snapshot":after.world_state.capture(),"restart":restart,"checks":checks,"actualMilliseconds":selected.hit_flash_seconds * 1000.0}))
 after.free()
 await process_frame
 quit(1 if failed else 0)
`);
  for(const [stage,args]of [['import',['--editor','--import']],['verify',['--script','res://test_default.gd']],['restart',['--script','res://test_default.gd','--','--restart']]]){
   const result=spawnSync(bin,['--headless','--path',project,...args],{env,windowsHide:true,encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});
   const log=String(result.stdout??'')+'\n'+String(result.stderr??'');await fs.writeFile(path.join(out,kind+'-'+stage+'.log'),log);
   assert.equal(result.error,undefined);assert.equal(result.status,0,log);assert.doesNotMatch(log,/ERROR:|SCRIPT ERROR|DEFAULT_FAIL/);
   if(stage!=='import'){const line=log.split(/\r?\n/).find(line=>line.startsWith('DEFAULT_RESULT '));assert.ok(line,'Missing engine evidence');const actual=JSON.parse(line.slice(15));assert.equal(actual.passed,true);assert.deepEqual(actual.snapshot,JSON.parse(await fs.readFile(path.join(project,'saved.json'),'utf8')));assert.ok(Math.abs(actual.actualMilliseconds-expected)<1e-6);report.checks.push({kind,stage,defaults:description.defaults,binding:description.binding,sourceHashes:Object.fromEntries([...files].map(([name,b])=>[name,sha(b)])),patchedSceneSha256:sha(patch.text),...actual});console.log('PASS',kind,stage);}
  }
 }
 report.passed=true;
}catch(error){report.failure=String(error.stack||error);process.exitCode=1;console.error(report.failure);}
finally{report.completed=true;report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({out,passed:report.passed,checks:report.checks.length}));}
