extends SceneTree

const Preset = preload("res://components/natural-daylight/natural_daylight.gd")
var checks: Array[String] = []
var failures := 0

func verify(value: bool, label: String) -> void:
	if not value:
		failures += 1
		push_error(label)
	else:
		checks.append(label)

func _initialize() -> void:
	_run.call_deferred()

func _run() -> void:
	var world := load("res://scenes/creation.tscn").instantiate() as Node3D
	root.add_child(world)
	for _tick in 20:
		await physics_frame
	verify(world.get("ready_for_play") == true, "original creation base loads")
	var installed_preset := load("res://components/natural-daylight/creation_sandbox_preset.gd").new() as Node3D
	var install_state: Dictionary = world.capture()
	world.add_child(installed_preset)
	for _tick in 3:
		await physics_frame
	verify(installed_preset.get("applied") == true, "optional stock-base package binds actual environment after parent initialization")
	verify(world.capture() == install_state, "installed preset preserves complete player progress")
	paused = true
	var ground: MeshInstance3D
	var environment_node: WorldEnvironment
	var boundaries: Array[MeshInstance3D] = []
	for child in world.get_children():
		if child is WorldEnvironment:
			environment_node = child
		if child is MeshInstance3D and child.mesh is BoxMesh:
			if child.mesh.size == Vector3(64, 0.4, 64):
				ground = child
			elif child.mesh.size == Vector3(0.5, 3, 64) or child.mesh.size == Vector3(64, 3, 0.5):
				boundaries.append(child)
	verify(ground != null and environment_node != null and boundaries.size() == 4, "fixture identifies actual base environment targets")
	var sun := world.get("sun") as DirectionalLight3D
	var state_before: Dictionary = world.capture()
	var mesh_before := ground.mesh
	var transform_before := ground.transform
	var sunlight_before := sun.light_energy
	var rotation_before := sun.rotation
	var shadows_before := sun.shadow_enabled
	var children_before := world.get_child_count()
	var player := world.get("player") as Node
	var input_before: Variant = player.get("input_enabled")
	var capture_before: Variant = player.get("captured")
	var old_material := ground.material_override
	verify(Preset.apply_to(null, ground, sun) == "NATURAL_DAYLIGHT_TARGETS_REQUIRED", "invalid targets reject before mutation")
	verify(ground.material_override == old_material, "invalid call preserves material")
	verify(Preset.apply_to(environment_node, ground, sun, boundaries).is_empty(), "optional preset loads onto explicit targets")
	verify(world.capture() == state_before, "preset preserves complete existing progress")
	verify(ground.mesh == mesh_before and ground.transform == transform_before and world.get_child_count() == children_before, "geometry transforms and collision nodes remain unchanged")
	verify(sun.light_energy == sunlight_before and sun.rotation == rotation_before and sun.shadow_enabled == shadows_before, "existing solar time and shadow ownership remain unchanged")
	verify(player.get("input_enabled") == input_before and player.get("captured") == capture_before and paused, "input capture and pause remain unchanged")
	var material := ground.material_override as StandardMaterial3D
	verify(material != null and material.transparency == BaseMaterial3D.TRANSPARENCY_DISABLED and not material.heightmap_enabled, "ordinary opaque material has no displacement")
	verify(material.albedo_texture is NoiseTexture2D and material.uv1_triplanar and material.uv1_world_triplanar, "ground texture and world scale load")
	verify(environment_node.environment.ambient_light_source == Environment.AMBIENT_SOURCE_COLOR and is_equal_approx(environment_node.environment.ambient_light_energy, 0.3), "neutral ambient settings load")
	verify(environment_node.environment.sky.sky_material is ProceduralSkyMaterial, "procedural sky loads without external textures")
	var first_material := material
	var first_environment := environment_node.environment
	verify(Preset.apply_to(environment_node, ground, sun).is_empty(), "explicit repeat application succeeds")
	verify(ground.material_override != first_material and environment_node.environment != first_environment, "applications own separate material and environment resources")
	first_material.albedo_color = Color.RED
	verify((ground.material_override as StandardMaterial3D).albedo_color != Color.RED, "editing an earlier resource cannot recolor another application")
	verify(world.set_time(18.0).is_empty(), "normal time-of-day API still works")
	verify(sun.light_energy != sunlight_before and sun.light_color == Preset.SUN_TINT, "world updates energy while preset retains only tint")
	verify(world.restore(state_before).is_empty() and world.capture() == state_before, "original progress restores after optional styling")
	print("NATURAL_DAYLIGHT_TEST=" + JSON.stringify({"checks": checks, "headless": DisplayServer.get_name() == "headless", "visualVerified": false}))
	quit(0 if failures == 0 else 1)
