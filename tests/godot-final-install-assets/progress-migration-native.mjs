import fs from'node:fs';import path from'node:path';import os from'node:os';import assert from'node:assert/strict';import{materializeBase}from'../../desktop/godot/shared/materialize.mjs';import{createGodotProbeEnvironment}from'../../desktop/godot/toolchain.mjs';import{deriveAdditiveProgress}from'../../desktop/godot/shared/progress-migration.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'progress-migration-')),project=path.join(root,'project'),report={root,passed:false,checks:[],runs:[]};console.log('MIGRATION_ROOT='+root);
try{
 materializeBase({baseId:'first-person',worldId:'migration-alpha',template:'training-range',out:project});
 const driver=`extends Node
var runtime: Node
func _ready() -> void:
 process_mode = Node.PROCESS_MODE_ALWAYS
 run.call_deferred()
func request(op: String, args: Dictionary = {}) -> Dictionary:
 return await runtime.handle_request({"worldId":"migration-alpha","buildId":"authored-migration","instanceId":"fixture","op":op,"args":args})
func must(value: bool, message: String) -> void:
 if not value:
  push_error(message)
  get_tree().quit(2)
func state() -> Dictionary:
 var result := await request("snapshot")
 must(not result.has("error"), "snapshot failed")
 return result.result.state
func run() -> void:
 runtime = get_tree().root.get_node("CraftmineRuntime")
 for _frame in range(600):
  if runtime.initialized:
   break
  await get_tree().process_frame
 must(runtime.initialized, "runtime not ready")
 var loaded := await request("load", {"snapshot":null})
 must(not loaded.has("error"), "initial load failed")
 if "--capture-old" in OS.get_cmdline_user_args():
  get_tree().current_scene.get_node("Targets/TargetA").apply_damage(17.0)
  await request("resume")
  var equipped := await request("equip", {"value":"practice_sword"})
  must(not equipped.has("error"), "equip failed")
  await request("pause")
  print("MIGRATION_STATE=" + JSON.stringify(await state()))
 elif "--capture-defaults" in OS.get_cmdline_user_args():
  print("MIGRATION_STATE=" + JSON.stringify(await state()))
 else:
  var merged: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://merged.json"))
  var applied := await request("load", {"snapshot":merged})
  must(not applied.has("error"), "merged load failed: " + str(applied.get("error")))
  var before := await state()
  var reordered := merged.duplicate(true)
  reordered.body.targets.reverse()
  applied = await request("restore-state", {"state":reordered})
  must(not applied.has("error"), "stable ID reorder failed")
  must(JSON.stringify(await state()) == JSON.stringify(before), "reorder changed state")
  for mode in ["duplicate", "unknown", "missing", "invalid"]:
   var bad := merged.duplicate(true)
   if mode == "duplicate":
    bad.body.targets[1].id = bad.body.targets[0].id
   elif mode == "unknown":
    bad.body.targets[0].id = "foreign-id"
   elif mode == "missing":
    bad.body.targets.pop_back()
   else:
    bad.body.targets[-1].health = -1
   var rejected := await request("restore-state", {"state":bad})
   must(rejected.has("error"), "bad state accepted: " + mode)
   must(JSON.stringify(await state()) == JSON.stringify(before), "rejected restore mutated old state: " + mode)
  if "--damage-added" in OS.get_cmdline_user_args():
   get_tree().current_scene.get_node("Targets/AAAdded").apply_damage(5.0)
   before = await state()
  print("MIGRATION_STATE=" + JSON.stringify(before))
 get_tree().quit(0)
`;
 fs.writeFileSync(path.join(project,'migration_fixture.gd'),driver);const config=path.join(project,'project.godot');fs.writeFileSync(config,fs.readFileSync(config,'utf8').replace('[autoload]','[autoload]\nMigrationFixture="*res://migration_fixture.gd"'));
 const engine=await createGodotProbeEnvironment(root);report.runs=engine.runs;await engine.run('import',['--path',project,'--editor','--import']);const capture=async(label,arg)=>{const text=await engine.run(label,['--path',project,'--',arg]);return JSON.parse(text.split(/\r?\n/).find(line=>line.startsWith('MIGRATION_STATE=')).slice('MIGRATION_STATE='.length));};
 const previous=await capture('old','--capture-old');assert.equal(previous.body.targets.find(x=>x.id==='target_a').health,33);assert.equal(previous.body.equipment.active,'practice_sword');report.previous=previous;
 const scene=path.join(project,'scenes/training_range.tscn');fs.appendFileSync(scene,'\n[node name="AAAdded" parent="Targets" instance=ExtResource("11_target")]\nposition = Vector3(4, 0, -8)\ntarget_id = &"added-target"\nmax_health = 73.0\n');
 const defaults=await capture('defaults','--capture-defaults');report.defaults=defaults;assert.equal(defaults.body.targets.length,4);assert.equal(defaults.body.targets.find(x=>x.id==='added-target').health,73);
 const migration=deriveAdditiveProgress(previous,defaults);report.migration=migration;fs.writeFileSync(path.join(project,'merged.json'),JSON.stringify(migration.snapshot));const restored=await capture('restore','--verify-merged');report.restored=restored;assert.deepEqual(restored,migration.snapshot);assert.equal(restored.body.targets.find(x=>x.id==='target_a').health,33);assert.equal(restored.body.targets.find(x=>x.id==='added-target').health,73);assert.equal(restored.body.equipment.active,'practice_sword');
 const modified=await capture('damage-added','--damage-added');assert.equal(modified.body.targets.find(x=>x.id==='added-target').health,68);
 fs.appendFileSync(scene,'\n[node name="ABSecond" parent="Targets" instance=ExtResource("11_target")]\nposition = Vector3(5, 0, -8)\ntarget_id = &"second-target"\nmax_health = 61.0\n');
 const secondDefaults=await capture('second-defaults','--capture-defaults'),secondMigration=deriveAdditiveProgress(modified,secondDefaults);fs.writeFileSync(path.join(project,'merged.json'),JSON.stringify(secondMigration.snapshot));const secondRestored=await capture('second-restore','--verify-merged');assert.deepEqual(secondRestored,secondMigration.snapshot);assert.equal(secondRestored.body.targets.find(x=>x.id==='target_a').health,33);assert.equal(secondRestored.body.targets.find(x=>x.id==='added-target').health,68);assert.equal(secondRestored.body.targets.find(x=>x.id==='second-target').health,61);report.second={modified,defaults:secondDefaults,migration:secondMigration,restored:secondRestored};
 report.checks=['Actual old damage and equipment preserved','New target defaults captured from actual new scene','Complete migrated native round trip exact','Stable ID restore accepts reordered entries','Duplicate, unknown, missing and invalid state rejected with full rollback','Second additive installation preserves both old and first-installed damaged entities'];report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}finally{fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({root,passed:report.passed,checks:report.checks,error:report.error}));}
