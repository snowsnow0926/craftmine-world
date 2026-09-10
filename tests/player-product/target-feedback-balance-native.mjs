// Fixed authored training-range test, not model acceptance. No window/input.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'../..');
const engine=process.argv[2];if(!engine)throw Error('Provide the fixed Godot editor executable path');
const lock=JSON.parse(await fs.readFile(path.join(root,'desktop/godot/toolchain.lock.json'),'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
if(sha(await fs.readFile(engine))!==lock.editor.executableSha256)throw Error('ENGINE_PIN_MISMATCH');
await fs.mkdir(path.join(root,'test-results'),{recursive:true});
const out=await fs.mkdtemp(path.join(root,'test-results/target-balance-'));
const project=path.join(out,'project'),bin=path.join(out,'engine.exe');
await fs.cp(path.join(root,'desktop/godot/bases/first-person'),project,{recursive:true});await fs.copyFile(engine,bin);
let scene=await fs.readFile(path.join(project,'scenes/training_range.tscn'),'utf8');
// Test only: real scene serialization, after the inherited script is attached.
scene=scene.replace('target_id = &"target_b"','target_id = &"target_b"\nhit_flash_seconds = 0.5').replace('target_id = &"target_c"','target_id = &"target_c"\nhit_flash_seconds = 0.12');
await fs.writeFile(path.join(project,'scenes/training_range.tscn'),scene);
const balance=path.join(project,'data/balance/training_range.tres');
await fs.writeFile(balance,(await fs.readFile(balance,'utf8')).replace('hit_flash_seconds = 0.12','hit_flash_seconds = 0.25'));
await fs.writeFile(path.join(project,'scenes/actors/target_template_override.tscn'),(await fs.readFile(path.join(project,'scenes/actors/target_dummy.tscn'),'utf8')).replace('max_health = 50.0','max_health = 50.0\nhit_flash_seconds = 0.12'));
await fs.writeFile(path.join(project,'test_balance.gd'),`extends SceneTree
var checks: Array[String] = []
func check_value(ok: bool, label: String) -> void:
 if not ok:
  print("BALANCE_FAIL " + label)
  quit(1)
  assert(ok, label)
 checks.append(label)
func _initialize() -> void:
 call_deferred("run")
func run() -> void:
 var world = load("res://scenes/training_range.tscn").instantiate()
 root.add_child(world)
 await process_frame
 var a = world.get_node("Targets/TargetA")
 var b = world.get_node("Targets/TargetB")
 var c = world.get_node("Targets/TargetC")
 check_value(is_equal_approx(a.hit_flash_seconds, 0.25), "implicit target inherits 250ms during BaseWorld.ready")
 check_value(is_equal_approx(b.hit_flash_seconds, 0.5), "explicit 500ms survives BaseWorld.ready profile250")
 check_value(is_equal_approx(c.hit_flash_seconds, 0.12), "explicit default120 survives BaseWorld.ready profile250")
 var profile = world.balance_profile.duplicate()
 profile.hit_flash_seconds = 0.7
 profile.apply_to(world)
 check_value(is_equal_approx(a.hit_flash_seconds, 0.7), "inherited target follows repeated profile update700")
 check_value(is_equal_approx(b.hit_flash_seconds, 0.5) and is_equal_approx(c.hit_flash_seconds, 0.12), "both explicit targets survive repeated profile update700")
 var template = load("res://scenes/actors/target_template_override.tscn").instantiate()
 root.add_child(template)
 profile.apply_to(world)
 check_value(is_equal_approx(template.hit_flash_seconds, 0.12), "PackedScene template root explicit120 survives profile700")
 b.apply_damage(7.0)
 var saved = b.snapshot()
 check_value(is_equal_approx(b._flash_remaining, 0.5), "actual damage starts explicit 500ms flash")
 b._process(0.501)
 check_value(b._flash_remaining == 0.0 and b.mesh_instance.material_override == b._base_material, "actual flash restores material")
 check_value(saved.keys().size() == 5 and saved.id == "target_b" and saved.health == 43.0 and saved.hitCount == 1 and saved.damageTaken == 7.0 and saved.destroyed == false, "saved target shape identity and damage unchanged")
 b.reset()
 check_value(b.restore(saved) == "" and b.snapshot() == saved and is_equal_approx(b.hit_flash_seconds, 0.5), "restoring progress leaves instance configuration intact")
 print("BALANCE_RESULT " + JSON.stringify({"passed":true,"checks":checks}))
 world.queue_free()
 template.queue_free()
 await process_frame
 quit(0)
`);
const env={...process.env,APPDATA:path.join(out,'appdata'),LOCALAPPDATA:path.join(out,'local'),USERPROFILE:path.join(out,'home')};
for(const directory of [env.APPDATA,env.LOCALAPPDATA,env.USERPROFILE])await fs.mkdir(directory,{recursive:true});
for(const [name,args]of [['import',['--headless','--path',project,'--editor','--import']],['verify',['--headless','--path',project,'--script','res://test_balance.gd']]]){
 const result=spawnSync(bin,args,{env,windowsHide:true,encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});
 await fs.writeFile(path.join(out,name+'.log'),String(result.stdout??'')+'\n'+String(result.stderr??''));
 if(result.error||result.status!==0||/SCRIPT ERROR|BALANCE_FAIL/.test(result.stdout+result.stderr))throw Error(name+' failed: '+out+' '+String(result.error??result.status));
 if(name==='verify'){
  const line=result.stdout.split(/\r?\n/).find(line=>line.startsWith('BALANCE_RESULT '));if(!line)throw Error('No actual engine result: '+out);
  const report={...JSON.parse(line.slice(15)),engineSha256:lock.editor.executableSha256,source:Object.fromEntries(await Promise.all(['target_dummy.gd','balance_profile.gd'].map(async file=>[file,sha(await fs.readFile(path.join(project,'scripts/core',file)))]))),out};
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 }
}
