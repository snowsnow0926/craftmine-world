extends Node3D

const Contract = preload("res://scripts/scene_contract.gd")
const Blade = preload("res://addons/cw.module.promo-heavyblade/model.glb")
const Core = preload("res://addons/cw.module.promo-heavyblade/core.gd")
@export var player_path := NodePath("Player")
@export var camera_path := NodePath("Player/CameraRig/PitchPivot/Camera3D")
var context: Node3D
var hunt: Node3D
var configuration_error := ""
@export var entity_id := "great-hunt-01"
var status := "ready"
# Session UI state, separate from pointer lock and from the existing progress schema.
var duel_paused := false
var health := 100
var stamina := 100.0
var potions := 3
var attempts := 0
var wins := 0
var elapsed := 0.0
var best_time := 0.0
var return_pose: Dictionary = {}
var action := "none"
var action_time := 0.0
var action_hit := false
var dodge_direction := Vector3.ZERO
var dodge_cooldown := 0.0
var invulnerable := 0.0
var stamina_delay := 0.0
var request := ""
var notice := ""
var notice_time := 0.0
var hit_flash := 0.0
var damage_flash := 0.0
var float_number: Label
var world: Node3D
var player: CharacterBody3D
var camera: Camera3D
var old_encounter: Node3D
var old_mode := Node.PROCESS_MODE_INHERIT
var old_layers: Dictionary = {}
var old_suspended := false
var blade: Node3D
var barrier: Node3D
var wall_shapes: Array[CollisionShape3D] = []
var hud: CanvasLayer
var header: Label
var controls: Label
var center: Label
var health_bar: ProgressBar
var stamina_bar: ProgressBar
var boss_bar: ProgressBar
var red_screen: ColorRect
var boss: CharacterBody3D

func _ready() -> void:
	context = Core.acquire(self, Core, player_path, camera_path)
	call_deferred("_bind")

func _bind() -> void:
	if context == null: return
	world = get_parent()
	player = context.player
	camera = context.camera
	configuration_error = context.register_module("blade", self)
	if not configuration_error.is_empty():
		push_error(configuration_error)
		return
	add_to_group("craftmine_persistent_components")
	blade = Blade.instantiate() as Node3D
	camera.get_node("WeaponMount").add_child(blade)
	blade.set_meta("entity_id", entity_id + "-model")
	blade.set_meta("source_job_id", "41a3e161-9855-46d5-b143-4e41dad1762a")
	blade.scale = Vector3.ONE * 0.63
	blade.visible = context.current_weapon() == self
	_make_hud()

func bind_hunt(module_node: Node3D) -> String:
	if hunt != null and hunt != module_node: return "PROMO_DUPLICATE_HUNT"
	hunt = module_node
	boss = hunt.boss
	_make_arena()
	_sync_mode()
	return ""

func trial_to_global(point: Vector3) -> Vector3:
	return hunt.global_position + point - Vector3(19, 0, 14)

func evading() -> bool:
	return action == "dodge" and action_time >= 0.065 and action_time <= 0.30

func _make_arena() -> void:
	barrier = Node3D.new()
	hunt.add_child(barrier)
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(0.9, 0.56, 0.17, 0.25)
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	var sizes := [Vector3(0.25, 5.0, 28.0), Vector3(0.25, 5.0, 28.0), Vector3(22.0, 5.0, 0.25), Vector3(22.0, 5.0, 0.25)]
	var positions := [Vector3(8, 2.5, 14), Vector3(30, 2.5, 14), Vector3(19, 2.5, 0), Vector3(19, 2.5, 28)]
	for i in range(4):
		var wall := StaticBody3D.new()
		wall.collision_layer = 1
		wall.collision_mask = 8
		barrier.add_child(wall)
		wall.position = positions[i] - Vector3(19, 0, 14)
		var shape := CollisionShape3D.new()
		var box := BoxShape3D.new()
		box.size = sizes[i]
		shape.shape = box
		shape.disabled = true
		wall.add_child(shape)
		wall_shapes.append(shape)
		var edge := MeshInstance3D.new()
		var mesh := BoxMesh.new()
		mesh.size = Vector3(sizes[i].x, 0.45, sizes[i].z)
		edge.mesh = mesh
		edge.material_override = material
		wall.add_child(edge)
		edge.position.y = -2.25
	barrier.visible = false
	var sign := Label3D.new()
	hunt.add_child(sign)
	sign.position = Vector3(-9, 2.0, 3)
	sign.text = "裂 岳 兽\n大型怪物试炼 · H 开始"
	sign.font_size = 48
	sign.pixel_size = 0.006
	sign.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	var font: Font = world.get("creation_font") as Font
	if font != null: sign.font = font

