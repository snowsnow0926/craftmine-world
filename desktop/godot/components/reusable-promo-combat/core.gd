extends Node3D

const Contract = preload("res://scripts/scene_contract.gd")
# Identical helper bytes ship in each stage. No visible entity is a prerequisite.
const PROTOCOL := "craftmine.promo-combat-context/1"
var protocol := PROTOCOL
var entity_id := ""
var player_path := NodePath("Player")
var camera_path := NodePath("Player/CameraRig/PitchPivot/Camera3D")
var selected_slot := "auto"
var modules: Dictionary = {}
var configuration_error := ""

static func acquire(owner_node: Node3D, script: Script, actor_path: NodePath, view_path: NodePath) -> Node3D:
	var receiving_world := owner_node.get_parent()
	var candidate: Node3D = receiving_world.get_meta("craftmine_promo_context") if receiving_world.has_meta("craftmine_promo_context") else null
	if is_instance_valid(candidate):
		if candidate.player_path != actor_path or candidate.camera_path != view_path or candidate.get("protocol") != PROTOCOL:
			push_error("PROMO_CONTEXT_BINDING_OR_VERSION_CONFLICT")
			return null
		return candidate
	var context: Node3D = script.new()
	context.player_path = actor_path
	context.camera_path = view_path
	context.entity_id = "promo-player-" + str(actor_path).sha256_text().substr(0, 20)
	# A PackedScene parent may still be constructing siblings here. Reserve the
	# unique instance immediately and attach only after the scene is initialized.
	receiving_world.set_meta("craftmine_promo_context", context)
	receiving_world.add_child.call_deferred(context)
	return context

func register_module(role: String, module: Node3D) -> String:
	if modules.has(role) and is_instance_valid(modules[role]) and modules[role] != module:
		return "PROMO_DUPLICATE_" + role.to_upper()
	modules[role] = module
	return ""

func module(role: String) -> Node3D:
	return modules.get(role) if is_instance_valid(modules.get(role)) else null

func current_weapon() -> Node3D:
	if selected_slot != "auto": return module(selected_slot)
	return module("rifle") if module("rifle") != null else module("blade")

func select_weapon(slot: String) -> bool:
	if module(slot) == null: return false
	var blade_node := module("blade")
	if blade_node != null and blade_node.action != "none": return false
	selected_slot = slot
	return true

func input_allowed() -> bool:
	return is_inside_tree() and configuration_error.is_empty() and is_instance_valid(player) and player.get("input_enabled") == true and world.get("ready_for_play") == true and not get_tree().paused

func in_trial() -> bool:
	var blade_node := module("blade")
	return blade_node != null and blade_node.status != "ready"

func combat_running() -> bool:
	if not input_allowed(): return false
	var blade_node := module("blade")
	return bool(blade_node.combat_running()) if in_trial() else health > 0

func small_monsters_running() -> bool:
	return input_allowed() and not in_trial()

var health := 100
var world: Node3D
var player: CharacterBody3D
var camera: Camera3D
var monsters: Array[Node] = []
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
	player = world.get_node_or_null(player_path) as CharacterBody3D
	camera = world.get_node_or_null(camera_path) as Camera3D
	if player == null or camera == null:
		configuration_error = "PROMO_PLAYER_CAMERA_BINDING_REQUIRED"
	else:
		for method in ["set_movement_lock", "movement_locked", "snapshot", "restore", "look", "set_look", "movement_direction"]:
			if not player.has_method(method): configuration_error = "PROMO_PLAYER_INTERFACE_REQUIRED: " + method
	if not configuration_error.is_empty():
		push_error(configuration_error)
		return
	add_to_group("craftmine_promo_context")
	add_to_group("craftmine_persistent_components")
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
	if not input_allowed(): return
	if event is InputEventKey and event.pressed and not event.echo:
		if event.physical_keycode == KEY_R and health <= 0 and recovery_delay <= 0.0 and not in_trial():
			_recover()
			get_viewport().set_input_as_handled()
		elif event.physical_keycode in [KEY_2, KEY_3]:
			if select_weapon("rifle" if event.physical_keycode == KEY_2 else "blade"):
				get_viewport().set_input_as_handled()

func _physics_process(delta: float) -> void:
	if not small_monsters_running(): return
	invulnerable = maxf(0.0, invulnerable - delta)
	recovery_delay = maxf(0.0, recovery_delay - delta)
	flash_time = maxf(0.0, flash_time - delta)
	notice_time = maxf(0.0, notice_time - delta)
	since_damage += delta
	if health > 0 and health < 100 and since_damage > 8.0:
		regeneration += delta
		if regeneration >= 1.0:
			health = mini(100, health + 4)
			regeneration = 0.0
	_update_hud()

func _effect_material(colour: Color) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = colour
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	return material

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
	if not small_monsters_running() or health <= 0 or invulnerable > 0.0 or amount <= 0: return
	var equipped := current_weapon()
	if equipped != null and equipped.has_method("evading") and equipped.evading(): return
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
	text += "\n躲开橙红色蓄力攻击"
	if not monsters.is_empty() and defeated == monsters.size(): text += "\n角怪已清理完毕！"
	elif notice_time > 0.0: text += "\n" + notice
	hud.text = text
	damage_flash.color.a = 0.2 if health <= 0 else flash_time * 0.65
	downed_label.visible = health <= 0
	downed_label.text = "暂时被击倒了……" if recovery_delay > 0.0 else "按 R 恢复，继续冒险"

func snapshot() -> Dictionary:
	return {"format": PROTOCOL, "entityId": entity_id, "sourceSettings": {"maxHealth": 100}, "settings": {"maxHealth": 100}, "health": health, "selectedSlot": selected_slot}

func validate_state(data: Dictionary) -> String:
	if not Contract.fields(data, ["format", "entityId", "sourceSettings", "settings", "health", "selectedSlot"]): return "Invalid combat state fields"
	if data.format != PROTOCOL or data.entityId != entity_id: return "Combat identity mismatch"
	for key in ["settings", "sourceSettings"]:
		if not Contract.fields(data[key], ["maxHealth"]) or data[key].maxHealth != 100: return "Combat settings mismatch"
	if not data.selectedSlot in ["auto", "blade", "rifle"]: return "Invalid equipped slot"
	return "" if Contract.integer(data.health, 0, 100) else "Invalid player combat health"

func restore(data: Dictionary) -> String:
	var problem := validate_state(data)
	if not problem.is_empty(): return problem
	health = int(data.health)
	selected_slot = str(data.selectedSlot)
	invulnerable = 1.0
	since_damage = 0.0
	flash_time = 0.0
	recovery_delay = 0.0
	player.call("set_movement_lock", self, health <= 0)
	_update_hud()
	return ""

func _exit_tree() -> void:
	if is_instance_valid(player): player.call("set_movement_lock", self, false)
