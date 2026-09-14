extends SceneTree

var checks: Array[String] = []
var errors: Array[String] = []
var evidence: Dictionary = {}

func _initialize() -> void:
	call_deferred("run")

func check(condition: bool, label: String) -> void:
	checks.append(label)
	if not condition: errors.append(label)

func run() -> void:
	var world := load("res://scenes/creation.tscn").instantiate() as Node3D
	var player := world.get_node("Player") as CharacterBody3D
	player.set("capture_mouse_on_click", false)
	player.set("input_enabled", false)
	var encounter := load("res://addons/cw.module.promo-monsters/encounter.tscn").instantiate() as Node3D
	encounter.entity_id = "test-promo-encounter"
	world.add_child(encounter)
	root.add_child(world)
	current_scene = world
	await process_frame
	await physics_frame
	var core: Node3D = encounter.context
	check(core != null, "one invisible context exists")
	check(get_nodes_in_group("craftmine_promo_context").size() == 1, "one context per player")
	check(core.current_weapon() == null, "monsters do not equip a weapon")
	check(core.monsters.size() == 6, "original six hornlings exist")
	check(get_nodes_in_group("craftmine_persistent_components").size() == 8, "root core and six derived persistent identities")
	var identities := {}
	for component in get_nodes_in_group("craftmine_persistent_components"):
		check(not identities.has(component.entity_id), "unique component identity " + component.entity_id)
		identities[component.entity_id] = true
	var registry: RefCounted = load("res://component_state.gd").new()
	var captured: Dictionary = registry.capture(world)
	evidence.initial = captured
	check(captured.error == "", "actual registry accepts stage one")
	var monster: Node3D = core.monsters[0]
	var health_before: int = core.health
	core.damage_player(25)
	check(core.health == health_before, "conversation input gate prevents player damage")
	var pose_before: Vector3 = monster.global_position
	for i in range(10): await physics_frame
	check(monster.global_position == pose_before, "conversation input gate pauses hostile simulation")
	player.set("input_enabled", true)
	core.damage_player(25)
	check(core.health == 75, "original player damage works in play mode")
	check(monster.take_hit(30, Vector3.FORWARD), "original hornling hit path applies")
	check(monster.health == 30, "original hornling health preserved")
	player.set("input_enabled", false)
	var stored: Dictionary = core.snapshot()
	check(core.restore(stored) == "" and core.snapshot() == stored, "shared player state exact restore")
	var monster_state: Dictionary = monster.snapshot()
	check(monster.restore(monster_state) == "" and monster.snapshot() == monster_state, "hornling state exact restore")
	var blade := load("res://addons/cw.module.promo-heavyblade/blade.tscn").instantiate() as Node3D
	blade.entity_id = "test-promo-blade"
	world.add_child(blade)
	await process_frame
	await physics_frame
	check(core.snapshot() == stored, "adding blade preserves player health and selection")
	check(monster.snapshot() == monster_state, "adding blade preserves original monster state")
	check(get_nodes_in_group("craftmine_promo_context").size() == 1, "blade reuses invisible context")
	check(blade.boss == null and blade.barrier == null, "blade does not create boss or arena")
	check(core.current_weapon() == blade and blade.blade.visible, "standalone blade is equipped")
	check(registry.capture(world).error == "", "actual registry accepts blade without hunt")
	player.global_position = monster.global_position + Vector3(0, 0.92, 3.2)
	player.call("set_look", 0.0, 0.0)
	await physics_frame
	player.set("input_enabled", true)
	var slash := InputEventKey.new()
	slash.physical_keycode = KEY_J
	slash.pressed = true
	blade._unhandled_input(slash)
	for i in range(18): await physics_frame
	player.set("input_enabled", false)
	check(monster.health == 0, "original light slash kills hornling before hunt exists")
	check(blade.stamina < 100, "slash consumes original stamina")
	var blade_state: Dictionary = blade.snapshot()
	check(blade.restore(blade_state) == "" and blade.snapshot() == blade_state, "blade action state exact restore without boss")
	var before_hunt_player: Dictionary = player.snapshot()
	var hunt := load("res://addons/cw.module.promo-hunt/hunt.tscn").instantiate() as Node3D
	hunt.entity_id = "test-promo-hunt"
	world.add_child(hunt)
	await process_frame
	await physics_frame
	check(player.snapshot() == before_hunt_player, "installing hunt does not teleport player")
	check(blade.snapshot() == blade_state, "adding hunt preserves previous blade action progress")
	evidence.huntPlacement = hunt.validate_placement()
	check(evidence.huntPlacement == "", "explicit arena footprint is physically flat and clear")
	check(blade.boss == hunt.boss and blade.blade != null, "hunt reuses existing blade")
	player.set("input_enabled", true)
	var start := InputEventKey.new()
	start.physical_keycode = KEY_H
	start.pressed = true
	blade._unhandled_input(start)
	await physics_frame
	await physics_frame
	player.set("input_enabled", false)
	check(blade.status == "active" and hunt.boss.phase != "idle", "ordinary H starts original beast trial")
	check(blade.attempts == 1 and blade.health == 100, "explicit trial start initializes trial resources")
	check(not core.hud.visible and not core.damage_flash.visible, "trial entry hides old health HUD and damage overlay immediately")
	var paused_timers := [core.health, core.invulnerable, core.since_damage, core.flash_time]
	core._update_hud()
	check([core.health, core.invulnerable, core.since_damage, core.flash_time] == paused_timers, "HUD synchronization does not advance paused combat resources")
	var boss_before: Dictionary = hunt.boss.snapshot()
	for i in range(12): await physics_frame
	check(hunt.boss.snapshot() == boss_before, "conversation pauses beast simulation")
	check(registry.capture(world).error == "", "actual ledger accepts active hunt and prior modules")
	player.set("input_enabled", true)
	for i in range(360): await physics_frame
	player.set("input_enabled", false)
	check(blade.health < 100, "original moving beast attacks and hurts player")
	evidence.huntAfterAI = {"health":blade.health,"boss":hunt.boss.snapshot()}
	var hunt_state: Dictionary = hunt.snapshot()
	check(hunt.restore(hunt_state) == "" and hunt.snapshot() == hunt_state, "beast combat phase exact restore")
	check(hunt.validate_restored_state() == "", "trial and beast state remain consistent")
	var complete_saved: Dictionary = registry.capture(world)
	check(registry.restore(world, complete_saved.states, true) == "", "actual registry restores whole split combat ledger")
	var prior_states: Dictionary = registry.capture(world).states
	var rifle := load("res://addons/cw.module.promo-ak47/rifle.tscn").instantiate() as Node3D
	rifle.entity_id = "test-promo-rifle"
	world.add_child(rifle)
	await process_frame
	await physics_frame
	var with_rifle: Dictionary = registry.capture(world)
	for id in prior_states:
		check(with_rifle.states[id] == prior_states[id], "adding rifle preserves " + id)
	check(core.current_weapon() == rifle, "auto selection equips newly available rifle")
	blade._update_hud()
	check(blade.controls.text.contains("连射") and not blade.controls.text.contains("轻斩"), "active trial HUD describes equipped rifle rather than blade controls")
	check(core.select_weapon("blade"), "ordinary selection can select installed blade")
	check(core.current_weapon() == blade and not rifle.equipped, "exactly one equipment owns attack input")
	check(core.select_weapon("rifle"), "ordinary selection can return to rifle")
	player.set("input_enabled", true)
	var fire := InputEventKey.new()
	fire.physical_keycode = KEY_J
	fire.pressed = true
	rifle._unhandled_input(fire)
	for i in range(20): await physics_frame
	fire.pressed = false
	rifle._unhandled_input(fire)
	player.set("input_enabled", false)
	check(rifle.shots > 0 and rifle.rounds < 30, "rifle normal fire input consumes ammunition")
	check(blade.action == "none", "rifle fire does not start a blade slash")
	var ammo_before: Dictionary = rifle.snapshot()
	for i in range(10): await physics_frame
	check(rifle.snapshot() == ammo_before, "conversation pauses rifle state and releases triggers")
	check(rifle.restore(ammo_before) == "" and rifle.snapshot() == ammo_before, "rifle ammunition and timers exact restore")
	var final_saved: Dictionary = registry.capture(world)
	check(final_saved.error == "", "full combat family captures through actual component ledger")
	var save_file := FileAccess.open("user://promo-combat-save.json", FileAccess.WRITE)
	save_file.store_string(JSON.stringify({"player":player.snapshot(),"components":final_saved.states}))
	save_file.close()
	blade._return()
	blade._update_hud()
	check(core.hud.visible and core.damage_flash.visible, "leaving trial immediately restores encounter HUD visibility")
	check(not blade.notice.contains("小麦") and not blade.notice.contains("树林"), "return text describes only existing world content")
	check(player.get("captured") == false, "test never captures input")
	world.queue_free()
	await process_frame
	await solo_equipment("heavyblade", "blade.tscn")
	await solo_equipment("ak47", "rifle.tscn")
	await conflict_guards()
	print("PROMO_COMBAT_RESULT=" + JSON.stringify({"checks":checks,"errors":errors,"evidence":evidence}))
	quit(0 if errors.is_empty() else 1)