func _label(parent: Node, size_value: int) -> Label:
	var label := Label.new()
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var font: Font = world.get("creation_font") as Font
	if font != null: label.add_theme_font_override("font", font)
	label.add_theme_font_size_override("font_size", size_value)
	label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.9))
	label.add_theme_constant_override("shadow_offset_x", 2)
	label.add_theme_constant_override("shadow_offset_y", 2)
	parent.add_child(label)
	return label

func _bar(parent: Node, colour: Color, width: float) -> ProgressBar:
	var bar := ProgressBar.new()
	parent.add_child(bar)
	bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	bar.show_percentage = false
	bar.custom_minimum_size = Vector2(width, 14)
	var back := StyleBoxFlat.new()
	back.bg_color = Color(0.04, 0.04, 0.05, 0.9)
	var fill := StyleBoxFlat.new()
	fill.bg_color = colour
	bar.add_theme_stylebox_override("background", back)
	bar.add_theme_stylebox_override("fill", fill)
	return bar

func _make_hud() -> void:
	hud = CanvasLayer.new()
	hud.layer = 5
	add_child(hud)
	red_screen = ColorRect.new()
	red_screen.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hud.add_child(red_screen)
	red_screen.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	red_screen.color = Color(0.7, 0.015, 0.025, 0)
	var top := VBoxContainer.new()
	hud.add_child(top)
	top.set_anchors_preset(Control.PRESET_CENTER_TOP)
	top.position = Vector2(-250, 22)
	header = _label(top, 22)
	boss_bar = _bar(top, Color("c95633"), 500)
	boss_bar.max_value = 1600
	var bottom := VBoxContainer.new()
	hud.add_child(bottom)
	bottom.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	bottom.position = Vector2(22, -220)
	health_bar = _bar(bottom, Color("d84943"), 330)
	stamina_bar = _bar(bottom, Color("dfbb54"), 330)
	controls = _label(bottom, 18)
	center = _label(hud, 25)
	center.set_anchors_preset(Control.PRESET_CENTER)
	center.position = Vector2(-320, 64)
	center.custom_minimum_size = Vector2(640, 100)
	center.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	float_number = _label(hud, 30)
	float_number.set_anchors_preset(Control.PRESET_CENTER)
	float_number.position = Vector2(28, -24)
	_sync_mode()
	_update_hud()

func combat_running() -> bool:
	if context == null or not context.input_allowed() or not configuration_error.is_empty(): return false
	return not duel_paused and (status == "active" or (status == "ready" and context.health > 0))

func _set_duel_paused(value: bool) -> void:
	if status != "active": return
	duel_paused = value
	request = ""
	# Release the mouse on pause, but never require or force capture on resume.
	if value: player.call("set_captured", false)
	player.call("set_movement_lock", self, value)
	_update_hud()

func _unhandled_input(event: InputEvent) -> void:
	if not is_instance_valid(player) or not player.get("input_enabled") or get_tree().paused or world.get("ready_for_play") != true: return
	if event is InputEventKey:
		if context.current_weapon() == self and event.physical_keycode in [KEY_LEFT, KEY_RIGHT, KEY_UP, KEY_DOWN]:
			# Consuming GUI navigation does not clear the real Input polling state.
			get_viewport().set_input_as_handled()
			return
		if not event.pressed or event.echo: return
		if event.physical_keycode == KEY_ESCAPE and status == "active":
			_set_duel_paused(not duel_paused)
			get_viewport().set_input_as_handled()
			return
		match event.physical_keycode:
			KEY_H:
				if boss != null and status != "active": request = "start"
			KEY_B:
				if status != "ready": request = "return"
			KEY_J:
				if combat_running() and context.current_weapon() == self: request = "light"
			KEY_K:
				if combat_running() and context.current_weapon() == self: request = "heavy"
			KEY_SHIFT:
				if combat_running(): request = "dodge"
			KEY_1:
				if status == "active" and combat_running(): request = "heal"
		if request != "": get_viewport().set_input_as_handled()
	elif event is InputEventMouseButton and event.pressed and context.current_weapon() == self:
		if duel_paused:
			# A click must not silently unpause or re-lock the view; Esc resumes.
			if event.button_index in [MOUSE_BUTTON_LEFT, MOUSE_BUTTON_RIGHT]: get_viewport().set_input_as_handled()
			return
		# Preserve the base controller's first-click capture and the original mouse attacks.
		if player.get("captured") and combat_running():
			if event.button_index == MOUSE_BUTTON_LEFT: request = "light"
			elif event.button_index == MOUSE_BUTTON_RIGHT: request = "heavy"
			if request != "": get_viewport().set_input_as_handled()

