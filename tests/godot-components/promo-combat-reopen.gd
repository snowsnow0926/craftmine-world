extends SceneTree

func _initialize() -> void:
	call_deferred("run")

func run() -> void:
	var saved: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("user://promo-combat-save.json"))
	var world := load("res://scenes/creation.tscn").instantiate() as Node3D
	var player := world.get_node("Player") as CharacterBody3D
	player.set("capture_mouse_on_click", false)
	player.set("input_enabled", false)
	# Deliberately load the dependent hunt before its blade sibling. Deferred
	# scene initialization must resolve actual modules without changing the save.
	for row in [["monsters","encounter.tscn","test-promo-encounter"],["hunt","hunt.tscn","test-promo-hunt"],["heavyblade","blade.tscn","test-promo-blade"],["ak47","rifle.tscn","test-promo-rifle"]]:
		var component := load("res://addons/cw.module.promo-" + row[0] + "/" + row[1]).instantiate() as Node3D
		component.entity_id = row[2]
		world.add_child(component)
	root.add_child(world)
	current_scene = world
	await process_frame
	await physics_frame
	var player_problem: String = player.restore(saved.player)
	var registry: RefCounted = load("res://component_state.gd").new()
	var problem: String = registry.restore(world, saved.components, true)
	var actual: Dictionary = registry.capture(world)
	var same: bool = JSON.parse_string(JSON.stringify(actual.states)) == saved.components
	print("PROMO_COMBAT_REOPEN=" + JSON.stringify({"error":problem,"playerError":player_problem,"sameComponents":same,"samePlayer":JSON.parse_string(JSON.stringify(player.snapshot())) == saved.player,"state":actual.states}))
	world.queue_free()
	await process_frame
	quit(0 if problem.is_empty() and player_problem.is_empty() and same else 1)
