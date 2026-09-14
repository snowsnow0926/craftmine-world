extends Node3D

const Contract = preload("res://scripts/scene_contract.gd")
const RifleModel = preload("res://addons/cw.module.promo-ak47/model.glb")
const Core = preload("res://addons/cw.module.promo-ak47/core.gd")
@export var player_path := NodePath("Player")
@export var camera_path := NodePath("Player/CameraRig/PitchPivot/Camera3D")
var context: Node3D
var configuration_error := ""
const MAGAZINE_SIZE := 30
const FIRE_INTERVAL := 0.13
const RELOAD_SECONDS := 2.2
const DAMAGE := 24
@export var entity_id := "hunter-ak47-01"
var equipped: bool:
	get: return context != null and context.current_weapon() == self
var rounds := MAGAZINE_SIZE
var shots := 0
var cooldown := 0.0
var reload_remaining := 0.0
var key_fire := false
var mouse_fire := false
var key_aim := false
var mouse_aim := false
var reload_requested := false
var heat := 0.0
var kick := 0.0
var flash_time := 0.0
var hit_time := 0.0
var notice_time := 0.0
var notice := ""
var aim_blend := 0.0
var world: Node3D
var player: CharacterBody3D
var camera: Camera3D
var duel: Node3D
var old_encounter: Node3D
var rifle: Node3D
var muzzle: Node3D
var magazine: Node3D
var muzzle_flash: MeshInstance3D
var ammo_label: Label
var hit_marker: Label
var rng := RandomNumberGenerator.new()

func _ready() -> void:
	context = Core.acquire(self, Core, player_path, camera_path)
	if context != null: configuration_error = context.register_module("rifle", self)
	call_deferred("_bind")

func _bind() -> void:
	if context == null: return
	if not configuration_error.is_empty():
		push_error(configuration_error)
		return
	world = get_parent()
	player = context.player
	camera = context.camera
	duel = context.module("blade")
	old_encounter = context
	add_to_group("craftmine_persistent_components")
	process_physics_priority = 10
	rng.randomize()
	rifle = RifleModel.instantiate() as Node3D
	camera.get_node("WeaponMount").add_child(rifle)
	rifle.set_meta("entity_id", entity_id + "-model")
	rifle.set_meta("source_job_id", "9b2bac9f-6271-4231-bbfe-73ba99490fcd")
	rifle.position = Vector3(0.30, -0.33, -0.48)
	muzzle = rifle.find_child("Muzzle", true, false) as Node3D
	magazine = rifle.find_child("Magazine", true, false) as Node3D
	if muzzle == null:
		push_error("AK47 muzzle attachment is missing")
	else:
		var authored_forward := (muzzle.global_position - rifle.global_position).normalized()
		if authored_forward.dot(-camera.global_basis.z) < 0.90: push_error("AK47 forward axis is not aligned with camera aim")
		muzzle_flash = MeshInstance3D.new()
		var mesh := SphereMesh.new()
		mesh.radius = 0.065
		mesh.height = 0.13
		mesh.radial_segments = 8
		mesh.rings = 4
		muzzle_flash.mesh = mesh
		muzzle_flash.material_override = _effect_material(Color("ffe994"))
		muzzle_flash.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		muzzle.add_child(muzzle_flash)
		muzzle_flash.visible = false
	call_deferred("_make_hud")

func _notification(what: int) -> void:
	if what in [NOTIFICATION_PAUSED, NOTIFICATION_WM_WINDOW_FOCUS_OUT, NOTIFICATION_APPLICATION_FOCUS_OUT]:
		_release_triggers()

func _release_triggers() -> void:
	key_fire = false
	mouse_fire = false
	key_aim = false
	mouse_aim = false
	reload_requested = false

func _input_allowed() -> bool:
	if context == null or not configuration_error.is_empty(): return false
	duel = context.module("blade")
	return context.input_allowed()

func _duel_status() -> String:
	var current: Node3D = context.module("blade") if context != null else null
	return str(current.status) if current != null else "ready"

func _duel_paused() -> bool:
	return duel != null and bool(duel.duel_paused)