func _physics_process(delta: float) -> void:
	if world == null or not context.input_allowed(): return
	if request != "":
		var next := request
		request = ""
		if next == "start": _start()
		elif next == "return": _return()
		elif combat_running(): _begin_action(next)
	notice_time = maxf(0.0, notice_time - delta)
	damage_flash = maxf(0.0, damage_flash - delta)
	hit_flash = maxf(0.0, hit_flash - delta)
	if combat_running():
		if status == "active": elapsed += delta
		invulnerable = maxf(0.0, invulnerable - delta)
		dodge_cooldown = maxf(0.0, dodge_cooldown - delta)
		stamina_delay = maxf(0.0, stamina_delay - delta)
		if stamina_delay <= 0.0 and action == "none": stamina = minf(100.0, stamina + 25.0 * delta)
		_advance_action(delta)
		if boss != null: boss.call("tick", delta, status == "active")
		_apply_motion()
	else:
		if boss != null: boss.call("tick", 0.0, false)
	_update_blade()
	_update_hud()

func _start() -> void:
	if boss == null or hunt == null: return
	var placement_problem: String = hunt.validate_placement()
	if not placement_problem.is_empty():
		tell("场地尚不适合试炼，请调整场地配置。", 4.0)
		return
	if status == "ready":
		if player.call("movement_locked"):
			tell("先按 R 恢复原有战斗的生命，再进入试炼。", 4.0)
			return
		return_pose = player.call("snapshot").duplicate(true)
	status = "active"
	duel_paused = false
	health = 100
	stamina = 100.0
	potions = 3
	elapsed = 0.0
	attempts += 1
	action = "none"
	action_time = 0.0
	action_hit = false
	invulnerable = 0.0
	dodge_cooldown = 0.0
	stamina_delay = 0.0
	boss.call("start_battle")
	# An explicit trial entrance, not a source-load teleport or a saved-progress reset.
	var entry := trial_to_global(Vector3(12, 0.92, 22))
	player.call("restore", {"position": [entry.x, entry.y, entry.z], "yaw": -0.605, "pitch": 0.0, "onFloor": false})
	_sync_mode()
	tell("战斗开始！WASD 移动，J／K 出刀，方向键转视角。", 4.0)

func _return() -> void:
	status = "ready"
	duel_paused = false
	action = "none"
	_sync_mode()
	if not return_pose.is_empty(): player.call("restore", return_pose)
	tell("已返回树林；原有怪物、小麦和进度继续保留。", 4.0)

func _sync_mode() -> void:
	if player == null: return
	var in_trial := status != "ready"
	player.call("set_movement_lock", self, status == "failed" or (status == "active" and duel_paused))
	if blade != null: blade.visible = context.current_weapon() == self
	if barrier != null: barrier.visible = in_trial
	for shape in wall_shapes: shape.disabled = not in_trial

func _begin_action(next: String) -> void:
	var cancellable := action == "none" or (action == "light" and action_time > 0.46) or (action == "heavy" and action_time > 1.40)
	if next == "dodge":
		if not cancellable or dodge_cooldown > 0.0: return
		if stamina < 30.0:
			tell("耐力不足：暂缓攻击，让耐力恢复。", 1.0)
			return
		dodge_direction = player.call("movement_direction", Input.get_vector("move_left", "move_right", "move_forward", "move_back"))
		if dodge_direction.length_squared() < 0.01:
			dodge_direction = camera.global_basis.z
			dodge_direction.y = 0.0
		dodge_direction = dodge_direction.normalized()
		stamina -= 30.0
		dodge_cooldown = 0.68
	elif action != "none": return
	elif next in ["light", "heavy"]:
		var cost := 18.0 if next == "light" else 38.0
		if stamina < cost:
			tell("耐力不足。", 0.7)
			return
		stamina -= cost
	elif next == "heal":
		if potions <= 0 or health >= 100: return
		potions -= 1
		tell("饮药中……受击会中断。", 1.65)
	else: return
	action = next
	action_time = 0.0
	action_hit = false
	stamina_delay = 0.75

