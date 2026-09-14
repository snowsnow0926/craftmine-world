extends SceneTree

func _initialize() -> void:
	call_deferred("run")

func run() -> void:
	var world := load("res://scenes/creation.tscn").instantiate() as Node3D
	var player := world.get_node("Player") as CharacterBody3D
	player.set("capture_mouse_on_click", false)
	player.set("input_enabled", false)
	var legacy := Node3D.new()
	legacy.set_script(load("res://legacy-encounter.gd"))
	legacy.entity_id = "legacy-existing-health"
	world.add_child(legacy)
	var rifle := load("res://addons/cw.module.promo-ak47/rifle.tscn").instantiate() as Node3D
	rifle.entity_id = "rejected-new-rifle"
	world.add_child(rifle)
	root.add_child(world)
	current_scene = world
	await process_frame
	await physics_frame
	var code: String = rifle.context.configuration_error
	print("PROMO_EXPECTED_CONFLICT=" + JSON.stringify({"code":code,"oldHealth":legacy.health,"oldStillPresent":legacy.get_parent() == world,"newInputAllowed":rifle.context.input_allowed()}))
	world.queue_free()
	await process_frame
	quit(0)
