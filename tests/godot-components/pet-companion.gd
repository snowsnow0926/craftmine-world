extends SceneTree

const Pet = preload("res://pet_companion.gd")
var checks: Array[String] = []
var failures := 0
var world: Node3D
var player: CharacterBody3D

func verify(value: bool, label: String) -> void:
	if value:
		checks.append(label)
	else:
		failures += 1
		push_error(label)

func _initialize() -> void:
	_run.call_deferred()

func ticks(count: int) -> void:
	for _tick in count:
		await physics_frame

func solid(size: Vector3, at: Vector3) -> StaticBody3D:
	var body := StaticBody3D.new()
	body.position = at
	body.collision_layer = 1
	var collision := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = size
	collision.shape = shape
	body.add_child(collision)
	world.add_child(body)
	return body

func visual_fixture(label: String) -> PackedScene:
	# No dog geometry: these empty named nodes test independent visual ownership.
	var node := Node3D.new()
	node.name = label
	var animation_player := AnimationPlayer.new()
	animation_player.name = "AnimationPlayer"
	node.add_child(animation_player)
	animation_player.owner = node
	var library := AnimationLibrary.new()
	for clip in ["idle", "walk"]:
		var animation := Animation.new()
		animation.length = 0.2
		library.add_animation(clip, animation)
	animation_player.add_animation_library("", library)
	var packed := PackedScene.new()
	verify(packed.pack(node) == OK, "fixture packs " + label)
	node.free()
	return packed

func pet(identity: String, title: String, appearance: String, at: Vector3, follows := true) -> CharacterBody3D:
	var value := Pet.new() as CharacterBody3D
	value.entity_id = identity
	value.companion_name = title
	value.appearance_key = appearance
	value.following = follows
	value.position = at
	value.dog_visual = visual_fixture("DogVisualFixture")
	value.pomeranian_visual = visual_fixture("PomeranianVisualFixture")
	world.add_child(value)
	return value

func relocate(value: CharacterBody3D, at: Vector3) -> void:
	var saved: Dictionary = value.snapshot()
	saved.position = [at.x, at.y, at.z]
	verify(value.restore(saved).is_empty(), "explicit test restore is separate from ordinary movement")

func native_overlap(value: CharacterBody3D, body: PhysicsBody3D) -> bool:
	var collision := value.get_node("CollisionShape3D") as CollisionShape3D
	var inset := CylinderShape3D.new()
	inset.radius = collision.shape.radius - 0.002
	inset.height = collision.shape.height - 0.004
	var query := PhysicsShapeQueryParameters3D.new()
	query.shape = inset
	query.transform = collision.global_transform
	query.collision_mask = body.collision_layer
	query.exclude = [value.get_rid()]
	query.margin = 0.0
	return not world.get_world_3d().direct_space_state.intersect_shape(query, 8).is_empty()

func differential(value: CharacterBody3D, body: PhysicsBody3D, positions: Array[Vector3], label: String) -> void:
	var collision := value.get_node("CollisionShape3D") as CollisionShape3D
	var inset := CylinderShape3D.new()
	inset.radius = collision.shape.radius - 0.002
	inset.height = collision.shape.height - 0.004
	for at in positions:
		body.position = at
		body.force_update_transform()
		var synchronous: bool = value._restored_body_overlap(inset, collision.global_transform, body) == "PET_RESTORE_OVERLAP"
		await ticks(3)
		verify(synchronous == native_overlap(value, body), "synchronous geometry agrees with stepped native " + label + " at " + str(at))