func _advance_action(delta: float) -> void:
	if action == "none": return
	action_time += delta
	var length := 0.62
	match action:
		"light", "heavy":
			var impact := 0.20 if action == "light" else 0.78
			length = 0.62 if action == "light" else 1.65
			if not action_hit and action_time >= impact:
				action_hit = true
				_melee_hit(75 if action == "light" else 170)
		"dodge": length = 0.40
		"heal":
			length = 1.65
			if action_time >= length and not action_hit:
				action_hit = true
				health = mini(100, health + 45)
				tell("恢复 45 生命。", 1.0)
		"stun": length = 0.44
	if action_time >= length:
		if action == "dodge":
			player.velocity.x = 0.0
			player.velocity.z = 0.0
		action = "none"
		action_time = 0.0
		action_hit = false

func _apply_motion() -> void:
	if status != "active" and action == "none": return
	# Applied after the unchanged base controller. The next tick uses its real slide collision.
	if action == "dodge":
		player.velocity.x = dodge_direction.x * 11.2
		player.velocity.z = dodge_direction.z * 11.2
	else:
		var speed_limit := 4.2 if action == "none" else 0.9
		if action == "stun": speed_limit = 3.5
		var horizontal := Vector2(player.velocity.x, player.velocity.z).limit_length(speed_limit)
		player.velocity.x = horizontal.x
		player.velocity.z = horizontal.y

func _melee_hit(amount: int) -> void:
	var targets: Array = [boss] if status == "active" and boss != null else context.monsters.duplicate()
	for target_node in targets:
		if not is_instance_valid(target_node) or target_node.health <= 0: continue
		var offset: Vector3 = target_node.global_position - player.global_position
		offset.y = 0.0
		var forward := -camera.global_basis.z
		forward.y = 0.0
		if offset.length() > 4.3 or forward.normalized().dot(offset.normalized()) < 0.30: continue
		var target: Vector3 = target_node.global_position + Vector3(0, 2.3 if target_node == boss else 0.8, 0)
		var query := PhysicsRayQueryParameters3D.create(camera.global_position, target, 99, [player.get_rid()])
		var result := get_world_3d().direct_space_state.intersect_ray(query)
		if result.is_empty() or result.collider != target_node: continue
		var damage: int = int(target_node.call("take_melee", amount)) if target_node == boss else (amount if target_node.call("take_hit", amount, forward) else 0)
		if damage <= 0: continue
		hit_flash = 0.28
		if float_number != null: float_number.text = str(damage)
		_spark(result.position)

func _spark(point: Vector3) -> void:
	var material := StandardMaterial3D.new()
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.albedo_color = Color("ffdc82")
	for i in range(7):
		var spark := MeshInstance3D.new()
		var mesh := BoxMesh.new()
		mesh.size = Vector3(0.05, 0.05, 0.24)
		spark.mesh = mesh
		spark.material_override = material
		add_child(spark)
		spark.global_position = point
		var direction := Vector3(cos(i * 2.4), 0.3 + float(i % 3) * 0.4, sin(i * 2.4))
		var tween := spark.create_tween()
		tween.set_parallel(true)
		tween.tween_property(spark, "position", spark.position + direction * 0.7, 0.25)
		tween.tween_property(spark, "scale", Vector3.ONE * 0.05, 0.25)
		tween.chain().tween_callback(spark.queue_free)

func hurt(amount: int, direction: Vector3) -> void:
	if status != "active" or invulnerable > 0.0: return
	if action == "dodge" and action_time >= 0.065 and action_time <= 0.30:
		tell("闪避成功！", 0.7)
		return
	health = maxi(0, health - amount)
	invulnerable = 0.85
	damage_flash = 0.42
	action = "stun"
	action_time = 0.0
	action_hit = false
	player.velocity.x = direction.x * 3.5
	player.velocity.z = direction.z * 3.5
	stamina_delay = 0.6
	if health <= 0:
		status = "failed"
		_sync_mode()
		tell("讨伐失败。留意抬臂与冲撞路线锁定，别把耐力打空。", 6.0)