func _alive_and_playing() -> bool:
	if not _input_allowed(): return false
	if _duel_status() == "active": return bool(duel.call("combat_running"))
	if _duel_status() == "failed": return false
	if _duel_status() == "ready" and int(old_encounter.get("health")) <= 0: return false
	return not bool(player.call("movement_locked"))

func _hands_free() -> bool:
	return duel == null or duel.get("action") == "none"

func _unhandled_input(event: InputEvent) -> void:
	# This node is last in the scene: equipped rifle events are consumed before melee/pulse input.
	if event is InputEventKey:
		var code: int = event.physical_keycode if event.physical_keycode != 0 else event.keycode
		if not event.pressed:
			if code == KEY_J: key_fire = false
			if code == KEY_K: key_aim = false
		if not _input_allowed(): return
		if code in [KEY_ESCAPE, KEY_H, KEY_B]:
			_release_triggers()
			return
		if event.pressed and not event.echo and code in [KEY_2, KEY_3]:
			if _hands_free(): _equip(code == KEY_2)
			get_viewport().set_input_as_handled()
			return
		if not equipped: return
		if code == KEY_J:
			if not event.echo: key_fire = event.pressed and _alive_and_playing()
			get_viewport().set_input_as_handled()
		elif code == KEY_K:
			if not event.echo: key_aim = event.pressed and _alive_and_playing()
			get_viewport().set_input_as_handled()
		elif code == KEY_R and event.pressed and not event.echo and _alive_and_playing():
			reload_requested = true
			get_viewport().set_input_as_handled()
		elif code in [KEY_LEFT, KEY_RIGHT, KEY_UP, KEY_DOWN] and _duel_status() == "ready":
			get_viewport().set_input_as_handled()
	elif event is InputEventMouseButton:
		if not event.pressed:
			if event.button_index == MOUSE_BUTTON_LEFT: mouse_fire = false
			if event.button_index == MOUSE_BUTTON_RIGHT: mouse_aim = false
		if not _input_allowed() or not equipped: return
		if event.button_index == MOUSE_BUTTON_LEFT:
			# An uncaptured first click still belongs to the unchanged base mouse-look controller.
			if event.pressed and not player.get("captured"): return
			mouse_fire = event.pressed and _alive_and_playing()
			get_viewport().set_input_as_handled()
		elif event.button_index == MOUSE_BUTTON_RIGHT:
			mouse_aim = event.pressed and _alive_and_playing()
			get_viewport().set_input_as_handled()

func _equip(value: bool) -> void:
	if value == equipped: return
	context.select_weapon("rifle" if value else "blade")
	reload_remaining = 0.0
	_release_triggers()
	_update_visuals(0.0)

func _physics_process(delta: float) -> void:
	if world == null or world.get("ready_for_play") != true: return
	if not _alive_and_playing():
		_release_triggers()
		# Explicit duel pause keeps the current reload/cooldown; defeat cancels only the reload.
		if _duel_status() == "failed": reload_remaining = 0.0
		return
	cooldown = maxf(0.0, cooldown - delta)
	heat = maxf(0.0, heat - delta * 0.8)
	if not equipped: return
	if not _hands_free():
		reload_remaining = 0.0
		reload_requested = false
		return
	if reload_requested:
		reload_requested = false
		if reload_remaining <= 0.0 and rounds < MAGAZINE_SIZE:
			reload_remaining = RELOAD_SECONDS
			_notice("正在换弹……", RELOAD_SECONDS)
	if reload_remaining > 0.0:
		reload_remaining = maxf(0.0, reload_remaining - delta)
		if reload_remaining <= 0.0:
			rounds = MAGAZINE_SIZE
			_notice("换弹完成", 0.7)
		return
	if (key_fire or mouse_fire) and cooldown <= 0.0:
		if rounds > 0:
			_fire()
		else:
			_notice("弹匣已空，按 R 换弹", 1.0)
			cooldown = 0.25

