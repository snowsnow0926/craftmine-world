extends Node3D

# Fixed authored integration fixture. This is not model-authorship evidence.
var camera := Camera3D.new()
var weapon: MeshInstance3D
var crosshair := preload("res://crosshair.gd").new()
var target := StaticBody3D.new()
var equipped := "gun"
var ammo := 6
var target_health := 50
var damage := 12

func add_box(parent: Node3D, dimensions: Vector3, color: Color) -> MeshInstance3D:
	var mesh := MeshInstance3D.new()
	var shape := BoxMesh.new()
	shape.size = dimensions
	mesh.mesh = shape
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	mesh.material_override = material
	parent.add_child(mesh)
	return mesh

func _ready() -> void:
	add_child(camera)
	camera.position = Vector3(0, 1.6, 4)
	camera.current = true
	weapon = add_box(camera, Vector3(0.14, 0.16, 0.65), Color(0.2, 0.28, 0.35))
	weapon.position = Vector3(0.25, -0.22, -0.65)
	var ground := add_box(self, Vector3(20, 0.2, 20), Color(0.3, 0.45, 0.3))
	ground.position.y = -0.1
	add_child(target)
	target.position = Vector3(0, 1.6, -8)
	target.collision_layer = 2
	var collision := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(1.5, 1.5, 0.4)
	collision.shape = box
	target.add_child(collision)
	add_box(target, box.size, Color(0.9, 0.4, 0.2))
	var light := DirectionalLight3D.new()
	light.rotation_degrees = Vector3(-45, -20, 0)
	add_child(light)
	var ui := CanvasLayer.new()
	add_child(ui)
	ui.add_child(crosshair)
	if OS.has_feature("web"):
		add_child(load("res://web_bridge.gd").new())
	if OS.get_cmdline_user_args().has("--restore"):
		var file := FileAccess.open("user://progress.json", FileAccess.READ)
		if file == null:
			push_error("Probe progress is missing")
			get_tree().quit(2)
			return
		var saved: Dictionary = JSON.parse_string(file.get_as_text())
		ammo = int(saved.ammo)
		target_health = int(saved.targetHealth)
		equip(str(saved.equipped))
	if OS.get_cmdline_user_args().has("--gd0-probe"):
		run_probe()

func equip(value: String) -> void:
	equipped = value
	weapon.visible = equipped == "gun"
	crosshair.visible = equipped == "gun"

func fire() -> bool:
	if equipped != "gun" or ammo <= 0:
		return false
	ammo -= 1
	var origin := camera.global_position
	var query := PhysicsRayQueryParameters3D.create(origin, origin - camera.global_basis.z * 100, 2)
	var hit := get_world_3d().direct_space_state.intersect_ray(query)
	if hit.get("collider") == target:
		target_health = maxi(0, target_health - damage)
		return true
	return false

func web_snapshot() -> Dictionary:
	var viewport_size := get_viewport().get_visible_rect().size
	return {"base": "first-person", "state": {"ammo": ammo, "targetHealth": target_health, "equipped": equipped, "yaw": camera.rotation.y}, "damage": damage,
		"weaponVisible": weapon.visible, "crosshairVisible": crosshair.visible,
		"weaponLocal": [weapon.position.x, weapon.position.y, weapon.position.z],
		"weaponGlobal": [weapon.global_position.x, weapon.global_position.y, weapon.global_position.z],
		"cameraAttachment": weapon.global_transform.is_equal_approx(camera.global_transform * weapon.transform),
		"viewportSize": [viewport_size.x, viewport_size.y], "crosshairSize": [crosshair.size.x, crosshair.size.y],
		"persistentStorage": OS.is_userfs_persistent()}


func finite_number(value: Variant, minimum: float, maximum: float, integer := false) -> bool:
	return (value is float or value is int) and is_finite(float(value)) and float(value) >= minimum and float(value) <= maximum and (not integer or float(value) == floorf(float(value)))

func restore_web_state(saved: Variant) -> Dictionary:
	if not saved is Dictionary or saved.get("equipped") not in ["gun", "sword"] or not finite_number(saved.get("ammo"), 0, 6, true) or not finite_number(saved.get("targetHealth"), 0, 50, true) or not finite_number(saved.get("yaw"), -PI, PI):
		return {"error": "Progress is invalid"}
	ammo = int(saved.ammo)
	target_health = int(saved.targetHealth)
	equip(saved.equipped)
	camera.rotation.y = float(saved.yaw)
	return {"result": web_snapshot()}

func web_command(op: String, args: Dictionary) -> Dictionary:
	match op:
		"snapshot":
			return {"result": web_snapshot()}
		"equip":
			if args.get("value") not in ["gun", "sword"]:
				return {"error": "Unknown equipment"}
			equip(args.value)
		"look":
			var yaw: Variant = args.get("yaw")
			if not (yaw is float or yaw is int) or not is_finite(float(yaw)) or absf(float(yaw)) > PI:
				return {"error": "Invalid camera rotation"}
			camera.rotation.y = float(yaw)
		"fire":
			await get_tree().physics_frame
			return {"result": {"hit": fire(), "snapshot": web_snapshot()}}
		"save":
			var failure: String = get_node("WebBridge").write_progress(web_snapshot().state)
			if not failure.is_empty():
				return {"error": failure}
			return {"result": {"written": true, "snapshot": web_snapshot()}}
		"restore":
			var loaded: Dictionary = get_node("WebBridge").read_progress()
			if loaded.has("error"):
				return loaded
			return await restore_web_state(loaded.state)
		"restore-state":
			return await restore_web_state(args.get("state"))
		_:
			return {"error": "Unsupported probe operation: " + op}
	return {"result": web_snapshot()}

func run_probe() -> void:
	await get_tree().physics_frame
	await get_tree().physics_frame
	var saved_pose := weapon.transform
	camera.rotation.y = 0.7
	var follows_camera := weapon.transform.is_equal_approx(saved_pose) and weapon.global_transform.is_equal_approx(camera.global_transform * saved_pose)
	camera.rotation.y = 0
	var hit := true
	if not OS.get_cmdline_user_args().has("--restore"):
		hit = fire()
	equip("sword")
	var sword_hides_gun_ui := not weapon.visible and not crosshair.visible
	equip("gun")
	var progress := {"ammo": ammo, "targetHealth": target_health, "equipped": equipped}
	var file := FileAccess.open("user://progress.json", FileAccess.WRITE)
	if file == null:
		get_tree().quit(3)
		return
	file.store_string(JSON.stringify(progress))
	file.close()
	print("CRAFTMINE_GD0=" + JSON.stringify({"base": "first-person", "headless": DisplayServer.get_name() == "headless", "rayHit": hit, "cameraAttachment": follows_camera, "weaponUiSynchronized": sword_hides_gun_ui and crosshair.visible and weapon.visible, "crosshairSize": [crosshair.size.x, crosshair.size.y], "viewportSize": [get_viewport().get_visible_rect().size.x, get_viewport().get_visible_rect().size.y], "state": progress}))
	get_tree().quit()