func victory() -> void:
	if status != "active": return
	status = "won"
	wins += 1
	if best_time <= 0.0 or elapsed < best_time: best_time = elapsed
	action = "none"
	_sync_mode()
	tell("讨伐成功！裂岳兽已倒下。", 10.0)

func tell(message: String, seconds: float) -> void:
	notice = message
	notice_time = seconds

func _update_blade() -> void:
	if blade == null: return
	blade.visible = context.current_weapon() == self
	blade.position = Vector3(0.46, -0.53, -0.88)
	blade.rotation = Vector3(-0.08, 0.12, -0.20)
	if action == "light":
		var p := clampf((action_time - 0.12) / 0.24, 0.0, 1.0)
		blade.rotation = Vector3(-0.40 + p * 1.7, -0.6 + p * 1.5, -0.8 + p * 1.4)
		blade.position.x = 0.52 - p * 0.65
	elif action == "heavy":
		if action_time < 0.78:
			blade.rotation = Vector3(-0.8, 0.1, -0.6)
			blade.position.y = -0.20
		else:
			var p := clampf((action_time - 0.78) / 0.22, 0.0, 1.0)
			blade.rotation = Vector3(-0.8 + 2.4 * p, 0.1, -0.6 + 0.45 * p)
			blade.position.y = -0.20 - p * 0.32
	elif action in ["heal", "dodge", "stun"]:
		blade.position.y -= 0.40

func _update_hud() -> void:
	if hud == null: return
	if boss == null:
		header.text = "重刃 · 耐力 %d/100" % roundi(stamina)
		controls.text = "J／左键 轻斩 · K／右键 重斩 · Shift 闪避 · 方向键转视角"
		boss_bar.visible = false
		health_bar.visible = false
		stamina_bar.visible = context.current_weapon() == self
		stamina_bar.value = stamina
		controls.visible = context.current_weapon() == self
		header.visible = context.current_weapon() == self
		center.text = notice if notice_time > 0 else ""
		float_number.visible = hit_flash > 0
		return
	controls.visible = true
	header.visible = true
	var in_trial := status != "ready"
	boss_bar.visible = in_trial
	health_bar.visible = in_trial
	stamina_bar.visible = in_trial
	header.text = "裂岳兽  ·  怒化" if boss.call("enraged") else "裂岳兽  ·  大型怪物试炼"
	if not in_trial: header.text = "H 开战 · 键盘即可游玩，无需锁定鼠标"
	boss_bar.value = boss.get("health")
	health_bar.value = health
	stamina_bar.value = stamina
	controls.text = "生命 %d/100   耐力 %d/100   药剂 %d\nWASD 移动 · 方向键 转视角 · Shift + WASD 闪避\nJ／左键 轻斩 · K／右键 重斩 · 1 饮药\nEsc 暂停／继续 · B 返回树林 · 点击可切回鼠标视角" % [health, roundi(stamina), potions] if in_trial else ""
	red_screen.color.a = damage_flash * 0.70
	float_number.visible = hit_flash > 0.0
	center.text = notice if notice_time > 0.0 else ""
	if status == "active" and duel_paused:
		center.text = "试炼已暂停\nEsc 继续（无需点击或锁定鼠标）\nB 返回树林"
	elif status == "failed":
		center.text = "讨伐失败\nH 重新挑战 · B 返回树林\n你的物品、小麦和旧进度不会丢失"
	elif status == "won":
		center.text = "讨伐成功！  %.1f 秒\n挑战 %d 次 · 胜利 %d 次\nH 再战 · B 返回树林" % [elapsed, attempts, wins]

func snapshot() -> Dictionary:
	return {"format": "craftmine.promo-heavyblade/1", "entityId": entity_id, "settings": {"difficulty": "hard"}, "sourceSettings": {"difficulty": "hard"}, "status": status, "health": health, "stamina": stamina, "potions": potions, "attempts": attempts, "wins": wins, "elapsed": elapsed, "bestTime": best_time, "returnPose": return_pose.duplicate(true), "action": action, "actionTime": action_time, "actionHit": action_hit, "dodgeDirection": [dodge_direction.x, dodge_direction.y, dodge_direction.z], "dodgeCooldown": dodge_cooldown, "invulnerable": invulnerable, "staminaDelay": stamina_delay}