func _fire() -> void:
	rounds -= 1
	shots += 1
	cooldown = FIRE_INTERVAL
	heat = minf(1.0, heat + 0.16)
	kick = minf(1.0, kick + 0.6)
	flash_time = 0.055
	var aiming := key_aim or mouse_aim
	var spread := (0.0025 if aiming else 0.010) + heat * (0.005 if aiming else 0.022)
	var direction := (-camera.global_basis.z + camera.global_basis.x * rng.randf_range(-spread, spread) + camera.global_basis.y * rng.randf_range(-spread, spread)).normalized()
	var origin := camera.global_position
	var end := origin + direction * 80.0
	# Ground, trees, small monsters and the boss only. Pet layer 16 and player layer 8 are excluded.
	var query := PhysicsRayQueryParameters3D.create(origin, end, 99, [player.get_rid()])
	var hit := get_world_3d().direct_space_state.intersect_ray(query)
	var successful := false
	if not hit.is_empty():
		end = hit.position
		var target: Node = hit.collider as Node
		if duel != null and target == duel.boss and _duel_status() == "active":
			# Reuse the existing boss damage/recovery/victory path; do not reset or replace its state.
			successful = int(target.call("take_melee", DAMAGE)) > 0
		elif target != null and target.is_in_group("grove_hostiles") and _duel_status() == "ready":
			successful = bool(target.call("take_hit", DAMAGE, direction))
		if successful:
			hit_time = 0.15
			context.call("_spark", end, Color("ffdc82"), 0.14)
	if muzzle != null and origin.distance_to(end) > 1.3: _tracer(muzzle.global_position, end)
	var look: Dictionary = player.call("look")
	player.call("set_look", float(look.yaw) + rng.randf_range(-0.002, 0.002), float(look.pitch) + (0.006 if aiming else 0.012))

func _effect_material(colour: Color) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.albedo_color = colour
	return material

func _tracer(start: Vector3, end: Vector3) -> void:
	var line := MeshInstance3D.new()
	var mesh := ImmediateMesh.new()
	mesh.surface_begin(Mesh.PRIMITIVE_LINES)
	mesh.surface_add_vertex(start)
	mesh.surface_add_vertex(end)
	mesh.surface_end()
	line.mesh = mesh
	line.material_override = _effect_material(Color("ffe6a5"))
	world.add_child(line)
	get_tree().create_timer(0.065).timeout.connect(line.queue_free)

func _process(delta: float) -> void:
	if not is_instance_valid(player): return
	if equipped and _alive_and_playing():
		var axis := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
		if axis.length_squared() > 0.001:
			var look: Dictionary = player.call("look")
			player.call("set_look", float(look.yaw) - axis.x * deg_to_rad(110.0) * delta, float(look.pitch) - axis.y * deg_to_rad(85.0) * delta)
	_update_visuals(delta)
	_update_hud()

func _update_visuals(delta: float) -> void:
	if rifle == null: return
	flash_time = maxf(0.0, flash_time - delta)
	hit_time = maxf(0.0, hit_time - delta)
	notice_time = maxf(0.0, notice_time - delta)
	kick = move_toward(kick, 0.0, delta * 5.0)
	var aiming := equipped and (key_aim or mouse_aim) and reload_remaining <= 0.0 and _alive_and_playing()
	aim_blend = move_toward(aim_blend, 1.0 if aiming else 0.0, delta * 6.0)
	rifle.visible = equipped
	rifle.position = Vector3(0.30, -0.33, -0.48).lerp(Vector3(0, -0.285, -0.35), aim_blend)
	rifle.position.z += kick * 0.055
	rifle.rotation = Vector3(kick * 0.075, 0, -kick * 0.02)
	if magazine != null: magazine.position = Vector3.ZERO
	if reload_remaining > 0.0:
		var fraction := 1.0 - reload_remaining / RELOAD_SECONDS
		var dip := sin(fraction * PI)
		rifle.rotation.z -= dip * 0.55
		rifle.position.y -= dip * 0.18
		if magazine != null: magazine.position = Vector3(0, -dip * 0.24, dip * 0.08)
	if muzzle_flash != null:
		muzzle_flash.visible = equipped and flash_time > 0.0
		muzzle_flash.scale = Vector3(1.0, 0.7, 2.3)

