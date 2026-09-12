extends SceneTree

func _initialize() -> void:
	call_deferred("run")

func run() -> void:
	var world := load("res://scenes/creation.tscn").instantiate() as Node3D
	var player := world.get_node("Player")
	player.set("capture_mouse_on_click", false)
	player.set("input_enabled", false)
	root.add_child(world)
	current_scene = world
	await process_frame
	var weapon := world.get_node("Weapon") as Node3D
	var saved: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("user://weapon.json"))
	var ledger: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("user://ledger.json"))
	var registry: RefCounted = load("res://component_state.gd").new()
	var problem: String = registry.restore(world, ledger, true)
	var matches: bool = weapon.snapshot() == saved and float(saved.remainingCooldown) > 0
	print("WEAPON_REOPEN=" + JSON.stringify({"restored": problem.is_empty() and matches, "state": weapon.snapshot()}))
	quit(0 if problem.is_empty() and matches else 1)