func validate_state(data: Dictionary) -> String:
	if not Contract.fields(data, ["format", "entityId", "settings", "sourceSettings", "status", "health", "stamina", "potions", "attempts", "wins", "elapsed", "bestTime", "returnPose", "action", "actionTime", "actionHit", "dodgeDirection", "dodgeCooldown", "invulnerable", "staminaDelay"]): return "Invalid hunt fields"
	if data.format != "craftmine.promo-heavyblade/1" or data.entityId != entity_id: return "Hunt identity mismatch"
	for key in ["settings", "sourceSettings"]:
		if not Contract.fields(data[key], ["difficulty"]) or data[key].difficulty != "hard": return "Hunt difficulty mismatch"
	if not data.status in ["ready", "active", "failed", "won"] or not data.action in ["none", "light", "heavy", "dodge", "heal", "stun"]: return "Invalid hunt phase"
	if not Contract.integer(data.health, 0, 100) or not Contract.finite(data.stamina, 0.0, 100.0) or not Contract.integer(data.potions, 0, 3): return "Invalid hunter resources"
	for key in ["attempts", "wins"]:
		if not Contract.integer(data[key], 0, 1000000): return "Invalid hunt record"
	for key in ["elapsed", "bestTime", "actionTime", "dodgeCooldown", "invulnerable", "staminaDelay"]:
		if not Contract.finite(data[key], 0.0, 100000000.0): return "Invalid hunt timer"
	if not data.actionHit is bool or not data.dodgeDirection is Array or data.dodgeDirection.size() != 3: return "Invalid dodge state"
	for number in data.dodgeDirection:
		if not Contract.finite(number, -1.01, 1.01): return "Invalid dodge vector"
	if not data.returnPose is Dictionary: return "Invalid return pose"
	if not data.returnPose.is_empty():
		var pose: Dictionary = data.returnPose
		if not Contract.fields(pose, ["position", "yaw", "pitch", "onFloor"]) or not pose.position is Array or pose.position.size() != 3: return "Invalid return pose fields"
		for number in pose.position:
			if not Contract.finite(number, -1000.0, 1000.0): return "Invalid return position"
		if not Contract.finite(pose.yaw, -PI - 0.001, PI + 0.001) or not Contract.finite(pose.pitch, -PI, PI) or not pose.onFloor is bool: return "Invalid return look"
	elif data.status != "ready": return "Active hunt needs a return pose"
	if data.status != "ready" and boss == null: return "PROMO_SAVED_TRIAL_REQUIRES_HUNT_MODULE"
	if data.status == "active" and data.health <= 0: return "Active hunt has a defeated player"
	if data.status == "failed" and data.health != 0: return "Failed hunt health mismatch"
	return ""

func restore(data: Dictionary) -> String:
	var problem := validate_state(data)
	if problem != "": return problem
	status = str(data.status)
	duel_paused = false
	health = int(data.health)
	stamina = float(data.stamina)
	potions = int(data.potions)
	attempts = int(data.attempts)
	wins = int(data.wins)
	elapsed = float(data.elapsed)
	best_time = float(data.bestTime)
	return_pose = data.returnPose.duplicate(true)
	action = str(data.action)
	action_time = float(data.actionTime)
	action_hit = data.actionHit
	dodge_direction = Vector3(data.dodgeDirection[0], data.dodgeDirection[1], data.dodgeDirection[2])
	dodge_cooldown = float(data.dodgeCooldown)
	invulnerable = float(data.invulnerable)
	stamina_delay = float(data.staminaDelay)
	request = ""
	_sync_mode()
	_update_blade()
	_update_hud()
	return ""

func _exit_tree() -> void:
	if is_instance_valid(player): player.call("set_movement_lock", self, false)
	if is_instance_valid(blade): blade.queue_free()

func _process(delta: float) -> void:
	if context == null or context.current_weapon() != self or not combat_running(): return
	var axis := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
	if axis.length_squared() > 0.001:
		var view: Dictionary = player.call("look")
		player.call("set_look", float(view.yaw) - axis.x * deg_to_rad(110.0) * delta, float(view.pitch) - axis.y * deg_to_rad(85.0) * delta)