func solo_equipment(stage: String, scene_name: String) -> void:
	var world := load("res://scenes/creation.tscn").instantiate() as Node3D
	var player := world.get_node("Player") as CharacterBody3D
	player.set("capture_mouse_on_click", false)
	player.set("input_enabled", false)
	var equipment := load("res://addons/cw.module.promo-" + stage + "/" + scene_name).instantiate() as Node3D
	equipment.entity_id = "test-solo-equipment"
	world.add_child(equipment)
	root.add_child(world)
	current_scene = world
	await process_frame
	await physics_frame
	var core: Node3D = equipment.context
	check(core.monsters.is_empty() and core.module("hunt") == null, stage + " alone creates no monsters or hunt")
	check(core.current_weapon() == equipment, stage + " alone is equipped")
	check(get_nodes_in_group("craftmine_persistent_components").size() == 2, stage + " has only equipment and invisible player context")
	var registry: RefCounted = load("res://component_state.gd").new()
	check(registry.capture(world).error == "", stage + " solo ledger valid")
	if stage == "ak47":
		player.set("input_enabled", true)
		var fire := InputEventKey.new()
		fire.physical_keycode = KEY_J
		fire.pressed = true
		equipment._unhandled_input(fire)
		for i in range(20): await physics_frame
		fire.pressed = false
		equipment._unhandled_input(fire)
		check(equipment.shots > 0, "AK fires without blade, boss or small monsters")
		var reload_event := InputEventKey.new()
		reload_event.physical_keycode = KEY_R
		reload_event.pressed = true
		equipment._unhandled_input(reload_event)
		for i in range(145): await physics_frame
		check(equipment.rounds == 30 and equipment.reload_remaining == 0, "AK reload works without earlier stages")
		player.set("input_enabled", false)
		var prior_ammo: Dictionary = equipment.snapshot()
		var encounter := load("res://addons/cw.module.promo-monsters/encounter.tscn").instantiate() as Node3D
		encounter.entity_id = "test-later-monsters"
		world.add_child(encounter)
		await process_frame
		await physics_frame
		check(equipment.snapshot() == prior_ammo, "installing monsters after AK preserves ammunition and shot count")
		var target: Node3D = core.monsters[0]
		player.global_position = target.global_position + Vector3(0, 0.92, 5)
		player.call("set_look", 0.0, -0.14)
		await physics_frame
		player.set("input_enabled", true)
		fire.pressed = true
		equipment._unhandled_input(fire)
		for i in range(20): await physics_frame
		fire.pressed = false
		equipment._unhandled_input(fire)
		check(target.health < target.max_health, "AK actual collision ray damages hornling with no boss or blade")
	player.set("input_enabled", false)
	world.queue_free()
	await process_frame

