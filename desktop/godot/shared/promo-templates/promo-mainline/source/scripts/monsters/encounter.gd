extends Node3D

const Contract = preload("res://scripts/scene_contract.gd")
@export var entity_id := "grove-combat-01"
var health := 100
var world: Node3D
var player: CharacterBody3D
var camera: Camera3D
var monsters: Array[Node] = []
var cooldown := 0.0
var shot_requested := false
var invulnerable := 0.0
var since_damage := 0.0
var regeneration := 0.0
var recovery_delay := 0.0
var flash_time := 0.0
var notice := "树林边出现了角怪。靠近后小心它们的蓄力攻击。"
var notice_time := 7.0
var hud: Label
var downed_label: Label
var damage_flash: ColorRect
var hit_cross: Label

func _ready() -> void:
	world = get_parent() as Node3D
	player = world.get_node("Player") as CharacterBody3D
	camera = world.get_node("Player/CameraRig/PitchPivot/Camera3D") as Camera3D
	add_to_group("craftmine_persistent_components")
	for child in get_children():
		if child.has_method("take_hit"): monsters.append(child)
	call_deferred("_make_hud")

func _make_hud() -> void:
	var layer := CanvasLayer.new()
	layer.layer = 2
	add_child(layer)
	var font: Font = world.get("creation_font") as Font
	damage_flash = ColorRect.new()
	damage_flash.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layer.add_child(damage_flash)
	damage_flash.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	damage_flash.color = Color(0.7, 0.06, 0.08, 0.0)
	hud = Label.new()
	hud.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if font != null: hud.add_theme_font_override("font", font)
	hud.add_theme_font_size_override("font_size", 18)
	layer.add_child(hud)
	hud.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	hud.position = Vector2(20, -106)
	downed_label = Label.new()
	downed_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if font != null: downed_label.add_theme_font_override("font", font)
	downed_label.add_theme_font_size_override("font_size", 28)
	layer.add_child(downed_label)
	downed_label.set_anchors_preset(Control.PRESET_CENTER)
	downed_label.position = Vector2(-190, -50)
	hit_cross = Label.new()
	hit_cross.text = "×"
	hit_cross.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hit_cross.add_theme_font_size_override("font_size", 32)
	hit_cross.modulate = Color("ffe895")
	layer.add_child(hit_cross)
	hit_cross.set_anchors_preset(Control.PRESET_CENTER)
	hit_cross.position = Vector2(-10, -23)
	hit_cross.visible = false
	_update_hud()

func _unhandled_input(event: InputEvent) -> void:
	if not is_instance_valid(player) or not player.get("input_enabled") or get_tree().paused: return
	if event is InputEventKey and event.pressed and not event.echo:
		if event.physical_keycode == KEY_R and health <= 0 and recovery_delay <= 0.0:
			_recover()
			get_viewport().set_input_as_handled()
		elif event.physical_keycode == KEY_Q and health > 0:
			shot_requested = true
			get_viewport().set_input_as_handled()
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and event.pressed:
		# The first click remains the base controller's explicit mouse capture.
		if player.get("captured") and health > 0:
			shot_requested = true
			get_viewport().set_input_as_handled()

func _physics_process(delta: float) -> void:
	if world.get("ready_for_play") != true: return
	cooldown = maxf(0.0, cooldown - delta)
	invulnerable = maxf(0.0, invulnerable - delta)
	recovery_delay = maxf(0.0, recovery_delay - delta)
	flash_time = maxf(0.0, flash_time - delta)
	notice_time = maxf(0.0, notice_time - delta)
	since_damage += delta
	if shot_requested:
		shot_requested = false
		if health > 0 and cooldown <= 0.0: _cast_pulse()
	if health > 0 and health < 100 and since_damage > 8.0:
		regeneration += delta
		if regeneration >= 1.0:
			health = mini(100, health + 4)
			regeneration = 0.0
	_update_hud()

func _cast_pulse() -> void:
	cooldown = 0.45
	var origin := camera.global_position
	var direction := -camera.global_transform.basis.z
	var end := origin + direction * 20.0
	# Only world obstacles and hostiles are hit: pet layer 16 is never damaged.
	var query := PhysicsRayQueryParameters3D.create(origin, end, 35, [player.get_rid()])
	var hit := get_world_3d().direct_space_state.intersect_ray(query)
	var successful := false
	if not hit.is_empty():
		end = hit.position
		var target: Node = hit.collider as Node
		if target != null and target in monsters:
			successful = bool(target.call("take_hit", 30, direction))
	var muzzle := origin + camera.global_transform.basis.x * 0.24 - camera.global_transform.basis.y * 0.18 + direction * 0.3
	_beam(muzzle, end)
	_spark(end, Color("ffe59b") if successful else Color("83e4ff"), 0.14)
	if successful and hit_cross != null:
		hit_cross.visible = true
		get_tree().create_timer(0.16).timeout.connect(func():
			if is_instance_valid(hit_cross): hit_cross.visible = false)