func _make_hud() -> void:
	var layer := CanvasLayer.new()
	layer.layer = 7
	add_child(layer)
	var root := Control.new()
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layer.add_child(root)
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	ammo_label = Label.new()
	ammo_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ammo_label.add_theme_font_size_override("font_size", 18)
	ammo_label.add_theme_color_override("font_shadow_color", Color.BLACK)
	ammo_label.add_theme_constant_override("shadow_offset_x", 2)
	ammo_label.add_theme_constant_override("shadow_offset_y", 2)
	var font: Font = world.get("creation_font") as Font
	if font != null: ammo_label.add_theme_font_override("font", font)
	root.add_child(ammo_label)
	hit_marker = Label.new()
	hit_marker.text = "×"
	hit_marker.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hit_marker.add_theme_font_size_override("font_size", 32)
	hit_marker.modulate = Color("ffe497")
	root.add_child(hit_marker)
	_update_hud()

func _notice(message: String, seconds: float) -> void:
	notice = message
	notice_time = seconds

func _update_hud() -> void:
	if ammo_label == null: return
	var viewport_size := get_viewport().get_visible_rect().size
	ammo_label.position = Vector2(maxf(12, viewport_size.x - 370), maxf(160, viewport_size.y - 150))
	hit_marker.position = viewport_size * 0.5 + Vector2(-10, -23)
	hit_marker.visible = equipped and hit_time > 0.0
	if equipped:
		ammo_label.text = "AK47   %02d / 30   ·   备用弹药 ∞\n按住 J／左键 连射 · R 换弹\n按住 K／右键 瞄准 " % rounds
		if context.module("blade") != null: ammo_label.text += " · 3 切回重刃"
		if reload_remaining > 0.0: ammo_label.text += "\n换弹 %.1f 秒" % reload_remaining
		elif _duel_status() == "failed": ammo_label.text += "\nH 重新挑战 · B 返回世界"
		elif _duel_status() == "active" and _duel_paused(): ammo_label.text += "\n已暂停 · Esc 继续"
		elif notice_time > 0.0: ammo_label.text += "\n" + notice
		elif _duel_status() == "ready" and int(old_encounter.get("health")) <= 0: ammo_label.text += "\n先按 R 恢复生命"
	else:
		ammo_label.text = "2 装备 AK47 · 3 重刃"

func snapshot() -> Dictionary:
	return {"format": "craftmine.promo-ak47/1", "entityId": entity_id, "settings": {"magazineSize": MAGAZINE_SIZE}, "sourceSettings": {"magazineSize": MAGAZINE_SIZE}, "rounds": rounds, "shots": shots, "cooldown": cooldown, "reloadRemaining": reload_remaining}

func validate_state(data: Dictionary) -> String:
	if not Contract.fields(data, ["format", "entityId", "settings", "sourceSettings", "rounds", "shots", "cooldown", "reloadRemaining"]): return "Invalid AK47 fields"
	if data.format != "craftmine.promo-ak47/1" or data.entityId != entity_id: return "AK47 identity mismatch"
	for key in ["settings", "sourceSettings"]:
		if not Contract.fields(data[key], ["magazineSize"]) or data[key].magazineSize != MAGAZINE_SIZE: return "AK47 settings mismatch"
	if not Contract.integer(data.rounds, 0, MAGAZINE_SIZE): return "Invalid AK47 ammunition"
	if not Contract.integer(data.shots, 0, 100000000): return "Invalid AK47 shot count"
	if not Contract.finite(data.cooldown, 0.0, 1.0) or not Contract.finite(data.reloadRemaining, 0.0, RELOAD_SECONDS): return "Invalid AK47 timer"
	return ""

func restore(data: Dictionary) -> String:
	var problem := validate_state(data)
	if problem != "": return problem
	rounds = int(data.rounds)
	shots = int(data.shots)
	cooldown = float(data.cooldown)
	reload_remaining = float(data.reloadRemaining)
	_release_triggers()
	kick = 0.0
	heat = 0.0
	flash_time = 0.0
	hit_time = 0.0
	_update_visuals(0.0)
	_update_hud()
	return ""

func _exit_tree() -> void:
	if is_instance_valid(rifle): rifle.queue_free()
