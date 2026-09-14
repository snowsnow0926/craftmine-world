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
	check(player.get("captured") == false, "test never captures input")
	print("PROMO_COMBAT_RESULT=" + JSON.stringify({"checks":checks,"errors":errors,"evidence":evidence}))
	world.queue_free()
	await process_frame
	quit(0 if errors.is_empty() else 1)