func _effect_material(colour: Color) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = colour
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	return material

func _beam(start: Vector3, end: Vector3) -> void:
	var node := MeshInstance3D.new()
	var mesh := ImmediateMesh.new()
	mesh.surface_begin(Mesh.PRIMITIVE_LINES)
	mesh.surface_add_vertex(start)
	mesh.surface_add_vertex(end)
	mesh.surface_end()
	node.mesh = mesh
	node.material_override = _effect_material(Color("8feaff"))
	world.add_child(node)
	get_tree().create_timer(0.10).timeout.connect(node.queue_free)

func _spark(point: Vector3, colour: Color, radius: float) -> void:
	var node := MeshInstance3D.new()
	var mesh := SphereMesh.new()
	mesh.radius = radius
	mesh.height = radius * 2.0
	mesh.radial_segments = 8
	mesh.rings = 4
	node.mesh = mesh
	node.material_override = _effect_material(colour)
	world.add_child(node)
	node.global_position = point
	var tween := node.create_tween()
	tween.tween_property(node, "scale", Vector3.ONE * 0.05, 0.23)
	tween.tween_callback(node.queue_free)

func damage_player(amount: int) -> void:
	if health <= 0 or invulnerable > 0.0 or amount <= 0: return
	health = maxi(0, health - amount)
	invulnerable = 0.75
	since_damage = 0.0
	regeneration = 0.0
	flash_time = 0.3
	if health <= 0:
		recovery_delay = 2.0
		player.call("set_movement_lock", self, true)
		_notice("你被击倒了。恢复后可继续挑战，物品和小麦都不会丢失。")

func _recover() -> void:
	health = 100
	invulnerable = 5.0
	since_damage = 0.0
	player.call("set_movement_lock", self, false)
	_notice("已恢复生命，获得 5 秒保护。")

func monster_defeated(monster: Node3D) -> void:
	_spark(monster.global_position + Vector3(0, 0.7, 0), Color("a8f2c1"), 0.45)
	_notice("击败了" + str(monster.get("monster_name")) + "！")

func _notice(message: String) -> void:
	notice = message
	notice_time = 3.5
	_update_hud()

func _update_hud() -> void:
	if hud == null: return
	var defeated := 0
	for monster in monsters:
		if monster.get("health") <= 0: defeated += 1
	var text := "生命 " + str(health) + "/100  ·  击败 " + str(defeated) + "/" + str(monsters.size())
	text += "\n左键 / Q 魔法冲击 · 躲开橙红色蓄力攻击"
	if defeated == monsters.size(): text += "\n角怪已清理完毕！"
	elif notice_time > 0.0: text += "\n" + notice
	hud.text = text
	damage_flash.color.a = 0.2 if health <= 0 else flash_time * 0.65
	downed_label.visible = health <= 0
	downed_label.text = "暂时被击倒了……" if recovery_delay > 0.0 else "按 R 恢复，继续冒险"

func snapshot() -> Dictionary:
	return {"format": "craftmine.grove-combat/1", "entityId": entity_id, "sourceSettings": {"maxHealth": 100}, "settings": {"maxHealth": 100}, "health": health}

func validate_state(data: Dictionary) -> String:
	if not Contract.fields(data, ["format", "entityId", "sourceSettings", "settings", "health"]): return "Invalid combat state fields"
	if data.format != "craftmine.grove-combat/1" or data.entityId != entity_id: return "Combat identity mismatch"
	for key in ["settings", "sourceSettings"]:
		if not Contract.fields(data[key], ["maxHealth"]) or data[key].maxHealth != 100: return "Combat settings mismatch"
	return "" if Contract.integer(data.health, 0, 100) else "Invalid player combat health"

func restore(data: Dictionary) -> String:
	var problem := validate_state(data)
	if not problem.is_empty(): return problem
	health = int(data.health)
	shot_requested = false
	cooldown = 0.0
	invulnerable = 1.0
	since_damage = 0.0
	flash_time = 0.0
	recovery_delay = 0.0
	player.call("set_movement_lock", self, health <= 0)
	_update_hud()
	return ""

func _exit_tree() -> void:
	if is_instance_valid(player): player.call("set_movement_lock", self, false)