func conflict_guards() -> void:
	var world := load("res://scenes/creation.tscn").instantiate() as Node3D
	var player := world.get_node("Player") as CharacterBody3D
	player.set("capture_mouse_on_click", false)
	player.set("input_enabled", false)
	var rifle := load("res://addons/cw.module.promo-ak47/rifle.tscn").instantiate() as Node3D
	rifle.entity_id = "conflict-fixture-rifle"
	world.add_child(rifle)
	root.add_child(world)
	current_scene = world
	await process_frame
	await physics_frame
	var core: Node3D = rifle.context
	check(core.existing_combat_problem() == "", "same family core is not a legacy conflict")
	var unknown := Node3D.new()
	unknown.name = "GreatHunt"
	world.add_child(unknown)
	check(core.existing_combat_problem() == "", "unknown node names alone are not rejected")
	for source in ["legacy-encounter.gd", "legacy-vitals.gd"]:
		var legacy := Node3D.new()
		legacy.set_script(load("res://" + source))
		legacy.entity_id = "conflict-existing-player-health"
		world.add_child(legacy)
		await process_frame
		var before: Dictionary = legacy.snapshot()
		check(core.existing_combat_problem() == "PROMO_EXISTING_COMBAT_ADAPTATION_REQUIRED", source + " same-player conflict is explicit")
		check(core.validate_state(core.snapshot()) == "PROMO_EXISTING_COMBAT_ADAPTATION_REQUIRED", source + " conflict rejects actual save validation")
		check(legacy.snapshot() == before, source + " conflict check leaves old progress intact")
		legacy.queue_free()
		await process_frame
		check(core.existing_combat_problem() == "", source + " gone does not leave a false conflict")
	world.queue_free()
	await process_frame
