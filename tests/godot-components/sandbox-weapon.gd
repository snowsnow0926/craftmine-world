extends SceneTree

class DamageTarget extends Node3D:
	var entity_id := "target-1"
	var health := 100.0
	var calls := 0
	func apply_damage(amount: float, _player: Node3D) -> Dictionary:
		calls += 1
		var applied := minf(health, amount)
		health -= applied
		return {"applied": applied}

var checks: Array[String] = []
var errors: Array[String] = []
var evidence: Dictionary = {}

func _initialize() -> void:
	call_deferred("run")

func check(condition: bool, label: String) -> void:
	checks.append(label)
	if not condition: errors.append(label)

func body_at(parent: Node3D, location: Vector3) -> StaticBody3D:
	var body := StaticBody3D.new()
	var collision := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(1, 2, 0.3)
	collision.shape = box
	body.add_child(collision)
	parent.add_child(body)
	body.global_position = location
	return body

func run() -> void:
	var world := load("res://scenes/creation.tscn").instantiate() as Node3D
	var player := world.get_node("Player") as Node3D
	player.set("capture_mouse_on_click", false)
	player.set("input_enabled", false)
	root.add_child(world)
	current_scene = world
	await process_frame
	await physics_frame
	var vitals: Node3D = load("res://combat_vitals.gd").new()
	vitals.set("entity_id", "vitals-1")
	world.add_child(vitals)
	var weapon: Node3D = load("res://sandbox_weapon.gd").new()
	weapon.set("entity_id", "weapon-1")
	world.add_child(weapon)
	var registry: RefCounted = load("res://component_state.gd").new()
	check(registry.capture(world).error == "", "real registry accepts vitals and weapon snapshots")
	var camera := player.get_node("CameraRig/PitchPivot/Camera3D") as Camera3D
	var direction := -camera.global_basis.z
	var target := DamageTarget.new()
	target.add_to_group("craftmine_damageable_targets")
	world.add_child(target)
	var target_body := body_at(target, camera.global_position + direction * 4)
	await physics_frame
	await physics_frame
	check(player.get("captured") == false, "fixture never captures input")
	var initial: Dictionary = weapon.snapshot()
	var first: Dictionary = weapon.attack(player)
	check(first.fired and first.targetId == "target-1" and first.damage == 20.0 and target.health == 80.0, "camera ray resolves actual collider ancestor and applies damage")
	check(first.ammo == 11 and first.shotsFired == 1 and first.remainingCooldown > 0.0, "shot consumes ammo and starts cooldown")
	var saved: Dictionary = weapon.snapshot()
	check(weapon.attack(player).reason == "cooldown" and weapon.snapshot() == saved, "immediate repeated attack cannot consume ammo")
	check(registry.capture(world).error == "", "registry captures live nonzero cooldown")
	var file := FileAccess.open("user://weapon.json", FileAccess.WRITE)
	file.store_string(JSON.stringify(saved))
	file.close()
	var ledger_file := FileAccess.open("user://ledger.json", FileAccess.WRITE)
	ledger_file.store_string(JSON.stringify(registry.capture(world).states))
	ledger_file.close()
	for field in ["ammo", "remainingCooldown", "shotsFired"]:
		for value in [-1, 0.5 if field != "remainingCooldown" else 61.0, "invalid"]:
			var bad := saved.duplicate(true)
			bad[field] = value
			check(weapon.restore(bad) != "" and weapon.snapshot() == saved, "atomic invalid restore: " + field + str(value))
	var changed := saved.duplicate(true)
	changed.sourceSettings.damage = 99
	check(weapon.restore(changed) != "" and weapon.snapshot() == saved, "source tuning mismatch rejected without mutation")
	weapon.restore(initial)
	var wall := body_at(world, camera.global_position + direction * 2)
	await physics_frame
	await physics_frame
	var blocked: Dictionary = weapon.attack(player)
	check(blocked.fired and blocked.reason == "obstructed" and target.health == 80, "nearest physical wall blocks target damage")
	wall.free()
	weapon.restore(initial)
	target.remove_from_group("craftmine_damageable_targets")
	target.add_to_group("craftmine_persistent_components")
	var pet_result: Dictionary = weapon.attack(player)
	check(pet_result.reason == "obstructed" and target.calls == 1, "non-damageable pet-like component cannot receive damage")
	target.remove_from_group("craftmine_persistent_components")
	target.add_to_group("craftmine_damageable_targets")
	weapon.restore(initial)
	paused = true
	check(weapon.attack(player).reason == "paused" and weapon.snapshot() == initial, "paused attack rejected")
	paused = false
	vitals.take_damage(999.0)
	check(weapon.attack(player).reason == "player-dead" and weapon.snapshot() == initial, "dead vitals prevents attack without consuming ammo")
	vitals.revive()
	var other := Node3D.new()
	world.add_child(other)
	check(weapon.attack(other).reason == "wrong-player", "foreign caller rejected")
	var duplicate: Node3D = load("res://sandbox_weapon.gd").new()
	duplicate.set("entity_id", "weapon-2")
	world.add_child(duplicate)
	check(weapon.attack(player).reason == "WEAPON_DUPLICATE_PLAYER" and duplicate.attack(player).reason == "WEAPON_DUPLICATE_PLAYER", "duplicate weapon rejects both owners")
	duplicate.free()
	var empty := initial.duplicate(true)
	empty.ammo = 0.0 # Snapshots use the JSON wire number representation.
	var empty_restore: String = weapon.restore(empty)
	var empty_result: Dictionary = weapon.attack(player)
	evidence["empty"] = {"restore": empty_restore, "result": empty_result, "actual": weapon.snapshot(), "expected": empty}
	check(empty_restore == "" and empty_result.reason == "empty" and weapon.snapshot() == empty, "empty weapon cannot fire")
	weapon.restore(saved)
	for _frame in 24: await physics_frame
	var after_cooldown: Dictionary = weapon.attack(player)
	check(after_cooldown.fired and target.health == 60 and after_cooldown.ammo == 10, "physics cooldown expires and permits the next real shot")
	var live_before_pause: Dictionary = weapon.snapshot()
	paused = true
	await process_frame
	await process_frame
	check(weapon.snapshot() == live_before_pause, "pause freezes live cooldown")
	paused = false
	weapon.restore(initial)
	target_body.free()
	await physics_frame
	await physics_frame
	var miss: Dictionary = weapon.attack(player)
	check(miss.fired and miss.damage == 0 and target.calls == 2, "no target ray consumes a shot without damage")
	weapon.restore(initial)
	var distant := body_at(target, camera.global_position + direction * 35)
	await physics_frame
	await physics_frame
	var outside: Dictionary = weapon.attack(player)
	check(outside.fired and outside.damage == 0 and target.calls == 2, "target beyond configured range cannot be damaged")
	distant.free()
	weapon.restore(initial)
	var camera_before := camera.global_transform
	var gun_visual: MeshInstance3D = weapon.get("_visual")
	check(is_instance_valid(gun_visual) and camera.is_ancestor_of(gun_visual), "weapon visual uses actual camera mount")
	var other_camera := Camera3D.new()
	world.add_child(other_camera)
	other_camera.make_current()
	check(weapon.attack(player).reason == "no-player-camera" and weapon.snapshot() == initial, "foreign current camera cannot aim a player weapon")
	camera.make_current()
	other_camera.free()
	check(camera.global_transform == camera_before, "attack checks never move the camera")
	vitals.remove_from_group("craftmine_player_vitals")
	check(weapon.attack(player).reason == "vitals-unavailable" and weapon.snapshot() == initial, "missing vitals fails closed")
	vitals.add_to_group("craftmine_player_vitals")
	# The second process has a fresh player, weapon and registry, using the same
	# isolated user directory; no hand-written expected progress is restored.
	evidence["saved"] = saved
	print("WEAPON_RESULT=" + JSON.stringify({"checks": checks, "errors": errors, "evidence": evidence}))
	quit(0 if errors.is_empty() else 1)
