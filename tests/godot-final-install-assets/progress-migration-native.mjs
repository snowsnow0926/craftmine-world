import fs from'node:fs';import path from'node:path';import os from'node:os';import assert from'node:assert/strict';import{materializeBase}from'../../desktop/godot/shared/materialize.mjs';import{createGodotProbeEnvironment}from'../../desktop/godot/toolchain.mjs';import{deriveAdditiveProgress}from'../../desktop/godot/shared/progress-migration.mjs';
// Evidence is kept on the D: drive with the rest of this workstream; every run
// is a separate headless process with its own redirected user profile and no
// input device, pointer lock or visible window.
const workspace=process.env.CRAFTMINE_MIGRATION_TMP_ROOT??'D:/cm-pi-p1-save-20260910-tmp';fs.mkdirSync(workspace,{recursive:true});
const root=fs.mkdtempSync(path.join(workspace,'progress-migration-')),project=path.join(root,'project'),report={root,passed:false,checks:[],runs:[]};console.log('MIGRATION_ROOT='+root);
const hammerSource=`[gd_resource type="Resource" script_class="EquipmentDefinition" load_steps=5 format=3]

[ext_resource type="Script" path="res://scripts/core/equipment_definition.gd" id="1_script"]
[ext_resource type="Mesh" path="res://assets/meshes/weapon_sword.obj" id="2_mesh"]
[ext_resource type="Material" path="res://assets/materials/sword_blade.tres" id="3_material"]
[ext_resource type="Resource" path="res://data/ui/crosshair_melee.tres" id="4_crosshair"]

[resource]
script = ExtResource("1_script")
id = &"thunder_hammer"
display_name = "Thunder hammer"
description = "Heavy melee hammer added by the author after the first save was written."
attack_mode = 2
damage = 35.0
cooldown_seconds = 0.9
range_meters = 2.4
pellets = 1
spread_degrees = 0.0
melee_arc_degrees = 75.0
hit_mask = 2
magazine_size = 0
reload_seconds = 0.0
starting_ammo = 0
starting_reserve = 0
display_mesh = ExtResource("2_mesh")
display_material = ExtResource("3_material")
mount_offset = Vector3(0.3, -0.34, -0.5)
mount_rotation_degrees = Vector3(-8, 4, 0)
display_scale = Vector3(1, 1, 1)
crosshair_visible = false
crosshair_style = ExtResource("4_crosshair")
`;
const withoutSavedAt=value=>{const copy=JSON.parse(JSON.stringify(value));copy.body.savedAt='<savedAt>';return copy;};
try{
 materializeBase({baseId:'first-person',worldId:'migration-alpha',template:'training-range',out:project});
 const driver=`extends Node
var runtime: Node
var world: Node
func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	run.call_deferred()
func request(op: String, args: Dictionary = {}) -> Dictionary:
	return await runtime.handle_request({"worldId":"migration-alpha","buildId":"authored-migration","instanceId":"fixture","op":op,"args":args})
func must(value: bool, message: String) -> void:
	if not value:
		push_error(message)
		get_tree().quit(2)
func report(tag: String, value) -> void:
	print(tag + JSON.stringify(value))
func state() -> Dictionary:
	var result := await request("snapshot")
	must(not result.has("error"), "snapshot failed")
	return result.result.state
func boot() -> void:
	runtime = get_tree().root.get_node("CraftmineRuntime")
	for _frame in range(600):
		if runtime.initialized:
			break
		await get_tree().process_frame
	must(runtime.initialized, "runtime not ready")
	world = get_tree().current_scene
	var loaded := await request("load", {"snapshot": null})
	must(not loaded.has("error"), "initial load failed")
func entry(items: Array, id: String) -> Dictionary:
	for item in items:
		if item.id == id:
			return item
	return {}
func capture_old() -> void:
	var equipped := await state()
	must(equipped.body.equipment.active == "pistol", "the authored default item is not active")
	await request("resume")
	# Fire from the real weapon so the old save carries its own ammunition, then
	# aim away from the targets so only the rounds and the reload change.
	await request("look", {"yaw": 2.6, "pitch": 0.0})
	var shot: Dictionary = await request("attack")
	must(shot.has("result") and shot.result.get("fired", false), "first pistol shot was blocked")
	await request("wait", {"frames": 40})
	shot = await request("attack")
	must(shot.has("result") and shot.result.get("fired", false), "second pistol shot was blocked")
	await request("wait", {"frames": 40})
	var reloaded: Dictionary = await request("reload")
	must(reloaded.has("result") and reloaded.result.get("reloaded", false), "reload was blocked")
	await request("wait", {"frames": 180})
	shot = await request("attack")
	must(shot.has("result") and shot.result.get("fired", false), "shot after the reload was blocked")
	await request("look", {"yaw": 0.0, "pitch": 0.0})
	get_tree().current_scene.get_node("Targets/TargetA").apply_damage(17.0)
	var selected: Dictionary = await request("equip", {"value": "practice_sword"})
	must(not selected.has("error"), "equip failed")
	await request("pause")
	var previous := await state()
	must(previous.body.equipment.active == "practice_sword", "the old selection was not captured")
	var pistol := entry(previous.body.equipment.items, "pistol")
	must(pistol.get("magazine", -1) == 5 and pistol.get("reserve", -1) == 10, "old ammunition was not captured")
	must(entry(previous.body.targets, "target_a").get("health", 0.0) == 33.0, "old damage was not captured")
	report("MIGRATION_STATE=", previous)
func stale_load() -> void:
	var previous: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://previous.json"))
	must(not previous.is_empty(), "previous snapshot missing")
	var attempted := await request("load", {"snapshot": previous})
	report("MIGRATION_STALE=", {"rejected": attempted.has("error"), "error": str(attempted.get("error", ""))})
	report("MIGRATION_STATE=", await state())
func merged_round(damage_added: bool) -> void:
	var merged: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://merged.json"))
	var applied := await request("load", {"snapshot": merged})
	must(not applied.has("error"), "merged load failed: " + str(applied.get("error")))
	var before := await state()
	var reordered := merged.duplicate(true)
	reordered.body.targets.reverse()
	applied = await request("restore-state", {"state": reordered})
	must(not applied.has("error"), "stable ID reorder failed")
	must(JSON.stringify(await state()) == JSON.stringify(before), "reorder changed state")
	for mode in ["duplicate", "unknown", "missing", "invalid", "equipment-missing", "equipment-foreign", "equipment-negative", "equipment-fraction", "equipment-active"]:
		var bad := merged.duplicate(true)
		match mode:
			"duplicate":
				bad.body.targets[1].id = bad.body.targets[0].id
			"unknown":
				bad.body.targets[0].id = "foreign-id"
			"missing":
				bad.body.targets.pop_back()
			"invalid":
				bad.body.targets[-1].health = -1
			"equipment-missing":
				bad.body.equipment.items.pop_back()
			"equipment-foreign":
				bad.body.equipment.items[0].id = "foreign_tool"
			"equipment-negative":
				bad.body.equipment.items[0].magazine = -1
			"equipment-fraction":
				bad.body.equipment.items[0].magazine = 1.5
			"equipment-active":
				bad.body.equipment.active = "missing_item"
		var rejected := await request("restore-state", {"state": bad})
		must(rejected.has("error"), "bad state accepted: " + mode)
		must(JSON.stringify(await state()) == JSON.stringify(before), "rejected restore mutated old state: " + mode)
	# Durable save, shaped like the standalone preview bootstrap: pause, ask the
	# runtime for the complete confirmed progress, and write it with a checksum.
	var paused := await request("pause")
	must(not paused.has("error"), "pause failed")
	var confirmed: Dictionary = await request("save")
	must(not confirmed.has("error"), "durable save was refused: " + str(confirmed.get("error", "")))
	var text := JSON.stringify(confirmed.result.state)
	must(DirAccess.make_dir_recursive_absolute(durable_folder()) == OK, "durable folder could not be created")
	var file := FileAccess.open(durable_folder() + "/state.json", FileAccess.WRITE)
	must(file != null, "durable save could not be opened")
	file.store_string(JSON.stringify({"format": "craftmine.migration-fixture-save/1", "worldId": "migration-alpha", "snapshotText": text, "snapshotSha256": text.sha256_text()}))
	file.flush()
	file.close()
	report("MIGRATION_SAVE=", {"file": durable_folder() + "/state.json", "exists": FileAccess.file_exists(durable_folder() + "/state.json"), "bytes": text.to_utf8_buffer().size(), "sha256": text.sha256_text()})
	if damage_added:
		get_tree().current_scene.get_node("Targets/AAAdded").apply_damage(5.0)
		before = await state()
	report("MIGRATION_STATE=", before)
func durable_folder() -> String:
	return "user://migration-fixture"
func load_durable(tag: String) -> void:
	var location := durable_folder() + "/state.json"
	must(FileAccess.file_exists(location), "the durable save is missing")
	var record: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(location))
	must(record.get("format", "") == "craftmine.migration-fixture-save/1", "durable save format is not supported")
	var text: String = record.snapshotText
	must(text.sha256_text() == record.snapshotSha256, "durable save checksum does not match")
	var applied := await request("load", {"snapshot": JSON.parse_string(text)})
	must(not applied.has("error"), "reopened progress was refused: " + str(applied.get("error", "")))
	report("MIGRATION_DISK=", {"exists": true, "file": location, "bytes": text.to_utf8_buffer().size(), "sha256": record.snapshotSha256})
	report(tag, await state())
func reopen() -> void:
	await load_durable("MIGRATION_STATE=")
func use_added() -> void:
	await load_durable("MIGRATION_REOPENED=")
	await request("resume")
	var selected: Dictionary = await request("equip", {"value": "thunder_hammer"})
	must(not selected.has("error"), "the added item could not be equipped: " + str(selected.get("error", "")))
	var walked: Dictionary = await request("walk", {"forward": 1.0, "frames": 300})
	must(walked.has("result"), "walk failed")
	report("MIGRATION_WALK=", {"before": walked.result.before.position, "after": walked.result.after.position})
	# A melee arc is centred on the camera aim, so look at the dummy before swinging.
	var aimed: Dictionary = await request("look", {"yaw": 0.0, "pitch": -0.7})
	must(not aimed.has("error"), "aim failed")
	var attack: Dictionary = await request("attack")
	must(attack.has("result"), "attack failed")
	must(attack.result.get("fired", false) and attack.result.get("hit", false), "the added weapon did not reach the target")
	report("MIGRATION_ATTACK=", {"fired": attack.result.get("fired", false), "hit": attack.result.get("hit", false), "damage": attack.result.get("damage", 0.0), "equipment": attack.result.get("equipment", ""), "attackMode": attack.result.get("attackMode", ""), "reach": attack.result.get("reach", 0.0), "arcDegrees": attack.result.get("arcDegrees", 0.0), "hits": attack.result.get("hits", [])})
	report("MIGRATION_STATE=", await state())
func run() -> void:
	await boot()
	var flags := OS.get_cmdline_user_args()
	if "--capture-old" in flags:
		await capture_old()
	elif "--capture-defaults" in flags:
		report("MIGRATION_STATE=", await state())
	elif "--stale-load" in flags:
		await stale_load()
	elif "--reopen" in flags:
		await reopen()
	elif "--use-added" in flags:
		await use_added()
	else:
		await merged_round("--damage-added" in flags)
	get_tree().quit(0)
`;
 fs.writeFileSync(path.join(project,'migration_fixture.gd'),driver);const config=path.join(project,'project.godot');fs.writeFileSync(config,fs.readFileSync(config,'utf8').replace('[autoload]','[autoload]\nMigrationFixture="*res://migration_fixture.gd"'));
 const engine=await createGodotProbeEnvironment(root);report.runs=engine.runs;await engine.run('import',['--path',project,'--editor','--import']);
 const run=async(label,args)=>{const text=await engine.run(label,['--path',project,'--',...args]);const read=tag=>{const line=text.split(/\r?\n/).find(candidate=>candidate.startsWith(tag));return line===undefined?undefined:JSON.parse(line.slice(tag.length));};return{state:read('MIGRATION_STATE='),reopened:read('MIGRATION_REOPENED='),stale:read('MIGRATION_STALE='),save:read('MIGRATION_SAVE='),disk:read('MIGRATION_DISK='),walk:read('MIGRATION_WALK='),attack:read('MIGRATION_ATTACK=')};};
 const previous=(await run('old',['--capture-old'])).state;
 assert.equal(previous.body.targets.find(x=>x.id==='target_a').health,33);assert.equal(previous.body.equipment.active,'practice_sword');assert.deepEqual(previous.body.equipment.items.find(x=>x.id==='pistol'),{id:'pistol',magazine:5,reserve:10});assert.equal(previous.body.equipment.items.length,3);report.previous=previous;
 // The candidate source gains one equipment definition and one catalog entry in
 // an independent source copy. Nothing else in the old save is rewritten.
 const scene=path.join(project,'scenes/training_range.tscn');fs.appendFileSync(scene,'\n[node name="AAAdded" parent="Targets" instance=ExtResource("11_target")]\nposition = Vector3(4, 0, -8)\ntarget_id = &"added-target"\nmax_health = 73.0\n');
 fs.writeFileSync(path.join(project,'data/equipment/thunder_hammer.tres'),hammerSource);
 const catalog=path.join(project,'data/equipment/equipment_catalog.tres');fs.writeFileSync(catalog,fs.readFileSync(catalog,'utf8').replace('load_steps=5','load_steps=6').replace('[resource]','[ext_resource type="Resource" path="res://data/equipment/thunder_hammer.tres" id="5_hammer"]\n\n[resource]').replace('ExtResource("4_tool")])','ExtResource("4_tool"), ExtResource("5_hammer")])'));
 fs.writeFileSync(path.join(project,'previous.json'),JSON.stringify(previous));
 await engine.run('import-added',['--path',project,'--editor','--import']);
 const defaults=(await run('defaults',['--capture-defaults'])).state;report.defaults=defaults;
 assert.equal(defaults.body.targets.length,4);assert.equal(defaults.body.targets.find(x=>x.id==='added-target').health,73);
 assert.equal(defaults.body.equipment.items.length,4);assert.deepEqual(defaults.body.equipment.items[3],{id:'thunder_hammer',magazine:0,reserve:0});assert.equal(defaults.body.equipment.active,'pistol');
 // Without the migration the old save is genuinely refused by the new candidate,
 // and the refusal leaves the running world untouched.
 const stale=await run('stale',['--stale-load']);report.stale=stale;
 assert.equal(stale.stale.rejected,true);assert.match(stale.stale.error,/thunder_hammer/);assert.deepEqual(withoutSavedAt(stale.state),withoutSavedAt(defaults));
 const migration=deriveAdditiveProgress(previous,defaults);report.migration=migration;
 assert.deepEqual(migration.added,[{path:'/body/targets',id:'added-target'},{path:'/body/equipment/items',id:'thunder_hammer'}]);
 fs.writeFileSync(path.join(project,'merged.json'),JSON.stringify(migration.snapshot));
 const restored=await run('restore',['--verify-merged']);report.restored=restored.state;assert.deepEqual(restored.state,migration.snapshot);assert.deepEqual(restored.save.exists,true);
 assert.equal(restored.state.body.targets.find(x=>x.id==='target_a').health,33);assert.equal(restored.state.body.targets.find(x=>x.id==='added-target').health,73);
 assert.equal(restored.state.body.equipment.active,'practice_sword');assert.deepEqual(restored.state.body.equipment.items.find(x=>x.id==='pistol'),{id:'pistol',magazine:5,reserve:10});assert.deepEqual(restored.state.body.equipment.items.find(x=>x.id==='thunder_hammer'),{id:'thunder_hammer',magazine:0,reserve:0});
 // Durable save in one process, reopen in a fresh one.
 report.save=restored.save;
 const reopened=await run('reopen',['--reopen']);report.reopened=reopened;assert.equal(reopened.disk.exists,true);assert.ok(reopened.disk.bytes>0);assert.deepEqual(withoutSavedAt(reopened.state),withoutSavedAt(migration.snapshot));
 const used=await run('use-added',['--use-added']);report.used=used;
 assert.ok(used.walk.after[2]<used.walk.before[2]-5,'the player did not walk to the target');
 assert.deepEqual(withoutSavedAt(used.reopened),withoutSavedAt(migration.snapshot));
 assert.equal(used.attack.fired,true);assert.equal(used.attack.equipment,'thunder_hammer');assert.equal(used.attack.attackMode,'MELEE');assert.equal(used.attack.hit,true);assert.equal(used.attack.damage,35);
 assert.equal(used.state.body.targets.find(x=>x.id==='target_b').health,15);assert.equal(used.state.body.equipment.active,'thunder_hammer');
 assert.equal(used.state.body.targets.find(x=>x.id==='target_a').health,33);
 const modified=await run('damage-added',['--damage-added']);report.modified=modified.state;assert.equal(modified.state.body.targets.find(x=>x.id==='added-target').health,68);
 fs.appendFileSync(scene,'\n[node name="ABSecond" parent="Targets" instance=ExtResource("11_target")]\nposition = Vector3(5, 0, -8)\ntarget_id = &"second-target"\nmax_health = 61.0\n');
 await engine.run('import-second',['--path',project,'--editor','--import']);
 const secondDefaults=(await run('second-defaults',['--capture-defaults'])).state,secondMigration=deriveAdditiveProgress(modified.state,secondDefaults);report.second={modified:modified.state,defaults:secondDefaults,migration:secondMigration};
 assert.equal(secondDefaults.body.targets.length,5);assert.equal(secondMigration.snapshot.body.equipment.items.length,4);
 fs.writeFileSync(path.join(project,'merged.json'),JSON.stringify(secondMigration.snapshot));
 const secondRestored=await run('second-restore',['--verify-merged']);report.second.restored=secondRestored.state;assert.deepEqual(secondRestored.state,secondMigration.snapshot);
 assert.equal(secondRestored.state.body.targets.find(x=>x.id==='target_a').health,33);assert.equal(secondRestored.state.body.targets.find(x=>x.id==='added-target').health,68);assert.equal(secondRestored.state.body.targets.find(x=>x.id==='second-target').health,61);
 assert.deepEqual(secondRestored.state.body.equipment.items.find(x=>x.id==='pistol'),{id:'pistol',magazine:5,reserve:10});
 const secondReopened=await run('second-reopen',['--reopen']);report.second.reopened=secondReopened;assert.equal(secondReopened.disk.exists,true);assert.deepEqual(withoutSavedAt(secondReopened.state),withoutSavedAt(secondMigration.snapshot));
 report.checks=['Old save carries real damage, real fired rounds, a changed selection and its own reloads','New equipment definition and catalog entry were added to an independent candidate source copy','Every default was captured from a fresh process running that candidate scene','The unmigrated old save is still refused by the new candidate and the refusal leaves state untouched','Migration keeps every old entry, the old selection and both new scene identities','Complete migrated native round trip is exact, including the added equipment','Durable save in one process and reopen in a fresh process return the same progress','The added melee item is equipped and deals its authored damage to a real target after the reopen','Stable ID restore accepts reordered entries','Duplicate, unknown, missing, invalid, negative and fractional state is rejected with full rollback','Second additive installation preserves both earlier rounds and the added equipment'];report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}finally{fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({root,passed:report.passed,checks:report.checks,error:report.error}));}