func _run() -> void:
	world = Node3D.new()
	root.add_child(world)
	for config in [{"entity_id": ""}, {"entity_id": "bad:id"}, {"entity_id": "bad\n"}, {"appearance_key": "unknown"}, {"move_speed": -1.0}]:
		var invalid_pet := Pet.new()
		invalid_pet.entity_id = "invalid-config-test"
		for field in config:
			invalid_pet.set(field, config[field])
		world.add_child(invalid_pet)
		verify(invalid_pet in get_nodes_in_group("craftmine_persistent_components"), "invalid configuration remains discoverable by persistent registry: " + str(config))
		verify(invalid_pet.configuration_error == "PET_CONFIGURATION_INVALID" and not invalid_pet.validate_state(invalid_pet.snapshot()).is_empty(), "invalid configuration cannot validate its own snapshot: " + str(config))
		invalid_pet.free()
	solid(Vector3(80, 1, 80), Vector3(0, -0.5, 0))
	player = CharacterBody3D.new()
	player.name = "Player"
	player.position = Vector3(0, 0.9, 0)
	player.collision_layer = 8
	var player_shape := CollisionShape3D.new()
	var capsule := CapsuleShape3D.new()
	capsule.radius = 0.3
	capsule.height = 1.8
	player_shape.shape = capsule
	player.add_child(player_shape)
	world.add_child(player)
	var first := pet("pet-a", "团子", "dog", Vector3(0, 0.1, 7))
	var second := pet("pet-b", "小白", "pomeranian-white", Vector3(4, 0.1, 5), false)
	await ticks(20)
	verify(get_nodes_in_group("craftmine_persistent_components").size() == 2, "two stable component providers register")
	verify(first.snapshot().sourceSettings == {"name": "团子", "appearanceKey": "dog", "following": true}, "source settings capture exact initial authored defaults")
	verify(first.validate_state(first.snapshot()).is_empty(), "default snapshot can be captured by host")
	var initial_second: Dictionary = second.snapshot()
	var maximum_step := 0.0
	for _tick in 240:
		var before := first.global_position
		await physics_frame
		var displacement := first.global_position - before
		displacement.y = 0
		maximum_step = maxf(maximum_step, displacement.length())
	var gap := Vector2(first.global_position.x - player.position.x, first.global_position.z - player.position.z).length()
	verify(gap >= 1.3 and gap <= 1.8 and first.is_on_floor(), "flat-ground following arrives and stops near player")
	verify(maximum_step < 0.1, "following advances by physical steps without teleport")
	verify(absf(first.velocity.x) + absf(first.velocity.z) < 0.08, "near player horizontal velocity settles")
	verify(absf(second.position.x - initial_second.position[0]) < 0.001 and absf(second.position.z - initial_second.position[2]) < 0.001, "nonfollowing second pet does not inherit first movement")

	relocate(first, Vector3(0, 0.02, 6))
	var wall := solid(Vector3(8, 2, 0.4), Vector3(0, 1, 3))
	await ticks(240)
	verify(first.global_position.z > 3.4 and first.global_position.z < 4, "wall blocks physical following without crossing")
	player.position.z = -20
	await ticks(180)
	verify(first.global_position.z > 3.4, "far target does not trigger catch-up teleport through wall")
	var obstructed: Dictionary = first.interact(player)
	verify(obstructed.interacted == false and obstructed.reason == "out-of-range", "distant player cannot interact")
	player.position = Vector3(0, 0.9, 2)
	verify(first.interact(player).get("reason") == "obstructed", "near player cannot pet through wall")
	wall.queue_free()
	await ticks(3)
	first.set_following(false)
	relocate(first, Vector3(0, 0.02, 3))
	await ticks(3)
	var interaction: Dictionary = first.interact(player)
	verify(interaction.interacted and interaction.entityId == "pet-a" and interaction.feedback.contains("团子"), "near clear interaction gives named feedback")
	verify(first.snapshot().interactionCount == 1 and second.snapshot().interactionCount == 0, "interaction counters belong to one instance")
	verify(not first.feedback_text.is_empty(), "feedback is available for host HUD")
	paused = true
	verify(first.interact(player).get("reason") == "unavailable", "paused world refuses interaction")
	paused = false

	var second_before: Dictionary = second.snapshot()
	verify(first.set_companion_name("旺财").is_empty() and first.set_appearance_key("pomeranian-white").is_empty(), "runtime name and appearance settings are editable")
	verify(first.get_node("VisualPivot").get_child(0).name == "PomeranianVisualFixture" and second.get_node("VisualPivot").get_child(0).name == "PomeranianVisualFixture", "each visual pivot owns its selected child")
	verify(first.get_node("VisualPivot").get_child(0) != second.get_node("VisualPivot").get_child(0), "same appearance instantiates independent visual nodes")
	verify(first.get_node("CollisionShape3D").shape != second.get_node("CollisionShape3D").shape, "collision shapes are not shared mutable resources")
	var first_animation := first.get_node("VisualPivot").get_child(0).get_node("AnimationPlayer") as AnimationPlayer
	var second_animation := second.get_node("VisualPivot").get_child(0).get_node("AnimationPlayer") as AnimationPlayer
	verify(first_animation.get_animation("idle").loop_mode == Animation.LOOP_LINEAR and first_animation.get_animation("walk").loop_mode == Animation.LOOP_LINEAR, "known imported idle and walk clips loop")
	verify(first_animation.get_animation("idle") != second_animation.get_animation("idle"), "animation resources are independent per pet")
	verify(second.snapshot() == second_before and first.entity_id == "pet-a", "name appearance and follow changes do not change root identity or peer state")
	var saved: Dictionary = first.snapshot()
	verify(saved.sourceSettings.name == "团子" and saved.settings.name == "旺财" and not saved.settings.following, "runtime overrides retain immutable source settings")
	var malformed: Array[Dictionary] = []
	var bad := saved.duplicate(true)
	bad.entityId = "pet-b"
	malformed.append(bad)
	bad = saved.duplicate(true)
	bad.position[0] = NAN
	malformed.append(bad)
	bad = saved.duplicate(true)
	bad.settings.appearanceKey = "arbitrary-resource-path"
	malformed.append(bad)
	bad = saved.duplicate(true)
	bad.settings.following = 1
	malformed.append(bad)
	bad = saved.duplicate(true)
	bad.extra = true
	malformed.append(bad)
	bad = saved.duplicate(true)
	bad.interactionCount = 0.5
	malformed.append(bad)
	for invalid in malformed:
		verify(not first.restore(invalid).is_empty() and first.snapshot() == saved, "invalid restore rejects atomically")
	verify(first.set_companion_name("bad\nname") == "PET_NAME_INVALID" and first.set_appearance_key("unknown") == "PET_APPEARANCE_INVALID", "settings reject control text and undeclared appearance")
	for angle in [0.734833762, -2.3478, PI / 3.0, -PI + 0.001, 1.37]:
		first.rotation.y = angle
		var turned: Dictionary = first.snapshot()
		verify(first.restore(turned).is_empty() and first.snapshot() == turned, "non-axis yaw survives exact wire restore")
	first.free()
	var reopened := pet("pet-a", "团子", "dog", Vector3(-7, 0, 7))
	var parsed: Dictionary = JSON.parse_string(JSON.stringify(saved))
	var restored_result: String = reopened.restore(parsed)
	verify(restored_result.is_empty() and reopened.snapshot() == parsed, "fresh instance restores JSON name appearance following position yaw and count")
	verify(second.snapshot() == second_before, "restoring first pet preserves second pet")
	reopened.free()
	var changed_source := pet("pet-a", "源码新名字", "dog", Vector3(-8, 0, 7))
	verify(changed_source.validate_state(parsed) == "PET_SOURCE_SETTINGS_CHANGED", "source-setting change requires explicit host migration")
	var migrated := parsed.duplicate(true)
	migrated.sourceSettings = changed_source.snapshot().sourceSettings
	migrated.settings.name = migrated.sourceSettings.name
	verify(changed_source.restore(migrated).is_empty() and changed_source.snapshot().position == parsed.position and changed_source.snapshot().settings.appearanceKey == parsed.settings.appearanceKey, "host-migrated changed default preserves other runtime settings and location")
	player.position = Vector3(10, 0.9, 0)
	changed_source.set_physics_process(false)
	changed_source.set_appearance_key("pomeranian-white")
	relocate(changed_source, Vector3(0, 0, 3.62))
	wall = solid(Vector3(8, 2, 0.4), Vector3(0, 1, 3))
	await ticks(3)
	verify(changed_source.validate_restored_state().is_empty(), "small pet beside wall and touching ground passes actual shape query")
	var parked: Dictionary = changed_source.snapshot()
	var grown := parked.duplicate(true)
	grown.settings.appearanceKey = "dog"
	verify(changed_source.restore(grown).is_empty(), "large appearance state first passes pure contract validation")
	verify(changed_source.validate_restored_state() == "PET_RESTORE_OVERLAP", "larger restored visual envelope is refused inside existing wall")
	verify(changed_source.restore(parked).is_empty() and changed_source.validate_restored_state().is_empty(), "rollback to smaller state restores legal geometry without relocation")
	wall.queue_free()
	await ticks(3)
	player.position = Vector3(0, 0.9, 3.9)
	verify(changed_source.validate_restored_state() == "PET_RESTORE_OVERLAP", "restored shape checks actual current player position")
	player.position = Vector3(10, 0.9, 0)
	relocate(second, Vector3(0.4, 0, 3.62))
	verify(changed_source.validate_restored_state() == "PET_RESTORE_OVERLAP", "restored shape checks another pet after both transforms restore")
	relocate(second, Vector3(4, 0, 5))
	relocate(changed_source, Vector3(0, -0.02, 3.62))
	verify(changed_source.validate_restored_state() == "PET_RESTORE_OVERLAP", "ground penetration beyond two-millimeter contact inset is refused")
	# Compare actual native shapes after broadphase updates, including end caps,
	# separation and exact contact. Production validation itself never waits.
	relocate(changed_source, Vector3(0, 0, 0))
	second.set_physics_process(false)
	second.position = Vector3(20, 0, 0)
	await differential(changed_source, player, [Vector3(0.4, 0.9, 0), Vector3(0.8, 0.9, 0), Vector3(0, 1.1, 0), Vector3(0, 1.6, 0), Vector3(0.5, 1.5, 0), Vector3(0.658, 0.9, 0)], "capsule")
	player.position = Vector3(20, 0.9, 0)
	await differential(changed_source, second, [Vector3(0.4, 0, 0), Vector3(1, 0, 0), Vector3(0, 0.3, 0), Vector3(0, 0.6, 0), Vector3(0.718, 0, 0)], "cylinder")
	second.position = Vector3(0, 0, 0)
	await ticks(3)
	second.position = Vector3(20, 0, 0)
	verify(changed_source.validate_restored_state().is_empty(), "stale native peer pose is excluded after peer moves away")
	second.rotation.z = 0.2
	verify(changed_source.validate_restored_state() == "PET_RESTORE_TRANSFORM_UNSUPPORTED", "tilted restored dynamic shape is explicitly unsupported")
	second.rotation.z = 0
	second.scale = Vector3(2, 1, 1)
	verify(changed_source.validate_restored_state() == "PET_RESTORE_TRANSFORM_UNSUPPORTED", "scaled restored dynamic shape is explicitly unsupported")
	second.scale = Vector3.ONE
	second.get_node("CollisionShape3D").shape = BoxShape3D.new()
	verify(changed_source.validate_restored_state() == "PET_RESTORE_SHAPE_UNSUPPORTED", "unknown restored dynamic shape is explicitly unsupported")
	await ticks(125)
	verify(changed_source.feedback_text.is_empty(), "transient feedback is not persisted")
	print("PET_COMPANION_TEST=" + JSON.stringify({"checks": checks, "headless": DisplayServer.get_name() == "headless", "maximumHorizontalStep": maximum_step, "visualVerified": false, "inputDispatchVerified": false}))
	quit(0 if failures == 0 else 1)
